import { describe, expect, it, vi } from "vitest";
import { MAX_MODEL_IMAGES } from "@anreal/agent";
import {
  ProviderInputError,
  createConnection,
  createConnectionModel,
  deleteConnection,
  deleteConnectionModel,
  discoverConnectionModels,
  listConnections,
  listConnectionModels,
  prefillConnectionModel,
  setConnectionEnabled,
  testProviderConnection,
  toPublicConnection,
  toPublicModel,
  updateConnection,
  updateConnectionModel,
  validateConnectionInput,
  validateModelInput,
} from "./service.js";
import {
  decodeProviderCredentials,
  encodeProviderCredentials,
} from "./credentials.js";
import { SLUG_MAX } from "../../lib/provider-slug.js";

const OK_CONNECTION = {
  kind: "compatible",
  label: "My OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-test-key-value",
};

describe("validateConnectionInput", () => {
  it("accepts a valid compatible connection and derives its slug", () => {
    const value = validateConnectionInput(OK_CONNECTION, [], 0);
    expect(value.slug).toBe("my-openrouter");
    expect(value.kind).toBe("compatible");
    expect(value.api).toBe("chat");
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      validateConnectionInput({ ...OK_CONNECTION, kind: "not-a-provider" }, [], 0),
    ).toThrow(ProviderInputError);
  });

  it("requires a base url for the compatible kind", () => {
    expect(() =>
      validateConnectionInput({ ...OK_CONNECTION, baseUrl: null }, [], 0),
    ).toThrow(/base url/i);
  });

  it("rejects a non-https base url unless it is localhost", () => {
    expect(() =>
      validateConnectionInput(
        { ...OK_CONNECTION, baseUrl: "http://evil.example/v1" },
        [],
        0,
      ),
    ).toThrow(/https/i);
    expect(() =>
      validateConnectionInput(
        { ...OK_CONNECTION, baseUrl: "http://localhost:1234/v1" },
        [],
        0,
      ),
    ).not.toThrow();
  });

  it("rejects an authorization header", () => {
    expect(() =>
      validateConnectionInput(
        { ...OK_CONNECTION, headers: { authorization: "Bearer x" } },
        [],
        0,
      ),
    ).toThrow(/authorization/i);
  });

  it("rejects an api option the kind does not support", () => {
    expect(() =>
      validateConnectionInput(
        { ...OK_CONNECTION, kind: "anthropic", baseUrl: null, api: "responses" },
        [],
        0,
      ),
    ).toThrow(/api/i);
  });

  it("rejects a reserved connection slug", () => {
    expect(() =>
      validateConnectionInput({ ...OK_CONNECTION, slug: "openai" }, [], 0),
    ).toThrow(/reserved/i);
  });

  it("suffixes a duplicate slug within the user scope", () => {
    const value = validateConnectionInput(OK_CONNECTION, ["my-openrouter"], 1);
    expect(value.slug).toBe("my-openrouter-2");
  });

  it("rejects an invalid slug shape", () => {
    expect(() =>
      validateConnectionInput({ ...OK_CONNECTION, slug: "Bad Slug!" }, [], 0),
    ).toThrow(ProviderInputError);
  });

  it("rejects a provided slug longer than SLUG_MAX", () => {
    expect(() =>
      validateConnectionInput(
        { ...OK_CONNECTION, slug: "a".repeat(SLUG_MAX + 1) },
        [],
        0,
      ),
    ).toThrow(new RegExp(`at most ${SLUG_MAX}`));
  });

  it("accepts a provided slug exactly SLUG_MAX long", () => {
    const slug = "a".repeat(SLUG_MAX);
    const value = validateConnectionInput({ ...OK_CONNECTION, slug }, [], 0);
    expect(value.slug).toBe(slug);
  });

  it("enforces the connection cap", () => {
    expect(() => validateConnectionInput(OK_CONNECTION, [], 10)).toThrow(
      /at most 10/i,
    );
  });

  it("requires a non-empty api key", () => {
    expect(() =>
      validateConnectionInput({ ...OK_CONNECTION, apiKey: "   " }, [], 0),
    ).toThrow(/api key/i);
  });
});

