package com.jankomuzykant.app;

import java.net.URL;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

final class PublicFolder {
    static final String FOLDER = "application/vnd.google-apps.folder";
    static final class Entry {
        final String id, name, mime;
        Entry(String id, String name, String mime) { this.id = id; this.name = name; this.mime = mime; }
    }
    static final class Unavailable extends Exception {
        Unavailable(String message) { super(message); }
    }
    static List<Entry> parse(String html) throws Exception {
        Document document = Jsoup.parse(html);
        if (document.selectFirst(".flip-entries") == null ||
            document.selectFirst("form[action*=accounts.google]") != null) {
            throw new Unavailable("Google public folder view unavailable or changed; optional sign-in/API access required");
        }
        List<Entry> result = new ArrayList<>();
        Pattern idPattern = Pattern.compile("/(?:folders|d)/([A-Za-z0-9_-]+)");
        for (Element entry : document.select(".flip-entry")) {
            Element anchor = entry.selectFirst("a[href]"), title = entry.selectFirst(".flip-entry-title");
            if (anchor == null || title == null) throw new Unavailable("Public folder entry format changed");
            URL link = new URL(anchor.attr("href"));
            if (!"https".equals(link.getProtocol()) ||
                !("drive.google.com".equals(link.getHost()) || "docs.google.com".equals(link.getHost()))) {
                throw new Unavailable("Unrecognized public entry link");
            }
            Matcher match = idPattern.matcher(link.getPath());
            if (!match.find()) throw new Unavailable("Public entry has no recognized Drive identifier");
            String name = title.text();
            String mime = link.getPath().contains("/folders/") ? FOLDER :
                link.getHost().equals("docs.google.com") ? "application/vnd.google-apps.document" :
                name.toLowerCase(java.util.Locale.ROOT).endsWith(".mxl") ? "application/vnd.recordare.musicxml" :
                name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(xml|musicxml)$") ? "application/xml" :
                URLConnection.guessContentTypeFromName(name);
            result.add(new Entry(PrivateFiles.driveId(match.group(1)), name,
                mime == null ? "application/octet-stream" : mime));
        }
        return result;
    }

    static boolean allowedDownload(URL url) {
        String host = url.getHost();
        return "https".equals(url.getProtocol()) && (url.getPort() == -1 || url.getPort() == 443) &&
            url.getUserInfo() == null && (host.equals("drive.google.com") ||
            host.equals("drive.usercontent.google.com") || host.equals("docs.google.com") ||
            host.endsWith(".googleusercontent.com"));
    }
    private PublicFolder() {}
}
