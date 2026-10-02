import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { applyNumericFormat, formatDigits } from "#/lib/numeric-field";

/** Shared control chrome (auth + workspace forms). */
export const FIELD_CONTROL_CLASS =
  "glass-field w-full rounded-xl px-3.5 py-2.5 text-sm text-text outline-none placeholder:text-text-faint disabled:cursor-not-allowed disabled:opacity-50";

type FieldChromeProps = {
  label: string;
  optional?: boolean;
  error?: string | null;
  helper?: string;
};

/**
 * A change event whose `target.value` is `digits`, wrapping the real React
 * event so every other property (`preventDefault`, `currentTarget`, the native
 * event, …) passes through untouched. Numeric mode uses this so a consumer that
 * reads `event.target.value` keeps holding the separator-free digit string
 * while the input itself renders the grouped one.
 */
function numericEvent(
  event: ChangeEvent<HTMLInputElement>,
  digits: string,
): ChangeEvent<HTMLInputElement> {
  return new Proxy(event, {
    get(target, prop, receiver) {
      if (prop === "target") {
        const node = target.target;
        return new Proxy(node, {
          get(nodeTarget, nodeProp, nodeReceiver) {
            if (nodeProp === "value") return digits;
            return Reflect.get(nodeTarget, nodeProp, nodeReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Accessible text field: label above, helper/error below (APG form pattern).
 *
 * `numeric` opts into grouped display: the controlled `value` stays a plain
 * digit string (what the form holds and submits), while the input shows locale
 * thousand separators as the user types. The caret is kept next to the same
 * digit across a reformat, and a letter or symbol is dropped rather than
 * reaching `value`.
 */
export const FormTextField = forwardRef<
  HTMLInputElement,
  FieldChromeProps &
    Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
      className?: string;
      numeric?: boolean;
    }
>(function FormTextField(
  {
    label,
    optional = false,
    error,
    helper,
    id: idProp,
    className = "",
    numeric = false,
    value,
    onChange,
    ...props
  },
  ref,
) {
  const genId = useId();
  const id = idProp ?? genId;
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;

  const inputRef = useRef<HTMLInputElement | null>(null);
  // The caret to restore once React has committed the reformatted value.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    inputRef.current?.setSelectionRange(caret, caret);
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!numeric) {
      onChange?.(event);
      return;
    }
    const node = event.currentTarget;
    const raw = node.value;
    const caret = node.selectionStart ?? raw.length;
    const next = applyNumericFormat(raw, caret);
    // Write the grouped value immediately: if the digit string did not change
    // (a pasted letter, a stray symbol) React bails out of the re-render and
    // would otherwise leave the raw text in the box.
    node.value = next.formatted;
    node.setSelectionRange(next.caret, next.caret);
    pendingCaret.current = next.caret;
    onChange?.(numericEvent(event, next.digits));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-medium tracking-wide text-text-muted"
      >
        {label}
        {optional ? (
          <span className="font-normal text-text-faint"> (optional)</span>
        ) : null}
      </label>
      <input
        ref={(node) => {
          inputRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        className={`${FIELD_CONTROL_CLASS} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : helper ? helperId : undefined}
        {...props}
        value={numeric ? formatDigits(String(value ?? "")) : value}
        onChange={handleChange}
      />
      {helper && !error ? (
        <p id={helperId} className="text-[11px] text-text-faint">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});

/**
 * Accessible textarea field — same chrome as FormTextField.
 */
export function FormTextAreaField({
  label,
  optional = false,
  error,
  helper,
  id: idProp,
  className = "",
  ...props
}: FieldChromeProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
    className?: string;
  }) {
  const genId = useId();
  const id = idProp ?? genId;
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium tracking-wide text-text-muted">
        {label}
        {optional ? (
          <span className="font-normal text-text-faint"> (optional)</span>
        ) : null}
      </label>
      <textarea
        id={id}
        className={`${FIELD_CONTROL_CLASS} resize-none ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : helper ? helperId : undefined}
        {...props}
      />
      {helper && !error ? (
        <p id={helperId} className="text-[11px] text-text-faint">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