describe("validateModelInput", () => {
  const meta = { imageStyle: "openrouter-images" as const };

  it("accepts a text model and keeps the caller's reasoning efforts", () => {
    const value = validateModelInput(
      { upstreamId: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna", reasoningEfforts: ["low", "high"] },
      meta,
    );
    expect(value.upstreamId).toBe("openai/gpt-5.6-luna");
    expect(value.reasoningEfforts).toEqual(["low", "high"]);
    expect(value.outputType).toBe("text");
  });

  it("rejects an empty upstream id", () => {
    expect(() => validateModelInput({ upstreamId: "  " }, meta)).toThrow(
      /model id/i,
    );
  });

  it("rejects an effort outside the adapter vocabulary", () => {
    expect(() =>
      validateModelInput(
        { upstreamId: "x", reasoningEfforts: ["enormous"] },
        meta,
      ),
    ).toThrow(/effort/i);
  });

  it("deduplicates and orders efforts", () => {
    const value = validateModelInput(
      { upstreamId: "x", reasoningEfforts: ["high", "low", "high"] },
      meta,
    );
    expect(value.reasoningEfforts).toEqual(["low", "high"]);
  });

  it("rejects an image model when the kind has no image endpoint", () => {
    expect(() =>
      validateModelInput({ upstreamId: "x", outputType: "image" }, { imageStyle: "none" }),
    ).toThrow(/image/i);
  });

  it("accepts an image model when the kind has an image endpoint", () => {
    const value = validateModelInput(
      { upstreamId: "google/gemini-3.1-flash-lite-image", outputType: "image" },
      meta,
    );
    expect(value.outputType).toBe("image");
    expect(value.reasoningEfforts).toEqual([]);
  });

  it("rejects imageCapabilities on a text model, naming the field", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "openai/gpt-5.6-luna",
          imageCapabilities: {
            n: { min: 1, max: 1 },
            aspectRatios: ["1:1"],
            resolutions: ["1K"],
          },
        },
        meta,
      ),
    ).toThrow(/imageCapabilities/i);
  });

  it("accepts imageCapabilities on an image model and persists the parsed set", () => {
    const value = validateModelInput(
      {
        upstreamId: "openai/gpt-5-image-mini",
        outputType: "image",
        imageCapabilities: {
          n: { min: 1, max: 10 },
          sizes: ["1024x1024", "auto"],
          aspectRatios: ["1:1", "auto"],
          quality: ["auto", "high"],
          background: ["transparent"],
        },
      },
      meta,
    );
    expect(value.imageCapabilities).toEqual({
      nMax: 10,
      sizes: ["1024x1024", "auto"],
      aspectRatios: ["1:1", "auto"],
      quality: ["auto", "high"],
      background: ["transparent"],
    });
  });

  it("rejects an openrouter-images set whose n.max exceeds the tool's execution cap", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "openai/gpt-5-image-mini",
          outputType: "image",
          // The tool refuses any capability with nMax > MAX_MODEL_IMAGES, so a
          // declaration above the cap would save cleanly and then make the
          // model unusable at generation time.
          imageCapabilities: {
            n: { min: 1, max: MAX_MODEL_IMAGES + 1 },
            sizes: ["1024x1024", "auto"],
            aspectRatios: ["1:1", "auto"],
          },
        },
        { imageStyle: "openrouter-images" },
      ),
    ).toThrow(new RegExp(`at most ${MAX_MODEL_IMAGES}`));
  });

  it("accepts an openrouter-images set exactly at the tool's execution cap", () => {
    const value = validateModelInput(
      {
        upstreamId: "openai/gpt-5-image-mini",
        outputType: "image",
        imageCapabilities: {
          n: { min: 1, max: MAX_MODEL_IMAGES },
          sizes: ["1024x1024", "auto"],
          aspectRatios: ["1:1", "auto"],
        },
      },
      { imageStyle: "openrouter-images" },
    );
    expect(value.imageCapabilities).toMatchObject({ nMax: MAX_MODEL_IMAGES });
  });

  it("treats absent imageCapabilities on an image model as null", () => {
    const value = validateModelInput(
      { upstreamId: "openai/gpt-5-image-mini", outputType: "image" },
      meta,
    );
    expect(value.imageCapabilities).toBeNull();
  });

  it("still rejects an image model on a kind with no image endpoint, with the existing message", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "x",
          outputType: "image",
          imageCapabilities: { n: { min: 1, max: 1 }, aspectRatios: ["1:1"] },
        },
        { imageStyle: "none" },
      ),
    ).toThrow(/no image endpoint/i);
  });

  it("rejects a capability set the openrouter-images kind cannot honour", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "openai/gpt-5-image-mini",
          outputType: "image",
          // resolutions is the Gemini/Grok shape; the OpenRouter adapter sends
          // `size` and never emits `resolution`.
          imageCapabilities: { n: { min: 1, max: 1 }, aspectRatios: ["1:1"], resolutions: ["1K"] },
        },
        { imageStyle: "openrouter-images" },
      ),
    ).toThrow(/imageCapabilities/);
  });

  it("rejects a sizing control the gemini-native kind cannot honour", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "gemini-3.1-flash-image",
          outputType: "image",
          // `sizes` is the OpenAI-style shape; Gemini uses aspect_ratio +
          // resolution and never sends a pixel size.
          imageCapabilities: { n: { min: 1, max: 1 }, aspectRatios: ["1:1"], sizes: ["1024x1024"] },
        },
        { imageStyle: "gemini-native" },
      ),
    ).toThrow(/imageCapabilities/);
  });

  it("rejects a quality control the gemini-native kind cannot honour", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "gemini-3.1-flash-image",
          outputType: "image",
          imageCapabilities: {
            n: { min: 1, max: 1 },
            aspectRatios: ["1:1"],
            resolutions: ["1K"],
            quality: ["high"],
          },
        },
        { imageStyle: "gemini-native" },
      ),
    ).toThrow(/imageCapabilities/);
  });

  it("rejects n.max greater than 1 for the gemini-native kind", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "gemini-3.1-flash-image",
          outputType: "image",
          imageCapabilities: { n: { min: 1, max: 4 }, aspectRatios: ["1:1"], resolutions: ["1K"] },
        },
        { imageStyle: "gemini-native" },
      ),
    ).toThrow(/imageCapabilities/);
  });

  it("accepts a resolutions-shaped capability set for gemini-native", () => {
    const value = validateModelInput(
      {
        upstreamId: "gemini-3.1-flash-image",
        outputType: "image",
        imageCapabilities: {
          n: { min: 1, max: 1 },
          aspectRatios: ["1:1", "16:9"],
          resolutions: ["1K"],
        },
      },
      { imageStyle: "gemini-native" },
    );
    expect(value.imageCapabilities).toEqual({
      nMax: 1,
      aspectRatios: ["1:1", "16:9"],
      resolutions: ["1K"],
    });
  });

  it.each([
    ["21:9", "7:3"],
    ["9:19.5", "6:13"],
    ["19.5:9", "13:6"],
  ])(
    "rejects the unreachable ratio %s for a gcd-derived native kind",
    (ratio) => {
      // These are not reduced integer fractions, so no width/height can reach
      // the adapter as this string: Grok collapses it to "auto" and Gemini sends
      // the reduction, which its API rejects. Declaring one would advertise a
      // ratio the kind cannot honour, so the save path refuses it.
      for (const imageStyle of ["gemini-native", "grok-native"] as const) {
        expect(() =>
          validateModelInput(
            {
              upstreamId: "x",
              outputType: "image",
              imageCapabilities: {
                n: { min: 1, max: 1 },
                aspectRatios: ["1:1", ratio],
                resolutions: ["1K"],
              },
            },
            { imageStyle },
          ),
        ).toThrow(/aspectRatios are not reachable/i);
      }
    },
  );

  it("rejects the auto sentinel for a native kind but accepts it for openrouter", () => {
    // `auto` is not a ratio a native adapter can be asked for; it reduces to
    // 1:1. The OpenRouter-shaped kind forwards it to the provider as-is.
    expect(() =>
      validateModelInput(
        {
          upstreamId: "gemini-3.1-flash-image",
          outputType: "image",
          imageCapabilities: {
            n: { min: 1, max: 1 },
            aspectRatios: ["1:1", "auto"],
            resolutions: ["1K"],
          },
        },
        { imageStyle: "gemini-native" },
      ),
    ).toThrow(/aspectRatios are not reachable/i);

    const value = validateModelInput(
      {
        upstreamId: "openai/gpt-5-image-mini",
        outputType: "image",
        imageCapabilities: {
          n: { min: 1, max: 4 },
          aspectRatios: ["1:1", "auto"],
          sizes: ["1024x1024", "auto"],
        },
      },
      { imageStyle: "openrouter-images" },
    );
    expect(value.imageCapabilities?.aspectRatios).toEqual(["1:1", "auto"]);
  });

  it("rejects an unknown ratio string for a native kind", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "grok-imagine-image",
          outputType: "image",
          imageCapabilities: {
            n: { min: 1, max: 1 },
            aspectRatios: ["1:1", "5:7"],
            resolutions: ["1K"],
          },
        },
        { imageStyle: "grok-native" },
      ),
    ).toThrow(/aspectRatios are not reachable/i);
  });

  it("rejects a quality control the grok-native kind cannot honour", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "grok-imagine-image",
          outputType: "image",
          imageCapabilities: {
            n: { min: 1, max: 1 },
            aspectRatios: ["1:1"],
            resolutions: ["1K"],
            quality: ["high"],
          },
        },
        { imageStyle: "grok-native" },
      ),
    ).toThrow(/imageCapabilities/);
  });

  it("rejects n.max greater than 1 for the grok-native kind", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "grok-imagine-image",
          outputType: "image",
          imageCapabilities: { n: { min: 1, max: 2 }, aspectRatios: ["1:1"], resolutions: ["1K"] },
        },
        { imageStyle: "grok-native" },
      ),
    ).toThrow(/imageCapabilities/);
  });

  it("rejects an invalid imageCapabilities payload as a field-level error, not a 500", () => {
    for (const bad of [
      "not-an-object",
      [1, 2, 3],
      { n: { min: 1 }, aspectRatios: ["1:1"], resolutions: ["1K"] },
    ]) {
      expect(() =>
        validateModelInput(
          { upstreamId: "x", outputType: "image", imageCapabilities: bad },
          meta,
        ),
      ).toThrow(ProviderInputError);
    }
  });

  it("rejects a context window that cannot hold its own budgets", () => {
    expect(() =>
      validateModelInput(
        {
          upstreamId: "x",
          contextWindowTokens: 1_000,
          maxInputTokens: 900,
          maxOutputTokens: 900,
        },
        meta,
      ),
    ).toThrow(/context/i);
  });
});

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    chatModel: {
      findFirst: vi.fn(async () => null),
    },
    providerConnection: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pc_1",
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pc_1",
        ...data,
      })),
      delete: vi.fn(async () => ({})),
    },
    providerModel: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    ...overrides,
  } as never;
}

