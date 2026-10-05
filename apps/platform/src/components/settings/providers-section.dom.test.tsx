// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnection, ProviderKindInfo } from "#/lib/api";

/**
 * The hooks the section reads and the three API calls it makes are mocked, so
 * the editor can be driven end to end without a server. `save` is the mocked
 * connection hook's write path: it receives exactly the payload the real hook
 * would POST.
 */
const mocks = vi.hoisted(() => ({
  listProviderKinds: vi.fn(),
  listProviderModels: vi.fn(),
  testProviderConnection: vi.fn(),
  save: vi.fn(),
  useProviderConnections: vi.fn(),
  useProviderModels: vi.fn(),
}));

vi.mock("#/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/lib/api")>();
  return {
    ...actual,
    listProviderKinds: mocks.listProviderKinds,
    listProviderModels: mocks.listProviderModels,
    testProviderConnection: mocks.testProviderConnection,
  };
});

vi.mock("#/hooks/use-provider-connections", () => ({
  useProviderConnections: mocks.useProviderConnections,
  useProviderModels: mocks.useProviderModels,
}));

vi.mock("#/hooks/use-models", () => ({
  useModels: () => ({
    models: [],
    reasoningEfforts: [],
    status: "success",
    error: null,
    retry: () => undefined,
  }),
}));

import { ProvidersSection, toHeadersPayload } from "./providers-section";

afterEach(cleanup);

const KIND: ProviderKindInfo = {
  kind: "openai",
  label: "OpenAI",
  credentialPlaceholder: "sk-…",
  supportsBaseUrl: false,
  requiresBaseUrl: false,
  apiVariants: ["chat"],
  defaultApi: "chat",
  imageStyle: "none",
  imageLimits: null,
};

/** A saved connection as the API client returns it after a create. */
function savedConnection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: "conn-new",
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
  mocks.listProviderKinds.mockResolvedValue({
    kinds: [KIND],
    effortVocabulary: [],
  });
  mocks.listProviderModels.mockResolvedValue([]);
  mocks.testProviderConnection.mockResolvedValue({ ok: true, modelCount: 3 });
  mocks.save.mockResolvedValue(savedConnection());
  mocks.useProviderConnections.mockReturnValue({
    data: [],
    loading: false,
    error: null,
    saving: false,
    reload: vi.fn(),
    save: mocks.save,
    remove: vi.fn(),
    toggle: vi.fn(),
  });
  mocks.useProviderModels.mockReturnValue({
    data: [],
    loading: false,
    error: null,
    saving: false,
    reload: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    discover: vi.fn(),
  });
});

describe("toHeadersPayload", () => {
  it("sends a dynamic header as a source, not as text", () => {
    expect(
      toHeadersPayload([
        { id: "1", name: "x-opencode-session", value: "", dynamic: "sessionId" },
        { id: "2", name: "x-tenant", value: "acme" },
      ]),
    ).toEqual({
      "x-opencode-session": { dynamic: "sessionId" },
      "x-tenant": "acme",
    });
  });

  it("drops the source when the row is Fixed", () => {
    expect(
      toHeadersPayload([
        { id: "1", name: "x-session", value: "literal", dynamic: undefined },
      ]),
    ).toEqual({ "x-session": "literal" });
  });

  it("trims names and skips nameless rows", () => {
    expect(
      toHeadersPayload([
        { id: "1", name: "  x-tenant  ", value: "acme" },
        { id: "2", name: "   ", value: "ignored" },
      ]),
    ).toEqual({ "x-tenant": "acme" });
  });
});

describe("ProvidersSection — the Test button carries dynamic markers", () => {
  it("sends the marker to Test and to Save", async () => {
    const user = userEvent.setup();
    render(<ProvidersSection active />);

    await user.click(
      await screen.findByRole("button", { name: "Add provider" }),
    );
    await user.type(screen.getByLabelText("Label"), "My gateway");

    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(
      screen.getByLabelText("Custom headers header name"),
      "x-opencode-session",
    );
    await user.click(
      screen.getByRole("button", { name: /header value mode/i }),
    );
    await user.click(screen.getByRole("option", { name: /session id/i }));

    await user.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(mocks.testProviderConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { "x-opencode-session": { dynamic: "sessionId" } },
        }),
      ),
    );

    // The passing test unlocks Save for a new connection; the payload carries
    // the same marker, not the empty literal the row still holds.
    await user.click(
      await screen.findByRole("button", { name: "Add provider" }),
    );
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          headers: { "x-opencode-session": { dynamic: "sessionId" } },
        }),
      ),
    );
  });
});

describe("ProvidersSection — after saving a new provider", () => {
  it("stays on the saved connection so a model can be added without opening Edit", async () => {
    const user = userEvent.setup();
    const saved = savedConnection();
    // `save` resolves with the created row and the list holds it, exactly as
    // the real hook's reload leaves the section.
    mocks.useProviderConnections.mockReturnValue({
      data: [saved],
      loading: false,
      error: null,
      saving: false,
      reload: vi.fn(),
      save: mocks.save,
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    render(<ProvidersSection active />);

    await user.click(
      await screen.findByRole("button", { name: "Add provider" }),
    );
    await user.type(screen.getByLabelText("Label"), "My gateway");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await user.click(
      await screen.findByRole("button", { name: "Add provider" }),
    );

    // Still editing the saved connection — not back to the provider list.
    expect(
      await screen.findByRole("heading", { name: "Edit provider connection" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add model" })).toBeTruthy();
    expect(screen.getByText("No models yet — add the ones you want in the picker.")).toBeTruthy();
  });
});
