import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../utils/prisma.js";
import { listModels, MODEL_SELECT } from "./service.js";

vi.mock("../../utils/prisma.js", () => ({
  prisma: {
    chatModel: { findMany: vi.fn(), findFirst: vi.fn() },
    reasoningEffort: { findMany: vi.fn() },
  },
}));

function makeModelRow(overrides: Record<string, unknown> = {}) {
  return {
    modelId: "openai/gpt-5-image-mini",
    label: "GPT-5 Image Mini",
    name: "GPT-5 Image Mini",
    hint: "Fastest • $0.008/img",
    description: "OpenAI image generation",
    iconSvg: "",
    contextWindowTokens: 0,
    maxInputTokens: null,
    maxOutputTokens: null,
    inputPricePerMTokens: null,
    cachedInputPricePerMTokens: null,
    outputPricePerMTokens: null,
    cacheWriteMultiplier: null,
    longPromptThresholdTokens: null,
    longPromptInputMultiplier: null,
    longPromptOutputMultiplier: null,
    outputType: "text",
    inputModalities: null,
    outputModalities: null,
    imageCapabilities: null,
    sortOrder: 0,
    provider: { slug: "openai", name: "OpenAI" },
    reasoningEfforts: [],
    ...overrides,
  };
}

describe("models service", () => {
  it("exposes capability columns on MODEL_SELECT", () => {
    const keys = Object.keys(MODEL_SELECT);
    expect(keys).toContain("outputType");
    expect(keys).toContain("inputModalities");
    expect(keys).toContain("outputModalities");
    expect(keys).toContain("imageCapabilities");
  });
});

describe("listModels", () => {
  beforeEach(() => {
    vi.mocked(prisma.chatModel.findMany).mockClear().mockResolvedValue([]);
    vi.mocked(prisma.reasoningEffort.findMany).mockClear().mockResolvedValue([]);
  });

  it("filters by outputType image when requested", async () => {
    await listModels({ outputType: "image" });

    expect(prisma.chatModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          provider: { isActive: true },
          outputType: "image",
        },
      }),
    );
  });

  it("filters by outputType text when requested", async () => {
    await listModels({ outputType: "text" });

    expect(prisma.chatModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          provider: { isActive: true },
          outputType: "text",
        },
      }),
    );
  });

  it("omits the outputType filter when absent", async () => {
    await listModels();

    const args = vi.mocked(prisma.chatModel.findMany).mock.calls[0]?.[0];
    expect(args).toBeDefined();
    expect(
      (args as { where: Record<string, unknown> }).where,
    ).not.toHaveProperty("outputType");
  });

  it("passes outputType and imageCapabilities through to model info", async () => {
    const imageCapabilities = {
      quality: ["auto", "high"],
      n: { min: 1, max: 10 },
      aspectRatios: ["1:1", "16:9"],
    };
    vi.mocked(prisma.chatModel.findMany).mockResolvedValue(
      [makeModelRow({ outputType: "image", imageCapabilities })] as never,
    );

    const result = await listModels({ outputType: "image" });

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      modelId: "openai/gpt-5-image-mini",
      outputType: "image",
      imageCapabilities,
    });
  });
});

import { findActiveModel, listModels as listMerged } from "./service.js";

vi.mock("../../utils/prisma.js", () => ({
  prisma: {
    chatModel: { findMany: vi.fn(), findFirst: vi.fn() },
    reasoningEffort: { findMany: vi.fn() },
    providerModel: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

function makeProviderModelRow(overrides: Record<string, unknown> = {}) {
  return {
    slug: "openrouter/openai-gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    label: "GPT 5.6",
    hint: null,
    description: null,
    iconSvg: "",
    outputType: "text",
    contextWindowTokens: 1_000_000,
    maxInputTokens: null,
    maxOutputTokens: 128_000,
    reasoningEfforts: ["low", "high"],
    capabilities: null,
    imageCapabilities: null,
    sortOrder: 0,
    id: "pm_1",
    connectionId: "pc_1",
    connection: { slug: "openrouter", label: "My OpenRouter" },
    ...overrides,
  };
}

describe("listModels merging", () => {
  beforeEach(() => {
    vi.mocked(prisma.chatModel.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.reasoningEffort.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.providerModel.findMany).mockReset().mockResolvedValue([]);
  });

  it("does not query user models when no userId is given", async () => {
    await listMerged();
    expect(prisma.providerModel.findMany).not.toHaveBeenCalled();
  });

  it("tags catalog rows with source catalog and a null connectionId", async () => {
    vi.mocked(prisma.chatModel.findMany).mockResolvedValue([
      makeModelRow(),
    ] as never);

    const result = await listMerged({ userId: "u_1" });

    expect(result.models[0]).toMatchObject({
      source: "catalog",
      connectionId: null,
    });
  });

  it("tags user rows with source connection and scopes the query by userId", async () => {
    vi.mocked(prisma.providerModel.findMany).mockResolvedValue([
      makeProviderModelRow(),
    ] as never);

    const result = await listMerged({ userId: "u_1" });

    expect(prisma.providerModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u_1", isActive: true }),
      }),
    );
    expect(result.models[0]).toMatchObject({
      modelId: "openrouter/openai-gpt-5.6-luna",
      source: "connection",
      connectionId: "pc_1",
      provider: { slug: "openrouter", name: "My OpenRouter" },
      reasoningEfforts: ["low", "high"],
    });
  });

  it("applies the outputType filter to both scopes", async () => {
    await listMerged({ outputType: "image", userId: "u_1" });
    expect(prisma.chatModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ outputType: "image" }),
      }),
    );
    expect(prisma.providerModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ outputType: "image" }),
      }),
    );
  });
});

describe("findActiveModel scoping", () => {
  beforeEach(() => {
    vi.mocked(prisma.chatModel.findFirst).mockReset().mockResolvedValue(null);
    vi.mocked(prisma.providerModel.findFirst).mockReset().mockResolvedValue(null);
  });

  it("prefers the global catalog for an unqualified id", async () => {
    vi.mocked(prisma.chatModel.findFirst).mockResolvedValue(makeModelRow() as never);

    const result = await findActiveModel("openai/gpt-5.6-luna", "u_1");

    expect(result?.source).toBe("catalog");
  });

  it("finds a user model only inside the caller's scope", async () => {
    vi.mocked(prisma.providerModel.findFirst).mockResolvedValue(
      makeProviderModelRow() as never,
    );

    const result = await findActiveModel("openrouter/openai-gpt-5.6-luna", "u_1");

    expect(prisma.providerModel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u_1" }),
      }),
    );
    expect(result?.source).toBe("connection");
  });

  it("returns null when no scope owns the id", async () => {
    expect(await findActiveModel("nobody/owns-this", "u_1")).toBeNull();
  });
});
