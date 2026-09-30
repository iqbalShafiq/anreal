import {
  PROVIDER_KIND_META,
  PROVIDER_KINDS,
  createCompletionModelFor,
  describeModel,
  effortVocabulary,
  listProviderModels,
  redactProviderError,
  type ModelContextLimits,
  type ProviderCredentials,
  type ProviderKind,
  type ProviderKindMeta,
} from "@anreal/agent";
import {
  decodeProviderCredentials,
  encodeProviderCredentials,
  sanitizeHeaders,
} from "./credentials.js";
import {
  deriveConnectionSlug,
  deriveModelSlug,
  isReservedConnectionSlug,
  PROVIDER_MODEL_SLUG_RE,
  MAX_SLUG_ATTEMPTS,
  suffixSlug,
} from "../../lib/provider-slug.js";
import { SKILL_NAME_RE } from "../skills/service.js";

export const MAX_CONNECTIONS_PER_USER = 10;
export const MAX_MODELS_PER_USER = 100;
export const CONNECTION_LABEL_MAX = 80;
export const MODEL_NAME_MAX = 120;
export const MODEL_HINT_MAX = 120;
export const MODEL_DESCRIPTION_MAX = 500;
export const MODEL_UPSTREAM_ID_MAX = 256;
export const ICON_SVG_MAX = 8_000;

export type ProviderIssue = { path: string; message: string };

export class ProviderInputError extends Error {
  readonly issues: ProviderIssue[];
  constructor(issues: ProviderIssue[]) {
    super(issues[0]?.message ?? "Invalid provider configuration");
    this.name = "ProviderInputError";
    this.issues = issues;
  }
}

function fail(path: string, message: string): never {
  throw new ProviderInputError([{ path, message }]);
}

export type ProviderConnectionInput = {
  kind?: unknown;
  label?: unknown;
  slug?: unknown;
  baseUrl?: unknown;
  api?: unknown;
  apiKey?: unknown;
  headers?: unknown;
};

export type ValidatedConnectionInput = {
  kind: ProviderKind;
  label: string;
  slug: string;
  baseUrl: string | null;
  api: "chat" | "responses" | null;
  apiKey: string;
  headers: Record<string, string> | null;
};

function isProviderKind(value: unknown): value is ProviderKind {
  return (
    typeof value === "string" &&
    (PROVIDER_KINDS as readonly string[]).includes(value)
  );
}

/** https, or http only for a loopback host during local development. */
function validateBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("baseUrl", "Base URL must be a valid absolute URL");
  }
  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    return fail("baseUrl", "Base URL must use https, except for localhost");
  }
  return value;
}

