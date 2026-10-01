import { describe, expect, it } from "vitest";
import {
  canSaveConnection,
  connectionSlugError,
  deriveConnectionSlug,
  draftFromListedModel,
  effortDiff,
  effortWarning,
  geminiHeaderWarning,
  imageCapabilityDraft,
  imageCapabilityPayload,
  imageOutputTypeOptions,
  modelDraftFromPrefill,
  modelOutputType,
  modelSavePayload,
  reasoningEffortsForOutputType,
  slugPreview,
  vendorSuggestion,
  type ImageCapabilityLimits,
} from "./provider-model-draft";

/**
 * The per-kind limits as the server publishes them on `GET
 * /api/providers/kinds` (`imageLimits`). These fixtures stand in for the
 * endpoint response; the binding to the tool's real cap, size table, and ratio
 * rule is asserted where the server computes them
 * (`apps/api/src/modules/provider-connections/router.test.ts`), so the platform
 * never restates the authority. A drift there fails that test; the client
 * simply consumes whatever the endpoint sends.
 */
const OPENROUTER_LIMITS: ImageCapabilityLimits = {
  nMax: 10,
  sizing: "sizes",
  supportsQuality: true,
  supportsBackground: true,
  representableAspectRatios: null,
};

const NATIVE_LIMITS: ImageCapabilityLimits = {
  nMax: 1,
  sizing: "resolutions",
  supportsQuality: false,
  supportsBackground: false,
  // The reduced fractions the native adapters can reach; `21:9`, `19.5:9`,
  // `9:19.5` and `auto` are absent for the reasons the server documents.
  representableAspectRatios: [
    "1:1",
    "3:2",
    "2:3",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
  ],
};

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

