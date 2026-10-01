import { describe, expect, it } from "vitest";
import {
  EMPTY_PICKER_FILTERS,
  PICKER_SORTS,
  filterModels,
  isFilterActive,
  pickerFacets,
  sortModels,
  type PickerFilterState,
  type PickerSource,
} from "./model-picker";

/**
 * A structural `PickerSource` factory. The module declares the shape itself
 * (never importing `ModelInfo`), so the tests build plain objects — the same
 * pattern `model-role-labels.test.ts` uses.
 */
function source(overrides: Partial<PickerSource> & { modelId: string }): PickerSource {
  return {
    name: overrides.modelId,
    label: overrides.modelId,
    hint: null,
    provider: { slug: "catalog", name: "Catalog" },
    vendorLabel: null,
    source: "catalog",
    inputModalities: ["text"],
    reasoningEfforts: [],
    contextWindowTokens: 128_000,
    prices: { input: 1 },
    ...overrides,
  };
}

function filters(overrides: Partial<PickerFilterState>): PickerFilterState {
  return { ...EMPTY_PICKER_FILTERS, ...overrides };
}

function ids(models: readonly PickerSource[]): string[] {
  return models.map((model) => model.modelId);
}

/** True when the two lists hold the same models regardless of order. */
function unorderedEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().join(",") === [...expected].sort().join(",")
  );
}

describe("EMPTY_PICKER_FILTERS / PICKER_SORTS", () => {
  it("starts with no query, no selections, and no context floor", () => {
    expect(EMPTY_PICKER_FILTERS).toEqual({
      query: "",
      vendors: [],
      connections: [],
      capabilities: [],
      minContext: null,
    });
  });

  it("offers the five sorts in the spec's order", () => {
    expect(PICKER_SORTS.map((entry) => entry.key)).toEqual([
      "default",
      "name",
      "price",
      "context",
      "vendor",
    ]);
  });
});

describe("filterModels — query", () => {
  const models = [
    source({
      modelId: "openai/gpt-6-luna",
      name: "GPT 6 Luna",
      label: "GPT 6 Luna",
      provider: { slug: "openai", name: "OpenAI" },
    }),
    source({
      modelId: "byok/vision-thing",
      name: "Vision Thing",
      label: "Vision Thing",
      provider: { slug: "byok", name: "My Endpoint" },
      source: "connection",
      vendorLabel: "Acme Labs",
      inputModalities: ["text", "image"],
    }),
  ];

  it("matches name, case-insensitively", () => {
    expect(ids(filterModels(models, filters({ query: "luna" })))).toEqual([
      "openai/gpt-6-luna",
    ]);
  });

  it("matches label", () => {
    const labelled = [
      source({ modelId: "x/one", name: "Display", label: "Labeled One" }),
    ];
    expect(ids(filterModels(labelled, filters({ query: "labeled" })))).toEqual([
      "x/one",
    ]);
  });

  it("matches modelId", () => {
    expect(ids(filterModels(models, filters({ query: "gpt-6" })))).toEqual([
      "openai/gpt-6-luna",
    ]);
  });

  it("matches provider.name", () => {
    expect(ids(filterModels(models, filters({ query: "openai" })))).toEqual([
      "openai/gpt-6-luna",
    ]);
  });

  it("matches vendorLabel", () => {
    expect(ids(filterModels(models, filters({ query: "acme" })))).toEqual([
      "byok/vision-thing",
    ]);
  });

  it("matches the capability words vision, document, documents and reasoning", () => {
    const vision = filterModels(models, filters({ query: "vision" }));
    expect(ids(vision)).toContain("byok/vision-thing");

    const documenting = [
      source({ modelId: "x/doc", inputModalities: ["text", "document"] }),
    ];
    expect(ids(filterModels(documenting, filters({ query: "document" })))).toEqual([
      "x/doc",
    ]);
    expect(ids(filterModels(documenting, filters({ query: "documents" })))).toEqual([
      "x/doc",
    ]);

    const reasoning = [
      source({ modelId: "x/think", reasoningEfforts: ["high"] }),
    ];
    expect(ids(filterModels(reasoning, filters({ query: "reasoning" })))).toEqual([
      "x/think",
    ]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterModels(models, filters({ query: "zzz-nope" }))).toEqual([]);
  });
});