function makeConnectionDb(credentialsRef: string) {
  return makeDb({
    providerConnection: {
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => ({
        id: "pc_1",
        userId: "u_1",
        kind: "compatible",
        label: "GW",
        slug: "gw",
        baseUrl: "https://gw.example/v1",
        api: "chat",
        credentialsRef,
        isActive: true,
        sortOrder: 0,
      })),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pc_1",
        ...data,
      })),
    },
  });
}

/** The credential envelope a put through `updateConnection` would persist. */
function updatedCredentialsRef(db: unknown): string {
  const update = (
    db as { providerConnection: { update: ReturnType<typeof vi.fn> } }
  ).providerConnection.update;
  const call = update.mock.calls[0]?.[0] as {
    data: { credentialsRef: string };
  };
  return call.data.credentialsRef;
}

describe("toPublicModel", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: "pm_1",
      slug: "gw/model",
      upstreamId: "model",
      name: "Model",
      label: "Model",
      hint: null,
      description: null,
      iconSvg: "",
      outputType: "text",
      contextWindowTokens: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      reasoningEfforts: [],
      capabilities: null,
      imageCapabilities: null,
      isActive: true,
      sortOrder: 0,
      connectionId: "pc_1",
      ...overrides,
    } as never;
  }

  it("projects the declared imageCapabilities for an image model", () => {
    const caps = { n: { min: 1, max: 4 }, aspectRatios: ["1:1"], sizes: ["1024x1024"] };
    const projected = toPublicModel(
      row({ outputType: "image", imageCapabilities: caps }),
    );
    expect(projected.imageCapabilities).toEqual(caps);
    expect(projected.outputType).toBe("image");
  });

  it("projects null imageCapabilities for a text model", () => {
    const projected = toPublicModel(row());
    expect(projected.imageCapabilities).toBeNull();
  });
});

