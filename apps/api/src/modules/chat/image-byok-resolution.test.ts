import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Phase D wires a BYOK image target into the run without touching the recipe.
 * These tests are the durable pins for that wiring:
 * - no BYOK image model → byte-identical to the shared-key path;
 * - a BYOK model on `compatible` is addressed by its stored `upstreamId`;
 * - a BYOK model on `gemini`/`grok` is addressed by the model instance, whose
 *   constructor is authoritative for those kinds;
 * - a row that has vanished degrades to the shared key instead of throwing;
 * - the user's declared capabilities win for their own id.
 *
 * No test may touch the network. OpenRouter is driven through an injected
 * `fetchFn`; Gemini has no fetch seam (`@anvia/gemini`'s client options are
 * `{ apiKey }` only), so its path asserts the construction the real model
 * reports plus the options the builder produces.
 */

import {
  ARTIFACT_TOOL_DEFINITIONS,
  BASE_INSTRUCTIONS,
  CHART_TOOL_DEFINITIONS,
  CLARIFICATION_TOOL_DEFINITIONS,
  DEEP_RESEARCH_TOOL_DEFINITIONS,
  DERIVED_TOOL_DEFINITIONS,
  DOCUMENT_TOOL_DEFINITIONS,
  IMAGE_GENERATION_TOOL_DEFINITIONS,
  OpenRouterImageGenerationModel,
  PROFILE_TOOL_DEFINITIONS,
  REPORT_TOOL_DEFINITIONS,
  SITE_BUILD_TOOL_DEFINITIONS,
  SITE_VIEW_TOOL_DEFINITIONS,
  TABULAR_TOOL_DEFINITIONS,
  USER_MCP_TOOL_DEFINITIONS,
  USER_SKILL_TOOL_DEFINITIONS,
  WEB_SEARCH_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_DEFINITIONS,
  createImageGenerationTools,
  type ImageCapabilitySet,
} from "@anreal/agent";

import { encodeProviderCredentials } from "../provider-connections/credentials.js";
import {
  CHAT_AGENT_RECIPE_VERSION,
  parseChatAgentRecipe,
  type ChatAgentRecipe,
} from "./run-recipe.js";
import { createNativeStaticContext } from "./memory-policy.js";
import { formatContextSnippetBlock } from "./context-snippets.js";
import { VIEW_IMAGE_TOOL_DEFINITIONS } from "./vision-helper.js";
import {
  buildImageCapabilitySource,
  imageProviderOptionsForKind,
  reconstructChatRunInput,
  resolveRecipeImageTarget,
  resolveChatAgentRecipe,
  selectImageTargetSource,
  selectRunImageModel,
  type ByokImageTarget,
  type FrozenImageModelCapability,
  type ImageTargetSourceInput,
  type RecipeImageDb,
  type RecipeImageModelRow,
} from "./build-run-input.js";

/** The shared provider env pair shape (what `imageGenerationConfig()` returns). */
type ImageConfig = { apiKey: string; baseUrl: string } | null;

const USER_ID = "user-1";
const SLUG = "my-gateway/Flux Pro Max";
const UPSTREAM_ID = "black-forest-labs/flux-pro";
const CONNECTION_REF = encodeProviderCredentials({ apiKey: "sk-byok" });

function imageRow(overrides: Partial<RecipeImageModelRow> = {}): RecipeImageModelRow {
  return {
    slug: SLUG,
    upstreamId: UPSTREAM_ID,
    outputType: "image",
    imageCapabilities: {
      n: { min: 1, max: 4 },
      aspectRatios: ["1:1", "16:9"],
      sizes: ["1024x1024", "1280x720"],
      quality: ["high"],
      background: ["transparent"],
    },
    connection: {
      kind: "compatible",
      baseUrl: "https://gw.example/v1",
      credentialsRef: CONNECTION_REF,
    },
    ...overrides,
  };
}

function fakeImageDb(row: RecipeImageModelRow | null): RecipeImageDb & {
  providerModel: { findFirst: ReturnType<typeof vi.fn> };
} {
  const findFirst = vi.fn(async () => row);
  return { providerModel: { findFirst } } as never;
}

