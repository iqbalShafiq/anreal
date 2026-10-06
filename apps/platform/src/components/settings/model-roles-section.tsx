import { useState } from "react";
import { Select } from "#/components/ui/select";
import {
  issuesFromError,
  issuesToFieldErrors,
  type FieldErrors,
} from "#/components/skills/skill-issues";
import { useModels } from "#/hooks/use-models";
import { useModelRoles } from "#/hooks/use-model-roles";
import {
  modelRoleLabel,
  roleModelOptions,
} from "#/lib/model-role-labels";
import type { ModelInfo, ModelRoleInfo } from "#/lib/api";

/** The line under the picker: which model the role runs on by default. */
function defaultHint(info: ModelRoleInfo, models: ModelInfo[]): string {
  // `memoryCompaction` has no model of its own: it follows the chat model the
  // compacted run is using. `visionHelper` with no env var auto-picks the
  // cheapest image-capable model. Both report a null defaultModelId, so the
  // generic "no default configured" copy would be wrong for them.
  if (info.role === "memoryCompaction") {
    return info.modelId === null
      ? "Using the chat model."
      : "Falls back to the chat model.";
  }
  if (info.role === "visionHelper" && info.defaultModelId === null) {
    return info.modelId === null
      ? "Using the cheapest available image model."
      : "Falls back to the cheapest available image model.";
  }
  if (info.defaultModelId === null) return "No default model configured.";
  const name =
    models.find((model) => model.modelId === info.defaultModelId)?.name ??
    info.defaultModelId;
  return info.modelId === null
    ? `Using the default: ${name}`
    : `Falls back to ${name}`;
}

/**
 * The Account section's model assignments: one picker per background role.
 * The empty option clears the assignment and runs the role on its default,
 * mirroring `PUT /api/models/roles`.
 */
export function ModelRolesSection({ active }: { active: boolean }) {
  const roles = useModelRoles(active);
  const { models } = useModels();
  const [errors, setErrors] = useState<FieldErrors>({});
  const rows = roles.data ?? [];

  return (
    <section className="flex flex-col gap-4 border-t border-hairline pt-5">
      <div>
        <h3 className="text-sm font-medium text-text">Model assignments</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Choose the model each background task runs on. Leave a role on its
          default to follow the app's model.
        </p>
      </div>

      {roles.loading && roles.data === null ? (
        <div className="flex flex-col gap-3">
          <div className="skeleton-shimmer h-14 w-full rounded-xl" />
          <div className="skeleton-shimmer h-14 w-full rounded-xl" />
        </div>
      ) : roles.error && roles.data === null ? (
        <p className="text-sm text-danger" role="alert">
          {roles.error}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((info) => (
            <li key={info.role} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium tracking-wide text-text-muted">
                {modelRoleLabel(info.role)}
              </span>
              <Select
                value={info.modelId ?? ""}
                onChange={(value) => {
                  setErrors({});
                  void roles
                    .save(info.role, value === "" ? null : value)
                    .catch((error) =>
                      setErrors(issuesToFieldErrors(issuesFromError(error))),
                    );
                }}
                options={roleModelOptions(
                  info.role,
                  models,
                  info.defaultModelId,
                )}
                ariaLabel={modelRoleLabel(info.role)}
                disabled={roles.saving}
              />
              <p className="text-[11px] text-text-faint">
                {defaultHint(info, models)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {errors.form ? (
        <p className="text-[11px] text-danger" role="alert">
          {errors.form}
        </p>
      ) : null}
    </section>
  );
}
