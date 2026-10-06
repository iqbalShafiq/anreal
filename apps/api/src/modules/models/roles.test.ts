import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  createCompletionModel: vi.fn((modelId: string) => ({
    modelId,
    built: "catalog" as const,
  })),
  createCompletionModelFor: vi.fn((target: { upstreamId: string }) => ({
    modelId: target.upstreamId,
    built: "connection" as const,
  })),
  decodeProviderCredentials: vi.fn(() => ({
    apiKey: "sk-test",
    headers: null as Record<string, string> | null,
  })),
}));

vi.mock("@anreal/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anreal/agent")>()),
  createCompletionModel: f.createCompletionModel,
  createCompletionModelFor: f.createCompletionModelFor,
}));

vi.mock("../provider-connections/credentials.js", () => ({
  decodeProviderCredentials: f.decodeProviderCredentials,
}));

vi.mock("./service.js", () => ({ findActiveModel: vi.fn() }));

import { findActiveModel } from "./service.js";
import {
  RoleInputError,
  buildRoleCompletionModel,
  listRoleAssignments,
  roleDefaultModelId,
  resolveRoleTarget,
  setRoleAssignment,
  type RolesDb,
} from "./roles.js";

const USER = "u_1";

function makeDb(overrides: Record<string, unknown> = {}): RolesDb {
  return {
    modelRoleAssignment: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    chatModel: { findFirst: vi.fn(async () => null) },
    providerModel: { findFirst: vi.fn(async () => null) },
    providerConnection: { findFirst: vi.fn(async () => null) },
    ...overrides,
  } as unknown as RolesDb;
}

describe("role defaults", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(findActiveModel).mockReset().mockResolvedValue(null);
  });

  it("uses the existing env var when no assignment exists", () => {
    vi.stubEnv("PROFILE_SUMMARY_MODEL", "openai/gpt-5-nano");
    expect(roleDefaultModelId("profileSummary")).toBe("openai/gpt-5-nano");
  });

  it("falls back to the role's existing constant default", () => {
    vi.stubEnv("SITE_MODEL", "");
    expect(roleDefaultModelId("siteBuilder")).toBe(
      "meta/muse-spark-1.3-contributor",
    );
  });

  it("reports no default for a role that has none beyond the chat model", () => {
    expect(roleDefaultModelId("memoryCompaction")).toBeNull();
    expect(roleDefaultModelId("visionHelper")).toBeNull();
  });
});

