import {
  DEFAULT_COMPLETION_MODEL,
  parseCompletionModel,
  type CompletionModelId,
} from "@anreal/agent";

/**
 * Every background role that can carry its own model assignment. The order is
 * the order callers and the settings UI present them in.
 */
export const ROLE_KEYS = [
  "memoryCompaction",
  "profileSummary",
  "siteBuilder",
  "visionHelper",
  "scheduledChat",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * The site builder's shipping default. Lives here (not in static-sites) so
 * both `roles.ts` and `static-sites/service.ts` can share one literal without
 * importing each other — static-sites imports the role resolver, so a reverse
 * import would be a cycle.
 */
export const SITE_MODEL_DEFAULT: CompletionModelId =
  "meta/muse-spark-1.3-contributor";

/**
 * The env-configured model for a role, before the constant default. Only the
 * roles that have historically read an env var return a value; the rest have
 * no env override and resolve from the constant default (or the chat model,
 * for compaction) instead.
 */
export function roleEnvModelId(role: RoleKey): string | null {
  switch (role) {
    case "profileSummary":
      return parseCompletionModel(process.env.PROFILE_SUMMARY_MODEL);
    case "siteBuilder":
      return parseCompletionModel(process.env.SITE_MODEL);
    case "visionHelper":
      return parseCompletionModel(process.env.VISION_HELPER_MODEL);
    default:
      return null;
  }
}

/**
 * Today's default resolution for a role, byte-identical to the call sites the
 * role resolver replaces: env var first, then the existing constant default.
 * `null` means the role has no default of its own (`memoryCompaction`),
 * so a caller supplies its own fallback (e.g. compaction uses the chat model).
 */
export function roleDefaultModelId(role: RoleKey): string | null {
  switch (role) {
    case "profileSummary":
    case "scheduledChat":
      return roleEnvModelId(role) ?? DEFAULT_COMPLETION_MODEL;
    case "siteBuilder":
      return roleEnvModelId(role) ?? SITE_MODEL_DEFAULT;
    case "visionHelper":
      return roleEnvModelId(role);
    default:
      return null;
  }
}
