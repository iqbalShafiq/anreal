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
import { CHAT_AGENT_RECIPE_VERSION, parseChatAgentRecipe } from "./run-recipe.js";
import { createNativeStaticContext } from "./memory-policy.js";
import { formatContextSnippetBlock } from "./context-snippets.js";
import { VIEW_IMAGE_TOOL_DEFINITIONS } from "./vision-helper.js";
import {
  buildImageCapabilitySource,
  imageProviderOptionsForKind,
  reconstructChatRunInput,
  resolveRecipeImageTarget,
  resolveChatAgentRecipe,
  selectRunImageModel,
  type ByokImageTarget,
  type FrozenImageModelCapability,
  type RecipeImageDb,
  type RecipeImageModelRow,
} from "./build-run-input.js";

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
  it("returns nothing when the session did not pin a BYOK image model", async () => {
    const db = fakeImageDb(imageRow());
    const target = await resolveRecipeImageTarget(imageRecipe(), db);
    expect(target).toBeNull();
    expect(db.providerModel.findFirst).not.toHaveBeenCalled();
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

describe("build-time image availability", () => {
  function resolverDependencies(byok: boolean) {
    return {
      resolveActiveDocuments: async () => [],
      listActiveImages: async () => [],
      getActiveSnippet: async () => null,
      webSearchConfig: () => null,
      imageGenerationConfig: () => null,
      loadImageModelCapabilities: async () => [],
      byokImageAvailability: async () => byok,
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

  it("is true when the env pair is absent but the user has a BYOK image model", async () => {
    const recipe = await resolveChatAgentRecipe({
      sessionId: "session-1",
      userId: USER_ID,
      model: "openai/gpt-5.6-luna",
      reasoningEffort: null,
      traceId: "trace-1",
      consumeSingleUseContext: false,
      dependencies: {
        ...resolverDependencies(true),
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
    expect(recipe.capabilities.imageGenerationAvailable).toBe(true);
  });

  it("is false when neither the env pair nor a BYOK image model exists", async () => {
    const recipe = await resolveChatAgentRecipe({
      sessionId: "session-1",
      userId: USER_ID,
      model: "openai/gpt-5.6-luna",
      reasoningEffort: null,
      traceId: "trace-1",
      consumeSingleUseContext: false,
      dependencies: {
        ...resolverDependencies(false),
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
    expect(recipe.capabilities.imageGenerationAvailable).toBe(false);
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
