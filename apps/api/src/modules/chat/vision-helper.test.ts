import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeToolResultOutput } from "@anvia/core/tool";
import {
  createRemoteImageAttacher,
  createViewImageTool,
  loadRemoteImage,
  resolveVisionHelperModel,
  type ViewImageToolOptions,
} from "./vision-helper.js";
import type { CompletionModel } from "@anvia/core/completion";
import type { ToolResultContentPart } from "@anvia/core";
import type { ImageStore } from "../images/service.js";
import { prisma } from "../../utils/prisma.js";

const f = vi.hoisted(() => ({
  createCompletionModel: vi.fn((modelId?: string) => ({ modelId })),
  findActiveModel: vi.fn(
    async (_modelId: string, _userId?: string): Promise<unknown> => null,
  ),
  listModels: vi.fn(
    async (_input?: unknown): Promise<unknown> => ({
      models: [],
      reasoningEfforts: [],
    }),
  ),
  listRoleAssignments: vi.fn(
    async (_db: unknown, _userId: string): Promise<unknown[]> => [],
  ),
  buildRoleCompletionModel: vi.fn(
    async (_db: unknown, _userId: string, _role: string): Promise<unknown> => null,
  ),
}));

vi.mock("@anreal/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anreal/agent")>()),
  createCompletionModel: f.createCompletionModel,
}));

vi.mock("../models/service.js", () => ({
  findActiveModel: f.findActiveModel,
  listModels: f.listModels,
}));

vi.mock("../models/roles.js", () => ({
  listRoleAssignments: f.listRoleAssignments,
  buildRoleCompletionModel: f.buildRoleCompletionModel,
}));

vi.mock("../../utils/prisma.js", () => ({ prisma: { __tag: "prisma" } }));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("node:net", async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import("node:net");
  return {
    ...mod,
    isIP: () => 0,
  };
});

const USER = "user-1";
const SESSION = "session-1";

