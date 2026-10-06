import type { JsonObject } from "@anvia/core";
import {
  REASONING_EFFORT_CONTROL_ID,
  defineCompletionModelControls,
  type CompletionModelControls,
  type ModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { ImageGenerationModel } from "@anvia/core/image-generation";
import {
  ANTHROPIC_REASONING_EFFORTS,
  AnthropicClient,
} from "@anvia/anthropic";
import {
  GEMINI_REASONING_EFFORTS,
  GeminiClient,
  IMAGEN_4_GENERATE,
} from "@anvia/gemini";
import { GROK_REASONING_EFFORTS, GrokClient } from "@anvia/grok";
import { MistralClient } from "@anvia/mistral";
import { OPENAI_REASONING_EFFORTS, OpenAIClient } from "@anvia/openai";
import OpenAI from "openai";

import { OpenRouterImageGenerationModel } from "./image-generation.js";
import { normalizeFetch } from "./usage-normalization.js";

export const PROVIDER_KINDS = [
  "openai",
  "anthropic",
  "gemini",
  "grok",
  "mistral",
  "compatible",
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Re-exported so consumers depend on this package, not on @anvia/core directly. */
export type { ModelContextLimits } from "@anvia/core/completion";
export type { StreamingCompletionModel } from "@anvia/core/completion";

/**
 * The one Imagen id `@anvia/gemini` exposes as a **runtime value** (the rest of
 * its image-id families are type-only). This app drives Gemini images through
 * `generateContent` only, so an Imagen id routed there is a wrong-shaped
 * request; the save path uses this constant to reject that one id (§ ruling A).
 * Re-exported through this package so `apps/api` can guard it without adding a
 * direct dependency on `@anvia/gemini`.
 */
export { IMAGEN_4_GENERATE };

/**
 * Which image endpoint shape a kind speaks. Image generation is not one axis:
 * OpenRouter-shaped gateways use POST /images, Gemini and Grok have native
 * factories, and OpenAI's native images API has neither the same parameters
 * nor `input_references`, so it is deliberately excluded.
 */
export type ImageStyle =
  | "openrouter-images"
  | "gemini-native"
  | "grok-native"
  | "none";

export type ProviderKindMeta = {
  label: string;
  credentialPlaceholder: string;
  supportsBaseUrl: boolean;
  requiresBaseUrl: boolean;
  apiVariants: readonly ("chat" | "responses")[];
  defaultApi: "chat" | "responses" | null;
  imageStyle: ImageStyle;
};

export const PROVIDER_KIND_META: Record<ProviderKind, ProviderKindMeta> = {
  openai: {
    label: "OpenAI",
    credentialPlaceholder: "sk-...",
    supportsBaseUrl: true,
    requiresBaseUrl: false,
    apiVariants: ["responses", "chat"],
    defaultApi: "responses",
    imageStyle: "none",
  },
  anthropic: {
    label: "Anthropic",
    credentialPlaceholder: "sk-ant-...",
    supportsBaseUrl: true,
    requiresBaseUrl: false,
    apiVariants: [],
    defaultApi: null,
    imageStyle: "none",
  },
  gemini: {
    label: "Google Gemini",
    credentialPlaceholder: "AIza...",
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    apiVariants: [],
    defaultApi: null,
    imageStyle: "gemini-native",
  },
  grok: {
    label: "xAI Grok",
    credentialPlaceholder: "xai-...",
    supportsBaseUrl: true,
    requiresBaseUrl: false,
    apiVariants: ["responses", "chat"],
    defaultApi: "responses",
    imageStyle: "grok-native",
  },
  mistral: {
    label: "Mistral",
    credentialPlaceholder: "...",
    supportsBaseUrl: true,
    requiresBaseUrl: false,
    apiVariants: [],
    defaultApi: null,
    imageStyle: "none",
  },
  compatible: {
    label: "OpenAI-compatible",
    credentialPlaceholder: "sk-...",
    supportsBaseUrl: true,
    requiresBaseUrl: true,
    apiVariants: ["chat", "responses"],
    defaultApi: "chat",
    imageStyle: "openrouter-images",
  },
};

/**
 * The union of every adapter's declared reasoning vocabulary. Adapters own
 * their values; this module never retypes them as literals.
 */
const EFFORT_VOCABULARY: readonly string[] = Object.freeze([
  ...new Set<string>([
    ...OPENAI_REASONING_EFFORTS,
    ...ANTHROPIC_REASONING_EFFORTS,
    ...GEMINI_REASONING_EFFORTS,
    ...GROK_REASONING_EFFORTS,
  ]),
]);

export function effortVocabulary(): readonly string[] {
  return EFFORT_VOCABULARY;
}

/**
 * A stored connection header value: a literal, or a dynamic reference the
 * caller resolves before it builds a model. The dynamic vocabulary belongs to
 * the caller; this package only needs to know a value may still be unresolved,
 * so it fails loudly rather than serialising the reference into a header.
 */
export type ProviderHeaderValue = string | { dynamic: string };

export type ProviderCredentials = {
  apiKey: string;
  baseUrl?: string | null;
  headers?: Record<string, ProviderHeaderValue> | null;
};

export type CompletionTarget = {
  kind: ProviderKind;
  upstreamId: string;
  api?: "chat" | "responses" | null;
  credentials: ProviderCredentials;
  /** Required for ids the adapter has no limits-table entry for. */
  contextLimits?: ModelContextLimits | null;
  /** `[]` or null builds a model with no reasoning control at all. */
  reasoningEfforts?: readonly string[] | null;
};

/**
 * Connection headers as the concrete strings the client options carry. A
 * caller resolves dynamic references before it builds a model; one that reaches
 * this package unresolved is a wiring bug, so it fails loudly — naming only the
 * header — instead of letting an object become a header value.
 */
function literalHeaders(
  headers: Record<string, ProviderHeaderValue>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      throw new Error(
        `provider header "${name}" holds an unresolved dynamic reference`,
      );
    }
    out[name] = value;
  }
  return out;
}