describe("connection CRUD", () => {
  it("never returns the credential reference", () => {
    const row = {
      id: "pc_1",
      kind: "compatible",
      label: "My OpenRouter",
      slug: "my-openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      api: "chat",
      credentialsRef: "super-secret-envelope",
      isActive: true,
      sortOrder: 0,
    };
    const publicRow = toPublicConnection(row);
    expect(publicRow).not.toHaveProperty("credentialsRef");
    expect(publicRow).toMatchObject({ hasCredentials: true });
    expect(JSON.stringify(publicRow)).not.toContain("super-secret-envelope");
  });

  it("scopes the list query to the caller", async () => {
    const db = makeDb();
    await listConnections(db, "u_1");
    expect(
      (db as never as { providerConnection: { findMany: ReturnType<typeof vi.fn> } })
        .providerConnection.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u_1" } }),
    );
  });

  it("encrypts the api key on create", async () => {
    const db = makeDb();
    await createConnection(db, "u_1", {
      kind: "compatible",
      label: "GW",
      baseUrl: "https://gw.example/v1",
      apiKey: "sk-live-secret",
    });
    const call = (
      db as never as { providerConnection: { create: ReturnType<typeof vi.fn> } }
    ).providerConnection.create.mock.calls[0]?.[0] as {
      data: { credentialsRef: string };
    };
    expect(call.data.credentialsRef).not.toContain("sk-live-secret");
    expect(decodeProviderCredentials(call.data.credentialsRef).apiKey).toBe(
      "sk-live-secret",
    );
  });

  it("returns a public shape without the credential envelope on create", async () => {
    const db = makeDb();
    const result = await createConnection(db, "u_1", {
      kind: "compatible",
      label: "GW",
      baseUrl: "https://gw.example/v1",
      apiKey: "sk-distinctive-create-marker",
    });
    const call = (
      db as never as { providerConnection: { create: ReturnType<typeof vi.fn> } }
    ).providerConnection.create.mock.calls[0]?.[0] as {
      data: { credentialsRef: string };
    };
    expect(call.data.credentialsRef).not.toContain("sk-distinctive-create-marker");
    expect(result).toMatchObject({ hasCredentials: true });
    expect(result).not.toHaveProperty("credentialsRef");
    expect(JSON.stringify(result)).not.toContain(call.data.credentialsRef);
  });

  it("preserves the stored key when the update omits it", async () => {
    const existingRef = encodeProviderCredentials({ apiKey: "sk-original" });
    const db = makeDb({
      providerConnection: {
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          label: "GW",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: existingRef,
          isActive: true,
          sortOrder: 0,
        })),
        findMany: vi.fn(async () => []),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pc_1",
          ...data,
        })),
      },
    });

    await updateConnection(db, "u_1", "pc_1", {
      kind: "compatible",
      label: "Renamed",
      baseUrl: "https://gw.example/v1",
    });

    const call = (
      db as never as { providerConnection: { update: ReturnType<typeof vi.fn> } }
    ).providerConnection.update.mock.calls[0]?.[0] as {
      data: { credentialsRef: string };
    };
    expect(decodeProviderCredentials(call.data.credentialsRef).apiKey).toBe(
      "sk-original",
    );
  });

  it("preserves the stored headers when the update omits them", async () => {
    const db = makeConnectionDb(
      encodeProviderCredentials({
        apiKey: "sk-original",
        headers: { "X-Org": "acme" },
      }),
    );

    await updateConnection(db, "u_1", "pc_1", {
      kind: "compatible",
      label: "Renamed",
      baseUrl: "https://gw.example/v1",
    });

    expect(
      decodeProviderCredentials(updatedCredentialsRef(db)).headers,
    ).toEqual({ "X-Org": "acme" });
  });

  it("clears the stored headers when the update sends an explicit empty map", async () => {
    const db = makeConnectionDb(
      encodeProviderCredentials({
        apiKey: "sk-original",
        headers: { "X-Org": "acme" },
      }),
    );

    await updateConnection(db, "u_1", "pc_1", {
      kind: "compatible",
      label: "Renamed",
      baseUrl: "https://gw.example/v1",
      headers: {},
    });

    expect(
      decodeProviderCredentials(updatedCredentialsRef(db)).headers,
    ).toBeNull();
  });

  it("replaces the stored headers when the update sends a new map", async () => {
    const db = makeConnectionDb(
      encodeProviderCredentials({
        apiKey: "sk-original",
        headers: { "X-Org": "acme" },
      }),
    );

    await updateConnection(db, "u_1", "pc_1", {
      kind: "compatible",
      label: "Renamed",
      baseUrl: "https://gw.example/v1",
      headers: { "X-New": "v" },
    });

    const headers = decodeProviderCredentials(updatedCredentialsRef(db)).headers;
    expect(headers).toEqual({ "X-New": "v" });
    expect(headers).not.toHaveProperty("X-Org");
  });

  it("returns a public shape without the credential envelope on update", async () => {
    const existingRef = encodeProviderCredentials({ apiKey: "sk-original" });
    const db = makeDb({
      providerConnection: {
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          label: "GW",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: existingRef,
          isActive: true,
          sortOrder: 0,
        })),
        findMany: vi.fn(async () => []),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pc_1",
          ...data,
        })),
      },
    });

    const result = await updateConnection(db, "u_1", "pc_1", {
      kind: "compatible",
      label: "Renamed",
      baseUrl: "https://gw.example/v1",
    });

    const call = (
      db as never as { providerConnection: { update: ReturnType<typeof vi.fn> } }
    ).providerConnection.update.mock.calls[0]?.[0] as {
      data: { credentialsRef: string };
    };
    expect(result).toMatchObject({ hasCredentials: true });
    expect(result).not.toHaveProperty("credentialsRef");
    expect(JSON.stringify(result)).not.toContain(call.data.credentialsRef);
  });

  it("404s a connection owned by another user", async () => {
    const db = makeDb();
    await expect(deleteConnection(db, "u_1", "pc_other")).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("setConnectionEnabled", () => {
  it("writes isActive for an owned connection", async () => {
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          isActive: true,
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pc_1",
          ...data,
        })),
      },
    });

    await setConnectionEnabled(db, "u_1", "pc_1", false);

    expect(
      (db as never as { providerConnection: { update: ReturnType<typeof vi.fn> } })
        .providerConnection.update,
    ).toHaveBeenCalledWith({ where: { id: "pc_1" }, data: { isActive: false } });
  });

  it("404s a connection owned by another user", async () => {
    const db = makeDb();
    await expect(
      setConnectionEnabled(db, "u_1", "pc_other", false),
    ).rejects.toThrow(/not found/i);
  });

  it("returns a public shape without the credential envelope", async () => {
    const envelope = encodeProviderCredentials({ apiKey: "sk-original" });
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          label: "GW",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: envelope,
          isActive: true,
          sortOrder: 0,
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pc_1",
          kind: "compatible",
          label: "GW",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: envelope,
          isActive: true,
          sortOrder: 0,
          ...data,
        })),
      },
    });

    const result = await setConnectionEnabled(db, "u_1", "pc_1", false);

    expect(result).toMatchObject({ hasCredentials: true, isActive: false });
    expect(result).not.toHaveProperty("credentialsRef");
    expect(JSON.stringify(result)).not.toContain(envelope);
  });
});

