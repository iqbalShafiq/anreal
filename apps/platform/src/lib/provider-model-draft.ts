/**
 * Pure draft helpers for the BYOK provider-model editor. This mirrors the
 * server's slug rule in `apps/api/src/lib/provider-slug.ts` so the editor can
 * show the id it is about to derive; the server remains authoritative and
 * re-derives the slug on every create/update. React- and fetch-free so it
 * stays unit-testable in the node environment.
 */

import type { ListedProviderModel } from "#/lib/api";

const SLUG_MAX = 96;

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