describe("resolveRoleTarget", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(findActiveModel).mockReset().mockResolvedValue(null);
  });

  it("returns null when the user has no assignment and the role has no env default", async () => {
    expect(await resolveRoleTarget(makeDb(), USER, "memoryCompaction")).toBeNull();
  });

  it("uses the env default when the user has no assignment", async () => {
    vi.stubEnv("SITE_MODEL", "meta/muse-spark-1.3-contributor");
    expect(await resolveRoleTarget(makeDb(), USER, "siteBuilder")).toEqual({
      modelId: "meta/muse-spark-1.3-contributor",
      connectionId: null,
    });
  });

  it("prefers the user's assignment over the env default", async () => {
    vi.stubEnv("SITE_MODEL", "meta/muse-spark-1.3-contributor");
    const db = makeDb({
      modelRoleAssignment: {
        findFirst: vi.fn(async () => ({
          role: "siteBuilder",
          catalogModelId: "openai/gpt-6-luna",
          providerModelId: null,
        })),
      },
      // A valid catalog target: without this row the assignment is dangling
      // and the resolver must fall back (see the next test).
      chatModel: {
        findFirst: vi.fn(async () => ({ modelId: "openai/gpt-6-luna" })),
      },
    });
    expect(await resolveRoleTarget(db, USER, "siteBuilder")).toEqual({
      modelId: "openai/gpt-6-luna",
      connectionId: null,
    });
  });

  it("returns the connection for a BYOK assignment", async () => {
    const db = makeDb({
      modelRoleAssignment: {
        findFirst: vi.fn(async () => ({
          role: "visionHelper",
          catalogModelId: null,
          providerModelId: "pm_1",
        })),
      },
      providerModel: {
        findFirst: vi.fn(async () => ({
          slug: "my-gw/gpt-5.6-luna",
          connectionId: "pc_1",
        })),
      },
    });
    expect(await resolveRoleTarget(db, USER, "visionHelper")).toEqual({
      modelId: "my-gw/gpt-5.6-luna",
      connectionId: "pc_1",
    });
  });

  it("falls back to the env default when the assigned BYOK model is gone", async () => {
    vi.stubEnv("SITE_MODEL", "meta/muse-spark-1.3-contributor");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = makeDb({
      modelRoleAssignment: {
        findFirst: vi.fn(async () => ({
          role: "siteBuilder",
          catalogModelId: null,
          providerModelId: "pm_gone",
        })),
      },
      providerModel: { findFirst: vi.fn(async () => null) },
    });

    expect(await resolveRoleTarget(db, USER, "siteBuilder")).toEqual({
      modelId: "meta/muse-spark-1.3-contributor",
      connectionId: null,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back when the assigned catalog model is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = makeDb({
      modelRoleAssignment: {
        findFirst: vi.fn(async () => ({
          role: "memoryCompaction",
          catalogModelId: "openai/pruned-model",
          providerModelId: null,
        })),
      },
      chatModel: { findFirst: vi.fn(async () => null) },
    });

    expect(await resolveRoleTarget(db, USER, "memoryCompaction")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("scopes every lookup by userId", async () => {
    const db = makeDb();
    await resolveRoleTarget(db, USER, "siteBuilder");
    expect(
      (db.modelRoleAssignment.findFirst as ReturnType<typeof vi.fn>).mock
        .calls[0][0],
    ).toMatchObject({ where: expect.objectContaining({ userId: USER }) });
  });
});

describe("setRoleAssignment", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(findActiveModel).mockReset().mockResolvedValue(null);
  });

  it("clears the assignment when modelId is null", async () => {
    const db = makeDb();
    await setRoleAssignment(db, USER, "siteBuilder", null);
    expect(
      db.modelRoleAssignment.deleteMany as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith({ where: { userId: USER, role: "siteBuilder" } });
    expect(db.modelRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it("rejects a model the user cannot see", async () => {
    vi.mocked(findActiveModel).mockResolvedValue(null);
    await expect(
      setRoleAssignment(makeDb(), USER, "siteBuilder", "nobody/else"),
    ).rejects.toBeInstanceOf(RoleInputError);
  });

  it("stores a catalog assignment by catalogModelId", async () => {
    vi.mocked(findActiveModel).mockResolvedValue({
      modelId: "openai/gpt-6-luna",
      connectionId: null,
      source: "catalog",
      inputModalities: ["text", "image"],
    } as never);
    const db = makeDb();

    await setRoleAssignment(db, USER, "siteBuilder", "openai/gpt-6-luna");

    expect(db.modelRoleAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_role: { userId: USER, role: "siteBuilder" } },
        create: expect.objectContaining({
          catalogModelId: "openai/gpt-6-luna",
          providerModelId: null,
        }),
      }),
    );
  });

  it("stores a BYOK assignment by providerModelId", async () => {
    vi.mocked(findActiveModel).mockResolvedValue({
      modelId: "my-gw/gpt-5.6-luna",
      connectionId: "pc_1",
      source: "connection",
      inputModalities: ["text", "image"],
    } as never);
    const db = makeDb({
      providerModel: { findFirst: vi.fn(async () => ({ id: "pm_1" })) },
    });

    await setRoleAssignment(db, USER, "siteBuilder", "my-gw/gpt-5.6-luna");

    expect(db.modelRoleAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          catalogModelId: null,
          providerModelId: "pm_1",
        }),
      }),
    );
  });

  it("rejects a text-only model for the vision helper", async () => {
    vi.mocked(findActiveModel).mockResolvedValue({
      modelId: "deepseek/deepseek-v4-flash-0731",
      connectionId: null,
      source: "catalog",
      inputModalities: ["text"],
    } as never);

    await expect(
      setRoleAssignment(
        makeDb(),
        USER,
        "visionHelper",
        "deepseek/deepseek-v4-flash-0731",
      ),
    ).rejects.toThrow(/image/i);
  });

  it("rejects an image model for every non-vision role", async () => {
    for (const role of [
      "memoryCompaction",
      "profileSummary",
      "siteBuilder",
      "scheduledChat",
    ] as const) {
      vi.mocked(findActiveModel).mockResolvedValue({
        modelId: "my-gw/flux-pro",
        connectionId: "pc_1",
        source: "connection",
        outputType: "image",
        inputModalities: ["text"],
      } as never);

      await expect(
        setRoleAssignment(makeDb(), USER, role, "my-gw/flux-pro"),
      ).rejects.toThrow(/text task/i);
    }
  });

  it("still accepts an image-capable model for the vision helper", async () => {
    vi.mocked(findActiveModel).mockResolvedValue({
      modelId: "my-gw/gpt-vision",
      connectionId: "pc_1",
      source: "connection",
      outputType: "text",
      inputModalities: ["text", "image"],
    } as never);
    const db = makeDb({
      providerModel: { findFirst: vi.fn(async () => ({ id: "pm_1" })) },
    });

    await expect(
      setRoleAssignment(db, USER, "visionHelper", "my-gw/gpt-vision"),
    ).resolves.toMatchObject({ role: "visionHelper", modelId: "my-gw/gpt-vision" });
  });

  it("accepts a text model for every role, as before", async () => {
    for (const role of [
      "memoryCompaction",
      "profileSummary",
      "siteBuilder",
      "visionHelper",
      "scheduledChat",
    ] as const) {
      vi.mocked(findActiveModel).mockResolvedValue({
        modelId: "openai/gpt-6-luna",
        connectionId: null,
        source: "catalog",
        outputType: "text",
        inputModalities: ["text", "image"],
      } as never);

      await expect(
        setRoleAssignment(makeDb(), USER, role, "openai/gpt-6-luna"),
      ).resolves.toMatchObject({ role, modelId: "openai/gpt-6-luna" });
    }
  });

  it("rejects an unknown role key", async () => {
    await expect(
      setRoleAssignment(makeDb(), USER, "nope" as never, null),
    ).rejects.toBeInstanceOf(RoleInputError);
  });

  it("rejects the removed chat role even with a valid model", async () => {
    vi.mocked(findActiveModel).mockResolvedValue({
      modelId: "openai/gpt-6-luna",
      connectionId: null,
      source: "catalog",
      inputModalities: ["text"],
    } as never);

    await expect(
      setRoleAssignment(makeDb(), USER, "chat" as never, "openai/gpt-6-luna"),
    ).rejects.toBeInstanceOf(RoleInputError);
  });
});

