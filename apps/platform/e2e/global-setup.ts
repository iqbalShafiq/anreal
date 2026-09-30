import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveApiOrigin } from "./api-origin";

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = resolve(E2E_DIR, ".auth");
const STORAGE_STATE_PATH = resolve(AUTH_DIR, "user.json");

const API_ORIGIN = resolveApiOrigin();
const STUB_ORIGIN = "http://127.0.0.1:18765";
const STUB_BASE_URL = `${STUB_ORIGIN}/api/v1`;
const HEALTH_URL = `${API_ORIGIN}/api/auth/get-session`;
const SIGN_UP_URL = `${API_ORIGIN}/api/auth/sign-up/email`;
const SIGN_IN_URL = `${API_ORIGIN}/api/auth/sign-in/email`;

const PASSWORD = "password123";

/**
 * Setup runs against a dev server that has only just bound its port, and
 * Node's fetch pools keep-alive sockets across the readiness probes above.
 * A reset on a reused socket is a connection-level race, not a real failure,
 * so retry those a few times — but never retry an HTTP status, which is a
 * genuine answer from the API.
 */
async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  attempts = 4,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      const transient =
        code === "ECONNRESET" ||
        code === "ECONNREFUSED" ||
        code === "EPIPE" ||
        (error instanceof TypeError && error.message === "fetch failed");
      if (!transient) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

function assertStubEnv(): void {
  const configured = process.env.OPENAI_BASE_URL;
  if (configured && configured !== STUB_BASE_URL) {
    throw new Error(
      `OPENAI_BASE_URL is set in this shell (${configured}) — the e2e suite must run ` +
        `against the local stub (${STUB_BASE_URL}). Unset it, or export the stub URL.`,
    );
  }
}

async function waitForApi(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithRetry(HEALTH_URL);
      if (response.ok) return;
      lastError = new Error(`health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy within ${timeoutMs}ms: ${String(lastError)}`);
}

async function assertStubReachable(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithRetry(`${STUB_ORIGIN}/__requests`);
      if (response.ok) return;
      lastError = new Error(`stub returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `LLM stub on ${STUB_ORIGIN} is not reachable: ${String(lastError)}. ` +
      `A stale dev stack on the API origin (${API_ORIGIN}) is likely being ` +
      "reused without the stub — kill it so Playwright starts its own.",
  );
}

function sessionCookieFromHeaders(headers: Headers): string | null {
  const setCookies = headers.getSetCookie();
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const equals = pair?.indexOf("=");
    if (!pair || equals === undefined || equals < 0) continue;
    const name = pair.slice(0, equals).trim();
    if (name === "better-auth.session_token") {
      return pair.slice(equals + 1).trim();
    }
  }
  return null;
}

async function signUp(email: string): Promise<string> {
  const response = await fetchWithRetry(SIGN_UP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      name: "E2E User",
      email,
      password: PASSWORD,
    }),
  });
  if (response.ok) {
    const cookie = sessionCookieFromHeaders(response.headers);
    if (cookie) return cookie;
  }
  if (response.status === 422 || response.status === 409) {
    const signIn = await fetchWithRetry(SIGN_IN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (signIn.ok) {
      const cookie = sessionCookieFromHeaders(signIn.headers);
      if (cookie) return cookie;
    }
    throw new Error(`sign-in failed for existing user: ${signIn.status}`);
  }
  throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
}

async function writeStorageState(cookieValue: string): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  const storageState = {
    cookies: [
      {
        name: "better-auth.session_token",
        value: cookieValue,
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
  await writeFile(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2));
}

async function globalSetup(): Promise<void> {
  assertStubEnv();
  await waitForApi();
  await assertStubReachable();
  const email = `e2e-${Date.now()}@test.local`;
  const cookie = await signUp(email);
  await writeStorageState(cookie);
  console.log(`[global-setup] e2e user ready: ${email}`);
}

export default globalSetup;