/** The recipe shape with the image capability switched on. */
function imageRecipe(overrides: Record<string, unknown> = {}) {
  const value = {
    version: CHAT_AGENT_RECIPE_VERSION,
    agentId: "chat-agent",
    identity: { sessionId: "session-1", userId: USER_ID, projectId: null },
    model: { id: "openai/gpt-5.6-luna", connectionId: null, reasoningEffort: null },
    memoryPolicy: {
      version: 1,
      savePolicy: "turn",
      staticContextTokens: 0,
      triggerAfterTokens: 700_000,
      retentionRecentTokens: 300_000,
      compactorMaxTokens: 4096,
      conflictRetries: 3,
    },
    staticContext: {
      version: 1,
      instructions: { base: "Base", additional: [] },
      context: [],
      tools: [],
      model: {
        contextWindowTokens: 1_000_000,
        maxInputTokens: null,
        maxOutputTokens: 128_000,
      },
      staticContextTokens: 0,
    },
    features: {
      webSearchEnabled: false,
      imageGenerationEnabled: false,
      deepResearchEnabled: false,
    },
    userSkills: [],
    userMcp: [],
    imageGenSettings: null,
    budgets: {
      maxTurns: 20,
      deepResearchMaxTurns: 8,
      deepResearchMaxSearches: 12,
      deepResearchMaxDurationMs: 360_000,
    },
    documents: { ids: [], catalog: [] },
    instructionFragments: ["Frozen instruction"],
    contextDescriptors: [{ id: "frozen", text: "Frozen context" }],
    activeContext: { images: [], snippet: null },
    capabilities: {
      modelAcceptsImage: true,
      webSearchAvailable: false,
      imageGenerationAvailable: true,
      deepResearchAvailable: false,
      profilingEnabled: false,
      context7Requested: false,
      imageModelCapabilities: [
        { modelId: "openai/gpt-image-1", capabilities: { nMax: 2, resolutions: ["1K"] } },
      ],
    },
    promptClientMessageId: null,
    trace: { traceId: "trace-1" },
    ...overrides,
  } as Record<string, unknown>;

  // `reconstructChatRunInput` asserts the frozen static context matches what it
  // rebuilds, so the fixture must compute it the same way the resolver does.
  const capabilities = value.capabilities as {
    modelAcceptsImage: boolean;
    webSearchAvailable: boolean;
    imageGenerationAvailable: boolean;
    deepResearchAvailable: boolean;
    profilingEnabled: boolean;
  };
  const documents = value.documents as { ids: string[] };
  const contextDescriptors = value.contextDescriptors as {
    id: string;
    text: string;
  }[];
  const activeContext = value.activeContext as {
    images: { id: string; prompt?: string; mediaType: string }[];
    snippet: { id: string; text: string; sourceRole: string } | null;
  };
  const contextBlocks = [
    ...contextDescriptors,
    ...(activeContext.images.length > 0
      ? [
          {
            id: "active_image_context",
            text:
              "Active image context\n" +
              activeContext.images
                .map((image, index) => `${index + 1}. ${image.prompt}`)
                .join("\n"),
          },
        ]
      : []),
    ...(activeContext.snippet
      ? [
          {
            id: "session_context_snippet",
            text: formatContextSnippetBlock(activeContext.snippet as never),
          },
        ]
      : []),
  ];
  const toolDefinitions = [
    ...TABULAR_TOOL_DEFINITIONS,
    ...CHART_TOOL_DEFINITIONS,
    ...DERIVED_TOOL_DEFINITIONS,
    ...(documents.ids.length > 0 ? DOCUMENT_TOOL_DEFINITIONS : []),
    ...(capabilities.profilingEnabled ? PROFILE_TOOL_DEFINITIONS : []),
    ...(capabilities.webSearchAvailable ? WEB_SEARCH_TOOL_DEFINITIONS : []),
    ...(capabilities.deepResearchAvailable ? DEEP_RESEARCH_TOOL_DEFINITIONS : []),
    ...(capabilities.imageGenerationAvailable ? IMAGE_GENERATION_TOOL_DEFINITIONS : []),
    ...CLARIFICATION_TOOL_DEFINITIONS,
    ...SITE_BUILD_TOOL_DEFINITIONS,
    ...ARTIFACT_TOOL_DEFINITIONS,
    ...SITE_VIEW_TOOL_DEFINITIONS,
    ...REPORT_TOOL_DEFINITIONS,
    ...WORKSPACE_TOOL_DEFINITIONS,
    ...USER_SKILL_TOOL_DEFINITIONS,
    ...USER_MCP_TOOL_DEFINITIONS,
    ...(!capabilities.modelAcceptsImage
      ? [VIEW_IMAGE_TOOL_DEFINITIONS.description]
      : []),
  ];
  const staticContext = createNativeStaticContext({
    baseInstructions: BASE_INSTRUCTIONS,
    instructions: value.instructionFragments as string[],
    contextBlocks,
    toolDefinitions,
    model: {
      contextWindowTokens: 1_000_000,
      maxInputTokens: null,
      maxOutputTokens: 128_000,
    },
  });
  value.staticContext = staticContext;
  value.memoryPolicy = {
    version: 1,
    savePolicy: "turn",
    staticContextTokens: staticContext.staticContextTokens,
    triggerAfterTokens: 700_000,
    retentionRecentTokens: 300_000,
    compactorMaxTokens: 4096,
    conflictRetries: 3,
  };

  return parseChatAgentRecipe(value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveRecipeImageTarget", () => {
  it("falls back to the user's BYOK model when the session pinned nothing", async () => {
    // Build-time availability is true whenever the user owns a BYOK image
    // model, so the worker MUST resolve one even with no pin, or a correctly
    // configured user gets a dead run. The fallback is the shared predicate's
    // branch 3.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeImageDb(imageRow());
    const target = await resolveRecipeImageTarget(imageRecipe(), db, {
      envConfig: null,
    });
    expect(target).not.toBeNull();
    expect(target!.modelId).toBe(SLUG);
    warn.mockRestore();
  });

  it("returns nothing when the session pinned nothing and the user owns no BYOK model", async () => {
    const db = fakeImageDb(null);
    const target = await resolveRecipeImageTarget(imageRecipe(), db, {
      envConfig: null,
    });
    expect(target).toBeNull();
  });

  it("returns nothing, and never throws, when the model row is gone", async () => {
    const db = fakeImageDb(null);
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      db,
    );
    expect(target).toBeNull();
  });

  it("returns nothing when the connection row is gone", async () => {
    const db = fakeImageDb(imageRow({ connection: null as never }));
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      db,
    );
    expect(target).toBeNull();
  });

  it("never throws when the credential reference cannot be decoded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeImageDb(
      imageRow({
        connection: {
          kind: "compatible",
          baseUrl: "https://gw.example/v1",
          credentialsRef: "not-a-cipher-reference",
        },
      }),
    );
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      db,
    );
    expect(target).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns nothing for a row on a kind with no image endpoint", async () => {
    const db = fakeImageDb(
      imageRow({
        connection: {
          kind: "anthropic",
          baseUrl: null,
          credentialsRef: CONNECTION_REF,
        },
      }),
    );
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      db,
    );
    expect(target).toBeNull();
  });

  it("builds an OpenRouter-shaped model from the connection and the stored upstream id", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("{}");
    });
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      fakeImageDb(imageRow()),
      { fetchFn: seen },
    );

    expect(target).not.toBeNull();
    expect(target!.kind).toBe("compatible");
    expect(target!.model).toBeInstanceOf(OpenRouterImageGenerationModel);
    expect(target!.model.modelId).toBe(UPSTREAM_ID);

    // Drive the real adapter: the id on the wire must be the stored upstream
    // id, never the sanitized slug, and no network is touched.
    await expect(
      target!.model.imageGeneration({ prompt: "a cat", width: 1024, height: 1024 }),
    ).rejects.toThrow(/no usable images/i);
    const body = JSON.parse(
      (seen.mock.calls[0]![1] as unknown as { body: string }).body,
    ) as { model: string };    expect(body.model).toBe(UPSTREAM_ID);
    expect(body.model).not.toBe(SLUG);
  });

  it("carries the session's effective model id into the native Gemini model", async () => {
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      fakeImageDb(
        imageRow({
          upstreamId: "gemini-3.1-flash-image",
          connection: {
            kind: "gemini",
            baseUrl: null,
            credentialsRef: CONNECTION_REF,
          },
        }),
      ),
    );

    expect(target!.kind).toBe("gemini");
    expect(target!.model.provider).toBe("gemini");
    // Design ruling 2: for the native kinds the constructor is authoritative,
    // so the model must be built from the target's id — not a hardcoded one.
    // (The `api: "generateContent"` choice is pinned in the agent package's
    // registry test, which can stub `GeminiClient`; this package cannot.)
    expect(target!.model.modelId).toBe("gemini-3.1-flash-image");
    expect(imageProviderOptionsForKind("gemini", "gemini-3.1-flash-image")({ aspectRatio: "16:9" })).toEqual(
      {},
    );
  });

  it("builds the native Grok model with the target id", async () => {
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      fakeImageDb(
        imageRow({
          upstreamId: "grok-imagine-image-quality",
          connection: {
            kind: "grok",
            baseUrl: null,
            credentialsRef: CONNECTION_REF,
          },
        }),
      ),
    );
    expect(target!.kind).toBe("grok");
    expect(target!.model.modelId).toBe("grok-imagine-image-quality");
  });

  it("builds adapter-shaped options: the OpenRouter path names the upstream id, the native paths emit nothing", () => {
    const compatible = imageProviderOptionsForKind("compatible", UPSTREAM_ID)({
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      n: 2,
    });
    expect(compatible).toEqual({
      // The wire id, not the slug the tool injects.
      model: UPSTREAM_ID,
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      output_format: "png",
      n: 2,
    });
    expect(compatible.model).not.toBe(SLUG);

    for (const kind of ["gemini", "grok"] as const) {
      const options = imageProviderOptionsForKind(kind, UPSTREAM_ID)({
        aspectRatio: "16:9",
        resolution: "1K",
        quality: "high",
        background: "transparent",
        n: 2,
      });
      expect(options).toEqual({});
      expect("aspect_ratio" in options).toBe(false);
    }
  });

  it("sends the stored upstream id, not the slug, through the real tool", async () => {
    const seen = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("{}");
    });
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      fakeImageDb(imageRow()),
      { fetchFn: seen },
    );
    const saveGeneratedImage = vi.fn(async () => ({
      id: "rec-1",
      mediaType: "image/png",
      width: 1024,
      height: 1024,
      modelId: SLUG,
      prompt: "a cat",
    }));
    const tools = createImageGenerationTools({
      model: target!.model,
      store: { saveGeneratedImage },
      enabled: true,
      hasGrant: () => true,
      takeToolOverride: () => null,
      userId: USER_ID,
      sessionId: "session-1",
      projectId: null,
      resolveReference: async () => null,
      capabilities: () => target!.capabilities,
      imageProviderOptions: target!.imageProviderOptions,
      defaultSettings: { modelId: SLUG, aspectRatio: "1:1" },
    });

    await tools[0]!.call({ prompt: "a cat" });

    const body = JSON.parse(
      (seen.mock.calls[0]![1] as unknown as { body: string }).body,
    ) as { model: string };
    expect(body.model).toBe(UPSTREAM_ID);
    expect(body.model).not.toBe(SLUG);
  });
});