vi.mock("@anreal/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anreal/agent")>();
  return {
    ...actual,
    listProviderModels: vi.fn(async () => ({
      data: [
        { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna", contextLength: 1_000_000 },
        { id: "openai/gpt-5-nano", name: "GPT 5 Nano", contextLength: 400_000 },
      ],
    })),
    describeModel: vi.fn(() => ({
      provider: "openai",
      modelId: "openai/gpt-5.6-luna",
      capabilities: { streaming: true, tools: true, imageInput: true },
      contextLimits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
    })),
  };
});

describe("discoverConnectionModels", () => {
  it("refuses a connection the caller does not own", async () => {
    const db = makeDb();
    await expect(
      discoverConnectionModels(db, "u_1", "pc_other"),
    ).rejects.toThrow(/not found/i);
  });

  it("lists through the stored credentials without whose secrets", async () => {
    const ref = encodeProviderCredentials({ apiKey: "sk-stored" });
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          kind: "compatible",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: ref,
        })),
      },
    });

    const result = await discoverConnectionModels(db, "u_1", "pc_1");

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ id: "openai/gpt-5.6-luna" });
  });

  it("maps a listing failure to a readable, redacted message", async () => {
    const agent = await import("@anreal/agent");
    vi.mocked(agent.listProviderModels).mockRejectedValueOnce(
      new Error("401 Unauthorized for key sk-leaked-abcdef123456"),
    );
    const ref = encodeProviderCredentials({ apiKey: "sk-stored" });
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          kind: "compatible",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: ref,
        })),
      },
    });

    await expect(
      discoverConnectionModels(db, "u_1", "pc_1"),
    ).rejects.toThrow(/invalid api key/i);
  });
});

