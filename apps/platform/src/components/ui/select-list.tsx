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
  /**
   * When true, the list is embedded in a panel that already provides the
   * popover chrome (border, surface, shadow, rounding, entry animation), so it
   * draws none of that itself — otherwise the panel would render a card inside
   * a card. The default keeps the full card treatment every existing caller
   * renders. Full-bleed rows (the default here) require the embedding panel to
   * carry `overflow-hidden` and its rounding to clip a corner row's highlight;
   * a chromeless caller with a padded, non-clipping panel would square a corner
   * silently.
   */
  chromeless?: boolean;
  /**
   * Put `role="option"` (and therefore the click target) on each option's
   * button, leaving the `li` as a presentation wrapper. Off by default so
   * every existing caller keeps the exact `<li role="option">` structure
   * those tests pin.
   */
  optionsAsButtons?: boolean;
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
  chromeless = false,
  optionsAsButtons = false,
}: SelectOptionListProps) {
  const isGrid = layout === "grid";
  const columnCount = Math.max(1, Math.floor(columns) || 1);

  /**
   * The option's own layout is the layout prop's job, not only the container's:
   * in list mode the row is a horizontal icon + stacked label/hint (unchanged,
   * byte-identical — Select depends on it). In grid mode the same elements
   * become a vertical card: icon on its own line, then the label, then the hint
   * (which already carries capability and context). Only the arrangement
   * changes — the elements, their label/hint classes, selection state, hover
   * card and click behaviour are identical in both modes.
   */
  const rowClass = isGrid
    ? "flex w-full cursor-pointer flex-col items-start gap-1 px-3 py-2 text-left transition duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
    : "flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40";

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

  /**
   * Chromeless drops the card treatment so the list does not draw a second
   * border/surface/shadow inside a panel that already provides them, and leaves
   * padding to the caller so a chromeless grid does not fight the caller's
   * inset. The default branch is kept literally as it was — `Select` depends on
   * it byte-for-byte.
   */
  const containerClass = chromeless
    ? `${isGrid ? "grid gap-1 " : ""}${className}`
    : `chat-scroll overflow-hidden rounded-xl border border-white/[0.08] bg-canvas-elevated text-text shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] animate-fade-in ${
        isGrid ? "grid gap-1 p-1 " : ""
      }${className}`;

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
      className={containerClass}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        const row = (
          <button
            type="button"
            role={optionsAsButtons ? "option" : undefined}
            aria-selected={optionsAsButtons ? isSelected : undefined}
            disabled={opt.disabled}
            data-option-value={opt.value}
            className={`${rowClass} ${
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
          <li
            key={opt.value}
            role={optionsAsButtons ? "presentation" : "option"}
            aria-selected={optionsAsButtons ? undefined : isSelected}
          >
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
