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
