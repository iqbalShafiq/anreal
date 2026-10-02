/**
 * The closed set of run-time values a connection header may resolve to. Adding
 * a source is a code change, never configuration: the allowlist is what keeps a
 * credential from ever becoming resolvable into a header.
 */
export const DYNAMIC_HEADER_SOURCES = ["sessionId", "requestId", "userId"] as const;

export type DynamicHeaderSource = (typeof DYNAMIC_HEADER_SOURCES)[number];

/** A stored header value: a literal, or a reference resolved at run time. */
export type HeaderValue = string | { dynamic: DynamicHeaderSource };

export type HeaderResolutionContext = {
  /** Stable for the whole conversation. */
  sessionId: string;
  userId: string;
  /** Unique to this resolution: the run's trace id where the path has one. */
  requestId: string;
};

export function isDynamicHeaderSource(value: unknown): value is DynamicHeaderSource {
  return (
    typeof value === "string" &&
    (DYNAMIC_HEADER_SOURCES as readonly string[]).includes(value)
  );
}

export function isDynamicHeaderValue(
  value: unknown,
): value is { dynamic: DynamicHeaderSource } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isDynamicHeaderSource((value as { dynamic?: unknown }).dynamic)
  );
}

/**
 * Turn a stored header map into the concrete strings a provider request carries.
 * An unknown source throws rather than degrading: sending the marker itself (or
 * its serialization) would be a silent wrong value, which is the failure class
 * this feature exists to remove. The header name and the offending source name
 * are safe to name; no resolved value is included.
 */
export function resolveConnectionHeaders(
  headers: Record<string, HeaderValue> | null | undefined,
  context: HeaderResolutionContext,
): Record<string, string> | null {
  if (!headers) return null;
  const entries = Object.entries(headers);
  if (entries.length === 0) return null;

  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (typeof value === "string") {
      out[name] = value;
      continue;
    }
    const source = (value as { dynamic?: unknown })?.dynamic;
    if (!isDynamicHeaderSource(source)) {
      throw new Error(
        `provider header "${name}" names an unknown dynamic source "${String(source)}"`,
      );
    }
    out[name] = context[source];
  }
  return out;
}
