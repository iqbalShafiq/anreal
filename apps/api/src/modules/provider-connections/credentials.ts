import { createCredentialsCipher } from "../../lib/credentials-cipher.js";

export const MAX_CUSTOM_HEADERS = 16;
export const HEADER_NAME_MAX = 128;
export const HEADER_VALUE_MAX = 2048;

export type ProviderCredentials = {
  apiKey: string;
  headers?: Record<string, string> | null;
};

const cipher = createCredentialsCipher({
  keyEnv: "PROVIDER_CREDENTIALS_KEY",
  subject: "provider",
  logTag: "providers",
});

/** Encrypt provider credentials into an opaque storage reference. */
export function encodeProviderCredentials(value: ProviderCredentials): string {
  const headers = value.headers ?? null;
  return cipher.encrypt(JSON.stringify({ apiKey: value.apiKey, headers }));
}

/** Decrypt a storage reference. Throws on tampering, wrong key, or version. */
export function decodeProviderCredentials(ref: string): ProviderCredentials {
  const parsed = JSON.parse(cipher.decrypt(ref)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("provider credential reference is invalid");
  }
  const record = parsed as { apiKey?: unknown; headers?: unknown };
  if (typeof record.apiKey !== "string" || record.apiKey.length === 0) {
    throw new Error("provider credential reference is invalid");
  }
  const headers =
    typeof record.headers === "object" &&
    record.headers !== null &&
    !Array.isArray(record.headers)
      ? (record.headers as Record<string, string>)
      : null;
  return { apiKey: record.apiKey, headers };
}

type SanitizeHeadersResult =
  | { ok: true; headers: Record<string, string> | null }
  | { ok: false; message: string };

/**
 * Validate user-supplied gateway headers. Authorization is reserved: the API
 * key field is the only way to authenticate, so a gateway cannot be tricked
 * into overriding the credential through a header.
 */
export function sanitizeHeaders(value: unknown): SanitizeHeadersResult {
  if (value === undefined || value === null) return { ok: true, headers: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Headers must be a map of name to value" };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_HEADERS) {
    return {
      ok: false,
      message: `At most ${MAX_CUSTOM_HEADERS} headers are allowed`,
    };
  }
  if (entries.length === 0) return { ok: true, headers: null };
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim();
    const headerValue = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!name || name.length > HEADER_NAME_MAX) {
      return {
        ok: false,
        message: `Header names must be 1-${HEADER_NAME_MAX} characters`,
      };
    }
    if (name.toLowerCase() === "authorization") {
      return {
        ok: false,
        message:
          "Do not set an authorization header — enter the API key in the key field instead",
      };
    }
    if (!headerValue || headerValue.length > HEADER_VALUE_MAX) {
      return {
        ok: false,
        message: `Header values must be 1-${HEADER_VALUE_MAX} characters`,
      };
    }
    out[name] = headerValue;
  }
  return { ok: true, headers: out };
}
