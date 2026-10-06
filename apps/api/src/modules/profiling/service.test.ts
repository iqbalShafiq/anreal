import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  createCompletionModel: vi.fn((modelId?: string) => ({ modelId })),
  buildRoleCompletionModel: vi.fn(
    async (_db: unknown, _userId: string, _role: string): Promise<unknown> => null,
  ),
}));

vi.mock("@anreal/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anreal/agent")>()),
  createCompletionModel: f.createCompletionModel,
}));

vi.mock("../models/roles.js", () => ({
  buildRoleCompletionModel: f.buildRoleCompletionModel,
}));

vi.mock("../../utils/prisma.js", () => ({ prisma: { __tag: "prisma" } }));

import { DEFAULT_COMPLETION_MODEL } from "@anreal/agent";
import { prisma } from "../../utils/prisma.js";
import { buildRoleCompletionModel } from "../models/roles.js";
import { resolveProfileSummaryModel } from "./service.js";

describe("resolveProfileSummaryModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    f.buildRoleCompletionModel.mockResolvedValue(null);
  });

  it("uses the user's assignment and scopes the lookup by userId", async () => {
    const assigned = { modelId: "openai/gpt-6-luna" };
    f.buildRoleCompletionModel.mockResolvedValue(assigned);

    await expect(resolveProfileSummaryModel("u_1")).resolves.toBe(assigned);
    expect(buildRoleCompletionModel).toHaveBeenCalledWith(
      prisma,
      "u_1",
      "profileSummary",
    );
  });

  it("falls back to the env/default model when the user has no assignment", async () => {
    vi.stubEnv("PROFILE_SUMMARY_MODEL", "");

    await expect(resolveProfileSummaryModel("u_1")).resolves.toEqual({
      modelId: DEFAULT_COMPLETION_MODEL,
    });
    expect(f.createCompletionModel).toHaveBeenCalledWith(DEFAULT_COMPLETION_MODEL);
  });

  it("keeps the PROFILE_SUMMARY_MODEL env var as the no-assignment default", async () => {
    vi.stubEnv("PROFILE_SUMMARY_MODEL", "openai/gpt-5-nano");

    await expect(resolveProfileSummaryModel("u_1")).resolves.toEqual({
      modelId: "openai/gpt-5-nano",
    });
    expect(f.createCompletionModel).toHaveBeenCalledWith("openai/gpt-5-nano");
  });
});