export function validateConnectionInput(
  input: ProviderConnectionInput,
  existingSlugs: readonly string[],
  connectionCount: number,
): ValidatedConnectionInput {
  if (connectionCount >= MAX_CONNECTIONS_PER_USER) {
    fail(
      "kind",
      `You can add at most ${MAX_CONNECTIONS_PER_USER} provider connections`,
    );
  }

  if (!isProviderKind(input.kind)) {
    fail(
      "kind",
      `Provider kind must be one of: ${PROVIDER_KINDS.join(", ")}`,
    );
  }
  const kind: ProviderKind = input.kind;
  const meta: ProviderKindMeta = PROVIDER_KIND_META[kind];

  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (label.length === 0 || label.length > CONNECTION_LABEL_MAX) {
    fail("label", `Label must be 1-${CONNECTION_LABEL_MAX} characters`);
  }

  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (apiKey.length === 0) {
    fail("apiKey", "An API key is required");
  }

  const rawBaseUrl =
    typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  if (rawBaseUrl.length === 0) {
    if (meta.requiresBaseUrl) {
      fail("baseUrl", "A base URL is required for this provider kind");
    }
  }
  const baseUrl =
    rawBaseUrl.length > 0 ? validateBaseUrl(rawBaseUrl) : null;

  const api = (() => {
    const requested =
      typeof input.api === "string" && input.api.trim().length > 0
        ? input.api.trim()
        : null;
    if (requested === null) return meta.defaultApi;
    if (!(meta.apiVariants as readonly string[]).includes(requested)) {
      fail(
        "api",
        meta.apiVariants.length === 0
          ? `${meta.label} does not accept an api option`
          : `Api must be one of: ${meta.apiVariants.join(", ")}`,
      );
    }
    return requested as "chat" | "responses";
  })();

  const headers = (() => {
    const result = sanitizeHeaders(input.headers);
    if (!result.ok) fail("headers", result.message);
    return result.headers;
  })();

  const provided =
    typeof input.slug === "string" && input.slug.trim().length > 0
      ? input.slug.trim()
      : null;
  if (provided !== null && !SKILL_NAME_RE.test(provided)) {
    fail(
      "slug",
      "Slug must be lowercase letters, numbers, and hyphens, e.g. my-openrouter",
    );
  }
  const baseSlug = provided ?? deriveConnectionSlug(label);
  if (isReservedConnectionSlug(baseSlug)) {
    fail(
      "slug",
      `"${baseSlug}" is a reserved namespace; choose another slug`,
    );
  }
  const taken = new Set(existingSlugs);
  let slug = baseSlug;
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = suffixSlug(baseSlug, attempt);
    if (!taken.has(candidate)) {
      slug = candidate;
      break;
    }
    if (attempt === 50) {
      fail("slug", "Could not derive a unique slug; choose another one");
    }
  }

  return { kind, label, slug, baseUrl, api, apiKey, headers };
}

export type ProviderModelInput = {
  upstreamId?: unknown;
  name?: unknown;
  label?: unknown;
  hint?: unknown;
  description?: unknown;
  iconSvg?: unknown;
  outputType?: unknown;
  contextWindowTokens?: unknown;
  maxInputTokens?: unknown;
  maxOutputTokens?: unknown;
  reasoningEfforts?: unknown;
};

export type ValidatedModelInput = {
  upstreamId: string;
  name: string;
  label: string;
  hint: string | null;
  description: string | null;
  iconSvg: string;
  outputType: "text" | "image";
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
};

function optionalBoundedText(
  path: string,
  value: unknown,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return fail(path, `${path} must be text`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    return fail(path, `${path} must be at most ${max} characters`);
  }
  return trimmed;
}

function optionalPositiveInteger(path: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return fail(path, `${path} must be a positive whole number`);
  }
  return value;
}