describe("connection headers reach a BYOK image request", () => {
  /** A row whose connection credential carries custom gateway headers. */
  function rowWithHeaders(headers: Record<string, string> | null) {
    return imageRow({
      connection: {
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        credentialsRef: encodeProviderCredentials({
          apiKey: "sk-byok",
          headers,
        }),
      },
    });
  }

  /** Drive the real tool + real adapter and return the headers the fake saw. */
  async function wireHeaders(headers: Record<string, string> | null) {
    const seen = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("{}");
    });
    const target = await resolveRecipeImageTarget(
      imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      fakeImageDb(rowWithHeaders(headers)),
      { fetchFn: seen },
    );
    const tools = createImageGenerationTools({
      model: target!.model,
      store: {
        saveGeneratedImage: async () => ({
          id: "rec-1",
          mediaType: "image/png",
          width: 1024,
          height: 1024,
          modelId: SLUG,
          prompt: "a cat",
        }),
      },
      enabled: true,
      hasGrant: () => true,
      takeToolOverride: () => null,
      userId: USER_ID,
      sessionId: "session-1",
      projectId: null,
      resolveReference: async () => null,
      capabilities: () => target!.capabilities,
      imageProviderOptions: target!.imageProviderOptions,
      defaultSettings: { modelId: SLUG, aspectRatio: "1:1" },
    });

    await tools[0]!.call({ prompt: "a cat" });
    return (seen.mock.calls[0]![1] as unknown as RequestInit).headers;
  }

  it("sends the connection's custom headers on the wire", async () => {
    // The user's gateway authenticates with a custom header, exactly as the
    // completion path already forwards (registry.ts:152). Before the fix the
    // image request went out unauthenticated.
    await expect(wireHeaders({ "X-Api-Key": "secret-header" })).resolves.toEqual({
      Authorization: "Bearer sk-byok",
      "Content-Type": "application/json",
      "X-Api-Key": "secret-header",
    });
  });

  it("lets a custom header override a default of the same name", async () => {
    await expect(
      wireHeaders({ Authorization: "Custom abc123", "X-Gateway": "acme" }),
    ).resolves.toEqual({
      Authorization: "Custom abc123",
      "Content-Type": "application/json",
      "X-Gateway": "acme",
    });
  });

  it("still sends the connection key when no custom Authorization is declared", async () => {
    await expect(wireHeaders({ "X-Gateway": "acme" })).resolves.toMatchObject({
      Authorization: "Bearer sk-byok",
      "X-Gateway": "acme",
    });
  });

  it("sends exactly the two defaults when the connection declares no headers", async () => {
    // The majority case, and the regression pin: no custom headers must behave
    // exactly as before.
    await expect(wireHeaders(null)).resolves.toEqual({
      Authorization: "Bearer sk-byok",
      "Content-Type": "application/json",
    });
  });
});

