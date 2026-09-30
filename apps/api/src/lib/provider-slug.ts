export const SLUG_MAX = 96;
export const MAX_SLUG_ATTEMPTS = 50;

/** A model id is always `<connection-slug>/<model-slug>`. */
export const PROVIDER_MODEL_SLUG_RE =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

/**
 * Namespaces owned by the seeded global catalog. A user connection may not
 * reuse them, otherwise its model ids would be indistinguishable from
 * registry ids and would collide with them.
 */
export const RESERVED_CONNECTION_SLUGS: readonly string[] = [
  "openai",
  "deepseek",
  "google",
  "xai",
  "meta",
];

/** Lowercase, keep `[a-z0-9._-]`, collapse everything else into single hyphens. */
export function sanitizeSlugPart(value: string, fallback: string): string {
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

export function deriveConnectionSlug(label: string): string {
  return sanitizeSlugPart(label, "provider");
}

export function deriveModelSlug(
  connectionSlug: string,
  upstreamId: string,
): string {
  const prefix = sanitizeSlugPart(connectionSlug, "provider");
  const model = sanitizeSlugPart(upstreamId, "custom");
  const room = Math.max(1, SLUG_MAX - prefix.length - 1);
  const trimmedModel = model.slice(0, room).replace(/[-._]+$/, "");
  return `${prefix}/${trimmedModel.length > 0 ? trimmedModel : "custom"}`;
}

export function isReservedConnectionSlug(slug: string): boolean {
  return RESERVED_CONNECTION_SLUGS.includes(slug);
}

/** Attempt 1 is the base slug; later attempts append `-2`, `-3`, … */
export function suffixSlug(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  const trimmed = base.slice(0, Math.max(1, SLUG_MAX - suffix.length));
  return `${trimmed}${suffix}`;
}
