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
 * Round-trips the app's ratio so the user's choice survives; `quality`,
 * `background` and `n` have no native Gemini equivalent and are omitted.
 *
 * An absent ratio emits no key at all — not a nested empty `imageConfig` — so
 * the caller's contract holds: an input the caller did not supply produces no
 * key in the output.
 */
function geminiImageOptions(
  settings: NormalizedImageOptions,
): Record<string, unknown> {
  if (settings.aspectRatio === undefined) return {};
  return {
    config: { imageConfig: { aspectRatio: settings.aspectRatio } },
  };
}

/**
 * Grok native image generation (spec §5.7: "width/height → aspect ratio").
 *
 * Always returns `{}`. @anvia/grok@1.1.7 spreads `providerOptions` **first**
 * and then writes its own literal keys over the top
 * (dist/index.js:144-153), so anything this layer passes is clobbered:
 *
 *   const params = {
 *     ...providerOptions,                                   // ours — clobbered
 *     model: this.modelId,                                  // clobbers ours
 *     prompt: request.prompt,
 *     n: 1,                                                 // clobbers, and pins 1
 *     response_format: "b64_json",                          // clobbers ours
 *     aspect_ratio: aspectRatio(request.width, request.height) // clobbers ours
 *   };
 *
 * Grok derives the ratio itself from `request.width`/`request.height`, which
 * the tool already supplies (tools/image-generation.ts:579-581), mapping it
 * through `SUPPORTED_ASPECT_RATIOS` and collapsing anything unsupported to
 * "auto" (dist/index.js:190-211). Emitting a key the adapter overwrites would
 * falsely suggest this layer controls Grok's ratio, so it emits nothing.
 */
function grokImageOptions(
  _settings: NormalizedImageOptions,
): Record<string, unknown> {
  return {};
}