describe("filterModels — vendor filter", () => {
  it("matches a BYOK model by its declared vendorLabel", () => {
    const byok = source({
      modelId: "byok/one",
      source: "connection",
      vendorLabel: "Acme Labs",
    });
    expect(ids(filterModels([byok], filters({ vendors: ["Acme Labs"] })))).toEqual([
      "byok/one",
    ]);
  });

  it("does not match a model whose vendor is null (Review Focus 1)", () => {
    const undeclared = source({
      modelId: "byok/undeclared",
      source: "connection",
      vendorLabel: null,
    });
    expect(filterModels([undeclared], filters({ vendors: ["Acme Labs"] }))).toEqual(
      [],
    );
  });

  it("still returns the null-vendor model when no vendor is selected", () => {
    const undeclared = source({
      modelId: "byok/undeclared",
      source: "connection",
      vendorLabel: null,
    });
    expect(ids(filterModels([undeclared], filters({})))).toEqual([
      "byok/undeclared",
    ]);
  });

  it("matches a catalog model by its provider.name", () => {
    const catalog = source({
      modelId: "openai/gpt-6-luna",
      provider: { slug: "openai", name: "OpenAI" },
      vendorLabel: null,
    });
    expect(ids(filterModels([catalog], filters({ vendors: ["OpenAI"] })))).toEqual([
      "openai/gpt-6-luna",
    ]);
  });

  it("does not offer a catalog model under a vendor it does not serve", () => {
    const catalog = source({
      modelId: "openai/gpt-6-luna",
      provider: { slug: "openai", name: "OpenAI" },
    });
    expect(filterModels([catalog], filters({ vendors: ["Acme Labs"] }))).toEqual([]);
  });
});

describe("filterModels — connection filter", () => {
  it("matches only connection rows whose provider.slug is selected", () => {
    const mine = source({
      modelId: "byok/one",
      source: "connection",
      provider: { slug: "my-openrouter", name: "My OpenRouter" },
    });
    const other = source({
      modelId: "byok/two",
      source: "connection",
      provider: { slug: "other", name: "Other" },
    });
    expect(
      ids(filterModels([mine, other], filters({ connections: ["my-openrouter"] }))),
    ).toEqual(["byok/one"]);
  });

  it("never matches a catalog row", () => {
    const catalog = source({
      modelId: "openai/gpt-6-luna",
      source: "catalog",
      provider: { slug: "openai", name: "OpenAI" },
    });
    expect(
      filterModels([catalog], filters({ connections: ["openai"] })),
    ).toEqual([]);
  });
});

describe("filterModels — capability filter", () => {
  const models = [
    source({ modelId: "x/vision", inputModalities: ["text", "image"] }),
    source({ modelId: "x/doc", inputModalities: ["text", "document"] }),
    source({ modelId: "x/reason", reasoningEfforts: ["low", "high"] }),
    source({ modelId: "x/plain" }),
  ];

  it("vision requires inputModalities to include image", () => {
    expect(ids(filterModels(models, filters({ capabilities: ["vision"] })))).toEqual([
      "x/vision",
    ]);
  });

  it("documents requires inputModalities to include document", () => {
    expect(
      ids(filterModels(models, filters({ capabilities: ["documents"] }))),
    ).toEqual(["x/doc"]);
  });

  it("reasoning requires a non-empty reasoningEfforts", () => {
    expect(
      ids(filterModels(models, filters({ capabilities: ["reasoning"] }))),
    ).toEqual(["x/reason"]);
  });
});

