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

describe("SelectOptionList: grid cards", () => {
  it("stacks icon, label and hint vertically in grid mode", () => {
    const options: SelectOption[] = [
      {
        value: "0",
        label: "Alpha",
        hint: "Vision • 1M context",
        icon: <span data-testid="icon-0" />,
      },
      { value: "1", label: "Beta", hint: "128K context" },
    ];
    const { buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options,
      onSelect: vi.fn(),
      layout: "grid",
      columns: 2,
    });

    // The row is a column: icon first, then the label/hint stack.
    expect(buttons[0].className).toContain("flex-col");
    expect(buttons[0].className).not.toContain("items-start gap-2");

    const [icon, stack] = Array.from(buttons[0].children) as HTMLElement[];
    // Icon on its own line at the top.
    expect(icon.querySelector('[data-testid="icon-0"]')).not.toBeNull();
    // Then the label, then the hint, inside the stacked text block.
    const label = stack.children[0] as HTMLElement;
    const hint = stack.children[1] as HTMLElement;
    expect(label.textContent).toBe("Alpha");
    expect(label.className).toContain("text-xs");
    expect(hint.textContent).toBe("Vision • 1M context");
    expect(hint.className).toContain("text-[10px]");
    // The label/hint keep their exact classes, so the only change is layout.
    expect(stack.className).toBe("flex min-w-0 flex-col gap-0.5");
  });

  it("keeps the list row horizontal and byte-identical (Select's default)", () => {
    const options: SelectOption[] = [
      { value: "0", label: "Alpha", hint: "128K context", icon: <span /> },
    ];
    const { buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options,
      onSelect: vi.fn(),
    });

    const expected =
      "flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 bg-white/[0.05]";
    expect(buttons[0].className).toBe(expected);
    // The icon and text block stay siblings on one horizontal row.
    expect(buttons[0].children[0].tagName).toBe("SPAN");
    expect(buttons[0].children[1].className).toBe(
      "flex min-w-0 flex-col gap-0.5",
    );
  });

  it("keeps role, aria-selected and click behaviour in grid mode", () => {
    const onSelect = vi.fn();
    const { list, buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect,
      layout: "grid",
      columns: 3,
    });

    const options = list.querySelectorAll('li[role="option"]');
    expect(options).toHaveLength(OPTIONS.length);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");

    fireEvent.click(buttons[2]);
    expect(onSelect).toHaveBeenCalledWith("2");
  });

  it("does not collapse a grid cell that has no icon", () => {
    const { buttons } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: [{ value: "0", label: "Alpha", hint: "128K context" }],
      onSelect: vi.fn(),
      layout: "grid",
      columns: 1,
    });

    // One child: the label/hint stack. No empty icon line to collapse.
    expect(buttons[0].children).toHaveLength(1);
    const stack = buttons[0].children[0] as HTMLElement;
    expect(stack.className).toBe("flex min-w-0 flex-col gap-0.5");
    expect(stack.children[0].textContent).toBe("Alpha");
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

describe("SelectOptionList: chromeless", () => {
  /** The card treatment the default render draws. */
  const CARD_TOKENS = [
    "rounded-xl",
    "border",
    "border-white/[0.08]",
    "bg-canvas-elevated",
    "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)]",
    "animate-fade-in",
  ];

  it("keeps every card class when the opt-out is not passed (Select's render)", () => {
    const { list } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
    });

    for (const token of CARD_TOKENS) {
      expect(list.className).toContain(token);
    }
    // And byte-for-byte, the pin the earlier round established.
    expect(list.className).toBe(BASE_LIST_CLASS);
  });

  it("draws no chrome when chromeless, keeping only the caller's classes", () => {
    const { list } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      chromeless: true,
      className: "chat-scroll overflow-y-auto px-2 pt-1",
    });

    for (const token of CARD_TOKENS) {
      expect(list.className).not.toContain(token);
    }
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("px-2");
    expect(list.className).toContain("pt-1");
  });

  it("keeps the grid layout classes while dropping the chrome", () => {
    const { list } = setup({
      id: "l",
      ariaLabel: "Options",
      value: "0",
      options: OPTIONS,
      onSelect: vi.fn(),
      layout: "grid",
      columns: 3,
      chromeless: true,
      className: "px-2 pt-1",
    });

    expect(list.className).toContain("grid");
    expect(list.className).toContain("gap-1");
    expect(list.className).not.toContain("bg-canvas-elevated");
    expect(list.className).not.toContain("animate-fade-in");
    expect(list.style.gridTemplateColumns).toContain("repeat(3");
  });
});
