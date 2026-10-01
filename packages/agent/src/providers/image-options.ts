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
 * Dispatch is on `imageStyle`, the single source of truth in `PROVIDER_KIND_META`,
 * never on the kind name.
 *
 * Surprising but true: **only the OpenRouter-shaped kind carries anything.** Both
 * native adapters spread `providerOptions` first and then overwrite the very keys
 * a caller would set — Grok's `aspect_ratio`/`model`/`n`/`response_format` and
 * Gemini's `config.imageConfig.aspectRatio`/`model` — and both derive the ratio
 * themselves from the `width`/`height` the tool already supplies. So the two
 * native branches return `{}` by design, not because they were left unfinished:
 * emitting those keys would be a no-op at best and a false claim of control at
 * worst. See each branch for the file:line citations.
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
 * Gemini native image generation. Always returns `{}` — see the module comment
 * for why. @anvia/gemini@1.1.6 separates `config` from the top level and then
 * overwrites the keys a caller would set (dist/index.js:1281-1300):
 *
 *   const { config: providerConfigValue, ...providerTopLevel } = providerOptions;
 *   const providerImageConfig = ... providerConfig.imageConfig ...;
 *   const config = {
 *     ...providerConfig,
 *     responseModalities: ["TEXT", "IMAGE"],
 *     imageConfig: {
 *       ...providerImageConfig,                             // ours — clobbered
 *       aspectRatio: aspectRatio(request.width, request.height) // clobbers ours
 *     }
 *   };
 *   const params = {
 *     ...providerTopLevel,                                  // ours
 *     model: this.modelId,                                  // clobbers ours
 *     contents: request.prompt,
 *     config: ...
 *   };
 *
 * So `config.imageConfig.aspectRatio` and `model` are both overwritten before
 * the request leaves the process. Gemini derives the ratio itself from
 * `request.width`/`request.height` (dist/index.js:1391-1396, `${w/gcd}:${h/gcd}`
 * with no supported-set filter), and the tool already supplies those dimensions
 * (tools/image-generation.ts:579-581). Emitting either key would falsely suggest
 * this layer controls Gemini's ratio, so it emits nothing.
 */
function geminiImageOptions(
  _settings: NormalizedImageOptions,
): Record<string, unknown> {
  return {};
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
