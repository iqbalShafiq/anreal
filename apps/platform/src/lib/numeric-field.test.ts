import { describe, expect, it } from "vitest";
import {
  applyNumericFormat,
  caretForDigitOffset,
  digitOffsetAt,
  digitsOnly,
  formatDigits,
} from "./numeric-field";

describe("digitsOnly", () => {
  it("keeps digits and drops everything else", () => {
    expect(digitsOnly("1,234 567")).toBe("1234567");
    expect(digitsOnly("abc12x3")).toBe("123");
    expect(digitsOnly("+1 (555) 010-9999")).toBe("15550109999");
  });

  it("returns an empty string when there are no digits", () => {
    expect(digitsOnly("")).toBe("");
    expect(digitsOnly("abc")).toBe("");
  });
});

describe("formatDigits", () => {
  it("groups from the right with commas", () => {
    expect(formatDigits("999")).toBe("999");
    expect(formatDigits("1000")).toBe("1,000");
    expect(formatDigits("200000")).toBe("200,000");
    expect(formatDigits("1234567")).toBe("1,234,567");
    expect(formatDigits("1000000000")).toBe("1,000,000,000");
  });

  it("keeps a short value ungrouped and an empty value empty", () => {
    expect(formatDigits("42")).toBe("42");
    expect(formatDigits("")).toBe("");
  });

  it("normalises a value that already carries separators", () => {
    expect(formatDigits("1,234,567")).toBe("1,234,567");
    expect(formatDigits("1 234")).toBe("1,234");
  });

  it("does not strip leading zeros — the value is the user's", () => {
    expect(formatDigits("007")).toBe("007");
  });
});

describe("digitOffsetAt", () => {
  it("counts digits before a caret inside a formatted value", () => {
    expect(digitOffsetAt("1,234", 0)).toBe(0);
    expect(digitOffsetAt("1,234", 1)).toBe(1);
    expect(digitOffsetAt("1,234", 2)).toBe(1);
    expect(digitOffsetAt("1,234", 3)).toBe(2);
    expect(digitOffsetAt("1,234", 5)).toBe(4);
  });

  it("clamps a caret outside the value", () => {
    expect(digitOffsetAt("1,234", -5)).toBe(0);
    expect(digitOffsetAt("1,234", 99)).toBe(4);
  });
});

describe("caretForDigitOffset", () => {
  it("lands right after the nth digit", () => {
    expect(caretForDigitOffset("1,999", 0)).toBe(0);
    expect(caretForDigitOffset("1,999", 1)).toBe(1);
    expect(caretForDigitOffset("1,999", 2)).toBe(3);
    expect(caretForDigitOffset("1,999", 4)).toBe(5);
  });

  it("falls back to the end when the offset exceeds the digit count", () => {
    expect(caretForDigitOffset("1,999", 9)).toBe(5);
  });
});

describe("applyNumericFormat", () => {
  it("groups the digits and keeps the caret next to the same digit", () => {
    // `999` with the caret at the end, then the user types `1`: the value is
    // `9991`, the display crosses the separator boundary to `9,991`.
    expect(applyNumericFormat("9991", 4)).toEqual({
      digits: "9991",
      formatted: "9,991",
      caret: 5,
    });
  });

  it("keeps the caret put when a typed digit introduces a separator before it", () => {
    // `999` with the caret at the start, type `1` → `1,999`; the caret stays
    // between the `1` and the separator.
    expect(applyNumericFormat("1999", 1)).toEqual({
      digits: "1999",
      formatted: "1,999",
      caret: 1,
    });
  });

  it("deleting a separator behind the caret reformats and holds the caret", () => {
    // Backspace on the separator in `1,234` removes the comma; the digits are
    // unchanged, so the display is identical and the caret stays before `2`.
    const result = applyNumericFormat("1234", 1);
    expect(result.digits).toBe("1234");
    expect(result.formatted).toBe("1,234");
    expect(result.caret).toBe(1);
  });

  it("deleting a digit just after a separator keeps the caret at the seam", () => {
    // `1,234`, caret after the separator (before `2`), backspace deletes the
    // `,`; the caret sits right after `1`.
    expect(applyNumericFormat("1234", 1).caret).toBe(1);
    // `1,234`, caret before `3` (index 4), delete `2` → `1,34`; caret before `3`.
    expect(applyNumericFormat("1,34", 2)).toEqual({
      digits: "134",
      formatted: "134",
      caret: 1,
    });
  });

  it("strips pasted letters and spaces to a grouped digit string", () => {
    expect(applyNumericFormat("1 234ab567", 10)).toEqual({
      digits: "1234567",
      formatted: "1,234,567",
      caret: 9,
    });
  });

  it("leaves an empty box empty", () => {
    expect(applyNumericFormat("", 0)).toEqual({
      digits: "",
      formatted: "",
      caret: 0,
    });
  });
});
