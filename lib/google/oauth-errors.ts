export type GoogleOAuthErrorCode =
    | "internal_error"
    | "secure_storage_unavailable";

function errorText(error: unknown): string {
    if (!error || typeof error !== "object") return String(error || "");
    const candidate = error as {
        message?: unknown;
        details?: unknown;
        code?: unknown;
    };
    return [
        candidate.message,
        candidate.details,
        candidate.code,
    ].filter((value) => value !== undefined && value !== null).join(" ");
}

export function isSettingsSecureStorageError(error: unknown): boolean {
    const text = errorText(error).toLowerCase();
    return text.includes("cloudkms")
        || text.includes("crypto key")
        || text.includes("cryptokey")
        || text.includes("gcp_kms_key_path")
        || text.includes("settings encryption")
        || text.includes("settings kms");
}

export function classifyGoogleOAuthError(error: unknown): GoogleOAuthErrorCode {
    return isSettingsSecureStorageError(error)
        ? "secure_storage_unavailable"
        : "internal_error";
}
