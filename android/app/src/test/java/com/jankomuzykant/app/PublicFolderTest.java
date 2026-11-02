package com.jankomuzykant.app;

import static org.junit.Assert.*;
import java.net.URL;
import org.junit.Test;

public class PublicFolderTest {
    @Test public void recognizesOnlyTheKnownGoogleFolderView() throws Exception {
        String html = "<div class='flip-entries'><div class='flip-entry'><a href='https://drive.google.com/drive/folders/event_123'>" +
            "<div class='flip-entry-title'>Koncert &amp; próba</div></a></div>" +
            "<div class='flip-entry'><a href='https://drive.google.com/file/d/pdf_123/view'>" +
            "<div class='flip-entry-title'>Nuty.pdf</div></a></div></div>";
        assertEquals(2, PublicFolder.parse(html).size());
        assertEquals("Koncert & próba", PublicFolder.parse(html).get(0).name);
        assertEquals(PublicFolder.FOLDER, PublicFolder.parse(html).get(0).mime);
        assertEquals("application/pdf", PublicFolder.parse(html).get(1).mime);
        assertTrue(PublicFolder.parse("<div class='flip-entries'></div>").isEmpty());
    }

    @Test public void rejectsChangedHtmlLoginAndUntrustedEntryLinks() {
        for (String html : new String[] {
            "<html>Sign in</html>", "<div class='flip-entries'><div class='flip-entry'>Changed</div></div>",
            "<div class='flip-entries'><form action='https://accounts.google.com/login'></form></div>",
            "<div class='flip-entries'><div class='flip-entry'><a href='https://evil.example/d/id'><div class='flip-entry-title'>File</div></a></div></div>"
        }) {
            try { PublicFolder.parse(html); fail("Do not silently accept unknown HTML"); }
            catch (Exception expected) { assertTrue(expected instanceof PublicFolder.Unavailable); }
        }
    }

    @Test public void onlyFollowsHttpsGoogleDownloadHosts() throws Exception {
        assertTrue(PublicFolder.allowedDownload(new URL("https://drive.usercontent.google.com/download?id=abc")));
        assertTrue(PublicFolder.allowedDownload(new URL("https://download.googleusercontent.com/file")));
        for (String address : new String[] {"https://accounts.google.com/login", "http://drive.google.com/file",
            "https://googleusercontent.com.evil.example/file", "https://drive.google.com:8080/file",
            "https://user:secret@drive.google.com/file", "file:///data/private"}) {
            assertFalse(address, PublicFolder.allowedDownload(new URL(address)));
        }
    }

    @Test public void separatesBadKeyQuotaAndNonpublicFile() {
        assertEquals("API_KEY_INVALID", PublicDrive.errorCode(403, "API_KEY_ANDROID_APP_BLOCKED"));
        assertEquals("API_KEY_INVALID", PublicDrive.errorCode(400, "API key not valid"));
        assertEquals("SERVICE_UNAVAILABLE", PublicDrive.errorCode(403, "rateLimitExceeded"));
        assertEquals("SERVICE_UNAVAILABLE", PublicDrive.errorCode(503, ""));
        assertEquals("SIGN_IN_REQUIRED", PublicDrive.errorCode(404, ""));
    }
}
