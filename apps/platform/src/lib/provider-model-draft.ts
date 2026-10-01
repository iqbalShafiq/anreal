/**
 * Pure draft helpers for the BYOK provider-model editor. This mirrors the
 * server's slug rule in `apps/api/src/lib/provider-slug.ts` so the editor can
 * show the id it is about to derive; the server remains authoritative and
 * re-derives the slug on every create/update. React- and fetch-free so it
 * stays unit-testable in the node environment.
 */

import type {
  ListedProviderModel,
  ProviderModelPrefill,
} from "#/lib/api";

const SLUG_MAX = 96;

/** The lowercase-hyphen rule the server enforces for connection slugs. */
export const CONNECTION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Lowercase, keep `[a-z0-9._-]`, collapse everything else into single hyphens.
 * Mirrors `sanitizeSlugPart` on the server, including the empty-result fallback.
 */
function sanitizeSlugPart(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "");
  const bounded = cleaned.slice(0, SLUG_MAX);
  const trimmed = bounded.replace(/[-._]+$/, "");
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Preview of the id the server will derive for `<connection>/<model>`.
 * Mirrors `deriveModelSlug`: the connection part falls back to `provider`, the
 * model part to `custom`, and the whole thing is capped at 96 chars.
 */
export function slugPreview(connectionSlug: string, upstreamId: string): string {
  const prefix = sanitizeSlugPart(connectionSlug, "provider");
  const model = sanitizeSlugPart(upstreamId, "custom");
  const room = Math.max(1, SLUG_MAX - prefix.length - 1);
  const trimmedModel = model.slice(0, room).replace(/[-._]+$/, "");
  return `${prefix}/${trimmedModel.length > 0 ? trimmedModel : "custom"}`;
}

/**
 * Compare the user's selected efforts against the adapter's declared set.
 * `unsupported` lists selections the adapter does not accept; `missing` lists
 * adapter values the user has not selected. Both preserve their source order.
 */
export function effortDiff(
  selected: string[],
  adapterEfforts: string[],
): { unsupported: string[]; missing: string[] } {
  const adapter = new Set(adapterEfforts);
  const chosen = new Set(selected);
  return {
    unsupported: selected.filter((value) => !adapter.has(value)),
    missing: adapterEfforts.filter((value) => !chosen.has(value)),
  };
}

/**
 * Prefill a model editor draft from one discovery listing: display name (the
 * id when the provider omits a name), context window, and the adapter's
 * declared effort vocabulary. A non-null adapter default is added when the
 * declaration does not already include it.
 */
export function draftFromListedModel(input: {
  listed: Pick<ListedProviderModel, "id" | "name" | "contextLength">;
  adapterEfforts: string[];
  defaultEffort: string | null;
}): {
  upstreamId: string;
  name: string;
  contextWindowTokens: number | null;
  reasoningEfforts: string[];
} {
  const reasoningEfforts = [...input.adapterEfforts];
  if (input.defaultEffort && !reasoningEfforts.includes(input.defaultEffort)) {
    reasoningEfforts.push(input.defaultEffort);
  }
  return {
    upstreamId: input.listed.id,
    name: input.listed.name?.trim() || input.listed.id,
    contextWindowTokens: input.listed.contextLength ?? null,
    reasoningEfforts,
  };
}

/** Whether a slug matches the server's connection-slug rule. */
export function isValidConnectionSlug(slug: string): boolean {
  return CONNECTION_SLUG_RE.test(slug);
}

/**
 * The slug the server would derive from a label, mirroring
 * `deriveConnectionSlug` in `apps/api/src/lib/provider-slug.ts`. Used to
 * pre-fill the slug field until the user edits it.
 */
export function deriveConnectionSlug(label: string): string {
  return sanitizeSlugPart(label, "provider");
}

/**
 * Client-side slug check so a typo fails in the form, not mid-save. The server
 * stays authoritative for reserved namespaces; this only enforces the shape.
 */