function managedClientOptions(credentials: ProviderCredentials) {
  return {
    apiKey: credentials.apiKey,
    ...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}),
    ...(credentials.headers
      ? { headers: literalHeaders(credentials.headers) }
      : {}),
  };
}

/**
 * Build the injected SDK client for a BYOK OpenAI-shaped connection. The
 * normalizing `fetch` is required because the OpenCode Go gateway attaches
 * `usage` to every chunk of a chat-completions stream; `@anvia/openai` maps
 * each usage-bearing chunk to a `final` event and rejects the second one as
 * an invalid tool call, failing every run after the answer has streamed.
 * `usage-normalization.ts` carries the full non-conformance and the rewrite
 * rules.
 *
 * Only this path gets the rewrite. The catalog/env path
 * (`createCompletionModel` in `providers/openai.ts`) keeps the managed client:
 * conformant providers must not pay for the workaround. Every semantic event
 * is preserved; when the rewrite does change bytes, the only difference
 * beyond the intended usage strip or synthetic insert is around the
 * sentinel's trailing blank line.
 */
function byokOpenAIClient(credentials: ProviderCredentials): OpenAI {
  const headers = credentials.headers
    ? literalHeaders(credentials.headers)
    : undefined;
  return new OpenAI({
    apiKey: credentials.apiKey,
    ...(credentials.baseUrl ? { baseURL: credentials.baseUrl } : {}),
    ...(headers ? { defaultHeaders: headers } : {}),
    fetch: normalizeFetch(globalThis.fetch),
    maxRetries: 0,
  });
}

/** Extract the limits and reasoning metadata an adapter publishes for a model. */
export type ModelDescription = {
  provider: string;
  modelId: string;
  capabilities: Record<string, unknown> | null;
  contextLimits: ModelContextLimits | null;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
};

export function describeModel(
  model: StreamingCompletionModel,
): ModelDescription {
  const control = model.controls?.[REASONING_EFFORT_CONTROL_ID];
  return {
    provider: model.provider,
    modelId: model.modelId,
    capabilities:
      (model.capabilities as unknown as Record<string, unknown> | undefined) ??
      null,
    contextLimits: model.contextLimits ?? null,
    reasoningEfforts: control ? [...control.options] : [],
    defaultReasoningEffort: control?.defaultValue ?? null,
  };
}

export function createCompletionModelFor(
  target: CompletionTarget,
): StreamingCompletionModel {
  const { kind, upstreamId, credentials } = target;
  const contextLimits = target.contextLimits ?? undefined;
  const efforts = target.reasoningEfforts ?? [];

  switch (kind) {
    case "mistral": {
      // The Mistral adapter exposes no `controls` option; passing one would
      // be a type error and a silent no-op.
      return new MistralClient(managedClientOptions(credentials)).completionModel(
        {
          modelId: upstreamId,
          ...(contextLimits ? { contextLimits } : {}),
        },
      );
    }
    case "gemini": {
      return new GeminiClient({
        apiKey: credentials.apiKey,
      }).completionModel({
        modelId: upstreamId,
        ...(contextLimits ? { contextLimits } : {}),
        ...explicitControls(efforts),
      });
    }
    case "anthropic": {
      return new AnthropicClient(
        managedClientOptions(credentials),
      ).completionModel({
        modelId: upstreamId,
        ...(contextLimits ? { contextLimits } : {}),
        ...explicitControls(efforts),
      });
    }
    case "grok": {
      return new GrokClient(managedClientOptions(credentials)).completionModel({
        modelId: upstreamId,
        api: target.api ?? PROVIDER_KIND_META.grok.defaultApi ?? "responses",
        ...(contextLimits ? { contextLimits } : {}),
        ...explicitControls(efforts),
      });
    }
    case "openai":
    case "compatible":
    default: {
      // Injected-client path so the BYOK stream passes through the usage
      // normalization; see `byokOpenAIClient`.
      return new OpenAIClient({
        client: byokOpenAIClient(credentials),
      }).completionModel({
        modelId: upstreamId,
        api: target.api ?? PROVIDER_KIND_META[kind].defaultApi ?? "responses",
        ...(contextLimits ? { contextLimits } : {}),
        ...explicitControls(efforts),
      });
    }
  }
}

