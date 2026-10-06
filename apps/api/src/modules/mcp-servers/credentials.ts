import { createCredentialsCipher } from "../../lib/credentials-cipher.js";

/**
 * MCP credentials keep their own env key (`MCP_CREDENTIALS_KEY`) and their
 * historical error strings; the envelope itself is shared with provider
 * connections via lib/credentials-cipher.ts.
 */
const cipher = createCredentialsCipher({
  keyEnv: "MCP_CREDENTIALS_KEY",
  subject: "MCP",
  logTag: "mcp",
});

export const resolveCredentialsKey = cipher.resolveKey;
export const encryptToken = cipher.encrypt;
export const decryptToken = cipher.decrypt;
