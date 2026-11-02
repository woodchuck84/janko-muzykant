package com.jankomuzykant.app;

import android.Manifest;
import android.accounts.Account;
import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import java.security.MessageDigest;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "ChoirDrive", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class ChoirDrivePlugin extends Plugin {
    private static final String DEFAULT_ROOT = "1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ";
    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
    private static final String FOLDER = "application/vnd.google-apps.folder";
    private static final String FIELDS = "id,name,mimeType,parents,size,modifiedTime,trashed";
    private static final int TEXT_LIMIT = 12 * 1024 * 1024;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SecureSession secure;
    private JSONObject session;
    private String token;
    private boolean offline = true;
    private volatile long accountEpoch;
    private volatile PluginCall pendingAuthorization;
    private ActivityResultLauncher<IntentSenderRequest> authorizationLauncher;
    private final Map<String, JSONObject> publicEntries = new HashMap<>();

    @Override public void load() {
        secure = new SecureSession(getContext());
        authorizationLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(), result -> {
                PluginCall call = pendingAuthorization;
                pendingAuthorization = null;
                if (call == null) return;
                run(call, () -> {
                    AuthorizationResult authorization;
                    try {
                        authorization = AuthorizationCompletion.read(result.getResultCode(), result.getData(),
                            data -> Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data));
                    } catch (AuthorizationCompletion.MissingResult missing) {
                        throw new Failure(missing.code, missing.getMessage());
                    }
                    acceptAuthorization(authorization, true);
                    return snapshot();
                });
            });
    }

    private interface Work { JSObject execute() throws Exception; }
    private static class Failure extends Exception {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }
    private static final class Resolution extends Exception {
        final AuthorizationResult result;
        Resolution(AuthorizationResult result) { this.result = result; }
    }

    private void run(PluginCall call, Work work) {
        if (pendingAuthorization != null) {
            call.reject("Authorization is in progress", "BUSY");
            return;
        }
        long expectedEpoch = accountEpoch;
        String method = call.getMethodName();
        boolean accountBound = !("initialize".equals(method) || "connect".equals(method) ||
            "verify".equals(method) || "signOut".equals(method) || "useAnonymous".equals(method));
        worker.execute(() -> {
            try {
                if (pendingAuthorization != null) throw new Failure("BUSY", "Google authorization is in progress");
                if (accountBound && expectedEpoch != accountEpoch) {
                    throw new Failure("AUTH_REQUIRED", "Account changed; discard stale operation");
                }
                JSObject result = work.execute();
                if (result != null) call.resolve(result);
            }
            catch (Resolution resolution) {
                pendingAuthorization = call;
                getActivity().runOnUiThread(() -> {
                    try {
                        authorizationLauncher.launch(new IntentSenderRequest.Builder(
                            resolution.result.getPendingIntent()).build());
                    } catch (Exception error) {
                        pendingAuthorization = null;
                        call.reject("Cannot open Google authorization. Check Google Play Services and retry.", "AUTH_LAUNCH_ERROR");
                    }
                });
            } catch (Exception error) {
                Throwable cause = unwrap(error);
                Failure failure = networkFailure(cause) ? null : classify(cause);
                if (failure != null) {
                    call.reject(failure.getMessage(), failure.code);
                } else if (cause instanceof IllegalArgumentException) {
                    call.reject(cause.getMessage(), "INVALID_INPUT");
                } else if (networkFailure(cause)) {
                    call.reject("No connection. Only previously downloaded private files are available.", "NETWORK_ERROR");
                } else {
                    call.reject("Operation failed. Reconnect your Google account and retry.", "NATIVE_ERROR");
                }
            }
        });
    }

    private boolean networkFailure(Throwable error) {
        while (error instanceof ExecutionException && error.getCause() != null) error = error.getCause();
        return error instanceof IOException || error instanceof TimeoutException ||
            (error instanceof ApiException && (
                ((ApiException) error).getStatusCode() == CommonStatusCodes.NETWORK_ERROR ||
                ((ApiException) error).getStatusCode() == CommonStatusCodes.TIMEOUT));
    }

    private void loadSession() throws Exception {
        if (session == null) {
            try { session = secure.read(); }
            catch (Exception corrupt) {
                // An invalidated Keystore key must not expose orphaned private downloads.
                PrivateFiles.delete(new File(getContext().getFilesDir(), "accounts"));
                secure.clear();
                throw new Failure("AUTH_REQUIRED", "Private session expired; reconnect");
            }
        }
    }

    private String root() {
        return session == null ? DEFAULT_ROOT : session.optString("rootFolderId", DEFAULT_ROOT);
    }

    private File accountDir() throws Exception {
        loadSession();
        if (session == null) throw new Failure("AUTH_REQUIRED", "Connect a Google account first");
        File directory = new File(getContext().getFilesDir(), "accounts/" +
            PrivateFiles.accountKey(session.getJSONObject("account").getString("id")));
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Cannot create private storage");
        return directory;
    }

    private void clearSession() throws Exception {
        accountEpoch++;
        token = null;
        offline = true;
        if (session != null) PrivateFiles.delete(accountDir());
        secure.clear();
        session = null;
    }

    private boolean anonymous() {
        return session != null && session.optJSONObject("account") != null &&
            PublicDrive.ACCOUNT_ID.equals(session.optJSONObject("account").optString("id"));
    }

    private boolean publicHtml() { return anonymous() && token == null && BuildConfig.DRIVE_API_KEY.isEmpty(); }

    private void anonymousSession() throws Exception {
        session = new JSONObject().put("account", new JSONObject()
            .put("id", PublicDrive.ACCOUNT_ID).put("email", "Bez logowania")
            .put("anonymous", true).put("lastVerified", 0))
            .put("rootFolderId", DEFAULT_ROOT).put("lastVerified", 0);
        accountEpoch++;
        token = null;
        secure.write(session);
    }

    private AuthorizationResult authorize(boolean interactive) throws Exception {
        AuthorizationRequest.Builder request = AuthorizationRequest.builder().setRequestedScopes(Arrays.asList(
            new Scope(DRIVE_SCOPE), new Scope("openid"), new Scope("email")));
        if (interactive) request.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
        else if (session != null) request.setAccount(new Account(
            session.getJSONObject("account").getString("email"), "com.google"));
        AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(getActivity())
            .authorize(request.build()), 90, TimeUnit.SECONDS);
        if (result.hasResolution()) {
            if (interactive) throw new Resolution(result);
            throw new Failure("AUTH_REQUIRED", "Google consent expired; reconnect");
        }
        return result;
    }

    private void acceptAuthorization(AuthorizationResult result, boolean switching) throws Exception {
        if (!result.getGrantedScopes().contains(DRIVE_SCOPE) || result.getAccessToken() == null) {
            throw new Failure("AUTH_PERMISSION_DENIED", "Read-only Drive permission was not granted. Allow Drive read access in Google consent.");
        }
        String oldToken = token;
        token = result.getAccessToken();
        try {
            JSONObject identity = json("https://openidconnect.googleapis.com/v1/userinfo", TEXT_LIMIT);
            String id = identity.optString("sub");
            String email = identity.optString("email");
            if (id.isEmpty() || email.isEmpty() || !identity.optBoolean("email_verified")) {
                throw new Failure("AUTH_REQUIRED", "Google did not verify account identity");
            }
            if (!switching && session != null &&
                !session.getJSONObject("account").getString("id").equals(id)) {
                throw new Failure("AUTH_REQUIRED", "Google account changed; reconnect");
            }
            String rootId = root();
            JSONObject metadata = metadata(rootId);
            if (!FOLDER.equals(metadata.optString("mimeType")) || metadata.optBoolean("trashed")) {
                throw new Failure("ACCESS_DENIED", "The configured Drive root is not an accessible folder");
            }
            if (switching && session != null &&
                !session.getJSONObject("account").getString("id").equals(id)) {
                if (anonymous()) { session = null; accountEpoch++; }
                else clearSession();
            }
            token = result.getAccessToken();
            if (session == null) accountEpoch++;
            long verified = System.currentTimeMillis();
            session = new JSONObject().put("account", new JSONObject()
                .put("id", id).put("user_id", id).put("email", email).put("lastVerified", verified))
                .put("rootFolderId", rootId).put("lastVerified", verified);
            secure.write(session);
            offline = false;
        } catch (Exception error) {
            token = oldToken;
            throw error;
        }
    }

    private void gate(boolean allowOffline) throws Exception {
        loadSession();
        if (session == null) throw new Failure("AUTH_REQUIRED", "Connect a Google account first");
        if (anonymous()) {
            try {
                JSONObject folder;
                if (publicHtml()) {
                    publicListing(root());
                    folder = new JSONObject().put("mimeType", FOLDER);
                } else folder = metadata(root());
                if (!FOLDER.equals(folder.optString("mimeType")) || folder.optBoolean("trashed")) {
                    throw new Failure("SIGN_IN_REQUIRED", "Choir folder is not publicly readable. Use optional Google sign-in.");
                }
                long verified = System.currentTimeMillis();
                session.getJSONObject("account").put("lastVerified", verified);
                session.put("lastVerified", verified);
                secure.write(session);
                offline = false;
                return;
            } catch (Exception error) {
                if (networkFailure(error)) {
                    offline = true;
                    if (allowOffline) return;
                    throw new Failure("NETWORK_ERROR", "No network. Previously downloaded public materials only.");
                }
                throw error;
            }
        }
        try {
            acceptAuthorization(authorize(false), false);
        } catch (Exception error) {
            if (networkFailure(error)) {
                offline = true;
                token = null;
                if (allowOffline) return;
                throw new Failure("NETWORK_ERROR", "Download requires an online, verified Google account");
            }
            Failure failure = classify(error);
            if (failure != null && AuthErrors.erasesAccount(failure.code)) clearSession();
            if (failure != null) throw failure;
            throw error;
        }
    }

    private static Throwable unwrap(Throwable error) {
        while (error instanceof ExecutionException && error.getCause() != null) error = error.getCause();
        return error;
    }

    private static Failure classify(Throwable error) {
        error = unwrap(error);
        if (error instanceof Failure) return (Failure) error;
        if (error instanceof ApiException) {
            String code = AuthErrors.fromGoogleStatus(((ApiException) error).getStatusCode());
            return new Failure(code, AuthErrors.message(code) +
                " (Google status " + ((ApiException) error).getStatusCode() + ")");
        }
        return null;
    }

    private void requireSavedAccount() throws Exception {
        loadSession();
        if (session == null) throw new Failure("AUTH_REQUIRED", "Connect a Google account first");
    }

    private JSObject snapshot() throws Exception {
        JSObject result = new JSObject();
        result.put("account", session == null ? JSONObject.NULL : session.getJSONObject("account"));
        result.put("lastVerified", session == null ? 0 : session.optLong("lastVerified"));
        result.put("offline", offline);
        result.put("apiKeyConfigured", !BuildConfig.DRIVE_API_KEY.isEmpty());
        result.put("anonymousSource", BuildConfig.DRIVE_API_KEY.isEmpty() ? "public-folder-view" : "drive-api");
        result.put("rootFolderId", root());
        result.put("offlinePolicy", "Previously downloaded files only; online authorization and root access are rechecked. Sign-out, account switch or confirmed revocation erases private files.");
        return result;
    }

    @PluginMethod public void initialize(PluginCall call) {
        run(call, () -> {
            loadSession();
            if (session == null) anonymousSession();
            return snapshot();
        });
    }

    @PluginMethod public void connect(PluginCall call) {
        run(call, () -> {
            loadSession();
            String requestedRoot = call.getString("rootFolderId", DEFAULT_ROOT);
            PrivateFiles.driveId(requestedRoot);
            if (!DEFAULT_ROOT.equals(requestedRoot)) {
                throw new Failure("INVALID_INPUT", "This build uses its configured choir root");
            }
            acceptAuthorization(authorize(true), true);
            return snapshot();
        });
    }

    @PluginMethod public void verify(PluginCall call) {
        run(call, () -> { gate(false); return snapshot(); });
    }

    @PluginMethod public void useAnonymous(PluginCall call) {
        run(call, () -> {
            loadSession();
            if (session != null && !anonymous()) clearSession();
            anonymousSession();
            return snapshot();
        });
    }

    @SuppressWarnings("deprecation")
    private String certificateSha1() throws Exception {
        Signature[] signatures = getContext().getPackageManager()
            .getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES).signatures;
        if (signatures == null || signatures.length != 1) {
            throw new Failure("API_KEY_INVALID", "Cannot identify APK signing certificate");
        }
        byte[] digest = MessageDigest.getInstance("SHA-1").digest(signatures[0].toByteArray());
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02X", value & 0xff));
        return result.toString();
    }

    private HttpURLConnection connection(String address) throws Exception {
        URL url = new URL(address);
        if (!"https".equals(url.getProtocol()) ||
            !(url.getHost().equals("www.googleapis.com") || url.getHost().equals("openidconnect.googleapis.com"))) {
            throw new IllegalArgumentException("Untrusted Google endpoint");
        }
        boolean publicRequest = token == null && anonymous();
        if (publicRequest && !url.getHost().equals("www.googleapis.com")) {
            throw new Failure("AUTH_REQUIRED", "Google identity requires authorization");
        }
        if (publicRequest && BuildConfig.DRIVE_API_KEY.isEmpty()) throw new Failure("API_KEY_REQUIRED", "Configure Drive API key and rebuild APK");
        if (token == null && !publicRequest) throw new Failure("AUTH_REQUIRED", "Native authorization is required");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("GET");
        if (publicRequest) {
            connection.setRequestProperty("X-Goog-Api-Key", BuildConfig.DRIVE_API_KEY);
            connection.setRequestProperty("X-Android-Package", getContext().getPackageName());
            connection.setRequestProperty("X-Android-Cert", certificateSha1());
        } else connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        return connection;
    }

    private HttpURLConnection publicConnection(String address) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (!PublicFolder.allowedDownload(url)) throw new Failure("PUBLIC_UNAVAILABLE", "Unrecognized Google public download redirect");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "JankoMuzykant/0.1.2");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new Failure("PUBLIC_UNAVAILABLE", "Google redirect missing destination");
                URL next = new URL(url, location);
                if ("accounts.google.com".equals(next.getHost())) throw new Failure("SIGN_IN_REQUIRED", "This item requires existing Google account access");
                url = next; continue;
            }
            return connection;
        }
        throw new Failure("PUBLIC_UNAVAILABLE", "Too many public download redirects");
    }

    private JSONArray publicListing(String id) throws Exception {
        HttpURLConnection connection = publicConnection("https://drive.google.com/embeddedfolderview?id=" + PrivateFiles.driveId(id));
        try (InputStream input = response(connection); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            copy(input, bytes, TEXT_LIMIT);
            JSONArray entries = new JSONArray();
            for (PublicFolder.Entry entry : PublicFolder.parse(bytes.toString("UTF-8"))) {
                JSONObject value = new JSONObject().put("id", entry.id).put("name", entry.name)
                    .put("mimeType", entry.mime).put("parents", new JSONArray().put(id));
                entries.put(value); publicEntries.put(entry.id, value);
            }
            return entries;
        } catch (PublicFolder.Unavailable error) {
            throw new Failure("PUBLIC_UNAVAILABLE", error.getMessage());
        } finally { connection.disconnect(); }
    }

    private JSONObject publicMember(String id) throws Exception {
        if (id.equals(root())) return new JSONObject().put("id", id).put("mimeType", FOLDER);
        if (publicEntries.containsKey(id)) return publicEntries.get(id);
        ArrayDeque<String> folders = new ArrayDeque<>();
        Set<String> seen = new HashSet<>();
        folders.add(root());
        while (!folders.isEmpty() && seen.size() < 1000) {
            String folder = folders.remove();
            if (!seen.add(folder)) continue;
            JSONArray entries;
            try { entries = publicListing(folder); }
            catch (Failure error) {
                if (folder.equals(root()) || !("SIGN_IN_REQUIRED".equals(error.code) || "PUBLIC_UNAVAILABLE".equals(error.code))) throw error;
                continue;
            }
            for (int index = 0; index < entries.length(); index++) {
                JSONObject item = entries.getJSONObject(index);
                if (id.equals(item.getString("id"))) return item;
                if (FOLDER.equals(item.optString("mimeType"))) folders.add(item.getString("id"));
            }
        }
        throw new Failure("SIGN_IN_REQUIRED", "Item is not visible in the public choir tree; optional sign-in may be required");
    }

    private InputStream response(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            if (anonymous() && token == null) {
                String body = "";
                InputStream error = connection.getErrorStream();
                if (error != null) try (InputStream input = error; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    copy(input, bytes, 65536);
                    body = bytes.toString("UTF-8");
                }
                String code = PublicDrive.errorCode(status, body);
                throw new Failure(code, "Anonymous Drive request failed (HTTP " + status + "). Use setup help or optional sign-in.");
            }
        }
        if (status == 401 || status == 403 || status == 404) {
            throw new Failure("ACCESS_DENIED", "Google account cannot read this Drive item");
        }
        if (status < 200 || status >= 300) {
            String code = AuthErrors.fromDriveStatus(status);
            throw new Failure(code, AuthErrors.message(code) + " (HTTP " + status + ")");
        }
        if (connection.getContentLengthLong() > PrivateFiles.LIMIT) {
            throw new Failure("TOO_LARGE", "File exceeds the 150 MB limit");
        }
        return connection.getInputStream();
    }

    private static long copy(InputStream input, java.io.OutputStream output, long limit) throws Exception {
        byte[] buffer = new byte[32768];
        long total = 0;
        int count;
        long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(3);
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > limit) throw new Failure("TOO_LARGE", "File exceeds the allowed size");
            if (System.nanoTime() > deadline) throw new TimeoutException("Download timed out");
            output.write(buffer, 0, count);
        }
        return total;
    }

    private JSONObject json(String address, int limit) throws Exception {
        HttpURLConnection connection = connection(address);
        try (InputStream input = response(connection); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            copy(input, bytes, limit);
            return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
        } finally { connection.disconnect(); }
    }

    private static String encode(String text) {
        try { return URLEncoder.encode(text, "UTF-8"); }
        catch (java.io.UnsupportedEncodingException impossible) { throw new IllegalStateException(impossible); }
    }

    private static String readUtf8(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            copy(input, bytes, TEXT_LIMIT);
            return bytes.toString("UTF-8");
        }
    }

    private static void replace(File partial, File destination) throws IOException {
        if (!partial.renameTo(destination)) throw new IOException("Cannot replace private file");
    }

    private JSONObject metadata(String id) throws Exception {
        return json("https://www.googleapis.com/drive/v3/files/" + PrivateFiles.driveId(id) +
            "?supportsAllDrives=true&fields=" + encode(FIELDS), TEXT_LIMIT);
    }

    private JSONObject member(String id) throws Exception {
        if (publicHtml()) return publicMember(id);
        JSONObject item = metadata(id);
        if (item.optBoolean("trashed")) throw new Failure("ACCESS_DENIED", "File is in the trash");
        ArrayDeque<String> pending = new ArrayDeque<>();
        Set<String> seen = new HashSet<>();
        pending.add(id);
        while (!pending.isEmpty() && seen.size() < 100) {
            String current = pending.remove();
            if (current.equals(root())) return item;
            if (!seen.add(current)) continue;
            JSONObject ancestor = current.equals(id) ? item : metadata(current);
            JSONArray parents = ancestor.optJSONArray("parents");
            if (parents != null) for (int i = 0; i < parents.length(); i++) pending.add(parents.getString(i));
        }
        throw new Failure("ACCESS_DENIED", "This item is outside the configured choir folder");
    }

    @PluginMethod public void list(PluginCall call) {
        run(call, () -> {
            gate(false);
            String folderId = PrivateFiles.driveId(call.getString("folderId", root()));
            if (!FOLDER.equals(member(folderId).optString("mimeType"))) {
                throw new Failure("INVALID_INPUT", "The requested item is not a folder");
            }
            if (publicHtml()) {
                JSObject result = new JSObject();
                result.put("files", new JSArray(publicListing(folderId).toString()));
                return result;
            }
            String page = call.getString("pageToken", "");
            if (page.length() > 4096) throw new IllegalArgumentException("Invalid pagination token");
            String address = "https://www.googleapis.com/drive/v3/files?spaces=drive&supportsAllDrives=true" +
                "&includeItemsFromAllDrives=true&pageSize=1000&orderBy=folder,name" +
                "&q=" + encode("'" + folderId + "' in parents and trashed = false") +
                "&fields=" + encode("nextPageToken,files(" + FIELDS + ")");
            JSONArray files = new JSONArray();
            int pages = 0;
            do {
                JSONObject data = json(address + (page.isEmpty() ? "" : "&pageToken=" + encode(page)), TEXT_LIMIT);
                JSONArray batch = data.getJSONArray("files");
                for (int i = 0; i < batch.length(); i++) {
                    JSONObject entry = batch.getJSONObject(i);
                    if (entry.has("size")) entry.put("size", entry.getLong("size"));
                    files.put(entry);
                }
                page = data.optString("nextPageToken");
                if (++pages > 100) throw new Failure("TOO_LARGE", "Folder exceeds 100,000 entries");
            } while (!page.isEmpty());
            JSObject result = new JSObject();
            result.put("files", new JSArray(files.toString()));
            return result;
        });
    }

    private JSObject fileResult(File directory, File file, String id, String name, String mime) throws Exception {
        JSObject result = new JSObject();
        result.put("id", id);
        result.put("name", name);
        result.put("mimeType", mime);
        result.put("path", file.getCanonicalPath().substring(directory.getCanonicalPath().length() + 1));
        result.put("url", Uri.fromFile(file).toString());
        if ((name.toLowerCase(java.util.Locale.ROOT).endsWith(".xml") ||
            name.toLowerCase(java.util.Locale.ROOT).endsWith(".musicxml")) && file.length() <= TEXT_LIMIT) {
            result.put("text", readUtf8(file));
        }
        return result;
    }

    @PluginMethod public void download(PluginCall call) {
        run(call, () -> {
            gate(false);
            String id = PrivateFiles.driveId(call.getString("id"));
            JSONObject item = member(id);
            String mime = item.getString("mimeType");
            boolean exportText = "application/vnd.google-apps.document".equals(mime) &&
                "text/plain".equals(call.getString("mime"));
            if (mime.startsWith("application/vnd.google-apps.") && !exportText) {
                throw new Failure("INVALID_INPUT", "Google documents support plain-text export only; shortcuts cannot be downloaded");
            }
            if (item.optLong("size") > PrivateFiles.LIMIT) throw new Failure("TOO_LARGE", "File exceeds 150 MB");
            File directory = accountDir();
            String name = item.getString("name") + (exportText ? ".txt" : "");
            File destination = PrivateFiles.resolve(directory, "downloads/" + id + "-" + PrivateFiles.safeName(name));
            destination.getParentFile().mkdirs();
            File partial = new File(destination.getPath() + ".partial");
            HttpURLConnection connection = publicHtml() ?
                publicConnection(exportText ? "https://docs.google.com/document/d/" + id + "/export?format=txt" :
                    "https://drive.google.com/uc?export=download&id=" + id) :
                connection("https://www.googleapis.com/drive/v3/files/" + id +
                    (exportText ? "/export?mimeType=text%2Fplain" : "?alt=media&supportsAllDrives=true"));
            try {
                if (publicHtml() && connection.getContentType() != null &&
                    connection.getContentType().toLowerCase(java.util.Locale.ROOT).contains("text/html")) {
                    throw new Failure("PUBLIC_UNAVAILABLE", "Google returned a download/permission confirmation page, not the file. Use optional sign-in.");
                }
                try (InputStream input = response(connection); FileOutputStream output = new FileOutputStream(partial)) {
                    copy(input, output, PrivateFiles.LIMIT);
                    output.getFD().sync();
                }
                replace(partial, destination);
                return fileResult(directory, destination, id, name, exportText ? "text/plain" : mime);
            } finally {
                connection.disconnect();
                if (partial.exists()) partial.delete();
            }
        });
    }

    @PluginMethod public void readText(PluginCall call) {
        run(call, () -> {
            requireSavedAccount();
            File file = PrivateFiles.resolve(accountDir(), call.getString("path"));
            if (file.length() > TEXT_LIMIT) throw new Failure("TOO_LARGE", "Text exceeds 12 MB");
            JSObject result = new JSObject();
            result.put("text", readUtf8(file));
            return result;
        });
    }

    @PluginMethod public void readState(PluginCall call) {
        run(call, () -> {
            requireSavedAccount();
            File file = new File(accountDir(), "state.json");
            JSObject result = new JSObject();
            result.put("state", file.exists() ? readUtf8(file) : JSONObject.NULL);
            return result;
        });
    }

    @PluginMethod public void writeState(PluginCall call) {
        run(call, () -> {
            requireSavedAccount();
            String state = call.getString("state");
            if (state == null || state.length() > TEXT_LIMIT) {
                throw new IllegalArgumentException("State must be a JSON string smaller than 12 MB");
            }
            new JSONObject(state);
            File file = new File(accountDir(), "state.json");
            atomicWrite(file, state.getBytes(StandardCharsets.UTF_8));
            return new JSObject();
        });
    }

    private void atomicWrite(File file, byte[] bytes) throws Exception {
        file.getParentFile().mkdirs();
        File partial = new File(file.getPath() + ".partial");
        try {
            try (FileOutputStream stream = new FileOutputStream(partial)) {
                stream.write(bytes);
                stream.getFD().sync();
            }
            replace(partial, file);
        } finally { if (partial.exists()) partial.delete(); }
    }

    private void save(PluginCall call, String category) {
        run(call, () -> {
            requireSavedAccount();
            String encoded = call.getString("base64");
            if (encoded == null || encoded.length() > (PrivateFiles.LIMIT * 4 / 3 + 8)) {
                throw new IllegalArgumentException("Base64 audio is missing or exceeds 150 MB");
            }
            byte[] data = Base64.decode(encoded, Base64.DEFAULT);
            if (data.length > PrivateFiles.LIMIT) throw new Failure("TOO_LARGE", "Audio exceeds 150 MB");
            String name = PrivateFiles.safeName(call.getString("name", "audio.wav"));
            File directory = accountDir();
            String id = UUID.randomUUID().toString();
            File file = PrivateFiles.resolve(directory, category + "/" + id + "-" + name);
            atomicWrite(file, data);
            return fileResult(directory, file, id, name, "audio/wav");
        });
    }

    @PluginMethod public void saveGenerated(PluginCall call) { save(call, "generated"); }
    @PluginMethod public void saveRecording(PluginCall call) { save(call, "recordings"); }

    @PluginMethod public void importXml(PluginCall call) {
        run(call, () -> {
            requireSavedAccount();
            getActivity().runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                        "application/xml", "text/xml", "application/vnd.recordare.musicxml+xml",
                        "application/vnd.recordare.musicxml", "application/zip", "application/octet-stream" });
                startActivityForResult(call, intent, "xmlSelected");
            });
            return null;
        });
    }

    @ActivityCallback private void xmlSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        run(call, () -> {
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                throw new Failure("CANCELLED", "XML import cancelled");
            }
            requireSavedAccount();
            Uri uri = result.getData().getData();
            if (uri == null || !"content".equals(uri.getScheme())) throw new IllegalArgumentException("Invalid document");
            String name = "score.musicxml";
            try (Cursor cursor = getContext().getContentResolver().query(uri,
                new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            }
            if (!PrivateFiles.musicXmlName(name)) {
                throw new IllegalArgumentException("Choose XML, MusicXML or compressed MXL");
            }
            File directory = accountDir();
            String id = "local-" + UUID.randomUUID().toString();
            File destination = PrivateFiles.resolve(directory, "imports/" + id + "-" + PrivateFiles.safeName(name));
            destination.getParentFile().mkdirs();
            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                FileOutputStream output = new FileOutputStream(destination)) {
                if (input == null) throw new IOException("Cannot read selected document");
                copy(input, output, TEXT_LIMIT);
            } catch (Exception error) { destination.delete(); throw error; }
            return fileResult(directory, destination, id, name, name.toLowerCase(java.util.Locale.ROOT).endsWith(".mxl")
                ? "application/vnd.recordare.musicxml" : "application/vnd.recordare.musicxml+xml");
        });
    }

    @PluginMethod public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) microphoneResult(call);
        else requestPermissionForAlias("microphone", call, "microphoneResult");
    }

    @PermissionCallback private void microphoneResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod public void signOut(PluginCall call) {
        run(call, () -> {
            clearSession();
            anonymousSession();
            return snapshot();
        });
    }

    @Override protected void handleOnDestroy() {
        token = null;
        worker.shutdownNow();
        super.handleOnDestroy();
    }
}