export function validateModelInput(
  input: ProviderModelInput,
  meta: Pick<ProviderKindMeta, "imageStyle">,
): ValidatedModelInput {
  const upstreamId =
    typeof input.upstreamId === "string" ? input.upstreamId.trim() : "";
  if (upstreamId.length === 0 || upstreamId.length > MODEL_UPSTREAM_ID_MAX) {
    fail(
      "upstreamId",
      `Model id must be 1-${MODEL_UPSTREAM_ID_MAX} characters`,
    );
  }

  const requestedOutputType =
    input.outputType === undefined ? "text" : input.outputType;
  if (requestedOutputType !== "text" && requestedOutputType !== "image") {
    fail("outputType", "Output type must be text or image");
  }
  const outputType: "text" | "image" = requestedOutputType;
  if (outputType === "image" && meta.imageStyle === "none") {
    fail(
      "outputType",
      "This provider kind has no image endpoint; connect an OpenAI-compatible gateway to use image models",
    );
  }

  const vocabulary = effortVocabulary();
  const reasoningEfforts =
    outputType === "image"
      ? []
      : (() => {
          const raw = input.reasoningEfforts;
          if (raw === undefined || raw === null) return [];
          if (!Array.isArray(raw)) {
            fail("reasoningEfforts", "Reasoning efforts must be a list");
          }
          const seen = new Set<string>();
          for (const value of raw) {
            if (typeof value !== "string" || !vocabulary.includes(value)) {
              fail(
                "reasoningEfforts",
                `Reasoning effort must be one of: ${vocabulary.join(", ")}`,
              );
            }
            seen.add(value);
          }
          return vocabulary.filter((effort) => seen.has(effort));
        })();

  const contextWindowTokens = optionalPositiveInteger(
    "contextWindowTokens",
    input.contextWindowTokens,
  );
  const maxInputTokens = optionalPositiveInteger(
    "maxInputTokens",
    input.maxInputTokens,
  );
  const maxOutputTokens = optionalPositiveInteger(
    "maxOutputTokens",
    input.maxOutputTokens,
  );
  if (
    contextWindowTokens !== null &&
    maxInputTokens !== null &&
    maxInputTokens > contextWindowTokens
  ) {
    fail(
      "maxInputTokens",
      "Input budget cannot exceed the context window",
    );
  }
  if (
    contextWindowTokens !== null &&
    maxInputTokens !== null &&
    maxOutputTokens !== null &&
    maxInputTokens + maxOutputTokens > contextWindowTokens
  ) {
    fail(
      "maxOutputTokens",
      "Input and output budgets cannot exceed the context window",
    );
  }

  const name = optionalBoundedText("name", input.name, MODEL_NAME_MAX);
  const label = optionalBoundedText("label", input.label, MODEL_NAME_MAX);

  return {
    upstreamId,
    name: name ?? upstreamId,
    label: label ?? name ?? upstreamId,
    hint: optionalBoundedText("hint", input.hint, MODEL_HINT_MAX),
    description: optionalBoundedText(
      "description",
      input.description,
      MODEL_DESCRIPTION_MAX,
    ),
    iconSvg:
      typeof input.iconSvg === "string" && input.iconSvg.length <= ICON_SVG_MAX
        ? input.iconSvg
        : "",
    outputType,
    contextWindowTokens,
    maxInputTokens,
    maxOutputTokens,
    reasoningEfforts,
  };
}

// --- Connection CRUD --------------------------------------------------------

/**
 * Duck-typed so focused tests can inject a fake without a Prisma client,
 * mirroring `SkillsDb` in modules/skills/service.ts.
 */
