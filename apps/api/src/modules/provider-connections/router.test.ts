import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  MAX_MODEL_IMAGES,
  PROVIDER_KIND_META,
  isRepresentableAspectRatio,
  type ImageStyle,
} from "@anreal/agent";

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
  testProviderConnection: vi.fn(async () => ({ ok: true, modelCount: 0 })),
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
import {
  GCD_DERIVED_STYLES,
  IMAGE_CAPABILITY_ALLOWLIST,
  IMAGE_STYLE_FIXED_N,
} from "./service.js";

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

  it("publishes the per-kind image limits derived from the save path's own rules", async () => {
    const res = await app.request("/api/providers/kinds");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kinds: {
        kind: string;
        imageStyle: ImageStyle;
        imageLimits: {
          nMax: number;
          sizing: "sizes" | "resolutions";
          supportsQuality: boolean;
          supportsBackground: boolean;
          representableAspectRatios: string[] | null;
        } | null;
      }[];
    };

    for (const entry of body.kinds) {
      const style = PROVIDER_KIND_META[entry.kind as keyof typeof PROVIDER_KIND_META]
        .imageStyle;
      // The endpoint's style must be the registry's, or the derivation below
      // would compare against the wrong rules.
      expect(entry.imageStyle).toBe(style);

      if (style === "none") {
        expect(entry.imageLimits).toBeNull();
        continue;
      }

      // Expected values are read off the save path's own rule sets, not typed
      // as literals: `IMAGE_STYLE_FIXED_N` decides whether n is pinned, and
      // `IMAGE_CAPABILITY_ALLOWLIST` decides the sizing key and the optional
      // controls. A change to either rule without a matching change to the
      // published payload fails here.
      const allowed = IMAGE_CAPABILITY_ALLOWLIST[style];
      expect(entry.imageLimits?.nMax).toBe(
        IMAGE_STYLE_FIXED_N.has(style) ? 1 : MAX_MODEL_IMAGES,
      );
      expect(entry.imageLimits?.sizing).toBe(
        allowed.has("sizes") ? "sizes" : "resolutions",
      );
      expect(entry.imageLimits?.supportsQuality).toBe(allowed.has("quality"));
      expect(entry.imageLimits?.supportsBackground).toBe(
        allowed.has("background"),
      );

      // The representable list is the tool's table filtered by the tool's rule,
      // and is non-null exactly for the gcd-derived styles.
      if (GCD_DERIVED_STYLES.has(style)) {
        expect(
          entry.imageLimits?.representableAspectRatios?.every(
            isRepresentableAspectRatio,
          ),
        ).toBe(true);
        // `auto` and the unreduceable ratios the rule rejects are absent by
        // construction, not by a hand-maintained list.
        expect(entry.imageLimits?.representableAspectRatios).not.toContain("21:9");
        expect(entry.imageLimits?.representableAspectRatios).not.toContain("auto");
      } else {
        expect(entry.imageLimits?.representableAspectRatios).toBeNull();
      }
    }

    // Spot-check the two shapes so a wholly empty payload cannot pass above.
    const compatible = body.kinds.find((k) => k.kind === "compatible");
    expect(compatible?.imageLimits).toEqual({
      nMax: MAX_MODEL_IMAGES,
      sizing: "sizes",
      supportsQuality: true,
      supportsBackground: true,
      representableAspectRatios: null,
    });
    const gemini = body.kinds.find((k) => k.kind === "gemini");
    expect(gemini?.imageLimits?.nMax).toBe(1);
    expect(gemini?.imageLimits?.sizing).toBe("resolutions");
    expect(gemini?.imageLimits?.representableAspectRatios).toContain("1:1");

    expect(body.kinds.find((k) => k.kind === "openai")?.imageLimits).toBeNull();
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

  it("tests a connection without persisting it", async () => {
    service.testProviderConnection.mockResolvedValueOnce({
      ok: true,
      modelCount: 3,
    });
    const res = await app.request("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        apiKey: "sk-abcdefgh",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, modelCount: 3 });
  });

  it("returns the mapped provider message when a test fails", async () => {
    service.testProviderConnection.mockRejectedValueOnce(
      Object.assign(new Error("The provider reported an invalid API key"), {
        name: "ProviderInputError",
        issues: [
          {
            path: "baseUrl",
            message: "The provider reported an invalid API key",
          },
        ],
      }),
    );
    const res = await app.request("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        apiKey: "sk-abcdefgh",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/invalid api key/i);
  });

  it("turns a unique-constraint violation into a field error", async () => {
    service.createConnectionModel.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "Unique constraint failed on the fields: (`connectionId`,`upstreamId`)",
        ),
        { code: "P2002" },
      ),
    );
    const res = await app.request("/api/providers/pc_1/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upstreamId: "openai/gpt-5.6-luna" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: string;
      issues?: { path: string }[];
    };
    expect(body.issues?.[0]?.path).toBe("slug");
    expect(body.error).toMatch(/already in use/i);
  });

  it("passes imageCapabilities through the strict model schema to the service", async () => {
    service.createConnectionModel.mockResolvedValueOnce({ id: "pm_1" });
    const caps = {
      n: { min: 1, max: 4 },
      sizes: ["1024x1024", "auto"],
      aspectRatios: ["1:1", "auto"],
    };
    const res = await app.request("/api/providers/pc_1/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upstreamId: "openai/gpt-5-image-mini",
        outputType: "image",
        imageCapabilities: caps,
      }),
    });
    expect(res.status).toBe(201);
    expect(service.createConnectionModel).toHaveBeenCalledWith(
      expect.anything(),
      "u_1",
      "pc_1",
      expect.objectContaining({ imageCapabilities: caps }),
    );
  });

  it("is registered before the :id route", async () => {
    service.testProviderConnection.mockClear();
    const res = await app.request("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        apiKey: "sk-abcdefgh",
      }),
    });
    expect(res.status).toBe(200);
    expect(service.testProviderConnection).toHaveBeenCalled();
  });
});
