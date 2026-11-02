package com.jankomuzykant.app;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class PrivateFiles {
    static final long LIMIT = 150L * 1024 * 1024;

    static String accountKey(String id) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (byte b : digest) key.append(String.format("%02x", b & 255));
        return key.toString();
    }

    static String driveId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{1,200}")) {
            throw new IllegalArgumentException("Invalid Drive ID");
        }
        return value;
    }

    static String safeName(String value) {
        if (value == null || value.trim().isEmpty()) return "file";
        String name = value.replaceAll("[^\\p{L}\\p{N}._ -]", "_");
        return name.substring(0, Math.min(120, name.length()));
    }

    static boolean musicXmlName(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        return lower.endsWith(".xml") || lower.endsWith(".musicxml") || lower.endsWith(".mxl");
    }

    static File resolve(File root, String path) throws IOException {
        if (path == null || path.trim().isEmpty() || new File(path).isAbsolute()) {
            throw new IllegalArgumentException("An account-relative path is required");
        }
        File result = new File(root, path).getCanonicalFile();
        if (!result.getPath().startsWith(root.getCanonicalPath() + File.separator)) {
            throw new IllegalArgumentException("Path escapes account storage");
        }
        return result;
    }

    static void delete(File file) throws IOException {
        if (!file.exists()) return;
        if (file.isDirectory()) {
            File[] files = file.listFiles();
            if (files == null) throw new IOException("Cannot inspect private directory");
            for (File child : files) delete(child);
        }
        if (!file.delete()) throw new IOException("Cannot erase private data");
    }
}