export type ImageTarget = {
  kind: ProviderKind;
  /** The stored upstream id — a BYOK model is addressed by this, never by slug. */
  modelId: string;
  apiKey: string;
  baseUrl?: string | null;
  /**
   * Connection headers for a gateway that authenticates beyond the key. Only
   * the kinds whose client options declare a `headers` field receive them —
   * see the per-kind notes in `createImageGenerationModelFor`.
   */
  headers?: Record<string, ProviderHeaderValue> | null;
  /** Injected for tests and for callers that proxy requests. */
  fetchFn?: typeof fetch;
};

/**
 * Build the image-generation model a BYOK target names, dispatched on the
 * kind's declared `imageStyle` — never on the kind name, so
 * `PROVIDER_KIND_META` stays the single source of truth.
 *
 * Returns `null` exactly when the kind has no image endpoint (`imageStyle:
 * "none"`), which is the caller's signal to fall back or report unavailable.
 *
 * The resolved target's id is authoritative for every kind: the native
 * adapters take the model id as a constructor/function parameter and overwrite
 * any per-request `model` (Grok dist/index.js:144-153, Gemini
 * dist/index.js:1613-1615), and the OpenRouter-shaped adapter is given the same
 * id as its `defaultModel`. The tool's per-request `model` override therefore
 * remains an OpenRouter-only capability (Design ruling 2).
 *
 * Only the OpenRouter-shaped and Grok adapters expose a public `fetch` seam, so
 * the injected `fetchFn` reaches those two. `@anvia/gemini` accepts only
 * `{ apiKey }` on its managed client path — it builds the Google SDK itself and
 * exposes no fetch option — so a Gemini test drives the adapter through a
 * stubbed `GeminiClient` rather than an injected fetch.
 */
export function createImageGenerationModelFor(
  target: ImageTarget,
): ImageGenerationModel<unknown> | null {
  const { kind, modelId, apiKey, baseUrl, headers, fetchFn } = target;

  switch (PROVIDER_KIND_META[kind].imageStyle) {
    case "openrouter-images": {
      // The only kind that cannot reach a provider without an address; the
      // metadata says so, so the error is derived from it rather than assumed.
      if (!baseUrl) {
        throw new Error(
          `The ${kind} provider requires a base URL for image generation.`,
        );
      }
      return new OpenRouterImageGenerationModel({
        apiKey,
        baseUrl,
        defaultModel: modelId,
        ...(headers ? { headers: literalHeaders(headers) } : {}),
        ...(fetchFn ? { fetchFn } : {}),
      });
    }
    case "gemini-native": {
      // Ruling A: v1 drives Gemini images through `generateContent` only. That
      // is the family whose request the normaliser models
      // (`config.imageConfig.aspectRatio`); `generateImages` (Imagen) has a
      // different contract, so routing an Imagen id here would be a wrong
      // request rather than a degraded one.
      //
      // The one known Imagen constant, `IMAGEN_4_GENERATE`, **is** guarded: it
      // is a runtime value re-exported by this package, and the save path
      // (`apps/api` → `validateModelInput`) rejects it for a `gemini` kind with
      // a field-level message. The rest of the Imagen family is type-only with
      // no runtime value, so the full family could not be guarded; an
      // unlisted Imagen id that is registered still reaches this branch and is
      // sent through `generateContent` as a wrong request rather than failing
      // early.
      //
      // NO HEADER SEAM: `GeminiApiClientOptions` is
      // `{ apiKey; vertexAi?: never; client?: never }` (dist/index.d.ts:36-40),
      // with no `headers`/`httpOptions`, and the client builds the Google SDK
      // itself. Passing `headers` here would be an option the adapter silently
      // ignores, so it is deliberately dropped rather than forwarded.
      return new GeminiClient({ apiKey }).imageGenerationModel({
        api: "generateContent",
        modelId,
      });
    }
    case "grok-native": {
      // Grok carries the fetch on the client options, which is the seam its
      // image model reads (GrokClientOptions.fetch → this.fetchFn →
      // GrokImageGenerationModel, dist/index.js:552-576). It also declares
      // `headers` (GrokManagedClientOptions, dist/index.d.ts:18-25), which the
      // client passes to the OpenAI SDK as `defaultHeaders`
      // (dist/index.js:545-551) — and `imageGenerationModel` reuses that same
      // `this.sdk` (dist/index.js:576), so the headers reach image requests.
      return new GrokClient({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(headers ? { headers: literalHeaders(headers) } : {}),
        ...(fetchFn ? { fetch: fetchFn } : {}),
      }).imageGenerationModel({ modelId });
    }
    // No image endpoint: the caller has already decided not to build a model,
    // so return `null` rather than throwing in a path that should be
    // unreachable.
    case "none":
      return null;
    default: {
      const exhaustive: never = PROVIDER_KIND_META[kind].imageStyle;
      return exhaustive;
    }
  }
}

