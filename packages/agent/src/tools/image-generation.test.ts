import { describe, expect, it, vi } from "vitest";
import type { ToolApprovalContext, ToolApprovalRequirement } from "@anvia/core";
import type {
  GeneratedImage,
  ImageGenerationModel,
} from "@anvia/core/image-generation";
import {
  ASPECT_SIZES,
  aspectRatioToSize,
  buildImageGenerationInstruction,
  createImageGenerationTools,
  defaultImageProviderOptions,
  IMAGE_GENERATION_INSTRUCTION,
  resolveImageRequestParams,
  type GeneratedImageRecord,
  type GenerateImageResult,
  type ImageGenerationToolScope,
} from "./image-generation.js";

/**
 * The reduction the two gcd-derived native adapters perform
 * (`@anvia/grok` dist/index.js:190-201, `@anvia/gemini` dist/index.js:1391-1395):
 * `${w/gcd}:${h/gcd}`. Mirrored here so the table's agreement with the adapters
 * is asserted by computation rather than by eyeballing.
 */
function gcd(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function reduce(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/**
 * Ratios whose literal key is not a reduced integer fraction, so no integer
 * dimensions can reduce back to it. They stay in the table (the catalog
 * advertises them), and the per-kind allow-list refuses to let a native kind
 * declare them. The expectation is the adapter's derived string, recorded so
 * the set cannot grow silently.
 */
const UNREPRESENTABLE_RATIOS: Record<string, string> = {
  "21:9": "7:3",
  "9:19.5": "6:13",
  "19.5:9": "13:6",
};

/** `auto` is a sentinel, not a ratio; its dimensions only need to be square. */
const NON_RATIO_KEYS = new Set(["auto"]);

const DEFAULT_MODEL = "test-model";
const AUTHORITATIVE_CAPABILITY = {
  nMax: 4,
  aspectRatios: ["1:1", "16:9"],
  sizes: ["1024x1024", "1280x720"],
  quality: ["medium", "high"],
  background: ["opaque", "transparent"],
};

type ImageApproval = (
  args: { prompt: string; referenceImageId?: string },
  context: ToolApprovalContext<{
    prompt: string;
    referenceImageId?: string;
  }>,
) =>
  | boolean
  | ToolApprovalRequirement
  | Promise<boolean | ToolApprovalRequirement>;

function approvalContext<T extends { prompt: string }>(
  toolName: string,
  args: T,
): ToolApprovalContext<T> {
  return {
    toolName,
    args,
    rawArgs: JSON.stringify(args),
    toolCallId: "tool-call-1",
    internalCallId: "internal-call-1",
    run: { agentId: "agent-1", runId: "run-1", sessionId: "session-1" },
  };
}

function image(byte: number, mediaType = "image/png"): GeneratedImage {
  return { data: new Uint8Array([byte]), mediaType };
}

function response(...images: GeneratedImage[]) {
  const first = images[0]!;
  return {
    image: first.data,
    images,
    ...(first.mediaType ? { mediaType: first.mediaType } : {}),
    rawResponse: {},
  };
}

function record(
  id: string,
  mediaType = "image/png",
  prompt = "a red fox",
): GeneratedImageRecord {
  return {
    id,
    mediaType,
    width: 1024,
    height: 1024,
    modelId: DEFAULT_MODEL,
    prompt,
  };
}

function makeScope(
  overrides: Partial<ImageGenerationToolScope> = {},
): {
  scope: ImageGenerationToolScope;
  imageGeneration: ReturnType<typeof vi.fn>;
  saveGeneratedImage: ReturnType<typeof vi.fn>;
} {
  const imageGeneration = vi.fn();
  const saveGeneratedImage = vi.fn();
  const model =
    overrides.model ??
    ({
      imageGeneration,
      provider: "fixture",
      modelId: DEFAULT_MODEL,
    } as unknown as ImageGenerationModel<unknown>);
  const scope: ImageGenerationToolScope = {
    model,
    store: { saveGeneratedImage },
    enabled: true,
    hasGrant: () => false,
    takeToolOverride: () => null,
    userId: "user-1",
    sessionId: "session-1",
    projectId: "project-1",
    resolveReference: vi.fn(async () => null),
    capabilities: () => AUTHORITATIVE_CAPABILITY,
    defaultSettings: { modelId: DEFAULT_MODEL, aspectRatio: "1:1" },
    ...overrides,
  };
  const usedImageGeneration = (
    model as unknown as { imageGeneration: ReturnType<typeof vi.fn> }
  ).imageGeneration;
  return { scope, imageGeneration: usedImageGeneration, saveGeneratedImage };
}

describe("createImageGenerationTools", () => {
  it("returns generate_image and edit_image in order", () => {
    const { scope } = makeScope();
    const tools = createImageGenerationTools(scope);
    expect(tools.map((tool) => tool.name)).toEqual([
      "generate_image",
      "edit_image",
    ]);
  });

  describe("approval policy", () => {
    it("requires approval when generation is disabled and no grant exists", async () => {
      const { scope } = makeScope({ enabled: false });
      const tools = createImageGenerationTools(scope);
      const requiresApproval = tools[0]!.requiresApproval as ImageApproval;
      const args = { prompt: "a red fox" };
      expect(
        await requiresApproval(args, approvalContext("generate_image", args)),
      ).toEqual({
        reason: 'The agent wants to generate an image: "a red fox"',
      });
    });

    it("does not require approval when generation is enabled", async () => {
      const { scope } = makeScope({ enabled: true });
      const tools = createImageGenerationTools(scope);
      const requiresApproval = tools[0]!.requiresApproval as ImageApproval;
      const args = { prompt: "a red fox" };
      expect(
        await requiresApproval(args, approvalContext("generate_image", args)),
      ).toBe(false);
    });

    it("does not require approval when a grant exists for the tool", async () => {
      const { scope } = makeScope({
        enabled: false,
        hasGrant: (name) => name === "generate_image",
      });
      const tools = createImageGenerationTools(scope);
      const requiresApproval = tools[0]!.requiresApproval as ImageApproval;
      const args = { prompt: "a red fox" };
      expect(
        await requiresApproval(args, approvalContext("generate_image", args)),
      ).toBe(false);
    });

    it("requires approval for edit_image even when only generate_image is granted", async () => {
      const { scope } = makeScope({
        enabled: false,
        hasGrant: (name) => name === "generate_image",
      });
      const tools = createImageGenerationTools(scope);
      const requiresApproval = tools[1]!.requiresApproval as ImageApproval;
      const args = { prompt: "a red fox", referenceImageId: "img-1" };
      expect(
        await requiresApproval(args, approvalContext("edit_image", args)),
      ).toEqual({
        reason: 'The agent wants to generate an image: "a red fox"',
      });
    });

    it("fails safe to approval when hasGrant rejects", async () => {
      const { scope } = makeScope({
        enabled: false,
        hasGrant: () => Promise.reject(new Error("redis down")),
      });
      const tools = createImageGenerationTools(scope);
      const requiresApproval = tools[0]!.requiresApproval as ImageApproval;
      const args = { prompt: "a red fox" };
      expect(
        await requiresApproval(args, approvalContext("generate_image", args)),
      ).toEqual({
        reason: 'The agent wants to generate an image: "a red fox"',
      });
    });

    it("does not require approval when hasGrant resolves true", async () => {
      const { scope } = makeScope({
        enabled: false,
        hasGrant: async (name) => name === "generate_image",
      });
      const tools = createImageGenerationTools(scope);
      const requiresApproval = tools[0]!.requiresApproval as ImageApproval;
      const args = { prompt: "a red fox" };
      expect(
        await requiresApproval(args, approvalContext("generate_image", args)),
      ).toBe(false);
    });

    it("justifies approval with the prompt", async () => {
      const { scope } = makeScope({ enabled: false });
      const tools = createImageGenerationTools(scope);
      const requiresApproval = tools[0]!.requiresApproval as ImageApproval;
      const args = { prompt: "a red fox" };
      expect(
        await requiresApproval(args, approvalContext("generate_image", args)),
      ).toEqual({
        reason: 'The agent wants to generate an image: "a red fox"',
      });
    });

    it("does not consume an editable override while deciding approval", async () => {
      const takeToolOverride = vi.fn(() => ({ prompt: "approved edit" }));
      const { scope } = makeScope({
        enabled: false,
        takeToolOverride,
      });
      const tool = createImageGenerationTools(scope)[0]!;
      const requiresApproval = tool.requiresApproval as ImageApproval;
      const args = { prompt: "original prompt" };

      await requiresApproval(args, approvalContext("generate_image", args));

      expect(takeToolOverride).not.toHaveBeenCalled();
    });
  });

  describe("generate_image", () => {
    it("forwards and propagates cancellation through the v1 tool context", async () => {
      const controller = new AbortController();
      const abortError = new DOMException("The operation was aborted", "AbortError");
      const { scope, imageGeneration } = makeScope();
      imageGeneration.mockImplementation(
        async (_request: unknown, options: { abortSignal?: AbortSignal }) => {
          expect(options.abortSignal).toBe(controller.signal);
          controller.abort(abortError);
          throw abortError;
        },
      );
      const tool = createImageGenerationTools(scope)[0]!;

      await expect(
        tool.call(
          { prompt: "a red fox" },
          { abortSignal: controller.signal },
        ),
      ).rejects.toBe(abortError);
    });

    it("rejects a non-JSON generation record through its output schema", async () => {
      const { scope, imageGeneration, saveGeneratedImage } = makeScope();
      imageGeneration.mockResolvedValue(response(image(1)));
      saveGeneratedImage.mockResolvedValue({
        ...record("rec-1"),
        id: undefined,
      });
      const tool = createImageGenerationTools(scope)[0]!;

      await expect(tool.call({ prompt: "a red fox" })).rejects.toThrow();
    });

    it("applies a tool override over the args", async () => {
      const { scope, imageGeneration, saveGeneratedImage } = makeScope({
        takeToolOverride: () => ({ prompt: "override prompt" }),
      });
      imageGeneration.mockResolvedValue(response(image(1)));
      saveGeneratedImage.mockResolvedValue(record("rec-1", "image/png", "override prompt"));
      const tools = createImageGenerationTools(scope);

      await tools[0]!.call({ prompt: "original prompt" });

      expect(imageGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "override prompt" }),
        undefined,
      );
      expect(saveGeneratedImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "override prompt" }),
      );
    });

    it("sends the explicit session model when args do not override it", async () => {
      const { scope, imageGeneration } = makeScope();
      imageGeneration.mockResolvedValue(response(image(1)));
      const tools = createImageGenerationTools(scope);

      await tools[0]!.call({ prompt: "a red fox" });

      const request = imageGeneration.mock.calls[0]![0];
      expect(request.providerOptions).toEqual({
        model: DEFAULT_MODEL,
        size: "1024x1024",
      });
    });

    it("sends an explicit modelId arg to the wire request", async () => {
      const { scope, imageGeneration } = makeScope();
      imageGeneration.mockResolvedValue(response(image(1)));
      const tools = createImageGenerationTools(scope);

      await tools[0]!.call({ prompt: "a red fox", modelId: "explicit-model" });

      const request = imageGeneration.mock.calls[0]![0];
      expect(request.providerOptions).toEqual({
        model: "explicit-model",
        size: "1024x1024",
      });
    });

    it("keeps a background listed in the capability and forces png output", async () => {
      const { scope, imageGeneration } = makeScope();
      imageGeneration.mockResolvedValue(response(image(1)));
      const tools = createImageGenerationTools(scope);

      await tools[0]!.call({ prompt: "a red fox", background: "transparent" });

      const request = imageGeneration.mock.calls[0]![0];
      expect(request.providerOptions).toEqual({
        model: DEFAULT_MODEL,
        background: "transparent",
        output_format: "png",
        size: "1024x1024",
      });
    });

    it("saves and reports every image with nOfTotal and never leaks base64", async () => {
      const { scope, imageGeneration, saveGeneratedImage } = makeScope();
      imageGeneration.mockResolvedValue(
        response(image(1, "image/png"), image(2, "image/jpeg")),
      );
      saveGeneratedImage
        .mockResolvedValueOnce(record("rec-1", "image/png"))
        .mockResolvedValueOnce(record("rec-2", "image/jpeg"));
      const tools = createImageGenerationTools(scope);

      const output = (await tools[0]!.call({
        prompt: "a red fox",
      })) as GenerateImageResult;

      expect(saveGeneratedImage).toHaveBeenCalledTimes(2);
      expect(saveGeneratedImage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ nOfTotal: "1 of 2" }),
      );
      expect(saveGeneratedImage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ nOfTotal: "2 of 2" }),
      );
      expect(output.images).toHaveLength(2);
      expect(output.images[0]).toEqual({
        imageId: "rec-1",
        mediaType: "image/png",
        width: 1024,
        height: 1024,
        modelId: DEFAULT_MODEL,
        prompt: "a red fox",
        index: 0,
        total: 2,
      });
      expect(output.images[1]).toEqual({
        imageId: "rec-2",
        mediaType: "image/jpeg",
        width: 1024,
        height: 1024,
        modelId: DEFAULT_MODEL,
        prompt: "a red fox",
        index: 1,
        total: 2,
      });
      expect(JSON.stringify(output)).not.toContain("base64");
      expect(output.error).toBeUndefined();
      expect(output.errors).toBeUndefined();
    });

    it("omits nOfTotal when only one image is generated", async () => {
      const { scope, imageGeneration, saveGeneratedImage } = makeScope();
      imageGeneration.mockResolvedValue(response(image(1)));
      saveGeneratedImage.mockResolvedValue(record("rec-1"));
      const tools = createImageGenerationTools(scope);

      await tools[0]!.call({ prompt: "a red fox" });

      expect(saveGeneratedImage).toHaveBeenCalledWith(
        expect.not.objectContaining({ nOfTotal: expect.anything() }),
      );
    });

    it("returns partial results with errors when saving an image fails", async () => {
      const { scope, imageGeneration, saveGeneratedImage } = makeScope();
      imageGeneration.mockResolvedValue(response(image(1), image(2)));
      saveGeneratedImage
        .mockResolvedValueOnce(record("rec-1"))
        .mockRejectedValueOnce(new Error("storage down"));
      const tools = createImageGenerationTools(scope);

      const output = (await tools[0]!.call({
        prompt: "a red fox",
      })) as GenerateImageResult;

      expect(output.images).toHaveLength(1);
      expect(output.images[0]!.imageId).toBe("rec-1");
      expect(output.errors).toEqual(["storage down"]);
    });

    it("returns a bounded error when the model call fails", async () => {
      const { scope, imageGeneration } = makeScope();
      imageGeneration.mockRejectedValue(
        new Error("Image generation rate limit exceeded; try again later"),
      );
      const tools = createImageGenerationTools(scope);

      const output = (await tools[0]!.call({
        prompt: "a red fox",
      })) as GenerateImageResult;

      expect(output.images).toEqual([]);
      expect(output.error).toBe(
        "Image generation rate limit exceeded; try again later",
      );
    });

    it("uses default settings when args omit them", async () => {
      const { scope, imageGeneration, saveGeneratedImage } = makeScope({
        defaultSettings: { modelId: "default-model", aspectRatio: "16:9" },
      });
      imageGeneration.mockResolvedValue(response(image(1)));
      saveGeneratedImage.mockResolvedValue(record("rec-1"));
      const tools = createImageGenerationTools(scope);

      await tools[0]!.call({ prompt: "a red fox" });

      const request = imageGeneration.mock.calls[0]![0];
      expect(reduce(request.width, request.height)).toBe("16:9");
      expect(request.providerOptions).toEqual({
        model: "default-model",
        size: `${request.width}x${request.height}`,
      });
      expect(saveGeneratedImage).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "default-model" }),
      );
    });

  });

  describe("edit_image", () => {
    it("passes the reference image as an input_references data URL", async () => {
      const { scope, imageGeneration, saveGeneratedImage } = makeScope({
        resolveReference: async () => ({
          mediaType: "image/png",
          buffer: new Uint8Array([1, 2, 3]),
        }),
      });
      imageGeneration.mockResolvedValue(response(image(9)));
      saveGeneratedImage.mockResolvedValue(record("rec-1"));
      const tools = createImageGenerationTools(scope);

      await tools[1]!.call({ prompt: "make it red", referenceImageId: "img-1" });

      const request = imageGeneration.mock.calls[0]![0];
      expect(request.providerOptions).toEqual({
        model: DEFAULT_MODEL,
        input_references: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AQID" },
          },
        ],
        size: "1024x1024",
      });
      expect(saveGeneratedImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "make it red" }),
      );
    });

    it("returns an error when the reference image is missing", async () => {
      const { scope, imageGeneration } = makeScope({
        resolveReference: async () => null,
      });
      const tools = createImageGenerationTools(scope);

      const output = (await tools[1]!.call({
        prompt: "make it red",
        referenceImageId: "missing",
      })) as GenerateImageResult;

      expect(output.images).toEqual([]);
      expect(output.error).toBe("Reference image not found");
      expect(imageGeneration).not.toHaveBeenCalled();
    });

    it("returns an error when the reference image exceeds maxBytes", async () => {
      const { scope, imageGeneration } = makeScope({
        maxBytes: 2,
        resolveReference: async () => ({
          mediaType: "image/png",
          buffer: new Uint8Array([1, 2, 3]),
        }),
      });
      const tools = createImageGenerationTools(scope);

      const output = (await tools[1]!.call({
        prompt: "make it red",
        referenceImageId: "img-1",
      })) as GenerateImageResult;

      expect(output.images).toEqual([]);
      expect(output.error).toBe("Reference image too large");
      expect(imageGeneration).not.toHaveBeenCalled();
    });

    it("applies a tool override for edits", async () => {
      const { scope, imageGeneration } = makeScope({
        takeToolOverride: () => ({ prompt: "override edit" }),
        resolveReference: async () => ({
          mediaType: "image/png",
          buffer: new Uint8Array([1]),
        }),
      });
      imageGeneration.mockResolvedValue(response(image(9)));
      const tools = createImageGenerationTools(scope);

      await tools[1]!.call({
        prompt: "original edit",
        referenceImageId: "img-1",
      });

      expect(imageGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "override edit" }),
        undefined,
      );
    });

    it("rejects an n override because the edit schema has no n", async () => {
      const { scope, imageGeneration } = makeScope({
        takeToolOverride: () => ({ n: 3 }),
        resolveReference: async () => ({
          mediaType: "image/png",
          buffer: new Uint8Array([1]),
        }),
      });
      imageGeneration.mockResolvedValue(response(image(9)));
      const tools = createImageGenerationTools(scope);

      const output = await tools[1]!.call({
        prompt: "make it red",
        referenceImageId: "img-1",
      });

      expect(output).toEqual({
        images: [],
        error: "Image generation settings are invalid",
      });
      expect(imageGeneration).not.toHaveBeenCalled();
    });
  });
});

