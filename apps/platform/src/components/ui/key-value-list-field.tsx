import { ChevronDown, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "#/components/ui/button";
import { FIELD_CONTROL_CLASS } from "#/components/ui/form-field";
import {
  DYNAMIC_HEADER_LABELS,
  DYNAMIC_HEADER_SOURCES,
  type DynamicHeaderSource,
} from "#/lib/dynamic-headers";

/** One repeated name/value pair. `id` keeps React keys stable as rows move. */
export type KeyValueRow = {
  id: string;
  name: string;
  value: string;
  /**
   * A run-time source for this row's value (`DYNAMIC_HEADER_SOURCES`). Absent
   * means the literal `value` is sent unchanged. Only callers that opt into
   * `allowDynamicValues` can set it.
   */
  dynamic?: string;
};

/**
 * Icon-button chrome for the per-row remove action. Mirrors
 * `management-row.tsx`'s delete button so both lists read the same.
 */
const REMOVE_ROW_BUTTON_CLASS =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-faint transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

/** "Session ID — stable…" -> "Session ID". Unknown values fall back verbatim. */
function shortSourceLabel(source: string): string {
  const label = DYNAMIC_HEADER_LABELS[source as DynamicHeaderSource];
  return label ? label.split(" — ")[0] : source;
}

/** The explanation half of a source's label, without the separator. */
function sourceExplanation(source: DynamicHeaderSource): string {
  const [, ...rest] = DYNAMIC_HEADER_LABELS[source].split(" — ");
  return rest.join(" — ");
}

const PICKER_OPTION_CLASS =
  "flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left transition duration-150 hover:bg-white/[0.06] focus-visible:bg-white/[0.08] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40";
const PICKER_OPTION_SELECTED_CLASS = "bg-white/[0.05]";

type PickerListPosition = {
  top: number;
  left: number;
  width: number;
  /** Open above the trigger (bottom-of-dialog rows). */
  openUp: boolean;
};

/** Rough per-option height, used only to pick the opening direction. */
const PICKER_OPTION_ESTIMATE = 52;
const PICKER_LIST_MIN_WIDTH = 224;

/**
 * Opt-in per-row Fixed | Dynamic picker. The trigger carries the row's mode
 * control (`${label} header value mode`); choosing a source replaces the
 * literal input with the trigger showing that source, and choosing Fixed
 * clears the source back to a literal. The listbox portals into the nearest
 * `<dialog>` (or `document.body`) so a native dialog's `overflow: hidden`
 * cannot clip it, mirroring `select.tsx`.
 */
function DynamicValuePicker({
  label,
  value,
  onChange,
  disabled,
  className = "",
}: {
  label: string;
  /** The chosen source, or `""` for a literal (Fixed). */
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [dialogPortal, setDialogPortal] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<PickerListPosition | null>(null);

  useLayoutEffect(() => {
    setDialogPortal(rootRef.current?.closest("dialog") ?? null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      // The portaled listbox lives outside the root — clicks on it must not
      // close the picker before the option's own onClick fires.
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointer, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const estimatedHeight =
        PICKER_OPTION_ESTIMATE * (DYNAMIC_HEADER_SOURCES.length + 1) + 8;
      const spaceBelow = window.innerHeight - rect.bottom - 6;
      const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
      const width = Math.max(rect.width, PICKER_LIST_MIN_WIDTH);
      setPosition({
        top: openUp ? rect.top - 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        openUp,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector<HTMLButtonElement>(
      'button[role="option"][aria-selected="true"]',
    );
    const first = list.querySelector<HTMLButtonElement>(
      'button[role="option"]',
    );
    (selected ?? first)?.focus();
  }, [open]);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const list = listRef.current;
    if (!list) return;
    const options = Array.from(
      list.querySelectorAll<HTMLButtonElement>('button[role="option"]'),
    );
    if (options.length === 0) return;
    event.preventDefault();
    const current = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let next: number;
    if (event.key === "ArrowDown") {
      next = current < 0 ? 0 : (current + 1) % options.length;
    } else if (event.key === "ArrowUp") {
      next = current <= 0 ? options.length - 1 : current - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else {
      next = options.length - 1;
    }
    options[next]?.focus();
  };

  const portalTarget =
    dialogPortal ?? (typeof document !== "undefined" ? document.body : null);

  const listbox =
    open && position && portalTarget
      ? createPortal(
          <div
            className="fixed z-[90]"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              transform: position.openUp ? "translateY(-100%)" : undefined,
            }}
          >
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={`${label} header value source`}
              onKeyDown={handleListKeyDown}
              className="chat-scroll max-h-[16rem] overflow-y-auto rounded-xl border border-white/[0.08] bg-canvas-elevated text-text shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] animate-fade-in"
            >
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                onClick={() => select("")}
                className={`${PICKER_OPTION_CLASS} ${
                  value === "" ? PICKER_OPTION_SELECTED_CLASS : ""
                }`}
              >
                <span className="text-xs font-medium">Fixed</span>
                <span className="text-[10px] leading-snug text-text-faint">
                  The literal value, sent unchanged
                </span>
              </button>
              {DYNAMIC_HEADER_SOURCES.map((source) => (
                <button
                  key={source}
                  type="button"
                  role="option"
                  aria-selected={value === source}
                  onClick={() => select(source)}
                  className={`${PICKER_OPTION_CLASS} ${
                    value === source ? PICKER_OPTION_SELECTED_CLASS : ""
                  }`}
                >
                  <span className="text-xs font-medium">
                    {shortSourceLabel(source)}
                  </span>
                  <span className="text-[10px] leading-snug text-text-faint">
                    {sourceExplanation(source)}
                  </span>
                </button>
              ))}
            </div>
          </div>,
          portalTarget,
        )
      : null;

  return (
    <span ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={`${label} header value mode`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`${FIELD_CONTROL_CLASS} flex cursor-pointer items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">
          {value === "" ? "Fixed" : shortSourceLabel(value)}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-text-faint transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
      </button>
      {listbox}
    </span>
  );
}

/**
 * A controlled list of name/value rows (custom headers today; any repeated
 * pair tomorrow). The caller owns the array — this component only reports
 * the next array through `onChange`.
 */
export function KeyValueListField({
  label,
  rows,
  onChange,
  addLabel,
  namePlaceholder,
  valuePlaceholder,
  error,
  helper,
  maxRows,
  secretValues = false,
  disabled = false,
  allowDynamicValues = false,
}: {
  label: string;
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  addLabel: string;
  namePlaceholder?: string;
  valuePlaceholder?: string;
  error?: string | null;
  helper?: string;
  maxRows?: number;
  /** Render values as password inputs. */
  secretValues?: boolean;
  /** Disable every control (e.g. while a parent save is in flight). */
  disabled?: boolean;
  /**
   * Opt in to the Fixed | Dynamic value mode. Off by default so the MCP
   * modal's header rows keep rendering exactly as they always have.
   */
  allowDynamicValues?: boolean;
}): React.JSX.Element {
  const atLimit = maxRows !== undefined && rows.length >= maxRows;

  const updateRow = (index: number, patch: Partial<KeyValueRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">
          {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([
              ...rows,
              { id: crypto.randomUUID(), name: "", value: "" },
            ])
          }
          disabled={disabled || atLimit}
        >
          {addLabel}
        </Button>
      </div>
      {helper && !error ? (
        <p className="px-1 text-[11px] text-text-faint">{helper}</p>
      ) : null}
      {error ? (
        <p className="px-1 text-[11px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-1.5">
          <input
            aria-label={`${label} header name`}
            value={row.name}
            onChange={(event) => updateRow(index, { name: event.target.value })}
            placeholder={namePlaceholder}
            disabled={disabled}
            className={`${FIELD_CONTROL_CLASS} min-w-0 flex-1`}
          />
          {allowDynamicValues && row.dynamic ? null : (
            <input
              aria-label={`${label} header value`}
              type={secretValues ? "password" : "text"}
              value={row.value}
              onChange={(event) =>
                updateRow(index, { value: event.target.value })
              }
              placeholder={valuePlaceholder}
              disabled={disabled}
              className={`${FIELD_CONTROL_CLASS} min-w-0 flex-1`}
            />
          )}
          {allowDynamicValues ? (
            <DynamicValuePicker
              label={label}
              value={row.dynamic ?? ""}
              onChange={(next) =>
                updateRow(index, { dynamic: next === "" ? undefined : next })
              }
              disabled={disabled}
              className={row.dynamic ? "min-w-0 flex-1" : "shrink-0"}
            />
          ) : null}
          <button
            type="button"
            aria-label={`Remove ${label} row ${index + 1}`}
            title={`Remove ${label} row ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            disabled={disabled}
            className={REMOVE_ROW_BUTTON_CLASS}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}
