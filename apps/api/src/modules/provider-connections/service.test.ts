import { describe, expect, it, vi } from "vitest";
import {
  ProviderInputError,
  createConnection,
  deleteConnection,
  listConnections,
  toPublicConnection,
  updateConnection,
  validateConnectionInput,
  validateModelInput,
} from "./service.js";
import {
  decodeProviderCredentials,
  encodeProviderCredentials,
} from "./credentials.js";

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
    providerModel: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    ...overrides,
  } as never;
}

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

  it("404s a connection owned by another user", async () => {
    const db = makeDb();
    await expect(deleteConnection(db, "u_1", "pc_other")).rejects.toThrow(
      /not found/i,
    );
  });
});
