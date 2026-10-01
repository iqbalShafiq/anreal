// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo, ProviderModelRow } from "#/lib/api";
import { ProviderModelEditor } from "./provider-model-editor";

vi.mock("#/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/lib/api")>();
  return { ...actual, prefillProviderModel: vi.fn() };
});

afterEach(cleanup);

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
}) {
  return render(
    <ProviderModelEditor
      connectionId="conn-1"
      connectionSlug="gw"
      imageStyle={input.imageLimits ? "openrouter-images" : "none"}
      imageLimits={input.imageLimits ?? null}
      effortVocabulary={["low"]}
      models={input.models ?? []}
      initial={input.initial ?? null}
      saving={false}
      onSave={async () => undefined}
      onCancel={() => undefined}
      onDiscover={async () => []}
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