describe("selectRunImageModel", () => {
  it("builds exactly today's model from the env pair when no BYOK target exists", () => {
    const model = selectRunImageModel({
      envConfig: { apiKey: "sk-shared", baseUrl: "https://shared.example/v1" },
      byok: null,
    });
    expect(model).toBeInstanceOf(OpenRouterImageGenerationModel);
    // No `defaultModel` was added: the adapter's own default is still used, so
    // the no-BYOK path is byte-identical to before this phase.
    expect(model!.modelId).toBe("openai/gpt-5-image-mini");
  });

  it("returns nothing when neither source exists", () => {
    expect(selectRunImageModel({ envConfig: null, byok: null })).toBeNull();
  });

  it("prefers the BYOK target over the shared env pair", () => {
    const byok = { model: { provider: "byok", modelId: UPSTREAM_ID } } as never;
    expect(
      selectRunImageModel({
        envConfig: { apiKey: "sk-shared", baseUrl: "https://shared.example/v1" },
        byok: { ...(byok as object), modelId: SLUG } as ByokImageTarget,
      }),
    ).toBe((byok as { model: unknown }).model);
  });
});

describe("buildImageCapabilitySource", () => {
  const frozen: FrozenImageModelCapability[] = [
    { modelId: "openai/gpt-image-1", capabilities: { nMax: 2, resolutions: ["1K"] } },
  ];

  it("prefers the BYOK declaration for its own id and the frozen catalog otherwise", () => {
    const declared: ImageCapabilitySet = {
      nMax: 4,
      aspectRatios: ["1:1", "16:9"],
      sizes: ["1024x1024", "1280x720"],
    };
    const source = buildImageCapabilitySource(frozen, {
      modelId: SLUG,
      upstreamId: UPSTREAM_ID,
      kind: "compatible",
      model: {} as never,
      capabilities: declared,
      imageProviderOptions: () => ({}),
    });

    expect(source.get(SLUG)).toBe(declared);
    expect(source.get("openai/gpt-image-1")).toEqual({
      nMax: 2,
      resolutions: ["1K"],
    });
    expect(source.get("unknown-model")).toBeUndefined();
  });
});