describe("aspectRatioToSize", () => {
  it("returns the mapped dimensions for known ratios", () => {
    expect(aspectRatioToSize("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(reduce(aspectRatioToSize("16:9").width, aspectRatioToSize("16:9").height)).toBe("16:9");
    expect(reduce(aspectRatioToSize("9:16").width, aspectRatioToSize("9:16").height)).toBe("9:16");
    expect(aspectRatioToSize("auto")).toEqual({ width: 1024, height: 1024 });
  });

  it("fails closed for unknown or missing ratios", () => {
    expect(() => aspectRatioToSize("2:1")).toThrow(
      "Image aspect ratio is not supported",
    );
    expect(() => aspectRatioToSize(undefined)).toThrow(
      "Image aspect ratio is required",
    );
  });
});

describe("resolveImageRequestParams", () => {
  it("picks the exact accepted size for OpenAI-style models", () => {
    const capability = {
      nMax: 1,
      aspectRatios: ["1:1", "3:2", "2:3"],
      sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    };
    expect(resolveImageRequestParams("1:1", capability)).toEqual({
      size: "1024x1024",
    });
    expect(resolveImageRequestParams("3:2", capability)).toEqual({
      size: "1536x1024",
    });
    expect(resolveImageRequestParams("2:3", capability)).toEqual({
      size: "1024x1536",
    });
  });

  it("fails when the ratio has no accepted pixel size", () => {
    const capability = {
      nMax: 1,
      aspectRatios: ["16:9"],
      sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    };
    expect(() => resolveImageRequestParams("16:9", capability)).toThrow(
      "Image model does not support the requested aspect ratio",
    );
  });

  it("uses aspect_ratio + resolution for Gemini/Grok-style models (no size)", () => {
    const capability = { nMax: 1, resolutions: ["1K"] };
    Object.assign(capability, { aspectRatios: ["9:16"] });
    expect(resolveImageRequestParams("9:16", capability)).toEqual({
      aspectRatio: "9:16",
      resolution: "1K",
    });
  });

  it("fails closed when capabilities are unknown or aspect ratio is missing", () => {
    expect(() => resolveImageRequestParams("16:9", null)).toThrow(
      "Image model capabilities are unavailable",
    );
    expect(() =>
      resolveImageRequestParams(undefined, {
        nMax: 1,
        aspectRatios: ["auto"],
        sizes: ["auto"],
      }),
    ).toThrow("Image aspect ratio is required");
  });

  it("never emits an unsupported size for declared model ratios", () => {
    const openai = { nMax: 1, aspectRatios: ["1:1", "3:2", "2:3", "auto"], sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"] };
    const gemini = { nMax: 1, aspectRatios: ["1:1"], resolutions: ["1K"] };
    for (const ratio of openai.aspectRatios) {
      const o = resolveImageRequestParams(ratio, openai);
      if (o.size) {
        expect(openai.sizes).toContain(o.size);
      } else {
        expect(o.aspectRatio).toBe(ratio);
        expect(o.resolution).toBe("1K");
        expect(o.size).toBeUndefined();
      }
    }
    const g = resolveImageRequestParams("1:1", gemini);
    expect(g.size).toBeUndefined();
    expect(g.aspectRatio).toBe("1:1");
  });
});

describe("ASPECT_SIZES agreement with the gcd-derived native adapters", () => {
  it("reduces every representable entry to its own key", () => {
    for (const [key, { width, height }] of Object.entries(ASPECT_SIZES)) {
      if (NON_RATIO_KEYS.has(key)) continue;
      if (key in UNREPRESENTABLE_RATIOS) continue;
      expect(reduce(width, height)).toBe(key);
    }
  });

  it("leaves a sentinel entry square", () => {
    for (const key of NON_RATIO_KEYS) {
      const dimensions = ASPECT_SIZES[key]!;
      expect(dimensions.width).toBe(dimensions.height);
    }
  });

  it("records the exact reduction for the ratios that cannot be represented", () => {
    // 21:9 and the 19.5:9 pair are not reduced integer fractions, so no
    // dimensions can reach the adapters as their literal key. Asserting the
    // derived string keeps the documented set honest — a new unrepresentable
    // entry fails here until it is added with its real reduction.
    expect(Object.keys(UNREPRESENTABLE_RATIOS).sort()).toEqual(
      Object.keys(ASPECT_SIZES)
        .filter((key) => !NON_RATIO_KEYS.has(key))
        .filter((key) => reduce(ASPECT_SIZES[key]!.width, ASPECT_SIZES[key]!.height) !== key)
        .sort(),
    );
    for (const [key, expected] of Object.entries(UNREPRESENTABLE_RATIOS)) {
      const { width, height } = ASPECT_SIZES[key]!;
      expect(reduce(width, height)).toBe(expected);
    }
  });

  it("keeps 16:9 and 9:16 reachable as their own ratio", () => {
    // The defect this fix removes: 1344x768 has gcd 192 and reduced to 7:4, so
    // Grok collapsed a 16:9 request to "auto" and Gemini sent "7:4".
    expect(reduce(ASPECT_SIZES["16:9"]!.width, ASPECT_SIZES["16:9"]!.height)).toBe(
      "16:9",
    );
    expect(reduce(ASPECT_SIZES["9:16"]!.width, ASPECT_SIZES["9:16"]!.height)).toBe(
      "9:16",
    );
  });
});

describe("imageProviderOptions injection", () => {
  it("defaults to the OpenRouter-shaped object the tool has always sent", () => {
    expect(
      defaultImageProviderOptions({
        size: "1024x1024",
        aspectRatio: "16:9",
        resolution: "1K",
        quality: "high",
        background: "transparent",
        n: 2,
      }),
    ).toEqual({
      size: "1024x1024",
      aspect_ratio: "16:9",
      resolution: "1K",
      quality: "high",
      background: "transparent",
      output_format: "png",
      n: 2,
    });
  });

  it("omits absent keys rather than emitting undefined", () => {
    expect(defaultImageProviderOptions({})).toEqual({});
  });

  it("replaces the adapter-shaped keys while keeping model and extraParams", async () => {
    const { scope, imageGeneration, saveGeneratedImage } = makeScope({
      // A native-shaped capability, where the tool computes aspect_ratio +
      // resolution instead of a pixel size.
      capabilities: () => ({
        nMax: 4,
        aspectRatios: ["1:1"],
        resolutions: ["1K"],
        quality: ["high"],
        background: ["transparent"],
      }),
      imageProviderOptions: (params) => {
        expect(params).toEqual({
          aspectRatio: "1:1",
          resolution: "1K",
          quality: "high",
          background: "transparent",
          n: 2,
        });
        return {};
      },
    });
    imageGeneration.mockResolvedValue(response(image(1)));
    saveGeneratedImage.mockResolvedValue(record("rec-1"));
    const tools = createImageGenerationTools(scope);

    await tools[0]!.call({
      prompt: "a red fox",
      quality: "high",
      background: "transparent",
      n: 2,
    });

    const request = imageGeneration.mock.calls[0]![0];
    // `model` is the tool's, not the builder's: it survives for every adapter.
    expect(request.providerOptions).toEqual({ model: DEFAULT_MODEL });
  });

  it("keeps input_references when a builder is injected for edits", async () => {
    const { scope, imageGeneration, saveGeneratedImage } = makeScope({
      imageProviderOptions: () => ({}),
      resolveReference: async () => ({
        mediaType: "image/png",
        buffer: new Uint8Array([1, 2, 3]),
      }),
    });
    imageGeneration.mockResolvedValue(response(image(9)));
    saveGeneratedImage.mockResolvedValue(record("rec-1"));
    const tools = createImageGenerationTools(scope);

    await tools[1]!.call({ prompt: "make it red", referenceImageId: "img-1" });

    const request = imageGeneration.mock.calls[0]![0];
    expect(request.providerOptions).toEqual({
      model: DEFAULT_MODEL,
      input_references: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      ],
    });
  });

  it("reaches the adapter with dimensions whose reduction is 16:9", async () => {
    const { scope, imageGeneration } = makeScope({
      defaultSettings: { modelId: DEFAULT_MODEL, aspectRatio: "16:9" },
      capabilities: () => ({
        nMax: 1,
        aspectRatios: ["1:1", "16:9"],
        resolutions: ["1K"],
      }),
      imageProviderOptions: defaultImageProviderOptions,
    });
    imageGeneration.mockResolvedValue(response(image(1)));
    const tools = createImageGenerationTools(scope);

    await tools[0]!.call({ prompt: "a red fox" });

    const request = imageGeneration.mock.calls[0]![0];
    // Assert the reduction, not the raw numbers, so a future re-sizing of the
    // table does not break the agreement this test exists to protect.
    expect(reduce(request.width, request.height)).toBe("16:9");
  });

  it("sends no aspect_ratio on the Grok path, whose adapter derives and overwrites it", async () => {
    // The Grok adapter spreads providerOptions first and then writes its own
    // `aspect_ratio` (dist/index.js:144-153), so a key here could never reach
    // the wire. Assert the absence so nobody re-adds one.
    const { scope, imageGeneration } = makeScope({
      defaultSettings: { modelId: DEFAULT_MODEL, aspectRatio: "16:9" },
      capabilities: () => ({
        nMax: 1,
        aspectRatios: ["1:1", "16:9"],
        resolutions: ["1K"],
      }),
      imageProviderOptions: () => ({}),
    });
    imageGeneration.mockResolvedValue(response(image(1)));
    const tools = createImageGenerationTools(scope);

    await tools[0]!.call({ prompt: "a red fox" });

    const request = imageGeneration.mock.calls[0]![0];
    expect("aspect_ratio" in request.providerOptions).toBe(false);
    expect(reduce(request.width, request.height)).toBe("16:9");
  });
});

describe("image capability fail-closed policy", () => {
  it("does not call the provider when the model id is missing", async () => {
    const { scope, imageGeneration } = makeScope({
      defaultSettings: { aspectRatio: "1:1" },
      capabilities: () => AUTHORITATIVE_CAPABILITY,
    });
    const output = (await createImageGenerationTools(scope)[0]!.call({
      prompt: "a red fox",
    })) as GenerateImageResult;
    expect(output).toEqual({
      images: [],
      error: "Image model is not configured",
    });
    expect(imageGeneration).not.toHaveBeenCalled();
  });

  it("does not call the provider for an unknown model capability", async () => {
    const { scope, imageGeneration } = makeScope({
      defaultSettings: { modelId: "unknown-model", aspectRatio: "1:1" },
      capabilities: () => null,
    });
    const output = (await createImageGenerationTools(scope)[0]!.call({
      prompt: "a red fox",
    })) as GenerateImageResult;
    expect(output).toEqual({
      images: [],
      error: "Image model capabilities are unavailable",
    });
    expect(imageGeneration).not.toHaveBeenCalled();
  });

  it.each([
    ["aspect ratio", { aspectRatio: "2:1" }, "Image aspect ratio is not supported"],
    ["quality", { quality: "low" }, "Image quality is not supported"],
    ["background", { background: "green-screen" }, "Image background is not supported"],
    ["count", { n: 5 }, "Image count exceeds model capability"],
  ])("rejects an unsupported %s without calling the provider", async (_label, args, error) => {
    const { scope, imageGeneration } = makeScope({
      defaultSettings: { modelId: DEFAULT_MODEL, aspectRatio: "1:1" },
      capabilities: () => AUTHORITATIVE_CAPABILITY,
    });
    const output = (await createImageGenerationTools(scope)[0]!.call({
      prompt: "a red fox",
      ...args,
    })) as GenerateImageResult;
    expect(output).toEqual({ images: [], error });
    expect(imageGeneration).not.toHaveBeenCalled();
  });

  it("fails visibly when the approval override registry cannot be read", async () => {
    const { scope, imageGeneration } = makeScope({
      defaultSettings: { modelId: DEFAULT_MODEL, aspectRatio: "1:1" },
      capabilities: () => AUTHORITATIVE_CAPABILITY,
      takeToolOverride: () => Promise.reject(new Error("redis down")),
    });
    const output = (await createImageGenerationTools(scope)[0]!.call({
      prompt: "a red fox",
    })) as GenerateImageResult;
    expect(output).toEqual({
      images: [],
      error: "Image generation settings are unavailable",
    });
    expect(imageGeneration).not.toHaveBeenCalled();
  });
});

describe("IMAGE_GENERATION_INSTRUCTION", () => {
  it("guides web-first research, session defaults, clarification, ids, and approval", () => {
    expect(IMAGE_GENERATION_INSTRUCTION).toContain("web_search");
    expect(IMAGE_GENERATION_INSTRUCTION).toContain("session defaults");
    expect(IMAGE_GENERATION_INSTRUCTION).toContain("request_clarification");
    expect(IMAGE_GENERATION_INSTRUCTION).toContain("image ids");
    expect(IMAGE_GENERATION_INSTRUCTION).toContain("approval");
  });
});

describe("buildImageGenerationInstruction", () => {
  it("keeps the web_search-first sentence when web search is available", () => {
    const instruction = buildImageGenerationInstruction({
      webSearchAvailable: true,
    });
    expect(instruction).toContain("web_search first");
    expect(instruction).toContain("session defaults");
    expect(instruction).toContain("request_clarification");
    expect(instruction).toContain("image ids");
    expect(instruction).toContain("approval");
  });

  it("omits the web_search-first sentence when web search is unavailable", () => {
    const instruction = buildImageGenerationInstruction({
      webSearchAvailable: false,
    });
    expect(instruction).not.toContain("web_search");
    expect(instruction).toContain("session defaults");
    expect(instruction).toContain("request_clarification");
    expect(instruction).toContain("image ids");
    expect(instruction).toContain("approval");
  });
});
