export const DYNAMIC_HEADER_SOURCES = ["sessionId", "requestId", "userId"] as const;
export type DynamicHeaderSource = (typeof DYNAMIC_HEADER_SOURCES)[number];

/**
 * One header value on the wire: a literal string, or a `{ dynamic }` marker
 * naming the run-time source that replaces it. Built from
 * `DynamicHeaderSource`, so a source outside the closed vocabulary cannot be
 * represented client-side.
 */
export type ProviderHeaderValue = string | { dynamic: DynamicHeaderSource };

/** Narrow an arbitrary string to the closed source vocabulary. */
export function isDynamicHeaderSource(
  value: string,
): value is DynamicHeaderSource {
  return (DYNAMIC_HEADER_SOURCES as readonly string[]).includes(value);
}

/** One line per source, shown beside the picker so the choice is self-explaining. */
export const DYNAMIC_HEADER_LABELS: Record<DynamicHeaderSource, string> = {
  sessionId:
    "Session ID — stable for this conversation; this is what gateways use for cache affinity",
  requestId: "Request ID — unique to this run; useful for tracing",
  userId: "User ID — the account this connection belongs to",
};
