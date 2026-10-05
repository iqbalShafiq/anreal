// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnection } from "#/lib/api";

/**
 * The hook's network boundary is the API client module, so that is what is
 * mocked; the hook's own state machine stays real. `reload` re-reads the list
 * after every write, so each mock queues the pre-write and post-write lists.
 */
const mocks = vi.hoisted(() => ({
  listProviderConnections: vi.fn(),
  createProviderConnection: vi.fn(),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
  setProviderConnectionEnabled: vi.fn(),
}));

vi.mock("#/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/lib/api")>();
  return {
    ...actual,
    listProviderConnections: mocks.listProviderConnections,
    createProviderConnection: mocks.createProviderConnection,
    updateProviderConnection: mocks.updateProviderConnection,
    deleteProviderConnection: mocks.deleteProviderConnection,
    setProviderConnectionEnabled: mocks.setProviderConnectionEnabled,
  };
});

import { useProviderConnections } from "./use-provider-connections";

afterEach(cleanup);

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: "conn-1",
    kind: "openai",
    label: "My gateway",
    slug: "my-gateway",
    baseUrl: null,
    api: null,
    isActive: true,
    sortOrder: 0,
    hasCredentials: true,
    credentialsStatus: "ok",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useProviderConnections.save", () => {
  it("resolves with the connection the server created", async () => {
    const saved = connection({ id: "conn-new" });
    mocks.listProviderConnections
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([saved]);
    mocks.createProviderConnection.mockResolvedValue(saved);

    const { result } = renderHook(() => useProviderConnections(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: ProviderConnection | undefined;
    await act(async () => {
      returned = await result.current.save(null, {
        kind: "openai",
        label: "My gateway",
      });
    });

    // The caller needs the new row's id to keep the editor open on it.
    expect(returned).toEqual(saved);
    expect(mocks.createProviderConnection).toHaveBeenCalledWith({
      kind: "openai",
      label: "My gateway",
    });
    // The write reloads the list, so the row is present for the next render.
    expect(mocks.listProviderConnections).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual([saved]);
  });

  it("resolves with the updated connection when an id is given", async () => {
    const updated = connection({ label: "Renamed" });
    mocks.listProviderConnections
      .mockResolvedValueOnce([connection()])
      .mockResolvedValueOnce([updated]);
    mocks.updateProviderConnection.mockResolvedValue(updated);

    const { result } = renderHook(() => useProviderConnections(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: ProviderConnection | undefined;
    await act(async () => {
      returned = await result.current.save("conn-1", {
        kind: "openai",
        label: "Renamed",
      });
    });

    expect(returned).toEqual(updated);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-1", {
      kind: "openai",
      label: "Renamed",
    });
  });
});
