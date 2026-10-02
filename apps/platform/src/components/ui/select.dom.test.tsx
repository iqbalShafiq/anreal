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
