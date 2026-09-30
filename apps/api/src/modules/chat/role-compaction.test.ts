import { beforeEach, describe, expect, it, vi } from "vitest";

const roles = vi.hoisted(() => ({
  resolveRoleTarget: vi.fn(
    async (_db: unknown, _userId: string, _role: string): Promise<unknown> => null,
  ),
  buildRoleCompletionModel: vi.fn(
    async (_db: unknown, _userId: string, _role: string): Promise<unknown> => null,
  ),
}));

vi.mock("../models/roles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../models/roles.js")>()),
  resolveRoleTarget: roles.resolveRoleTarget,
  buildRoleCompletionModel: roles.buildRoleCompletionModel,
}));

import type { CompletionModel } from "@anvia/core";
import { resolveChatCompactorModel } from "./build-run-input.js";

const CHAT_MODEL = { __tag: "chat" } as unknown as CompletionModel;
const ASSIGNED_MODEL = { __tag: "assigned" } as unknown as CompletionModel;

const CHAT_SHAPE = { kind: "openai" as const, api: "responses" as const };

function makeDb(
  findFirst: (args: unknown) => Promise<unknown> = async () => null,
) {
  return { providerConnection: { findFirst: vi.fn(findFirst) } } as never;
}

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveChatCompactorModel({
    db: makeDb(),
    userId: "u_1",
    chatModel: CHAT_MODEL,
    chatShape: CHAT_SHAPE,
    reasoningEffort: "high",
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  roles.resolveRoleTarget.mockResolvedValue(null);
  roles.buildRoleCompletionModel.mockResolvedValue(null);
});

describe("memory compaction role", () => {
  it("falls back to the chat model with the chat provider's options when there is no assignment", async () => {
    const db = makeDb();
    const result = await resolve({ db });

    expect(result.model).toBe(CHAT_MODEL);
    expect(result.source).toBe("chat");
    expect(result.providerOptions).toEqual({
      reasoning: { effort: "high", summary: "auto" },
    });
    // The no-assignment path must not consult a compactor connection.
    expect(
      (db as { providerConnection: { findFirst: unknown } }).providerConnection
        .findFirst,
    ).not.toHaveBeenCalled();
  });

  it("uses the assigned model and shapes its options for the assigned provider", async () => {
    roles.resolveRoleTarget.mockResolvedValue({
      modelId: "byok/gpt-luna",
      connectionId: "conn_1",
    });
    roles.buildRoleCompletionModel.mockResolvedValue(ASSIGNED_MODEL);
    const result = await resolve({
      db: makeDb(async () => ({ kind: "openai", api: "chat" })),
    });

    expect(result.model).toBe(ASSIGNED_MODEL);
    expect(result.source).toBe("assignment");
    // Chat options would be the Responses shape; the assigned provider speaks
    // Chat Completions, so the chat model's shape must not be reused.
    expect(result.providerOptions).toEqual({ reasoning_effort: "high" });
  });

  it("falls back to the chat model when the assigned connection vanished", async () => {
    roles.resolveRoleTarget.mockResolvedValue({
      modelId: "byok/gpt-luna",
      connectionId: "conn_gone",
    });
    roles.buildRoleCompletionModel.mockResolvedValue(null);

    const result = await resolve();

    expect(result.model).toBe(CHAT_MODEL);
    expect(result.source).toBe("chat");
    expect(result.providerOptions).toEqual({
      reasoning: { effort: "high", summary: "auto" },
    });
  });
});
