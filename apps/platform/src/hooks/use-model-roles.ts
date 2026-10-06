import { useCallback, useEffect, useState } from "react";
import {
  listModelRoles,
  setModelRole,
  type ModelRoleInfo,
} from "#/lib/api";
import type { ModelRoleKey } from "#/lib/model-role-labels";

/**
 * Load the user's per-role model assignments while `active`; expose a save
 * that clears or replaces one role's model. Mirrors `useProviderConnections`:
 * `data/loading/error/saving`, an active-gated effect, and a write callback
 * that rethrows so the picker can show the server's field-level issues.
 */
export function useModelRoles(active: boolean) {
  const [data, setData] = useState<ModelRoleInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const payload = await listModelRoles();
      setData(payload);
      setError(null);
    } catch {
      setError("Could not load model roles");
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const payload = await listModelRoles();
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Could not load model roles");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>, failure: string) => {
      setSaving(true);
      try {
        await fn();
        await reload();
      } catch (error) {
        setError(error instanceof Error ? error.message : failure);
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  const save = useCallback(
    (role: ModelRoleKey, modelId: string | null) =>
      mutate(
        () => setModelRole(role, modelId),
        "Could not save model role",
      ),
    [mutate],
  );

  return { data, loading, error, saving, reload, save };
}
