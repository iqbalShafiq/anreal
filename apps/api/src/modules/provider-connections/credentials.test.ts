import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeProviderCredentials,
  encodeProviderCredentials,
  sanitizeHeaders,
} from "./credentials.js";

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
});
