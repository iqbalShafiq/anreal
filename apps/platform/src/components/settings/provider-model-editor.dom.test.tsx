// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prefillProviderModel,
  type ListedProviderModel,
  type ModelInfo,
  type ProviderModelRow,
} from "#/lib/api";
import { ProviderModelEditor } from "./provider-model-editor";

vi.mock("#/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/lib/api")>();
  return { ...actual, prefillProviderModel: vi.fn() };
});

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(prefillProviderModel).mockReset();
});

/** A merged-catalog row, reduced to the fields this test's editor reads. */
function catalogRow(vendorLabel: string | null): ModelInfo {
  return {
    modelId: `x/${vendorLabel ?? "none"}`,
    label: "Row",
    name: "Row",
    hint: null,
    description: null,
    iconSvg: "",
    provider: { slug: "seed", name: "Seed" },
    vendorLabel,
    contextWindowTokens: 0,
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
    reasoningEfforts: [],
    source: "catalog",
    connectionId: null,
    outputType: "text",
    imageCapabilities: null,
    inputModalities: [],
    sortOrder: 0,
  };
}

const IMAGE_LIMITS = {
  nMax: 1,
  sizing: "resolutions" as const,
  supportsQuality: false,
  supportsBackground: false,
  representableAspectRatios: null,
};

function renderEditor(input: {
  initial?: ProviderModelRow | null;
  models?: ModelInfo[];
  imageLimits?: typeof IMAGE_LIMITS | null;
  effortVocabulary?: string[];
  onDiscover?: () => Promise<ListedProviderModel[]>;
  connectionLabel?: string;
}) {
  return render(
    <ProviderModelEditor
      connectionId="conn-1"
      connectionSlug="gw"
      connectionLabel={input.connectionLabel ?? "My gateway"}
      imageStyle={input.imageLimits ? "openrouter-images" : "none"}
      imageLimits={input.imageLimits ?? null}
      effortVocabulary={input.effortVocabulary ?? ["low"]}
      models={input.models ?? []}
      initial={input.initial ?? null}
      saving={false}
      onSave={async () => undefined}
      onCancel={() => undefined}
      onDiscover={input.onDiscover ?? (async () => [])}
    />,
  );
}

/** Switch the editor from Discover to "Enter an id" so the id field shows. */
function chooseCustomMode() {
  fireEvent.click(screen.getByRole("button", { name: /Model source/ }));
  fireEvent.click(screen.getByRole("button", { name: "Enter an id" }));
}

describe("ProviderModelEditor — the vendor field", () => {
  it("offers the vendor field for a text model", () => {
    renderEditor({});
    expect(screen.getByLabelText(/Vendor/)).toBeTruthy();
  });

  it("offers the vendor field for an image model too", () => {
    // A vendor is a property of the model, not of its output type.
    renderEditor({
      imageLimits: IMAGE_LIMITS,
      initial: {
        id: "m1",
        slug: "gw/img",
        upstreamId: "openai/gpt-image-1",
        name: "GPT Image",
        label: "GPT Image",
        hint: null,
        description: null,
        vendorLabel: null,
        iconSvg: "",
        outputType: "image",
        contextWindowTokens: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        reasoningEfforts: [],
        capabilities: null,
        imageCapabilities: null,
        isActive: true,
        sortOrder: 0,
        connectionId: "conn-1",
        createdAt: "",
        updatedAt: "",
      },
    });
    expect(screen.getByLabelText(/Vendor/)).toBeTruthy();
  });

  it("says plainly the vendor is a filter label and does not affect routing", () => {
    renderEditor({});
    expect(screen.getByText(/does not affect routing/i)).toBeTruthy();
  });

  it("uses no native autocomplete popup — no list/datalist is attached", () => {
    // The in-app `Suggested:` button carries the affordance; a native datalist
    // popup is browser-chrome styled and honours none of the app's tokens.
    const { container } = renderEditor({ models: [catalogRow("OpenAI")] });
    const vendor = screen.getByLabelText(/Vendor/) as HTMLInputElement;
    expect(vendor.getAttribute("list")).toBeNull();
    expect(container.querySelector("datalist")).toBeNull();
  });

  it("names a known vendor as an example in the helper line", () => {
    renderEditor({ models: [catalogRow("OpenAI")] });
    expect(screen.getByText(/e\.g\. OpenAI/)).toBeTruthy();
  });

  it("suggests a known vendor from the id prefix but does not apply it", () => {
    renderEditor({ models: [catalogRow("OpenAI")] });
    chooseCustomMode();
    const vendor = screen.getByLabelText(/Vendor/) as HTMLInputElement;
    const id = screen.getByLabelText("Model id") as HTMLInputElement;

    fireEvent.change(id, { target: { value: "openai/gpt-5.6-luna" } });
    // The prefix names a known vendor, so a suggestion is offered…
    expect(screen.getByText("Suggested: OpenAI")).toBeTruthy();
    // …but the field stays blank until the user takes it.
    expect(vendor.value).toBe("");
  });

  it("never suggests a gateway's own name", () => {
    renderEditor({ models: [catalogRow("OpenAI")] });
    chooseCustomMode();
    const id = screen.getByLabelText("Model id") as HTMLInputElement;
    fireEvent.change(id, { target: { value: "opencode/gpt-5.5" } });
    expect(screen.queryByText(/^Suggested:/)).toBeNull();
  });

  it("applies the suggestion only when the user clicks it", () => {
    renderEditor({ models: [catalogRow("OpenAI")] });
    chooseCustomMode();
    const vendor = screen.getByLabelText(/Vendor/) as HTMLInputElement;
    const id = screen.getByLabelText("Model id") as HTMLInputElement;
    fireEvent.change(id, { target: { value: "openai/gpt-5.6-luna" } });

    fireEvent.click(screen.getByRole("button", { name: "Suggested: OpenAI" }));
    expect(vendor.value).toBe("OpenAI");
    // Taking the suggestion withdraws the offer.
    expect(screen.queryByText(/^Suggested:/)).toBeNull();
  });

  it("does not re-offer a vendor the user has overridden", () => {
    renderEditor({ models: [catalogRow("OpenAI")] });
    chooseCustomMode();
    const vendor = screen.getByLabelText(/Vendor/) as HTMLInputElement;
    const id = screen.getByLabelText("Model id") as HTMLInputElement;

    fireEvent.change(vendor, { target: { value: "Acme AI" } });
    fireEvent.change(id, { target: { value: "openai/gpt-5.6-luna" } });

    expect(vendor.value).toBe("Acme AI");
    expect(screen.queryByText(/^Suggested:/)).toBeNull();
  });
});

