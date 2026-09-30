import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service.js", () => ({ findActiveModel: vi.fn() }));

import { findActiveModel } from "./service.js";
import {
  RoleInputError,
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
    expect(roleDefaultModelId("chat")).toBeNull();
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
          role: "chat",
          catalogModelId: "openai/pruned-model",
          providerModelId: null,
        })),
      },
      chatModel: { findFirst: vi.fn(async () => null) },
    });

    expect(await resolveRoleTarget(db, USER, "chat")).toBeNull();
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

  it("rejects an unknown role key", async () => {
    await expect(
      setRoleAssignment(makeDb(), USER, "nope" as never, null),
    ).rejects.toBeInstanceOf(RoleInputError);
  });
});
