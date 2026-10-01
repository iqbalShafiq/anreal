// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "#/lib/auth-client";

vi.mock("#/components/settings/settings-modal", () => ({
  SettingsModal: ({
    open,
    section,
    onSectionChange,
    onClose,
  }: {
    open: boolean;
    section: string;
    onSectionChange: (section: string) => void;
    onClose: () => void;
  }) => (
    <dialog open={open}>
      <p>{section} body</p>
      <button type="button" onClick={() => onSectionChange("account")}>
        nav account
      </button>
      <button type="button" onClick={() => onSectionChange("providers")}>
        nav providers
      </button>
      <button type="button" onClick={onClose}>
        Close settings
      </button>
    </dialog>
  ),
}));

import { SettingsDialogProvider, useSettingsDialog } from "./settings-dialog";

afterEach(cleanup);

const user: SessionUser = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
};

function EntryPoints() {
  const { openSettings } = useSettingsDialog();
  return (
    <>
      <button type="button" onClick={() => openSettings("providers")}>
        open providers
      </button>
      <button type="button" onClick={() => openSettings("account")}>
        open account
      </button>
    </>
  );
}

describe("SettingsDialogProvider", () => {
  it("keeps one dialog and shows the last requested section across openings", () => {
    render(
      <SettingsDialogProvider user={user}>
        <EntryPoints />
      </SettingsDialogProvider>,
    );

    // First open: the composer entry lands on Providers.
    fireEvent.click(screen.getByRole("button", { name: "open providers" }));
    expect(screen.getByText("providers body")).toBeTruthy();
    expect(screen.queryByText("account body")).toBeNull();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);

    // Second open while visible: the last requested section wins, no stale
    // section and no second dialog instance.
    fireEvent.click(screen.getByRole("button", { name: "open account" }));
    expect(screen.getByText("account body")).toBeTruthy();
    expect(screen.queryByText("providers body")).toBeNull();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);

    // The modal's own nav drives the same section state the provider owns.
    fireEvent.click(screen.getByRole("button", { name: "nav providers" }));
    expect(screen.getByText("providers body")).toBeTruthy();

    // Close, then reopen from the composer entry: still one dialog, still
    // Providers — nothing stale survives.
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "open providers" }));
    expect(screen.getByText("providers body")).toBeTruthy();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  });

  it("throws a clear error when used outside its provider", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Outside() {
      useSettingsDialog();
      return null;
    }
    expect(() => render(<Outside />)).toThrow(/SettingsDialogProvider/);
    errorSpy.mockRestore();
  });

  it("keeps openSettings identity stable across renders", () => {
    let captured: ReturnType<typeof useSettingsDialog>["openSettings"] | null =
      null;
    function Capture() {
      captured = useSettingsDialog().openSettings;
      return null;
    }
    const view = render(
      <SettingsDialogProvider user={user}>
        <Capture />
      </SettingsDialogProvider>,
    );
    const first = captured;
    view.rerender(
      <SettingsDialogProvider user={user}>
        <Capture />
      </SettingsDialogProvider>,
    );
    expect(captured).toBe(first);
  });
});