describe("run reconstruction with a BYOK image target", () => {
  function runtimeWithTarget(target: ByokImageTarget | null) {
    return {
      createAgent: (() => ({}) as never) as never,
      createCompletionModel: (() => ({}) as never) as never,
      createMemoryStore: () =>
        ({
          load: async () => [],
          append: async () => undefined,
          clear: async () => undefined,
        }) as never,
      resolveRecipeImageTarget: async () => target,
    };
  }

  it("falls back to the env pair when the BYOK row vanished", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://image-provider.invalid/v1");
    const reconstructed = await reconstructChatRunInput({
      recipe: imageRecipe({ imageGenSettings: { modelId: SLUG } }),
      runtime: runtimeWithTarget(null),
    });
    expect(reconstructed.imageGenerationAvailable).toBe(true);
    expect(reconstructed.tools.map((tool) => tool.name)).toContain("generate_image");
  });

  it("does not throw out of the resolver when the BYOK row and the env pair are both gone", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    // The resolver itself is silent-safe: it returns null (asserted directly in
    // the resolveRecipeImageTarget cases above) and warns rather than throwing.
    // What fails here is the frozen-capability contract the recipe already
    // committed to — a recipe that froze image tools cannot reconstruct a run
    // without one, because the static-context parity check would reject a
    // silently shrunk tool surface.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      reconstructChatRunInput({
        recipe: imageRecipe({ imageGenSettings: { modelId: SLUG } }),
        runtime: runtimeWithTarget(null),
      }),
    ).rejects.toThrow("frozen image-generation capability is unavailable");
    warn.mockRestore();
  });

  it("reports image generation unavailable when the row was already gone at build time", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    // A recipe built with no image source freezes imageGenerationAvailable
    // false, so no image tools are in the frozen surface and the run reports
    // unavailable without any throw.
    const reconstructed = await reconstructChatRunInput({
      recipe: imageRecipe({
        imageGenSettings: { modelId: SLUG },
        capabilities: {
          ...imageRecipe().capabilities,
          imageGenerationAvailable: false,
        },
      }),
      runtime: runtimeWithTarget(null),
    });
    expect(reconstructed.imageGenerationAvailable).toBe(false);
    expect(reconstructed.tools.map((tool) => tool.name)).not.toContain("generate_image");
  });

  it("registers image tools for a BYOK-only run with an empty frozen catalog", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    const target: ByokImageTarget = {
      modelId: SLUG,
      upstreamId: UPSTREAM_ID,
      kind: "compatible",
      model: { provider: "byok", modelId: UPSTREAM_ID } as never,
      capabilities: {
        nMax: 4,
        aspectRatios: ["1:1"],
        sizes: ["1024x1024"],
      },
      imageProviderOptions: () => ({}),
    };
    const base = imageRecipe();
    const reconstructed = await reconstructChatRunInput({
      recipe: imageRecipe({
        imageGenSettings: { modelId: SLUG },
        capabilities: {
          ...base.capabilities,
          imageModelCapabilities: [],
        },
      }),
      runtime: runtimeWithTarget(target),
    });
    expect(reconstructed.imageGenerationAvailable).toBe(true);
    expect(reconstructed.tools.map((tool) => tool.name)).toContain("generate_image");
  });
});

