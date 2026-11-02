package com.jankomuzykant.app;

final class AuthorizationCompletion {
    interface Parser<T, R> { R parse(T data) throws Exception; }
    static final class MissingResult extends Exception {
        final String code;
        MissingResult(int resultCode) {
            super(AuthErrors.message(AuthErrors.missingResult(resultCode)) +
                " (Android result " + resultCode + ")");
            code = AuthErrors.missingResult(resultCode);
        }
    }

    static <T, R> R read(int resultCode, T data, Parser<T, R> parser) throws Exception {
        if (data == null) throw new MissingResult(resultCode);
        // RESULT_CANCELED may carry Google's actual failure status.
        return parser.parse(data);
    }

    private AuthorizationCompletion() {}
}
