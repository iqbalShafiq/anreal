import { ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  SelectOptionList,
  type SelectOption,
} from "#/components/ui/select-list";

export type SelectPanelContext = {
  /** The listbox id the trigger's `aria-controls` points at. */
  id: string;
  /** Closes the dropdown (called after a selection is made). */
  close: () => void;
  /** The panel width the trigger's position produced. */
  width: number;
  /** The viewport room available on the open side, for the panel to respect. */
  maxHeight: number;
};

export type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  leadingIcon?: ReactNode;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  /**
   * Hover detail placement for option cards (model logos etc).
   */
  hoverSide?: "top" | "right";
  /**
   * Label for the popup listbox when it should differ from the trigger's.
   * Defaults to `ariaLabel`, so existing callers are untouched.
   */
  listAriaLabel?: string;
  /**
   * Put `role="option"` (and therefore the click target) on each option's
   * button instead of its `li` wrapper. Opt-in; the default keeps the exact
   * structure every existing caller renders.
   */
  optionsAsButtons?: boolean;
  /**
   * Render a custom panel (search/filter/sort contents, a rich picker) instead
   * of the option list. The panel owns its own content and focus; the Select
   * keeps the anchoring, dialog portal, outside-click, and Escape handling.
   * When set, `options` only feeds the trigger label and the open-direction
   * estimate (`panelHeight` overrides the latter).
   */
  renderPanel?: (context: SelectPanelContext) => ReactNode;
  /** Estimated height of the custom panel, in px; picks the open direction. */
  panelHeight?: number;
};

type ListPos = {
  top: number;
  left: number;
  width: number;
  /** Open above the trigger (composer / bottom-of-viewport). */
  openUp: boolean;
  /** Clamped to the room actually available, so the list never runs off-screen. */
  maxHeight: number;
};

/** Matches the listbox's preferred height cap (16rem). */
const LIST_MAX_HEIGHT = 256;
/**
 * The cap for a custom panel: tall enough for a rich picker (search + filter
 * rows + ~8 option rows), still clamped to the viewport room on the open side.
 */
const PANEL_MAX_HEIGHT = 480;