describe("geminiHeaderWarning", () => {
  it("warns when a Gemini connection declares custom headers", () => {
    const warning = geminiHeaderWarning("gemini", { "X-Api-Key": "abc" });
    expect(warning).not.toBeNull();
    expect(warning).toMatch(/cannot send custom headers/i);
    expect(warning).toMatch(/API key/i);
  });

  it("does not warn for a Gemini connection with no headers", () => {
    expect(geminiHeaderWarning("gemini", {})).toBeNull();
  });

  it("does not warn for a non-Gemini connection with headers", () => {
    expect(geminiHeaderWarning("compatible", { "X-Api-Key": "abc" })).toBeNull();
    expect(geminiHeaderWarning("grok", { "X-Api-Key": "abc" })).toBeNull();
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

describe("imageOutputTypeOptions", () => {
  it("always offers text and offers image only for an image-capable kind", () => {
    for (const style of [
      "openrouter-images",
      "gemini-native",
      "grok-native",
    ] as const) {
      const values = imageOutputTypeOptions(style).map((option) => option.value);
      expect(values).toEqual(["text", "image"]);
    }
  });

  it("never offers image for a kind with no image endpoint", () => {
    const options = imageOutputTypeOptions("none");
    expect(options.map((option) => option.value)).toEqual(["text"]);
  });
});

describe("reasoningEffortsForOutputType", () => {
  it("clears the reasoning set for an image model", () => {
    expect(reasoningEffortsForOutputType("image", ["low", "high"])).toEqual(
      [],
    );
  });

  it("keeps the set for a text model", () => {
    expect(reasoningEffortsForOutputType("text", ["low", "high"])).toEqual([
      "low",
      "high",
    ]);
  });
});

describe("published image limits", () => {
  it("are consumed verbatim, not re-derived from a kind name", () => {
    // A synthetic set proves the client holds no authority of its own: if it
    // restated the tool's cap or table, these values could not take effect.
    const synthetic: ImageCapabilityLimits = {
      nMax: 3,
      sizing: "resolutions",
      supportsQuality: true,
      supportsBackground: false,
      representableAspectRatios: ["7:5"],
    };
    const built = imageCapabilityPayload(
      {
        nMax: "9",
        aspectRatios: "7:5",
        sizes: "1024x1024",
        resolutions: "4K",
        quality: "ultra",
        background: "transparent",
      },
      synthetic,
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value).toEqual({
        n: { min: 1, max: 3 },
        aspectRatios: ["7:5"],
        resolutions: ["4K"],
        quality: ["ultra"],
      });
    }
  });
});

describe("imageCapabilityDraft", () => {
  it("round-trips a declared capability set through the editor draft", () => {
    const declared = {
      n: { min: 1, max: 4 },
      aspectRatios: ["1:1", "16:9"],
      sizes: ["1024x1024", "1280x720"],
      quality: ["low", "high"],
      background: ["transparent"],
    };
    const draft = imageCapabilityDraft(declared);
    expect(draft.nMax).toBe("4");
    expect(draft.aspectRatios).toBe("1:1, 16:9");
    expect(draft.sizes).toBe("1024x1024, 1280x720");
    expect(draft.quality).toBe("low, high");
    expect(draft.background).toBe("transparent");

    const built = imageCapabilityPayload(draft, OPENROUTER_LIMITS);
    expect(built).toEqual({ ok: true, value: declared });
  });

  it("seeds an empty draft for a row with no declaration", () => {
    expect(imageCapabilityDraft(null)).toEqual({
      nMax: "",
      aspectRatios: "",
      sizes: "",
      resolutions: "",
      quality: "",
      background: "",
    });
  });
});

describe("imageCapabilityPayload — the client half of the per-kind allow-list", () => {
  const openrouter = OPENROUTER_LIMITS;
  const native = NATIVE_LIMITS;

  it("cannot express the sizing key the kind does not accept", () => {
    const draft = {
      nMax: "2",
      aspectRatios: "1:1",
      // A user may still have typed a size; a native kind has no size control.
      sizes: "1024x1024",
      resolutions: "1K",
      quality: "",
      background: "",
    };
    const built = imageCapabilityPayload(draft, native);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value).not.toHaveProperty("sizes");
      expect(built.value).toEqual({
        n: { min: 1, max: native.nMax },
        aspectRatios: ["1:1"],
        resolutions: ["1K"],
      });
    }
  });

  it("cannot express quality or background on a native kind", () => {
    const draft = {
      nMax: "1",
      aspectRatios: "1:1",
      sizes: "",
      resolutions: "1K",
      quality: "low",
      background: "transparent",
    };
    const built = imageCapabilityPayload(draft, native);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value).not.toHaveProperty("quality");
      expect(built.value).not.toHaveProperty("background");
    }
  });

  it("pins n.max to the kind's cap rather than letting a higher value through", () => {
    const overCap = {
      nMax: "99",
      aspectRatios: "1:1",
      sizes: "1024x1024",
      resolutions: "",
      quality: "",
      background: "",
    };
    const built = imageCapabilityPayload(overCap, openrouter);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.n).toEqual({ min: 1, max: openrouter.nMax });
    }

    const nativeOverCap = imageCapabilityPayload(
      {
        ...overCap,
        nMax: "4",
        sizes: "",
        resolutions: "1K",
      },
      native,
    );
    expect(nativeOverCap.ok).toBe(true);
    if (nativeOverCap.ok) {
      expect(nativeOverCap.value.n).toEqual({ min: 1, max: native.nMax });
    }
  });

  it("refuses a native aspect ratio the adapter cannot reach", () => {
    // `21:9` and `auto` are absent from the published representable list; the
    // client refuses them from that list, not from a local rule.
    const unreachable = ["21:9", "auto"].filter(
      (ratio) => !native.representableAspectRatios!.includes(ratio),
    );
    expect(unreachable).toEqual(["21:9", "auto"]);
    const draft = {
      nMax: "1",
      aspectRatios: `1:1, ${unreachable.join(", ")}`,
      sizes: "",
      resolutions: "1K",
      quality: "",
      background: "",
    };
    const built = imageCapabilityPayload(draft, native);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      for (const ratio of unreachable) {
        expect(built.error).toContain(ratio);
      }
    }
  });

  it("reports a missing structural field instead of submitting a refused set", () => {
    const built = imageCapabilityPayload(
      {
        nMax: "1",
        aspectRatios: "",
        sizes: "",
        resolutions: "",
        quality: "",
        background: "",
      },
      openrouter,
    );
    expect(built.ok).toBe(false);
  });
});

