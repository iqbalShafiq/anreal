// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PICKER_VIEW_KEY } from "#/lib/chat-preferences";
import type { ModelInfo, ReasoningEffortInfo } from "#/lib/api";
import { ModelReasoningSwitcher } from "./model-reasoning-switcher";

afterEach(cleanup);

/** Map-backed storage, so the stored view can be seeded and cannot leak. */
function createStorage() {
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", {
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
  });
  return { store: local };
}

beforeEach(() => {
  createStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Let the switcher's deferred document listeners attach. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Stub the shell's geometry and the viewport width. jsdom does no layout, so
 * `getBoundingClientRect` returns zeros unless we provide them; the switcher
 * sizes the panel from the shell's rect and `window.innerWidth`.
 */
function stubGeometry(shellWidth: number, viewportWidth: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: shellWidth,
    height: 32,
    top: 600,
    left: 100,
    right: 100 + shellWidth,
    bottom: 632,
    x: 100,
    y: 600,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: viewportWidth,
  });
}

/**
 * The portalled panel that carries the switcher's fixed positioning — it is
 * the element with `position: fixed` and a z-index, not the option listbox.
 */
function panelElement(): HTMLElement {
  const panel = document.querySelector<HTMLElement>(
    'div[style*="position: fixed"]',
  );
  if (!panel) throw new Error("panel not found");
  return panel;
}

/** The panel's computed width, in px (minWidth is what sizes it). */
function panelWidth(): number {
  return Number.parseFloat(panelElement().style.minWidth || "0");
}

const model: ModelInfo = {
  modelId: "custom-gateway/my-model",
  label: "My Model",
  name: "My Model",
  hint: null,
  description: null,
  iconSvg: "",
  provider: { slug: "custom-gateway", name: "Custom Gateway" },
  vendorLabel: null,
  contextWindowTokens: 128_000,
  maxInputTokens: null,
  maxOutputTokens: null,
  prices: {
    input: null,
    cachedInput: null,
    output: null,
    cacheWriteMultiplier: null,
    longPromptThresholdTokens: null,
    longPromptInputMultiplier: null,
    longPromptOutputMultiplier: null,
  },
  reasoningEfforts: ["max"],
  source: "connection",
  connectionId: "conn-1",
  outputType: "text",
  imageCapabilities: null,
  inputModalities: ["text"],
  sortOrder: 0,
};

const efforts: ReasoningEffortInfo[] = [
  { key: "max", label: "Max", description: null, sortOrder: 0 },
];

function renderSwitcher(onAddModel?: () => void) {
  const onModelChange = vi.fn();
  const onReasoningChange = vi.fn();
  render(
    <ModelReasoningSwitcher
      models={[model]}
      reasoningEfforts={efforts}
      model={model.modelId}
      reasoningEffort="max"
      onModelChange={onModelChange}
      onReasoningChange={onReasoningChange}
      onAddModel={onAddModel}
    />,
  );
  return { onModelChange, onReasoningChange };
}

describe("ModelReasoningSwitcher add-model entry", () => {
  it("opens the add flow without touching the model or reasoning effort", () => {
    const onAddModel = vi.fn();
    const { onModelChange, onReasoningChange } = renderSwitcher(onAddModel);

    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByText("Add a model…"));

    expect(onAddModel).toHaveBeenCalledOnce();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(onReasoningChange).not.toHaveBeenCalled();
  });

  it("adds no row when the entry is not wired", () => {
    renderSwitcher(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.queryByText("Add a model…")).toBeNull();
  });
});

describe("ModelReasoningSwitcher model menu: Esc clears before it closes", () => {
  it("keeps the menu open on Esc while a query can be cleared", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    const search = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "my" } });
    fireEvent.keyDown(search, { key: "Escape" });

    // Esc cleared the query; the menu is still open.
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("searchbox", { name: "Search models" })).toBeTruthy();
  });

  it("closes on Esc once there is nothing to clear", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    const search = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.keyDown(search, { key: "Escape" });

    expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull();
  });
});

describe("ModelReasoningSwitcher model menu: panel width follows the view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes the grid panel wider than the list panel for the same shell", async () => {
    stubGeometry(240, 1200);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    const listWidth = panelWidth();
    // Today's list width: max(184, shell) === 240.
    expect(listWidth).toBe(240);

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await flush();

    const gridWidth = panelWidth();
    // Grid: min(560, viewport - 16) === 560, and strictly wider than the list.
    expect(gridWidth).toBe(560);
    expect(gridWidth).toBeGreaterThan(listWidth);
  });

  it("resizes when the view toggles while the menu is open, without reopening", async () => {
    stubGeometry(240, 1200);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    expect(panelWidth()).toBe(240);
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await flush();
    expect(panelWidth()).toBe(560);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    await flush();
    expect(panelWidth()).toBe(240);
  });

  it("never exceeds the viewport on a narrow screen", async () => {
    stubGeometry(200, 400);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await flush();

    // min(560, 400 - 16) === 384, and it stays left-clamped inside 400px.
    expect(panelWidth()).toBe(384);
    const left = Number.parseFloat(panelElement().style.left || "0");
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + panelWidth()).toBeLessThanOrEqual(400);
  });

  it("opens directly in the stored grid view at the grid width", async () => {
    localStorage.setItem(MODEL_PICKER_VIEW_KEY, "grid");
    stubGeometry(240, 1200);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    expect(panelWidth()).toBe(560);
  });
});

