import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The run-path credential seams must turn a stored dynamic header into the
 * concrete string a provider request carries, before a client is built:
 * - the chat completion seam (`resolveRecipeCompletionModel`);
 * - the BYOK image seam (`resolveRecipeImageTarget`);
 * - the role seam (`buildRoleCompletionModel`), which serves the vision
 *   helper, profiling, and site builds and has no conversation at all.
 *
 * The chat and role seams have no fetch injection point, so their factory call
 * is captured and the assertion is on the resolved argument. The image seam has
 * a `fetchFn` seam, so its assertion is on the outgoing request — the value on
 * the wire, not only at the factory boundary. No test here asserts on source
 * text; each fails if the resolution is dropped or the context is wrong.
 */

type CapturedCompletionTarget = {
  upstreamId: string;
  credentials: {
    apiKey: string;
    baseUrl?: string | null;
    headers?: Record<string, string> | null;
  };
};

const f = vi.hoisted(() => ({
  createCompletionModelFor: vi.fn(
    (_target: CapturedCompletionTarget) => ({ kind: "fake-model" }),
  ),
}));

vi.mock("@anreal/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anreal/agent")>()),
  createCompletionModelFor: f.createCompletionModelFor,
}));

import { encodeProviderCredentials } from "../provider-connections/credentials.js";
import { type HeaderValue } from "../provider-connections/dynamic-headers.js";
import { buildRoleCompletionModel, type RolesDb } from "../models/roles.js";
import {
  resolveRecipeCompletionModel,
  resolveRecipeImageTarget,
  type RecipeImageDb,
  type RecipeImageModelRow,
  type RecipeModelDb,
} from "./build-run-input.js";
import {
  CHAT_AGENT_RECIPE_VERSION,
  parseChatAgentRecipe,
} from "./run-recipe.js";

const USER_ID = "u_1";
const BYOK_MODEL_ID = "my-gateway/gpt-5.6-luna";
const CONNECTION_ID = "pc_1";
const IMAGE_SLUG = "my-gateway/Flux Pro Max";
const DYNAMIC_HEADER = "x-opencode-session";

/** The argument the mocked factory recorded last. */
function lastTarget(): CapturedCompletionTarget {
  return f.createCompletionModelFor.mock.calls.at(-1)![0];
}

/** The recipe shape both run seams read, parameterized by conversation. */
function recipeFor(
  sessionId: string,
  overrides: { traceId?: string; imageGenSettings?: unknown } = {},
) {
  const value = {
    version: CHAT_AGENT_RECIPE_VERSION,
    agentId: "chat-agent",
    identity: { sessionId, userId: USER_ID, projectId: null },
    model: {
      id: BYOK_MODEL_ID,
      connectionId: CONNECTION_ID,
      reasoningEffort: null,
    },
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
    imageGenSettings: overrides.imageGenSettings ?? null,
    budgets: {
      maxTurns: 20,
      deepResearchMaxTurns: 8,
      deepResearchMaxSearches: 12,
      deepResearchMaxDurationMs: 360_000,
    },
    documents: { ids: [], catalog: [] },
    instructionFragments: [],
    contextDescriptors: [],
    activeContext: { images: [], snippet: null },
    capabilities: {
      modelAcceptsImage: false,
      webSearchAvailable: false,
      imageGenerationAvailable: false,
      deepResearchAvailable: false,
      profilingEnabled: false,
      context7Requested: false,
      imageModelCapabilities: [],
    },
    promptClientMessageId: null,
    trace: { traceId: overrides.traceId ?? "trace-1" },
  } as Record<string, unknown>;
  return parseChatAgentRecipe(value);
}

/** The completion seam's db: one owned BYOK connection with the given headers. */
function completionDb(headers: Record<string, HeaderValue> | null): RecipeModelDb {
  return {
    providerConnection: {
      findFirst: vi.fn(async () => ({
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        api: "chat",
        credentialsRef: encodeProviderCredentials({ apiKey: "sk-live", headers }),
        models: [
          { upstreamId: "openai/GPT-5.6 Luna", reasoningEfforts: ["low"] },
        ],
      })),
    },
  } as unknown as RecipeModelDb;
}

/** The image seam's db: one owned BYOK image model with the given headers. */
function imageDb(headers: Record<string, HeaderValue> | null): RecipeImageDb {
  const row: RecipeImageModelRow = {
    slug: IMAGE_SLUG,
    upstreamId: "black-forest-labs/flux-pro",
    outputType: "image",
    imageCapabilities: {
      n: { min: 1, max: 4 },
      aspectRatios: ["1:1"],
      sizes: ["1024x1024"],
      quality: ["high"],
      background: ["transparent"],
    },
    connection: {
      kind: "compatible",
      baseUrl: "https://gw.example/v1",
      credentialsRef: encodeProviderCredentials({ apiKey: "sk-live", headers }),
    },
  };
  return {
    providerModel: {
      findFirst: vi.fn(async (args: unknown) => {
        const where = (args as { where?: { slug?: string } }).where;
        if (where?.slug !== undefined && where.slug !== row.slug) return null;
        return row;
      }),
    },
  } as unknown as RecipeImageDb;
}

/** The role seam's db: a BYOK role assignment with the given headers. */
function rolesDb(headers: Record<string, HeaderValue> | null): RolesDb {
  return {
    modelRoleAssignment: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({
        role: "siteBuilder",
        catalogModelId: null,
        providerModelId: "pm_1",
      })),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    chatModel: { findFirst: vi.fn(async () => null) },
    providerModel: {
      findFirst: vi.fn(async () => ({
        slug: "my-gateway/gpt-5.6-luna",
        connectionId: CONNECTION_ID,
      })),
    },
    providerConnection: {
      findFirst: vi.fn(async () => ({
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        api: "chat",
        credentialsRef: encodeProviderCredentials({ apiKey: "sk-live", headers }),
        models: [
          {
            upstreamId: "openai/gpt-5.6-luna",
            reasoningEfforts: [],
            contextWindowTokens: null,
            maxInputTokens: null,
            maxOutputTokens: null,
          },
        ],
      })),
    },
  } as unknown as RolesDb;
}

