import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { FormTextField } from "#/components/ui/form-field";
import {
  KeyValueListField,
  type KeyValueRow,
} from "#/components/ui/key-value-list-field";
import { ManagementRow } from "#/components/ui/management-row";
import { ProviderModelEditor } from "#/components/settings/provider-model-editor";
import { Select } from "#/components/ui/select";
import {
  useProviderConnections,
  useProviderModels,
} from "#/hooks/use-provider-connections";
import {
  createProviderConnection,
  deleteProviderConnection,
  discoverProviderModels,
  listProviderKinds,
  listProviderModels,
  type ProviderConnection,
  type ProviderConnectionInput,
  type ProviderKindInfo,
} from "#/lib/api";
import {
  canSaveConnection,
  connectionSlugError,
  deriveConnectionSlug,
} from "#/lib/provider-model-draft";
import {
  issuesFromError,
  issuesToFieldErrors,
  type FieldErrors,
} from "#/components/skills/skill-issues";

const MAX_CONNECTIONS = 10;

const API_LABELS: Record<string, string> = {
  chat: "Chat completions",
  responses: "Responses",
};

/** Shared chrome for the icon-only model row actions (mirrors ManagementRow). */
const ROW_ICON_BUTTON_CLASS =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

type TestOutcome =
  | { ok: true; count: number }
  | { ok: false; message: string; issues: { path: string; message: string }[] };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function kindLabel(kinds: ProviderKindInfo[], kind: string): string {
  return kinds.find((info) => info.kind === kind)?.label ?? kind;
}

function kindImageStyle(
  kinds: ProviderKindInfo[],
  kind: string,
): ProviderKindInfo["imageStyle"] {
  return kinds.find((info) => info.kind === kind)?.imageStyle ?? "none";
}

/**
 * The Providers settings section: a list of BYOK connections with an inline
 * editor, and (once a connection is saved) its registered models. Lives inside
 * the settings modal, so the editor is inline rather than a nested dialog.
 */
