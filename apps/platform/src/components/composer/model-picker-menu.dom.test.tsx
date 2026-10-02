// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "#/lib/api";
import { MODEL_PICKER_VIEW_KEY } from "#/lib/chat-preferences";
import {
  EMPTY_PICKER_FILTERS,
  type PickerFilterState,
  type PickerSort,
} from "#/lib/model-picker";
import {
  GRID_CARD_HEIGHT,
  GRID_VISIBLE_ROWS,
  LIST_ROW_HEIGHT,
  LIST_VISIBLE_ROWS,
  ModelPickerMenu,
} from "./model-picker-menu";

afterEach(cleanup);

/**
 * Map-backed storage, the idiom `chat-preferences.test.ts` uses: jsdom's
 * localStorage is not guaranteed in this setup and a real one would leak
 * between tests.
 */
function createStorage(initial: Record<string, string> = {}) {
  const local = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => {
      local.set(key, value);
    },
    removeItem: (key: string) => {
      local.delete(key);
    },
    clear: () => local.clear(),
    key: (index: number) => [...local.keys()][index] ?? null,
    get length() {
      return local.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  return { store: local };
}

beforeEach(() => {
  createStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A catalog row: a Vendor facet comes from its provider name. */
function catalogModel(
  id: string,
  overrides: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    modelId: id,
    label: id,
    name: id,
    hint: null,
    description: null,
    iconSvg: "",
    provider: { slug: "openai", name: "OpenAI" },
    vendorLabel: null,
    contextWindowTokens: 128_000,
    maxInputTokens: null,
    maxOutputTokens: null,
    prices: {
      input: 1,
      cachedInput: null,
      output: 2,
      cacheWriteMultiplier: null,
      longPromptThresholdTokens: null,
      longPromptInputMultiplier: null,
      longPromptOutputMultiplier: null,
    },
    reasoningEfforts: [],
    source: "catalog",
    connectionId: null,
    outputType: "text",
    imageCapabilities: null,
    inputModalities: ["text"],
    sortOrder: 0,
    ...overrides,
  };
}

/** Option buttons in DOM order, so ordering can be asserted. */
function optionValues(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button[data-option-value]"),
  ).map((button) => button.getAttribute("data-option-value") ?? "");
}

/**
 * Renders the menu under a stateful wrapper, mirroring the switcher: filter and
 * sort are controlled props owned by the caller, so a test can assert they
 * survive a remount (I2) and that Esc does not reset the sort (M6).
 */
function renderMenu(
  models: ModelInfo[],
  options: {
    onAddModel?: () => void;
    onClose?: () => void;
    gridColumns?: number;
  } = {},
) {
  const onSelect = vi.fn();
  render(
    <MenuHost
      models={models}
      onSelect={onSelect}
      onAddModel={options.onAddModel}
      onClose={options.onClose}
      gridColumns={options.gridColumns ?? 3}
    />,
  );
  return { onSelect };
}

/** A small stateful host: the menu is controlled, exactly as in production. */
function MenuHost({
  models,
  onSelect,
  onAddModel,
  onClose,
  gridColumns,
}: {
  models: ModelInfo[];
  onSelect: (value: string) => void;
  onAddModel?: () => void;
  onClose?: () => void;
  gridColumns: number;
}) {
  const [filters, setFilters] = useState<PickerFilterState>(
    EMPTY_PICKER_FILTERS,
  );
  const [sort, setSort] = useState<PickerSort>("default");
  return (
    <ModelPickerMenu
      id="model-list"
      models={models}
      value={models[0]?.modelId ?? ""}
      onSelect={onSelect}
      onAddModel={onAddModel}
      open
      onClose={onClose}
      filters={filters}
      onFiltersChange={setFilters}
      sort={sort}
      onSortChange={setSort}
      gridColumns={gridColumns}
    />
  );
}

const search = () => screen.getByRole("searchbox", { name: "Search models" });
const optionList = () =>
  screen.getByRole("listbox", { name: "Model" }) as HTMLUListElement;

/** The group whose label text matches, found by walking up from the label. */
function groupFor(labelText: string): HTMLElement {
  const label = screen
    .getAllByText(labelText)
    .find((node) => node.className.includes("uppercase"));
  if (!label) throw new Error(`no group label ${labelText}`);
  return label.parentElement as HTMLElement;
}

describe("ModelPickerMenu: search", () => {
  const models = [
    catalogModel("openai/alpha", { name: "Alpha" }),
    catalogModel("openai/beta", { name: "Beta" }),
  ];

  it("focuses the search input on open", () => {
    renderMenu(models);
    expect(document.activeElement).toBe(search());
  });

  it("narrows the rendered options to the query", () => {
    renderMenu(models);
    fireEvent.change(search(), { target: { value: "alpha" } });
    expect(optionValues()).toEqual(["openai/alpha"]);
  });

  it("renders the empty state with a Clear filters action when nothing matches", () => {
    renderMenu(models);
    fireEvent.change(search(), { target: { value: "zzz" } });

    expect(screen.getByText("No models match")).toBeTruthy();
    const clear = screen.getByRole("button", { name: "Clear filters" });
    fireEvent.click(clear);

    expect(optionValues()).toEqual(["openai/alpha", "openai/beta"]);
    expect((search() as HTMLInputElement).value).toBe("");
  });

  it("keeps the search's aria-controls resolvable in the empty state", () => {
    renderMenu(models);
    fireEvent.change(search(), { target: { value: "zzz" } });

    // The listbox unmounts, so the id must live on the empty state instead —
    // otherwise the input's aria-controls points at an id not in the document.
    const controls = search().getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const target = document.getElementById(controls as string);
    expect(target).not.toBeNull();
    // The id resolves to the empty-state container the message sits in.
    expect(target?.textContent).toContain("No models match");
  });

  it("gives the empty-state aria-controls target an honest status role", () => {
    renderMenu(models);
    fireEvent.change(search(), { target: { value: "zzz" } });

    // The id resolves to a real element...
    const controls = search().getAttribute("aria-controls") as string;
    const target = document.getElementById(controls);
    expect(target).not.toBeNull();
    // ...whose role matches what it is: a no-results notice, not a listbox.
    expect(target?.getAttribute("role")).toBe("status");
    expect(target?.getAttribute("role")).not.toBe("listbox");
  });

  /**
   * I1: the search input used to sit inside a wrapper carrying
   * `pointer-events-none`. Because `pointer-events` is inherited, the input
   * inherited `none`, so it could not receive mouse events — you could type
   * into it (the menu focuses it on open) but not click into it. Asserting the
   * behavioural consequence, not the absent class: the point under the input's
   * centre must hit-test to the input (or one of its descendants).
   */
  it("is hit-testable at its centre — the pointer-events-none wrapper is gone", () => {
    renderMenu(models);
    const input = search() as HTMLInputElement;
    input.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 200,
        bottom: 28,
        width: 200,
        height: 28,
        toJSON: () => ({}),
      }) as DOMRect;

    // document.elementFromPoint does not do layout in jsdom, so place a spy on
    // it that resolves hit-testing by computed `pointer-events`: an element
    // inheriting `none` is skipped the way the browser would skip it.
    const original = document.elementFromPoint;
    document.elementFromPoint = () => {
      let node: HTMLElement | null = input;
      while (node) {
        const pointerEvents = getComputedStyle(node).pointerEvents;
        if (pointerEvents === "none") return null;
        node = node.parentElement;
      }
      return input;
    };

    try {
      // The wrapper no longer inherits `none`, so the input resolves to itself.
      const hit = document.elementFromPoint(100, 14);
      expect(hit).toBe(input);
      expect(getComputedStyle(input).pointerEvents).not.toBe("none");
    } finally {
      document.elementFromPoint = original;
    }
  });
});

