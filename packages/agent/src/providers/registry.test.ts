import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const completionModel = vi.fn((options: unknown) => ({
    provider: "stub",
    modelId: (options as { modelId: string }).modelId,
    options,
  }));
  type ClientShape = {
    options?: unknown;
    completionModel: typeof completionModel;
    listModels?: unknown;
  };
  return {
    completionModel,
    // A regular function, not an arrow: the registry constructs these clients
    // with `new`, and `new` on an arrow-function mock throws. The return type
    // keeps every member optional except completionModel so per-test
    // `mockImplementationOnce` values stay assignable.
    client: vi.fn(function (this: unknown, options: unknown): ClientShape {
      return { options, completionModel };
    }),
  };
});

vi.mock("@anvia/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anvia/openai")>();
  return { ...actual, OpenAIClient: mocks.client };
});
vi.mock("@anvia/anthropic", () => ({
  AnthropicClient: mocks.client,
  ANTHROPIC_REASONING_EFFORTS: ["low", "medium", "high", "xhigh", "max"],
}));
vi.mock("@anvia/gemini", () => ({
  GeminiClient: mocks.client,
  GEMINI_REASONING_EFFORTS: ["minimal", "low", "medium", "high"],
}));
vi.mock("@anvia/grok", () => ({
  GrokClient: mocks.client,
  GROK_REASONING_EFFORTS: ["none", "low", "medium", "high", "xhigh"],
}));
vi.mock("@anvia/mistral", () => ({ MistralClient: mocks.client }));

import {
  createCompletionModelFor,
  effortVocabulary,
  PROVIDER_KIND_META,
  PROVIDER_KINDS,
} from "./registry.js";

describe("provider kind metadata", () => {
  it("reserves image support for the kinds that actually have an image endpoint", () => {
    expect(PROVIDER_KIND_META.compatible.imageStyle).toBe("openrouter-images");
    expect(PROVIDER_KIND_META.gemini.imageStyle).toBe("gemini-native");
    expect(PROVIDER_KIND_META.grok.imageStyle).toBe("grok-native");
    expect(PROVIDER_KIND_META.openai.imageStyle).toBe("none");
    expect(PROVIDER_KIND_META.anthropic.imageStyle).toBe("none");
    expect(PROVIDER_KIND_META.mistral.imageStyle).toBe("none");
  });

  it("requires a base URL only for compatible endpoints", () => {
    expect(PROVIDER_KIND_META.compatible.requiresBaseUrl).toBe(true);
    for (const kind of PROVIDER_KINDS.filter((k) => k !== "compatible")) {
      expect(PROVIDER_KIND_META[kind].requiresBaseUrl).toBe(false);
    }
  });

  it("declares api variants only where the adapter accepts an api option", () => {
    expect(PROVIDER_KIND_META.mistral.apiVariants).toEqual([]);
    expect(PROVIDER_KIND_META.anthropic.apiVariants).toEqual([]);
    expect(PROVIDER_KIND_META.gemini.apiVariants).toEqual([]);
    expect(PROVIDER_KIND_META.openai.apiVariants).toContain("responses");
  });
});

