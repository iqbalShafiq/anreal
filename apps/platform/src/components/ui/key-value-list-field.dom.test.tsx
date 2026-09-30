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