describe("testProviderConnection", () => {
  it("probes the provider and reports how many models it found", async () => {
    const db = makeDb();
    const result = await testProviderConnection(db, "u_1", {
      kind: "compatible",
      baseUrl: "https://gw.example/v1",
      apiKey: "sk-live",
    });
    expect(result).toEqual({ ok: true, modelCount: 2 });
  });

  it("reuses the stored credential when the key is blank", async () => {
    const agent = await import("@anreal/agent");
    vi.mocked(agent.listProviderModels).mockClear();
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          baseUrl: "https://gw.example/v1",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
    });

    const result = await testProviderConnection(db, "u_1", {
      kind: "compatible",
      baseUrl: "https://gw.example/v1",
      apiKey: "  ",
      connectionId: "pc_1",
    });

    expect(result).toEqual({ ok: true, modelCount: 2 });
    expect(vi.mocked(agent.listProviderModels)).toHaveBeenLastCalledWith({
      kind: "compatible",
      credentials: {
        apiKey: "sk-stored",
        baseUrl: "https://gw.example/v1",
        headers: null,
      },
    });
  });

  it("reuses the stored headers when none are supplied", async () => {
    const agent = await import("@anreal/agent");
    vi.mocked(agent.listProviderModels).mockClear();
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          baseUrl: "https://gw.example/v1",
          credentialsRef: encodeProviderCredentials({
            apiKey: "sk-stored",
            headers: { "X-Org": "acme" },
          }),
        })),
      },
    });

    await testProviderConnection(db, "u_1", {
      kind: "compatible",
      baseUrl: "https://gw.example/v1",
      connectionId: "pc_1",
    });

    expect(vi.mocked(agent.listProviderModels)).toHaveBeenLastCalledWith({
      kind: "compatible",
      credentials: {
        apiKey: "sk-stored",
        baseUrl: "https://gw.example/v1",
        headers: { "X-Org": "acme" },
      },
    });
  });

  it("ignores caller-supplied kind, base url, and headers on the reuse path", async () => {
    const agent = await import("@anreal/agent");
    vi.mocked(agent.listProviderModels).mockClear();
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          baseUrl: "https://gw.example/v1",
          credentialsRef: encodeProviderCredentials({
            apiKey: "sk-stored",
            headers: { "X-Org": "acme" },
          }),
        })),
      },
    });

    // The exploit shape: a blank key reuses the stored credential, so the
    // stored credential must only ever be sent to the stored endpoint.
    await testProviderConnection(db, "u_1", {
      kind: "openai",
      baseUrl: "https://attacker.example/v1",
      apiKey: "",
      headers: { "X-Evil": "1" },
      connectionId: "pc_1",
    });

    const calledWith = vi.mocked(agent.listProviderModels).mock.calls.at(-1)?.[0];
    expect(calledWith).toEqual({
      kind: "compatible",
      credentials: {
        apiKey: "sk-stored",
        baseUrl: "https://gw.example/v1",
        headers: { "X-Org": "acme" },
      },
    });
    expect(JSON.stringify(calledWith)).not.toContain("attacker.example");
    expect(JSON.stringify(calledWith)).not.toContain("X-Evil");
  });

  it("requires a key when no connection is being reused", async () => {
    const db = makeDb();
    await expect(
      testProviderConnection(db, "u_1", {
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
      }),
    ).rejects.toThrow(/api key/i);
  });

  it("404s a connection the caller does not own", async () => {
    const db = makeDb();
    await expect(
      testProviderConnection(db, "u_1", {
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        connectionId: "pc_other",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("maps a provider auth failure to a redacted message", async () => {
    const agent = await import("@anreal/agent");
    vi.mocked(agent.listProviderModels).mockRejectedValueOnce(
      new Error("401 Unauthorized for key sk-leaked-abcdef123456"),
    );
    const db = makeDb();
    await expect(
      testProviderConnection(db, "u_1", {
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        apiKey: "sk-live",
      }),
    ).rejects.toThrow(/invalid api key/i);
  });

  it("rejects an unknown kind", async () => {
    const db = makeDb();
    await expect(
      testProviderConnection(db, "u_1", {
        kind: "nope",
        baseUrl: "https://gw.example/v1",
        apiKey: "sk-live",
      }),
    ).rejects.toThrow(/kind/i);
  });

  it("requires a base url for the compatible kind", async () => {
    const db = makeDb();
    await expect(
      testProviderConnection(db, "u_1", { kind: "compatible", apiKey: "sk-live" }),
    ).rejects.toThrow(/base url/i);
  });

  it("rejects a reserved authorization header", async () => {
    const db = makeDb();
    await expect(
      testProviderConnection(db, "u_1", {
        kind: "compatible",
        baseUrl: "https://gw.example/v1",
        apiKey: "sk-live",
        headers: { authorization: "Bearer x" },
      }),
    ).rejects.toThrow(/authorization/i);
  });
});

describe("createConnectionModel", () => {
  it("derives a slug from the connection slug and the upstream id", async () => {
    const db = makeDb({
      providerConnection: {
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "my-openrouter",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
      providerModel: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pm_1",
          ...data,
        })),
      },
    });

    await createConnectionModel(db, "u_1", "pc_1", {
      upstreamId: "openai/GPT-5.6 Luna",
      name: "GPT 5.6 Luna",
      reasoningEfforts: ["low", "high"],
    });

    const call = (
      db as never as { providerModel: { create: ReturnType<typeof vi.fn> } }
    ).providerModel.create.mock.calls[0]?.[0] as {
      data: { slug: string; upstreamId: string };
    };
    expect(call.data.slug).toBe("my-openrouter/openai-gpt-5.6-luna");
    expect(call.data.upstreamId).toBe("openai/GPT-5.6 Luna");
  });

  it("suffixes when the slug is taken inside the user scope", async () => {
    const db = makeDb({
      providerConnection: {
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
      providerModel: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [{ slug: "gw/model-x" }]),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pm_2",
          ...data,
        })),
      },
    });

    await createConnectionModel(db, "u_1", "pc_1", { upstreamId: "model-x" });

    const call = (
      db as never as { providerModel: { create: ReturnType<typeof vi.fn> } }
    ).providerModel.create.mock.calls[0]?.[0] as { data: { slug: string } };
    expect(call.data.slug).toBe("gw/model-x-2");
  });

  it("persists the validated imageCapabilities for an image model", async () => {
    const db = makeDb({
      providerConnection: {
        count: vi.fn(async () => 1),
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
      providerModel: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pm_2",
          ...data,
        })),
      },
    });

    await createConnectionModel(db, "u_1", "pc_1", {
      upstreamId: "openai/gpt-5-image-mini",
      outputType: "image",
      imageCapabilities: {
        n: { min: 1, max: 4 },
        sizes: ["1024x1024", "auto"],
        aspectRatios: ["1:1", "auto"],
      },
    });

    const call = (
      db as never as { providerModel: { create: ReturnType<typeof vi.fn> } }
    ).providerModel.create.mock.calls[0]?.[0] as {
      data: { imageCapabilities: unknown };
    };
    expect(call.data.imageCapabilities).toEqual({
      nMax: 4,
      sizes: ["1024x1024", "auto"],
      aspectRatios: ["1:1", "auto"],
    });
  });

  it("enforces the per-user model cap", async () => {
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
      providerModel: {
        count: vi.fn(async () => 100),
        findMany: vi.fn(async () => []),
      },
    });

    await expect(
      createConnectionModel(db, "u_1", "pc_1", { upstreamId: "x" }),
    ).rejects.toThrow(/at most 100/i);
  });
});

