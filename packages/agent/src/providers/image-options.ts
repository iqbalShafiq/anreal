import { PROVIDER_KIND_META, type ProviderKind } from "./registry.js";

/**
 * The app's normalised image settings, before they are adapted to a provider.
 * This is the descriptor the tool owns (§5.7) — core has no concept of image
 * controls, so the shape is the application's.
 */
export type NormalizedImageOptions = {
  aspectRatio?: string;
  quality?: string;
  background?: string;
  n?: number;
};

/**
 * Adapt the app's normalised image settings to the `providerOptions` object the
 * provider kind expects.
 *
 * The tool is adapter-agnostic; this is the one layer that knows the three
 * differently-shaped image APIs. Dispatch is on `imageStyle`, the single source
 * of truth in `PROVIDER_KIND_META`, never on the kind name.
 *
 * Purity: no provider instances, no env reads, no I/O. Absent inputs emit no
 * key at all (not `undefined`), because these objects are spread into a request
 * body where an explicit `undefined` is a real difference from an omission.
 */
export function normalizedImageOptionsToProviderOptions(
  kind: ProviderKind,
  settings: NormalizedImageOptions,
): Record<string, unknown> {
  switch (PROVIDER_KIND_META[kind].imageStyle) {
    case "openrouter-images":
      return openRouterImageOptions(settings);
    case "gemini-native":
      return geminiImageOptions(settings);
    case "grok-native":
      return grokImageOptions(settings);
    // A kind with no image endpoint produces no options rather than throwing:
    // the caller has already decided not to build a model, so a throw here
    // would fire in a path that should be unreachable.
    case "none":
      return {};
    default: {
      const exhaustive: never = PROVIDER_KIND_META[kind].imageStyle;
      return exhaustive;
    }
  }
}

/**
 * OpenRouter-shaped gateways (`POST /images`). This reproduces the keys the tool
 * sent directly before this normaliser existed (tools/image-generation.ts), so
 * it is a regression pin as much as an adapter.
 *
 * `background` is paired with `output_format: "png"` — transparency needs a PNG
 * — so the pairing lives here and must not be duplicated in the tool.
 */
function openRouterImageOptions(
  settings: NormalizedImageOptions,
): Record<string, unknown> {
  return {
    ...(settings.aspectRatio !== undefined
      ? { aspect_ratio: settings.aspectRatio }
      : {}),
    ...(settings.quality !== undefined ? { quality: settings.quality } : {}),
    ...(settings.background !== undefined
      ? { background: settings.background, output_format: "png" }
      : {}),
    ...(settings.n !== undefined ? { n: settings.n } : {}),
  };
}

/**
 * Gemini native image generation (`config.imageConfig.aspectRatio`, spec §5.7).
 * Gemini derives its own ratio from width/height, so the app's ratio is passed
 * through explicitly to preserve the user's choice; quality/background/n have
 * no native Gemini equivalent and are omitted.
 */
function geminiImageOptions(
  settings: NormalizedImageOptions,
): Record<string, unknown> {
  return {
    config: {
      imageConfig: {
        ...(settings.aspectRatio !== undefined
          ? { aspectRatio: settings.aspectRatio }
          : {}),
      },
    },
  };
}

/**
 * Grok native image generation (spec §5.7: "width/height → aspect ratio").
 *
 * @anvia/grok@1.1.7 spreads `providerOptions` into its `images.generate` params
 * (dist/index.js:144-153) and appends its own `aspect_ratio` derived from
 * width/height. Passing the app's ratio through under that same key preserves
 * the user's exact ratio (e.g. `19.5:9`), which Grok's derivation would
 * otherwise collapse to `auto`; quality/background/n are not accepted and are
 * omitted.
 */
function grokImageOptions(
  settings: NormalizedImageOptions,
): Record<string, unknown> {
  return {
    ...(settings.aspectRatio !== undefined
      ? { aspect_ratio: settings.aspectRatio }
      : {}),
  };
}
