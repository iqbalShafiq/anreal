import { describe, expect, it } from "vitest";
import { chatAgentRecipeSchema, CHAT_AGENT_RECIPE_VERSION } from "./run-recipe.js";

/**
 * Shape mirrors the fixture in interaction-resume.test.ts, which is the
 * repo's reference for a schema-valid recipe. Returned loosely typed so a test
 * can substitute the model block to exercise the schema.
 */
function baseRecipe(): Record<string, unknown> {
  return {
    version: CHAT_AGENT_RECIPE_VERSION,
    agentId: "chat-agent",
    identity: { sessionId: "s_1", userId: "u_1", projectId: null },
    model: { id: "openai/gpt-6-luna", connectionId: null, reasoningEffort: null },
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
        contextWindowTokens: 1_050_000,
        maxInputTokens: null,
        maxOutputTokens: null,
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
  };
}

describe("chat recipe v8", () => {
  it("is version 8", () => {
    expect(CHAT_AGENT_RECIPE_VERSION).toBe(8);
  });

  it("accepts a null connectionId for catalog models", () => {
    expect(chatAgentRecipeSchema.safeParse(baseRecipe()).success).toBe(true);
  });

  it("accepts a connectionId for BYOK models", () => {
    const recipe = baseRecipe();
    recipe.model = {
      id: "my-openrouter/openai-gpt-5.6-luna",
      connectionId: "pc_1",
      reasoningEffort: "high",
    };
    expect(chatAgentRecipeSchema.safeParse(recipe).success).toBe(true);
  });

  it("accepts the none reasoning effort", () => {
    const recipe = baseRecipe();
    recipe.model = {
      id: "openai/gpt-6-luna",
      connectionId: null,
      reasoningEffort: "none",
    };
    expect(chatAgentRecipeSchema.safeParse(recipe).success).toBe(true);
  });

  it("rejects a connectionId that is not a string or null", () => {
    const recipe = baseRecipe();
    recipe.model = { id: "x", connectionId: 7, reasoningEffort: null };
    expect(chatAgentRecipeSchema.safeParse(recipe).success).toBe(false);
  });

  it("rejects a version 7 recipe", () => {
    const recipe = baseRecipe();
    recipe.version = 7;
    expect(chatAgentRecipeSchema.safeParse(recipe).success).toBe(false);
  });
});
