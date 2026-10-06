import { describe, expect, it } from "vitest";
import {
  MODEL_ROLE_KEYS,
  roleModelOptions,
  modelRoleLabel,
} from "./model-role-labels";

describe("MODEL_ROLE_KEYS", () => {
  it("lists the five background roles in order", () => {
    expect([...MODEL_ROLE_KEYS]).toEqual([
      "memoryCompaction",
      "profileSummary",
      "siteBuilder",
      "visionHelper",
      "scheduledChat",
    ]);
  });
});

describe("modelRoleLabel", () => {
  it("names every role", () => {
    expect(modelRoleLabel("memoryCompaction")).toBe("Memory compaction");
    expect(modelRoleLabel("profileSummary")).toBe("Profile summary");
    expect(modelRoleLabel("siteBuilder")).toBe("Site builder");
    expect(modelRoleLabel("visionHelper")).toBe("Image understanding");
    expect(modelRoleLabel("scheduledChat")).toBe("Scheduled chats");
  });
});

describe("roleModelOptions", () => {
  const catalog = [
    { modelId: "openai/gpt-6-luna", name: "GPT 6 Luna", inputModalities: ["text", "image"] },
    { modelId: "deepseek/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", inputModalities: ["text"] },
  ] as never;

  it("always offers the default as the empty option", () => {
    const options = roleModelOptions("siteBuilder", catalog, "meta/muse-spark");
    expect(options[0]).toMatchObject({ value: "" });
    expect(options[0]?.label).toMatch(/default/i);
  });

  it("names the default model when the catalog still has it", () => {
    const options = roleModelOptions("siteBuilder", catalog, "openai/gpt-6-luna");
    expect(options[0]?.label).toBe("Default (GPT 6 Luna)");
  });

  it("filters the vision helper to models that accept images", () => {
    const options = roleModelOptions("visionHelper", catalog, null);
    const values = options.map((option) => option.value);
    expect(values).toContain("openai/gpt-6-luna");
    expect(values).not.toContain("deepseek/deepseek-v4-flash-0731");
  });

  it("does not filter any other role", () => {
    const options = roleModelOptions("siteBuilder", catalog, null);
    expect(options.map((option) => option.value)).toContain(
      "deepseek/deepseek-v4-flash-0731",
    );
  });
});
