import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("./service.js", () => ({
  listModels: vi.fn(),
}));

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