describe("filterModels — context threshold", () => {
  it("includes a model exactly at the threshold", () => {
    const at = source({ modelId: "x/at", contextWindowTokens: 200_000 });
    expect(ids(filterModels([at], filters({ minContext: 200_000 })))).toEqual([
      "x/at",
    ]);
  });

  it("excludes a model with contextWindowTokens === 0 (Review Focus 3)", () => {
    const undeclared = source({ modelId: "x/unknown", contextWindowTokens: 0 });
    expect(filterModels([undeclared], filters({ minContext: 200_000 }))).toEqual(
      [],
    );
  });

  it("excludes a smaller declared window", () => {
    const small = source({ modelId: "x/small", contextWindowTokens: 128_000 });
    expect(filterModels([small], filters({ minContext: 200_000 }))).toEqual([]);
  });
});

describe("filterModels — AND across groups, OR within a group", () => {
  const a = source({
    modelId: "a/vision",
    source: "connection",
    provider: { slug: "a", name: "A" },
    inputModalities: ["text", "image"],
  });
  const aPlain = source({
    modelId: "a/plain",
    source: "connection",
    provider: { slug: "a", name: "A" },
  });
  const bVision = source({
    modelId: "b/vision",
    source: "connection",
    provider: { slug: "b", name: "B" },
    inputModalities: ["text", "image"],
  });

  it("ANDs capability with connection", () => {
    expect(
      ids(
        filterModels(
          [a, aPlain, bVision],
          filters({ capabilities: ["vision"], connections: ["a"] }),
        ),
      ),
    ).toEqual(["a/vision"]);
  });

  it("ORs within the capability group", () => {
    const models = [
      source({ modelId: "x/vision", inputModalities: ["text", "image"] }),
      source({ modelId: "x/reason", reasoningEfforts: ["high"] }),
      source({ modelId: "x/plain" }),
    ];
    const result = filterModels(models, filters({ capabilities: ["vision", "reasoning"] }));
    expect(unorderedEqual(ids(result), ["x/vision", "x/reason"])).toBe(true);
  });

  it("treats an empty group as no constraint", () => {
    const models = [a, aPlain, bVision];
    expect(unorderedEqual(ids(filterModels(models, filters({}))), ids(models))).toBe(
      true,
    );
  });
});

