// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProviderConnection,
  createProviderModel,
  deleteProviderConnection,
  deleteProviderModel,
  discoverProviderModels,
  invalidateModelsCache,
  listModels,
  listProviderConnections,
  listProviderKinds,
  listProviderModels,
  prefillProviderModel,
  setProviderConnectionEnabled,
  subscribeModelsCache,
  testProviderConnection,
  updateProviderConnection,
  updateProviderModel,
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

function okJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

function notOk(text = "nope"): Response {
  return {
    ok: false,
    status: 400,
    json: async () => ({ error: text }),
  } as unknown as Response;
}

/** Minimal payloads accepted by the client's shape guards. */
function connectionRow() {
  return {
    id: "conn-1",
    kind: "openrouter",
    label: "OpenRouter",
    slug: "openrouter",
    hasCredentials: true,
    isActive: true,
    sortOrder: 0,
  };
}

function providerModelRow() {
  return {
    id: "pm-1",
    slug: "gpt",
    upstreamId: "openai/gpt",
    name: "GPT",
    label: "GPT",
    connectionId: "conn-1",
  };
}

/** Seed the shared cache with one model, proving one request was made. */
async function primeCatalog() {
  fetchMock.mockResolvedValueOnce(modelsResponse(["model-a"]));
  await listModels();
  expect(fetchMock).toHaveBeenCalledTimes(1);
}

const connectionInput = { kind: "openrouter", label: "OpenRouter" };
const modelInput = { upstreamId: "openai/gpt" };

type ApiCase = {
  name: string;
  /** Successful response body for this endpoint. */
  response: () => unknown;
  call: () => Promise<unknown>;
};

// The seven writers that can change the merged catalog.
const writerCases: ApiCase[] = [
  {
    name: "createProviderConnection",
    response: connectionRow,
    call: () => createProviderConnection(connectionInput),
  },
  {
    name: "updateProviderConnection",
    response: connectionRow,
    call: () => updateProviderConnection("conn-1", connectionInput),
  },
  {
    name: "deleteProviderConnection",
    response: () => ({}),
    call: () => deleteProviderConnection("conn-1"),
  },
  {
    name: "setProviderConnectionEnabled",
    response: connectionRow,
    call: () => setProviderConnectionEnabled("conn-1", false),
  },
  {
    name: "createProviderModel",
    response: providerModelRow,
    call: () => createProviderModel("conn-1", modelInput),
  },
  {
    name: "updateProviderModel",
    response: providerModelRow,
    call: () => updateProviderModel("conn-1", "pm-1", modelInput),
  },
  {
    name: "deleteProviderModel",
    response: () => ({}),
    call: () => deleteProviderModel("conn-1", "pm-1"),
  },
];

// The six read-only functions that must never invalidate the catalog.
const readOnlyCases: ApiCase[] = [
  {
    name: "listProviderKinds",
    response: () => ({ kinds: [], effortVocabulary: [] }),
    call: () => listProviderKinds(),
  },
  {
    name: "listProviderConnections",
    response: () => [],
    call: () => listProviderConnections(),
  },
  {
    name: "discoverProviderModels",
    response: () => ({ data: [] }),
    call: () => discoverProviderModels("conn-1"),
  },
  {
    name: "listProviderModels",
    response: () => [],
    call: () => listProviderModels("conn-1"),
  },
  {
    name: "prefillProviderModel",
    response: () => ({ name: "GPT" }),
    call: () => prefillProviderModel("conn-1", { upstreamId: "openai/gpt" }),
  },
  {
    name: "testProviderConnection",
    response: () => ({ ok: true, modelCount: 0 }),
    call: () => testProviderConnection({ kind: "openrouter" }),
  },
];

const unsubscribers: Array<() => void> = [];

beforeEach(() => {
  fetchMock.mockReset();
  // Any read beyond the queued calls is a bug the sweep tests should surface as
  // a count/content mismatch rather than a thrown `undefined` response.
  fetchMock.mockResolvedValue(modelsResponse(["stray-fetch"]));
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

describe("the provider-write invalidation sweep", () => {
  for (const testCase of writerCases) {
    it(`${testCase.name} invalidates the catalog on success`, async () => {
      await primeCatalog();

      fetchMock.mockResolvedValueOnce(okJson(testCase.response()));
      await testCase.call();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Observable effect: listModels refetches rather than serving the cache.
      fetchMock.mockResolvedValueOnce(modelsResponse(["model-a", "model-b"]));
      const refreshed = await listModels();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(refreshed.models.map((model) => model.modelId)).toEqual([
        "model-a",
        "model-b",
      ]);
    });

    it(`${testCase.name} leaves the catalog cached on failure`, async () => {
      await primeCatalog();

      fetchMock.mockResolvedValueOnce(notOk());
      await expect(testCase.call()).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // A failed write must not invalidate: the read is served from the cache.
      const cached = await listModels();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(cached.models.map((model) => model.modelId)).toEqual(["model-a"]);
    });
  }

  for (const testCase of readOnlyCases) {
    it(`${testCase.name} does not invalidate the catalog`, async () => {
      await primeCatalog();

      fetchMock.mockResolvedValueOnce(okJson(testCase.response()));
      await testCase.call();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Read-only: the next read stays cached despite the call succeeding.
      const cached = await listModels();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(cached.models.map((model) => model.modelId)).toEqual(["model-a"]);
    });
  }
});
