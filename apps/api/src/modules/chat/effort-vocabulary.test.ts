import { describe, expect, it } from "vitest";
import { REASONING_EFFORTS } from "@anreal/agent";

describe("reasoning effort vocabulary", () => {
  it("includes none so every adapter value is selectable", () => {
    expect(REASONING_EFFORTS).toContain("none");
    expect(REASONING_EFFORTS.length).toBe(7);
  });

  it("is accepted by the client request schema", async () => {
    const { ChatRequestMetadataSchema } = await import("./client-request.js");
    for (const effort of REASONING_EFFORTS) {
      const result = ChatRequestMetadataSchema.safeParse({
        sessionId: "11111111-1111-4111-8111-111111111111",
        documentIds: [],
        modelId: "openai/gpt-6-luna",
        reasoningEffort: effort,
        webSearchEnabled: false,
        imageGenerationEnabled: false,
        deepResearchEnabled: false,
        skillIds: [],
        mcpServerIds: [],
        imageGenSettings: null,
      });
      expect(result.success, `effort ${effort} should be accepted`).toBe(true);
      expect(result.success && result.data.reasoningEffort).toBe(effort);
    }
  });
});
