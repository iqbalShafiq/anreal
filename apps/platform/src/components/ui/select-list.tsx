import type {
  CSSProperties,
  KeyboardEventHandler,
  ReactNode,
  Ref,
} from "react";
import { HoverCard } from "#/components/ui/hover-card";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Extra capability/price info shown as a hover popover on the row. */
  detail?: ReactNode;
};

export type SelectOptionListProps = {
  ref?: Ref<HTMLUListElement>;
  id: string;
  ariaLabel: string;
  value: string;
  options: SelectOption[];
  onSelect: (value: string) => void;
  style?: CSSProperties;
  className?: string;
  onKeyDown?: KeyboardEventHandler;
  /** Where the option detail hover card appears relative to the popover. */
  hoverSide?: "top" | "right";
  /**
   * `"list"` (default) keeps the single-column rows every existing caller
   * (Select) renders. `"grid"` renders the same `<li>`/`<button>` options as a
   * card grid on the same listbox — only the container's layout changes.
   */
  layout?: "list" | "grid";
  /** Grid columns. Ignored in list layout. Defaults to 1. */
  columns?: number;
};

/**
 * Presentational listbox panel shared by Select and the model/reasoning
 * switcher. Open/close and the caller's own keyboard logic stay with the
 * caller; grid layouts add column-aware arrow handling here so list and grid
 * share one selection implementation.
 */
export function SelectOptionList({
  ref,
  id,
  ariaLabel,
  value,
  options,
  onSelect,
  style,
  className = "",
  onKeyDown,
  hoverSide = "top",
  layout = "list",
  columns = 1,
}: SelectOptionListProps) {
  const isGrid = layout === "grid";
  const columnCount = Math.max(1, Math.floor(columns) || 1);

  /**
   * Grid-only arrow handling. In list layout the caller owns the keys (Select
   * moves by ±1 in `select.tsx`), so this stays inert there and every existing
   * caller keeps its exact keyboard behaviour. In grid layout ↑/↓ move by a row
   * (the column count) and ←/→ by one card, clamped at the edges.
   */
  const handleKeyDown: KeyboardEventHandler = (event) => {
    onKeyDown?.(event);
    if (!isGrid || event.defaultPrevented) return;
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (!keys.includes(event.key)) return;

    const list = event.currentTarget as HTMLUListElement;
    const buttons = Array.from(
      list.querySelectorAll<HTMLButtonElement>("button[data-option-value]"),
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (currentIndex < 0) return;

    event.preventDefault();
    const delta =
      event.key === "ArrowUp"
        ? -columnCount
        : event.key === "ArrowDown"
          ? columnCount
          : event.key === "ArrowLeft"
            ? -1
            : 1;
    const target = Math.min(
      buttons.length - 1,
      Math.max(0, currentIndex + delta),
    );
    // Skip disabled cards so focus always lands somewhere usable, walking in
    // the direction of travel and stopping once we come back to the target.
    const stepDirection = Math.sign(delta) || 1;
    let index = target;
    for (let step = 0; step < buttons.length; step += 1) {
      const button = buttons[index];
      if (button && !button.disabled) {
        button.focus();
        return;
      }
      index = Math.min(buttons.length - 1, Math.max(0, index + stepDirection));
      if (index === target) return;
    }
  };

  return (
    <ul
      ref={ref}
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      style={
        isGrid
          ? {
              ...style,
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            }
          : style
      }
      data-layout={isGrid ? "grid" : undefined}
      data-columns={isGrid ? String(columnCount) : undefined}
      onKeyDown={handleKeyDown}
      className={`chat-scroll overflow-hidden rounded-xl border border-white/[0.08] bg-canvas-elevated text-text shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] animate-fade-in ${
        isGrid ? "grid gap-1 p-1 " : ""
      }${className}`}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        const row = (
          <button
            type="button"
            disabled={opt.disabled}
            data-option-value={opt.value}
            className={`flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 ${
              isSelected ? "bg-white/[0.05]" : ""
            }`}
            onClick={() => {
              if (opt.disabled) return;
              onSelect(opt.value);
            }}
          >
            {opt.icon ? (
              <span className="mt-0.5 text-text-muted">{opt.icon}</span>
            ) : null}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={`text-xs font-medium ${isSelected ? "text-text" : "text-text-muted"}`}
              >
                {opt.label}
              </span>
              {opt.hint ? (
                <span className="text-[10px] text-text-faint">
                  {opt.hint}
                </span>
              ) : null}
            </span>
          </button>
        );
        return (
          <li key={opt.value} role="option" aria-selected={isSelected}>
            {opt.detail ? (
              <HoverCard
                variant="tooltip"
                side={hoverSide}
                disabled={opt.disabled}
                content={opt.detail}
              >
                {row}
              </HoverCard>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
