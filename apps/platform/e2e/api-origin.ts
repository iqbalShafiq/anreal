import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The single source of truth for which API origin the e2e suite talks to.
 *
 * Before this module the Playwright `webServer.url` probe hardcoded :3001 while
 * `globalSetup` defaulted to :4312, so the two disagreed on any checkout whose
 * root `.env` sets `PORT` to anything but 3001 — the suite timed out before a
 * single test ran. Both now resolve through here, so they cannot drift.
 *
 * Precedence:
 *   1. `E2E_API_ORIGIN` — explicit full origin (kept for CI overrides)
 *   2. `E2E_API_PORT`   — explicit port
 *   3. `PORT` from the process environment
 *   4. `PORT` from the repo-root `.env` — what the dev stack will actually bind
 *   5. 3001 — the documented default
 */

const ROOT_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));

/** Read one key from the repo-root .env without loading the whole file. */
function readRootEnvPort(): string | null {
  if (!existsSync(ROOT_ENV)) return null;
  for (const line of readFileSync(ROOT_ENV, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    if (trimmed.slice(0, equals).trim() !== "PORT") continue;
    const value = trimmed.slice(equals + 1).trim().replace(/^["']|["']$/g, "");
    return value.length > 0 ? value : null;
  }
  return null;
}

export function resolveApiPort(): string {
  const explicit = process.env.E2E_API_PORT?.trim();
  if (explicit) return explicit;
  const fromProcess = process.env.PORT?.trim();
  if (fromProcess) return fromProcess;
  return readRootEnvPort() ?? "3001";
}

export function resolveApiOrigin(): string {
  const origin = process.env.E2E_API_ORIGIN?.trim();
  if (origin) return origin.replace(/\/+$/, "");
  return `http://localhost:${resolveApiPort()}`;
}
