import type { JsonObject } from "@anvia/core";
import {
  REASONING_EFFORT_CONTROL_ID,
  defineCompletionModelControls,
  type CompletionModelControls,
  type ModelContextLimits,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import {
  ANTHROPIC_REASONING_EFFORTS,
  AnthropicClient,
} from "@anvia/anthropic";
import { GEMINI_REASONING_EFFORTS, GeminiClient } from "@anvia/gemini";
import { GROK_REASONING_EFFORTS, GrokClient } from "@anvia/grok";
import { MistralClient } from "@anvia/mistral";
import { OPENAI_REASONING_EFFORTS, OpenAIClient } from "@anvia/openai";

export const PROVIDER_KINDS = [
  "openai",
  "anthropic",
  "gemini",
  "grok",
  "mistral",
  "compatible",
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

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
const EFFORT_VOCABULARY: readonly string[] = [
  ...new Set<string>([
    ...OPENAI_REASONING_EFFORTS,
    ...ANTHROPIC_REASONING_EFFORTS,
    ...GEMINI_REASONING_EFFORTS,
    ...GROK_REASONING_EFFORTS,
  ]),
];

export function effortVocabulary(): readonly string[] {
  return EFFORT_VOCABULARY;
}

export type ProviderCredentials = {
  apiKey: string;
  baseUrl?: string | null;
  headers?: Record<string, string> | null;
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

function managedClientOptions(credentials: ProviderCredentials) {
  return {
    apiKey: credentials.apiKey,
    ...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}),
    ...(credentials.headers ? { headers: credentials.headers } : {}),
  };
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
      return new OpenAIClient(managedClientOptions(credentials)).completionModel(
        {
          modelId: upstreamId,
          api: target.api ?? PROVIDER_KIND_META[kind].defaultApi ?? "responses",
          ...(contextLimits ? { contextLimits } : {}),
          ...explicitControls(efforts),
        },
      );
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
