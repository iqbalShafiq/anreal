import { describe, expect, it } from "vitest";

import {
  normalizedImageOptionsToProviderOptions,
  type NormalizedImageOptions,
} from "./image-options.js";

describe("normalizedImageOptionsToProviderOptions", () => {
  describe("openrouter-images (compatible)", () => {
    it("reproduces the OpenRouter-shaped keys the tool sends today", () => {
      // Regression pin: this is exactly the block at
      // tools/image-generation.ts:592-601 fed through
      // providers/image-generation.ts:139-145 (Object.assign into the body).
      const options: NormalizedImageOptions = {
        aspectRatio: "16:9",
        quality: "high",
        background: "transparent",
        n: 2,
      };

      expect(normalizedImageOptionsToProviderOptions("compatible", options)).toEqual({
        aspect_ratio: "16:9",
        quality: "high",
        // Transparency needs a PNG, so `background` carries its pairing.
        background: "transparent",
        output_format: "png",
        n: 2,
      });
    });

    it("pairs every background value with output_format png", () => {
      expect(
        normalizedImageOptionsToProviderOptions("compatible", {
          background: "opaque",
        }),
      ).toEqual({ background: "opaque", output_format: "png" });
    });

    it("does not emit output_format when there is no background", () => {
      const result = normalizedImageOptionsToProviderOptions("compatible", {
        aspectRatio: "1:1",
      });

      expect(result).toEqual({ aspect_ratio: "1:1" });
      expect("output_format" in result).toBe(false);
    });
  });

  describe("gemini-native (gemini)", () => {
    it("returns {} for any input, including a full settings object", () => {
      // The Gemini adapter spreads providerOptions and then overwrites
      // `config.imageConfig.aspectRatio` and `model` (dist/index.js:1281-1300),
      // so nothing this layer produces can reach Gemini's wire. Emitting keys
      // would misrepresent that.
      expect(
        normalizedImageOptionsToProviderOptions("gemini", {
          aspectRatio: "9:16",
          quality: "high",
          background: "transparent",
          n: 3,
        }),
      ).toEqual({});
    });

    it("returns {} when no settings were supplied", () => {
      expect(normalizedImageOptionsToProviderOptions("gemini", {})).toEqual({});
    });

    it("returns {} even for an unrecognised aspect ratio", () => {
      expect(
        normalizedImageOptionsToProviderOptions("gemini", {
          aspectRatio: "banana",
        }),
      ).toEqual({});
    });
  });

  describe("grok-native (grok)", () => {
    it("returns {} for any input, including a full settings object", () => {
      // The Grok adapter spreads providerOptions first and then overwrites
      // `aspect_ratio` (dist/index.js:144-153), so nothing this layer produces
      // can reach Grok's wire. Emitting keys would misrepresent that.
      expect(
        normalizedImageOptionsToProviderOptions("grok", {
          aspectRatio: "19.5:9",
          quality: "high",
          background: "transparent",
          n: 2,
        }),
      ).toEqual({});
    });

    it("returns {} when no settings were supplied", () => {
      expect(normalizedImageOptionsToProviderOptions("grok", {})).toEqual({});
    });

    it("returns {} even for an unrecognised aspect ratio", () => {
      expect(
        normalizedImageOptionsToProviderOptions("grok", {
          aspectRatio: "banana",
        }),
      ).toEqual({});
    });
  });

  describe("none (openai, anthropic, mistral)", () => {
    it.each(["openai", "anthropic", "mistral"] as const)(
      "returns {} without throwing for %s",
      (kind) => {
        expect(
          normalizedImageOptionsToProviderOptions(kind, {
            aspectRatio: "1:1",
            quality: "high",
            background: "transparent",
            n: 1,
          }),
        ).toEqual({});
      },
    );
  });

  describe("omitted inputs", () => {
    it("emits no keys for an empty settings object", () => {
      expect(normalizedImageOptionsToProviderOptions("compatible", {})).toEqual(
        {},
      );
      expect(normalizedImageOptionsToProviderOptions("grok", {})).toEqual({});
      // Gemini mirrors Grok: both native adapters overwrite anything this layer
      // could pass, so an empty settings object yields nothing for either.
      expect(normalizedImageOptionsToProviderOptions("gemini", {})).toEqual({});
    });

    it("omits an absent quality rather than emitting undefined", () => {
      const result = normalizedImageOptionsToProviderOptions("compatible", {
        aspectRatio: "1:1",
      });

      expect("quality" in result).toBe(false);
      expect(Object.values(result).includes(undefined)).toBe(false);
    });

    it("keeps n = 0 but omits an absent n", () => {
      expect(
        normalizedImageOptionsToProviderOptions("compatible", { n: 0 }),
      ).toEqual({ n: 0 });
      expect(
        "n" in normalizedImageOptionsToProviderOptions("compatible", {}),
      ).toBe(false);
    });

    it("emits no keys for the native kinds regardless of input", () => {
      // A partial settings object is still nothing to pass to either native
      // adapter, mirroring the full-object cases above.
      for (const kind of ["grok", "gemini"] as const) {
        expect(
          normalizedImageOptionsToProviderOptions(kind, { quality: "high" }),
        ).toEqual({});
        expect(
          normalizedImageOptionsToProviderOptions(kind, { background: "opaque" }),
        ).toEqual({});
      }
    });
  });

  describe("unrecognised aspect ratios", () => {
    it("does not throw for an unknown string", () => {
      expect(() =>
        normalizedImageOptionsToProviderOptions("compatible", {
          aspectRatio: "banana",
        }),
      ).not.toThrow();
      expect(() =>
        normalizedImageOptionsToProviderOptions("gemini", {
          aspectRatio: "banana",
        }),
      ).not.toThrow();
      expect(() =>
        normalizedImageOptionsToProviderOptions("grok", {
          aspectRatio: "banana",
        }),
      ).not.toThrow();
    });
  });
});
