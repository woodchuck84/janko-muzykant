package com.jankomuzykant.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class AuthErrorsTest {
    @Test public void onlyConfirmedDenialErasesAccount() {
        assertTrue(AuthErrors.erasesAccount(AuthErrors.fromDriveStatus(403)));
        assertTrue(AuthErrors.erasesAccount(AuthErrors.fromGoogleStatus(4)));
        for (String code : new String[] {
            AuthErrors.fromDriveStatus(429), AuthErrors.fromDriveStatus(500), AuthErrors.fromDriveStatus(400),
            AuthErrors.fromGoogleStatus(7), AuthErrors.fromGoogleStatus(8), AuthErrors.fromGoogleStatus(16), AuthErrors.fromGoogleStatus(10),
            "TOO_LARGE", "NETWORK_ERROR"
        }) assertFalse(code, AuthErrors.erasesAccount(code));
    }

    @Test public void separatesServiceAndConfigurationFailures() {
        assertEquals("SERVICE_UNAVAILABLE", AuthErrors.fromDriveStatus(503));
        assertEquals("NETWORK_ERROR", AuthErrors.fromGoogleStatus(15));
        assertEquals("AUTH_CONFIG_ERROR", AuthErrors.fromGoogleStatus(10));
        assertEquals("AUTH_SERVICE_ERROR", AuthErrors.fromGoogleStatus(8));
    }

    @Test public void emptyAndroidResultIsNotProofOfUserCancellation() {
        assertEquals("AUTH_INTERRUPTED", AuthErrors.missingResult(0));
        assertEquals("AUTH_RESULT_MISSING", AuthErrors.missingResult(-1));
        assertEquals("AUTH_RESULT_MISSING", AuthErrors.missingResult(1));
        assertEquals("CANCELLED", AuthErrors.fromGoogleStatus(16));
        assertFalse(AuthErrors.erasesAccount(AuthErrors.missingResult(0)));
        assertTrue(AuthErrors.erasesAccount("AUTH_PERMISSION_DENIED"));
    }
}
