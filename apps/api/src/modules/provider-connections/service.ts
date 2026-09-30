import {
  PROVIDER_KIND_META,
  PROVIDER_KINDS,
  effortVocabulary,
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
  isReservedConnectionSlug,
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
  return db.providerConnection.create({
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
  });
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

  return db.providerConnection.update({
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
  });
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