// @vitest-environment jsdom
import { useRef, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "#/lib/auth-client";

vi.mock("#/hooks/use-models", () => ({
  useModels: () => ({
    models: [],
    reasoningEfforts: [],
    status: "success",
    error: null,
    retry: () => undefined,
  }),
}));

vi.mock("#/hooks/use-profile", () => ({
  useProfilePersonalization: () => ({
    data: null,
    loading: false,
    error: null,
    resetting: null,
    resetUser: vi.fn(),
    resetProject: vi.fn(),
  }),
}));

vi.mock("#/components/settings/providers-section", () => ({
  ProvidersSection: ({
    onDetailChange,
  }: {
    onDetailChange?: (detail: { onBack: () => void } | null) => void;
  }) => (
    <div>
      <p>Providers body</p>
      <button
        type="button"
        onClick={() =>
          onDetailChange?.({ onBack: () => onDetailChange(null) })
        }
      >
        enter provider detail
      </button>
    </div>
  ),
}));

vi.mock("#/components/settings/personalization-section", () => ({
  PersonalizationSection: () => <p>Personalization body</p>,
}));

vi.mock("#/components/settings/model-roles-section", () => ({
  ModelRolesSection: () => <p>Model roles body</p>,
}));

vi.mock("#/components/chat/inset-scrollbar", () => ({
  InsetScrollbar: () => null,
}));

import { SettingsDialogProvider, useSettingsDialog } from "./settings-dialog";

beforeAll(() => {
  // jsdom 30 ships an empty HTMLDialogElement (only the reflected `open`
  // attribute). Supply the two lifecycle calls SettingsModal uses so its real
  // close listener runs. The `close` event is what drives focus restoration.
  window.HTMLDialogElement.prototype.showModal = function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  // jsdom has no element scrolling; the modal resets it per section.
  Element.prototype.scrollTo = () => undefined;
  // Deterministic: run the modal's post-open focus frame synchronously.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

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

function renderProvider(children: ReactNode = <EntryPoints />) {
  return render(
    <SettingsDialogProvider user={user}>{children}</SettingsDialogProvider>,
  );
}

describe("SettingsDialogProvider", () => {
  it("keeps one dialog and shows the last requested section across openings", () => {
    renderProvider();

    // First open: the composer entry lands on Providers.
    fireEvent.click(screen.getByRole("button", { name: "open providers" }));
    expect(screen.getByText("Providers body")).toBeTruthy();
    expect(screen.queryByText("Model roles body")).toBeNull();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);

    // Second open while visible: the last requested section wins, no stale
    // section and no second dialog instance.
    fireEvent.click(screen.getByRole("button", { name: "open account" }));
    expect(screen.getByText("Model roles body")).toBeTruthy();
    expect(screen.queryByText("Providers body")).toBeNull();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);

    // Close, then reopen from the composer entry: still one dialog, still
    // Providers — nothing stale survives.
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "open providers" }));
    expect(screen.getByText("Providers body")).toBeTruthy();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  });

  it("swaps the section nav for a single Back item while a provider detail is open", () => {
    renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "open providers" }));
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "enter provider detail" }),
    );

    // The whole section nav is replaced by one Back entry.
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Providers" })).toBeNull();
    const back = screen.getByRole("button", { name: "Back" });

    fireEvent.click(back);
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("returns focus to the trigger supplied to openSettings on close", () => {    function FocusEntry() {
      const { openSettings } = useSettingsDialog();
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => openSettings("account", triggerRef.current)}
        >
          focus entry
        </button>
      );
    }
    renderProvider(<FocusEntry />);

    const trigger = screen.getByRole("button", { name: "focus entry" });
    fireEvent.click(trigger);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(document.activeElement).toBe(trigger);
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
    const view = renderProvider(<Capture />);
    const first = captured;
    view.rerender(
      <SettingsDialogProvider user={user}>
        <Capture />
      </SettingsDialogProvider>,
    );
    expect(captured).toBe(first);
  });
});
