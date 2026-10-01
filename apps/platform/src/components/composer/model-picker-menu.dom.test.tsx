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

  it("insets the list to the search field's left edge, with a gap above the first row", () => {
    renderMenu(models);
    const list = optionList();
    const search = screen.getByRole("searchbox", { name: "Search models" });
    // The search field's own wrapper carries the px-2 inset.
    const searchWrapper = search.parentElement as HTMLElement;

    // The list is inset horizontally like the search row...
    expect(list.className).toContain("px-2");
    // ...and left-aligned with it: both declare the same left padding token.
    expect(searchWrapper.className).toContain("px-2");
    // ...and has breathing room under the search.
    expect(list.className).toContain("pt-1");
  });

  it("keeps the inset in grid mode too", () => {
    localStorage.setItem(MODEL_PICKER_VIEW_KEY, "grid");
    renderMenu(models);
    const list = optionList();

    expect(list.className).toContain("grid");
    expect(list.className).toContain("px-2");
    expect(list.className).not.toContain("bg-canvas-elevated");
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