function makeOptions(
  overrides: Partial<ViewImageToolOptions> = {},
): ViewImageToolOptions {
  return {
    userId: USER,
    sessionId: SESSION,
    store: {
      getImage: vi.fn(async () => null),
      getObjectBuffer: vi.fn(async () => new Uint8Array([1, 2, 3])),
      saveGeneratedImage: vi.fn(async (input: Record<string, unknown>) => ({
        id: "web-img-1", userId: USER, sessionId: SESSION, projectId: null,
        r2Key: "images/user-1/web-1", mediaType: "image/png", width: 0, height: 0,
        modelId: "web", prompt: String(input.prompt), nOfTotal: null,
        source: "web", sourceUrl: String(input.sourceUrl), createdAt: new Date(),
      })),
      findSessionImageBySourceUrl: vi.fn(async () => null),
    } as unknown as ImageStore,
    model: {
      provider: "stub",
      defaultModel: "stub-vision",
      capabilities: {
        streaming: false,
        tools: false,
        toolChoice: false,
        imageInput: true,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      completion: vi.fn(async () => ({
        choice: [
          {
            type: "text",
            text: "A chart showing quarterly revenue.",
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 } as never,
        rawResponse: {},
      })),
    } as unknown as CompletionModel,
    ...overrides,
  };
}

describe("view_image document image resolution", () => {
  it("falls back to resolveDocumentImage when the id is not a session image", async () => {
    const resolveDocumentImage = vi.fn(async () => ({
      mediaType: "image/png",
      buffer: new Uint8Array([9, 9, 9]),
    }));
    const tool = createViewImageTool(makeOptions({ resolveDocumentImage }));

    const output = await tool.call({ imageId: "doc-img-1" });

    expect(resolveDocumentImage).toHaveBeenCalledWith("doc-img-1", USER, SESSION);
    expect(output).toBe("A chart showing quarterly revenue.");
  });

  it("reports the not-found error when neither store nor document resolver matches", async () => {
    const tool = createViewImageTool(
      makeOptions({ resolveDocumentImage: vi.fn(async () => null) }),
    );

    const output = await tool.call({ imageId: "missing-img" });

    expect(output).toContain("Image not found in this session");
    expect(output).toContain("get_document_page_images");
  });
});

describe("view_image universal", () => {
  it("vision mode returns native Anvia content parts for a public URL", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );
    const tool = createViewImageTool(
      makeOptions({ mode: "vision", fetchFn: fakeFetch as unknown as typeof fetch }),
    );
    const normalized = normalizeToolResultOutput(await tool.call({
      url: "https://example.com/photo.jpg",
    }));
    expect(normalized.type).toBe("content");
    if (normalized.type !== "content") throw new Error("expected content output");
    const result: readonly ToolResultContentPart[] = normalized.value;
    expect(result[0]).toMatchObject({ type: "text" });
    expect(result[1]).toMatchObject({ type: "file", mediaType: "image/jpeg" });
  });

  it("description mode (non-vision) still returns text description", async () => {
    const resolveDocumentImage = vi.fn(async () => ({
      mediaType: "image/png",
      buffer: new Uint8Array([9, 9, 9]),
    }));
    const tool = createViewImageTool(
      makeOptions({ mode: "description", resolveDocumentImage }),
    );
    const output = await tool.call({ imageId: "doc-img-1" });
    expect(typeof output).toBe("string");
    expect(output).toBe("A chart showing quarterly revenue.");
  });

  it("vision mode also supports imageId by loading session image bytes", async () => {
    const store = {
      getImage: vi.fn(async () => ({
        userId: USER,
        sessionId: SESSION,
        r2Key: "k1",
        mediaType: "image/png",
      })),
      getObjectBuffer: vi.fn(async () => new Uint8Array([1, 2, 3])),
    } as unknown as ImageStore;
    const tool = createViewImageTool(makeOptions({ mode: "vision", store }));
    const normalized = normalizeToolResultOutput(await tool.call({ imageId: "img-1" }));
    expect(normalized.type).toBe("content");
    if (normalized.type !== "content") throw new Error("expected content output");
    expect(normalized.value.some((p) => p.type === "file")).toBe(true);
  });

  it("createRemoteImageAttacher persists and returns file-ready payloads", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const store = {
      findSessionImageBySourceUrl: vi.fn(async () => null),
      saveGeneratedImage: vi.fn(async () => ({ id: "web-img-1" })),
    };
    const attach = createRemoteImageAttacher({
      userId: USER,
      sessionId: SESSION,
      store: store as never,
      fetchFn: fakeFetch as never,
    });
    const attached = await attach(["https://example.com/photo.jpg"]);
    expect(attached).toEqual([
      expect.objectContaining({
        url: "https://example.com/photo.jpg",
        mediaType: "image/jpeg",
        imageId: "web-img-1",
      }),
    ]);
    expect(store.saveGeneratedImage).toHaveBeenCalledOnce();
  });

  it("persists a web URL photo (vision mode) and returns imageId in the text JSON", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const options = makeOptions({ mode: "vision", fetchFn: fakeFetch as never });
    const store = options.store as unknown as {
      saveGeneratedImage: ReturnType<typeof vi.fn>;
      findSessionImageBySourceUrl: ReturnType<typeof vi.fn>;
    };
    const tool = createViewImageTool(options);
    const normalized = normalizeToolResultOutput(await tool.call({ url: "https://example.com/photo.jpg" }));
    expect(normalized.type).toBe("content");
    if (normalized.type !== "content") throw new Error("expected content output");
    const result = normalized.value;
    expect(store.saveGeneratedImage).toHaveBeenCalledWith(expect.objectContaining({
      source: "web", sourceUrl: "https://example.com/photo.jpg", modelId: "web",
    }));
    const text = result.find((p) => p.type === "text");
    const parsed = JSON.parse((text as { text: string }).text) as { images: Array<{ imageId: string }> };
    expect(parsed.images[0]!.imageId).toBe("web-img-1");
  });

  it("reuses an existing record when the same URL was already seen (dedup)", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const options = makeOptions({ mode: "vision", fetchFn: fakeFetch as never });
    const store = options.store as unknown as {
      saveGeneratedImage: ReturnType<typeof vi.fn>;
      findSessionImageBySourceUrl: ReturnType<typeof vi.fn>;
    };
    store.findSessionImageBySourceUrl.mockResolvedValue({ id: "existing-1", userId: USER, sessionId: SESSION, projectId: null, r2Key: "r", mediaType: "image/jpeg", width: 0, height: 0, modelId: "web", prompt: "p", nOfTotal: null, source: "web", sourceUrl: "https://example.com/photo.jpg", createdAt: new Date() } as never);
    const tool = createViewImageTool(options);
    await tool.call({ url: "https://example.com/photo.jpg" });
    expect(store.saveGeneratedImage).not.toHaveBeenCalled();
  });

  it("description mode returns JSON with images and description", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const tool = createViewImageTool(makeOptions({ mode: "description", fetchFn: fakeFetch as never }));
    const output = (await tool.call({ url: "https://example.com/photo.jpg" })) as string;
    const parsed = JSON.parse(output) as { images: unknown[]; description: string; sourceUrl: string };
    expect(parsed.description).toBe("A chart showing quarterly revenue.");
    expect(parsed.sourceUrl).toBe("https://example.com/photo.jpg");
    expect(Array.isArray(parsed.images)).toBe(true);
  });

  it("does NOT persist an imageId-path (session/document) view", async () => {
    const options = makeOptions({ mode: "vision" });
    const store = options.store as unknown as {
      saveGeneratedImage: ReturnType<typeof vi.fn>;
    };
    const resolveDoc = vi.fn(async () => ({ mediaType: "image/png", buffer: new Uint8Array([9, 9, 9]) }));
    const tool = createViewImageTool(makeOptions({ mode: "vision", resolveDocumentImage: resolveDoc, store: store as never }));
    await tool.call({ imageId: "doc-img-1" });
    expect(store.saveGeneratedImage).not.toHaveBeenCalled();
  });
});

