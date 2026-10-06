import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ENVELOPE_VERSION = 1;

export type CredentialsCipher = {
  resolveKey(): Buffer;
  encrypt(plaintext: string): string;
  decrypt(ref: string): string;
};

export type CredentialsCipherOptions = {
  /** Environment variable holding the 32-byte key as 64 hex characters. */
  keyEnv: string;
  /** Inserted into user-facing messages, e.g. "MCP" or "provider". */
  subject: string;
  /** Prefix for the one-time dev warning, e.g. "mcp" or "providers". */
  logTag: string;
};

type Envelope = {
  v: number;
  iv: string;
  tag: string;
  data: string;
};

/**
 * Build an AES-256-GCM credential cipher. Production fails closed without an
 * explicit key; dev/test fall back to an ephemeral key (stored credentials do
 * not survive restarts) with a one-time warning.
 */
export function createCredentialsCipher(
  options: CredentialsCipherOptions,
): CredentialsCipher {
  const { keyEnv, subject, logTag } = options;
  let devKey: Buffer | null = null;
  let devWarned = false;

  function productionKeyRequired(): Error {
    return new Error(
      `${keyEnv} is required in production to store ${subject} credentials`,
    );
  }

  // Fail at creation, not first use: a process that cannot store credentials
  // must not accept a request and fail later with a credential it can never
  // decrypt. Dev/test still fall back to an ephemeral key at first use.
  if (!process.env[keyEnv]?.trim() && process.env.NODE_ENV === "production") {
    throw productionKeyRequired();
  }

  function resolveKey(): Buffer {
    const raw = process.env[keyEnv]?.trim();
    if (raw) {
      const key = Buffer.from(raw, "hex");
      if (key.length === 32) return key;
      throw new Error(
        `${keyEnv} must be 32 bytes as 64 hex characters (generate with: openssl rand -hex 32)`,
      );
    }
    if (process.env.NODE_ENV === "production") {
      throw productionKeyRequired();
    }
    devKey ??= randomBytes(32);
    if (!devWarned) {
      devWarned = true;
      console.warn(
        `[${logTag}] ${keyEnv} is not set — using an ephemeral key; stored ${subject} credentials will not survive restarts`,
      );
    }
    return devKey;
  }

  function encrypt(plaintext: string): string {
    const key = resolveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const envelope: Envelope = {
      v: ENVELOPE_VERSION,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
  }

  function decrypt(ref: string): string {
    const key = resolveKey();
    let envelope: Envelope;
    try {
      envelope = JSON.parse(
        Buffer.from(ref, "base64").toString("utf8"),
      ) as Envelope;
    } catch {
      throw new Error(`${subject} credential reference is invalid`);
    }
    if (
      !envelope ||
      envelope.v !== ENVELOPE_VERSION ||
      typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.data !== "string"
    ) {
      throw new Error(`${subject} credential reference is invalid`);
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      throw new Error(
        `${subject} credential failed to decrypt — wrong key or tampered data`,
      );
    }
  }

  return { resolveKey, encrypt, decrypt };
}
