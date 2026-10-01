import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const completionModel = vi.fn((options: unknown) => ({
    provider: "stub",
    modelId: (options as { modelId: string }).modelId,
    options,
  }));
  // The native image factories report the id from their own options, so a
  // faithful stub must too — that is the property the factory test pins.
  const imageGenerationModel = vi.fn((options: unknown) => ({
    provider: "stub",
    modelId: (options as { modelId: string }).modelId,
    options,
  }));
  type ClientShape = {
    options?: unknown;
    completionModel: typeof completionModel;
    imageGenerationModel?: typeof imageGenerationModel;
    listModels?: unknown;
  };
  return {
    completionModel,
    imageGenerationModel,
    // A regular function, not an arrow: the registry constructs these clients
    // with `new`, and `new` on an arrow-function mock throws. The return type
    // keeps every member optional except completionModel so per-test
    // `mockImplementationOnce` values stay assignable.
    client: vi.fn(function (this: unknown, options: unknown): ClientShape {
      return { options, completionModel, imageGenerationModel };
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
  createImageGenerationModelFor,
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

  it("hands out a frozen array so a caller cannot change the server vocabulary", () => {
    const vocabulary = effortVocabulary();
    expect(Object.isFrozen(vocabulary)).toBe(true);
    expect(() => (vocabulary as string[]).push("enormous")).toThrow(TypeError);
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

describe("createImageGenerationModelFor", () => {
  const fetchFn = vi.fn(async () => new Response("{}"));

  it("builds the native Gemini model with the id it was given", () => {
    mocks.client.mockClear();
    mocks.imageGenerationModel.mockClear();

    const model = createImageGenerationModelFor({
      kind: "gemini",
      modelId: "gemini-3.1-flash-image",
      apiKey: "AIza-test",
      fetchFn,
    });

    // A BYOK image model is addressed by its stored upstream id, so the
    // constructor must receive it — never a hardcoded default.
    expect(model?.modelId).toBe("gemini-3.1-flash-image");
    // Ruling A: v1 drives Gemini images through `generateContent` only. The
    // `api` field is observable here because the adapter selects its model
    // class from it (dist/index.js:1615).
    expect(mocks.imageGenerationModel).toHaveBeenCalledWith({
      api: "generateContent",
      modelId: "gemini-3.1-flash-image",
    });
  });

  it("builds the native Grok model with the id it was given", () => {
    mocks.client.mockClear();
    mocks.imageGenerationModel.mockClear();

    const model = createImageGenerationModelFor({
      kind: "grok",
      modelId: "grok-imagine-image-quality",
      apiKey: "xai-test",
      fetchFn,
    });

    expect(model?.modelId).toBe("grok-imagine-image-quality");
    expect(mocks.imageGenerationModel).toHaveBeenCalledWith({
      modelId: "grok-imagine-image-quality",
    });
  });

  it("builds an OpenRouter-shaped model with the id it was given", () => {
    const model = createImageGenerationModelFor({
      kind: "compatible",
      modelId: "my-gateway/flux-pro",
      apiKey: "sk-test",
      baseUrl: "https://gw.example/v1",
      fetchFn,
    });

    expect(model?.modelId).toBe("my-gateway/flux-pro");
  });

  it("reaches every native client with a pass-through fetch where the adapter has a seam", () => {
    mocks.client.mockClear();

    createImageGenerationModelFor({
      kind: "grok",
      modelId: "grok-imagine-image",
      apiKey: "xai-test",
      fetchFn,
    });

    // Grok carries the fetch on the client options, which is the only public
    // seam it exposes (GrokClientOptions.fetch, dist/index.d.ts:22).
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "xai-test", fetch: fetchFn }),
    );
  });

  it("throws a clear error when a compatible endpoint has no base URL", () => {
    expect(() =>
      createImageGenerationModelFor({
        kind: "compatible",
        modelId: "my-gateway/flux-pro",
        apiKey: "sk-test",
        fetchFn,
      }),
    ).toThrow(/base ?url/i);
  });

  it("returns null, and never throws, for kinds with no image endpoint", () => {
    for (const kind of ["openai", "anthropic", "mistral"] as const) {
      expect(
        createImageGenerationModelFor({
          kind,
          modelId: "some-model",
          apiKey: "sk-test",
          fetchFn,
        }),
      ).toBeNull();
    }
  });

  it("injects the fetch into the OpenRouter-shaped instance", async () => {
    const seenFetch = vi.fn(async () => new Response("{}"));
    const model = createImageGenerationModelFor({
      kind: "compatible",
      modelId: "my-gateway/flux-pro",
      apiKey: "sk-test",
      baseUrl: "https://gw.example/v1",
      fetchFn: seenFetch,
    });

    // Drive the instance: if the injected fetch reached it, our fake sees the
    // call and no real network is touched.
    await expect(
      model?.imageGeneration({ prompt: "a cat", width: 512, height: 512 }),
    ).rejects.toThrow(/no usable images/i);
    expect(seenFetch).toHaveBeenCalledWith(
      "https://gw.example/v1/images",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards connection headers to the OpenRouter-shaped instance on the wire", async () => {
    const seenFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    const model = createImageGenerationModelFor({
      kind: "compatible",
      modelId: "my-gateway/flux-pro",
      apiKey: "sk-test",
      baseUrl: "https://gw.example/v1",
      headers: { "X-Api-Key": "secret-header" },
      fetchFn: seenFetch,
    });

    await expect(
      model?.imageGeneration({ prompt: "a cat", width: 512, height: 512 }),
    ).rejects.toThrow(/no usable images/i);
    expect(
      (seenFetch.mock.calls[0]![1] as RequestInit).headers,
    ).toMatchObject({
      Authorization: "Bearer sk-test",
      "X-Api-Key": "secret-header",
    });
  });

  it("forwards connection headers to the Grok client, whose image path uses the same SDK", () => {
    mocks.client.mockClear();

    createImageGenerationModelFor({
      kind: "grok",
      modelId: "grok-imagine-image",
      apiKey: "xai-test",
      headers: { "X-Api-Key": "secret-header" },
      fetchFn,
    });

    // GrokManagedClientOptions declares `headers` (dist/index.d.ts:21) and the
    // client passes them to the OpenAI SDK as `defaultHeaders`
    // (dist/index.js:545-551), which `imageGenerationModel` reuses via
    // `this.sdk` (dist/index.js:576).
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { "X-Api-Key": "secret-header" } }),
    );
  });

  it("never invents a header seam for Gemini, whose client options cannot express one", () => {
    mocks.client.mockClear();

    createImageGenerationModelFor({
      kind: "gemini",
      modelId: "gemini-3.1-flash-image",
      apiKey: "AIza-test",
      headers: { "X-Api-Key": "secret-header" },
      fetchFn,
    });

    // GeminiApiClientOptions is `{ apiKey, vertexAi?: never, client?: never }`
    // (dist/index.d.ts:36-40): there is no headers field, so passing one would
    // be an option the adapter silently ignores.
    const options = mocks.client.mock.calls[0]![0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("headers");
    expect(options).toEqual({ apiKey: "AIza-test" });
  });

  it("omits headers entirely when the connection has none", async () => {
    mocks.client.mockClear();
    const seenFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );

    const model = createImageGenerationModelFor({
      kind: "compatible",
      modelId: "my-gateway/flux-pro",
      apiKey: "sk-test",
      baseUrl: "https://gw.example/v1",
      fetchFn: seenFetch,
    });

    await expect(
      model?.imageGeneration({ prompt: "a cat", width: 512, height: 512 }),
    ).rejects.toThrow(/no usable images/i);
    expect((seenFetch.mock.calls[0]![1] as RequestInit).headers).toEqual({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });

    createImageGenerationModelFor({
      kind: "grok",
      modelId: "grok-imagine-image",
      apiKey: "xai-test",
      fetchFn,
    });
    expect(mocks.client).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ headers: expect.anything() }),
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
