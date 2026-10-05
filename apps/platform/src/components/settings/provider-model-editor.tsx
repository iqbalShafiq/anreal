import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { FormTextAreaField, FormTextField } from "#/components/ui/form-field";
import { Select } from "#/components/ui/select";
import { ToggleChip } from "#/components/ui/toggle-chip";
import { ReasoningEffortIcon } from "#/components/composer/model-reasoning-switcher";
import {
  ModelPickerMenu,
  gridColumnsForWidth,
} from "#/components/composer/model-picker-menu";
import {
  EMPTY_PICKER_FILTERS,
  LISTING_PICKER_SORTS,
  type PickerFilterState,
  type PickerModel,
  type PickerSort,
} from "#/lib/model-picker";
import {
  displayNameFromModelId,
  effortWarning,
  imageCapabilityDraft,
  imageCapabilityPayload,
  imageOutputTypeOptions,
  modelDraftFromPrefill,
  modelOutputType,
  modelSavePayload,
  slugPreview,
  vendorSuggestion,
  type ImageCapabilityDraft,
  type ImageCapabilityLimits,
  type ImageStyle,
} from "#/lib/provider-model-draft";
import {
  prefillProviderModel,
  type ListedProviderModel,
  type ModelInfo,
  type ProviderModelInput,
  type ProviderModelRow,
} from "#/lib/api";
import {
  issuesFromError,
  issuesToFieldErrors,
  type FieldErrors,
} from "#/components/skills/skill-issues";

/** Parse a limits input into a positive integer, `null` when blank. */
function parseLimit(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return "invalid";
  return parsed;
}

/** Small inline text action (All / Clear / Suggested), shared for one rhythm. */
const TEXT_BUTTON_CLASS =
  "shrink-0 cursor-pointer rounded-md border border-hairline px-2 py-0.5 text-[11px] text-text-muted transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/[0.06] hover:text-text disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The vendor names the catalog already files BYOK rows under: each one is a
 * `vendorLabel` some other model declared, so it stands in for the vendors a
 * user may be choosing between. Empty/whitespace labels are dropped, duplicates
 * are collapsed case-insensitively, and the labels keep their declared casing.
 * These are suggestions only — the vendor is never derived without the user.
 */