describe("the Critical: pinned catalog id, no env pair, one BYOK model", () => {
  const runtimeWithRealResolver = (db: RecipeImageDb, fetchFn: typeof fetch) => ({
    createAgent: (() => ({}) as never) as never,
    createCompletionModel: (() => ({}) as never) as never,
    createMemoryStore: () =>
      ({
        load: async () => [],
        append: async () => undefined,
        clear: async () => undefined,
      }) as never,
    // Drive the REAL resolver (and therefore the REAL shared predicate) against
    // a fake db; ignore the worker's real prisma handle.
    resolveRecipeImageTarget: ((
      recipe: ChatAgentRecipe,
      _db: RecipeImageDb,
      options?: { fetchFn?: typeof fetch; envConfig?: ImageConfig },
    ) =>
      resolveRecipeImageTarget(recipe, db, {
        ...options,
        envConfig: null,
        fetchFn,
      })) as never,
  });

  it("freezes true at build time and reconstructs a working run with no throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No env pair anywhere.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    const fakeDb = fakeImageDb(imageRow());

    // Build: the client's default pin is a seeded catalog id, not an owned slug.
    const recipe = await resolveChatAgentRecipe({
      sessionId: "session-1",
      userId: USER_ID,
      model: "openai/gpt-5.6-luna",
      reasoningEffort: null,
      traceId: "trace-1",
      consumeSingleUseContext: false,
      imageGenSettings: { modelId: "openai/gpt-5-image-mini" },
      dependencies: {
        resolveActiveDocuments: async () => [],
        listActiveImages: async () => [],
        getActiveSnippet: async () => null,
        webSearchConfig: () => null,
        imageGenerationConfig: () => null,
        loadImageModelCapabilities: async () => [],
        imageTargetSource: (selectionInput: ImageTargetSourceInput) =>
          selectImageTargetSource({ db: fakeDb, ...selectionInput }),
        profilingEnabled: () => false,
        loadProfileData: async () => null,
        context7Requested: () => false,
        context7ToolDefinitions: async () => [],
        resolveUserEnhancements: async () => ({ userSkills: [], userMcp: [] }),
        deepResearchLimits: () => ({
          maxTurns: 8,
          maxSearches: 12,
          maxDurationMs: 360_000,
        }),
        findActiveModel: async () => ({
          modelId: "openai/gpt-5.6-luna",
          reasoningEfforts: [],
          contextWindowTokens: 1_000_000,
          maxInputTokens: null,
          maxOutputTokens: null,
          inputModalities: ["text"],
          outputType: "text",
          connectionId: null,
        }),
        prisma: {
          chatSession: { findFirst: async () => ({ projectId: null }) },
          project: { findFirst: async () => null },
        },
      } as never,
    });

    // Build time froze true because the shared predicate selected the BYOK
    // fallback, and the seeded pinned id was preserved verbatim in the recipe.
    expect(recipe.capabilities.imageGenerationAvailable).toBe(true);
    expect(recipe.imageGenSettings?.modelId).toBe("openai/gpt-5-image-mini");

    // Worker: the REAL resolver runs against the same fake db and must land on
    // the BYOK fallback instead of throwing the frozen-capability error.
    const seen = vi.fn(async () => new Response("{}"));
    const reconstructed = await reconstructChatRunInput({
      recipe,
      runtime: runtimeWithRealResolver(fakeDb, seen as never),
    });
    expect(reconstructed.imageGenerationAvailable).toBe(true);
    expect(reconstructed.tools.map((tool) => tool.name)).toContain("generate_image");
    warn.mockRestore();
  });

  it("addresses the wire with the stored upstreamId, not the slug", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    const seen = vi.fn(async () => new Response("{}"));
    const target = await resolveRecipeImageTarget(
      // The pinned catalog id does not resolve as an owned slug.
      imageRecipe({ imageGenSettings: { modelId: "openai/gpt-5-image-mini" } }),
      fakeImageDb(imageRow({ slug: "a-other/lowest", upstreamId: UPSTREAM_ID })),
      { envConfig: null, fetchFn: seen as never },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(target).not.toBeNull();
    expect(target!.modelId).toBe("a-other/lowest");
    // The rule every path in this phase carries: the wire id is upstreamId.
    expect(target!.upstreamId).toBe(UPSTREAM_ID);
    expect(target!.model.modelId).toBe(UPSTREAM_ID);
    warn.mockRestore();
  });
});