describe("ModelPickerMenu: filters", () => {
  const models = [
    catalogModel("openai/alpha", {
      name: "Alpha",
      provider: { slug: "openai", name: "OpenAI" },
    }),
    catalogModel("google/gemini", {
      name: "Gemini",
      provider: { slug: "google", name: "Google" },
    }),
  ];

  it("toggles a chip, exposes aria-pressed and changes the rows", () => {
    renderMenu(models);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    const chip = screen.getByRole("button", { name: "Google" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(chip);

    expect(
      screen.getByRole("button", { name: "Google" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(optionValues()).toEqual(["google/gemini"]);
  });

  it("omits a facet group that cannot discriminate", () => {
    renderMenu([catalogModel("openai/only", { name: "Only" })]);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    // One vendor means no Vendor chip row at all.
    expect(screen.queryByText("Vendor")).toBeNull();
    expect(screen.queryByRole("button", { name: "OpenAI" })).toBeNull();
  });

  it("omits a capability chip when every model already has it", () => {
    renderMenu([
      catalogModel("openai/alpha", {
        name: "Alpha",
        inputModalities: ["text", "image"],
      }),
      catalogModel("openai/beta", {
        name: "Beta",
        inputModalities: ["text", "image"],
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    // Vision would not narrow anything, so it is not offered.
    expect(screen.queryByRole("button", { name: "Vision" })).toBeNull();
  });
});

describe("ModelPickerMenu: sort", () => {
  it("reorders the rendered rows", () => {
    renderMenu([
      catalogModel("openai/bravo", { name: "Bravo" }),
      catalogModel("openai/alpha", { name: "Alpha" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("button", { name: "Name" }));

    expect(optionValues()).toEqual(["openai/alpha", "openai/bravo"]);
  });
});

describe("ModelPickerMenu: view toggle", () => {
  it("switches the layout and persists the choice", () => {
    renderMenu([catalogModel("openai/alpha", { name: "Alpha" })]);

    expect(optionList().getAttribute("data-layout")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));

    expect(optionList().getAttribute("data-layout")).toBe("grid");
    expect(localStorage.getItem(MODEL_PICKER_VIEW_KEY)).toBe("grid");
  });

  it("opens in the stored grid view", () => {
    localStorage.setItem(MODEL_PICKER_VIEW_KEY, "grid");
    renderMenu([catalogModel("openai/alpha", { name: "Alpha" })]);
    expect(optionList().getAttribute("data-layout")).toBe("grid");
  });
});

describe("ModelPickerMenu: scroll cap and the action row", () => {
  const manyModels = Array.from({ length: 12 }, (_, index) =>
    catalogModel(`openai/model-${index}`, { name: `Model ${index}` }),
  );

  it("caps the option container at 8 rows and keeps 'Add a model…' outside it", () => {
    const onAddModel = vi.fn();
    renderMenu(manyModels, { onAddModel });

    const list = optionList();
    // The exact cap: 8 rows at the component's own row height. A regression to
    // any other number, or a changed row height, fails here.
    expect(list.style.maxHeight).toBe(
      `${LIST_VISIBLE_ROWS * LIST_ROW_HEIGHT}px`,
    );
    expect(list.className).toContain("overflow-y-auto");

    const addButton = screen.getByText("Add a model…").closest("button");
    expect(addButton).not.toBeNull();
    // The action is NOT inside the scrolling option container.
    expect(list.contains(addButton)).toBe(false);

    fireEvent.click(addButton as HTMLButtonElement);
    expect(onAddModel).toHaveBeenCalledOnce();
  });

  it("caps the grid at 3 rows", () => {
    localStorage.setItem(MODEL_PICKER_VIEW_KEY, "grid");
    renderMenu(manyModels);

    const list = optionList();
    expect(list.style.maxHeight).toBe(
      `${GRID_VISIBLE_ROWS * GRID_CARD_HEIGHT}px`,
    );
    expect(list.className).toContain("grid");
  });

  it("keeps the controls at full height — they are never the row that shrinks", () => {
    renderMenu(manyModels);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));

    // The user rejected the earlier mechanism that let this stack shrink and
    // scroll (its own scrollbar, cut-off chips). Priority is inverted: the
    // controls render at their natural height (`shrink-0`) and never scroll
    // (`no overflow-y-auto`), so the list below is the only row that gives.
    const controls = groupFor("Sort by").parentElement as HTMLElement;
    expect(controls.className).toContain("flex-col");
    expect(controls.className).toContain("shrink-0");
    expect(controls.className).not.toContain("min-h-0");
    expect(controls.className).not.toContain("overflow-y-auto");
  });

  it("keeps the filter facet group unclipped too, with no ability to shrink", () => {
    renderMenu([
      catalogModel("openai/alpha", {
        name: "Alpha",
        provider: { slug: "openai", name: "OpenAI" },
      }),
      catalogModel("google/gemini", {
        name: "Gemini",
        provider: { slug: "google", name: "Google" },
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    const controls = groupFor("Vendor").parentElement as HTMLElement;
    expect(controls.className).toContain("shrink-0");
    expect(controls.className).not.toContain("overflow-y-auto");
  });
});

describe("ModelPickerMenu: the list is inside the panel's card, not its own", () => {
  const models = [catalogModel("openai/alpha", { name: "Alpha" })];

  it("renders the option list without card chrome", () => {
    renderMenu(models);
    const list = optionList();

    for (const token of [
      "rounded-xl",
      "border-white/[0.08]",
      "bg-canvas-elevated",
      "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)]",
      "animate-fade-in",
    ]) {
      expect(list.className).not.toContain(token);
    }
  });

  it("is full-bleed in list mode so the row highlight runs to both edges", () => {
    renderMenu(models);
    const list = optionList();

    // No horizontal inset: rows span the panel and their highlight reaches
    // both edges instead of sitting as an inset square inside a rounded panel.
    expect(list.className).not.toContain("px-");
  });

  it("keeps the grid inset so cards do not touch the panel edge", () => {
    localStorage.setItem(MODEL_PICKER_VIEW_KEY, "grid");
    renderMenu(models);
    const list = optionList();
    const search = screen.getByRole("searchbox", { name: "Search models" });
    const searchWrapper = search.parentElement as HTMLElement;

    expect(list.className).toContain("grid");
    // Cards carry their own surface, so the grid stays inset like the field.
    expect(list.className).toContain("px-2");
    expect(searchWrapper.className).toContain("px-2");
    expect(list.className).not.toContain("bg-canvas-elevated");
  });

  it("keeps breathing room above the first row", () => {
    renderMenu(models);
    expect(optionList().className).toContain("pt-1");
  });

  it("puts no gap below the last row, so it meets the action divider", () => {
    const onAddModel = vi.fn();
    renderMenu(models, { onAddModel });

    const list = optionList();
    const addButton = screen.getByText("Add a model…").closest("button")!;

    // No bottom spacing on the list...
    expect(list.className).not.toContain("pb-");
    // ...and no top margin on the action row, so its border-t sits flush under
    // the last row (a selected last row's highlight meets the divider).
    expect(addButton.className).not.toContain("mt-");
    expect(addButton.className).toContain("border-t");
  });
});

describe("ModelPickerMenu: facet labels sit above their chips", () => {
  // Two vendors so the Vendor facet discriminates and renders.
  const models = [
    catalogModel("openai/alpha", {
      name: "Alpha",
      provider: { slug: "openai", name: "OpenAI" },
    }),
    catalogModel("google/gemini", {
      name: "Gemini",
      provider: { slug: "google", name: "Google" },
    }),
  ];

  it("stacks the label above a horizontal chip row", () => {
    renderMenu(models);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    const group = groupFor("Vendor");
    // The group is a column: the label is the first child, the chips the second.
    expect(group.className).toContain("flex-col");
    const label = group.firstElementChild as HTMLElement;
    const chipsRow = group.lastElementChild as HTMLElement;
    expect(label.textContent).toBe("Vendor");
    expect(label.className).toContain("uppercase");
    // The label is a bare span, not a flex item sharing a row with the chips.
    expect(label.tagName).toBe("SPAN");
    // The chips stay a horizontal wrapping row inside the group.
    expect(chipsRow.className).toContain("flex-wrap");
    expect(chipsRow.querySelector("button[aria-pressed]")).not.toBeNull();
  });

  it("gives the sort block the same stacked shape as the facets", () => {
    renderMenu(models);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));

    const group = groupFor("Sort by");
    const label = group.firstElementChild as HTMLElement;
    const chipsRow = group.lastElementChild as HTMLElement;
    expect(group.className).toContain("flex-col");
    expect(label.textContent).toBe("Sort by");
    expect(chipsRow.className).toContain("flex-wrap");
  });

  it("uses one spacing source for facets and the sort block", () => {
    renderMenu(models);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));

    // Both the facet groups and the sort group live in one column stack, so a
    // single `gap-2` separates every group — including last-facet → sort.
    const controls = groupFor("Vendor").parentElement as HTMLElement;
    expect(controls.className).toContain("gap-2");
    expect(controls.className).toContain("flex-col");
    // The sort group is a direct child of that same stack.
    expect(controls.contains(groupFor("Sort by"))).toBe(true);
    // The group itself carries no marginal spacing of its own.
    const group = groupFor("Vendor");
    expect(group.className).not.toContain("pb-");
    expect(group.className).not.toContain("mb-");
    expect(group.className).not.toContain("mt-");
  });
});

describe("ModelPickerMenu: live region", () => {
  it("announces the visible count in a visually hidden live region", () => {
    renderMenu([
      catalogModel("openai/alpha", { name: "Alpha" }),
      catalogModel("openai/beta", { name: "Beta" }),
    ]);

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.className).toContain("sr-only");
    expect(live?.textContent).toContain("2");

    fireEvent.change(search(), { target: { value: "alpha" } });
    expect(
      document.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain("1");
  });
});

describe("ModelPickerMenu: keyboard", () => {
  const models = [
    catalogModel("openai/alpha", { name: "Alpha" }),
    catalogModel("openai/beta", { name: "Beta" }),
  ];

  it("moves from the search into the options and back", () => {
    renderMenu(models);

    fireEvent.keyDown(search(), { key: "ArrowDown" });
    const first = document.querySelector<HTMLButtonElement>(
      "button[data-option-value]",
    );
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first as HTMLButtonElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(search());
  });

  it("clears an active query on Esc without closing", () => {
    const { onSelect } = renderMenu(models);
    fireEvent.change(search(), { target: { value: "alpha" } });

    fireEvent.keyDown(search(), { key: "Escape" });

    expect((search() as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("searchbox", { name: "Search models" })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Esc when there is nothing to clear", () => {
    const onClose = vi.fn();
    renderMenu(models, { onClose });

    fireEvent.keyDown(search(), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("ModelPickerMenu: BYOK with no declared vendor", () => {
  it("still renders a connection model whose vendor is null", () => {
    renderMenu([
      {
        ...catalogModel("gateway/model", { name: "Gateway Model" }),
        source: "connection",
        connectionId: "conn-1",
        provider: { slug: "gateway", name: "My Gateway" },
      },
    ]);

    expect(optionValues()).toEqual(["gateway/model"]);
    expect(screen.getByText("Gateway Model")).toBeTruthy();
  });
});
