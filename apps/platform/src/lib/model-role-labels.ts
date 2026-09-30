import type { SelectOption } from "#/components/ui/select-list";

/**
 * Every background role that can carry its own model assignment. The order is
 * the order the settings UI presents them in, mirroring the server's
 * `ROLE_KEYS`. Kept dependency-free so the pure option/label logic can be
 * unit-tested in node.
 */
export const MODEL_ROLE_KEYS = [
  "chat",
  "memoryCompaction",
  "profileSummary",
  "siteBuilder",
  "visionHelper",
  "scheduledChat",
] as const;

export type ModelRoleKey = (typeof MODEL_ROLE_KEYS)[number];

const ROLE_LABELS: Record<ModelRoleKey, string> = {
  chat: "Chat",
  memoryCompaction: "Memory compaction",
  profileSummary: "Profile summary",
  siteBuilder: "Site builder",
  visionHelper: "Image understanding",
  scheduledChat: "Scheduled chats",
};

/** Human label for a role in the settings pickers. */
export function modelRoleLabel(role: ModelRoleKey): string {
  return ROLE_LABELS[role];
}

/**
 * The only fields the picker needs from a catalog row. Structurally satisfied
 * by `ModelInfo`, so this module never imports the API client (or React).
 */
export type RoleModelOptionSource = {
  modelId: string;
  name: string;
  inputModalities: string[];
};

/**
 * Build the picker's options for a role: a first, empty option that clears the
 * assignment (falling back to the role's default), then the catalog. Mirrors
 * the server's assignment rule by hiding non-image models from the vision
 * helper — no second rule is invented here.
 */
export function roleModelOptions(
  role: ModelRoleKey,
  models: readonly RoleModelOptionSource[],
  defaultModelId: string | null,
): SelectOption[] {
  const defaultName =
    defaultModelId === null
      ? null
      : (models.find((model) => model.modelId === defaultModelId)?.name ?? null);

  const offered =
    role === "visionHelper"
      ? models.filter((model) => model.inputModalities.includes("image"))
      : models;

  return [
    {
      value: "",
      label: defaultName ? `Default (${defaultName})` : "Default",
    },
    ...offered.map((model) => ({ value: model.modelId, label: model.name })),
  ];
}
