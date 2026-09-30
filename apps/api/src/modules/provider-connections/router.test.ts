import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const service = vi.hoisted(() => ({
  listConnections: vi.fn(async () => []),
  createConnection: vi.fn(async () => ({ id: "pc_1", hasCredentials: true })),
  updateConnection: vi.fn(async () => ({ id: "pc_1", hasCredentials: true })),
  deleteConnection: vi.fn(async () => undefined),
  listConnectionModels: vi.fn(async () => []),
  createConnectionModel: vi.fn(async () => ({ id: "pm_1" })),
  updateConnectionModel: vi.fn(async () => ({ id: "pm_1" })),
  deleteConnectionModel: vi.fn(async () => undefined),
  setConnectionEnabled: vi.fn(async () => ({ id: "pc_1", hasCredentials: true })),
  discoverConnectionModels: vi.fn(async () => ({ data: [] })),
}));

vi.mock("./service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service.js")>();
  return { ...actual, ...service };
});

vi.mock("../auth/middleware.js", () => ({
  requireUser: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "u_1" });
    await next();
  },
}));

import { providerConnectionsRouter } from "./router.js";

const app = new Hono().route("/api/providers", providerConnectionsRouter);

describe("provider routes", () => {
  it("serves provider kinds before the :id route", async () => {
    const res = await app.request("/api/providers/kinds");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kinds: { kind: string; imageStyle: string; requiresBaseUrl: boolean }[];
      effortVocabulary: string[];
    };
    expect(body.kinds.map((k) => k.kind)).toContain("compatible");
    expect(body.kinds.map((k) => k.kind)).toContain("anthropic");
    expect(body.effortVocabulary).toContain("none");
    expect(body.kinds.find((k) => k.kind === "compatible")?.requiresBaseUrl).toBe(true);
  });

  it("returns 404 for another user's connection", async () => {
    service.updateConnection.mockRejectedValueOnce(
      Object.assign(new Error("Connection not found"), {
        name: "ProviderInputError",
        issues: [{ path: "id", message: "Connection not found" }],
      }),
    );
    const res = await app.request("/api/providers/pc_other", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", label: "X", apiKey: "sk-abcdefgh" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed body with a field-level error", async () => {
    const res = await app.request("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai" }),
    });
    expect(res.status).toBe(400);
  });

  it("passes the authenticated user into the service", async () => {
    await app.request("/api/providers");
    expect(service.listConnections).toHaveBeenCalledWith(
      expect.anything(),
      "u_1",
    );
  });

  it("toggles a connection through the enabled route", async () => {
    const res = await app.request("/api/providers/pc_1/enabled", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled: false }),
    });
    expect(res.status).toBe(200);
    expect(service.setConnectionEnabled).toHaveBeenCalledWith(
      expect.anything(),
      "u_1",
      "pc_1",
      false,
    );
  });

  it("rejects a malformed enabled body", async () => {
    service.setConnectionEnabled.mockClear();
    const res = await app.request("/api/providers/pc_1/enabled", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled: "no" }),
    });
    expect(res.status).toBe(400);
    expect(service.setConnectionEnabled).not.toHaveBeenCalled();
  });

  it("does not expose the credential envelope on create", async () => {
    const res = await app.request("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", label: "X", apiKey: "sk-abcdefgh" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.hasCredentials).toBe(true);
    expect(body).not.toHaveProperty("credentialsRef");
  });

  it("does not expose the credential envelope on update", async () => {
    const res = await app.request("/api/providers/pc_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", label: "X", apiKey: "sk-abcdefgh" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.hasCredentials).toBe(true);
    expect(body).not.toHaveProperty("credentialsRef");
  });

  it("does not expose the credential envelope on enabled", async () => {
    const res = await app.request("/api/providers/pc_1/enabled", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.hasCredentials).toBe(true);
    expect(body).not.toHaveProperty("credentialsRef");
  });
});
