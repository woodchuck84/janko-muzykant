package com.jankomuzykant.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class AuthorizationCompletionTest {
    @Test public void canceledActivityStillParsesGooglePayload() throws Exception {
        assertEquals("authorized", AuthorizationCompletion.read(0, "payload", data -> "authorized"));
        assertEquals("authorized", AuthorizationCompletion.read(-1, "payload", data -> "authorized"));
    }

    @Test public void googleConfigurationAndCancellationErrorsAreNotMasked() {
        for (int status : new int[] {10, 16, 7, 8}) {
            Exception original = new Exception("Google status " + status);
            try {
                AuthorizationCompletion.read(0, "payload", data -> { throw original; });
                fail("Expected Google's original failure");
            } catch (Exception error) {
                assertSame(original, error);
            }
        }
    }

    @Test public void absentPayloadDoesNotInvokeParserOrClaimUserCancellation() {
        try {
            AuthorizationCompletion.read(0, null, data -> { fail("Must not parse null"); return ""; });
            fail("Expected missing result");
        } catch (Exception error) {
            assertTrue(error instanceof AuthorizationCompletion.MissingResult);
            assertEquals("AUTH_INTERRUPTED", ((AuthorizationCompletion.MissingResult) error).code);
        }
    }
}
