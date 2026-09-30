import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BYOK models are only reachable through the owner's `providerModel` rows, so
 * both the recipe resolver and the worker-side model rebuild must carry the
 * user id all the way down. `byok-recipe.test.ts` only checks the recipe
 * schema; this file drives the real `findActiveModel` against a fake Prisma
 * row and the real completion-model rebuild so a missing user id fails here.
 */

const db = vi.hoisted(() => ({
  chatModelFindFirst: vi.fn(),
  providerModelFindFirst: vi.fn(),
}));

vi.mock("../../utils/prisma.js", () => ({
  prisma: {
    chatModel: { findFirst: db.chatModelFindFirst },
    providerModel: { findFirst: db.providerModelFindFirst },
    chatSession: { findFirst: vi.fn(async () => ({ projectId: null })) },
    project: { findFirst: vi.fn(async () => null) },
  },
}));

import { encodeProviderCredentials } from "../provider-connections/credentials.js";
import {
  resolveChatAgentRecipe,
  resolveRecipeCompletionModel,
} from "./build-run-input.js";
import { ProviderConnectionMissingError, parseChatAgentRecipe } from "./run-recipe.js";

const BYOK_MODEL_ID = "my-openrouter/openai-gpt-5.6-luna";
const USER_ID = "user-1";
const CONNECTION_ID = "pc_1";

function providerModelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pm_1",
    slug: BYOK_MODEL_ID,
    upstreamId: "openai/gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    label: "GPT 5.6 Luna",
    hint: null,
    description: null,
    iconSvg: "",
    outputType: "text",
    contextWindowTokens: 1_000_000,
    maxInputTokens: null,
    maxOutputTokens: 128_000,
    reasoningEfforts: ["low", "high"],
    capabilities: { streaming: true, tools: true, imageInput: true },
    imageCapabilities: null,
    isActive: true,
    sortOrder: 0,
    connectionId: CONNECTION_ID,
    connection: { slug: "my-openrouter", label: "My OpenRouter" },
    ...overrides,
  };
}

/** Every live reader the recipe resolver needs, stubbed to inert values. */
function resolverDependencies() {
  return {
    resolveActiveDocuments: async () => [],
    listActiveImages: async () => [],
    getActiveSnippet: async () => null,
    webSearchConfig: () => null,
    imageGenerationConfig: () => null,
    loadImageModelCapabilities: async () => [],
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

describe("BYOK recipe resolution", () => {
  beforeEach(() => {
    db.chatModelFindFirst.mockReset().mockResolvedValue(null);
    db.providerModelFindFirst.mockReset().mockResolvedValue(providerModelRow());
  });

  it("carries the connection id and the owner's id for a BYOK model", async () => {
    const recipe = await resolveChatAgentRecipe({
      sessionId: "session-1",
      userId: USER_ID,
      model: BYOK_MODEL_ID,
      reasoningEffort: null,
      traceId: "trace-1",
      consumeSingleUseContext: false,
      dependencies: resolverDependencies(),
    });

    expect(recipe.model.id).toBe(BYOK_MODEL_ID);
    expect(recipe.model.connectionId).toBe(CONNECTION_ID);
    // The catalog lookup is user-scoped; an unscoped lookup never sees the row.
    expect(db.providerModelFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: BYOK_MODEL_ID,
          userId: USER_ID,
        }),
      }),
    );
  });

  it("rejects a BYOK model id that has no owned row", async () => {
    db.providerModelFindFirst.mockResolvedValue(null);
    await expect(
      resolveChatAgentRecipe({
        sessionId: "session-1",
        userId: USER_ID,
        model: BYOK_MODEL_ID,
        reasoningEffort: null,
        traceId: "trace-1",
        consumeSingleUseContext: false,
        dependencies: resolverDependencies(),
      }),
    ).rejects.toThrow(/unknown model/i);
  });
});

function byokRecipe() {
  const value = {
    version: 8,
    agentId: "chat-agent",
    identity: { sessionId: "session-1", userId: USER_ID, projectId: null },
    model: { id: BYOK_MODEL_ID, connectionId: CONNECTION_ID, reasoningEffort: null },
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
    trace: { traceId: "trace-1" },
  } as Record<string, unknown>;
  return parseChatAgentRecipe(value);
}

describe("resolveRecipeCompletionModel", () => {
  function connectionRow() {
    return {
      kind: "compatible",
      baseUrl: "https://gw.example/v1",
      api: "chat",
      credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
      models: [
        {
          // The stored upstream id, deliberately not the sanitized slug.
          upstreamId: "openai/GPT-5.6 Luna",
          reasoningEfforts: ["low", "high"],
        },
      ],
    };
  }

  it("rebuilds a BYOK model from the stored connection row", async () => {
    const model = await resolveRecipeCompletionModel(byokRecipe(), {
      providerConnection: {
        findFirst: vi.fn(async () => connectionRow()),
      },
    } as never);

    expect(model.modelId).toBe("openai/GPT-5.6 Luna");
  });

  it("throws when the connection row is gone", async () => {
    await expect(
      resolveRecipeCompletionModel(byokRecipe(), {
        providerConnection: { findFirst: vi.fn(async () => null) },
      } as never),
    ).rejects.toBeInstanceOf(ProviderConnectionMissingError);
  });
});
