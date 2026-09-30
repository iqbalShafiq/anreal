import { describe, expect, it } from "vitest";
import {
  draftFromListedModel,
  effortDiff,
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
