// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo, ReasoningEffortInfo } from "#/lib/api";
import { ModelReasoningSwitcher } from "./model-reasoning-switcher";

afterEach(cleanup);

const model: ModelInfo = {
  modelId: "custom-gateway/my-model",
  label: "My Model",
  name: "My Model",
  hint: null,
  description: null,
  iconSvg: "",
  provider: { slug: "custom-gateway", name: "Custom Gateway" },
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
