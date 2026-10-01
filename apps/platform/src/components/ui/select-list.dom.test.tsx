// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelectOptionList, type SelectOption } from "./select-list";

afterEach(cleanup);

/**
 * The exact class string the list rendered before `layout`/`columns` existed,
 * including the trailing space with no caller `className`. The default path
 * must keep producing this byte for byte.
 */
const BASE_LIST_CLASS =
  "chat-scroll overflow-hidden rounded-xl border border-white/[0.08] bg-canvas-elevated text-text shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] animate-fade-in ";

const OPTIONS: SelectOption[] = [
  { value: "0", label: "Zero" },
  { value: "1", label: "One" },
  { value: "2", label: "Two" },
  { value: "3", label: "Three" },
  { value: "4", label: "Four" },
  { value: "5", label: "Five" },
  { value: "6", label: "Six" },
  { value: "7", label: "Seven" },
  { value: "8", label: "Eight" },
];

/** Renders the list and returns it plus its option buttons in DOM order. */
function setup(props: Parameters<typeof SelectOptionList>[0]) {
  render(<SelectOptionList {...props} />);
  const list = screen.getByRole("listbox", { name: "Options" }) as HTMLUListElement;
  const buttons = Array.from(
    list.querySelectorAll<HTMLButtonElement>("button[data-option-value]"),
  );
  return { list, buttons };
}

function focusFirst(buttons: HTMLButtonElement[]) {
  buttons[0].focus();
}

describe("SelectOptionList: default (no layout prop) is byte-identical", () => {
  it("renders today's container class and no grid attributes", () => {
    const { list } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
    });

    // Select passes neither prop, so this exact class string is the regression
    // pin: a grid-aware default would break every generic dropdown.
    expect(list.className).toBe(BASE_LIST_CLASS);
    expect(list.getAttribute("data-layout")).toBeNull();
    expect(list.getAttribute("data-columns")).toBeNull();
  });

  it("forwards style/className untouched in list mode", () => {
    const { list } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      className: "overflow-y-auto",
      style: { maxHeight: 208 },
    });

    expect(list.className).toBe(`${BASE_LIST_CLASS}overflow-y-auto`);
    expect(list.style.maxHeight).toBe("208px");
  });

  it("does not move focus itself in list mode (Select owns the keys)", () => {
    const onKeyDown = vi.fn();
    const { list, buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      onKeyDown,
    });

    focusFirst(buttons);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowRight" });

    // The external handler is called, but the component stays inert so a
    // caller's own arrow logic cannot be applied twice.
    expect(onKeyDown).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe("SelectOptionList: grid layout", () => {
  it("reports its layout and column count on the same listbox", () => {
    const { list } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      layout: "grid",
      columns: 3,
    });

    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("data-layout")).toBe("grid");
    expect(list.getAttribute("data-columns")).toBe("3");
    expect(list.className).toContain("grid");
    expect(list.querySelectorAll('li[role="option"]')).toHaveLength(OPTIONS.length);
  });

  it("moves down a row and right a card, with column-aware keys", () => {
    const { list, buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      layout: "grid",
      columns: 3,
    });

    focusFirst(buttons);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[3]);

    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);

    // Left at the first card clamps rather than wrapping.
    buttons[0].focus();
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("behaves like a one-row list when columns is 1", () => {
    const { list, buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      layout: "grid",
      columns: 1,
    });

    focusFirst(buttons);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("skips a disabled card when moving", () => {
    const options: SelectOption[] = OPTIONS.map((opt) =>
      opt.value === "3" ? { ...opt, disabled: true } : opt,
    );
    const { list, buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options,
      onSelect: vi.fn(),
      layout: "grid",
      columns: 3,
    });

    focusFirst(buttons);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    // Row-down from 0 lands on 3, which is disabled — focus advances to 4.
    expect(document.activeElement).toBe(buttons[4]);
  });
});

describe("SelectOptionList: scroll cap", () => {
  it("applies maxHeight from style and keeps the list scrollable", () => {
    const { list } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      layout: "grid",
      columns: 3,
      className: "overflow-y-auto",
      style: { maxHeight: 312 },
    });

    expect(list.style.maxHeight).toBe("312px");
    expect(list.className).toContain("overflow-y-auto");
  });

  it("exposes the listbox ref to its caller", () => {
    const ref = createRef<HTMLUListElement>();
    render(
      <SelectOptionList
        ref={ref}
        id="l"
        ariaLabel="Options"
        value="0"
        options={OPTIONS}
        onSelect={vi.fn()}
      />,
    );
    expect(ref.current?.getAttribute("role")).toBe("listbox");
  });
});