function declaredVendors(models: ModelInfo[]): string[] {
  const byKey = new Map<string, string>();
  for (const model of models) {
    const label = model.vendorLabel?.trim() ?? "";
    const key = label.toLowerCase();
    if (key.length > 0 && !byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.values()];
}

/** A compact list of vendor names for the field's helper line. */
function formatVendorExamples(vendors: string[]): string {
  const shown = vendors.slice(0, 4);
  const rest = vendors.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ");
}

/**
 * Registers or edits one model on a saved connection. Two ways in: pick one of
 * the provider's own models (discovery) or type an upstream id by hand. Either
 * way the server's prefill fills the display name, limits, and reasoning set,
 * so the API key never reaches the browser.
 */
export function ProviderModelEditor({
  connectionId,
  connectionSlug,
  connectionLabel,
  imageStyle,
  imageLimits,
  effortVocabulary,
  models,
  initial,
  saving,
  onSave,
  onCancel,
  onDiscover,
}: {
  connectionId: string;
  connectionSlug: string;
  /** The connection's label, shown as the source in the discovery hover card. */
  connectionLabel: string;
  imageStyle: ImageStyle;
  imageLimits: ImageCapabilityLimits | null;
  effortVocabulary: string[];
  /** The merged catalog, read only for the vendors other models declare. */
  models: ModelInfo[];
  initial: ProviderModelRow | null;
  saving: boolean;
  onSave: (input: ProviderModelInput) => Promise<void>;
  onCancel: () => void;
  onDiscover: () => Promise<ListedProviderModel[]>;
}) {
  const [mode, setMode] = useState<"discover" | "custom">(
    initial ? "custom" : "discover",
  );
  const [upstreamId, setUpstreamId] = useState(initial?.upstreamId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [contextWindowTokens, setContextWindowTokens] = useState(
    initial?.contextWindowTokens != null
      ? String(initial.contextWindowTokens)
      : "",
  );
  const [maxInputTokens, setMaxInputTokens] = useState(
    initial?.maxInputTokens != null ? String(initial.maxInputTokens) : "",
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    initial?.maxOutputTokens != null ? String(initial.maxOutputTokens) : "",
  );
  const [reasoningEfforts, setReasoningEfforts] = useState<string[]>(
    initial?.reasoningEfforts ?? [],
  );
  const [adapterEfforts, setAdapterEfforts] = useState<string[]>(
    initial?.reasoningEfforts ?? [],
  );
  const [providerReported, setProviderReported] = useState(true);
  const [iconSvg, setIconSvg] = useState(initial?.iconSvg ?? "");
  const [vendorLabel, setVendorLabel] = useState(initial?.vendorLabel ?? "");
  // Once the user edits the vendor by hand the suggestion stops overwriting it.
  const [vendorTouched, setVendorTouched] = useState(false);
  const [discovered, setDiscovered] = useState<ListedProviderModel[] | null>(
    null,
  );
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  // The discovery panel's search/filter/sort, owned here so they survive the
  // panel closing — the same session-scoped intent the composer keeps.
  const [pickerFilters, setPickerFilters] = useState<PickerFilterState>(
    EMPTY_PICKER_FILTERS,
  );
  const [pickerSort, setPickerSort] = useState<PickerSort>("default");
  const [prefilling, setPrefilling] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // The output type the editor submits; an existing image row keeps its value
  // so editing cannot corrupt it, and a text row starts as text.
  const [outputType, setOutputType] = useState<"text" | "image">(
    modelOutputType(initial?.outputType ?? null),
  );
  const [imageCapabilities, setImageCapabilities] = useState<ImageCapabilityDraft>(
    imageCapabilityDraft(initial?.imageCapabilities ?? null),
  );

  const busy = saving || prefilling;
  const isImage = outputType === "image";
  // The limits are published by the server (`GET /api/providers/kinds`) from the
  // tool's own cap, size table, and ratio rule; the platform keeps no copy.
  const limits = imageLimits;
  const wantsReasoning = outputType === "text";

  const loadModels = async () => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      setDiscovered(await onDiscover());
    } catch (error) {
      setDiscoverError(
        error instanceof Error ? error.message : "Could not load models",
      );
    } finally {
      setDiscovering(false);
    }
  };

  // Load the provider's inventory the first time Discover is shown.
  useEffect(() => {
    if (mode !== "discover" || discovered !== null || discovering) return;
    void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open
  }, [mode, discovered, discovering]);

  const applyPrefill = async (id: string) => {
    const trimmed = id.trim();
    if (trimmed.length === 0) return;
    setPrefilling(true);
    setErrors({});
    try {
      const prefill = await prefillProviderModel(connectionId, {
        upstreamId: trimmed,
      });
      const draft = modelDraftFromPrefill(prefill);
      // The display-name default is the id as words ("deepseek-v4-flash" →
      // "Deepseek V4 Flash"), not the raw slug; a separator-only id keeps the
      // server's fallback.
      const titleizedName = displayNameFromModelId(trimmed);
      setUpstreamId(trimmed);
      setName(titleizedName.length > 0 ? titleizedName : draft.name);
      setContextWindowTokens(draft.contextWindowTokens);
      setMaxInputTokens(draft.maxInputTokens);
      setMaxOutputTokens(draft.maxOutputTokens);
      setReasoningEfforts(draft.reasoningEfforts);
      setAdapterEfforts(prefill.reasoningEfforts);
      setProviderReported(draft.providerReported);
    } catch (error) {
      setErrors(issuesToFieldErrors(issuesFromError(error)));
    } finally {
      setPrefilling(false);
    }
  };

  const toggleEffort = (effort: string) => {
    setReasoningEfforts((current) =>
      current.includes(effort)
        ? current.filter((value) => value !== effort)
        : [...current, effort],
    );
  };

  // Seed the vendor suggestion source from the catalog. This preference order
  // keeps a vendor the user has already declared winning over the current
  // catalog, so reopening the editor does not lose a name that is not yet there.
  // The catalog scan depends only on `models`; the in-progress value is merged
  // on top so a keystroke in the vendor field does not re-derive it.
  const catalogVendors = useMemo(() => declaredVendors(models), [models]);
  const knownVendors = useMemo(() => {
    const current = vendorLabel.trim();
    const already = catalogVendors.some(
      (vendor) => vendor.toLowerCase() === current.toLowerCase(),
    );
    return current.length > 0 && !already
      ? [current, ...catalogVendors]
      : catalogVendors;
  }, [catalogVendors, vendorLabel]);

  // Offer — never apply — a vendor drawn from the upstream id's prefix. The
  // suggestion is shown as a button; only an explicit click writes the field.
  // Once the user has edited the vendor the offer is withdrawn, so a value they
  // have already overridden (or cleared) is never re-applied.
  const offeredVendor =
    vendorTouched || vendorLabel.trim().length > 0
      ? null
      : vendorSuggestion(upstreamId, knownVendors);
  const vendorHelper =
    knownVendors.length > 0
      ? `Optional. Which vendor made this model, e.g. ${formatVendorExamples(knownVendors)}. A label for filtering in the picker only — it does not affect routing.`
      : "Optional. Which vendor made this model. A label for filtering in the picker only — it does not affect routing.";

  const submit = async () => {
    setErrors({});
    if (upstreamId.trim().length === 0) {
      setErrors({ form: "A model id is required" });
      return;
    }
    const context = parseLimit(contextWindowTokens);
    const input = parseLimit(maxInputTokens);
    const output = parseLimit(maxOutputTokens);
    if (context === "invalid" || input === "invalid" || output === "invalid") {
      setErrors({ form: "Limits must be positive whole numbers" });
      return;
    }
    // An image model must declare a capability set the kind can honour; the
    // helper applies the same limits the server validates against, so a value
    // the server would refuse cannot leave the form.
    let capabilities: Record<string, unknown> | null = null;
    if (isImage) {
      if (!limits) {
        setErrors({ form: "This provider kind has no image endpoint" });
        return;
      }
      const built = imageCapabilityPayload(imageCapabilities, limits);
      if (!built.ok) {
        setErrors({ form: built.error });
        return;
      }
      capabilities = built.value;
    }
    try {
      await onSave(
        modelSavePayload({
          upstreamId: upstreamId.trim(),
          name,
          iconSvg,
          outputType,
          contextWindowTokens: context,
          maxInputTokens: input,
          maxOutputTokens: output,
          reasoningEfforts,
          imageCapabilities: capabilities,
          vendorLabel,
        }),
      );
    } catch (error) {
      setErrors(issuesToFieldErrors(issuesFromError(error)));
    }
  };

  /**
   * The provider's listing as picker rows. The picker contract is satisfied
   * structurally: capabilities and prices are unknown before registration, so
   * those facet groups simply never render for a listing.
   */
  const pickerModels = useMemo<PickerModel[]>(
    () =>
      (discovered ?? []).map((model) => {
        const name = model.name?.trim() || model.id;
        return {
          modelId: model.id,
          name,
          label: name,
          hint: model.name && model.name.trim() !== model.id ? model.id : null,
          provider: { slug: connectionSlug, name: connectionLabel },
          vendorLabel: null,
          source: "connection",
          inputModalities: [],
          reasoningEfforts: [],
          contextWindowTokens: model.contextLength ?? 0,
          prices: { input: null },
        };
      }),
    [discovered, connectionSlug, connectionLabel],
  );

  /**
   * The trigger's label source: the listing rows, plus the current id when the
   * listing does not contain it (a fresh edit, or a model the provider stopped
   * listing), so the field never reads "Select…" for a value it holds.
   */
  const triggerOptions = useMemo(() => {
    const rows: { value: string; label: string; hint?: string }[] =
      pickerModels.map((model) => ({
        value: model.modelId,
        label: model.name,
        hint: model.hint ?? undefined,
      }));
    const current = upstreamId.trim();
    if (current.length > 0 && !rows.some((row) => row.value === current)) {
      rows.unshift({
        value: current,
        label: displayNameFromModelId(current) || current,
      });
    }
    return rows;
  }, [pickerModels, upstreamId]);

  const warning = wantsReasoning
    ? effortWarning(reasoningEfforts, adapterEfforts)
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-white/[0.02] p-3.5">
      <h4 className="text-sm font-medium text-text">
        {initial ? "Edit model" : "New model"}
      </h4>

      {limits ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-text-muted">
            Output type
          </span>
          <Select
            value={outputType}
            onChange={(value) => {
              const next = value === "image" ? "image" : "text";
              setOutputType(next);
              // The server forces [] for an image model, so the UI drops the
              // reasoning set too rather than showing one it will discard.
              if (next === "image") setReasoningEfforts([]);
            }}
            options={imageOutputTypeOptions(imageStyle)}
            ariaLabel="Output type"
            disabled={busy}
          />
          <p className="text-[11px] text-text-faint">
            Image models appear in the composer's image picker, not the chat
            model list.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-text-muted">
          How to add
        </span>
        <Select
          value={mode}
          onChange={(value) => setMode(value === "custom" ? "custom" : "discover")}
          options={[
            { value: "discover", label: "Discover from provider" },
            { value: "custom", label: "Enter an id" },
          ]}
          ariaLabel="Model source"
          disabled={busy}
        />
      </div>

      {mode === "discover" ? (
        <div className="flex flex-col gap-2">
          {discovering ? (
            <p className="text-[11px] text-text-faint">Loading models…</p>
          ) : discoverError ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-danger" role="alert">
                {discoverError}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadModels()}
                disabled={busy}
              >
                Retry
              </Button>
            </div>
          ) : pickerModels.length === 0 ? (
            <p className="text-[11px] text-text-faint">
              The provider returned no models.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium tracking-wide text-text-muted">
                Model
              </span>
              <Select
                value={upstreamId}
                onChange={(value) => void applyPrefill(value)}
                options={triggerOptions}
                ariaLabel="Provider model"
                disabled={busy}
                panelHeight={440}
                renderPanel={({ close, id, width }) => (
                  // The composer's picker, chromed the same way its portal is,
                  // so search/filter/sort behave identically in both surfaces.
                  <div className="flex flex-col rounded-xl border border-white/[0.08] bg-canvas-elevated text-text shadow-[0_12px_40px_-12px_rgba(0,0,0,0.75)] animate-fade-in">
                    <ModelPickerMenu
                      id={id}
                      models={pickerModels}
                      value={upstreamId}
                      open
                      filters={pickerFilters}
                      onFiltersChange={setPickerFilters}
                      sort={pickerSort}
                      onSortChange={setPickerSort}
                      gridColumns={gridColumnsForWidth(width)}
                      sorts={LISTING_PICKER_SORTS}
                      onSelect={(selected) => {
                        void applyPrefill(selected);
                        close();
                      }}
                      onClose={close}
                    />
                  </div>
                )}
              />
              <p className="text-[11px] text-text-faint">
                Search, filter, and sort the provider's models; picking one fills
                the form below.
              </p>
            </div>
          )}
        </div>
      ) : (
        <FormTextField
          label="Model id"
          value={upstreamId}
          onChange={(event) => setUpstreamId(event.target.value)}
          onBlur={(event) => void applyPrefill(event.target.value)}
          placeholder="openai/gpt-5.6-luna"
          helper="The id the provider expects, sent upstream unchanged."
          disabled={busy}
        />
      )}

      <dl className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
        <dt className="text-[11px] uppercase tracking-wide text-text-faint">
          Model id
        </dt>
        <dd
          className="min-w-0 truncate text-xs text-text-muted"
          title={slugPreview(connectionSlug, upstreamId)}
        >
          {slugPreview(connectionSlug, upstreamId)}
        </dd>
      </dl>

      <FormTextField
        label="Display name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="GPT 5.6 Luna"
        helper="Shown in the model picker. Defaults to the id."
        disabled={busy}
      />

      <div className="flex flex-col gap-1.5">
        <FormTextField
          label="Vendor"
          value={vendorLabel}
          onChange={(event) => {
            setVendorTouched(true);
            setVendorLabel(event.target.value);
          }}
          placeholder="OpenAI"
          helper={vendorHelper}
          optional
          disabled={busy}
        />
        {offeredVendor ? (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                // An explicit click is the user declaring the vendor; this is
                // the one way the suggestion becomes the value.
                setVendorTouched(true);
                setVendorLabel(offeredVendor);
              }}
              disabled={busy}
              className={TEXT_BUTTON_CLASS}
            >
              Suggested: {offeredVendor}
            </button>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FormTextField
          label="Context"
          value={contextWindowTokens}
          onChange={(event) => setContextWindowTokens(event.target.value)}
          inputMode="numeric"
          numeric
          placeholder="200000"
          disabled={busy}
        />
        <FormTextField
          label="Max input"
          value={maxInputTokens}
          onChange={(event) => setMaxInputTokens(event.target.value)}
          inputMode="numeric"
          numeric
          placeholder="optional"
          disabled={busy}
        />
        <FormTextField
          label="Max output"
          value={maxOutputTokens}
          onChange={(event) => setMaxOutputTokens(event.target.value)}
          inputMode="numeric"
          numeric
          placeholder="optional"
          disabled={busy}
        />
      </div>
      {!providerReported ? (
        <p className="text-[11px] text-text-faint">
          The provider did not report a context window for this model — set one
          so conversations can be sized correctly.
        </p>
      ) : null}

      {isImage && limits ? (
        <fieldset className="flex flex-col gap-2.5 rounded-xl border border-white/[0.06] p-3">
          <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">
            Image capabilities
          </legend>
          <p className="text-[11px] text-text-faint">
            Validated against what this provider kind can actually generate.
          </p>
          <FormTextField
            label="Aspect ratios"
            value={imageCapabilities.aspectRatios}
            onChange={(event) =>
              setImageCapabilities((current) => ({
                ...current,
                aspectRatios: event.target.value,
              }))
            }
            placeholder="1:1, 16:9"
            helper="Comma-separated. At least one is required."
            disabled={busy}
          />
          {limits.sizing === "sizes" ? (
            <FormTextField
              label="Sizes"
              value={imageCapabilities.sizes}
              onChange={(event) =>
                setImageCapabilities((current) => ({
                  ...current,
                  sizes: event.target.value,
                }))
              }
              placeholder="1024x1024, 1280x720"
              helper="Comma-separated pixel sizes the model accepts."
              disabled={busy}
            />
          ) : (
            <FormTextField
              label="Resolutions"
              value={imageCapabilities.resolutions}
              onChange={(event) =>
                setImageCapabilities((current) => ({
                  ...current,
                  resolutions: event.target.value,
                }))
              }
              placeholder="1K, 2K"
              helper="Comma-separated resolutions the model accepts."
              disabled={busy}
            />
          )}
          <FormTextField
            label="Max images"
            value={imageCapabilities.nMax}
            onChange={(event) =>
              setImageCapabilities((current) => ({
                ...current,
                nMax: event.target.value,
              }))
            }
            inputMode="numeric"
            numeric
            placeholder={String(limits.nMax)}
            helper={
              limits.nMax > 1
                ? `Default ${limits.nMax}. Higher values are capped at ${limits.nMax}.`
                : "This provider kind generates one image per request."
            }
            disabled={busy}
          />
          {limits.supportsQuality ? (
            <FormTextField
              label="Quality"
              value={imageCapabilities.quality}
              onChange={(event) =>
                setImageCapabilities((current) => ({
                  ...current,
                  quality: event.target.value,
                }))
              }
              placeholder="low, high"
              helper="Optional. Comma-separated."
              optional
              disabled={busy}
            />
          ) : null}
          {limits.supportsBackground ? (
            <FormTextField
              label="Background"
              value={imageCapabilities.background}
              onChange={(event) =>
                setImageCapabilities((current) => ({
                  ...current,
                  background: event.target.value,
                }))
              }
              placeholder="transparent"
              helper="Optional. Comma-separated."
              optional
              disabled={busy}
            />
          ) : null}
        </fieldset>
      ) : null}

      {wantsReasoning ? (
        <fieldset className="flex flex-col gap-2.5 rounded-xl border border-white/[0.06] p-3">
          <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">
            Reasoning efforts
          </legend>
          {effortVocabulary.length === 0 ? (
            <p className="text-[11px] text-text-faint">
              No reasoning vocabulary is available.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-text-faint">
                Pick every effort this model accepts.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {effortVocabulary.map((effort) => (
                  <ToggleChip
                    key={effort}
                    label={effort}
                    pressed={reasoningEfforts.includes(effort)}
                    onToggle={() => toggleEffort(effort)}
                    disabled={busy}
                    size="md"
                    // The gauge is the composer's own level language: fill grows
                    // with the effort's rank, and `none` keeps the empty track.
                    icon={
                      <ReasoningEffortIcon
                        effort={effort === "none" ? null : effort}
                        efforts={effortVocabulary}
                        className="size-3.5 shrink-0"
                      />
                    }
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-faint">
                  {reasoningEfforts.length} selected
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Select all efforts"
                    onClick={() => setReasoningEfforts([...effortVocabulary])}
                    disabled={busy}
                    className={TEXT_BUTTON_CLASS}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    aria-label="Clear all efforts"
                    onClick={() => setReasoningEfforts([])}
                    disabled={busy}
                    className={TEXT_BUTTON_CLASS}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </>
          )}
          {adapterEfforts.length > 0 ? (
            <p className="text-[11px] text-text-faint">
              The provider declares: {adapterEfforts.join(", ")}.
            </p>
          ) : null}
          {warning ? (
            <p className="text-[11px] text-amber-400/90" role="status">
              {warning}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <FormTextAreaField
        label="Icon SVG"
        value={iconSvg}
        onChange={(event) => setIconSvg(event.target.value)}
        rows={3}
        placeholder="<svg …>"
        helper="Optional. Sanitized before it is rendered."
        optional
        disabled={busy}
      />

      {errors.form ? (
        <p className="text-[11px] text-danger" role="alert">
          {errors.form}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          disabled={busy}
        >
          {saving ? "Saving…" : initial ? "Save model" : "Add model"}
        </Button>
      </div>
    </div>
  );
}
