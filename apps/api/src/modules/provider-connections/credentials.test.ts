import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderCredentialUnreadableError,
  decodeProviderCredentials,
  encodeProviderCredentials,
  sanitizeHeaders,
} from "./credentials.js";
import { resolveConnectionHeaders } from "./dynamic-headers.js";

describe("provider credentials", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", "b".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips an api key and headers", () => {
    const ref = encodeProviderCredentials({
      apiKey: "sk-live-123",
      headers: { "X-Workspace": "acme" },
    });
    expect(ref).not.toContain("sk-live-123");
    expect(decodeProviderCredentials(ref)).toEqual({
      apiKey: "sk-live-123",
      headers: { "X-Workspace": "acme" },
    });
  });

  it("normalises a missing header map to null", () => {
    const ref = encodeProviderCredentials({ apiKey: "sk-live-123" });
    expect(decodeProviderCredentials(ref).headers).toBeNull();
  });

  it("rejects a non-record header payload", () => {
    expect(sanitizeHeaders(["nope"]).ok).toBe(false);
    expect(sanitizeHeaders("nope").ok).toBe(false);
    expect(sanitizeHeaders(7).ok).toBe(false);
  });

  it("rejects a reserved authorization header", () => {
    const result = sanitizeHeaders({ authorization: "Bearer x" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/authorization/i);
  });

  it("rejects an over-long header name and value", () => {
    expect(sanitizeHeaders({ ["n".repeat(129)]: "v" }).ok).toBe(false);
    expect(sanitizeHeaders({ "X-Long": "v".repeat(2049) }).ok).toBe(false);
  });

  it("rejects more than sixteen headers", () => {
    const headers = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [`X-H${i}`, "v"]),
    );
    expect(sanitizeHeaders(headers).ok).toBe(false);
  });

  it("returns null for an empty header map", () => {
    const result = sanitizeHeaders({});
    expect(result).toEqual({ ok: true, headers: null });
  });

  it("trims header names and values", () => {
    const result = sanitizeHeaders({ "  X-Trim  ": "  value  " });
    expect(result).toEqual({ ok: true, headers: { "X-Trim": "value" } });
  });

  it("throws the coded error when the reference cannot be decrypted", () => {
    // Encrypted under a different key, so decryption fails the same way a
    // rotated PROVIDER_CREDENTIALS_KEY would.
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", "c".repeat(64));
    const foreignRef = encodeProviderCredentials({ apiKey: "sk-stale" });
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", "b".repeat(64));

    let caught: unknown;
    try {
      decodeProviderCredentials(foreignRef);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderCredentialUnreadableError);
    expect((caught as { code?: string }).code).toBe(
      "PROVIDER_CREDENTIAL_UNREADABLE",
    );
  });

  it("carries a credential-free, actionable message", () => {
    const error = new ProviderCredentialUnreadableError();
    expect(error.message).toContain("Re-enter it in Settings → Providers");
    // Never leaks material or internals.
    expect(error.message).not.toMatch(/sk-/);
    expect(error.message).not.toMatch(/^\[|at \w|\{\{/);
  });

  it("accepts a dynamic header source", () => {
    const result = sanitizeHeaders({ "x-opencode-session": { dynamic: "sessionId" } });
    expect(result).toEqual({
      ok: true,
      headers: { "x-opencode-session": { dynamic: "sessionId" } },
    });
  });

  it("accepts literals and dynamic sources in one map", () => {
    const result = sanitizeHeaders({
      "x-tenant": "acme",
      "x-session": { dynamic: "sessionId" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a dynamic source outside the allowlist at save time", () => {
    const result = sanitizeHeaders({ "x-bad": { dynamic: "apiKey" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/sessionId/);
  });

  it("still rejects an authorization header", () => {
    const result = sanitizeHeaders({ Authorization: "Bearer x" });
    expect(result.ok).toBe(false);
  });

  it("rejects a dynamic authorization header too", () => {
    // The name checks must run before the dynamic branch, or a reserved name
    // could be smuggled in through the new shape.
    const result = sanitizeHeaders({ Authorization: { dynamic: "sessionId" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/authorization/i);
  });

  it("round-trips dynamic headers through the encrypted envelope", () => {
    const ref = encodeProviderCredentials({
      apiKey: "sk-live",
      headers: { "x-opencode-session": { dynamic: "sessionId" } },
    });
    expect(decodeProviderCredentials(ref).headers).toEqual({
      "x-opencode-session": { dynamic: "sessionId" },
    });
  });

  it("decodes a legacy envelope whose headers are plain strings", () => {
    // Written before dynamic values existed: the reader must not need a migration,
    // because the envelope is ciphertext and no SQL migration is possible.
    const ref = encodeProviderCredentials({
      apiKey: "sk-legacy",
      headers: { "x-tenant": "acme" },
    });
    const decoded = decodeProviderCredentials(ref);
    expect(decoded.headers).toEqual({ "x-tenant": "acme" });
    expect(resolveConnectionHeaders(decoded.headers, {
      sessionId: "s_1",
      userId: "u_1",
      requestId: "r_1",
    })).toEqual({ "x-tenant": "acme" });
  });
});
