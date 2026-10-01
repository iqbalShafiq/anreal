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
    it("nests the aspect ratio under config.imageConfig", () => {
      // Spec §5.7: Gemini providerOptions are { config: { imageConfig: { aspectRatio } } }.
      expect(
        normalizedImageOptionsToProviderOptions("gemini", {
          aspectRatio: "9:16",
        }),
      ).toEqual({ config: { imageConfig: { aspectRatio: "9:16" } } });
    });

    it("does not leak quality, background or n into a native shape", () => {
      expect(
        normalizedImageOptionsToProviderOptions("gemini", {
          quality: "high",
          background: "transparent",
          n: 3,
        }),
      ).toEqual({ config: { imageConfig: {} } });
    });
  });

  describe("grok-native (grok)", () => {
    it("round-trips the app aspect ratio as Grok's aspect_ratio key", () => {
      // Spec §5.7: "width/height → aspect ratio". @anvia/grok@1.1.7 spreads
      // providerOptions into images.generate params (dist/index.js:144-153)
      // and derives its own `aspect_ratio` from width/height; passing the app
      // ratio through preserves the user's choice instead of the derived "auto".
      expect(
        normalizedImageOptionsToProviderOptions("grok", {
          aspectRatio: "19.5:9",
        }),
      ).toEqual({ aspect_ratio: "19.5:9" });
    });

    it("does not leak quality, background or n into a native shape", () => {
      expect(
        normalizedImageOptionsToProviderOptions("grok", {
          quality: "high",
          background: "transparent",
          n: 2,
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
      // Gemini still declares its native container, but with an empty
      // imageConfig: the adapter derives the ratio from width/height, so no
      // aspectRatio key is present for the app to have omitted.
      expect(
        normalizedImageOptionsToProviderOptions("gemini", {}),
      ).toEqual({ config: { imageConfig: {} } });
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

    it("emits no aspectRatio for gemini when none was given", () => {
      const result = normalizedImageOptionsToProviderOptions("gemini", {
        quality: "high",
      });
      const config = result.config as { imageConfig: Record<string, unknown> };

      expect("aspectRatio" in config.imageConfig).toBe(false);
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