export function Select({
  value,
  onChange,
  options,
  leadingIcon,
  ariaLabel,
  className = "",
  disabled = false,
  hoverSide = "top",
  listAriaLabel,
  optionsAsButtons = false,
  renderPanel,
  panelHeight,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const wasOpenRef = useRef(false);
  const hasCustomPanel = renderPanel !== undefined;
  /**
   * Native `showModal()` dialogs live in the browser top layer, so a listbox
   * portaled to `document.body` renders *behind* the modal. Detect a dialog
   * ancestor after commit and portal the list INTO the dialog instead.
   * Outside dialogs we always portal to `document.body` so overflow / sibling
   * stacking (e.g. approval card above the composer) cannot clip the menu.
   */
  const [dialogPortal, setDialogPortal] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setDialogPortal(rootRef.current?.closest("dialog") ?? null);
  }, []);

  const selected = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      // The portaled listbox/panel lives outside the root — clicks on it must
      // not close the dropdown before the option's onClick fires.
      if (listRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // A handler inside a custom panel may have consumed Escape (clearing an
      // active filter keeps the dropdown open); respect that before closing.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    // Defer so the opening click does not immediately close.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const [listPos, setListPos] = useState<ListPos | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setListPos(null);
      return;
    }

    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const gap = 6;
      // The listbox's own cap (16rem) estimates the plain list's height; a
      // custom panel supplies `panelHeight` instead. Used only to pick the
      // open direction.
      const estimatedListH =
        panelHeight ?? Math.min(options.length * 44 + 8, LIST_MAX_HEIGHT);
      // The list is `fixed`, so the viewport is what constrains it — not the
      // dialog box. Measuring against the dialog is what used to clip the menu
      // at the modal edge (`.settings-dialog` is `overflow: hidden`), hiding
      // options a taller menu had room to show.
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUp =
        spaceBelow < Math.min(estimatedListH, 160) && spaceAbove > spaceBelow;

      const width = Math.max(rect.width, 200);
      const maxLeft = window.innerWidth - width - 8;
      const leftViewport = Math.max(8, Math.min(rect.left, maxLeft));

      // A custom panel (rich picker) earns more room than the plain listbox.
      const maxHeightCap = hasCustomPanel ? PANEL_MAX_HEIGHT : LIST_MAX_HEIGHT;

      setListPos({
        top: openUp ? rect.top - gap : rect.bottom + gap,
        left: leftViewport,
        width,
        openUp,
        // Scroll rather than overflow: a menu near an edge stays fully usable.
        maxHeight: Math.max(
          80,
          Math.min(maxHeightCap, openUp ? spaceAbove : spaceBelow),
        ),
      });
    };

    update();
    window.addEventListener("resize", update);
    // Capture scroll from any ancestor (chat viewport, approval dock, etc.)
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, dialogPortal, options.length, panelHeight, hasCustomPanel]);

  /**
   * The listbox only mounts on the commit *after* the layout effect above
   * calls `setListPos`, and React flushes the previous commit's passive
   * effects before that second commit. Keying the effect on `[open]` alone
   * therefore always observed `listRef.current === null` and focus never left
   * the trigger. `listMounted` flips once the list actually exists and stays
   * put across position updates, so arrow-key navigation is not reset by a
   * scroll or resize.
   */
  const listMounted = open && listPos !== null;
  useEffect(() => {
    if (!listMounted || hasCustomPanel) return;
    const list = listRef.current;
    if (!list) return;
    const selectedButton = list.querySelector<HTMLButtonElement>(
      optionsAsButtons
        ? 'button[data-option-value][aria-selected="true"]'
        : 'li[aria-selected="true"] button',
    );
    const firstButton = list.querySelector<HTMLButtonElement>(
      "button[data-option-value]",
    );
    (selectedButton ?? firstButton)?.focus();
  }, [listMounted, optionsAsButtons, hasCustomPanel]);

  const moveFocus = (index: number, direction: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const buttons = Array.from(
      list.querySelectorAll<HTMLButtonElement>("button[data-option-value]"),
    );
    if (buttons.length === 0) return;
    let i = index;
    for (let step = 0; step < buttons.length; step += 1) {
      const button = buttons[i];
      if (button && !button.disabled) {
        button.focus();
        return;
      }
      i = (i + direction + buttons.length) % buttons.length;
    }
  };

  const handleListKeyDown = (event: KeyboardEvent) => {
    const list = listRef.current;
    if (!list) return;
    const buttons = Array.from(
      list.querySelectorAll<HTMLButtonElement>("button[data-option-value]"),
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(currentIndex + 1, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(currentIndex - 1, -1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0, 1);
        break;
      case "End":
        event.preventDefault();
        moveFocus(buttons.length - 1, -1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        (document.activeElement as HTMLButtonElement | null)?.click();
        break;
    }
  };

  const portalTarget = dialogPortal ?? (typeof document !== "undefined" ? document.body : null);

  const listbox =
    open && listPos && portalTarget
      ? createPortal(
          <div
            // Inside a native <dialog> (top layer) a body-portaled menu hides
            // behind the modal, so the list lives in the dialog instead. It is
            // `fixed` so the dialog's `overflow: hidden` cannot clip it, which
            // holds because the dialog has no transform at rest — its open
            // animation fills `backwards`, so nothing persists to become the
            // containing block for a fixed child.
            className="fixed z-[90]"
            style={{
              top: listPos.top,
              left: listPos.left,
              width: listPos.width,
              transform: listPos.openUp ? "translateY(-100%)" : undefined,
            }}
          >
            {renderPanel ? (
              <div
                ref={panelRef}
                className="chat-scroll overflow-y-auto"
                style={{ maxHeight: listPos.maxHeight }}
              >
                {renderPanel({
                  id: listId,
                  close: () => setOpen(false),
                  width: listPos.width,
                  maxHeight: listPos.maxHeight,
                })}
              </div>
            ) : (
              <SelectOptionList
                ref={listRef}
                id={listId}
                ariaLabel={listAriaLabel ?? ariaLabel}
                value={value}
                options={options}
                onSelect={(optionValue) => {
                  onChange(optionValue);
                  setOpen(false);
                }}
                onKeyDown={handleListKeyDown}
                hoverSide={hoverSide}
                optionsAsButtons={optionsAsButtons}
                className="overflow-y-auto"
                style={{ maxHeight: listPos.maxHeight }}
              />
            )}
          </div>,
          portalTarget,
        )
      : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {leadingIcon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 items-center text-text-faint">
          {leadingIcon}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={selected ? `${ariaLabel}, ${selected.label}` : ariaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`w-full cursor-pointer rounded-xl bg-white/[0.04] py-2.5 text-left text-sm text-text outline-none ring-1 ring-white/[0.08] transition focus:bg-white/[0.055] focus:ring-2 focus:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40 ${
          leadingIcon ? "pl-10" : "pl-3"
        } pr-9`}
      >
        {selected?.label ?? "Select…"}
      </button>
      <ChevronDown
        className={`pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-faint transition-transform duration-200 ${
          open ? "rotate-180" : ""
        }`}
        strokeWidth={1.75}
      />
      {listbox}
    </div>
  );
}
