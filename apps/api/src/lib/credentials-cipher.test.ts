import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCredentialsCipher } from "./credentials-cipher.js";

const KEY_HEX = "a".repeat(64);

function makeCipher() {
  return createCredentialsCipher({
    keyEnv: "PROVIDER_CREDENTIALS_KEY",
    subject: "provider",
    logTag: "providers",
  });
}

describe("credentials cipher", () => {
  beforeEach(() => {
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", KEY_HEX);
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a plaintext secret", () => {
    const cipher = makeCipher();
    const ref = cipher.encrypt("sk-secret-value");
    expect(ref).not.toContain("sk-secret-value");
    expect(cipher.decrypt(ref)).toBe("sk-secret-value");
  });

  it("produces a different envelope for the same plaintext", () => {
    const cipher = makeCipher();
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("rejects a tampered envelope", () => {
    const cipher = makeCipher();
    const ref = cipher.encrypt("sk-secret-value");
    const raw = JSON.parse(Buffer.from(ref, "base64").toString("utf8")) as {
      data: string;
    };
    raw.data = Buffer.from("tampered").toString("base64");
    const tampered = Buffer.from(JSON.stringify(raw), "utf8").toString("base64");
    expect(() => cipher.decrypt(tampered)).toThrow(
      "provider credential failed to decrypt — wrong key or tampered data",
    );
  });

  it("rejects a malformed reference", () => {
    const cipher = makeCipher();
    expect(() => cipher.decrypt("not-base64-json")).toThrow(
      "provider credential reference is invalid",
    );
  });

  it("fails closed in production when the key env is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", "");
    expect(() => makeCipher().resolveKey()).toThrow(
      "PROVIDER_CREDENTIALS_KEY is required in production to store provider credentials",
    );
  });

  it("fails fast at cipher creation in production when the key env is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    // Setting the variable to the empty string models an absent key without
    // deleting it, so restoring the environment afterwards stays trivial.
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", "");

    expect(() => makeCipher()).toThrow(
      "PROVIDER_CREDENTIALS_KEY is required in production to store provider credentials",
    );

    // Restored: the dev/test fallback is available again once the env is sane.
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", KEY_HEX);
    expect(() => makeCipher()).not.toThrow();
  });

  it("rejects a key that is not 32 bytes of hex", () => {
    vi.stubEnv("PROVIDER_CREDENTIALS_KEY", "abcd");
    expect(() => makeCipher().resolveKey()).toThrow(
      "PROVIDER_CREDENTIALS_KEY must be 32 bytes as 64 hex characters (generate with: openssl rand -hex 32)",
    );
  });
});
