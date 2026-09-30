import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { FormTextAreaField, FormTextField } from "#/components/ui/form-field";
import { Select } from "#/components/ui/select";
import {
  effortWarning,
  modelDraftFromPrefill,
  modelOutputType,
  slugPreview,
} from "#/lib/provider-model-draft";
import {
  prefillProviderModel,
  type ListedProviderModel,
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

/**
 * Registers or edits one model on a saved connection. Two ways in: pick one of
 * the provider's own models (discovery) or type an upstream id by hand. Either
 * way the server's prefill fills the display name, limits, and reasoning set,
 * so the API key never reaches the browser.
 */
export function ProviderModelEditor({
  connectionId,
  connectionSlug,
  effortVocabulary,
  initial,
  saving,
  onSave,
  onCancel,
  onDiscover,
}: {
  connectionId: string;
  connectionSlug: string;
  effortVocabulary: string[];
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
  const [discovered, setDiscovered] = useState<ListedProviderModel[] | null>(
    null,
  );
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [prefilling, setPrefilling] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Text is the only registerable output type until BYOK image generation ships
  // (Phase D); an existing image row keeps its value so editing cannot corrupt
  // it.
  const outputType = modelOutputType(initial?.outputType ?? null);
  const busy = saving || prefilling;
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
      setUpstreamId(trimmed);
      setName(draft.name);
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
    try {
      await onSave({
        upstreamId: upstreamId.trim(),
        name: name.trim() || undefined,
        iconSvg: iconSvg.trim() || undefined,
        outputType,
        contextWindowTokens: context,
        maxInputTokens: input,
        maxOutputTokens: output,
        reasoningEfforts: wantsReasoning ? reasoningEfforts : [],
      });
    } catch (error) {
      setErrors(issuesToFieldErrors(issuesFromError(error)));
    }
  };

  const normalizedFilter = filter.trim().toLowerCase();
  const options = (discovered ?? [])
    .filter(
      (model) =>
        normalizedFilter.length === 0 ||
        model.id.toLowerCase().includes(normalizedFilter) ||
        (model.name ?? "").toLowerCase().includes(normalizedFilter),
    )
    .map((model) => ({
      value: model.id,
      label: model.name?.trim() || model.id,
      hint: model.name && model.name.trim() !== model.id ? model.id : undefined,
    }));

  const warning = wantsReasoning
    ? effortWarning(reasoningEfforts, adapterEfforts)
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-white/[0.02] p-3.5">
      <h4 className="text-sm font-medium text-text">
        {initial ? "Edit model" : "New model"}
      </h4>

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
          <FormTextField
            label="Search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter the provider's models"
            disabled={busy || discovering}
          />
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
          ) : options.length === 0 ? (
            <p className="text-[11px] text-text-faint">
              {(discovered ?? []).length === 0
                ? "The provider returned no models."
                : "No models match that filter."}
            </p>
          ) : (
            <Select
              value={upstreamId}
              onChange={(value) => void applyPrefill(value)}
              options={options}
              ariaLabel="Provider model"
              disabled={busy}
            />
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
      <div className="grid grid-cols-3 gap-2">
        <FormTextField
          label="Context"
          value={contextWindowTokens}
          onChange={(event) => setContextWindowTokens(event.target.value)}
          inputMode="numeric"
          placeholder="200000"
          disabled={busy}
        />
        <FormTextField
          label="Max input"
          value={maxInputTokens}
          onChange={(event) => setMaxInputTokens(event.target.value)}
          inputMode="numeric"
          placeholder="optional"
          disabled={busy}
        />
        <FormTextField
          label="Max output"
          value={maxOutputTokens}
          onChange={(event) => setMaxOutputTokens(event.target.value)}
          inputMode="numeric"
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

      {wantsReasoning ? (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-white/[0.06] p-3">
          <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">
            Reasoning efforts
          </legend>
          {effortVocabulary.length === 0 ? (
            <p className="text-[11px] text-text-faint">
              No reasoning vocabulary is available.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {effortVocabulary.map((effort) => (
                <label
                  key={effort}
                  className="flex cursor-pointer items-center gap-2 text-xs text-text"
                >
                  <input
                    type="checkbox"
                    checked={reasoningEfforts.includes(effort)}
                    onChange={() => toggleEffort(effort)}
                    disabled={busy}
                    className="accent-[var(--color-accent)]"
                  />
                  {effort}
                </label>
              ))}
            </div>
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
