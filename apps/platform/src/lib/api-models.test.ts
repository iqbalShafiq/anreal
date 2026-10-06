import { describe, expect, it } from "vitest";
import {
  normalizeModelRow,
  normalizeProviderModelRow,
  type ModelInfo,
  type ProviderModelRow,
} from "./api";
import { EMPTY_PICKER_FILTERS, filterModels, sortModels } from "./model-picker";

/** A row as an older server might send it: no `vendorLabel` at all. */
function rowWithoutVendorLabel(): ModelInfo {
  const row = {
    modelId: "openai/legacy",
    label: "Legacy",
    name: "Legacy",
    hint: null,
    description: null,
    iconSvg: "",
    provider: { slug: "openai", name: "OpenAI" },
    contextWindowTokens: 128_000,
    maxInputTokens: null,
    maxOutputTokens: null,
    prices: {
      input: null,
      cachedInput: null,
      output: null,
      cacheWriteMultiplier: null,
      longPromptThresholdTokens: null,
      longPromptInputMultiplier: null,
      longPromptOutputMultiplier: null,
    },
    reasoningEfforts: [],
    source: "catalog",
    connectionId: null,
    outputType: "text",
    imageCapabilities: null,
    inputModalities: ["text"],
    sortOrder: 0,
  };
  // Deliberately omit vendorLabel to model a pre-field server.
  return row as unknown as ModelInfo;
}

describe("normalizeModelRow", () => {
  it("parses a row without vendorLabel to null", () => {
    expect(normalizeModelRow(rowWithoutVendorLabel()).vendorLabel).toBeNull();
  });

  it("keeps a declared vendorLabel and normalises its siblings", () => {
    const row = {
      ...rowWithoutVendorLabel(),
      vendorLabel: "OpenAI",
    } as ModelInfo;
    const normalized = normalizeModelRow(row);
    expect(normalized.vendorLabel).toBe("OpenAI");
    expect(normalized.source).toBe("catalog");
    expect(normalized.connectionId).toBeNull();
  });

  it("does not throw when a vendor filter or sort reads a normalised row", () => {
    // A connection row: its vendor is whatever was declared, so with none it
    // resolves to null — the case `vendorOf` must survive.
    const model = normalizeModelRow({
      ...rowWithoutVendorLabel(),
      source: "connection",
      connectionId: "conn-1",
    });

    expect(() =>
      filterModels([model], { ...EMPTY_PICKER_FILTERS, vendors: ["OpenAI"] }),
    ).not.toThrow();
    expect(() => sortModels([model], "vendor")).not.toThrow();
    expect(
      filterModels([model], { ...EMPTY_PICKER_FILTERS, vendors: ["OpenAI"] }),
    ).toHaveLength(0);
    // With no vendor selected it stays listed.
    expect(filterModels([model], EMPTY_PICKER_FILTERS)).toHaveLength(1);
  });
});

describe("normalizeProviderModelRow", () => {
  /** A settings row as a pre-`vendorLabel` server would send it. */
  function rowWithoutVendorLabel(): ProviderModelRow {
    const row = {
      id: "m1",
      slug: "gw/model-x",
      upstreamId: "x/model-x",
      name: "Model X",
      label: "Model X",
      hint: null,
      description: null,
      iconSvg: "",
      outputType: "text",
      contextWindowTokens: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      reasoningEfforts: [],
      capabilities: null,
      imageCapabilities: null,
      isActive: true,
      sortOrder: 0,
      connectionId: "conn-1",
      createdAt: "",
      updatedAt: "",
    };
    // Deliberately omit vendorLabel to model a pre-field server.
    return row as unknown as ProviderModelRow;
  }

  it("parses a row without vendorLabel to null", () => {
    expect(normalizeProviderModelRow(rowWithoutVendorLabel()).vendorLabel).toBeNull();
  });

  it("keeps a declared vendorLabel", () => {
    const row = { ...rowWithoutVendorLabel(), vendorLabel: "OpenAI" };
    expect(normalizeProviderModelRow(row).vendorLabel).toBe("OpenAI");
  });
});
