/**
 * Pure helpers for the shared numeric text field (`FormTextField numeric`).
 *
 * A numeric field shows its value with locale thousand separators while the
 * form still holds and submits a plain digit string. These helpers are
 * React-free so the formatting and the caret math stay unit-testable in the
 * node environment.
 */

/** The grouping separator for the app's locale (`en` → `,`). */
const GROUP_SEPARATOR = ",";

/** Keep only the decimal digits of a value; everything else is dropped. */
export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Render a digit string with thousand separators, leaving it untouched when it
 * has no digits. `"200000"` → `"200,000"`, `""` → `""`. Grouping is applied
 * from the right so it does not depend on the string's length being a multiple
 * of three; no leading zeros are stripped (the value is the user's).
 */
export function formatDigits(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 0) return "";
  let grouped = "";
  for (let i = digits.length; i > 0; i -= 3) {
    const chunk = digits.slice(Math.max(0, i - 3), i);
    grouped = grouped.length === 0 ? chunk : `${chunk}${GROUP_SEPARATOR}${grouped}`;
  }
  return grouped;
}

/**
 * The digit offset of a caret inside an already-rendered (possibly formatted)
 * value: how many digits sit before position `caret`. `"1,234"` with caret `3`
 * → `2` (the `1` and the `2`). Used to carry the caret across a reformat.
 */
export function digitOffsetAt(value: string, caret: number): number {
  const bounded = Math.max(0, Math.min(caret, value.length));
  let count = 0;
  for (let i = 0; i < bounded; i += 1) {
    if (value[i] >= "0" && value[i] <= "9") count += 1;
  }
  return count;
}

/**
 * The caret position in `formatted` that sits immediately after the
 * `digitOffset`-th digit — i.e. next to the same digit it was next to before
 * the reformat. `"1,999"` with `digitOffset` `1` → `1` (after the leading `1`,
 * before the separator); with `digitOffset` `4` → `5` (at the end).
 */
export function caretForDigitOffset(formatted: string, digitOffset: number): number {
  if (digitOffset <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (formatted[i] >= "0" && formatted[i] <= "9") {
      seen += 1;
      if (seen === digitOffset) return i + 1;
    }
  }
  return formatted.length;
}

/**
 * Reformat an input's post-edit value and resolve where the caret should land.
 *
 * `raw` is what the browser shows after the edit (which may include pasted
 * separators, spaces, or letters); `caret` is the post-edit selection start.
 * The result carries the digit string the form should hold, the grouped string
 * to render, and the caret position that keeps it next to the same digit.
 */
export function applyNumericFormat(
  raw: string,
  caret: number,
): { digits: string; formatted: string; caret: number } {
  const digits = digitsOnly(raw);
  const formatted = formatDigits(digits);
  const offset = digitOffsetAt(raw, caret);
  return { digits, formatted, caret: caretForDigitOffset(formatted, offset) };
}
