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
 * The output type the model editor submits. Until BYOK image generation is
 * wired (Phase D) a new model is always text; an existing row keeps whatever it
 * carries, so editing never silently rewrites an image model to text.
 */
export function modelOutputType(
  existing: "text" | "image" | null | undefined,
): "text" | "image" {
  return existing === "image" ? "image" : "text";
}

/**
 * A one-line warning when the user's reasoning set diverges from the adapter's
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