describe("build-time image availability", () => {
  function resolverDependencies(byok: boolean, imageConfig: ImageConfig = null) {
    return {
      resolveActiveDocuments: async () => [],
      listActiveImages: async () => [],
      getActiveSnippet: async () => null,
      webSearchConfig: () => null,
      imageGenerationConfig: () => imageConfig,
      // The env-only path needs a non-empty frozen catalog (its own guard); the
      // BYOK path carries its own capability source, so an empty catalog is
      // fine there.
      loadImageModelCapabilities: async () =>
        imageConfig === null
          ? []
          : [
              {
                modelId: "openai/gpt-image-1",
                capabilities: { nMax: 2, resolutions: ["1K"] as const },
              } satisfies FrozenImageModelCapability,
            ],
      // Drive the REAL shared predicate against a fake db, so build time and
      // worker time are decided by the same function, not by a stub.
      imageTargetSource: (selectionInput: ImageTargetSourceInput) =>
        selectImageTargetSource({
          db: byok ? fakeImageDb(imageRow()) : fakeImageDb(null),
          ...selectionInput,
        }),
      profilingEnabled: () => false,
      loadProfileData: async () => null,
      context7Requested: () => false,
      context7ToolDefinitions: async () => [],
      resolveUserEnhancements: async () => ({ userSkills: [], userMcp: [] }),
      deepResearchLimits: () => ({
        maxTurns: 8,
        maxSearches: 12,
        maxDurationMs: 360_000,
      }),
    };
  }

  function resolveWith(input: {
    byok: boolean;
    imageConfig: ImageConfig;
    imageGenSettings: unknown;
  }) {
    return resolveChatAgentRecipe({
      sessionId: "session-1",
      userId: USER_ID,
      model: "openai/gpt-5.6-luna",
      reasoningEffort: null,
      traceId: "trace-1",
      consumeSingleUseContext: false,
      imageGenSettings: input.imageGenSettings,
      dependencies: {
        ...resolverDependencies(input.byok, input.imageConfig),
        findActiveModel: async () => ({
          modelId: "openai/gpt-5.6-luna",
          reasoningEfforts: [],
          contextWindowTokens: 1_000_000,
          maxInputTokens: null,
          maxOutputTokens: null,
          inputModalities: ["text"],
          outputType: "text",
          connectionId: null,
        }),
        prisma: {
          chatSession: { findFirst: async () => ({ projectId: null }) },
          project: { findFirst: async () => null },
        },
      } as never,
    });
  }

  it("is true when the env pair is absent but the user has a BYOK image model", async () => {
    const recipe = await resolveWith({
      byok: true,
      imageConfig: null,
      imageGenSettings: { modelId: SLUG },
    });
    expect(recipe.capabilities.imageGenerationAvailable).toBe(true);
  });

  it("is true for the Critical case: a pinned seeded catalog id with a BYOK model and no env pair", async () => {
    // The client default pins a seeded catalog id, not an owned slug. Build
    // time must still freeze true because the shared predicate falls back to
    // the owned BYOK model — exactly what the worker will resolve.
    const recipe = await resolveWith({
      byok: true,
      imageConfig: null,
      imageGenSettings: { modelId: "openai/gpt-5-image-mini" },
    });
    expect(recipe.capabilities.imageGenerationAvailable).toBe(true);
  });

  it("is false when neither the env pair nor a BYOK image model exists", async () => {
    const recipe = await resolveWith({
      byok: false,
      imageConfig: null,
      imageGenSettings: { modelId: SLUG },
    });
    expect(recipe.capabilities.imageGenerationAvailable).toBe(false);
  });

  it("is true from the env pair alone, with no BYOK model (unchanged)", async () => {
    const recipe = await resolveWith({
      byok: false,
      imageConfig: { apiKey: "sk-shared", baseUrl: "https://shared.example/v1" },
      imageGenSettings: { modelId: SLUG },
    });
    expect(recipe.capabilities.imageGenerationAvailable).toBe(true);
  });
});

