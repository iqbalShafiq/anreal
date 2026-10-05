import { ChevronDown, Cpu } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ModelInfo, ReasoningEffortInfo } from "#/lib/api";
import {
  formatModelContext,
  formatModelPrice,
  modalityLabel,
  modelById,
  reasoningLabel,
} from "#/lib/chat/models";
import {
  SelectOptionList,
  type SelectOption,
} from "#/components/ui/select-list";
import { readModelPickerView } from "#/lib/chat-preferences";
import {
  EMPTY_PICKER_FILTERS,
  type PickerFilterState,
  type PickerSort,
  type PickerView,
} from "#/lib/model-picker";
import { ModelPickerMenu, gridColumnsForWidth } from "./model-picker-menu";

/** Used only to order the icon fill; the actual list comes from props. */
const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The top app bar's height, used when no bar can be measured. Both the
 * workspace (`layout/chat-top-bar.tsx`) and the share surface
 * (`routes/share.$shareToken.tsx`) render their bar with `h-14`, i.e. Tailwind's
 * 3.5rem = 56px, so 56 is the honest constant when the landmark is absent — the
 * composer also renders on the share surface, whose shell differs, and a menu
 * opening there must still clamp rather than mis-measure. The value lives here
 * rather than as a CSS custom property because the app exposes no shared top-bar
 * token: `styles.css` hard-codes the same `3.5rem` for the content frame, so a
 * single TS constant is the one source of truth this round can offer.
 */
export const TOP_BAR_HEIGHT_FALLBACK = 56;

/**
 * The gap the panel's top must keep below the top bar's bottom (user: "max di
 * bawahnya top app bar kurang 24px"). Exported so the positioning test asserts
 * against the same number the component uses.
 */
export const TOP_BAR_GAP = 24;

/**
 * The top bar's bottom edge, in viewport coordinates.
 *
 * 1. The top bar is the document's `<banner>` landmark — a top-level `<header>`.
 *    Read `layout/chat-top-bar.tsx`: it is
 *    `<header className="vt-topbar glass-top-bar absolute inset-x-0 top-0 … h-14">`,
 *    and `routes/share.$shareToken.tsx` renders the same `<header h-14>` inside
 *    its own shell. Querying the first `header` in the document finds that top
 *    bar (the only nested `header`, in `empty-state.tsx`, comes later under
 *    `<main>`), and its bounding rect is the real geometry — so the panel tracks
 *    a bar that ever changes height.
 * 2. When there is no measurable bar — jsdom in tests, or a shell without one —
 *    fall back to {@link TOP_BAR_HEIGHT_FALLBACK}.
 */
export function topBarBottom(): number {
  const bar = document.querySelector<HTMLElement>("header");
  if (bar) {
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0) return rect.bottom;
  }
  return TOP_BAR_HEIGHT_FALLBACK;
}

/**
 * The fields the hover card reads. Deliberately structural — a BYOK discovery
 * row has no price or output-price data, and the card simply omits those rows
 * instead of requiring a full `ModelInfo`.
 */
export type ModelDetailInfo = {
  source: "catalog" | "connection";
  provider: { name: string };
  inputModalities: string[];
  contextWindowTokens: number;
  prices: { input: number | null; output?: number | null };
};

/**
 * Hover detail for a model option: input modality tags (icons only), max
 * context window, and input/output prices. Exported so the picker menu's grid
 * cards can carry the same hover card as the list rows.
 */
