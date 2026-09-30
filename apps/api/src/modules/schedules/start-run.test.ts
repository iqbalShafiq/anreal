import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  resolveRoleTarget: vi.fn(
    async (_db: unknown, _userId: string, _role: string): Promise<unknown> => null,
  ),
  resolveChatAgentRecipe: vi.fn(async (_input: unknown): Promise<unknown> => ({})),
  getChatSession: vi.fn(async (_userId: string, _sessionId: string): Promise<unknown> => ({})),
  touchChatSession: vi.fn(
    async (_userId: string, _sessionId: string): Promise<void> => undefined,
  ),
  enqueueChatRun: vi.fn(async (_jobId: string, _data: unknown): Promise<unknown> => ({
    accepted: true,
  })),
  releaseActiveRun: vi.fn(
    async (_sessionId: string, _streamId: string): Promise<void> => undefined,
  ),
  tryAcquireActiveRun: vi.fn(
    async (_sessionId: string, _streamId: string, _ttl?: number): Promise<boolean> => true,
  ),
  openWithMeta: vi.fn(async (_scope: unknown, _meta: unknown): Promise<void> => undefined),
  close: vi.fn(async (_input: unknown): Promise<void> => undefined),
}));

vi.mock("../models/roles.js", () => ({ resolveRoleTarget: f.resolveRoleTarget }));
vi.mock("../chat/build-run-input.js", () => ({
  resolveChatAgentRecipe: f.resolveChatAgentRecipe,
}));
vi.mock("../chat/chat-session.js", () => ({
  getChatSession: f.getChatSession,
  touchChatSession: f.touchChatSession,
}));
vi.mock("../chat/run-queue.js", () => ({
  ChatRunReconciliationError: class ChatRunReconciliationError extends Error {},
  enqueueChatRun: f.enqueueChatRun,
  releaseActiveRun: f.releaseActiveRun,
  tryAcquireActiveRun: f.tryAcquireActiveRun,
}));
vi.mock("../../lib/resumable-stream-store.js", () => ({
  getStreamStore: () => ({ openWithMeta: f.openWithMeta, close: f.close }),
}));
vi.mock("../../utils/prisma.js", () => ({ prisma: { __tag: "prisma" } }));

import { DEFAULT_COMPLETION_MODEL } from "@anreal/agent";
import { prisma } from "../../utils/prisma.js";
import { startScheduledChatRun } from "./start-run.js";

const INPUT = { userId: "u_1", sessionId: "s_1", prompt: "ringkas hari ini" };

describe("startScheduledChatRun model role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.resolveRoleTarget.mockResolvedValue(null);
    f.getChatSession.mockResolvedValue({});
    f.resolveChatAgentRecipe.mockResolvedValue({});
    f.tryAcquireActiveRun.mockResolvedValue(true);
  });

  it("uses the user's scheduledChat assignment for the recipe and the stream", async () => {
    f.resolveRoleTarget.mockResolvedValue({
      modelId: "openai/gpt-6-luna",
      connectionId: null,
    });

    const result = await startScheduledChatRun(INPUT);

    expect(result).toMatchObject({ status: "started" });
    expect(f.resolveRoleTarget).toHaveBeenCalledWith(prisma, "u_1", "scheduledChat");
    expect(f.resolveChatAgentRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u_1",
        sessionId: "s_1",
        model: "openai/gpt-6-luna",
      }),
    );
    expect(f.openWithMeta).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: expect.any(String) }),
      expect.objectContaining({
        userId: "u_1",
        sessionId: "s_1",
        modelId: "openai/gpt-6-luna",
      }),
    );
  });

  it("falls back to DEFAULT_COMPLETION_MODEL when the user has no assignment", async () => {
    f.resolveRoleTarget.mockResolvedValue(null);

    await startScheduledChatRun(INPUT);

    expect(f.resolveChatAgentRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_COMPLETION_MODEL }),
    );
    expect(f.openWithMeta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelId: DEFAULT_COMPLETION_MODEL }),
    );
  });
});