export function ProvidersSection({ active }: { active: boolean }) {
  const connections = useProviderConnections(active);
  const [kinds, setKinds] = useState<ProviderKindInfo[] | null>(null);
  const [kindsError, setKindsError] = useState<string | null>(null);
  const [effortVocabulary, setEffortVocabulary] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null | undefined>(
    undefined,
  );
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Provider types and the effort vocabulary never change during a session.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await listProviderKinds();
        if (cancelled) return;
        setKinds(data.kinds);
        setEffortVocabulary(data.effortVocabulary);
      } catch {
        if (!cancelled) setKindsError("Could not load provider types");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Model counts are cosmetic; failures just show zero.
  useEffect(() => {
    if (!active || connections.data === null) return;
    const list = connections.data;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        list.map(async (connection) => {
          try {
            const models = await listProviderModels(connection.id);
            return [connection.id, models.length] as const;
          } catch {
            return [connection.id, 0] as const;
          }
        }),
      );
      if (!cancelled) setCounts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [active, connections.data]);

  const rows = connections.data ?? [];

  /**
   * Test a connection. An existing one probes its provider listing directly;
   * a new one has no server route without an id, so it is created, probed, and
   * rolled back — that keeps the save path the only thing that persists.
   */
  const runTest = async (
    input: ProviderConnectionInput,
    existingId: string | null,
  ): Promise<TestOutcome> => {
    if (existingId) {
      try {
        const models = await connections.discover(existingId);
        return { ok: true, count: models.length };
      } catch (error) {
        return {
          ok: false,
          message: messageOf(error, "Connection failed"),
          issues: issuesFromError(error),
        };
      }
    }

    let probeId: string | null = null;
    try {
      const created = await createProviderConnection(input);
      probeId = created.id;
      const models = await discoverProviderModels(created.id);
      return { ok: true, count: models.length };
    } catch (error) {
      return {
        ok: false,
        message: messageOf(error, "Connection failed"),
        issues: issuesFromError(error),
      };
    } finally {
      if (probeId) {
        try {
          await deleteProviderConnection(probeId);
        } catch {
          // Best effort: a stray probe connection is harmless but avoidable.
        }
      }
    }
  };

  const kindsLoading = kinds === null && kindsError === null;

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h3 className="text-sm font-medium text-text">Providers</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Bring your own API keys. Keys are stored encrypted server-side and
          never shown again.
        </p>
      </div>

      {connections.loading || kindsLoading ? (
        <div className="flex flex-col gap-3">
          <div className="skeleton-shimmer h-16 w-full rounded-xl" />
          <div className="skeleton-shimmer h-16 w-full rounded-xl" />
        </div>
      ) : connections.error && connections.data === null ? (
        <p className="text-sm text-danger" role="alert">
          {connections.error}
        </p>
      ) : kindsError ? (
        <p className="text-sm text-danger" role="alert">
          {kindsError}
        </p>
      ) : editingId !== undefined ? (
        <ProviderConnectionEditor
          key={editingId ?? "new"}
          initial={
            editingId
              ? rows.find((connection) => connection.id === editingId) ?? null
              : null
          }
          kinds={kinds ?? []}
          effortVocabulary={effortVocabulary}
          saving={connections.saving}
          onTest={runTest}
          onSave={async (input) => {
            await connections.save(editingId ?? null, input);
            setEditingId(undefined);
          }}
          onCancel={() => setEditingId(undefined)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-muted">
              {rows.length === 0
                ? "No providers yet — add your first connection."
                : "Keys are encrypted at rest. Toggle a connection to include its models."}
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditingId(null)}
              disabled={rows.length >= MAX_CONNECTIONS}
            >
              <Plus className="size-4" strokeWidth={2} />
              Add provider
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((connection) => {
              const count = counts[connection.id] ?? 0;
              return (
                <ManagementRow
                  key={connection.id}
                  title={connection.label}
                  subtitle={`${kindLabel(kinds ?? [], connection.kind)} · ${count} model${count === 1 ? "" : "s"}`}
                  leading={
                    <span
                      aria-hidden
                      className={`size-2 shrink-0 rounded-full ${connection.isActive ? "bg-emerald-400/80" : "bg-white/30"}`}
                    />
                  }
                  enabled={connection.isActive}
                  onToggle={() =>
                    void connections
                      .toggle(connection.id, !connection.isActive)
                      .catch(() => undefined)
                  }
                  toggleLabel={`Enable ${connection.label}`}
                  toggleTitle={connection.isActive ? "Enabled" : "Disabled"}
                  onEdit={() => setEditingId(connection.id)}
                  editLabel={`Edit ${connection.label}`}
                  onDelete={() => setDeleteId(connection.id)}
                  deleteLabel={`Delete ${connection.label}`}
                />
              );
            })}
          </ul>
          {connections.error ? (
            <p className="text-[11px] text-danger" role="alert">
              {connections.error}
            </p>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete provider connection?"
        description="Its registered models are removed too, and the stored API key is discarded. This cannot be undone."
        confirmLabel="Delete"
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteId(null);
        }}
        onConfirm={() => {
          if (!deleteId) return;
          setDeleting(true);
          void connections
            .remove(deleteId)
            .then(() => setDeleteId(null))
            .catch(() => undefined)
            .finally(() => setDeleting(false));
        }}
      />
    </div>
  );
}

