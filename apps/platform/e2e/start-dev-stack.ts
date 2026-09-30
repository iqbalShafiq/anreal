import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cross-platform replacement for the Playwright `webServer.command`.
 *
 * The previous command was a POSIX shell line —
 *   `node e2e/stub-openrouter.ts & OPENAI_BASE_URL=… pnpm --dir ../.. dev`
 * Playwright spawns `cmd.exe /d /s /c` on Windows, where a `VAR=value cmd`
 * prefix is not valid syntax, so the dev stack never started and the suite
 * timed out before the first test. This script does the same work with
 * portable process spawning.
 *
 * It starts the local LLM stub, then the monorepo dev stack (API + worker +
 * platform) pointed at that stub. Either child exiting tears the other down so
 * Playwright never waits on a half-dead stack.
 *
 * Run directly by Node, so it must not gain relative imports without a `.ts`
 * extension.
 */

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = resolve(E2E_DIR, "..");
const REPO_ROOT = resolve(PLATFORM_DIR, "../..");

/** Must match `STUB_PORT` in stub-openrouter.ts. */
const STUB_PORT = "18765";
const STUB_BASE_URL = `http://127.0.0.1:${STUB_PORT}/api/v1`;

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  process.exit(code);
}

/** Quote for a shell command line without pulling in a dependency. */
function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function start(commandLine: string, cwd: string, env: NodeJS.ProcessEnv): void {
  // A single command string with `shell: true` — passing an args array
  // alongside `shell: true` is deprecated (and does not escape arguments).
  // The shell is required on Windows so `pnpm` resolves to `pnpm.cmd`.
  const child = spawn(commandLine, {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
  });
  child.on("exit", (code) => shutdown(code ?? 0));
  child.on("error", (error) => {
    console.error(`[e2e] failed to start: ${commandLine} — ${String(error)}`);
    shutdown(1);
  });
  children.push(child);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0));
}

// The stub comes up first so the dev stack's first provider call lands on it,
// and so globalSetup's reachability probe has something to hit.
start(`node ${quote(resolve(PLATFORM_DIR, "e2e/stub-openrouter.ts"))}`, PLATFORM_DIR, process.env);

start(`pnpm --dir ${quote(REPO_ROOT)} dev`, REPO_ROOT, {
  ...process.env,
  // Real credentials and endpoints are overwritten so the stack can never
  // reach a real provider, even if the shell exported its own keys.
  OPENAI_BASE_URL: STUB_BASE_URL,
  OPENAI_API_KEY: "e2e-key",
  TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? "dummy",
  SITE_ENABLED: process.env.SITE_ENABLED ?? "false",
});