describe("the one shared image-target predicate", () => {
  /**
   * A fake db that honours the `where.slug` filter and the `orderBy: { slug:
   * "asc" }` fallback clause, so determinism can be observed rather than
   * assumed. `calls` records every argument the predicate passed.
   */
  function orderedDb(rows: RecipeImageModelRow[]) {
    const calls: unknown[] = [];
    const sorted = [...rows].sort((a, b) => a.slug.localeCompare(b.slug));
    return {
      calls,
      providerModel: {
        findFirst: vi.fn(async (args: unknown) => {
          calls.push(args);
          const where = (args as { where?: { slug?: string; connection?: { kind?: { in?: string[] } } } })
            .where;
          const kindFilter = where?.connection?.kind?.in;
          const candidates = kindFilter
            ? sorted.filter((row) =>
                kindFilter.includes((row.connection?.kind ?? "") as string),
              )
            : sorted;
          if (where?.slug !== undefined) {
            return candidates.find((row) => row.slug === where.slug) ?? null;
          }
          return candidates[0] ?? null;
        }),
      },
    };
  }

  it("prefers a pinned slug that resolves as an owned BYOK model over the fallback", async () => {
    const db = orderedDb([
      imageRow({ slug: "a-gateway/lowest" }),
      imageRow({ slug: "z-pinned/model" }),
    ]);
    const selection = await selectImageTargetSource({
      db,
      userId: USER_ID,
      pinnedSlug: "z-pinned/model",
      envConfig: null,
    });
    expect(selection).toEqual({ source: "byok", row: expect.objectContaining({ slug: "z-pinned/model" }) });
  });

  it("falls back deterministically to the lowest slug when the pin does not resolve", async () => {
    const rows = [
      imageRow({ slug: "m-gateway/mid" }),
      imageRow({ slug: "a-gateway/lowest" }),
      imageRow({ slug: "z-gateway/high" }),
    ];
    const first = await selectImageTargetSource({
      db: orderedDb(rows),
      userId: USER_ID,
      pinnedSlug: "openai/gpt-5-image-mini",
      envConfig: null,
    });
    const second = await selectImageTargetSource({
      db: orderedDb(rows),
      userId: USER_ID,
      pinnedSlug: "openai/gpt-5-image-mini",
      envConfig: null,
    });
    expect(first?.source).toBe("byok");
    expect((first as { row: RecipeImageModelRow }).row.slug).toBe("a-gateway/lowest");
    // Repeated resolutions pick the same model, not database-default ordering.
    expect((second as { row: RecipeImageModelRow }).row.slug).toBe(
      (first as { row: RecipeImageModelRow }).row.slug,
    );
    // The determinism comes from the explicit orderBy, not luck.
    const fallbackCall = orderedDb(rows);
    await selectImageTargetSource({
      db: fallbackCall,
      userId: USER_ID,
      pinnedSlug: "openai/gpt-5-image-mini",
      envConfig: null,
    });
    // The LAST read is the fallback; only it carries the explicit orderBy.
    expect(fallbackCall.calls.at(-1)).toMatchObject({ orderBy: { slug: "asc" } });
  });

  it("warns with the unresolvable pinned slug, and never leaks a credential", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await selectImageTargetSource({
      db: orderedDb([imageRow()]),
      userId: USER_ID,
      pinnedSlug: "openai/gpt-5-image-mini",
      envConfig: null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0]!;
    expect(String(message)).toMatch(/did not resolve/i);
    expect((meta as { pinnedSlug?: string }).pinnedSlug).toBe(
      "openai/gpt-5-image-mini",
    );
    // Only slugs leave this call — never the credential reference.
    expect(JSON.stringify(meta)).not.toContain(CONNECTION_REF);
    warn.mockRestore();
  });

  it("prefers the env pair over the BYOK fallback", async () => {
    const selection = await selectImageTargetSource({
      db: orderedDb([imageRow()]),
      userId: USER_ID,
      pinnedSlug: "openai/gpt-5-image-mini",
      envConfig: { apiKey: "sk-shared", baseUrl: "https://shared.example/v1" },
    });
    expect(selection).toEqual({ source: "env" });
  });

  it("returns null when nothing resolves and warns rather than throws on a read failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const brokenDb: RecipeImageDb = {
      providerModel: {
        findFirst: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    };
    await expect(
      selectImageTargetSource({
        db: brokenDb,
        userId: USER_ID,
        pinnedSlug: SLUG,
        envConfig: null,
      }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("no recipe change", () => {
  it("keeps the recipe version at 8", () => {
    expect(CHAT_AGENT_RECIPE_VERSION).toBe(8);
  });

  it("still parses a recipe without any image-target field", () => {
    // If a `byokImageTarget` field had been added to the schema, this value
    // would be rejected by the strict parse rather than accepted.
    const parsed = imageRecipe();
    expect("byokImageTarget" in parsed).toBe(false);
    expect(parsed.imageGenSettings?.modelId).toBeUndefined();
  });
});
