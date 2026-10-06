import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Draft classification: a draft is a session the user has never sent a message
 * into — blank title AND zero agent memory messages. A titled session with
 * zero messages (a run that failed before persisting) is a real chat: it must
 * not be reused by `getOrCreateEmptyChatSession`, and must not be hard-deleted
 * as a duplicate draft.
 */
const mocks = vi.hoisted(() => {
  const tx = {
    documentSession: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    sessionImageContext: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    sessionContextSnippet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    agentUsageEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    agentMemorySession: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    chatSession: {
      deleteMany: vi.fn(
        async (_args: {
          where: { userId: string; id: { in: string[] } };
        }) => ({ count: 0 }),
      ),
    },
  };
  return {
    tx,
    chatSessionFindMany: vi.fn(),
    agentMemoryFindMany: vi.fn(),
    chatSessionFindFirst: vi.fn(),
    chatSessionCreate: vi.fn(),
    projectFindFirst: vi.fn(),
    documentFindMany: vi.fn(),
    documentSessionCreateMany: vi.fn(),
    transaction: vi.fn(
      async (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    ),
  };
});

vi.mock("../../utils/prisma.js", () => ({
  prisma: {
    chatSession: {
      findMany: mocks.chatSessionFindMany,
      findFirst: mocks.chatSessionFindFirst,
      create: mocks.chatSessionCreate,
    },
    agentMemorySession: { findMany: mocks.agentMemoryFindMany },
    project: { findFirst: mocks.projectFindFirst },
    document: { findMany: mocks.documentFindMany },
    documentSession: { createMany: mocks.documentSessionCreateMany },
    $transaction: mocks.transaction,
  },
}));

import {
  findEmptyChatSessions,
  getOrCreateEmptyChatSession,
  type ChatSessionRow,
} from "./chat-session.js";

const USER_ID = "user-1";

function row(
  id: string,
  title: string | null,
  updatedAtMs: number,
): ChatSessionRow {
  return {
    id,
    userId: USER_ID,
    projectId: null,
    title,
    createdAt: new Date(updatedAtMs),
    updatedAt: new Date(updatedAtMs),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agentMemoryFindMany.mockResolvedValue([]);
});

describe("findEmptyChatSessions", () => {
  it("excludes a titled session with zero messages", async () => {
    mocks.chatSessionFindMany.mockResolvedValue([
      row("failed-run", "Failed chat", 3000),
      row("blank-draft", null, 2000),
    ]);

    const empties = await findEmptyChatSessions(USER_ID, null);

    expect(empties.map((session) => session.id)).toEqual(["blank-draft"]);
  });

  it("excludes a blank-titled session that has messages", async () => {
    mocks.chatSessionFindMany.mockResolvedValue([
      row("legacy-with-messages", null, 3000),
      row("blank-draft", null, 2000),
    ]);
    mocks.agentMemoryFindMany.mockResolvedValue([
      { sessionId: "legacy-with-messages" },
    ]);

    const empties = await findEmptyChatSessions(USER_ID, null);

    expect(empties.map((session) => session.id)).toEqual(["blank-draft"]);
  });

  it("includes a blank-titled session with zero messages", async () => {
    mocks.chatSessionFindMany.mockResolvedValue([
      row("blank-draft", null, 3000),
    ]);

    const empties = await findEmptyChatSessions(USER_ID, null);

    expect(empties.map((session) => session.id)).toEqual(["blank-draft"]);
  });
});

describe("getOrCreateEmptyChatSession", () => {
  it("never deletes a titled zero-message session as a duplicate draft", async () => {
    mocks.chatSessionFindMany.mockResolvedValue([
      row("titled-failed", "Failed chat", 3000),
      row("blank-keeper", null, 2000),
      row("blank-older", null, 1000),
    ]);

    const session = await getOrCreateEmptyChatSession({ userId: USER_ID });

    expect(session.id).toBe("blank-keeper");
    // Only the older *blank* draft is pruned as a duplicate.
    expect(mocks.tx.chatSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ["blank-older"] } },
    });
    const deletedIds =
      mocks.tx.chatSession.deleteMany.mock.calls[0]?.[0]?.where?.id?.in ?? [];
    expect(deletedIds).not.toContain("titled-failed");
  });

  it("reuses a blank draft instead of the newer titled zero-message chat", async () => {
    mocks.chatSessionFindMany.mockResolvedValue([
      row("titled-failed", "Failed chat", 3000),
      row("blank-draft", null, 2000),
    ]);

    const session = await getOrCreateEmptyChatSession({ userId: USER_ID });

    expect(session.id).toBe("blank-draft");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("still prunes duplicate blank drafts", async () => {
    mocks.chatSessionFindMany.mockResolvedValue([
      row("blank-newer", null, 3000),
      row("blank-older", null, 1000),
    ]);

    const session = await getOrCreateEmptyChatSession({ userId: USER_ID });

    expect(session.id).toBe("blank-newer");
    expect(mocks.tx.chatSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ["blank-older"] } },
    });
  });
});