describe("loadRemoteImage format bounds", () => {
  it("rejects non-raster images (e.g. SVG) so vision providers do not 400", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        }),
    );
    const result = await loadRemoteImage({
      url: "https://example.com/logo.svg",
      fetchFn: fakeFetch as unknown as typeof fetch,
    });
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/supported image format/i);
  });

  it("sniffs PNG magic bytes even when the content-type is generic", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    );
    const result = await loadRemoteImage({
      url: "https://example.com/photo",
      fetchFn: fakeFetch as unknown as typeof fetch,
    });
    expect("mediaType" in result).toBe(true);
    expect((result as { mediaType: string }).mediaType).toBe("image/png");
  });
});

describe("resolveVisionHelperModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    f.findActiveModel.mockResolvedValue(null);
    f.listModels.mockResolvedValue({ models: [], reasoningEfforts: [] });
    f.listRoleAssignments.mockResolvedValue([]);
    f.buildRoleCompletionModel.mockResolvedValue(null);
  });

  it("uses the user's assignment and scopes the lookup by userId", async () => {
    const assigned = { modelId: "openai/gpt-6-luna", capabilities: { imageInput: true } };
    f.listRoleAssignments.mockResolvedValue([
      { role: "visionHelper", modelId: "openai/gpt-6-luna", defaultModelId: null },
    ]);
    f.buildRoleCompletionModel.mockResolvedValue(assigned);

    await expect(resolveVisionHelperModel("u_1")).resolves.toBe(assigned);
    expect(f.listRoleAssignments).toHaveBeenCalledWith(prisma, "u_1");
    expect(f.buildRoleCompletionModel).toHaveBeenCalledWith(
      prisma,
      "u_1",
      "visionHelper",
    );
  });

  it("ignores a resolved assignment that does not accept images", async () => {
    // The gap: an assignment exists, so the builder is consulted, but it folds
    // in a text-only env default after the assignment dangled. The built
    // handle declares no image input, so it must never reach view_image.
    vi.stubEnv("VISION_HELPER_MODEL", "text-only/env-model");
    f.listRoleAssignments.mockResolvedValue([
      { role: "visionHelper", modelId: "text-only/assigned", defaultModelId: null },
    ]);
    f.buildRoleCompletionModel.mockResolvedValue({
      modelId: "text-only/assigned",
      capabilities: { imageInput: false },
    });
    f.findActiveModel.mockResolvedValue({ inputModalities: ["text"] });
    f.listModels.mockResolvedValue({
      models: [
        { modelId: "vision-cheap", inputModalities: ["text", "image"], prices: { input: 1 } },
      ],
      reasoningEfforts: [],
    });

    await expect(resolveVisionHelperModel("u_1")).resolves.toEqual({
      modelId: "vision-cheap",
    });
    expect(f.createCompletionModel).toHaveBeenCalledWith("vision-cheap");
    expect(f.createCompletionModel).not.toHaveBeenCalledWith("text-only/assigned");
    expect(f.createCompletionModel).not.toHaveBeenCalledWith("text-only/env-model");
  });

  it("still falls through to the dynamic pick when the assigned model is gone", async () => {
    f.listRoleAssignments.mockResolvedValue([
      { role: "visionHelper", modelId: "gone/model", defaultModelId: null },
    ]);
    f.buildRoleCompletionModel.mockResolvedValue(null);
    f.listModels.mockResolvedValue({
      models: [
        { modelId: "vision-cheap", inputModalities: ["text", "image"], prices: { input: 1 } },
      ],
      reasoningEfforts: [],
    });

    await expect(resolveVisionHelperModel("u_1")).resolves.toEqual({
      modelId: "vision-cheap",
    });
  });

  it("keeps the env override when it accepts images", async () => {
    vi.stubEnv("VISION_HELPER_MODEL", "openai/gpt-5-vision");
    f.findActiveModel.mockResolvedValue({ inputModalities: ["text", "image"] });

    await expect(resolveVisionHelperModel("u_1")).resolves.toEqual({
      modelId: "openai/gpt-5-vision",
    });
    // The env model is looked up inside the caller's scope: a BYOK id can
    // only resolve with the user id.
    expect(f.findActiveModel).toHaveBeenCalledWith("openai/gpt-5-vision", "u_1");
  });

  it("ignores a text-only VISION_HELPER_MODEL and picks the cheapest vision model", async () => {
    vi.stubEnv("VISION_HELPER_MODEL", "deepseek/deepseek-v4-flash-0731");
    f.findActiveModel.mockResolvedValue({ inputModalities: ["text"] });
    f.listModels.mockResolvedValue({
      models: [
        { modelId: "text-only", inputModalities: ["text"], prices: { input: 0 } },
        { modelId: "vision-pricey", inputModalities: ["text", "image"], prices: { input: 5 } },
        { modelId: "vision-cheap", inputModalities: ["text", "image"], prices: { input: 1 } },
      ],
      reasoningEfforts: [],
    });

    await expect(resolveVisionHelperModel("u_1")).resolves.toEqual({
      modelId: "vision-cheap",
    });
    expect(f.findActiveModel).toHaveBeenCalledWith(
      "deepseek/deepseek-v4-flash-0731",
      "u_1",
    );
    expect(f.createCompletionModel).toHaveBeenCalledWith("vision-cheap");
    expect(f.createCompletionModel).not.toHaveBeenCalledWith(
      "deepseek/deepseek-v4-flash-0731",
    );
  });

  it("picks the cheapest vision model when there is no assignment or env override", async () => {
    f.listModels.mockResolvedValue({
      models: [
        { modelId: "vision-only", inputModalities: ["text", "image"], prices: { input: 3 } },
      ],
      reasoningEfforts: [],
    });

    await expect(resolveVisionHelperModel("u_1")).resolves.toEqual({
      modelId: "vision-only",
    });
  });

  it("returns null when no vision model is available", async () => {
    await expect(resolveVisionHelperModel("u_1")).resolves.toBeNull();
  });
});