describe("ModelReasoningSwitcher model menu: the action row meets the panel bottom", () => {
  it("carries no bottom padding that would band the action row's hover", async () => {
    renderSwitcher(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    // A `pb-1` here left a 4px strip below the action row the hover could not
    // fill; it is gone, so the row's hover reaches the panel's bottom edge.
    expect(panelElement().className).not.toContain("pb-");
  });
});

describe("ModelReasoningSwitcher model menu: the panel is clamped to the space above", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets a max-height on the panel so it cannot cross the viewport top", async () => {
    stubGeometry(240, 1200);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    // Opens upward from `top = shellRect.top - 8`; the clamp is that anchor
    // minus an 8px margin, so the panel can never extend past the viewport top.
    expect(panelElement().style.maxHeight).toBe("584px"); // 600 - 8 - 8
  });
});

describe("ModelReasoningSwitcher model menu: grid columns follow the panel width (I3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Grid column count, parsed from the `repeat(N, …)` track list the list sets
   * — the behavioural signal, not the CSS-redundant `data-columns`.
   */
  async function gridColumnCount(): Promise<number> {
    const list = screen.getByRole("listbox", { name: "Model" }) as HTMLUListElement;
    const match = /repeat\((\d+)/.exec(list.style.gridTemplateColumns);
    return match ? Number(match[1]) : 0;
  }

  it("shows three columns on a wide panel", async () => {
    stubGeometry(240, 1200);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await flush();

    // Panel 560 ≥ 480 → 3 columns, and it re-run after the toggle.
    await vi.waitFor(async () => expect(await gridColumnCount()).toBe(3));
  });

  it("shows two columns on a narrow panel", async () => {
    stubGeometry(200, 400);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await flush();

    // Panel 384 < 480 → 2 columns.
    await vi.waitFor(async () => expect(await gridColumnCount()).toBe(2));
  });

  it("recomputes the columns when the viewport resizes", async () => {
    stubGeometry(240, 1200);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await flush();
    await vi.waitFor(async () => expect(await gridColumnCount()).toBe(3));

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 400,
    });
    fireEvent(window, new Event("resize"));

    await vi.waitFor(async () => expect(await gridColumnCount()).toBe(2));
  });
});

describe("ModelReasoningSwitcher model menu: filters survive closing (I2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const twoModels: ModelInfo[] = [
    { ...model, modelId: "gateway/alpha", name: "Alpha", label: "Alpha" },
    { ...model, modelId: "gateway/beta", name: "Beta", label: "Beta" },
  ];

  function renderMany() {
    render(
      <ModelReasoningSwitcher
        models={twoModels}
        reasoningEfforts={efforts}
        model={twoModels[0].modelId}
        reasoningEffort="max"
        onModelChange={vi.fn()}
        onReasoningChange={vi.fn()}
      />,
    );
  }

  const optionCount = () =>
    document.querySelectorAll("button[data-option-value]").length;

  it("keeps the query and its active dot after close and reopen", async () => {
    renderMany();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    const search = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "alpha" } });
    expect(optionCount()).toBe(1);

    // Close via the trigger, then reopen.
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    // The query is still applied...
    expect((screen.getByRole("searchbox", { name: "Search models" }) as HTMLInputElement).value).toBe(
      "alpha",
    );
    expect(optionCount()).toBe(1);

    // ...and the Filter button still carries its active dot.
    const filterButton = screen.getByRole("button", { name: "Filter" });
    expect(filterButton.querySelector("span[aria-hidden]")).not.toBeNull();
  });
});

describe("ModelReasoningSwitcher model menu: aria wiring (I1)", () => {
  /** Elements carrying `id`, so uniqueness needs no CSS-selector escaping. */
  const elementsWithId = (id: string) =>
    [...document.querySelectorAll("[id]")].filter((element) => element.id === id);

  it("points the model trigger at the real model listbox, with one id", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    const modelList = screen.getByRole("listbox", { name: "Model" });
    expect(
      screen.getByRole("button", { name: "Model" }).getAttribute("aria-controls"),
    ).toBe(modelList.id);
    // The id lives on the listbox, exactly once — not on a wrapper too.
    expect(elementsWithId(modelList.id)).toHaveLength(1);
    expect(modelList.getAttribute("role")).toBe("listbox");
  });

  it("points the reasoning trigger at the real reasoning listbox, with one id", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Reasoning effort" }));
    await flush();

    const reasoningList = screen.getByRole("listbox", { name: "Reasoning effort" });
    expect(
      screen
        .getByRole("button", { name: "Reasoning effort" })
        .getAttribute("aria-controls"),
    ).toBe(reasoningList.id);
    expect(elementsWithId(reasoningList.id)).toHaveLength(1);
  });
});

describe("ModelReasoningSwitcher model menu: Esc keeps the sort (M6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the query on Esc without resetting the chosen sort", async () => {
    render(
      <ModelReasoningSwitcher
        models={[model]}
        reasoningEfforts={efforts}
        model={model.modelId}
        reasoningEffort="max"
        onModelChange={vi.fn()}
        onReasoningChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(
      screen.getByRole("button", { name: "Name" }).getAttribute("aria-pressed"),
    ).toBe("true");

    const search = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "my" } });
    fireEvent.keyDown(search, { key: "Escape" });

    // Query cleared, menu open, and the Name sort is still pressed.
    expect((search as HTMLInputElement).value).toBe("");
    expect(
      screen.getByRole("button", { name: "Name" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