function ProviderConnectionEditor({
  initial,
  kinds,
  effortVocabulary,
  saving,
  onTest,
  onSave,
  onCancel,
}: {
  initial: ProviderConnection | null;
  kinds: ProviderKindInfo[];
  effortVocabulary: string[];
  saving: boolean;
  onTest: (
    input: ProviderConnectionInput,
    existingId: string | null,
  ) => Promise<TestOutcome>;
  onSave: (input: ProviderConnectionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const isNew = initial === null;
  const [kind, setKind] = useState(initial?.kind ?? kinds[0]?.kind ?? "openai");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [api, setApi] = useState(initial?.api ?? "");
  const [apiKey, setApiKey] = useState("");
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>([]);
  const [headersTouched, setHeadersTouched] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestOutcome | null>(null);
  const [testedSignature, setTestedSignature] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const meta = kinds.find((info) => info.kind === kind) ?? null;
  const supportsBaseUrl = meta?.supportsBaseUrl ?? false;
  const requiresBaseUrl = meta?.requiresBaseUrl ?? false;
  const apiVariants = meta?.apiVariants ?? [];
  const effectiveApi = api || meta?.defaultApi || apiVariants[0] || "";
  const derivedSlug = deriveConnectionSlug(label);
  const effectiveSlug = slugTouched ? slug.trim() : derivedSlug;
  const slugDisplay = effectiveSlug.length > 0 ? effectiveSlug : derivedSlug;
  const headers = Object.fromEntries(
    headerRows
      .filter((row) => row.name.trim().length > 0)
      .map((row) => [row.name.trim(), row.value]),
  );
  const busy = saving || testing;

  const signature = JSON.stringify({
    kind,
    label: label.trim(),
    slug: effectiveSlug,
    baseUrl: baseUrl.trim(),
    api: effectiveApi,
    apiKey: apiKey.trim(),
    headers,
  });
  const testPassed = testedSignature !== null && testedSignature === signature;
  const canSave = canSaveConnection({ isNew, testPassed });
  const testOk = testResult?.ok === true && (!isNew || testPassed);

  const buildInput = (): ProviderConnectionInput => ({
    kind,
    label: label.trim(),
    ...(slugTouched && effectiveSlug.length > 0
      ? { slug: effectiveSlug }
      : {}),
    ...(supportsBaseUrl && baseUrl.trim().length > 0
      ? { baseUrl: baseUrl.trim() }
      : {}),
    ...(apiVariants.length > 1 && effectiveApi ? { api: effectiveApi } : {}),
    ...(apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {}),
    ...(headersTouched ? { headers } : {}),
  });

  const runTest = async () => {
    setTesting(true);
    setErrors({});
    setTestResult(null);
    try {
      const outcome = await onTest(buildInput(), initial?.id ?? null);
      setTestResult(outcome);
      if (outcome.ok) {
        setTestedSignature(signature);
      } else if (outcome.issues.length > 0) {
        setErrors(issuesToFieldErrors(outcome.issues));
      }
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    setErrors({});
    if (!canSave) return;
    if (label.trim().length === 0) {
      setErrors({ form: "A label is required" });
      return;
    }
    if (slugTouched) {
      const slugError = connectionSlugError(slug.trim());
      if (slugError) {
        setErrors({ form: slugError });
        return;
      }
    }
    try {
      await onSave(buildInput());
    } catch (error) {
      setErrors(issuesToFieldErrors(issuesFromError(error)));
    }
  };

  const rawError = errors.form ?? null;
  const headerError =
    rawError && /header|authorization/i.test(rawError) ? rawError : null;
  const reservedError = headerError ? null : rawError;
  const labelError =
    reservedError && /label/i.test(reservedError) ? reservedError : null;
  const slugServerError =
    reservedError && /slug/i.test(reservedError) ? reservedError : null;
  const baseUrlError =
    reservedError && /base url/i.test(reservedError) ? reservedError : null;
  const apiKeyError =
    reservedError && /api key/i.test(reservedError) ? reservedError : null;
  const formError =
    reservedError &&
    !labelError &&
    !slugServerError &&
    !baseUrlError &&
    !apiKeyError
      ? reservedError
      : null;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium text-text">
        {isNew ? "New provider connection" : "Edit provider connection"}
      </h3>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-text-muted">
          Provider
        </span>
        <Select
          value={kind}
          onChange={(value) => {
            setKind(value);
            setApi("");
            setTestResult(null);
          }}
          options={kinds.map((info) => ({
            value: info.kind,
            label: info.label,
            hint: info.credentialPlaceholder,
          }))}
          ariaLabel="Provider kind"
          disabled={busy}
        />
        {!isNew && initial && kind !== initial.kind ? (
          <p className="text-[11px] text-amber-400/90" role="status">
            Changing the provider kind may stop this connection's existing
            models from working.
          </p>
        ) : null}
      </div>

      <FormTextField
        label="Label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="My gateway"
        helper="Shown in the model picker and settings list."
        error={labelError}
        disabled={busy}
      />

      <FormTextField
        label="Slug"
        value={slugTouched ? slug : derivedSlug}
        onChange={(event) => {
          setSlugTouched(true);
          setSlug(event.target.value);
        }}
        placeholder="my-gateway"
        helper={`Model ids from this connection start with ${slugDisplay}/`}
        error={
          (slugTouched ? connectionSlugError(slug.trim()) : null) ??
          slugServerError
        }
        disabled={busy}
      />

      {supportsBaseUrl ? (
        <FormTextField
          label="Base URL"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.example.com/v1"
          helper={
            requiresBaseUrl
              ? "Required. Include the API root, for example /v1."
              : "Optional. Overrides the provider's default endpoint."
          }
          optional={!requiresBaseUrl}
          error={baseUrlError}
          disabled={busy}
        />
      ) : null}

      {apiVariants.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-text-muted">
            API
          </span>
          <Select
            value={effectiveApi}
            onChange={setApi}
            options={apiVariants.map((variant) => ({
              value: variant,
              label: API_LABELS[variant] ?? variant,
            }))}
            ariaLabel="API shape"
            disabled={busy}
          />
        </div>
      ) : null}

      <FormTextField
        label="API key"
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={
          initial?.hasCredentials
            ? "••••••••"
            : meta?.credentialPlaceholder ?? "API key"
        }
        helper="Stored server-side only, never shown again."
        optional={initial?.hasCredentials ?? false}
        error={apiKeyError}
        disabled={busy}
      />

      <KeyValueListField
        label="Custom headers"
        rows={headerRows}
        onChange={(next) => {
          setHeaderRows(next);
          setHeadersTouched(true);
        }}
        addLabel="Add header"
        namePlaceholder="X-Api-Key"
        valuePlaceholder="value"
        helper="Optional gateway headers. Authorization is reserved for the API key field."
        error={headerError}
        maxRows={16}
        secretValues
        disabled={busy}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runTest()}
          disabled={busy}
        >
          {testing ? "Testing…" : testOk ? "Re-test" : "Test connection"}
        </Button>
        {testOk && testResult?.ok ? (
          <span className="text-[11px] text-emerald-400/90" role="status">
            {testResult.count} model{testResult.count === 1 ? "" : "s"} found
          </span>
        ) : testResult && !testResult.ok ? (
          <span className="text-[11px] text-danger" role="alert">
            {testResult.message}
          </span>
        ) : null}
      </div>
      {isNew ? (
        <p className="text-[11px] text-text-faint">
          Test the connection before saving — a bad key fails here, not
          mid-conversation.
        </p>
      ) : null}

      {formError ? (
        <p className="text-[11px] text-danger" role="alert">
          {formError}
        </p>
      ) : null}

      {!isNew && initial ? (
        <ConnectionModels
          connection={initial}
          kinds={kinds}
          effortVocabulary={effortVocabulary}
        />
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !canSave}
        >
          {saving ? "Saving…" : isNew ? "Add provider" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ConnectionModels({
  connection,
  kinds,
  effortVocabulary,
}: {
  connection: ProviderConnection;
  kinds: ProviderKindInfo[];
  effortVocabulary: string[];
}) {
  const models = useProviderModels(connection.id, true);
  const [editingModelId, setEditingModelId] = useState<
    string | null | undefined
  >(undefined);
  const [deleteModelId, setDeleteModelId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rows = models.data ?? [];

  return (
    <section className="flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-text">Models</h4>
        {editingModelId === undefined ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditingModelId(null)}
          >
            <Plus className="size-3.5" strokeWidth={2} />
            Add model
          </Button>
        ) : null}
      </div>

      {models.loading && models.data === null ? (
        <div className="skeleton-shimmer h-14 w-full rounded-xl" />
      ) : models.error && models.data === null ? (
        <p className="text-[11px] text-danger" role="alert">
          {models.error}
        </p>
      ) : editingModelId !== undefined ? (
        <ProviderModelEditor
          key={editingModelId ?? "new"}
          connectionId={connection.id}
          connectionSlug={connection.slug}
          imageStyle={kindImageStyle(kinds, connection.kind)}
          effortVocabulary={effortVocabulary}
          initial={
            editingModelId
              ? rows.find((model) => model.id === editingModelId) ?? null
              : null
          }
          saving={models.saving}
          onDiscover={() => models.discover(connection.id)}
          onSave={async (input) => {
            await models.save(editingModelId ?? null, input);
            setEditingModelId(undefined);
          }}
          onCancel={() => setEditingModelId(undefined)}
        />
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-text-faint">
          No models yet — add the ones you want in the picker.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((model) => (
            <li
              key={model.id}
              className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">
                  {model.name}
                </p>
                <p className="truncate text-[11px] text-text-faint">
                  {model.upstreamId}
                  {model.outputType === "image" ? " · image" : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Edit ${model.name}`}
                title={`Edit ${model.name}`}
                onClick={() => setEditingModelId(model.id)}
                className={`${ROW_ICON_BUTTON_CLASS} text-text-muted hover:bg-white/[0.08] hover:text-text`}
              >
                <Pencil className="size-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${model.name}`}
                title={`Delete ${model.name}`}
                onClick={() => setDeleteModelId(model.id)}
                className={`${ROW_ICON_BUTTON_CLASS} text-text-faint hover:bg-danger-soft hover:text-danger`}
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {models.error && models.data !== null ? (
        <p className="text-[11px] text-danger" role="alert">
          {models.error}
        </p>
      ) : null}

      <ConfirmDialog
        open={deleteModelId !== null}
        title="Delete model?"
        description="It will no longer appear in the model picker. This cannot be undone."
        confirmLabel="Delete"
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteModelId(null);
        }}
        onConfirm={() => {
          if (!deleteModelId) return;
          setDeleting(true);
          void models
            .remove(deleteModelId)
            .then(() => setDeleteModelId(null))
            .catch(() => undefined)
            .finally(() => setDeleting(false));
        }}
      />
    </section>
  );
}

