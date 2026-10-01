import {
  ArrowDownUp,
  LayoutGrid,
  ListFilter,
  Plus,
  Rows3,
  Search,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ModelInfo } from "#/lib/api";
import { formatModelContext } from "#/lib/chat/models";
import {
  EMPTY_PICKER_FILTERS,
  PICKER_SORTS,
  filterModels,
  isFilterActive,
  pickerFacets,
  sortModels,
  type PickerCapability,
  type PickerFilterState,
  type PickerSort,
  type PickerView,
} from "#/lib/model-picker";
import {
  persistModelPickerView,
  readModelPickerView,
} from "#/lib/chat-preferences";
import {
  SelectOptionList,
  type SelectOption,
} from "#/components/ui/select-list";
import { ModelDetail, ModelIcon } from "./model-reasoning-switcher";

/** Row caps, in rows; the option container scrolls past this. */
const LIST_VISIBLE_ROWS = 8;
const GRID_VISIBLE_ROWS = 3;
const GRID_COLUMNS = 3;
/**
 * Approximate rendered row heights, used to size the scroll cap from the row
 * counts above. List rows are a name line plus a hint line with py-2 (~48px);
 * grid cards add the container's gap and a little breathing room (~56px).
 */
const LIST_ROW_HEIGHT = 48;
const GRID_CARD_HEIGHT = 56;

const CAPABILITIES: { key: PickerCapability; label: string }[] = [
  { key: "vision", label: "Vision" },
  { key: "documents", label: "Documents" },
  { key: "reasoning", label: "Reasoning" },
];

/**
 * One chip. Inlined rather than promoted to a `ui/` primitive: it is a
 * single-line pressed button with one caller (this menu), and the app's
 * reusable selected/unselected tone already lives in `SegmentedTabs` — this is
 * the smaller, pressed-only sibling of that treatment, so a shared primitive
 * would carry only one caller's shape.
 */
