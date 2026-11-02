package com.jankomuzykant.app;

final class AuthErrors {
    private AuthErrors() {}

    // Values are Google Play services CommonStatusCodes, kept literal for JVM unit tests.
    static String fromGoogleStatus(int status) {
        switch (status) {
            case 4: case 6: return "AUTH_REQUIRED";
            case 16: return "CANCELLED";
            case 7: case 15: return "NETWORK_ERROR";
            case 10: return "AUTH_CONFIG_ERROR";
            default: return "AUTH_SERVICE_ERROR";
        }
    }

    static String fromDriveStatus(int status) {
        if (status == 401 || status == 403 || status == 404) return "ACCESS_DENIED";
        if (status == 408 || status == 429 || status >= 500) return "SERVICE_UNAVAILABLE";
        return "DRIVE_ERROR";
    }

    static String missingResult(int activityResult) {
        // RESULT_CANCELED alone does not prove the user deliberately cancelled.
        return activityResult == 0 ? "AUTH_INTERRUPTED" : "AUTH_RESULT_MISSING";
    }

    static boolean erasesAccount(String code) {
        return "ACCESS_DENIED".equals(code) || "AUTH_REQUIRED".equals(code) ||
            "AUTH_PERMISSION_DENIED".equals(code);
    }

    static String message(String code) {
        switch (code) {
            case "AUTH_REQUIRED": return "Google authorization is no longer available; reconnect";
            case "NETWORK_ERROR": return "No network connection";
            case "CANCELLED": return "Google authorization was cancelled";
            case "AUTH_CONFIG_ERROR": return "Android OAuth client/package/SHA-1 is not configured correctly";
            case "AUTH_INTERRUPTED": return "Google returned no authorization result. The flow was closed or interrupted; cancellation or configuration/device failure cannot be distinguished. Check Android OAuth registration, consent test users and Google Play Services.";
            case "AUTH_RESULT_MISSING": return "Google returned no authorization payload. Check Google Play Services and Android OAuth configuration.";
            case "AUTH_PERMISSION_DENIED": return "Grant read-only Drive permission in Google consent";
            case "ACCESS_DENIED": return "Google account cannot read this Drive item";
            case "SERVICE_UNAVAILABLE": return "Google service is temporarily unavailable; retry later";
            default: return "Google service returned an error; retry later";
        }
    }
}
