export const DYNAMIC_HEADER_SOURCES = ["sessionId", "requestId", "userId"] as const;
export type DynamicHeaderSource = (typeof DYNAMIC_HEADER_SOURCES)[number];

/** One line per source, shown beside the picker so the choice is self-explaining. */
export const DYNAMIC_HEADER_LABELS: Record<DynamicHeaderSource, string> = {
  sessionId:
    "Session ID — stable for this conversation; this is what gateways use for cache affinity",
  requestId: "Request ID — unique to this run; useful for tracing",
  userId: "User ID — the account this connection belongs to",
};
