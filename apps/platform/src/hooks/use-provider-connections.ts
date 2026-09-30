import { useCallback, useEffect, useState } from "react";
import {
  createProviderConnection,
  createProviderModel,
  deleteProviderConnection,
  deleteProviderModel,
  discoverProviderModels,
  listProviderConnections,
  listProviderModels,
  setProviderConnectionEnabled,
  updateProviderConnection,
  updateProviderModel,
  type ListedProviderModel,
  type ProviderConnection,
  type ProviderConnectionInput,
  type ProviderModelInput,
  type ProviderModelRow,
} from "#/lib/api";

/**
 * Load the user's BYOK provider connections while `active`; expose CRUD and a
 * discovery probe. Mirrors `useUserMcpServers`: `data/loading/error/saving`, an
 * active-gated effect, and write callbacks that rethrow so the form keeps the
 * server's field-level issues.
 */
export function useProviderConnections(active: boolean) {
  const [data, setData] = useState<ProviderConnection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const payload = await listProviderConnections();
      setData(payload);
      setError(null);
    } catch {
      setError("Could not load provider connections");
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const payload = await listProviderConnections();
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Could not load provider connections");
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
    (id: string | null, input: ProviderConnectionInput) =>
      mutate(
        () =>
          id ? updateProviderConnection(id, input) : createProviderConnection(input),
        "Could not save provider connection",
      ),
    [mutate],
  );

  const remove = useCallback(
    (id: string) =>
      mutate(
        () => deleteProviderConnection(id),
        "Could not delete provider connection",
      ),
    [mutate],
  );

  const toggle = useCallback(
    (id: string, isEnabled: boolean) =>
      mutate(
        () => setProviderConnectionEnabled(id, isEnabled),
        "Could not update provider connection",
      ),
    [mutate],
  );

  return { data, loading, error, saving, reload, save, remove, toggle };
}

/**
 * Load one connection's registered models while `active`; expose model CRUD
 * and a discovery probe. Same state shape as `useProviderConnections`.
 */
export function useProviderModels(
  connectionId: string | null,
  active: boolean,
) {
  const [data, setData] = useState<ProviderModelRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!connectionId) {
      setData(null);
      setError(null);
      return;
    }
    try {
      const payload = await listProviderModels(connectionId);
      setData(payload);
      setError(null);
    } catch {
      setError("Could not load provider models");
    }
  }, [connectionId]);

  useEffect(() => {
    if (!active || !connectionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const payload = await listProviderModels(connectionId);
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Could not load provider models");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, connectionId]);

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
    (modelId: string | null, input: ProviderModelInput) => {
      if (!connectionId) {
        return Promise.reject(new Error("No provider connection selected"));
      }
      return mutate(
        () =>
          modelId
            ? updateProviderModel(connectionId, modelId, input)
            : createProviderModel(connectionId, input),
        "Could not save provider model",
      );
    },
    [connectionId, mutate],
  );

  const remove = useCallback(
    (modelId: string) => {
      if (!connectionId) {
        return Promise.reject(new Error("No provider connection selected"));
      }
      return mutate(
        () => deleteProviderModel(connectionId, modelId),
        "Could not delete provider model",
      );
    },
    [connectionId, mutate],
  );

  /** The provider's own model inventory; never persists anything. */
  const discover = useCallback(
    (id: string): Promise<ListedProviderModel[]> => discoverProviderModels(id),
    [],
  );

  return { data, loading, error, saving, reload, save, remove, discover };
}