/**
 * Build an explicit control set so an adapter-unknown model id still gets its
 * reasoning effort validated before the provider call.
 */
function explicitControls(
  efforts: readonly string[],
): { controls?: CompletionModelControls } {
  if (efforts.length === 0) return {};
  return {
    controls: defineCompletionModelControls({
      [REASONING_EFFORT_CONTROL_ID]: {
        type: "select" as const,
        label: "Reasoning effort",
        description:
          "Controls how much reasoning the model applies before responding.",
        options: [...efforts],
      },
    }),
  };
}

/** Provider options for the memory compactor, which has no `controls` seam. */
export function compactorProviderOptionsFor(
  kind: ProviderKind,
  api: "chat" | "responses" | null | undefined,
  effort: string,
): JsonObject | undefined {
  if (kind !== "openai" && kind !== "compatible" && kind !== "grok") {
    return undefined;
  }
  const effectiveApi = api ?? PROVIDER_KIND_META[kind].defaultApi ?? null;
  if (effectiveApi === "responses") {
    return { reasoning: { effort, summary: "auto" } };
  }
  if (effectiveApi === "chat") {
    return { reasoning_effort: effort };
  }
  return undefined;
}

/**
 * OpenAI-Responses-shaped models only return reasoning summaries when the
 * request asks for them. The field has no normalized Anvia option, so it is a
 * provider option — and every other adapter rejects it, which is why the kind
 * and api are required here rather than guessed.
 */
export function responsesReasoningSummaryOptions(
  kind: ProviderKind,
  api: "chat" | "responses" | null | undefined,
): JsonObject | undefined {
  if (kind !== "openai" && kind !== "compatible" && kind !== "grok") {
    return undefined;
  }
  const effectiveApi = api ?? PROVIDER_KIND_META[kind].defaultApi ?? null;
  return effectiveApi === "responses"
    ? { reasoning: { summary: "auto" } }
    : undefined;
}

import type { ModelList } from "@anvia/core/model-listing";
import { createRedactor } from "@anvia/core/redaction";

export async function listProviderModels(target: {
  kind: ProviderKind;
  credentials: ProviderCredentials;
}): Promise<ModelList> {
  const { kind, credentials } = target;
  switch (kind) {
    case "mistral":
      return new MistralClient(managedClientOptions(credentials)).listModels();
    case "gemini":
      return new GeminiClient({ apiKey: credentials.apiKey }).listModels();
    case "anthropic":
      return new AnthropicClient(
        managedClientOptions(credentials),
      ).listModels();
    case "grok":
      return new GrokClient(managedClientOptions(credentials)).listModels();
    case "openai":
    case "compatible":
    default:
      return new OpenAIClient(managedClientOptions(credentials)).listModels();
  }
}

const REDACTION_PATTERNS = [
  {
    name: "api-key",
    regex: /\b(?:sk|sk-ant|xai|AIza|gsk)[-_A-Za-z0-9]{8,}\b/g,
  },
  {
    name: "bearer",
    regex: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  },
];

const ERROR_MESSAGE_MAX = 160;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn any upstream failure into a short, non-sensitive message. Provider
 * errors are known to echo credentials back, so every path through this
 * function is redacted before it can reach a log, a stream, or the UI.
 */
export function redactProviderError(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const bounded = raw.trim().replace(/\s+/g, " ").slice(0, ERROR_MESSAGE_MAX);
  const extra = secrets
    .map((secret) => secret.trim())
    .filter((secret) => secret.length >= 8)
    .map((secret) => ({
      name: "connection-secret",
      regex: new RegExp(escapeRegExp(secret), "g"),
    }));
  return createRedactor({
    patterns: [...REDACTION_PATTERNS, ...extra],
    replacement: "[REDACTED]",
  }).redactString(bounded);
}
