import { describe, expect, it } from "vitest";
import {
  canSaveConnection,
  connectionSlugError,
  deriveConnectionSlug,
  draftFromListedModel,
  effortDiff,
  effortWarning,
  modelDraftFromPrefill,
  modelOutputType,
  slugPreview,
} from "./provider-model-draft";

describe("slugPreview", () => {
  it("mirrors the server slug rule", () => {
    expect(slugPreview("my-openrouter", "openai/GPT-5.6 Luna")).toBe(
      "my-openrouter/openai-gpt-5.6-luna",
    );
  });

  it("falls back for ids that sanitise to nothing", () => {
    expect(slugPreview("gw", "模型")).toBe("gw/custom");
  });
});

describe("effortDiff", () => {
  it("reports values the adapter does not declare", () => {
    expect(effortDiff(["low", "high", "max"], ["low", "high"])).toEqual({
      unsupported: ["max"],
      missing: [],
    });
  });

  it("reports adapter values the user has not selected", () => {
    expect(effortDiff(["low"], ["low", "high"])).toEqual({
      unsupported: [],
      missing: ["high"],
    });
  });

  it("is empty when the sets match", () => {
    expect(effortDiff(["low", "high"], ["high", "low"])).toEqual({
      unsupported: [],
      missing: [],
    });
  });
});

describe("draftFromListedModel", () => {
  it("prefills name, context window, and the adapter effort set", () => {
    const draft = draftFromListedModel({
      listed: { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna", contextLength: 1_000_000 },
      adapterEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
    });
    expect(draft).toEqual({
      upstreamId: "openai/gpt-5.6-luna",
      name: "GPT 5.6 Luna",
      contextWindowTokens: 1_000_000,
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    });
  });

  it("falls back to the id as the display name", () => {
    const draft = draftFromListedModel({
      listed: { id: "gw/model-x" },
      adapterEfforts: [],
      defaultEffort: null,
    });
    expect(draft.name).toBe("gw/model-x");
    expect(draft.contextWindowTokens).toBeNull();
    expect(draft.reasoningEfforts).toEqual([]);
  });
});

describe("connection slug helpers", () => {
  it("derives the server slug from a label", () => {
    expect(deriveConnectionSlug("My OpenRouter Gateway")).toBe(
      "my-openrouter-gateway",
    );
    expect(deriveConnectionSlug("!!!")).toBe("provider");
  });

  it("rejects slugs the server would refuse", () => {
    expect(connectionSlugError("my-openrouter")).toBeNull();
    expect(connectionSlugError("")).toBeNull();
    expect(connectionSlugError("My-OpenRouter")).toMatch(/lowercase/i);
    expect(connectionSlugError("my--gateway")).toMatch(/lowercase/i);
  });
});

describe("canSaveConnection", () => {
  it("gates a new connection on a passing test", () => {
    expect(canSaveConnection({ isNew: true, testPassed: false })).toBe(false);
    expect(canSaveConnection({ isNew: true, testPassed: true })).toBe(true);
  });

  it("lets an existing connection save without a test", () => {
    expect(canSaveConnection({ isNew: false, testPassed: false })).toBe(true);
  });
});

describe("modelDraftFromPrefill", () => {
  it("maps provider-reported limits into form strings", () => {
    expect(
      modelDraftFromPrefill({
        name: "GPT 5.6 Luna",
        contextWindowTokens: 1_000_000,
        maxInputTokens: 800_000,
        maxOutputTokens: 64_000,
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "medium",
        capabilities: null,
        providerReported: true,
      }),
    ).toEqual({
      name: "GPT 5.6 Luna",
      contextWindowTokens: "1000000",
      maxInputTokens: "800000",
      maxOutputTokens: "64000",
      reasoningEfforts: ["low", "high", "medium"],
      providerReported: true,
    });
  });

  it("leaves limits empty and flags an unreported adapter entry", () => {
    const draft = modelDraftFromPrefill({
      name: "gateway/model-x",
      contextWindowTokens: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      reasoningEfforts: [],
      defaultReasoningEffort: null,
      capabilities: null,
      providerReported: false,
    });
    expect(draft.contextWindowTokens).toBe("");
    expect(draft.providerReported).toBe(false);
    expect(draft.reasoningEfforts).toEqual([]);
  });
});

describe("modelOutputType", () => {
  it("registers new models as text", () => {
    expect(modelOutputType(null)).toBe("text");
    expect(modelOutputType(undefined)).toBe("text");
    expect(modelOutputType("text")).toBe("text");
  });

  it("preserves an existing image model", () => {
    expect(modelOutputType("image")).toBe("image");
  });
});

describe("effortWarning", () => {
  it("returns null when the sets agree or the adapter is unknown", () => {
    expect(effortWarning(["low"], ["low"])).toBeNull();
    expect(effortWarning(["low"], [])).toBeNull();
  });

  it("names both divergences", () => {
    const warning = effortWarning(["low", "max"], ["low", "high"]);
    expect(warning).toContain("does not accept max");
    expect(warning).toContain("also declares high");
  });
});