export function connectionSlugError(slug: string): string | null {
  if (slug.length === 0) return null;
  return isValidConnectionSlug(slug)
    ? null
    : "Slug must be lowercase letters, numbers, and hyphens, e.g. my-openrouter";
}

/**
 * A new connection may only be saved after a successful Test. Save-time
 * provider validation is not implemented server-side, so the UI carries the
 * gate; an existing connection saves freely.
 */
export function canSaveConnection(input: {
  isNew: boolean;
  testPassed: boolean;
}): boolean {
  return input.isNew ? input.testPassed : true;
}

/** Editable model-form state; numbers live as text so inputs stay controlled. */
export type ModelDraft = {
  name: string;
  contextWindowTokens: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  reasoningEfforts: string[];
  providerReported: boolean;
};

function numberField(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * Seed the model editor from the server's prefill. A non-null adapter default
 * is added when the declaration does not already include it, and every limit
 * becomes a form string so the inputs stay controlled.
 */
export function modelDraftFromPrefill(prefill: ProviderModelPrefill): ModelDraft {
  const reasoningEfforts = [...prefill.reasoningEfforts];
  const fallback = prefill.defaultReasoningEffort;
  if (fallback && !reasoningEfforts.includes(fallback)) {
    reasoningEfforts.push(fallback);
  }
  return {
    name: prefill.name,
    contextWindowTokens: numberField(prefill.contextWindowTokens),
    maxInputTokens: numberField(prefill.maxInputTokens),
    maxOutputTokens: numberField(prefill.maxOutputTokens),
    reasoningEfforts,
    providerReported: prefill.providerReported,
  };
}

/**
 * The output type the model editor submits. A new model defaults to text; an
 * existing row keeps whatever it carries, so editing never silently rewrites an
 * image model to text.
 */
export function modelOutputType(
  existing: "text" | "image" | null | undefined,
): "text" | "image" {
  return existing === "image" ? "image" : "text";
}

/**
 * One line warning when the user's reasoning set diverges from the adapter's
 * declared set, or `null` when they agree or the adapter declares nothing.
 */
export function effortWarning(
  selected: string[],
  adapterEfforts: string[],
): string | null {
  if (adapterEfforts.length === 0) return null;
  const { unsupported, missing } = effortDiff(selected, adapterEfforts);
  if (unsupported.length === 0 && missing.length === 0) return null;
  const parts: string[] = [];
  if (unsupported.length > 0) {
    parts.push(`the adapter does not accept ${unsupported.join(", ")}`);
  }
  if (missing.length > 0) {
    parts.push(`the adapter also declares ${missing.join(", ")}`);
  }
  return `Custom reasoning set: ${parts.join("; ")}.`;
}

/** The image capability style a kind carries, from `GET /api/providers/kinds`. */
export type ImageStyle =
  | "openrouter-images"
  | "gemini-native"
  | "grok-native"
  | "none";

/** One option of the output-type selector. */
export type ImageOutputTypeOption = {
  value: "text" | "image";
  label: string;
};

/**
 * The output-type choices for a connection's kind. `text` is always offered;
 * `image` is offered only when the kind has an image endpoint, so the selector
 * can never submit an image row the server would refuse.
 */
export function imageOutputTypeOptions(
  imageStyle: ImageStyle,
): ImageOutputTypeOption[] {
  const options: ImageOutputTypeOption[] = [
    { value: "text", label: "Text" },
  ];
  if (imageStyle !== "none") {
    options.push({ value: "image", label: "Image" });
  }
  return options;
}

/**
 * The reasoning set to submit for an output type. The server forces `[]` for an
 * image model, so the UI drops the value too rather than showing a selection
 * the server will discard.
 */
export function reasoningEffortsForOutputType(
  outputType: "text" | "image",
  efforts: string[],
): string[] {
  return outputType === "image" ? [] : efforts;
}

/**
 * What each image-capable kind can honour, derived from the same per-kind
 * allow-list the server validates against
 * (`apps/api/src/modules/provider-connections/service.ts`):
 *
 * - `openrouter-images` merges every declared control into `POST /images`, so
 *   it keeps `sizes`, `quality`, `background` and the tool's full `n.max` cap.
 * - `gemini-native`/`grok-native` overwrite or ignore optional controls and pin
 *   `n: 1` on the wire, so they keep only `resolutions` and a fixed `n.max` of
 *   1. Both derive their ratio from the tool's `width`/`height` by gcd
 *   reduction, so only ratios whose key is already a reduced fraction can be
 *   reached.
 */
export type ImageCapabilityLimits = {
  /** The one sizing key the kind accepts; the other is never emitted. */
  sizing: "sizes" | "resolutions";
  /** The highest `n.max` the server will accept for this kind. */
  nMax: number;
  supportsQuality: boolean;
  supportsBackground: boolean;
  /** True when the adapter derives the ratio by gcd reduction. */
  gcdDerivedRatios: boolean;
};

export function imageCapabilityLimits(
  imageStyle: ImageStyle,
): ImageCapabilityLimits | null {
  switch (imageStyle) {
    case "openrouter-images":
      return {
        sizing: "sizes",
        nMax: MAX_MODEL_IMAGES,
        supportsQuality: true,
        supportsBackground: true,
        gcdDerivedRatios: false,
      };
    case "gemini-native":
    case "grok-native":
      return {
        sizing: "resolutions",
        nMax: 1,
        supportsQuality: false,
        supportsBackground: false,
        gcdDerivedRatios: true,
      };
    case "none":
      return null;
  }
}

/** The tool's execution cap, mirrored from `packages/agent/src/tools/image-generation.ts`. */
const MAX_MODEL_IMAGES = 10;

/**
 * The gcd-derived adapters' canonical sizes, mirrored from
 * `ASPECT_SIZES` in `packages/agent/src/tools/image-generation.ts`. Only the
 * reduction matters here: it decides which ratio strings a native kind can
 * reach.
 */
const ASPECT_SIZES: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "3:2": { width: 1536, height: 1024 },
  "2:3": { width: 1024, height: 1536 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "21:9": { width: 1344, height: 576 },
  "9:19.5": { width: 720, height: 1560 },
  "19.5:9": { width: 1560, height: 720 },
  auto: { width: 1024, height: 1024 },
};

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Whether a native kind can reach the adapter with `aspectRatio` as its own
 * literal string. Mirrors `isRepresentableAspectRatio` in the tool: `auto`
 * reduces to `1:1`, and any entry whose gcd reduction differs from its key
 * (21:9 → 7:3, 19.5:9 → 13:6, 9:19.5 → 6:13) is unreachable.
 */
export function isRepresentableAspectRatio(aspectRatio: string): boolean {
  if (aspectRatio === "auto") return false;
  const dimensions = ASPECT_SIZES[aspectRatio];
  if (!dimensions) return false;
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height);
  return `${dimensions.width / divisor}:${dimensions.height / divisor}` === aspectRatio;
}

