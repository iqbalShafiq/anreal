import { useCallback, useEffect, useState } from "react";
import {
  listModels,
  subscribeModelsCache,
  type ModelInfo,
  type ReasoningEffortInfo,
} from "#/lib/api";

export function useModels(): {
  models: ModelInfo[];
  reasoningEfforts: ReasoningEffortInfo[];
  status: "loading" | "success" | "error";
  error: string | null;
  retry: () => void;
} {
  const [state, setState] = useState<{
    status: "loading" | "success" | "error";
    models: ModelInfo[];
    reasoningEfforts: ReasoningEffortInfo[];
    error: string | null;
  }>({
    status: "loading",
    models: [],
    reasoningEfforts: [],
    error: null,
  });

  const load = useCallback((force = false) => {
    setState((current) => ({ ...current, status: "loading", error: null }));
    listModels(force ? { force: true } : undefined)
      .then((data) =>
        setState({
          status: "success",
          models: data.models,
          reasoningEfforts: data.reasoningEfforts,
          error: null,
        }),
      )
      .catch((error) =>
        setState((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error ? error.message : "Failed to load models",
        })),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A provider write invalidates the catalog; refetch so the composer and the
  // role pickers see a newly added model without a reload. `load` already
  // tolerates a setState after unmount, so no abort machinery is added.
  useEffect(() => subscribeModelsCache(() => load(true)), [load]);

  // `retry` aliases `load`. The optional `force` is safe: the only caller is
  // the composer's error-state button, which passes a click event (truthy) and
  // renders only while the catalog is null, so both forms issue one request.
  // Do not wrap this in an argument-less function.
  return { ...state, retry: load };
}
