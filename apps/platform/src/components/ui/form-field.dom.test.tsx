// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormTextField } from "./form-field";

afterEach(cleanup);

/**
 * A controlled host: the value the "form" holds is the plain digit string the
 * field reports, exactly as the four provider-model fields do. The input's
 * displayed value is read back from the DOM.
 */
function NumericHost({
  initial = "",
  onValue,
}: {
  initial?: string;
  onValue?: (digits: string) => void;
}) {
  const [digits, setDigits] = useState(initial);
  return (
    <FormTextField
      label="Context"
      value={digits}
      numeric
      inputMode="numeric"
      placeholder="200000"
      onChange={(event) => {
        setDigits(event.target.value);
        onValue?.(event.target.value);
      }}
    />
  );
}

/** Fire a change with the browser's post-edit caret position applied first. */
function changeWithCaret(input: HTMLInputElement, value: string, caret: number) {
  fireEvent.change(input, {
    target: { value, selectionStart: caret, selectionEnd: caret },
  });
}

const contextInput = () =>
  screen.getByLabelText<HTMLInputElement>(/Context/);

describe("FormTextField numeric mode", () => {
  it("renders the value with locale thousand separators", () => {
    render(<NumericHost initial="1234567" />);
    expect(contextInput().value).toBe("1,234,567");
  });

  it("shows separators for a short value only when it needs them", () => {
    render(<NumericHost initial="999" />);
    expect(contextInput().value).toBe("999");
  });

  it("reports a plain digit string to the form — no separators reach it", () => {
    const onValue = vi.fn();
    render(<NumericHost onValue={onValue} />);
    // Paste a fully grouped, spaced value into the empty field.
    changeWithCaret(contextInput(), "1 234,567", 9);

    expect(onValue).toHaveBeenLastCalledWith("1234567");
    expect(contextInput().value).toBe("1,234,567");
  });

  it("keeps the box empty and the placeholder visible when empty", () => {
    render(<NumericHost />);
    const input = contextInput();
    expect(input.value).toBe("");
    expect(input.getAttribute("placeholder")).toBe("200000");
  });

  it("does not render a zero for an empty value", () => {
    const onValue = vi.fn();
    render(<NumericHost onValue={onValue} />);
    // Clearing a filled field reports empty, and the box stays empty.
    changeWithCaret(contextInput(), "0", 1);
    changeWithCaret(contextInput(), "", 0);
    expect(onValue).toHaveBeenLastCalledWith("");
    expect(contextInput().value).toBe("");
  });

  it("ignores letters and symbols while preserving the digits", () => {
    const onValue = vi.fn();
    render(<NumericHost initial="12" onValue={onValue} />);
    changeWithCaret(contextInput(), "12ab", 4);
    expect(onValue).toHaveBeenLastCalledWith("12");
    expect(contextInput().value).toBe("12");
  });

  it("keeps inputMode numeric and the accessible label wired", () => {
    render(<NumericHost />);
    const input = contextInput();
    expect(input.getAttribute("inputmode")).toBe("numeric");
    // getByLabelText above already proves the label→input wiring; this pins the
    // explicit aria label association id as well.
    const label = screen.getByText("Context");
    expect(input.id).toBe(label.getAttribute("for"));
  });
});

describe("FormTextField numeric mode — caret stability", () => {
  it("keeps the caret next to the same digit when typing in the middle", () => {
    render(<NumericHost initial="1234" />);
    const input = contextInput();
    expect(input.value).toBe("1,234");
    // Caret after `2` (index 3), type `9` → `12,934`; caret stays after the `9`.
    changeWithCaret(input, "12,934", 4);
    expect(input.value).toBe("12,934");
    expect(input.selectionStart).toBe(4);
  });

  it("crosses a separator boundary without jumping (999 → 1,999)", () => {
    render(<NumericHost initial="999" />);
    const input = contextInput();
    // Caret at the start, type `1` → `1,999`; the caret sits after the `1`.
    changeWithCaret(input, "1999", 1);
    expect(input.value).toBe("1,999");
    expect(input.selectionStart).toBe(1);

    // And typing at the end of `999` → `9,991` leaves the caret at the end.
    render(<NumericHost initial="999" />);
    const end = screen.getAllByLabelText<HTMLInputElement>(/Context/)[1];
    changeWithCaret(end, "9991", 4);
    expect(end.value).toBe("9,991");
    expect(end.selectionStart).toBe(5);
  });

  it("holds the caret when a digit just after a separator is deleted", () => {
    render(<NumericHost initial="1234" />);
    const input = contextInput();
    // `1,234`, caret before `3` (index 4), delete `2` → `134`.
    changeWithCaret(input, "1,34", 2);
    expect(input.value).toBe("134");
    expect(input.selectionStart).toBe(1);
  });

  it("holds the caret when a separator itself is deleted with backspace", () => {
    render(<NumericHost initial="1234" />);
    const input = contextInput();
    // `1,234`, caret after the separator (index 2), backspace removes the `,`;
    // digits are unchanged, so the display is `1,234` and the caret stays at 1.
    changeWithCaret(input, "1234", 1);
    expect(input.value).toBe("1,234");
    expect(input.selectionStart).toBe(1);
  });
});

describe("FormTextField non-numeric mode is unchanged", () => {
  it("passes the raw value through with no separators", () => {
    render(
      <FormTextField
        label="Model id"
        defaultValue=""
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>(/Model id/);
    fireEvent.change(input, { target: { value: "1234567" } });
    expect(input.value).toBe("1234567");
  });

  it("still reports the event target value for a normal field", () => {
    let seen = "";
    render(
      <FormTextField
        label="Name"
        value=""
        onChange={(event) => {
          seen = event.target.value;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "hello" },
    });
    expect(seen).toBe("hello");
  });
});