beforeEach(() => {
  f.createCompletionModelFor.mockClear();
});

describe("chat seam: resolveRecipeCompletionModel", () => {
  it("resolves a dynamic header into the factory call", async () => {
    await resolveRecipeCompletionModel(
      recipeFor("chat_a"),
      completionDb({ [DYNAMIC_HEADER]: { dynamic: "sessionId" } }),
    );

    expect(f.createCompletionModelFor).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          headers: { [DYNAMIC_HEADER]: "chat_a" },
        }),
      }),
    );
  });

  it("gives two conversations different values (AC3)", async () => {
    await resolveRecipeCompletionModel(
      recipeFor("chat_a"),
      completionDb({ [DYNAMIC_HEADER]: { dynamic: "sessionId" } }),
    );
    const first = lastTarget();
    await resolveRecipeCompletionModel(
      recipeFor("chat_b"),
      completionDb({ [DYNAMIC_HEADER]: { dynamic: "sessionId" } }),
    );
    const second = lastTarget();

    expect(second.credentials.headers).toEqual({ [DYNAMIC_HEADER]: "chat_b" });
    expect(second.credentials.headers).not.toEqual(first.credentials.headers);
  });

  it("gives two runs in one conversation the same value (AC2)", async () => {
    await resolveRecipeCompletionModel(
      recipeFor("chat_a", { traceId: "t_1" }),
      completionDb({ [DYNAMIC_HEADER]: { dynamic: "sessionId" } }),
    );
    const first = lastTarget();
    await resolveRecipeCompletionModel(
      recipeFor("chat_a", { traceId: "t_2" }),
      completionDb({ [DYNAMIC_HEADER]: { dynamic: "sessionId" } }),
    );
    const second = lastTarget();

    expect(second.credentials.headers).toEqual(first.credentials.headers);
    expect(second.credentials.headers).toEqual({ [DYNAMIC_HEADER]: "chat_a" });
  });

  it("resolves requestId from the run's trace id", async () => {
    await resolveRecipeCompletionModel(
      recipeFor("chat_a", { traceId: "trace-xyz" }),
      completionDb({ "x-request": { dynamic: "requestId" } }),
    );

    expect(lastTarget().credentials.headers).toEqual({ "x-request": "trace-xyz" });
  });

  it("keeps a literal header unchanged", async () => {
    await resolveRecipeCompletionModel(
      recipeFor("chat_a"),
      completionDb({ "x-tenant": "acme" }),
    );

    expect(lastTarget().credentials.headers).toEqual({ "x-tenant": "acme" });
  });
});

describe("image seam: resolveRecipeImageTarget", () => {
  it("resolves a dynamic header onto the image request", async () => {
    const seen: RequestInit[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const target = await resolveRecipeImageTarget(
      recipeFor("chat_a", { imageGenSettings: { modelId: IMAGE_SLUG } }),
      imageDb({ [DYNAMIC_HEADER]: { dynamic: "sessionId" } }),
      { envConfig: null, fetchFn },
    );
    expect(target).not.toBeNull();

    // Drive the real adapter so a request is actually made: the assertion is on
    // the outgoing headers, proving the resolved value reaches the wire.
    await expect(
      target!.model.imageGeneration({ prompt: "a cat", width: 1024, height: 1024 }),
    ).rejects.toThrow(/no usable images/i);

    expect(seen[0]?.headers).toMatchObject({ [DYNAMIC_HEADER]: "chat_a" });
  });

  it("still sends a literal header on the image request", async () => {
    const seen: RequestInit[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const target = await resolveRecipeImageTarget(
      recipeFor("chat_a", { imageGenSettings: { modelId: IMAGE_SLUG } }),
      imageDb({ "x-tenant": "acme" }),
      { envConfig: null, fetchFn },
    );

    await expect(
      target!.model.imageGeneration({ prompt: "a cat", width: 1024, height: 1024 }),
    ).rejects.toThrow(/no usable images/i);

    expect(seen[0]?.headers).toMatchObject({ "x-tenant": "acme" });
  });
});

describe("role seam: buildRoleCompletionModel", () => {
  it("resolves sessionId to a stable per-user affinity id for a sessionless call", async () => {
    const headers: Record<string, HeaderValue> = {
      [DYNAMIC_HEADER]: { dynamic: "sessionId" },
      "x-user": { dynamic: "userId" },
    };

    await buildRoleCompletionModel(rolesDb(headers), USER_ID, "siteBuilder");
    const first = lastTarget();
    expect(first.credentials.headers).toEqual({
      [DYNAMIC_HEADER]: `user:${USER_ID}`,
      "x-user": USER_ID,
    });

    // A second sessionless call for the same user must resolve to the same
    // stable affinity value — not a fresh id and not a failure.
    await buildRoleCompletionModel(rolesDb(headers), USER_ID, "siteBuilder");
    expect(lastTarget().credentials.headers).toEqual(first.credentials.headers);
  });

  it("keeps a literal header unchanged on the role path", async () => {
    await buildRoleCompletionModel(
      rolesDb({ "x-tenant": "acme" }),
      USER_ID,
      "siteBuilder",
    );

    expect(lastTarget().credentials.headers).toEqual({ "x-tenant": "acme" });
  });
});
