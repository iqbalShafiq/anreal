// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./select";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("Select: keyboard focus", () => {
  it("focuses the selected option when it opens", async () => {
    const user = userEvent.setup();
    render(
      <Select value="b" onChange={vi.fn()} options={OPTIONS} ariaLabel="Pick" />,
    );
    await user.click(screen.getByRole("button", { name: /pick/i }));
    const option = screen.getByRole("option", { name: /beta/i });
    expect(document.activeElement).toBe(option.querySelector("button"));
  });

  it("moves focus with the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Select value="a" onChange={vi.fn()} options={OPTIONS} ariaLabel="Pick" />,
    );
    await user.click(screen.getByRole("button", { name: /pick/i }));
    // The selected option owns focus, so ArrowDown reaches the next one.
    await user.keyboard("{ArrowDown}");
    const option = screen.getByRole("option", { name: /beta/i });
    expect(document.activeElement).toBe(option.querySelector("button"));
  });

  it("returns focus to the trigger after choosing an option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select value="a" onChange={onChange} options={OPTIONS} ariaLabel="Pick" />,
    );
    const trigger = screen.getByRole("button", { name: /pick/i });
    await user.click(trigger);
    const option = screen.getByRole("option", { name: /gamma/i });
    await user.click(within(option).getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Select: listAriaLabel", () => {
  it("labels the listbox independently of the trigger when set", async () => {
    const user = userEvent.setup();
    render(
      <Select
        value="a"
        onChange={vi.fn()}
        options={OPTIONS}
        ariaLabel="Mode"
        listAriaLabel="Source"
      />,
    );
    await user.click(screen.getByRole("button", { name: /mode/i }));
    expect(screen.getByRole("listbox", { name: "Source" })).toBeTruthy();
  });
});

describe("Select: custom panel", () => {
  it("renders the panel instead of the option list and closes on its request", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select
        value=""
        onChange={onChange}
        options={[]}
        ariaLabel="Model"
        renderPanel={({ close }) => (
          <button
            type="button"
            onClick={() => {
              onChange("m1");
              close();
            }}
          >
            Choose one
          </button>
        )}
      />,
    );

    await user.click(screen.getByRole("button", { name: /model/i }));
    await user.click(
      await screen.findByRole("button", { name: "Choose one" }),
    );

    expect(onChange).toHaveBeenCalledWith("m1");
    expect(screen.queryByRole("button", { name: "Choose one" })).toBeNull();
  });

  it("lets the panel consume Escape before the dropdown closes", async () => {
    const user = userEvent.setup();
    let consumed = false;
    render(
      <Select
        value=""
        onChange={vi.fn()}
        options={[]}
        ariaLabel="Model"
        renderPanel={() => (
          <input
            aria-label="Panel search"
            onKeyDown={(event) => {
              // Consume only the first Escape, like a real filter-clear does.
              if (event.key === "Escape" && !consumed) {
                event.preventDefault();
                consumed = true;
              }
            }}
          />
        )}
      />,
    );

    await user.click(screen.getByRole("button", { name: /model/i }));
    const search = await screen.findByLabelText("Panel search");
    search.focus();

    // First Escape is the panel's (clear a filter); the dropdown must stay.
    await user.keyboard("{Escape}");
    expect(consumed).toBe(true);
    expect(screen.getByLabelText("Panel search")).toBeTruthy();

    // The next Escape is unclaimed, so the dropdown closes.
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Panel search")).toBeNull();
  });
});