function byokDb(overrides: Record<string, unknown> = {}): RolesDb {
  return makeDb({
    modelRoleAssignment: {
      findFirst: vi.fn(async () => ({
        role: "siteBuilder",
        catalogModelId: null,
        providerModelId: "pm_1",
      })),
    },
    providerModel: {
      findFirst: vi.fn(async () => ({
        slug: "my-gw/openai-gpt-5.6-luna",
        connectionId: "pc_1",
      })),
    },
    providerConnection: {
      findFirst: vi.fn(async () => ({
        kind: "openai",
        baseUrl: null,
        api: null,
        credentialsRef: "ref_1",
        models: [
          {
            upstreamId: "openai/gpt-5.6-luna",
            reasoningEfforts: ["low", "high"],
            contextWindowTokens: null,
            maxInputTokens: null,
            maxOutputTokens: null,
          },
        ],
      })),
    },
    ...overrides,
  });
}

describe("buildRoleCompletionModel", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(findActiveModel).mockReset().mockResolvedValue(null);
    f.createCompletionModel.mockClear();
    f.createCompletionModelFor.mockClear();
    f.decodeProviderCredentials
      .mockReset()
      .mockReturnValue({ apiKey: "sk-test", headers: null });
  });

  it("builds a catalog target through createCompletionModel", async () => {
    const db = makeDb({
      modelRoleAssignment: {
        findFirst: vi.fn(async () => ({
          role: "siteBuilder",
          catalogModelId: "openai/gpt-6-luna",
          providerModelId: null,
        })),
      },
      chatModel: {
        findFirst: vi.fn(async () => ({ modelId: "openai/gpt-6-luna" })),
      },
    });

    await expect(buildRoleCompletionModel(db, USER, "siteBuilder")).resolves.toEqual(
      { modelId: "openai/gpt-6-luna", built: "catalog" },
    );
    expect(f.createCompletionModel).toHaveBeenCalledWith("openai/gpt-6-luna");
    expect(f.createCompletionModelFor).not.toHaveBeenCalled();
  });

  it("resolves a BYOK target scoped by userId and passes the stored upstreamId", async () => {
    const db = byokDb();

    await expect(buildRoleCompletionModel(db, USER, "siteBuilder")).resolves.toEqual(
      { modelId: "openai/gpt-5.6-luna", built: "connection" },
    );
    // The connection and its model row are looked up inside the caller's scope.
    expect(db.providerConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "pc_1", userId: USER }),
      }),
    );
    expect(db.providerModel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER }),
      }),
    );
    // The upstream id comes from the stored row — never the lowercased,
    // separator-rewritten slug.
    expect(f.createCompletionModelFor).toHaveBeenCalledWith(
      expect.objectContaining({ upstreamId: "openai/gpt-5.6-luna" }),
    );
  });

  it("returns null and warns when the connection is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = byokDb({
      providerConnection: { findFirst: vi.fn(async () => null) },
    });

    await expect(buildRoleCompletionModel(db, USER, "siteBuilder")).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null and warns when the connection's model row is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = byokDb({
      providerConnection: {
        findFirst: vi.fn(async () => ({
          kind: "openai",
          baseUrl: null,
          api: null,
          credentialsRef: "ref_1",
          models: [],
        })),
      },
    });

    await expect(buildRoleCompletionModel(db, USER, "siteBuilder")).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null and warns when the credentials cannot be decoded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.decodeProviderCredentials.mockImplementation(() => {
      throw new Error("bad key");
    });

    await expect(buildRoleCompletionModel(byokDb(), USER, "siteBuilder")).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("listRoleAssignments", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns one entry per role in ROLE_KEYS order", async () => {
    const infos = await listRoleAssignments(makeDb(), USER);
    expect(infos.map((info) => info.role)).toEqual([
      "memoryCompaction",
      "profileSummary",
      "siteBuilder",
      "visionHelper",
      "scheduledChat",
    ]);
  });

  it("ignores a lingering chat row and never resolves it", async () => {
    const db = makeDb({
      modelRoleAssignment: {
        findMany: vi.fn(async () => [
          { role: "chat", catalogModelId: "openai/pruned", providerModelId: null },
        ]),
      },
    });

    const infos = await listRoleAssignments(db, USER);
    expect(infos.map((info) => info.role)).toEqual([
      "memoryCompaction",
      "profileSummary",
      "siteBuilder",
      "visionHelper",
      "scheduledChat",
    ]);
    expect(db.chatModel.findFirst).not.toHaveBeenCalled();
    expect(db.providerModel.findFirst).not.toHaveBeenCalled();
  });

  it("projects a BYOK row's stored slug", async () => {
    const db = makeDb({
      modelRoleAssignment: {
        findMany: vi.fn(async () => [
          { role: "siteBuilder", catalogModelId: null, providerModelId: "pm_1" },
        ]),
      },
      providerModel: {
        findFirst: vi.fn(async () => ({ slug: "my-gw/model" })),
      },
    });

    const infos = await listRoleAssignments(db, USER);
    expect(infos.find((info) => info.role === "siteBuilder")?.modelId).toBe(
      "my-gw/model",
    );
    expect(db.providerModel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER }),
      }),
    );
  });

  it("projects a live catalog row", async () => {
    const db = makeDb({
      modelRoleAssignment: {
        findMany: vi.fn(async () => [
          {
            role: "siteBuilder",
            catalogModelId: "openai/gpt-6-luna",
            providerModelId: null,
          },
        ]),
      },
      chatModel: {
        findFirst: vi.fn(async () => ({ modelId: "openai/gpt-6-luna" })),
      },
    });

    const infos = await listRoleAssignments(db, USER);
    expect(infos.find((info) => info.role === "siteBuilder")?.modelId).toBe(
      "openai/gpt-6-luna",
    );
  });

  it("projects a stale catalog row as no assignment", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = makeDb({
      modelRoleAssignment: {
        findMany: vi.fn(async () => [
          { role: "siteBuilder", catalogModelId: "openai/pruned", providerModelId: null },
        ]),
      },
      chatModel: { findFirst: vi.fn(async () => null) },
    });

    const infos = await listRoleAssignments(db, USER);
    expect(infos.find((info) => info.role === "siteBuilder")?.modelId).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