describe("modelSavePayload", () => {
  const base = {
    upstreamId: "openai/gpt-image-1",
    name: "GPT Image",
    iconSvg: "",
    contextWindowTokens: 4096,
    maxInputTokens: null,
    maxOutputTokens: null,
  };

  it("never carries imageCapabilities for a text row", () => {
    const payload = modelSavePayload({
      ...base,
      outputType: "text",
      reasoningEfforts: ["low"],
      imageCapabilities: { n: { min: 1, max: 1 }, aspectRatios: ["1:1"] },
    });
    expect(payload).not.toHaveProperty("imageCapabilities");
    expect(payload.reasoningEfforts).toEqual(["low"]);
  });

  it("clears reasoning and always resends the full capability set for an image row", () => {
    const capabilities = {
      n: { min: 1, max: 1 },
      aspectRatios: ["1:1"],
      resolutions: ["1K"],
    };
    const payload = modelSavePayload({
      ...base,
      outputType: "image",
      reasoningEfforts: ["low", "high"],
      imageCapabilities: capabilities,
    });
    expect(payload.reasoningEfforts).toEqual([]);
    // A partial PATCH that omits imageCapabilities writes null, so a save
    // built from a draft must resend the whole set even when nothing changed.
    expect(payload.imageCapabilities).toEqual(capabilities);
  });

  it("omits imageCapabilities entirely when an image row has none to send", () => {
    const payload = modelSavePayload({
      ...base,
      outputType: "image",
      reasoningEfforts: [],
      imageCapabilities: null,
    });
    expect(payload).not.toHaveProperty("imageCapabilities");
  });
});

describe("vendorSuggestion", () => {
  const known = ["openai", "google"];

  it("suggests a known vendor from the upstream id's prefix", () => {
    expect(vendorSuggestion("openai/gpt-5.6-luna", known)).toBe("openai");
  });

  it("never suggests a gateway's own name", () => {
    // `opencode` is a gateway, not a vendor: OpenRouter prefixes the vendor
    // (`openai/gpt-4o`) while OpenCode Zen prefixes itself (`opencode/gpt-5.5`).
    // The prefix must match a *known vendor* or no suggestion is made — the
    // vendor is declared, never derived. Do not "fix" this to return "opencode".
    expect(vendorSuggestion("opencode/gpt-5.5", known)).toBeNull();
  });

  it("makes no suggestion when the id has no prefix", () => {
    expect(vendorSuggestion("gpt-5.5", known)).toBeNull();
  });

  it("matches the prefix case-insensitively", () => {
    expect(vendorSuggestion("OpenAI/gpt-5.6-luna", known)).toBe("openai");
  });

  it("makes no suggestion when no vendors are known", () => {
    expect(vendorSuggestion("openai/gpt-5.6-luna", [])).toBeNull();
  });

  it("makes no suggestion for a trailing-slash id with an empty prefix", () => {
    expect(vendorSuggestion("/gpt-5.6", known)).toBeNull();
  });
});

describe("modelSavePayload — vendorLabel", () => {
  const base = {
    upstreamId: "openai/gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    iconSvg: "",
    contextWindowTokens: 4096,
    maxInputTokens: null,
    maxOutputTokens: null,
  };

  it("carries a declared vendorLabel on a text row", () => {
    const payload = modelSavePayload({
      ...base,
      outputType: "text",
      reasoningEfforts: [],
      imageCapabilities: null,
      vendorLabel: "OpenAI",
    });
    expect(payload.vendorLabel).toBe("OpenAI");
  });

  it("carries a declared vendorLabel on an image row", () => {
    // A vendor is a property of the model, not of its output type.
    const payload = modelSavePayload({
      ...base,
      outputType: "image",
      reasoningEfforts: [],
      imageCapabilities: null,
      vendorLabel: "OpenAI",
    });
    expect(payload.vendorLabel).toBe("OpenAI");
  });

  it("omits vendorLabel when the user cleared it", () => {
    const payload = modelSavePayload({
      ...base,
      outputType: "text",
      reasoningEfforts: [],
      imageCapabilities: null,
      vendorLabel: "",
    });
    expect(payload).not.toHaveProperty("vendorLabel");
  });

  it("omits vendorLabel when it was never set", () => {
    const payload = modelSavePayload({
      ...base,
      outputType: "text",
      reasoningEfforts: [],
      imageCapabilities: null,
      vendorLabel: null,
    });
    expect(payload).not.toHaveProperty("vendorLabel");
  });
});
