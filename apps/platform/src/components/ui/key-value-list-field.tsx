import { X } from "lucide-react";
import { Button } from "#/components/ui/button";
import { FIELD_CONTROL_CLASS } from "#/components/ui/form-field";
import { Select } from "#/components/ui/select";
import { type SelectOption } from "#/components/ui/select-list";
import {
  DYNAMIC_HEADER_LABELS,
  DYNAMIC_HEADER_SOURCES,
  isDynamicHeaderSource,
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
  dynamic?: DynamicHeaderSource;
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

/**
 * Fixed plus the three sources, in picker order. `""` is Fixed so a row with
 * no source maps straight onto the literal input. Static, so one list is
 * shared by every row and every instance of the field.
 */
const VALUE_MODE_OPTIONS: SelectOption[] = [
  { value: "", label: "Fixed", hint: "The literal value, sent unchanged" },
  ...DYNAMIC_HEADER_SOURCES.map((source) => ({
    value: source,
    label: shortSourceLabel(source),
    hint: sourceExplanation(source),
  })),
];

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
            <Select
              value={row.dynamic ?? ""}
              onChange={(next) =>
                updateRow(index, {
                  dynamic: isDynamicHeaderSource(next) ? next : undefined,
                })
              }
              options={VALUE_MODE_OPTIONS}
              ariaLabel={`${label} header value mode`}
              listAriaLabel={`${label} header value source`}
              optionsAsButtons
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
