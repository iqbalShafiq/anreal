// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoverCard } from "./hover-card";

/**
 * jsdom has no ResizeObserver; the card only builds one when it opens, and the
 * positioning it drives is irrelevant to the portal-target contract under test.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

/** Hover the card's anchor and flush the open delay. */
function hover(anchor: HTMLElement) {
  fireEvent.mouseEnter(anchor);
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

function anchorFor(trigger: HTMLElement): HTMLElement {
  return trigger.parentElement as HTMLElement;
}

describe("HoverCard portal target", () => {
  it("portals the detail into the closest dialog so a modal's top layer cannot hide it", () => {
    render(
      <dialog open>
        <HoverCard content={<span>Model detail</span>}>
          <button type="button">Row</button>
        </HoverCard>
      </dialog>,
    );

    hover(anchorFor(screen.getByRole("button", { name: "Row" })));

    const panel = screen.getByRole("tooltip");
    const dialog = document.querySelector("dialog");
    // A body portal would sit behind the showModal() top layer; the panel must
    // live inside the dialog to paint above it.
    expect(dialog?.contains(panel)).toBe(true);
  });

  it("keeps portaling to the body outside a dialog", () => {
    render(
      <HoverCard content={<span>Model detail</span>}>
        <button type="button">Row</button>
      </HoverCard>,
    );

    hover(anchorFor(screen.getByRole("button", { name: "Row" })));

    const panel = screen.getByRole("tooltip");
    expect(panel.closest("dialog")).toBeNull();
    expect(document.body.contains(panel)).toBe(true);
  });
});
