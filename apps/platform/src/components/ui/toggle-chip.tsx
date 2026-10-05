import type { ReactNode } from "react";

export type ToggleChipSize = "sm" | "md";

const SIZE_CLASS: Record<ToggleChipSize, string> = {
  sm: "h-6 px-2 text-[10px]",
  md: "h-7 px-2.5 text-[11px]",
};

/**
 * One multi-select chip: a pressed-only button in the app's chip language
 * (selected = accent tint, rest muted), with the same focus/motion treatment
 * as `SegmentedTabs`. Shared by the model picker's filter chips and the
 * provider editor's reasoning-effort declaration, so every multi-select in the
 * app reads the same. `icon` is optional so a plain label chip carries no
 * stray gap.
 */
export function ToggleChip({
  label,
  pressed,
  onToggle,
  size = "sm",
  disabled = false,
  icon,
  title,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  size?: ToggleChipSize;
  disabled?: boolean;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={onToggle}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border font-medium transition duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40 ${SIZE_CLASS[size]} ${
        pressed
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-hairline bg-white/[0.04] text-text-muted hover:bg-white/10 hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
