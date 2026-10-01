// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  invalidateModelsCache,
  listModels,
  subscribeModelsCache,
} from "#/lib/api";
import { useModels } from "./use-models";

// The real client is under test, so mock the network boundary it eventually
// hits — global `fetch` — the way `api-user-enhancements.test.ts` does.
const fetchMock = vi.fn();

function modelsResponse(modelIds: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      models: modelIds.map((modelId) => ({
        modelId,
        label: modelId,
        outputType: "text",
      })),
      reasoningEfforts: [],
    }),
  } as unknown as Response;
}

const unsubscribers: Array<() => void> = [];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Shared module-level cache: start every case cold.
  invalidateModelsCache();
});

afterEach(() => {
  cleanup();
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  vi.unstubAllGlobals();
});

describe("models cache invalidation", () => {
  it("refetches after invalidation instead of returning the cached catalog", async () => {
    fetchMock
      .mockResolvedValueOnce(modelsResponse(["model-a"]))
      .mockResolvedValueOnce(modelsResponse(["model-a", "model-b"]));

    const first = await listModels();
    expect(first.models.map((model) => model.modelId)).toEqual(["model-a"]);

    // A second read is served from the cache — no new request.
    const cached = await listModels();
    expect(cached).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidateModelsCache();

    // The defect: after a provider write this must issue a fresh request, not
    // hand back the stale catalog.
    const refreshed = await listModels();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.models.map((model) => model.modelId)).toEqual([
      "model-a",
      "model-b",
    ]);
  });

  it("refetches a mounted useModels and updates its models when invalidated", async () => {
    fetchMock
      .mockResolvedValueOnce(modelsResponse(["model-a"]))
      .mockResolvedValueOnce(modelsResponse(["model-a", "model-b"]));

    const { result } = renderHook(() => useModels());

    await waitFor(() =>
      expect(result.current.models.map((model) => model.modelId)).toEqual([
        "model-a",
      ]),
    );

    act(() => {
      invalidateModelsCache();
    });

    await waitFor(() =>
      expect(result.current.models.map((model) => model.modelId)).toEqual([
        "model-a",
        "model-b",
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("walks a stable copy of the listeners when one unsubscribes mid-notification", () => {
    const seen: string[] = [];
    unsubscribers.push(
      subscribeModelsCache(() => {
        seen.push("first");
        // Unsubscribing the second listener during the walk must not drop it.
        unsubscribers[1]?.();
      }),
    );
    unsubscribers.push(
      subscribeModelsCache(() => {
        seen.push("second");
      }),
    );

    invalidateModelsCache();

    expect(seen).toEqual(["first", "second"]);
  });
});
