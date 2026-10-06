/**
 * Pure model-picker logic: the query, the derived filters, the sorts and the
 * facet lists the composer's picker needs. No React, no DOM, no API import —
 * `PickerSource` is declared structurally so `ModelInfo` satisfies it, the same
 * way `model-role-labels.ts` declares `RoleModelOptionSource`. That keeps this
 * module testable in the node environment without constructing API objects.
 *
 * The rules the picker is built on:
 * - **The vendor is declared, never derived.** A BYOK model with no vendor
 *   simply does not match a Vendor selection — it never vanishes from the list
 *   and is never attributed to a guess.
 * - **A filter group that cannot discriminate is not offered.** `pickerFacets`
 *   returns only values that appear at least once, and `contextThresholds` only
 *   thresholds that would actually split the set.
 * - **`contextWindowTokens === 0` means "undeclared"**, not "smallest": it is
 *   excluded from Context threshold filters and sorts last under Context.
 */

export type PickerSort = "default" | "name" | "price" | "context" | "vendor";

export type PickerView = "list" | "grid";

/** A picker capability chip, and the modality/effort rule behind it. */
export type PickerCapability = "vision" | "documents" | "reasoning";

export type PickerFilterState = {
  query: string;
  vendors: string[];
  connections: string[];
  capabilities: PickerCapability[];
  minContext: number | null;
};

/** The unset filter state: no query, no selections, no context floor. */
export const EMPTY_PICKER_FILTERS: PickerFilterState = {
  query: "",
  vendors: [],
  connections: [],
  capabilities: [],
  minContext: null,
};

/** The sorts, in the order the picker presents them. "default" is today's order. */
export const PICKER_SORTS: { key: PickerSort; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "name", label: "Name" },
  { key: "price", label: "Price" },
  { key: "context", label: "Context" },
  { key: "vendor", label: "Vendor" },
];

/**
 * The sorts worth offering for a provider's raw listing: it carries no prices
 * and no declared vendor, so those orders would appear to do nothing.
 */
export const LISTING_PICKER_SORTS: { key: PickerSort; label: string }[] =
  PICKER_SORTS.filter(
    (entry) =>
      entry.key === "default" || entry.key === "name" || entry.key === "context",
  );

/**
 * The only fields the picker reads from a model. Structurally satisfied by
 * `ModelInfo`, so this module never imports the API client (or React).
 */
export type PickerSource = {
  modelId: string;
  name: string;
  label: string;
  hint: string | null;
  provider: { slug: string; name: string };
  vendorLabel: string | null;
  source: "catalog" | "connection";
  inputModalities: string[];
  reasoningEfforts: string[];
  contextWindowTokens: number;
  prices: { input: number | null };
};

/**
 * A picker row: the filter contract plus the icon it renders. `ModelInfo`
 * satisfies it, and so does a raw provider listing mapped client-side, which
 * is what lets the composer's picker serve the BYOK editor unchanged.
 */
export type PickerModel = PickerSource & { iconSvg?: string };

/**
 * The context thresholds the picker may offer. They are the two floors the spec
 * names; a floor that does not split the displayed set is never surfaced, so
 * this is a vocabulary, not a hardcoded menu (see `pickerFacets`).
 */
const CONTEXT_THRESHOLDS = [200_000, 1_000_000] as const;

/** The vendor a model is filed under: its declared vendor, else its provider. */
function vendorOf(model: PickerSource): string | null {
  if (model.vendorLabel !== null && model.vendorLabel.length > 0) {
    return model.vendorLabel;
  }
  // Catalog rows have no declared vendor column, so their provider's name is
  // the vendor the user sees. A connection model's provider is the connection,
  // which is not a vendor — hence the source check.
  return model.source === "catalog" ? model.provider.name : null;
}

/**
 * The capability words the query understands, mapped to the filters they stand
 * for. "document" and "documents" are the same chip's vocabulary.
 */
const QUERY_CAPABILITY_WORDS: Record<string, PickerCapability> = {
  vision: "vision",
  document: "documents",
  documents: "documents",
  reasoning: "reasoning",
};

function hasCapability(model: PickerSource, capability: PickerCapability): boolean {
  switch (capability) {
    case "vision":
      return model.inputModalities.includes("image");
    case "documents":
      return model.inputModalities.includes("document");
    case "reasoning":
      return model.reasoningEfforts.length > 0;
  }
}

/** A model's context floor is unknown when it is `0`, not the smallest window. */
function hasDeclaredContext(model: PickerSource): boolean {
  return model.contextWindowTokens > 0;
}

function matchesQuery(model: PickerSource, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return true;

  const haystacks = [
    model.name,
    model.label,
    model.modelId,
    model.provider.name,
    model.vendorLabel ?? "",
  ];
  if (haystacks.some((value) => value.toLowerCase().includes(query))) {
    return true;
  }

  return Object.entries(QUERY_CAPABILITY_WORDS).some(
    ([word, capability]) =>
      word.includes(query) && hasCapability(model, capability),
  );
}

/**
 * Apply the picker's filters. Groups AND together; values within a group OR.
 * An empty group is no constraint, so an empty query/selection list keeps every
 * model — including a BYOK model whose vendor is undeclared.
 */
