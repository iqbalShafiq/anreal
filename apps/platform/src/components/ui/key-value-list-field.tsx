import { X } from "lucide-react";
import { Button } from "#/components/ui/button";
import { FIELD_CONTROL_CLASS } from "#/components/ui/form-field";

/** One repeated name/value pair. `id` keeps React keys stable as rows move. */
export type KeyValueRow = { id: string; name: string; value: string };

/**
 * Icon-button chrome for the per-row remove action. Mirrors
 * `management-row.tsx`'s delete button so both lists read the same.
 */
const REMOVE_ROW_BUTTON_CLASS =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-faint transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

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
          <input
            aria-label={`${label} header value`}
            type={secretValues ? "password" : "text"}
            value={row.value}
            onChange={(event) => updateRow(index, { value: event.target.value })}
            placeholder={valuePlaceholder}
            disabled={disabled}
            className={`${FIELD_CONTROL_CLASS} min-w-0 flex-1`}
          />
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
