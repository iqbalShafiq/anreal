// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  createTask: vi.fn(),
  listSchedules: vi.fn(),
  cancelSchedule: vi.fn(),
}));

vi.mock("#/lib/api-artifacts", () => ({
  listTasks: mocks.listTasks,
  updateTask: mocks.updateTask,
  deleteTask: mocks.deleteTask,
  createTask: mocks.createTask,
  listSchedules: mocks.listSchedules,
  cancelSchedule: mocks.cancelSchedule,
}));

import { SchedulesPanel } from "./schedules-panel";
import { TasksPanel } from "./tasks-panel";

// jsdom has no <dialog> methods; ConfirmDialog uses showModal().
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute("open");
};

const task = {
  id: "t1",
  title: "Rencana",
  status: "inbox" as const,
  description: null,
  subtasks: [],
  sourceSessionId: null,
  dueAt: null,
  createdAt: "2026-09-26T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTasks.mockResolvedValue([task]);
  mocks.updateTask.mockResolvedValue(task);
  mocks.listSchedules.mockResolvedValue([
    {
      id: "s1",
      title: "Brief",
      freq: "once",
      nextRunAt: "2026-09-27T00:00:00.000Z",
      status: "active",
      createdAt: "2026-09-26T00:00:00.000Z",
      prompt: "x",
      projectId: null,
    },
  ]);
  mocks.cancelSchedule.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("tasks panel failure feedback", () => {
  it("surfaces a failed status update instead of failing silently", async () => {
    mocks.updateTask.mockRejectedValueOnce(new Error("Update failed"));
    render(<TasksPanel sessionId="s1" />);
    const doing = await screen.findByRole("button", { name: /mark rencana doing/i });
    await userEvent.click(doing);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Update failed");
  });

  it("exposes a doing control so the middle status is reachable", async () => {
    render(<TasksPanel sessionId="s1" />);
    const doing = await screen.findByRole("button", { name: /mark rencana doing/i });
    await userEvent.click(doing);
    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith("t1", { sessionId: "s1", status: "doing" }),
    );
  });
});

describe("schedules panel failure feedback", () => {
  it("surfaces a failed cancel instead of failing silently", async () => {
    mocks.cancelSchedule.mockRejectedValueOnce(new Error("Cancel failed"));
    render(<SchedulesPanel sessionId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: /cancel brief/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Cancel failed");
  });
});

/** A task carrying the checklist the expanded row renders. */
const checklistTask = {
  id: "t2",
  title: "Ship release",
  status: "doing" as const,
  description: "Cut the candidate build.",
  subtasks: [
    { id: "s1", title: "Write notes", done: true },
    { id: "s2", title: "Tag the build", done: false },
  ],
  sourceSessionId: null,
  dueAt: null,
  createdAt: "2026-09-26T00:00:00.000Z",
};

describe("tasks panel checklist presentation", () => {
  beforeEach(() => {
    mocks.listTasks.mockResolvedValue([checklistTask]);
  });

  async function expandChecklist() {
    render(<TasksPanel sessionId="s1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: /show details for ship release/i }),
    );
  }

  it("styles the subtask row and its affordances with the app's radius scale, not bare `rounded`", async () => {
    await expandChecklist();
    const checkbox = screen.getByRole("checkbox", { name: /mark subtask write notes not done/i });
    const remove = screen.getByRole("button", { name: /remove subtask write notes/i });
    const row = checkbox.closest("li");

    // The shared system: rows are rounded-lg, inline affordances rounded-md.
    expect(row?.className).toContain("rounded-lg");
    expect(checkbox.className).toContain("rounded-md");
    expect(remove.className).toContain("rounded-md");
    // The off-system bare `rounded` (4px) is gone from both affordances.
    expect(checkbox.className).not.toMatch(/(^|\s)rounded(\s|$)/);
    expect(remove.className).not.toMatch(/(^|\s)rounded(\s|$)/);
  });

  it("gives the row the hover surface and focus ring the sibling management rows use", async () => {
    await expandChecklist();
    const checkbox = screen.getByRole("checkbox", { name: /mark subtask write notes not done/i });
    const remove = screen.getByRole("button", { name: /remove subtask write notes/i });
    const row = checkbox.closest("li");

    expect(row?.className).toContain("hover:bg-white/[0.04]");
    expect(checkbox.className).toContain("focus-visible:ring-accent-ring");
    expect(remove.className).toContain("focus-visible:ring-accent-ring");
  });

  it("keeps the completed/aria semantics and the toggle payload intact", async () => {
    await expandChecklist();
    const done = screen.getByRole("checkbox", { name: /mark subtask write notes not done/i });
    const open = screen.getByRole("checkbox", { name: /mark subtask tag the build done/i });

    expect(done.getAttribute("aria-checked")).toBe("true");
    expect(open.getAttribute("aria-checked")).toBe("false");

    await userEvent.click(open);
    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith("t2", {
        sessionId: "s1",
        toggleSubtasks: [{ id: "s2", done: true }],
      }),
    );
  });
});
