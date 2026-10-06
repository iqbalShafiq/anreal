// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyValueListField, type KeyValueRow } from "./key-value-list-field";

afterEach(cleanup);

/**
 * A controlled field needs an owner that actually re-renders for a real
 * clear-then-type interaction, so the edit test wraps it in minimal state.
 */
function StatefulField({ onChange }: { onChange: (rows: KeyValueRow[]) => void }) {
  const [rows, setRows] = useState<KeyValueRow[]>([
    { id: "r1", name: "X-A", value: "1" },
  ]);
  return (
    <KeyValueListField
      label="Custom headers"
      rows={rows}
      onChange={(next) => {
        setRows(next);
        onChange(next);
      }}
      addLabel="Add header"
    />
  );
}

describe("KeyValueListField", () => {
  it("adds an empty row", async () => {
    const onChange = vi.fn();
    render(
      <KeyValueListField
        label="Custom headers"
        rows={[]}
        onChange={onChange}
        addLabel="Add header"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add header" }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: "", value: "" }),
    ]);
  });

  it("edits a row name", async () => {
    const onChange = vi.fn();
    render(<StatefulField onChange={onChange} />);
    const input =
      screen.getByLabelText<HTMLInputElement>("Custom headers header name");
    await userEvent.clear(input);
    await userEvent.type(input, "X-B");
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "r1", name: "X-B", value: "1" },
    ]);
    expect(input.value).toBe("X-B");
  });

  it("edits a row value", async () => {
    const onChange = vi.fn();
    render(<StatefulField onChange={onChange} />);
    const input =
      screen.getByLabelText<HTMLInputElement>("Custom headers header value");
    await userEvent.clear(input);
    await userEvent.type(input, "2");
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "r1", name: "X-A", value: "2" },
    ]);
    expect(input.value).toBe("2");
  });

  it("removes a row", async () => {
    const onChange = vi.fn();
    render(
      <KeyValueListField
        label="Custom headers"
        rows={[{ id: "r1", name: "X-A", value: "1" }]}
        onChange={onChange}
        addLabel="Add header"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Custom headers row 1" }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("blocks adding beyond maxRows", () => {
    render(
      <KeyValueListField
        label="Custom headers"
        rows={[{ id: "r1", name: "X-A", value: "1" }]}
        onChange={vi.fn()}
        addLabel="Add header"
        maxRows={1}
      />,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add header" })
        .disabled,
    ).toBe(true);
  });

  it("renders values as password inputs when secretValues is set", () => {
    render(
      <KeyValueListField
        label="Custom headers"
        rows={[{ id: "r1", name: "X-A", value: "secret" }]}
        onChange={vi.fn()}
        addLabel="Add header"
        secretValues
      />,
    );
    expect(
      screen
        .getByLabelText("Custom headers header value")
        .getAttribute("type"),
    ).toBe("password");
  });

  it("shows the error text", () => {
    render(
      <KeyValueListField
        label="Custom headers"
        rows={[]}
        onChange={vi.fn()}
        addLabel="Add header"
        error="At most 16 headers are allowed"
      />,
    );
    expect(screen.getByText("At most 16 headers are allowed")).toBeTruthy();
  });
});

describe("KeyValueListField: opt-in dynamic values", () => {
  it("renders no mode toggle unless the caller opts in", () => {
    render(
      <KeyValueListField
        label="Headers"
        rows={[{ id: "1", name: "x-opencode-session", value: "" }]}
        onChange={() => {}}
        addLabel="Add"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /header value mode/i }),
    ).toBeNull();
  });

  it("switches a row to a dynamic source and reports it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <KeyValueListField
        label="Headers"
        rows={[{ id: "1", name: "x-opencode-session", value: "" }]}
        onChange={onChange}
        addLabel="Add"
        allowDynamicValues
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /header value mode/i }),
    );
    await user.click(screen.getByRole("option", { name: /session id/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "1", name: "x-opencode-session", value: "", dynamic: "sessionId" },
    ]);
  });

  it("clears the dynamic source when the row returns to Fixed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <KeyValueListField
        label="Headers"
        rows={[
          { id: "1", name: "x-session", value: "literal", dynamic: "sessionId" },
        ]}
        onChange={onChange}
        addLabel="Add"
        allowDynamicValues
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /header value mode/i }),
    );
    await user.click(screen.getByRole("option", { name: /fixed/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "1", name: "x-session", value: "literal", dynamic: undefined },
    ]);
  });

  it("moves focus into the picker and walks it with the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <KeyValueListField
        label="Headers"
        rows={[{ id: "1", name: "x-session", value: "" }]}
        onChange={vi.fn()}
        addLabel="Add"
        allowDynamicValues
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /header value mode/i }),
    );
    // The selected (Fixed) option must own focus on open, not the trigger.
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: /fixed/i }),
    );
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: /session id/i }),
    );
  });
});