describe("ProviderModelEditor — declaring reasoning efforts", () => {
  const VOCABULARY = ["minimal", "low", "medium", "high"];

  it("renders every vocabulary effort as an unpressed toggle chip", () => {
    renderEditor({ effortVocabulary: VOCABULARY });

    expect(screen.queryByRole("checkbox")).toBeNull();
    for (const effort of VOCABULARY) {
      const chip = screen.getByRole("button", { name: effort });
      expect(chip.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("toggles one effort on and back off", () => {
    renderEditor({ effortVocabulary: VOCABULARY });
    const high = screen.getByRole("button", { name: "high" });

    fireEvent.click(high);
    expect(high.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(high);
    expect(high.getAttribute("aria-pressed")).toBe("false");
  });

  it("marks the efforts an existing model already declares", () => {
    renderEditor({
      effortVocabulary: VOCABULARY,
      initial: {
        id: "m1",
        slug: "gw/model",
        upstreamId: "gw/model",
        name: "Model",
        label: "Model",
        hint: null,
        description: null,
        vendorLabel: null,
        iconSvg: "",
        outputType: "text",
        contextWindowTokens: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        reasoningEfforts: ["low", "high"],
        capabilities: null,
        imageCapabilities: null,
        isActive: true,
        sortOrder: 0,
        connectionId: "conn-1",
        createdAt: "",
        updatedAt: "",
      },
    });

    expect(
      screen.getByRole("button", { name: "low" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "high" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("selects the whole vocabulary with All and empties it with Clear", () => {
    renderEditor({ effortVocabulary: VOCABULARY });

    fireEvent.click(screen.getByRole("button", { name: "Select all efforts" }));
    for (const effort of VOCABULARY) {
      expect(
        screen.getByRole("button", { name: effort }).getAttribute("aria-pressed"),
      ).toBe("true");
    }

    fireEvent.click(screen.getByRole("button", { name: "Clear all efforts" }));
    for (const effort of VOCABULARY) {
      expect(
        screen.getByRole("button", { name: effort }).getAttribute("aria-pressed"),
      ).toBe("false");
    }
    expect(screen.getByText("0 selected")).toBeTruthy();
  });
});

describe("ProviderModelEditor — discovering a model", () => {
  const LISTING: ListedProviderModel[] = [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 128_000 },
    { id: "other-model", name: "Other Model", contextLength: 8_000 },
  ];

  function prefill(overrides: Record<string, unknown> = {}) {
    return {
      name: "deepseek-v4-flash",
      contextWindowTokens: 128_000,
      maxInputTokens: null,
      maxOutputTokens: null,
      reasoningEfforts: [],
      defaultReasoningEffort: null,
      capabilities: null,
      providerReported: true,
      ...overrides,
    };
  }

  it("opens the composer's search, filter, and sort picker for the provider's models", async () => {
    renderEditor({ onDiscover: async () => LISTING });

    fireEvent.click(
      await screen.findByRole("button", { name: /Provider model/ }),
    );

    expect(
      await screen.findByRole("searchbox", { name: "Search models" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sort" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /DeepSeek V4 Flash/ })).toBeTruthy();
  });

  it("narrows the listing with the panel's search", async () => {
    renderEditor({ onDiscover: async () => LISTING });

    fireEvent.click(
      await screen.findByRole("button", { name: /Provider model/ }),
    );
    fireEvent.change(
      await screen.findByRole("searchbox", { name: "Search models" }),
      { target: { value: "deepseek" } },
    );

    expect(screen.getByRole("option", { name: /DeepSeek V4 Flash/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Other Model/ })).toBeNull();
  });

  it("prefills the display name in title case from the chosen id", async () => {
    vi.mocked(prefillProviderModel).mockResolvedValue(prefill());
    renderEditor({ onDiscover: async () => LISTING });

    fireEvent.click(
      await screen.findByRole("button", { name: /Provider model/ }),
    );
    const option = await screen.findByRole("option", {
      name: /DeepSeek V4 Flash/,
    });
    fireEvent.click(within(option).getByRole("button"));

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Display name") as HTMLInputElement).value,
      ).toBe("Deepseek V4 Flash"),
    );
    expect(vi.mocked(prefillProviderModel)).toHaveBeenCalledWith("conn-1", {
      upstreamId: "deepseek-v4-flash",
    });
  });

  it("prefills the same title-cased name for an id typed by hand", async () => {
    vi.mocked(prefillProviderModel).mockResolvedValue(
      prefill({ name: "acme-vision-exp" }),
    );
    renderEditor({});

    fireEvent.click(screen.getByRole("button", { name: /Model source/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enter an id" }));
    const id = screen.getByLabelText("Model id");
    fireEvent.change(id, { target: { value: "acme-vision-exp" } });
    fireEvent.blur(id);

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Display name") as HTMLInputElement).value,
      ).toBe("Acme Vision Exp"),
    );
  });
});
