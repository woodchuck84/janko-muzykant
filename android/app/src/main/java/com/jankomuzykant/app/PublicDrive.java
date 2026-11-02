package com.jankomuzykant.app;

final class PublicDrive {
    static final String ACCOUNT_ID = "anonymous-choir";

    static String errorCode(int status, String body) {
        if (body.contains("API_KEY_") || body.contains("keyInvalid") ||
            body.contains("accessNotConfigured") || body.contains("SERVICE_DISABLED") ||
            body.contains("ipRefererBlocked") || body.contains("API key not valid")) return "API_KEY_INVALID";
        if (status == 429 || status == 408 || status >= 500 ||
            body.contains("rateLimitExceeded") || body.contains("dailyLimitExceeded") ||
            body.contains("userRateLimitExceeded") || body.contains("quotaExceeded")) return "SERVICE_UNAVAILABLE";
        if (status == 401 || status == 403 || status == 404) return "SIGN_IN_REQUIRED";
        return "DRIVE_ERROR";
    }

    private PublicDrive() {}
}