export function ModelDetail({ model }: { model: ModelDetailInfo }) {
  const priceIn = formatModelPrice(model.prices.input);
  const priceOut = formatModelPrice(model.prices.output ?? null);
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {model.inputModalities.length > 0
          ? model.inputModalities.map((modality) => (
              <span
                key={modality}
                className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-text-muted"
              >
                {modalityLabel(modality)}
              </span>
            ))
          : null}
      </div>
      <dl className="flex flex-col gap-0.5">
        {model.source === "connection" ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[10px] text-text-faint">Source</dt>
            <dd
              className="min-w-0 truncate text-[10px] font-medium text-text/90"
              title={`Custom · ${model.provider.name}`}
            >
              Custom · {model.provider.name}
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[10px] text-text-faint">Context</dt>
          <dd className="text-[10px] font-medium text-text/90">
            {formatModelContext(model.contextWindowTokens)}
          </dd>
        </div>
        {priceIn !== null ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[10px] text-text-faint">Input</dt>
            <dd className="text-[10px] font-medium text-text/90">
              {priceIn}
            </dd>
          </div>
        ) : null}
        {priceOut !== null ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[10px] text-text-faint">Output</dt>
            <dd className="text-[10px] font-medium text-text/90">
              {priceOut}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Single glass shell with two joined dropdowns (model | reasoning).
 * Menu is portaled so it is not clipped by composer overflow / stacking.
 */
export function ModelReasoningSwitcher({
  models,
  reasoningEfforts,
  model,
  reasoningEffort,
  disabled,
  onModelChange,
  onReasoningChange,
  onAddModel,
}: {
  models: ModelInfo[];
  reasoningEfforts: ReasoningEffortInfo[];
  model: string;
  reasoningEffort: string | null;
  disabled?: boolean;
  onModelChange: (model: string) => void;
  onReasoningChange: (effort: string | null) => void;
  /** When set, a trailing "Add a model…" row opens the BYOK add flow. */
  onAddModel?: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<"model" | "reasoning" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const reasoningTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modelListId = useId();
  const reasoningListId = useId();
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    minWidth: number;
    maxHeight: number;
  } | null>(null);

  const selectedModel = modelById(models, model) ?? models[0] ?? null;
  const supportedEfforts = selectedModel?.reasoningEfforts ?? [];
  const selectedReasoningLabel =
    reasoningEffort === null ? "None" : reasoningLabel(reasoningEfforts, reasoningEffort);

  /**
   * The view mode the picker menu is currently in. The menu owns the state (it
   * also persists it); it reports back so the panel can be sized here, where
   * the positioning lives. Seeded from storage so the very first open is
   * already the right width rather than resizing a frame later.
   */
  const [pickerView, setPickerView] = useState<PickerView>(() =>
    readModelPickerView(),
  );

  /**
   * Filter and sort state live here, not in the menu, so they survive the menu
   * unmounting on close — spec §7.6/§8: transient intent that lasts for the
   * session. The menu is controlled by them and reports changes back. Search is
   * part of the filter state, so it survives too.
   */
  const [pickerFilters, setPickerFilters] =
    useState<PickerFilterState>(EMPTY_PICKER_FILTERS);
  const [pickerSort, setPickerSort] = useState<PickerSort>("default");

  const updateMenuPosition = () => {
    const shell = rootRef.current;
    if (!shell) {
      setMenuPos(null);
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    // Open upward from the shared shell (composer sits at bottom of viewport).
    // The list hugs the shell; the grid is wider (spec §7.2) so the cards earn
    // their extra columns, capped to the viewport. The existing left clamp
    // below keeps either width inside the viewport — no second clamp.
    const minWidth =
      pickerView === "grid"
        ? Math.min(560, window.innerWidth - 16)
        : Math.max(184, shellRect.width);
    const maxLeft = window.innerWidth - minWidth - 8;
    const top = shellRect.top - 8;
    /**
     * Open upward from the shell at `top`, so the panel's top edge is
     * `top - maxHeight`. The user asked that this top never reach the top app
     * bar: it must sit at least {@link TOP_BAR_GAP} (24px) below the bar's
     * bottom. The space the panel may occupy is therefore
     * `top - (topBarBottom + 24)`. The clamp is floored at 0 — the existing
     * viewport-margin behaviour — so it can never go negative.
     *
     * The option list, the only shrinkable row of the menu's flex column,
     * scrolls within what is left; the filter/sort controls above it keep their
     * full natural height. When even the fixed rows cannot fit (an extremely
     * short viewport), the panel itself scrolls as a last resort so nothing is
     * silently clipped — see the panel's `overflow-y-auto`.
     */
    const maxHeight = Math.max(0, top - (topBarBottom() + TOP_BAR_GAP));
    setMenuPos({
      top,
      left: Math.max(8, Math.min(shellRect.left, maxLeft)),
      minWidth,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!openMenu) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
    const onReposition = () => updateMenuPosition();
    window.addEventListener("resize", onReposition);
    // Capture scroll from any ancestor (chat viewport, etc.)
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- position from openMenu + view + refs
  }, [openMenu, pickerView]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // The model picker's menu may have consumed Escape (clearing an active
      // query/filter keeps the menu open); respect that before closing.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") setOpenMenu(null);
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
  }, [openMenu]);

  useEffect(() => {
    if (disabled) setOpenMenu(null);
  }, [disabled]);

  const toggle = (menu: "model" | "reasoning") => {
    if (disabled) return;
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const reasoningOptions: SelectOption[] =
    supportedEfforts.length === 0
      ? [{ value: "", label: "None", disabled: true }]
      : reasoningEfforts
          .filter((effort) => supportedEfforts.includes(effort.key))
          .map((effort) => ({
            value: effort.key,
            label: effort.label,
            icon: (
              <ReasoningEffortIcon
                effort={effort.key}
                efforts={supportedEfforts}
              />
            ),
          }));

  const menu =
    openMenu && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              minWidth: menuPos.minWidth,
              maxHeight: openMenu === "model" ? menuPos.maxHeight : undefined,
              transform: "translateY(-100%)",
              zIndex: 80,
            }}
            className={
              openMenu === "model"
                ? "flex flex-col chat-scroll overflow-y-auto overflow-x-hidden rounded-xl border border-white/[0.08] bg-canvas-elevated text-text shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] animate-fade-in"
                : ""
            }
          >
            {openMenu === "model" ? (
              <ModelPickerMenu
                id={modelListId}
                models={models}
                value={model}
                open
                filters={pickerFilters}
                onFiltersChange={setPickerFilters}
                sort={pickerSort}
                onSortChange={setPickerSort}
                gridColumns={gridColumnsForWidth(menuPos.minWidth)}
                onSelect={(selectedValue) => {
                  onModelChange(selectedValue);
                  setOpenMenu(null);
                }}
                onAddModel={onAddModel}
                onClose={() => setOpenMenu(null)}
                onViewChange={setPickerView}
              />
            ) : (
              <SelectOptionList
                id={reasoningListId}
                ariaLabel="Reasoning effort"
                value={reasoningEffort ?? ""}
                options={reasoningOptions}
                hoverSide="top"
                onSelect={(selectedValue) => {
                  onReasoningChange(selectedValue === "" ? null : selectedValue);
                  setOpenMenu(null);
                }}
              />
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative inline-flex max-w-full">
      {/* Visual shell only — overflow clipped for rounded join, menu is portaled */}
      <div
        className={`glass inline-flex h-8 max-w-full items-stretch overflow-hidden rounded-xl text-[11px] font-medium text-text-muted transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          disabled ? "opacity-40" : ""
        }`}
      >
        <button
          ref={modelTriggerRef}
          type="button"
          disabled={disabled}
          aria-label="Model"
          aria-haspopup="listbox"
          aria-expanded={openMenu === "model"}
          aria-controls={modelListId}
          title={
            selectedModel
              ? `${selectedModel.name} — ${selectedModel.hint}`
              : "Model"
          }
          onClick={() => toggle("model")}
          className="inline-flex min-w-0 max-w-[7.25rem] cursor-pointer items-center gap-1.5 rounded-l-xl px-2 transition duration-150 hover:bg-white/12 hover:text-text active:scale-[0.99] disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
        >
          {selectedModel ? (
            <ModelIcon
              svg={selectedModel.iconSvg}
              className="size-3.5 shrink-0"
            />
          ) : (
            <Cpu className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <span className="min-w-0 truncate">{selectedModel?.name}</span>
          <ChevronDown
            className={`size-3 shrink-0 opacity-60 transition-transform duration-200 ${openMenu === "model" ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </button>

        <span
          className="my-1.5 w-px shrink-0 self-stretch bg-white/[0.1]"
          aria-hidden
        />

        <button
          ref={reasoningTriggerRef}
          type="button"
          disabled={disabled}
          aria-label="Reasoning effort"
          aria-haspopup="listbox"
          aria-expanded={openMenu === "reasoning"}
          aria-controls={reasoningListId}
          title={`Reasoning · ${selectedReasoningLabel}`}
          onClick={() => toggle("reasoning")}
          className="inline-flex min-w-0 max-w-[6.5rem] cursor-pointer items-center gap-1.5 rounded-r-xl px-2 transition duration-150 hover:bg-white/12 hover:text-text active:scale-[0.99] disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
        >
          <ReasoningEffortIcon
            effort={reasoningEffort}
            efforts={supportedEfforts}
          />
          <span className="min-w-0 truncate">{selectedReasoningLabel}</span>
          <ChevronDown
            className={`size-3 shrink-0 opacity-60 transition-transform duration-200 ${openMenu === "reasoning" ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </button>
      </div>

      {menu}
    </div>
  );
}

/**
 * Gauge icon: fill = position of the effort within the model's OWN sorted
 * effort list (e.g. DeepSeek [low, high, max] → 1/3, 2/3, 3/3), so the
 * levels are always visually distinct regardless of the model's set.
 * `null` (no reasoning) renders an empty outline with a small inner dot.
 */
export function ReasoningEffortIcon({
  effort,
  efforts,
  className = "size-3.5 shrink-0",
}: {
  effort: string | null;
  efforts: string[];
  className?: string;
}) {
  const radius = 6.25;
  const circumference = 2 * Math.PI * radius;
  const sorted = [...efforts].sort(
    (a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b),
  );
  const index = effort === null ? -1 : sorted.indexOf(effort);
  const fill =
    effort === null || sorted.length === 0
      ? 0
      : Math.min(1, (index + 1) / sorted.length);

  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden fill="none">
      {/* Track stays muted (currentColor); the filled arc uses the primary
          accent so low → max is clearly distinguishable. */}
      <circle
        cx="8"
        cy="8"
        r={radius}
        stroke="currentColor"
        strokeWidth="1.4"
        opacity={0.9}
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        style={{ stroke: "var(--color-accent)" }}
        strokeWidth="1.4"
        strokeDasharray={`${circumference * fill} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        opacity={0.92}
      />
      {effort === null ? (
        <circle
          cx="8"
          cy="8"
          r="2.15"
          stroke="currentColor"
          strokeWidth="1.15"
          opacity={0.45}
        />
      ) : null}
    </svg>
  );
}

/**
 * Renders a server-provided model icon (SVG string) through a minimal
 * sanitizer, falling back to the lucide `Cpu` icon when empty or invalid.
 * The wrapper is an inline-flex box so the `size-*` classes apply even when
 * nested inside another flex item, and the SVG fills the box (see
 * `.model-icon svg` in styles.css) with preserveAspectRatio centering.
 */
export function ModelIcon({
  svg,
  className,
}: {
  svg: string;
  className?: string;
}) {
  const sanitized = useMemo(() => sanitizeSvg(svg), [svg]);
  if (!sanitized) return <Cpu className={className} strokeWidth={1.75} />;
  return (
    <span
      className={`model-icon inline-flex items-center justify-center ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

function sanitizeSvg(raw: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return "";
  const trimmed = raw.trim();
  if (!/^<svg[\s>]/i.test(trimmed)) return "";
  if (/<script|onload|onerror|javascript:/i.test(trimmed)) return "";
  return trimmed;
}