function FilterChip({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`inline-flex h-6 cursor-pointer items-center rounded-md border px-2 text-[10px] font-medium transition duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring ${
        pressed
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-hairline bg-white/[0.04] text-text-muted hover:bg-white/10 hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Icon button for the search row. Filter and Sort carry an active dot when
 * their state differs from the default; View does not — the layout it
 * selects is self-evident.
 */
function ToolButton({
  label,
  expanded,
  active,
  onClick,
  children,
}: {
  label: string;
  expanded: boolean;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      className={`relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition duration-150 active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring ${
        expanded
          ? "bg-white/12 text-text"
          : "text-text-muted hover:bg-white/12 hover:text-text"
      }`}
    >
      {children}
      {active ? (
        <span
          aria-hidden
          className="absolute right-1 top-1 size-1.5 rounded-full bg-accent"
        />
      ) : null}
    </button>
  );
}

/**
 * The model half of the composer's switcher menu. The portalling,
 * positioning and outside-click handling stay in
 * `model-reasoning-switcher.tsx`; this component is the menu's contents and
 * its own transient filter/sort state plus the persisted view mode.
 *
 * Rendered through a portal on `document.body` — inside a native `<dialog>`
 * this must be portalled into the dialog instead (see `model-reasoning-switcher`),
 * which is exactly how the reasoning menu keeps its top-layer placement.
 */
export function ModelPickerMenu({
  models,
  value,
  onSelect,
  onAddModel,
  open,
  onClose,
}: {
  models: ModelInfo[];
  value: string;
  onSelect: (value: string) => void;
  onAddModel?: () => void;
  open: boolean;
  onClose?: () => void;
}) {
  const listId = useId();
  const liveId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [filters, setFilters] = useState<PickerFilterState>(
    EMPTY_PICKER_FILTERS,
  );
  const [sort, setSort] = useState<PickerSort>("default");
  // Read synchronously in the initializer (the app's preference idiom) so the
  // first paint is already in the stored view rather than flashing the list.
  const [view, setView] = useState<PickerView>(() => readModelPickerView());
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);

  // Focus the search whenever the menu opens.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  const facets = useMemo(() => pickerFacets(models), [models]);
  /**
   * A capability discriminates only if selecting it would change the list:
   * filtering by it alone must yield a non-empty, strictly smaller set. This
   * delegates the predicate to `filterModels` (which owns it) rather than
   * re-deriving "has vision/documents/reasoning" here, and mirrors the split
   * rule Task 3 applies to context thresholds.
   */
  const discriminantCapabilities = useMemo(
    () =>
      facets.capabilities.filter((capability) => {
        const matching = filterModels(models, {
          ...EMPTY_PICKER_FILTERS,
          capabilities: [capability],
        });
        return matching.length > 0 && matching.length < models.length;
      }),
    [facets.capabilities, models],
  );
  const visibleModels = useMemo(
    () => sortModels(filterModels(models, filters), sort),
    [models, filters, sort],
  );

  const selectOption = (selected: string) => {
    onSelect(selected);
  };

  const options: SelectOption[] = visibleModels.map((model) => ({
    value: model.modelId,
    label: model.name,
    hint: model.hint ?? undefined,
    icon: <ModelIcon svg={model.iconSvg} className="size-3.5 shrink-0 opacity-70" />,
    detail: <ModelDetail model={model} />,
  }));

  const hasFilters = isFilterActive(filters);
  const toggleIn = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];

  const clearFilters = () => {
    setFilters(EMPTY_PICKER_FILTERS);
    setSort("default");
  };

  const moveIntoOptions = () => {
    const first = listRef.current?.querySelector<HTMLButtonElement>(
      "button[data-option-value]",
    );
    first?.focus();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveIntoOptions();
      return;
    }
    if (event.key === "Escape") {
      // Esc clears first: with anything to clear the menu stays open.
      if (hasFilters) {
        event.preventDefault();
        clearFilters();
        return;
      }
      onClose?.();
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "Escape" && event.key !== "ArrowUp") return;
    const first = listRef.current?.querySelector<HTMLButtonElement>(
      "button[data-option-value]",
    );
    if (event.key === "ArrowUp" && document.activeElement === first) {
      // Up from the first option returns to the search.
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      if (hasFilters) {
        event.preventDefault();
        clearFilters();
        searchRef.current?.focus();
        return;
      }
      onClose?.();
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowUp") {
      // Up from the action row returns to the search.
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      if (hasFilters) {
        event.preventDefault();
        clearFilters();
        searchRef.current?.focus();
        return;
      }
      onClose?.();
    }
  };

  if (!open) return null;

  const grid = view === "grid";
  const cap = grid
    ? GRID_VISIBLE_ROWS * GRID_CARD_HEIGHT
    : LIST_VISIBLE_ROWS * LIST_ROW_HEIGHT;

  return (
    <div className="flex w-full min-w-0 flex-col">
      {/* Search row */}
      <div className="flex items-center gap-1 px-2 pt-2">
        <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-white/[0.04] px-2 ring-1 ring-white/[0.08] focus-within:ring-2 focus-within:ring-accent-ring">
          <Search className="size-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
          <input
            ref={searchRef}
            type="search"
            role="searchbox"
            aria-label="Search models"
            aria-controls={listId}
            value={filters.query}
            onChange={(event) =>
              setFilters((current) => ({ ...current, query: event.target.value }))
            }
            onKeyDown={handleSearchKeyDown}
            placeholder="Search models…"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </span>

        <ToolButton
          label="Filter"
          expanded={showFilters}
          active={hasFilters}
          onClick={() => setShowFilters((current) => !current)}
        >
          <ListFilter className="size-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          label="Sort"
          expanded={showSort}
          active={sort !== "default"}
          onClick={() => setShowSort((current) => !current)}
        >
          <ArrowDownUp className="size-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          label={grid ? "List view" : "Grid view"}
          expanded={false}
          onClick={() => {
            const next: PickerView = grid ? "list" : "grid";
            setView(next);
            persistModelPickerView(next);
          }}
        >
          {grid ? (
            <Rows3 className="size-4" strokeWidth={1.75} />
          ) : (
            <LayoutGrid className="size-4" strokeWidth={1.75} />
          )}
        </ToolButton>
      </div>

      {/* Inline filters, grouped by facet; a group that cannot discriminate
          is not rendered at all. */}
      {showFilters ? (
        <div className="flex flex-col gap-2 px-2 pt-2">
          {facets.vendors.length > 1 ? (
            <FilterGroup label="Vendor">
              {facets.vendors.map((vendor) => (
                <FilterChip
                  key={vendor}
                  label={vendor}
                  pressed={filters.vendors.includes(vendor)}
                  onToggle={() =>
                    setFilters((current) => ({
                      ...current,
                      vendors: toggleIn(current.vendors, vendor),
                    }))
                  }
                />
              ))}
            </FilterGroup>
          ) : null}

          {facets.connections.length > 1 ? (
            <FilterGroup label="Connection">
              {facets.connections.map((connection) => (
                <FilterChip
                  key={connection.slug}
                  label={connection.name}
                  pressed={filters.connections.includes(connection.slug)}
                  onToggle={() =>
                    setFilters((current) => ({
                      ...current,
                      connections: toggleIn(current.connections, connection.slug),
                    }))
                  }
                />
              ))}
            </FilterGroup>
          ) : null}

          {discriminantCapabilities.length > 0 ? (
            <FilterGroup label="Capability">
              {CAPABILITIES.filter((capability) =>
                discriminantCapabilities.includes(capability.key),
              ).map((capability) => (
                <FilterChip
                  key={capability.key}
                  label={capability.label}
                  pressed={filters.capabilities.includes(capability.key)}
                  onToggle={() =>
                    setFilters((current) => ({
                      ...current,
                      capabilities: toggleIn(current.capabilities, capability.key),
                    }))
                  }
                />
              ))}
            </FilterGroup>
          ) : null}

          {facets.contextThresholds.length > 0 ? (
            <FilterGroup label="Context">
              {facets.contextThresholds.map((threshold) => (
                <FilterChip
                  key={threshold}
                  label={`≥ ${formatModelContext(threshold)}`}
                  pressed={filters.minContext === threshold}
                  onToggle={() =>
                    setFilters((current) => ({
                      ...current,
                      minContext:
                        current.minContext === threshold ? null : threshold,
                    }))
                  }
                />
              ))}
            </FilterGroup>
          ) : null}
        </div>
      ) : null}

      {/* Inline sorts: a segmented row of pressed buttons. */}
      {showSort ? (
        <FilterGroup label="Sort by">
          {PICKER_SORTS.map((entry) => (
            <FilterChip
              key={entry.key}
              label={entry.label}
              pressed={sort === entry.key}
              onToggle={() => setSort(entry.key)}
            />
          ))}
        </FilterGroup>
      ) : null}

      {/* The live region announces the count; no visible count exists. */}
      <span id={liveId} aria-live="polite" className="sr-only">
        {`${visibleModels.length} ${visibleModels.length === 1 ? "model" : "models"} shown`}
      </span>

      {/* Options. Only the options scroll; the action sits below, outside. */}
      {visibleModels.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
          <span className="text-xs text-text-muted">No models match</span>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-hairline bg-white/[0.04] px-2.5 text-[11px] font-medium text-text-muted transition duration-150 hover:bg-white/10 hover:text-text active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <SelectOptionList
          ref={listRef}
          id={listId}
          ariaLabel="Model"
          value={value}
          options={options}
          onSelect={selectOption}
          onKeyDown={handleListKeyDown}
          layout={grid ? "grid" : "list"}
          columns={GRID_COLUMNS}
          hoverSide="right"
          className="chat-scroll overflow-y-auto"
          style={{ maxHeight: cap }}
        />
      )}

      {/* The action is not a model: never filtered, sorted, counted or
          scrolled out of reach. It stays a full-width row below the list. */}
      {onAddModel ? (
        <button
          type="button"
          onClick={() => onAddModel()}
          onKeyDown={handleOptionKeyDown}
          className="mt-1 flex w-full cursor-pointer items-start gap-2 border-t border-hairline px-3 py-2 text-left transition duration-150 hover:bg-white/[0.06] focus-visible:bg-white/[0.08] focus-visible:outline-none"
        >
          <span className="mt-0.5 shrink-0 text-text-muted">
            <Plus className="size-3.5" strokeWidth={1.75} />
          </span>
          <span className="text-xs font-medium text-text-muted">
            Add a model…
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** One labelled chip row. The label is presentational, the chips are the controls. */
function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-1">
      <span className="mr-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wider text-text-faint">
        {label}
      </span>
      {children}
    </div>
  );
}
