import type { StreamingCompletionModel } from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";
import { effortVocabulary } from "./registry.js";

/** Model ids are registered in the DB registry; any non-empty id is structurally valid. */
export type CompletionModelId = string;

export const DEFAULT_COMPLETION_MODEL: CompletionModelId = "openai/gpt-6-luna";
export const DEFAULT_COMPLETION_PROVIDER = "openai";

/** The union of every adapter's declared reasoning vocabulary. */
export const REASONING_EFFORTS = effortVocabulary();
/**
 * The same values as a non-empty tuple, so zod's `z.enum` accepts them without
 * retyping any value. Never empty: every adapter declares at least one effort.
 */
export const REASONING_EFFORT_KEYS = REASONING_EFFORTS as [string, ...string[]];
export type ReasoningEffort = string;
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export function isCompletionModelId(value: unknown): value is CompletionModelId {
  return typeof value === "string" && value.trim().length > 0;
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" && REASONING_EFFORTS.includes(value)
  );
}

export function parseCompletionModel(value: unknown): CompletionModelId | null {
  return isCompletionModelId(value) ? value : null;
}

/** Returns null when value is missing or not in the vocabulary. */
export function parseReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null;
}

let openai: OpenAIClient | null = null;

function getOpenAIClient(): OpenAIClient {
  openai ??= new OpenAIClient({
    apiKey: process.env.OPENAI_API_KEY ?? "",
    ...(process.env.OPENAI_BASE_URL
      ? { baseUrl: process.env.OPENAI_BASE_URL }
      : {}),
  });
  return openai;
}

export function createCompletionModel(
  modelId: CompletionModelId = DEFAULT_COMPLETION_MODEL,
): StreamingCompletionModel {
  // Meta's Muse Spark contributor tier returns encrypted-only reasoning on
  // the Responses API with no reasoning deltas, which the Anvia stream
  // accumulator rejects after the answer text already streamed. Chat
  // Completions carries the same top-level reasoning_effort control and a
  // stream shape this model satisfies (reasoning_details stay inert).
  const api = modelId.startsWith("meta/") ? "chat" : "responses";
  return getOpenAIClient().completionModel({ modelId, api });
}

let defaultModelValue: StreamingCompletionModel | null = null;

export function defaultModel(): StreamingCompletionModel {
  defaultModelValue ??= createCompletionModel(DEFAULT_COMPLETION_MODEL);
  return defaultModelValue;
}
