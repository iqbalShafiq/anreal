import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("./service.js", () => ({
  listModels: vi.fn(),
}));

vi.mock("./roles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./roles.js")>();
  return {
    ...actual,
    listRoleAssignments: vi.fn(),
    setRoleAssignment: vi.fn(),
  };
});

vi.mock("../auth/middleware.js", () => ({
  requireUser: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "u_1" });
    await next();
  },
}));

import { modelsRouter } from "./router.js";
import {
  listRoleAssignments,
  setRoleAssignment,
  type RoleInfo,
} from "./roles.js";
import { listModels } from "./service.js";

const app = new Hono().route("/api/models", modelsRouter);

describe("GET /api/models", () => {
  beforeEach(() => {
    vi.mocked(listModels).mockClear().mockResolvedValue({
      models: [],
      reasoningEfforts: [],
    });
  });

  it("returns all models when outputType is absent", async () => {
    const res = await app.request("/api/models");

    expect(res.status).toBe(200);
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenCalledWith({ userId: "u_1" });
  });

  it("passes outputType=image to the service", async () => {
    const res = await app.request("/api/models?outputType=image");

    expect(res.status).toBe(200);
    expect(listModels).toHaveBeenCalledWith({
      outputType: "image",
      userId: "u_1",
    });
  });

  it("passes outputType=text to the service", async () => {
    const res = await app.request("/api/models?outputType=text");

    expect(res.status).toBe(200);
    expect(listModels).toHaveBeenCalledWith({
      outputType: "text",
      userId: "u_1",
    });
  });

  it("rejects an invalid outputType with 400", async () => {
    const res = await app.request("/api/models?outputType=video");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "outputType must be 'text' or 'image'",
    });
    expect(listModels).not.toHaveBeenCalled();
  });
});

const ROLE_FIXTURE: RoleInfo[] = (
  [
    "chat",
    "memoryCompaction",
    "profileSummary",
    "siteBuilder",
    "visionHelper",
    "scheduledChat",
  ] as const
).map((role) => ({ role, modelId: null, defaultModelId: null }));

describe("role assignments", () => {
  beforeEach(() => {
    vi.mocked(listRoleAssignments).mockClear().mockResolvedValue(ROLE_FIXTURE);
    vi.mocked(setRoleAssignment).mockClear();
  });

  it("serves role assignments before any :id-shaped route", async () => {
    const res = await app.request("/api/models/roles");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roles: { role: string }[] };
    expect(body.roles.map((entry) => entry.role)).toEqual([
      "chat",
      "memoryCompaction",
      "profileSummary",
      "siteBuilder",
      "visionHelper",
      "scheduledChat",
    ]);
  });

  it("rejects an assignment body without a role", async () => {
    const res = await app.request("/api/models/roles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "openai/gpt-6-luna" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown model with a field-level error", async () => {
    vi.mocked(setRoleAssignment).mockRejectedValueOnce(
      Object.assign(new Error("Unknown model"), {
        name: "RoleInputError",
        issues: [{ path: "modelId", message: "Unknown model" }],
      }),
    );
    const res = await app.request("/api/models/roles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "siteBuilder", modelId: "nobody/else" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: { path: string }[] };
    expect(body.issues[0]?.path).toBe("modelId");
  });
});