export type ProviderConnectionsDb = {
  providerConnection: {
    count(args?: unknown): Promise<number>;
    findMany(args: unknown): Promise<unknown[]>;
    findFirst(args: unknown): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
};

type ConnectionRow = {
  id: string;
  userId: string;
  kind: string;
  label: string;
  slug: string;
  baseUrl: string | null;
  api: string | null;
  credentialsRef: string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function notFound(path = "id"): never {
  throw new ProviderInputError([
    { path, message: "Connection not found" },
  ]);
}

function isBlankKey(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

/** A plain object with at least one key (used to detect supplied headers). */
function isNonEmptyRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

async function findOwnedConnection(
  db: ProviderConnectionsDb,
  userId: string,
  id: string,
): Promise<ConnectionRow | null> {
  const row = await db.providerConnection.findFirst({ where: { id, userId } });
  return (row as ConnectionRow | null) ?? null;
}

async function collectConnectionSlugs(
  db: ProviderConnectionsDb,
  userId: string,
  exclude?: string,
): Promise<string[]> {
  const rows = (await db.providerConnection.findMany({
    where: { userId },
    select: { slug: true },
  })) as { slug?: unknown }[];
  return rows
    .map((row) => row.slug)
    .filter((slug): slug is string => typeof slug === "string")
    .filter((slug) => slug !== exclude);
}

/** Never expose the credential reference or the API key. */
export function toPublicConnection(row: Omit<ConnectionRow, "userId">) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    slug: row.slug,
    baseUrl: row.baseUrl,
    api: row.api,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    hasCredentials:
      typeof row.credentialsRef === "string" && row.credentialsRef.length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listConnections(
  db: ProviderConnectionsDb,
  userId: string,
) {
  const rows = (await db.providerConnection.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })) as ConnectionRow[];
  return rows.map(toPublicConnection);
}

export async function createConnection(
  db: ProviderConnectionsDb,
  userId: string,
  input: ProviderConnectionInput,
) {
  const [count, slugs] = await Promise.all([
    db.providerConnection.count({ where: { userId } }),
    collectConnectionSlugs(db, userId),
  ]);
  const value = validateConnectionInput(input, slugs, count);
  const created = (await db.providerConnection.create({
    data: {
      userId,
      kind: value.kind,
      label: value.label,
      slug: value.slug,
      baseUrl: value.baseUrl,
      api: value.api,
      credentialsRef: encodeProviderCredentials({
        apiKey: value.apiKey,
        headers: value.headers,
      }),
    },
  })) as Omit<ConnectionRow, "userId">;
  return toPublicConnection(created);
}

export async function updateConnection(
  db: ProviderConnectionsDb,
  userId: string,
  id: string,
  input: ProviderConnectionInput,
) {
  const row = await findOwnedConnection(db, userId, id);
  if (!row) notFound();

  // An omitted or blank key means "keep the stored credential" � the browser
  // never receives the key back, so it cannot resend it.
  const apiKey = isBlankKey(input.apiKey)
    ? decodeProviderCredentials(row.credentialsRef).apiKey
    : input.apiKey;

  const slugs = await collectConnectionSlugs(db, userId, row.slug);
  const value = validateConnectionInput({ ...input, apiKey }, slugs, 0);

  const updated = (await db.providerConnection.update({
    where: { id },
    data: {
      kind: value.kind,
      label: value.label,
      slug: value.slug,
      baseUrl: value.baseUrl,
      api: value.api,
      credentialsRef: encodeProviderCredentials({
        apiKey: value.apiKey,
        headers: value.headers,
      }),
    },
  })) as Omit<ConnectionRow, "userId">;
  return toPublicConnection(updated);
}

export async function deleteConnection(
  db: ProviderConnectionsDb,
  userId: string,
  id: string,
): Promise<void> {
  const row = await findOwnedConnection(db, userId, id);
  if (!row) notFound();
  await db.providerConnection.delete({ where: { id } });
}

/** Flip a connection's active flag; mirrors `setSkillEnabled`. */
export async function setConnectionEnabled(
  db: ProviderConnectionsDb,
  userId: string,
  id: string,
  isEnabled: boolean,
) {
  const row = await findOwnedConnection(db, userId, id);
  if (!row) notFound();
  const updated = (await db.providerConnection.update({
    where: { id },
    data: { isActive: isEnabled },
  })) as Omit<ConnectionRow, "userId">;
  return toPublicConnection(updated);
}
// --- Model CRUD, discovery, and prefill -------------------------------------

export type ProviderModelsDb = ProviderConnectionsDb & {
  chatModel: {
    findFirst(args: unknown): Promise<unknown | null>;
  };
  providerModel: {
    count(args?: unknown): Promise<number>;
    findMany(args: unknown): Promise<unknown[]>;
    findFirst(args: unknown): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
};

type ModelRow = {
  id: string;
  slug: string;
  upstreamId: string;
  name: string;
  label: string;
  hint: string | null;
  description: string | null;
  iconSvg: string;
  outputType: string;
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
  capabilities: unknown;
  imageCapabilities: unknown;
  isActive: boolean;
  sortOrder: number;
  connectionId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type ModelPrefill = {
  name: string;
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  capabilities: Record<string, unknown> | null;
  /** False when the adapter has no limits-table entry for the id. */
  providerReported: boolean;
};

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

/**
 * Turn a provider listing failure into a readable, credential-free message.
 * Some gateways report the status only inside the message body, so a bare
 * 401/403 in the text is treated as an auth failure too.
 */
function mapListingError(error: unknown, secrets: readonly string[]): string {
  const status = statusCodeOf(error);
  const text = error instanceof Error ? error.message : String(error);
  const authFailure =
    status !== undefined
      ? status === 401 || status === 403
      : /(^|\D)40[13](\D|$)/.test(text);
  if (authFailure) {
    return "The provider reported an invalid API key; check the key and its model-list permissions";
  }
  if (status === 404) {
    return "The provider has no model list at this base URL; check that it includes the API root (for example /v1)";
  }
  if (status === 429) {
    return "The provider rate limit was reached; try again shortly";
  }
  return redactProviderError(error, secrets);
}

/** Never expose the credential reference; model rows carry no secrets. */
export function toPublicModel(row: ModelRow) {
  return {
    id: row.id,
    slug: row.slug,
    upstreamId: row.upstreamId,
    name: row.name,
    label: row.label,
    hint: row.hint,
    description: row.description,
    iconSvg: row.iconSvg,
    outputType: row.outputType === "image" ? "image" : "text",
    contextWindowTokens: row.contextWindowTokens,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    reasoningEfforts: [...row.reasoningEfforts],
    capabilities: row.capabilities ?? null,
    imageCapabilities: row.imageCapabilities ?? null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    connectionId: row.connectionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireConnection(
  db: ProviderConnectionsDb,
  userId: string,
  connectionId: string,
): Promise<ConnectionRow> {
  const row = await findOwnedConnection(db, userId, connectionId);
  if (!row) notFound("connectionId");
  return row;
}

async function requireOwnedModel(
  db: ProviderModelsDb,
  userId: string,
  connectionId: string,
  modelId: string,
): Promise<ModelRow> {
  const row = (await db.providerModel.findFirst({
    where: { id: modelId, connectionId, userId },
  })) as ModelRow | null;
  if (!row) notFound("modelId");
  return row;
}

function connectionProviderKind(connection: ConnectionRow): ProviderKind {
  const kind = connection.kind as ProviderKind;
  if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) {
    fail("kind", "Connection provider kind is not recognised");
  }
  return kind;
}

function modelCredentials(connection: ConnectionRow): ProviderCredentials {
  const stored = decodeProviderCredentials(connection.credentialsRef);
  return {
    apiKey: stored.apiKey,
    baseUrl: connection.baseUrl,
    headers: stored.headers ?? null,
  };
}

/** Build the model once and read the adapter's own declaration back out. */
export async function prefillModelFromUpstream(input: {
  kind: ProviderKind;
  upstreamId: string;
  credentials: ProviderCredentials;
  contextLimits?: ModelContextLimits | null;
  reasoningEfforts?: readonly string[] | null;
}): Promise<ModelPrefill> {
  const model = createCompletionModelFor({
    kind: input.kind,
    upstreamId: input.upstreamId,
    credentials: input.credentials,
    contextLimits: input.contextLimits ?? null,
    reasoningEfforts: input.reasoningEfforts ?? null,
  });
  const description = describeModel(model);
  const limits = description.contextLimits;
  return {
    name: description.modelId,
    contextWindowTokens: limits?.contextWindow ?? null,
    maxInputTokens: limits?.maxInputTokens ?? null,
    maxOutputTokens: limits?.maxOutputTokens ?? null,
    reasoningEfforts: description.reasoningEfforts,
    defaultReasoningEffort: description.defaultReasoningEffort,
    capabilities: description.capabilities,
    providerReported: limits !== null,
  };
}

export async function discoverConnectionModels(
  db: ProviderConnectionsDb,
  userId: string,
  connectionId: string,
) {
  const connection = await requireConnection(db, userId, connectionId);
  const credentials = modelCredentials(connection);
  try {
    return await listProviderModels({
      kind: connectionProviderKind(connection),
      credentials,
    });
  } catch (error) {
    return fail(
      "baseUrl",
      mapListingError(error, [credentials.apiKey ?? ""]),
    );
  }
}

/**
 * Probe a provider without persisting anything, mirroring the MCP
 * `POST /mcp-servers/test` route. A blank api key reuses an owned connection's
 * stored credential (and stored headers when none are supplied), so editing a
 * connection never requires re-entering it. Everything save would reject is
 * validated here first, so the test cannot accept what saving would refuse.
 */
export async function testProviderConnection(
  db: ProviderConnectionsDb,
  userId: string,
  input: {
    kind: string;
    baseUrl?: string | null;
    /** Accepted for editor parity; model listing does not depend on it. */
    api?: string | null;
    apiKey?: string | null;
    headers?: unknown;
    /** Reuse this owned connection's stored credential when apiKey is blank. */
    connectionId?: string | null;
  },
): Promise<{ ok: true; modelCount: number }> {
  if (!isProviderKind(input.kind)) {
    fail("kind", `Provider kind must be one of: ${PROVIDER_KINDS.join(", ")}`);
  }
  const kind: ProviderKind = input.kind;
  const meta = PROVIDER_KIND_META[kind];

  let apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  let rawHeaders = input.headers;

  if (apiKey.length === 0) {
    if (!input.connectionId) {
      fail("apiKey", "An API key is required");
    }
    const connection = await findOwnedConnection(db, userId, input.connectionId);
    if (!connection) notFound();
    const stored = decodeProviderCredentials(connection.credentialsRef);
    apiKey = stored.apiKey;
    if (!isNonEmptyRecord(rawHeaders)) rawHeaders = stored.headers ?? null;
  }

  const sanitized = sanitizeHeaders(rawHeaders);
  if (!sanitized.ok) fail("headers", sanitized.message);

  const rawBaseUrl =
    typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  let baseUrl: string | null = null;
  if (rawBaseUrl.length === 0) {
    if (meta.requiresBaseUrl) {
      fail("baseUrl", "A base URL is required for this provider kind");
    }
  } else {
    baseUrl = validateBaseUrl(rawBaseUrl);
  }

  try {
    const result = await listProviderModels({
      kind,
      credentials: { apiKey, baseUrl, headers: sanitized.headers },
    });
    return { ok: true, modelCount: result.data.length };
  } catch (error) {
    return fail("baseUrl", mapListingError(error, [apiKey]));
  }
}

export async function listConnectionModels(
  db: ProviderModelsDb,
  userId: string,
  connectionId: string,
) {
  await requireConnection(db, userId, connectionId);
  const rows = (await db.providerModel.findMany({
    where: { connectionId, userId },
    orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
  })) as ModelRow[];
  return rows.map(toPublicModel);
}

/**
 * Derive a slug unique inside the user's scope and distinct from the global
 * catalog, then persist the validated model.
 */
async function resolveModelSlug(
  db: ProviderModelsDb,
  userId: string,
  connectionSlug: string,
  upstreamId: string,
  takenSlugs: ReadonlySet<string>,
): Promise<string> {
  const base = deriveModelSlug(connectionSlug, upstreamId);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = suffixSlug(base, attempt);
    if (!PROVIDER_MODEL_SLUG_RE.test(candidate)) continue;
    if (takenSlugs.has(candidate)) continue;
    const clash = await db.chatModel.findFirst({
      where: { modelId: candidate },
      select: { id: true },
    });
    if (clash) continue;
    return candidate;
  }
  return fail(
    "upstreamId",
    "Could not derive a unique model id; rename the connection or choose another model id",
  );
}

async function collectModelSlugs(
  db: ProviderModelsDb,
  userId: string,
  exclude?: string,
): Promise<Set<string>> {
  const rows = (await db.providerModel.findMany({
    where: { userId },
    select: { slug: true },
  })) as { slug?: unknown }[];
  return new Set(
    rows
      .map((row) => row.slug)
      .filter((slug): slug is string => typeof slug === "string")
      .filter((slug) => slug !== exclude),
  );
}

export async function createConnectionModel(
  db: ProviderModelsDb,
  userId: string,
  connectionId: string,
  input: ProviderModelInput,
) {
  const connection = await requireConnection(db, userId, connectionId);
  const meta = PROVIDER_KIND_META[connectionProviderKind(connection)];

  const count = await db.providerModel.count({ where: { userId } });
  if (count >= MAX_MODELS_PER_USER) {
    fail(
      "upstreamId",
      `You can register at most ${MAX_MODELS_PER_USER} models`,
    );
  }

  const value = validateModelInput(input, meta);
  const taken = await collectModelSlugs(db, userId);
  const slug = await resolveModelSlug(
    db,
    userId,
    connection.slug,
    value.upstreamId,
    taken,
  );

  return db.providerModel.create({
    data: {
      userId,
      connectionId,
      slug,
      upstreamId: value.upstreamId,
      name: value.name,
      label: value.label,
      hint: value.hint,
      description: value.description,
      iconSvg: value.iconSvg,
      outputType: value.outputType,
      contextWindowTokens: value.contextWindowTokens,
      maxInputTokens: value.maxInputTokens,
      maxOutputTokens: value.maxOutputTokens,
      reasoningEfforts: value.reasoningEfforts,
    },
  });
}

export async function updateConnectionModel(
  db: ProviderModelsDb,
  userId: string,
  connectionId: string,
  modelId: string,
  input: ProviderModelInput,
) {
  const connection = await requireConnection(db, userId, connectionId);
  const existing = await requireOwnedModel(db, userId, connectionId, modelId);
  const meta = PROVIDER_KIND_META[connectionProviderKind(connection)];

  const value = validateModelInput(
    { ...input, upstreamId: input.upstreamId ?? existing.upstreamId },
    meta,
  );
  // A changed upstream id needs a fresh slug; an unchanged one keeps its id so
  // existing references stay valid.
  const slug =
    value.upstreamId === existing.upstreamId
      ? existing.slug
      : await resolveModelSlug(
          db,
          userId,
          connection.slug,
          value.upstreamId,
          await collectModelSlugs(db, userId, existing.slug),
        );

  return db.providerModel.update({
    where: { id: modelId },
    data: {
      slug,
      upstreamId: value.upstreamId,
      name: value.name,
      label: value.label,
      hint: value.hint,
      description: value.description,
      iconSvg: value.iconSvg,
      outputType: value.outputType,
      contextWindowTokens: value.contextWindowTokens,
      maxInputTokens: value.maxInputTokens,
      maxOutputTokens: value.maxOutputTokens,
      reasoningEfforts: value.reasoningEfforts,
    },
  });
}

export async function deleteConnectionModel(
  db: ProviderModelsDb,
  userId: string,
  connectionId: string,
  modelId: string,
): Promise<void> {
  await requireConnection(db, userId, connectionId);
  await requireOwnedModel(db, userId, connectionId, modelId);
  await db.providerModel.delete({ where: { id: modelId } });
}
/**
 * Build a model handle from a stored connection so the UI can prefill display
 * name, context window, and the adapter's own reasoning vocabulary. The API
 * key never leaves the server.
 */
export async function prefillConnectionModel(
  db: ProviderConnectionsDb,
  userId: string,
  connectionId: string,
  input: { upstreamId: string; reasoningEfforts?: string[] | null },
): Promise<ModelPrefill> {
  const connection = await requireConnection(db, userId, connectionId);
  return prefillModelFromUpstream({
    kind: connectionProviderKind(connection),
    upstreamId: input.upstreamId,
    credentials: modelCredentials(connection),
    reasoningEfforts: input.reasoningEfforts ?? null,
  });
}