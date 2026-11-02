package com.jankomuzykant.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.File;

public class PrivateFilesTest {
    @Test public void stablePrivateAccountKeys() throws Exception {
        assertEquals(64, PrivateFiles.accountKey("google-sub").length());
        assertEquals(PrivateFiles.accountKey("google-sub"), PrivateFiles.accountKey("google-sub"));
        assertNotEquals(PrivateFiles.accountKey("account1"), PrivateFiles.accountKey("account2"));
    }

    @Test public void safeDriveIds() {
        assertEquals("a_Z-12", PrivateFiles.driveId("a_Z-12"));
        for (String id : new String[] { "", "../escape", "x' or true", "https://example.com", "a?alt=media" }) {
            try { PrivateFiles.driveId(id); fail(id); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void traversalCannotEscapeAccount() throws Exception {
        File root = new File("build/private-test-account").getCanonicalFile();
        assertEquals(new File(root, "downloads/score.xml"), PrivateFiles.resolve(root, "downloads/score.xml"));
        for (String path : new String[] { "../other/state.json", root.getAbsolutePath(), "" }) {
            try { PrivateFiles.resolve(root, path); fail(path); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void namesCannotCreatePaths() {
        assertEquals(".._.._score.xml", PrivateFiles.safeName("../../score.xml"));
        assertEquals("file", PrivateFiles.safeName(""));
        assertTrue(PrivateFiles.safeName("a".repeat(300)).length() <= 120);
    }

    @Test public void musicXmlImportIncludesCompressedMxl() {
        for (String name : new String[] { "score.xml", "score.MusicXML", "Piechota.MXL" }) {
            assertTrue(name, PrivateFiles.musicXmlName(name));
        }
        for (String name : new String[] { "score.zip", "score.pdf", "score.mxl.exe", "" }) {
            assertFalse(name, PrivateFiles.musicXmlName(name));
        }
        assertFalse(PrivateFiles.musicXmlName(null));
    }
}