describe("effortVocabulary", () => {
  it("unions every adapter vocabulary, including none", () => {
    expect(effortVocabulary()).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
});

describe("createCompletionModelFor", () => {
  it("passes the api default for openai and forwards credentials", () => {
    mocks.completionModel.mockClear();
    mocks.client.mockClear();

    createCompletionModelFor({
      kind: "openai",
      upstreamId: "gpt-5.6-luna",
      credentials: { apiKey: "sk-test" },
    });

    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test" }),
    );
    expect(mocks.completionModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gpt-5.6-luna", api: "responses" }),
    );
  });

  it("sends an explicit controls set so unknown ids still validate effort", () => {
    mocks.completionModel.mockClear();

    createCompletionModelFor({
      kind: "compatible",
      upstreamId: "my-gateway/some-new-model",
      credentials: { apiKey: "sk-test", baseUrl: "https://gw.example/v1" },
      reasoningEfforts: ["low", "high"],
    });

    const options = mocks.completionModel.mock.calls[0]?.[0] as {
      controls?: { reasoningEffort?: { options: readonly string[] } };
    };
    expect(options.controls?.reasoningEffort?.options).toEqual(["low", "high"]);
  });

  it("omits controls when the model has no reasoning efforts", () => {
    mocks.completionModel.mockClear();

    createCompletionModelFor({
      kind: "mistral",
      upstreamId: "mistral-large-latest",
      credentials: { apiKey: "sk-test" },
      reasoningEfforts: [],
    });

    const options = mocks.completionModel.mock.calls[0]?.[0] as {
      controls?: unknown;
    };
    expect(options.controls).toBeUndefined();
  });

  it("never sends controls to the Mistral adapter, which has no control option", () => {
    mocks.completionModel.mockClear();

    createCompletionModelFor({
      kind: "mistral",
      upstreamId: "mistral-large-latest",
      credentials: { apiKey: "sk-test" },
      contextLimits: { contextWindow: 128_000 },
      reasoningEfforts: ["low", "high"],
    });

    const options = mocks.completionModel.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("controls");
    expect(options).toHaveProperty("contextLimits");
  });

  it("forwards explicit context limits for adapter-unknown ids", () => {
    mocks.completionModel.mockClear();

    createCompletionModelFor({
      kind: "anthropic",
      upstreamId: "claude-custom",
      credentials: { apiKey: "sk-test" },
      contextLimits: { contextWindow: 200_000, maxOutputTokens: 8_192 },
    });

    expect(mocks.completionModel).toHaveBeenCalledWith(
      expect.objectContaining({
        contextLimits: { contextWindow: 200_000, maxOutputTokens: 8_192 },
      }),
    );
  });

  it("defaults compatible endpoints to the chat api", () => {
    mocks.completionModel.mockClear();

    createCompletionModelFor({
      kind: "compatible",
      upstreamId: "x",
      credentials: { apiKey: "sk-test", baseUrl: "https://gw.example/v1" },
    });

    expect(mocks.completionModel).toHaveBeenCalledWith(
      expect.objectContaining({ api: "chat" }),
    );
  });

  it("honours an explicit api override", () => {
    mocks.completionModel.mockClear();

    createCompletionModelFor({
      kind: "openai",
      upstreamId: "gpt-5.6-luna",
      api: "chat",
      credentials: { apiKey: "sk-test" },
    });

    expect(mocks.completionModel).toHaveBeenCalledWith(
      expect.objectContaining({ api: "chat" }),
    );
  });

  it("passes custom headers through to the client", () => {
    mocks.client.mockClear();

    createCompletionModelFor({
      kind: "openai",
      upstreamId: "gpt-5.6-luna",
      credentials: {
        apiKey: "sk-test",
        headers: { "X-Workspace": "acme" },
      },
    });

    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { "X-Workspace": "acme" } }),
    );
  });
});

import {
  listProviderModels,
  redactProviderError,
} from "./registry.js";

describe("listProviderModels", () => {
  it("lists through the matching adapter client", async () => {
    mocks.client.mockClear();
    const listModels = vi.fn(async () => ({
      data: [{ id: "gpt-5.6-luna", name: "GPT 5.6 Luna", contextLength: 1_000_000 }],
    }));
    mocks.client.mockImplementationOnce(function (this: unknown) {
      return {
        completionModel: mocks.completionModel,
        listModels,
      };
    });

    const result = await listProviderModels({
      kind: "compatible",
      credentials: { apiKey: "sk-test", baseUrl: "https://gw.example/v1" },
    });

    expect(listModels).toHaveBeenCalledOnce();
    expect(result.data[0]).toMatchObject({ id: "gpt-5.6-luna", contextLength: 1_000_000 });
  });
});

describe("redactProviderError", () => {
  it("hides api-shaped keys", () => {
    const message = redactProviderError(
      new Error("401 Unauthorized for key sk-live-abcdef1234567890"),
    );
    expect(message).not.toContain("sk-live-abcdef1234567890");
    expect(message).toContain("[REDACTED]");
  });

  it("hides bearer tokens", () => {
    const message = redactProviderError(
      new Error("bad header Authorization: Bearer abcdef1234567890"),
    );
    expect(message).not.toContain("abcdef1234567890");
  });

  it("hides the exact connection secret passed in", () => {
    const message = redactProviderError(
      new Error("upstream rejected sec-verysekret123"),
      ["sec-verysekret123"],
    );
    expect(message).not.toContain("sec-verysekret123");
  });

  it("bounds the message length", () => {
    const message = redactProviderError(new Error("x".repeat(5_000)));
    expect(message.length).toBeLessThanOrEqual(160);
  });

  it("handles non-Error values", () => {
    expect(redactProviderError("plain failure")).toBe("plain failure");
  });
});