export function filterModels<T extends PickerSource>(
  models: readonly T[],
  filters: PickerFilterState,
): T[] {
  return models.filter((model) => {
    if (!matchesQuery(model, filters.query)) return false;

    if (filters.vendors.length > 0) {
      const vendor = vendorOf(model);
      if (vendor === null || !filters.vendors.includes(vendor)) return false;
    }

    if (filters.connections.length > 0) {
      if (
        model.source !== "connection" ||
        !filters.connections.includes(model.provider.slug)
      ) {
        return false;
      }
    }

    if (
      filters.capabilities.length > 0 &&
      !filters.capabilities.some((capability) => hasCapability(model, capability))
    ) {
      return false;
    }

    if (filters.minContext !== null) {
      if (
        !hasDeclaredContext(model) ||
        model.contextWindowTokens < filters.minContext
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sort a copy of the list. Every comparator falls through to the input index on
 * a tie, so equal keys keep their relative order and the list does not jump
 * between renders.
 */
export function sortModels<T extends PickerSource>(
  models: readonly T[],
  sort: PickerSort,
): T[] {
  const indexed = models.map((model, index) => ({ model, index }));

  const compare = (a: (typeof indexed)[number], b: (typeof indexed)[number]): number => {
    const result = compareBy(a.model, b.model, sort);
    return result !== 0 ? result : a.index - b.index;
  };

  return indexed.sort(compare).map((entry) => entry.model);
}

function compareBy(a: PickerSource, b: PickerSource, sort: PickerSort): number {
  switch (sort) {
    case "default":
      return 0;

    case "name":
      return compareNames(a.name, b.name);

    case "price":
      return comparePrice(a.prices.input, b.prices.input);

    case "context":
      return compareContext(a.contextWindowTokens, b.contextWindowTokens);

    case "vendor": {
      const byVendor = compareVendors(vendorOf(a), vendorOf(b));
      return byVendor !== 0 ? byVendor : compareNames(a.name, b.name);
    }
  }
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Cheapest first; a null price has no place on the ladder, so it sorts last. */
function comparePrice(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Largest first; an undeclared window (`0`) sorts last, not smallest. */
function compareContext(a: number, b: number): number {
  const aKnown = a > 0;
  const bKnown = b > 0;
  if (!aKnown && !bKnown) return 0;
  if (!aKnown) return 1;
  if (!bKnown) return -1;
  return b - a;
}

/** Grouped by vendor; an unknown vendor sorts last rather than under a guess. */
function compareVendors(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/** Append `value` if the list does not already carry it. */
function appendUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/**
 * The facet values worth offering for this catalog. Only values that appear at
 * least once are returned, so a group that cannot discriminate is simply empty
 * and the component leaves its chip row out.
 */
export function pickerFacets(models: readonly PickerSource[]): {
  vendors: string[];
  connections: { slug: string; name: string }[];
  capabilities: PickerCapability[];
  contextThresholds: number[];
} {
  const vendors: string[] = [];
  const connections: { slug: string; name: string }[] = [];
  const capabilities: PickerCapability[] = [];

  for (const model of models) {
    const vendor = vendorOf(model);
    if (vendor !== null) appendUnique(vendors, vendor);

    if (model.source === "connection") {
      const known = connections.some(
        (connection) => connection.slug === model.provider.slug,
      );
      if (!known) {
        connections.push({ slug: model.provider.slug, name: model.provider.name });
      }
    }

    for (const capability of ["vision", "documents", "reasoning"] as const) {
      if (hasCapability(model, capability)) appendUnique(capabilities, capability);
    }
  }

  // A threshold is offered only when it *splits* the set: at least one model
  // meets it and at least one does not. A threshold every model meets, or none
  // meets, would produce a chip that changes nothing.
  const contextThresholds = CONTEXT_THRESHOLDS.filter((threshold) =>
    models.some(
      (model) =>
        hasDeclaredContext(model) && model.contextWindowTokens >= threshold,
    ) &&
    models.some(
      (model) =>
        !hasDeclaredContext(model) || model.contextWindowTokens < threshold,
    ),
  );

  return { vendors, connections, capabilities, contextThresholds };
}

/**
 * The height cap for the option list inside a panel that has `maxHeight` room.
 * The list is the only shrinkable row, so it takes the room left after the
 * fixed rows (search, filters, sorts, the action) — capped by the layout's own
 * base cap. A `null` room means the panel is not height-constrained (the
 * composer's own menu), so the base cap stands. Never negative: a viewport too
 * short for even the fixed rows lets the panel scroll as a last resort rather
 * than inverting the height.
 */
export function pickerListCap(
  baseCap: number,
  maxHeight: number | null,
  fixedRows: number,
): number {
  if (maxHeight === null) return baseCap;
  return Math.max(0, Math.min(baseCap, maxHeight - fixedRows));
}

/** Whether any filter is set. A whitespace-only query counts as unset. */
export function isFilterActive(filters: PickerFilterState): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.vendors.length > 0 ||
    filters.connections.length > 0 ||
    filters.capabilities.length > 0 ||
    filters.minContext !== null
  );
}