/** Editable image-capability state; list fields live as comma-separated text. */
export type ImageCapabilityDraft = {
  nMax: string;
  aspectRatios: string;
  sizes: string;
  resolutions: string;
  quality: string;
  background: string;
};

function listText(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "";
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Seed the capability editor from an existing row's declaration. */
export function imageCapabilityDraft(
  capabilities: {
    n?: { min: number; max: number };
    aspectRatios?: string[];
    sizes?: string[];
    resolutions?: string[];
    quality?: string[];
    background?: string[];
  } | null,
): ImageCapabilityDraft {
  if (!capabilities) {
    return {
      nMax: "",
      aspectRatios: "",
      sizes: "",
      resolutions: "",
      quality: "",
      background: "",
    };
  }
  return {
    nMax: capabilities.n ? String(capabilities.n.max) : "",
    aspectRatios: listText(capabilities.aspectRatios),
    sizes: listText(capabilities.sizes),
    resolutions: listText(capabilities.resolutions),
    quality: listText(capabilities.quality),
    background: listText(capabilities.background),
  };
}

/** A built declaration, or a field-level error the editor shows instead of saving. */
export type ImageCapabilityBuild =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Build the capability set to submit for a draft, applying the kind's limits so
 * the editor cannot express a value the server's allow-list would reject. Only
 * the kind's own sizing key is emitted; `quality`/`background` are dropped for
 * kinds that do not honour them; `n.max` is bounded to the kind's cap; and a
 * native kind's aspect ratios are checked against the gcd reduction.
 */
export function imageCapabilityPayload(
  draft: ImageCapabilityDraft,
  limits: ImageCapabilityLimits,
): ImageCapabilityBuild {
  const aspectRatios = parseList(draft.aspectRatios);
  if (aspectRatios.length === 0) {
    return { ok: false, error: "Declare at least one aspect ratio." };
  }
  if (limits.gcdDerivedRatios) {
    const unreachable = aspectRatios.filter(
      (ratio) => !isRepresentableAspectRatio(ratio),
    );
    if (unreachable.length > 0) {
      return {
        ok: false,
        error: `This provider kind cannot generate ${unreachable.join(", ")}.`,
      };
    }
  }

  const sizingValues = parseList(
    limits.sizing === "sizes" ? draft.sizes : draft.resolutions,
  );
  if (sizingValues.length === 0) {
    return {
      ok: false,
      error:
        limits.sizing === "sizes"
          ? "Declare at least one size."
          : "Declare at least one resolution.",
    };
  }

  const parsedN = Number(draft.nMax.trim());
  const nMax =
    Number.isSafeInteger(parsedN) && parsedN >= 1 ? parsedN : limits.nMax;
  const value: Record<string, unknown> = {
    n: { min: 1, max: Math.min(nMax, limits.nMax) },
    aspectRatios,
    [limits.sizing]: sizingValues,
  };
  const quality = limits.supportsQuality ? parseList(draft.quality) : [];
  if (quality.length > 0) value.quality = quality;
  const background = limits.supportsBackground
    ? parseList(draft.background)
    : [];
  if (background.length > 0) value.background = background;
  return { ok: true, value };
}

/**
 * The body the model editor submits. Kept pure so the full-set resend is
 * pinned by a test: a partial PATCH that omits `imageCapabilities` writes
 * `null`, so an image row always carries the whole capability set (when it has
 * one), even on a save where the user changed nothing. A text row never carries
 * the field at all.
 */
export function modelSavePayload(input: {
  upstreamId: string;
  name: string;
  iconSvg: string;
  outputType: "text" | "image";
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
  imageCapabilities: Record<string, unknown> | null;
}): {
  upstreamId: string;
  name?: string;
  iconSvg?: string;
  outputType: "text" | "image";
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
  imageCapabilities?: Record<string, unknown>;
} {
  const trimmedName = input.name.trim();
  const trimmedIcon = input.iconSvg.trim();
  const isImage = input.outputType === "image";
  return {
    upstreamId: input.upstreamId,
    ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
    ...(trimmedIcon.length > 0 ? { iconSvg: trimmedIcon } : {}),
    outputType: input.outputType,
    contextWindowTokens: input.contextWindowTokens,
    maxInputTokens: input.maxInputTokens,
    maxOutputTokens: input.maxOutputTokens,
    // The server forces [] for an image model; the UI must not submit a set it
    // will discard.
    reasoningEfforts: reasoningEffortsForOutputType(
      input.outputType,
      input.reasoningEfforts,
    ),
    ...(isImage && input.imageCapabilities
      ? { imageCapabilities: input.imageCapabilities }
      : {}),
  };
}