describe("updateConnectionModel", () => {
  function dbWithModel() {
    return makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
      providerModel: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [{ slug: "gw/model-x" }]),
        findFirst: vi.fn(async () => ({
          id: "pm_1",
          slug: "gw/model-x",
          upstreamId: "model-x",
          userId: "u_1",
          connectionId: "pc_1",
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "pm_1",
          ...data,
        })),
      },
    });
  }

  it("re-validates and keeps the stored slug when the upstream id is unchanged", async () => {
    const db = dbWithModel();

    await updateConnectionModel(db, "u_1", "pc_1", "pm_1", {
      upstreamId: "model-x",
      name: "Renamed",
      reasoningEfforts: ["high"],
    });

    const call = (
      db as never as { providerModel: { update: ReturnType<typeof vi.fn> } }
    ).providerModel.update.mock.calls[0]?.[0] as {
      data: { slug: string; name: string; reasoningEfforts: string[] };
    };
    expect(call.data.slug).toBe("gw/model-x");
    expect(call.data.name).toBe("Renamed");
    expect(call.data.reasoningEfforts).toEqual(["high"]);
  });

  it("persists imageCapabilities supplied on update", async () => {
    const db = dbWithModel();

    await updateConnectionModel(db, "u_1", "pc_1", "pm_1", {
      upstreamId: "model-x",
      outputType: "image",
      imageCapabilities: {
        n: { min: 1, max: 2 },
        sizes: ["1024x1024"],
        aspectRatios: ["1:1"],
      },
    });

    const call = (
      db as never as { providerModel: { update: ReturnType<typeof vi.fn> } }
    ).providerModel.update.mock.calls[0]?.[0] as {
      data: { imageCapabilities: unknown };
    };
    expect(call.data.imageCapabilities).toEqual({
      nMax: 2,
      sizes: ["1024x1024"],
      aspectRatios: ["1:1"],
    });
  });

  it("404s a model the caller does not own", async () => {
    const db = makeDb();

    await expect(
      updateConnectionModel(db, "u_1", "pc_1", "pm_other", { name: "X" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("deleteConnectionModel", () => {
  it("deletes a model inside the caller's scope", async () => {
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "gw",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
      providerModel: {
        findFirst: vi.fn(async () => ({ id: "pm_1", slug: "gw/model-x" })),
        delete: vi.fn(async () => ({})),
      },
    });

    await deleteConnectionModel(db, "u_1", "pc_1", "pm_1");

    expect(
      (
        db as never as { providerModel: { delete: ReturnType<typeof vi.fn> } }
      ).providerModel.delete,
    ).toHaveBeenCalledWith({ where: { id: "pm_1" } });
  });

  it("404s a model the caller does not own", async () => {
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "gw",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
    });

    await expect(
      deleteConnectionModel(db, "u_1", "pc_1", "pm_other"),
    ).rejects.toThrow(/not found/i);
  });
});
describe("prefillConnectionModel", () => {
  it("builds from the stored credentials and reports adapter metadata", async () => {
    const db = makeDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          id: "pc_1",
          userId: "u_1",
          kind: "compatible",
          slug: "gw",
          baseUrl: "https://gw.example/v1",
          api: "chat",
          credentialsRef: encodeProviderCredentials({ apiKey: "sk-stored" }),
        })),
      },
    });

    const result = await prefillConnectionModel(db, "u_1", "pc_1", {
      upstreamId: "openai/gpt-5.6-luna",
    });

    expect(result.name).toBe("openai/gpt-5.6-luna");
    expect(result.reasoningEfforts).toContain("high");
    expect(result.providerReported).toBe(true);
  });

  it("404s a connection the caller does not own", async () => {
    const db = makeDb();

    await expect(
      prefillConnectionModel(db, "u_1", "pc_other", { upstreamId: "x" }),
    ).rejects.toThrow(/not found/i);
  });
});