describe("sortModels", () => {
  it("default preserves the input order", () => {
    const models = [
      source({ modelId: "z/last" }),
      source({ modelId: "a/first" }),
      source({ modelId: "m/middle" }),
    ];
    expect(ids(sortModels(models, "default"))).toEqual([
      "z/last",
      "a/first",
      "m/middle",
    ]);
  });

  it("name sorts A→Z", () => {
    const models = [
      source({ modelId: "x/b", name: "Beta" }),
      source({ modelId: "x/a", name: "Alpha" }),
      source({ modelId: "x/c", name: "Gamma" }),
    ];
    expect(ids(sortModels(models, "name"))).toEqual(["x/a", "x/b", "x/c"]);
  });

  it("price sorts cheapest first with a null price last", () => {
    const models = [
      source({ modelId: "x/free", prices: { input: null } }),
      source({ modelId: "x/cheap", prices: { input: 0.5 } }),
      source({ modelId: "x/pricey", prices: { input: 10 } }),
    ];
    expect(ids(sortModels(models, "price"))).toEqual([
      "x/cheap",
      "x/pricey",
      "x/free",
    ]);
  });

  it("context sorts largest first with 0 (undeclared) last", () => {
    const models = [
      source({ modelId: "x/unknown", contextWindowTokens: 0 }),
      source({ modelId: "x/small", contextWindowTokens: 128_000 }),
      source({ modelId: "x/big", contextWindowTokens: 1_000_000 }),
    ];
    expect(ids(sortModels(models, "context"))).toEqual([
      "x/big",
      "x/small",
      "x/unknown",
    ]);
  });

  it("vendor groups by vendor then by name, undeclared vendor last", () => {
    const models = [
      source({ modelId: "x/zeta", name: "Zeta", vendorLabel: "Acme" }),
      source({ modelId: "x/alpha", name: "Alpha", vendorLabel: "Acme" }),
      source({ modelId: "x/beta", name: "Beta", vendorLabel: "Globex" }),
      source({
        modelId: "x/none",
        name: "None",
        vendorLabel: null,
        source: "connection",
      }),
    ];
    expect(ids(sortModels(models, "vendor"))).toEqual([
      "x/alpha",
      "x/zeta",
      "x/beta",
      "x/none",
    ]);
  });

  it("sorts an unknown vendor last, not under a guessed vendor", () => {
    const models = [
      source({
        modelId: "x/none",
        name: "None",
        vendorLabel: null,
        source: "connection",
      }),
      source({ modelId: "x/beta", name: "Beta", vendorLabel: "Globex" }),
    ];
    expect(ids(sortModels(models, "vendor"))).toEqual(["x/beta", "x/none"]);
  });

  it("is stable for equal keys under name", () => {
    const models = [
      source({ modelId: "x/first", name: "Same" }),
      source({ modelId: "x/second", name: "Same" }),
      source({ modelId: "x/third", name: "Same" }),
    ];
    expect(ids(sortModels(models, "name"))).toEqual([
      "x/first",
      "x/second",
      "x/third",
    ]);
  });

  it("is stable for equal keys under price", () => {
    const models = [
      source({ modelId: "x/first", prices: { input: 1 } }),
      source({ modelId: "x/second", prices: { input: 1 } }),
    ];
    expect(ids(sortModels(models, "price"))).toEqual(["x/first", "x/second"]);
  });

  it("is stable for equal keys under context and vendor", () => {
    const sameContext = [
      source({ modelId: "x/first", contextWindowTokens: 0 }),
      source({ modelId: "x/second", contextWindowTokens: 0 }),
    ];
    expect(ids(sortModels(sameContext, "context"))).toEqual([
      "x/first",
      "x/second",
    ]);

    const sameVendor = [
      source({ modelId: "x/first", name: "Same", vendorLabel: "Acme" }),
      source({ modelId: "x/second", name: "Same", vendorLabel: "Acme" }),
    ];
    expect(ids(sortModels(sameVendor, "vendor"))).toEqual([
      "x/first",
      "x/second",
    ]);
  });

  it("does not mutate the input array", () => {
    const models = [
      source({ modelId: "x/b", name: "Beta" }),
      source({ modelId: "x/a", name: "Alpha" }),
    ];
    const order = ids(models);
    sortModels(models, "name");
    expect(ids(models)).toEqual(order);
  });
});

