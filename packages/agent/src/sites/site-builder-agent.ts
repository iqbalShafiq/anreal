import type { Agent, AnyTool, CompletionModel, MemoryStore, Message } from "@anvia/core";
import type { MemoryScope } from "@anvia/core/memory";
import { createAgent } from "../agent.js";
import type { SiteBrief } from "./site-plan.js";

export const SITE_BUILDER_MAX_TURNS = 30;

export const SITE_BUILDER_INSTRUCTIONS = [
  "You build static websites inside a sandboxed workspace rooted at /workspace/site.",
  "File tool paths are relative to the sandbox workspace root (/workspace): read and write the scaffold under site/ (for example site/src/App.tsx), never with a leading /workspace prefix. Run commands with cwd site.",
  "The scaffold builds with Vite: site/src/main.tsx mounts site/src/App.tsx and imports one stylesheet. Keep every style reachable from that import (extend site/src/tokens.css or import your own stylesheet from main.tsx) — CSS that nothing imports never ships, and an unstyled page is a failed build.",
  "Never modify package.json, tsconfig.json, or vite.config.ts; write only site content (src/, index.html, tokens.css).",
  "Work section by section in the order given. One tool-call batch per section.",
  "Write real copy from the brief. Never emit lorem ipsum or placeholder text.",
  "Design one coherent page: every section shares the same tokens (fonts, colors, spacing) and every element carries real styling — no bare sections, no default-looking link lists, no half-styled rebuilds. Prefer classes over inline styles.",
  "Static output only: HTML, CSS, and client JS. No backend, no database, no secrets, no network calls at runtime.",
  "Only use these commands: npm, npx, node. Never run shells, curl, wget, or ssh.",
  "A version is done only when the production build verifies clean:",
  "1. Run `npm run build` from site/. Fix every error and rebuild until it exits 0.",
  "2. List site/dist/assets and confirm a stylesheet was emitted, then search it for class names your page actually uses (for example `grep -o \"hero\" dist/assets/*.css`).",
  "3. If the stylesheet is missing or lacks your classes, the styles are not reachable from the main.tsx import — fix the import chain (or move the styles into the imported file), rebuild, and verify again.",
  "Only after that verification passes, stop with one short paragraph describing what was built.",
].join("\n");

export function buildSiteBuilderPrompt(brief: SiteBrief, request?: string): string {
  const sections = brief.sections.map((section, index) => `${index + 1}. ${section}`).join("\n");
  return [
    `Site name: ${brief.siteName}`,
    `Audience: ${brief.audience}`,
    `Primary call to action: ${brief.cta}`,
    `Design vibe: ${brief.vibe}`,
    "Sections to build in order:",
    sections,
    ...(request
      ? [
          "",
          `The user asked (verbatim): ${request}`,
          "Treat that request as the goal for this build; the brief above is the plan derived from it.",
        ]
      : []),
    "",
    "Definition of done: each section styled with the shared tokens, then `npm run build` exits clean and the emitted dist stylesheet contains the page's classes (verify as instructed).",
    "Start with section 1. After each section, continue with the next until all are done, then run the production build and the stylesheet check.",
  ].join("\n");
}

export function createSiteBuilderAgent(input: {
  model?: CompletionModel;
  tools: AnyTool[];
  maxTurns?: number;
  memory?: MemoryStore;
}): Agent {
  return createAgent({
    agentId: "site-builder",
    ...(input.model ? { model: input.model } : {}),
    additionalInstructions: [SITE_BUILDER_INSTRUCTIONS],
    additionalTools: input.tools,
    maxTurns: input.maxTurns ?? SITE_BUILDER_MAX_TURNS,
    // One-shot builds stream with a chat session id, which requires a memory
    // store. Builds are stateless across versions, so an ephemeral
    // process-local store is enough (no durability needed).
    memory: input.memory ?? createEphemeralMemoryStore(),
  });
}

/** Process-local append-only store for one-shot agents without durability needs. */
export function createEphemeralMemoryStore(): MemoryStore {
  const messagesByScope = new Map<string, Message[]>();
  const scopeKey = (scope: MemoryScope): string =>
    `${scope.sessionId}::${scope.userId ?? ""}`;
  return {
    async load({ scope }) {
      return messagesByScope.get(scopeKey(scope)) ?? [];
    },
    async append({ scope, messages }) {
      const key = scopeKey(scope);
      messagesByScope.set(key, [...(messagesByScope.get(key) ?? []), ...messages]);
    },
    async clear({ scope }) {
      messagesByScope.delete(scopeKey(scope));
    },
    async recordError() {},
  };
}