describe("pickerFacets", () => {
  it("returns the distinct vendor list", () => {
    const models = [
      source({ modelId: "x/one", vendorLabel: "Acme" }),
      source({ modelId: "x/two", vendorLabel: "Acme" }),
      source({ modelId: "x/three", vendorLabel: "Globex" }),
    ];
    expect(pickerFacets(models).vendors).toEqual(["Acme", "Globex"]);
  });

  it("uses a catalog model's provider.name as its vendor", () => {
    const models = [
      source({
        modelId: "openai/gpt-6-luna",
        provider: { slug: "openai", name: "OpenAI" },
        vendorLabel: null,
      }),
    ];
    expect(pickerFacets(models).vendors).toEqual(["OpenAI"]);
  });

  it("omits models whose vendor is unknown", () => {
    const byok = source({ modelId: "x/none", vendorLabel: null, source: "connection" });
    expect(pickerFacets([byok]).vendors).toEqual([]);
  });

  it("returns connections only for connection rows, distinct and named", () => {
    const models = [
      source({
        modelId: "byok/one",
        source: "connection",
        provider: { slug: "a", name: "A" },
      }),
      source({
        modelId: "byok/two",
        source: "connection",
        provider: { slug: "a", name: "A" },
      }),
      source({
        modelId: "byok/three",
        source: "connection",
        provider: { slug: "b", name: "B" },
      }),
      source({ modelId: "openai/catalog", source: "catalog" }),
    ];
    expect(pickerFacets(models).connections).toEqual([
      { slug: "a", name: "A" },
      { slug: "b", name: "B" },
    ]);
  });

  it("returns no connections when the catalog has none", () => {
    const models = [source({ modelId: "openai/catalog", source: "catalog" })];
    expect(pickerFacets(models).connections).toEqual([]);
  });

  it("lists only capabilities that at least one model has", () => {
    const models = [
      source({ modelId: "x/vision", inputModalities: ["text", "image"] }),
      source({ modelId: "x/plain" }),
    ];
    const facets = pickerFacets(models);
    expect(facets.capabilities).toEqual(["vision"]);
  });

  it("lists all three capabilities when all are present", () => {
    const models = [
      source({
        modelId: "x/all",
        inputModalities: ["text", "image", "document"],
        reasoningEfforts: ["high"],
      }),
    ];
    expect(pickerFacets(models).capabilities).toEqual([
      "vision",
      "documents",
      "reasoning",
    ]);
  });

  it("returns no context thresholds when every model sits at the same window", () => {
    const models = [
      source({ modelId: "x/one", contextWindowTokens: 200_000 }),
      source({ modelId: "x/two", contextWindowTokens: 200_000 }),
    ];
    expect(pickerFacets(models).contextThresholds).toEqual([]);
  });

  it("excludes a threshold every model meets (cannot split)", () => {
    const models = [
      source({ modelId: "x/one", contextWindowTokens: 1_000_000 }),
      source({ modelId: "x/two", contextWindowTokens: 200_000 }),
    ];
    // Every model meets 200K, so only 1M can discriminate.
    expect(pickerFacets(models).contextThresholds).toEqual([1_000_000]);
  });

  it("includes 200K and 1M only when the spread spans them", () => {
    const models = [
      source({ modelId: "x/small", contextWindowTokens: 100_000 }),
      source({ modelId: "x/big", contextWindowTokens: 1_000_000 }),
    ];
    expect(pickerFacets(models).contextThresholds).toEqual([200_000, 1_000_000]);
  });

  it("is not confused by an undeclared window (0)", () => {
    const models = [
      source({ modelId: "x/unknown", contextWindowTokens: 0 }),
      source({ modelId: "x/big", contextWindowTokens: 1_000_000 }),
    ];
    expect(pickerFacets(models).contextThresholds).toEqual([200_000, 1_000_000]);
  });

  it("returns empty facets for an empty catalog", () => {
    expect(pickerFacets([])).toEqual({
      vendors: [],
      connections: [],
      capabilities: [],
      contextThresholds: [],
    });
  });
});

describe("isFilterActive", () => {
  it("is false for EMPTY_PICKER_FILTERS", () => {
    expect(isFilterActive(EMPTY_PICKER_FILTERS)).toBe(false);
  });

  it("is true when the query is set", () => {
    expect(isFilterActive(filters({ query: "gpt" }))).toBe(true);
  });

  it("is true when a vendor is selected", () => {
    expect(isFilterActive(filters({ vendors: ["Acme"] }))).toBe(true);
  });

  it("is true when a connection is selected", () => {
    expect(isFilterActive(filters({ connections: ["a"] }))).toBe(true);
  });

  it("is true when a capability is selected", () => {
    expect(isFilterActive(filters({ capabilities: ["vision"] }))).toBe(true);
  });

  it("is true when a context floor is set", () => {
    expect(isFilterActive(filters({ minContext: 200_000 }))).toBe(true);
  });

  it("ignores whitespace-only query", () => {
    expect(isFilterActive(filters({ query: "   " }))).toBe(false);
  });
});
