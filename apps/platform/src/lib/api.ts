import type { ContextSnippetSourceRole } from "#/lib/chat/context-snippet-text";
import type { StageInteractionInput } from "#/lib/chat/interaction-response";
import { MODEL_ROLE_KEYS, type ModelRoleKey } from "#/lib/model-role-labels";

const DEFAULT_API_PORT = 3001;

/**
 * API origin for this page. Opening the UI at http://192.168.x.x:3000 talks to
 * http://192.168.x.x:3001 — localhost would point at the phone itself.
 * Override with VITE_API_BASE when the API is on a different host/port.
 * Otherwise the port comes from VITE_API_PORT in the shared root .env
 * (kept in sync with the API's PORT; Vite only exposes VITE_* to the browser).
 */
export function resolveApiBase(
  hostname?: string,
  protocol?: string,
  env?: { VITE_API_BASE?: string; VITE_API_PORT?: string },
): string {
  const viteEnv = env ?? import.meta.env;
  const fromEnv = viteEnv.VITE_API_BASE?.trim();
  if (fromEnv && (hostname === undefined || fromEnv.includes("://"))) {
    return fromEnv.replace(/\/+$/, "");
  }
  const host =
    hostname ??
    (typeof window === "undefined" ? "localhost" : window.location.hostname);
  const proto =
    protocol ??
    (typeof window === "undefined" ? "http:" : window.location.protocol);
  const port = viteEnv.VITE_API_PORT?.trim() || String(DEFAULT_API_PORT);
  return `${proto}//${host}:${port}`;
}

export const API_BASE = resolveApiBase();

export class ApiAuthError extends Error {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "ApiAuthError";
  }
}

export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: init?.headers,
  });

  if (response.status === 401) {
    throw new ApiAuthError();
  }

  return response;
}

export type SessionListItem = {
  sessionId: string;
  updatedAt: string;
  title: string;
  projectId?: string | null;
  /** True when a completed run exists after the user last read this session. */
  unread: boolean;
};

export type SessionListPage = {
  items: SessionListItem[];
  nextCursor: string | null;
};

export async function listSessions(input?: {
  cursor?: string | null;
  limit?: number;
  /** When set, list only that project's chats. When omitted, standalone only. */
  projectId?: string | null;
}): Promise<SessionListPage> {
  const params = new URLSearchParams();
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.limit) params.set("limit", String(input.limit));
  if (input?.projectId) params.set("projectId", input.projectId);
  const qs = params.toString();
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions${qs ? `?${qs}` : ""}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load sessions");
  }

  const data: unknown = await response.json();

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Array.isArray((data as SessionListPage).items)
  ) {
    const page = data as SessionListPage;
    return {
      items: page.items.filter(
        (item): item is SessionListItem =>
          !!item &&
          typeof item.sessionId === "string" &&
          typeof item.updatedAt === "string" &&
          typeof item.title === "string",
      ).map((item) => ({
        ...item,
        unread: item.unread === true,
      })),
      nextCursor:
        typeof page.nextCursor === "string" || page.nextCursor === null
          ? page.nextCursor
          : null,
    };
  }

  throw new Error("Unexpected sessions response shape");
}

export type ActiveRunInfo = {
  sessionId: string;
  streamId: string;
  status: string;
  lastEventId: number;
};

export async function listActiveRuns(): Promise<ActiveRunInfo[]> {
  const response = await apiFetch(`${API_BASE}/api/chat/runs`);
  if (!response.ok) throw new Error("Failed to load active runs");
  const data: unknown = await response.json();
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Array.isArray((data as { runs?: unknown }).runs)
  ) {
    const runs = (data as { runs: unknown[] }).runs.filter(
      (run): run is ActiveRunInfo =>
        !!run &&
        typeof run === "object" &&
        typeof (run as ActiveRunInfo).sessionId === "string" &&
        typeof (run as ActiveRunInfo).streamId === "string",
    );
    return runs;
  }
  throw new Error("Unexpected active runs response shape");
}

export async function markSessionRead(sessionId: string): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions/mark-read`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
  );
  if (!response.ok) throw new Error("Failed to mark session read");
}

export async function createChatSession(input?: {
  sessionId?: string;
  projectId?: string | null;
}): Promise<{
  sessionId: string;
  projectId: string | null;
  title: string | null;
}> {
  const response = await apiFetch(`${API_BASE}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input?.sessionId,
      projectId: input?.projectId ?? null,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to create chat session");
  }
  return (await response.json()) as {
    sessionId: string;
    projectId: string | null;
    title: string | null;
  };
}

/**
 * Get or create the single empty "New chat" draft for a scope.
 * Server reuses existing empties and prunes duplicates.
 */
export async function getOrCreateEmptyChatSession(input?: {
  projectId?: string | null;
}): Promise<{
  sessionId: string;
  projectId: string | null;
  title: string | null;
  createdAt?: string;
  updatedAt?: string;
}> {
  const response = await apiFetch(`${API_BASE}/api/chat/sessions/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: input?.projectId ?? null,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to open empty chat draft");
  }
  return (await response.json()) as {
    sessionId: string;
    projectId: string | null;
    title: string | null;
    createdAt?: string;
    updatedAt?: string;
  };
}

/** Rename a chat session (server normalizes: trim, collapse, max 48 chars). */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<{ sessionId: string; title: string }> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to rename chat");
  }
  const data = (await response.json()) as { sessionId?: unknown; title?: unknown };
  return {
    sessionId: String(data.sessionId ?? sessionId),
    title: String(data.title ?? title),
  };
}

/** Permanently delete a chat session (confirm required server-side). */
export async function deleteChatSession(
  sessionId: string,
): Promise<{ deleted: true }> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}?confirm=true`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to delete chat");
  }
  return { deleted: true };
}

// ─── Public share links (frozen snapshots, all-or-nothing per session) ─────

export type ShareLinkCreated = {
  token: string;
  urlPath: string;
  sessionId: string;
  title: string | null;
  createdAt: string;
};

export type ShareStatus = {
  sessionId: string;
  active: boolean;
};

export type PublicShareSnapshot = {
  token: string;
  title: string | null;
  createdAt: string;
  ownerName: string | null;
  messages: unknown;
};

/** Canonical browser URL for a share token. */
export function shareUrl(token: string): string {
  return `/share/${encodeURIComponent(token)}`;
}

/**
 * Mint a new public link (frozen snapshot of current history). Only the
 * newest active link is shown — older tokens stay valid but are replaced
 * on display (latest wins).
 */
export async function createShareLink(
  sessionId: string,
): Promise<ShareLinkCreated> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}/shares`,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to create share link");
  }
  return (await response.json()) as ShareLinkCreated;
}

export type LatestShareLink = {
  token: string;
  urlPath: string;
  sessionId: string;
  title: string | null;
  createdAt: string;
} | null;

/**
 * Newest active public link of a session, or null when none exists.
 * The topbar Copy button always copies this token (latest wins).
 */
export async function fetchLatestShareLink(
  sessionId: string,
): Promise<LatestShareLink> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}/shares/latest`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to load share link");
  }
  return (await response.json()) as Exclude<LatestShareLink, null>;
}

/** Whether the session currently has at least one active public link. */
export async function fetchShareStatus(
  sessionId: string,
): Promise<ShareStatus> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}/shares/status`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to load share status");
  }
  return (await response.json()) as ShareStatus;
}

/** Deactivate ALL public links of a session at once (no per-link list). */
export async function deactivateShareLinks(
  sessionId: string,
): Promise<{ sessionId: string; revoked: number }> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}/shares/deactivate`,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to deactivate share links");
  }
  return (await response.json()) as { sessionId: string; revoked: number };
}

/**
 * Read a public snapshot. No auth required — plain fetch (not apiFetch, so
 * a missing/invalid token surfaces as data instead of an auth error).
 */
export async function fetchPublicShare(token: string): Promise<PublicShareSnapshot> {
  const response = await fetch(
    `${API_BASE}/api/shares/${encodeURIComponent(token)}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Shared link not found or no longer active");
  return (await response.json()) as PublicShareSnapshot;
}

export type ForkShareResult = {
  sessionId: string;
  seededMessages: number;
};

/**
 * Fork a frozen share snapshot into the viewer's own session. The snapshot
 * is read server-side from the token — the client never supplies history —
 * so the fork always matches the shared link. Only the history is seeded;
 * the first follow-up streams afterwards through the standard chat pipeline.
 */
export async function forkShareSnapshot(token: string): Promise<ForkShareResult> {
  const response = await apiFetch(`${API_BASE}/api/chat/fork`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Could not start your copy");
  }
  return (await response.json()) as ForkShareResult;
}

// ─── Projects ───────────────────────────────────────────────────────────────

export type ProjectListItem = {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  chatCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectListPage = {
  items: ProjectListItem[];
  nextCursor: string | null;
};

export async function listProjects(input?: {
  query?: string;
  cursor?: string | null;
  limit?: number;
  sort?: "lastOpenedAt" | "updatedAt" | "name";
}): Promise<ProjectListPage> {
  const params = new URLSearchParams();
  if (input?.query?.trim()) params.set("q", input.query.trim());
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.limit) params.set("limit", String(input.limit));
  if (input?.sort) params.set("sort", input.sort);
  const qs = params.toString();
  const response = await apiFetch(
    `${API_BASE}/api/projects${qs ? `?${qs}` : ""}`,
  );
  if (!response.ok) throw new Error("Failed to load projects");
  const data = (await response.json()) as ProjectListPage;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor:
      typeof data.nextCursor === "string" || data.nextCursor === null
        ? data.nextCursor
        : null,
  };
}

export async function createProject(input: {
  name: string;
  description?: string | null;
}): Promise<ProjectListItem> {
  const response = await apiFetch(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to create project");
  }
  return (await response.json()) as ProjectListItem;
}

export async function getProject(projectId: string): Promise<ProjectListItem> {
  const response = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to load project");
  }
  return (await response.json()) as ProjectListItem;
}

export async function openProject(projectId: string): Promise<ProjectListItem> {
  const response = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/open`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error("Failed to open project");
  return (await response.json()) as ProjectListItem;
}

export async function updateProject(
  projectId: string,
  input: { name?: string; description?: string | null },
): Promise<ProjectListItem> {
  const response = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to update project");
  }
  return (await response.json()) as ProjectListItem;
}

export async function deleteProject(
  projectId: string,
): Promise<{ deleted: true; documentCount: number; chatCount: number }> {
  const response = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}?confirm=true`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to delete project");
  }
  return (await response.json()) as {
    deleted: true;
    documentCount: number;
    chatCount: number;
  };
}

export async function deleteUserDocument(
  documentId: string,
): Promise<{ deleted: true }> {
  const response = await apiFetch(
    `${API_BASE}/api/documents/${encodeURIComponent(documentId)}?confirm=true`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to delete document");
  }
  return (await response.json()) as { deleted: true };
}

export type DocumentStatus =
  | "queued"
  | "uploading"
  | "ocr_processing"
  | "embedding_processing"
  | "ready"
  | "failed";

export interface DocumentStatusResponse {
  id: string;
  filename: string;
  status: DocumentStatus;
  pageCount: number;
  errorMessage: string | null;
  firstPageSummary: string;
  sizeBytes?: number;
}

export interface UploadDocumentResponse {
  id: string;
  filename: string;
  status: DocumentStatus;
  sizeBytes?: number;
}

export type UserStorageUsage = {
  usedBytes: number;
  maxBytes: number;
  remainingBytes: number;
};

const READY_STATUSES = new Set<DocumentStatus>(["ready"]);
const FAILED_STATUSES = new Set<DocumentStatus>(["failed"]);

export function isDocumentReady(status: DocumentStatus) {
  return READY_STATUSES.has(status);
}

export function isDocumentFailed(status: DocumentStatus) {
  return FAILED_STATUSES.has(status);
}

export async function getUserStorageUsage(): Promise<UserStorageUsage> {
  const response = await apiFetch(`${API_BASE}/api/documents/storage`);
  if (!response.ok) {
    throw new Error("Failed to load storage usage");
  }
  return (await response.json()) as UserStorageUsage;
}

export type UserUsageSummary = {
  storage: UserStorageUsage;
  tokens: {
    maxTokens: null;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    cacheCreationInputTokens: number;
    composition: {
      inputUncached: number;
      cacheRead: number;
      output: number;
    };
  };
  byModel: Array<{
    model: string;
    requestCount: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byReasoningEffort: Array<{
    reasoningEffort: string;
    requestCount: number;
    totalTokens: number;
  }>;
};

export async function getUserUsageSummary(): Promise<UserUsageSummary> {
  const response = await apiFetch(`${API_BASE}/api/usage/summary`);
  if (!response.ok) {
    throw new Error("Failed to load usage summary");
  }
  return (await response.json()) as UserUsageSummary;
}

export async function uploadDocument(input: {
  sessionId: string;
  file: File;
  projectId?: string | null;
}) {
  const form = new FormData();
  form.append("sessionId", input.sessionId);
  form.append("file", input.file);
  if (input.projectId) {
    form.append("projectId", input.projectId);
  }

  const response = await apiFetch(`${API_BASE}/api/documents`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to upload document");
  }

  return (await response.json()) as UploadDocumentResponse;
}

export async function listSessionDocuments(sessionId: string) {
  const response = await apiFetch(
    `${API_BASE}/api/documents?sessionId=${encodeURIComponent(sessionId)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to load session documents");
  }

  return (await response.json()) as SessionDocument[];
}

export interface SessionDocument {
  id: string;
  filename: string;
  firstPageSummary: string;
  sizeBytes?: number;
  mimeType?: string;
  pageCount?: number;
  origin?: string | null;
  parentDocumentId?: string | null;
  originUrl?: string | null;
  /** `report` documents render through the PDF report preview. */
  kind?: string | null;
}

export type UserLibraryDocument = {
  id: string;
  filename: string;
  firstPageSummary: string;
  sizeBytes: number;
  mimeType: string;
  pageCount: number;
  createdAt: string;
  originSessionId: string;
  projectId?: string | null;
  projectName?: string | null;
  origin?: string | null;
  parentDocumentId?: string | null;
  originUrl?: string | null;
};

export type UserLibraryPage = {
  items: UserLibraryDocument[];
  nextCursor: string | null;
};

export async function listUserDocuments(input?: {
  query?: string;
  cursor?: string | null;
  limit?: number;
  scope?: "attach" | "browser";
  projectId?: string | null;
}): Promise<UserLibraryPage> {
  const params = new URLSearchParams();
  if (input?.query?.trim()) params.set("q", input.query.trim());
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.limit) params.set("limit", String(input.limit));
  if (input?.scope) params.set("scope", input.scope);
  if (input?.projectId) params.set("projectId", input.projectId);
  const qs = params.toString();

  const response = await apiFetch(
    `${API_BASE}/api/documents/library${qs ? `?${qs}` : ""}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load document library");
  }

  const data = (await response.json()) as UserLibraryPage;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor:
      typeof data.nextCursor === "string" || data.nextCursor === null
        ? data.nextCursor
        : null,
  };
}

export async function linkDocumentsToSession(input: {
  sessionId: string;
  documentIds: string[];
}): Promise<{ linked: SessionDocument[] }> {
  const response = await apiFetch(`${API_BASE}/api/documents/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId,
      documentIds: input.documentIds,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to add documents to session");
  }

  return (await response.json()) as { linked: SessionDocument[] };
}

export async function unlinkDocumentFromSession(input: {
  sessionId: string;
  documentId: string;
}): Promise<{ ok: true; removed: boolean }> {
  const response = await apiFetch(`${API_BASE}/api/documents/links`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId,
      documentId: input.documentId,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to remove document from session");
  }

  return (await response.json()) as { ok: true; removed: boolean };
}

export type DocumentPageImageInfo = {
  id: string;
  mediaType: string;
};

export type DocumentPreviewPage = {
  pageIndex: number;
  summary: string;
  rawMarkdown: string;
  images?: DocumentPageImageInfo[];
};

export function buildDocumentImageUrl(
  documentId: string,
  pageIndex: number,
  imageId: string,
): string {
  return `${API_BASE}/api/documents/${encodeURIComponent(documentId)}/pages/${pageIndex}/images/${encodeURIComponent(imageId)}`;
}

export function isDocumentImagePath(value: string): boolean {
  return (
    value.startsWith("/api/documents/") ||
    value.startsWith(`${API_BASE}/api/documents/`)
  );
}

/** Resolve a document-image src (relative or absolute) to a fetchable URL. */
export function resolveDocumentImageUrl(value: string): string {
  return value.startsWith("/api/documents/") ? `${API_BASE}${value}` : value;
}

export type DocumentPreview = {
  id: string;
  filename: string;
  mimeType: string;
  pageCount: number;
  sizeBytes: number;
  firstPageSummary: string;
  summary: string;
  pages: DocumentPreviewPage[];
};

export async function getDocumentPreview(input: {
  documentId: string;
  pageIndex?: number;
  pageLimit?: number;
}): Promise<DocumentPreview> {
  const params = new URLSearchParams();
  if (input.pageIndex !== undefined) {
    params.set("pageIndex", String(input.pageIndex));
  }
  if (input.pageLimit !== undefined) {
    params.set("pageLimit", String(input.pageLimit));
  }
  const qs = params.toString();

  const response = await apiFetch(
    `${API_BASE}/api/documents/${encodeURIComponent(input.documentId)}/preview${qs ? `?${qs}` : ""}`,
  );

  if (!response.ok) {
    throw new Error("Failed to load document preview");
  }

  return (await response.json()) as DocumentPreview;
}

export async function getDocumentStatus(input: {
  sessionId: string;
  documentId: string;
}) {
  const response = await apiFetch(
    `${API_BASE}/api/documents/${encodeURIComponent(input.documentId)}?sessionId=${encodeURIComponent(input.sessionId)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch document status");
  }

  return (await response.json()) as DocumentStatusResponse;
}

export async function waitForDocumentReady(input: {
  sessionId: string;
  documentId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (status: DocumentStatusResponse) => void;
}) {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const pollIntervalMs = input.pollIntervalMs ?? 1500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getDocumentStatus({
      sessionId: input.sessionId,
      documentId: input.documentId,
    });
    input.onStatus?.(status);

    if (isDocumentReady(status.status)) return status;
    if (isDocumentFailed(status.status)) {
      throw new Error(status.errorMessage ?? "Document processing failed");
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Document processing timed out");
}

export type TruncateSessionMemoryInput = {
  sessionId: string;
  mode: "include" | "exclude";
  memoryPosition?: number;
  clientMessageId?: string;
  expectedPrefixMessageCount?: number;
};

export type TruncateSessionMemoryResult = {
  ok: true;
  deleted: number;
  keptThrough: number;
  resolvedPosition: number | null;
};

export async function truncateSessionMemory(
  input: TruncateSessionMemoryInput,
): Promise<TruncateSessionMemoryResult> {
  const response = await apiFetch(`${API_BASE}/api/chat/truncate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId,
      mode: input.mode,
      memoryPosition: input.memoryPosition,
      clientMessageId: input.clientMessageId,
      expectedPrefixMessageCount: input.expectedPrefixMessageCount,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to update conversation history");
  }

  return (await response.json()) as TruncateSessionMemoryResult;
}

export async function loadChatMessages(sessionId: string): Promise<unknown> {
  const response = await apiFetch(
    `${API_BASE}/api/chat?sessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error("Failed to load messages");
  return response.json();
}

export function ingestionStatusLabel(status: DocumentStatus) {
  switch (status) {
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading file...";
    case "ocr_processing":
      return "Extracting text (OCR)...";
    case "embedding_processing":
      return "Creating embeddings...";
    case "ready":
      return "Document ready";
    case "failed":
      return "Processing failed";
    default:
      return "Processing...";
  }
}

// ─── Profiling (personalization) ─────────────────────────────────────────────

export type ProfileSectionKey =
  | "facts"
  | "preferences"
  | "interests"
  | "expertise"
  | "goals";

/** One bullet of a summarized profile section with provenance session ids. */
export type ProfileBullet = {
  text: string;
  sources?: string[];
};

export type ProfileSections = Record<ProfileSectionKey, ProfileBullet[]>;

export type ExplicitFact = {
  section: ProfileSectionKey | null;
  fact: string;
  createdAt: string;
  /** Conversation that produced this fact (explicit remember tool). */
  source?: {
    sessionId?: string | null;
    messageId?: string | null;
  } | null;
};

export type ProfileDto = {
  sections: ProfileSections;
  explicitFacts: ExplicitFact[];
  updatedAt: string;
};

export type ProfilingPayload = {
  user: ProfileDto | null;
  projects: Array<{ id: string; name: string; profile: ProfileDto | null }>;
};

export async function getProfiling(): Promise<ProfilingPayload> {
  const response = await apiFetch(`${API_BASE}/api/profiling`);
  if (!response.ok) throw new Error("Failed to load profiles");
  return (await response.json()) as ProfilingPayload;
}

export async function resetUserProfile(): Promise<{ ok: true }> {
  const response = await apiFetch(`${API_BASE}/api/profiling?scope=user`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to reset profile");
  return (await response.json()) as { ok: true };
}

export async function resetProjectProfile(
  projectId: string,
): Promise<{ ok: true }> {
  const response = await apiFetch(
    `${API_BASE}/api/profiling/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("Failed to reset project profile");
  return (await response.json()) as { ok: true };
}

// ─── Model registry ─────────────────────────────────────────────────────────

export type ModelInfo = {
  modelId: string;
  label: string;
  /** Full display name, e.g. "GPT 5.6 Luna" (server falls back to label). */
  name: string;
  hint: string | null;
  description: string | null;
  iconSvg: string;
  provider: { slug: string; name: string };
  /**
   * Who made the model, declared for BYOK rows and `null` for catalog rows.
   * A filter facet only — never consulted by the run path.
   */
  vendorLabel: string | null;
  contextWindowTokens: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  prices: {
    input: number | null;
    cachedInput: number | null;
    output: number | null;
    cacheWriteMultiplier: number | null;
    longPromptThresholdTokens: number | null;
    longPromptInputMultiplier: number | null;
    longPromptOutputMultiplier: number | null;
  };
  reasoningEfforts: string[];
  /** "catalog" for the seeded registry, "connection" for a user BYOK model. */
  source: "catalog" | "connection";
  /** Set only for connection models. */
  connectionId: string | null;
  /** "text" | "image" — chat model or image generator. */
  outputType: "text" | "image";
  /** Image-gen capability descriptors (from OpenRouter discovery). */
  imageCapabilities: ImageModelCapabilities | null;
  /** Input modalities the model accepts, e.g. ["text","image","file"]. */
  inputModalities: string[];
  sortOrder: number;
};

export type ReasoningEffortInfo = {
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
};

export type ModelCatalog = {
  models: ModelInfo[];
  reasoningEfforts: ReasoningEffortInfo[];
};

let modelsCache: ModelCatalog | null = null;

/**
 * Listeners told to refetch when a provider write changes the merged catalog.
 * Held here, at the API-client seam, because there are two independent entry
 * points into the add-model form and a hook can forget to invalidate.
 */
const modelsCacheListeners = new Set<() => void>();

/**
 * Drop the cached catalog and notify subscribers so they refetch. Call this
 * only after a catalog-changing write has succeeded — a rejected write must
 * leave the cache as it was.
 */
export function invalidateModelsCache(): void {
  modelsCache = null;
  // The image picker caches its own catalog (fetchImageModels). A provider
  // write can add, change, or remove an image model, so the cache is dropped
  // here too — otherwise a freshly registered BYOK image model would not be
  // selectable (and so could not be pinned as the session's image model)
  // until a full reload.
  imageModelsPromise = null;
  // Snapshot before iterating: a listener may unsubscribe during notification.
  for (const listener of [...modelsCacheListeners]) listener();
}

/** Subscribe to catalog invalidation; returns an unsubscribe function. */
export function subscribeModelsCache(listener: () => void): () => void {
  modelsCacheListeners.add(listener);
  return () => {
    modelsCacheListeners.delete(listener);
  };
}

/**
 * Normalise one row from an older or newer server before it reaches the
 * picker. `source` and `connectionId` already had this treatment; `vendorLabel`
 * joins them because `vendorOf` reads `.length` on it and an `undefined` from a
 * pre-`vendorLabel` deploy would throw.
 */
export function normalizeModelRow(model: ModelInfo): ModelInfo {
  return {
    ...model,
    // Rows that predate the source field are treated as catalog entries so a
    // mixed deploy does not drop models from the picker.
    source: model.source === "connection" ? "connection" : "catalog",
    connectionId:
      typeof model.connectionId === "string" ? model.connectionId : null,
    vendorLabel:
      typeof model.vendorLabel === "string" ? model.vendorLabel : null,
  };
}

export async function listModels(input?: {
  force?: boolean;
}): Promise<ModelCatalog> {
  if (modelsCache !== null && !input?.force) return modelsCache;

  const response = await apiFetch(`${API_BASE}/api/models`);
  if (!response.ok) throw new Error("Failed to load models");

  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as ModelCatalog).models)
  ) {
    throw new Error("Unexpected models response shape");
  }

  const catalog: ModelCatalog = {
    // Chat model picker shows text models only — image generators live in
    // the composer's image-gen settings (fetchImageModels).
    models: (data as ModelCatalog).models
      .filter(
        (model): model is ModelInfo =>
          !!model &&
          typeof model.modelId === "string" &&
          typeof model.label === "string" &&
          model.outputType !== "image",
      )
      .map(normalizeModelRow),
    reasoningEfforts: Array.isArray(
      (data as ModelCatalog).reasoningEfforts,
    )
      ? (data as ModelCatalog).reasoningEfforts
      : [],
  };
  modelsCache = catalog;
  return catalog;
}

/** One role's saved model assignment plus the model it falls back to. */
export type ModelRoleInfo = {
  role: ModelRoleKey;
  /** The merged catalog id assigned to the role, or null for the default. */
  modelId: string | null;
  /** The model the role falls back to; null when it has no default. */
  defaultModelId: string | null;
};

function isModelRoleInfo(value: unknown): value is ModelRoleInfo {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    (MODEL_ROLE_KEYS as readonly string[]).includes(value.role) &&
    (value.modelId === null || typeof value.modelId === "string") &&
    (value.defaultModelId === null ||
      typeof value.defaultModelId === "string")
  );
}

export async function listModelRoles(): Promise<ModelRoleInfo[]> {
  const response = await apiFetch(`${API_BASE}/api/models/roles`);
  if (!response.ok) await throwSkillError(response, "Failed to load model roles");
  const data: unknown = await response.json();
  if (!isRecord(data) || !Array.isArray(data.roles)) {
    throw new Error("Unexpected model roles response shape");
  }
  return data.roles.filter(isModelRoleInfo);
}

export async function setModelRole(
  role: ModelRoleKey,
  modelId: string | null,
): Promise<ModelRoleInfo> {
  const response = await apiFetch(`${API_BASE}/api/models/roles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, modelId }),
  });
  if (!response.ok) await throwSkillError(response, "Failed to save model role");
  const data: unknown = await response.json();
  if (!isModelRoleInfo(data)) {
    throw new Error("Unexpected model role response shape");
  }
  return data;
}

export type ContextUsageInfo = {
  modelId: string;
  modelLabel: string;
  contextWindowTokens: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  estimatedTokens: number;
  ratio: number;
  thresholdRatio: number;
  targetRatio: number;
  thresholdTokens: number;
  targetTokens: number;
  lastRunInputTokens: number | null;
  reasoningEffort: string | null;
  estimatedAt: string;
};

export async function fetchContextUsage(input: {
  sessionId: string;
  model: string;
  reasoningEffort: string | null;
}): Promise<ContextUsageInfo> {
  const params = new URLSearchParams();
  params.set("sessionId", input.sessionId);
  params.set("model", input.model);
  if (input.reasoningEffort) {
    params.set("reasoningEffort", input.reasoningEffort);
  }

  const response = await apiFetch(
    `${API_BASE}/api/chat/context-usage?${params.toString()}`,
  );
  if (!response.ok) throw new Error("Failed to load context usage");

  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as ContextUsageInfo).modelId !== "string" ||
    typeof (data as ContextUsageInfo).estimatedTokens !== "number"
  ) {
    throw new Error("Unexpected context usage response shape");
  }
  return data as ContextUsageInfo;
}

export type RunStatusInfo = {
  streamId: string | null;
  /** "missing": stream hash expired while the active-run key still lingers — clients treat it as idle. */
  status: "idle" | "running" | "completed" | "error" | "missing";
  lastEventId: number | null;
};

export async function fetchRunStatus(sessionId: string): Promise<RunStatusInfo> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/run-status?sessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error("Failed to load run status");

  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as RunStatusInfo).status !== "string" ||
    ((data as RunStatusInfo).streamId !== null &&
      typeof (data as RunStatusInfo).streamId !== "string")
  ) {
    throw new Error("Unexpected run status response shape");
  }
  return data as RunStatusInfo;
}

export type SessionStateInfo = {
  /** Persisted user+assistant memory rows for the session (server truth). */
  messageCount: number;
};

export async function fetchSessionState(
  sessionId: string,
): Promise<SessionStateInfo> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/session-state?sessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error("Failed to load session state");

  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as SessionStateInfo).messageCount !== "number"
  ) {
    throw new Error("Unexpected session state response shape");
  }
  return data as SessionStateInfo;
}

export async function stopChatRun(
  streamId: string,
  sessionId: string,
): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/chat/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streamId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to stop chat run");
  }

  // The stop endpoint records an authoritative cancellation request. Do not
  // expose the composer as idle until the worker has closed the stream and
  // released this exact session lease; otherwise an immediate regenerate can
  // race the previous run and receive RUN_ACTIVE.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await fetchRunStatus(sessionId);
    if (status.streamId !== streamId || status.status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the chat run to stop");
}

export type SteerMessageInput = {
  clientMessageId: string;
  text: string;
  attachments?: { mediaType: string; data: string }[];
  contextSnippet?: { text: string; sourceRole: "user" | "assistant" } | null;
};

export class SteerNoActiveRunError extends Error {
  constructor() {
    super("No active run for this session");
    this.name = "SteerNoActiveRunError";
  }
}

export function isSteerNoActiveRunError(
  error: unknown,
): error is SteerNoActiveRunError {
  return error instanceof SteerNoActiveRunError;
}

/** Queue follow-up messages into the session's active run (steer). */
export async function steerChatMessages(input: {
  sessionId: string;
  messages: SteerMessageInput[];
}): Promise<{ ok: true; streamId: string; queued: number }> {
  const response = await apiFetch(`${API_BASE}/api/chat/steer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    throw new SteerNoActiveRunError();
  }
  if (!response.ok) {
    throw new Error(`Failed to send queued messages (${response.status})`);
  }
  return (await response.json()) as { ok: true; streamId: string; queued: number };
}

/** Which queued message ids were already applied to memory (missed acks). */
export async function syncQueuedMessageIds(input: {
  sessionId: string;
  ids: string[];
}): Promise<{ appliedIds: string[] }> {
  const response = await apiFetch(`${API_BASE}/api/chat/queue/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Failed to sync queued messages (${response.status})`);
  }
  return (await response.json()) as { appliedIds: string[] };
}

export type WebCapabilities = {
  webSearchAvailable: boolean;
  deepResearchAvailable: boolean;
  imageGenerationAvailable: boolean;
  context7Configured: boolean;
  userSkillsCount: number;
  userMcpCount: number;
};

const capabilitiesPromises = new Map<string, Promise<WebCapabilities>>();

export async function fetchChatCapabilities(
  sessionId?: string,
): Promise<WebCapabilities> {
  const key = sessionId ?? "global";
  const existing = capabilitiesPromises.get(key);
  if (existing) return existing;

  const promise = fetchChatCapabilitiesRemote(sessionId);
  capabilitiesPromises.set(key, promise);
  promise.catch(() => {
    // Drop the cache on failure so a transient error retries next call.
    capabilitiesPromises.delete(key);
  });
  return promise;
}

async function fetchChatCapabilitiesRemote(
  sessionId?: string,
): Promise<WebCapabilities> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const response = await apiFetch(`${API_BASE}/api/chat/capabilities${query}`);
  if (!response.ok) throw new Error("Failed to load chat capabilities");

  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as WebCapabilities).webSearchAvailable !== "boolean" ||
    typeof (data as WebCapabilities).deepResearchAvailable !== "boolean" ||
    typeof (data as WebCapabilities).imageGenerationAvailable !== "boolean" ||
    typeof (data as WebCapabilities).context7Configured !== "boolean" ||
    typeof (data as WebCapabilities).userSkillsCount !== "number" ||
    typeof (data as WebCapabilities).userMcpCount !== "number"
  ) {
    throw new Error("Unexpected capabilities response shape");
  }
  return data as WebCapabilities;
}

// ─── Native interaction policy staging ─────────────────────────────────────

const STAGE_OVERRIDE_KEYS = new Set([
  "modelId",
  "aspectRatio",
  "quality",
  "background",
  "n",
]);

/** Whether a restored approval/clarification can still be answered. */
export async function fetchInteractionStatus(
  interactionId: string,
): Promise<"pending" | "unavailable"> {
  try {
    const response = await apiFetch(
      `${API_BASE}/api/chat/interactions/${encodeURIComponent(interactionId)}`,
    );
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json().catch(() => null);
    if (
      body !== null &&
      typeof body === "object" &&
      (body as { status?: unknown }).status === "pending"
    ) {
      return "pending";
    }
    return "unavailable";
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    // Keep the card when the status check itself fails.
    return "pending";
  }
}

/**
 * Stage application-owned policy for one native tool approval. The native
 * response itself is sent by @anvia/react; this helper never answers it.
 */
export async function stageInteractionPolicy(
  input: StageInteractionInput,
): Promise<void> {
  if (!isValidStageInput(input)) {
    throw new Error("Interaction policy request is invalid.");
  }

  const response = await apiFetch(
    `${API_BASE}/api/chat/interactions/${encodeURIComponent(input.interactionId)}/stage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        response: input.response,
        ...(input.grantScope !== undefined
          ? { grantScope: input.grantScope }
          : {}),
        ...(input.overrideArgs !== undefined
          ? { overrideArgs: input.overrideArgs }
          : {}),
      }),
    },
  );
  if (response.ok) return;

  const code = await safeResponseCode(response);
  if (response.status === 404 || code === "INTERACTION_NOT_FOUND") {
    throw new Error("This interaction is no longer available.");
  }
  if (code === "INTERACTION_EXPIRED") {
    throw new Error(
      "This approval expired. Send a new message to continue.",
    );
  }
  if (
    response.status === 409 ||
    code === "INTERACTION_STATE_CONFLICT" ||
    code === "INTERACTION_POLICY_CONFLICT" ||
    code === "INTERACTION_REPLAYED"
  ) {
    throw new Error("This interaction was already handled.");
  }
  if (
    response.status === 503 ||
    code === "INTERACTION_POLICY_UNAVAILABLE"
  ) {
    throw new Error("Interaction policy is temporarily unavailable.");
  }
  if (response.status === 400 || code === "INTERACTION_STAGE_INVALID") {
    throw new Error("Interaction policy request is invalid.");
  }
  throw new Error("Interaction policy could not be staged.");
}

function isValidStageInput(value: unknown): value is StageInteractionInput {
  if (!isRecord(value) || typeof value.interactionId !== "string") {
    return false;
  }
  if (
    value.interactionId.trim().length === 0 ||
    value.interactionId.length > 256 ||
    !isRecord(value.response) ||
    value.response.type !== "tool-approval" ||
    value.response.approved !== true
  ) {
    return false;
  }
  if (
    value.response.reason !== undefined &&
    (typeof value.response.reason !== "string" ||
      value.response.reason.length > 500)
  ) {
    return false;
  }
  if (
    value.grantScope !== undefined &&
    value.grantScope !== "session"
  ) {
    return false;
  }
  if (value.overrideArgs !== undefined && !isValidStageOverride(value.overrideArgs)) {
    return false;
  }
  return value.grantScope !== undefined || value.overrideArgs !== undefined;
}

function isValidStageOverride(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    !keys.includes("modelId") ||
    keys.some((key) => !STAGE_OVERRIDE_KEYS.has(key))
  ) {
    return false;
  }
  return keys.every((key) => {
    const item = value[key];
    if (key === "n") {
      return (
        typeof item === "number" &&
        Number.isInteger(item) &&
        item >= 1 &&
        item <= 10
      );
    }
    return (
      typeof item === "string" &&
      item.trim().length > 0 &&
      item.length <= 512
    );
  });
}

async function safeResponseCode(response: Response): Promise<string | undefined> {
  const value: unknown = await response.json().catch(() => undefined);
  if (!isRecord(value) || typeof value.code !== "string") return undefined;
  return value.code;
}

// ─── Image generation ────────────────────────────────────────────────────────

export type ImageGenSettings = {
  modelId?: string;
  aspectRatio?: string;
  quality?: string;
  background?: string;
  n?: number;
};

export type GeneratedImageMeta = {
  id: string;
  sessionId: string;
  projectId: string | null;
  mediaType: string;
  width: number;
  height: number;
  modelId: string;
  prompt: string;
  /** Searchable caption (falls back to prompt for legacy rows). */
  caption: string;
  nOfTotal: string | null;
  source: string;
  sourceUrl: string | null;
  createdAt: string;
};

export type ImageModelCapabilities = {
  quality?: string[];
  background?: string[];
  n?: { min: number; max: number };
  aspectRatios?: string[];
  resolutions?: string[];
  /** Exact pixel sizes the model accepts (OpenAI-style); drives the size UI. */
  sizes?: string[];
};

export type ImageModelCatalogItem = {
  modelId: string;
  name: string;
  label: string;
  hint: string;
  iconSvg: string;
  imageCapabilities: ImageModelCapabilities | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === "string",
  );
  return strings.length > 0 ? strings : undefined;
}

function parseImageModelCapabilities(value: unknown): ImageModelCapabilities | null {
  if (!isRecord(value)) return null;
  const n =
    isRecord(value.n) &&
    typeof value.n.min === "number" &&
    typeof value.n.max === "number"
      ? { min: value.n.min, max: value.n.max }
      : undefined;
  const quality = stringArray(value.quality);
  const background = stringArray(value.background);
  const aspectRatios = stringArray(value.aspectRatios);
  const resolutions = stringArray(value.resolutions);
  const sizes = stringArray(value.sizes);
  if (
    !n &&
    !quality &&
    !background &&
    !aspectRatios &&
    !resolutions &&
    !sizes
  ) {
    return null;
  }
  return {
    ...(n ? { n } : {}),
    ...(quality ? { quality } : {}),
    ...(background ? { background } : {}),
    ...(aspectRatios ? { aspectRatios } : {}),
    ...(resolutions ? { resolutions } : {}),
    ...(sizes ? { sizes } : {}),
  };
}

let imageModelsPromise: Promise<ImageModelCatalogItem[]> | null = null;

export async function fetchImageModels(): Promise<ImageModelCatalogItem[]> {
  if (imageModelsPromise === null) {
    imageModelsPromise = fetchImageModelsRemote();
    imageModelsPromise.catch(() => {
      // Drop the cache on failure so a transient error retries next call.
      imageModelsPromise = null;
    });
  }
  return imageModelsPromise;
}

async function fetchImageModelsRemote(): Promise<ImageModelCatalogItem[]> {
  const response = await apiFetch(
    `${API_BASE}/api/models?outputType=image`,
  );
  if (!response.ok) throw new Error("Failed to load image models");

  const data: unknown = await response.json();
  // The backend filters by outputType=image; the shape guard stays as cheap
  // defense against a misbehaving server.
  if (!isRecord(data) || !Array.isArray(data.models)) {
    throw new Error("Unexpected image models response shape");
  }

  return (data.models as unknown[])
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) &&
        typeof item.modelId === "string" &&
        typeof item.name === "string" &&
        typeof item.label === "string",
    )
    .map((item) => ({
      modelId: item.modelId as string,
      name: item.name as string,
      label: item.label as string,
      hint: typeof item.hint === "string" ? item.hint : "",
      iconSvg: typeof item.iconSvg === "string" ? item.iconSvg : "",
      imageCapabilities: parseImageModelCapabilities(item.imageCapabilities),
    }));
}

function isGeneratedImageMeta(value: unknown): value is GeneratedImageMeta {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    (value.projectId === null || typeof value.projectId === "string") &&
    typeof value.mediaType === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.modelId === "string" &&
    typeof value.prompt === "string" &&
    (value.caption === undefined || typeof value.caption === "string") &&
    (value.nOfTotal === null || typeof value.nOfTotal === "string") &&
    typeof value.source === "string" &&
    (value.sourceUrl === null || typeof value.sourceUrl === "string") &&
    typeof value.createdAt === "string"
  );
}

function parseGeneratedImages(data: unknown): GeneratedImageMeta[] {
  if (!isRecord(data) || !Array.isArray(data.images)) {
    throw new Error("Unexpected images response shape");
  }
  return (data.images as unknown[])
    .filter(isGeneratedImageMeta)
    .map((image) => ({ ...image, caption: image.caption ?? image.prompt }));
}

export async function fetchSessionImages(
  sessionId: string,
): Promise<GeneratedImageMeta[]> {
  const response = await apiFetch(
    `${API_BASE}/api/images?sessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error("Failed to load session images");
  return parseGeneratedImages(await response.json());
}

export async function fetchProjectImages(
  projectId: string,
): Promise<GeneratedImageMeta[]> {
  const response = await apiFetch(
    `${API_BASE}/api/images?projectId=${encodeURIComponent(projectId)}`,
  );
  if (!response.ok) throw new Error("Failed to load project images");
  return parseGeneratedImages(await response.json());
}

export async function fetchUserImages(): Promise<GeneratedImageMeta[]> {
  const response = await apiFetch(`${API_BASE}/api/images?scope=user`);
  if (!response.ok) throw new Error("Failed to load user images");
  return parseGeneratedImages(await response.json());
}

export type UploadSessionImageInput = {
  sessionId: string;
  file: File;
  width: number;
  height: number;
  projectId?: string | null;
};

export async function uploadSessionImage(
  input: UploadSessionImageInput,
): Promise<GeneratedImageMeta> {
  const form = new FormData();
  form.append("sessionId", input.sessionId);
  form.append("file", input.file);
  form.append("width", String(input.width));
  form.append("height", String(input.height));
  if (input.projectId) {
    form.append("projectId", input.projectId);
  }

  const response = await apiFetch(`${API_BASE}/api/images`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to upload image");
  }
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !data ||
    typeof (data as { image?: unknown }).image !== "object"
  ) {
    throw new Error("Unexpected image upload response shape");
  }
  return (data as { image: GeneratedImageMeta }).image;
}

/** Image file extensions treated as photos even when the MIME type is odd. */
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
  "heic",
  "heif",
]);

/** True when an attachment (or file) is a photo the user wants to attach. */
export function isImageAttachmentLike(input: {
  mediaType?: string | null;
  name?: string | null;
}): boolean {
  if (input.mediaType?.startsWith("image/")) return true;
  const name = input.name ?? "";
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Decode image dimensions from a file (falls back to 0×0). */
export async function imageDimensionsFromFile(
  file: Blob,
): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function fetchImageBytes(
  id: string,
): Promise<{ blob: Blob; mediaType: string }> {
  const response = await apiFetch(
    `${API_BASE}/api/images/${encodeURIComponent(id)}`,
  );
  if (!response.ok) throw new Error("Failed to load image");
  return {
    blob: await response.blob(),
    mediaType: response.headers.get("content-type") ?? "image/png",
  };
}

/** Active image context — images pinned as chat context for a session. */
export async function fetchSessionImageContexts(
  sessionId: string,
): Promise<GeneratedImageMeta[]> {
  const response = await apiFetch(
    `${API_BASE}/api/images/context?sessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error("Failed to load image contexts");
  return parseGeneratedImages(await response.json());
}

export async function addSessionImageContext(input: {
  sessionId: string;
  imageId: string;
}): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/images/context`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to pin image as context");
  }
}

export async function removeSessionImageContext(input: {
  sessionId: string;
  imageId: string;
}): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/images/context/${encodeURIComponent(input.imageId)}?sessionId=${encodeURIComponent(input.sessionId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("Failed to unpin image context");
}

/** Single text snippet pinned as additional context for a session. */
export type ContextSnippet = {
  id: string;
  text: string;
  sourceRole: ContextSnippetSourceRole;
  createdAt: string;
};

export async function fetchContextSnippet(
  sessionId: string,
): Promise<ContextSnippet | null> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/${encodeURIComponent(sessionId)}/context-snippet`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to load context snippet");
  const body = (await response.json()) as { snippet?: unknown };
  const snippet = body.snippet;
  if (!snippet || typeof snippet !== "object") return null;
  const record = snippet as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.text !== "string" ||
    (record.sourceRole !== "user" && record.sourceRole !== "assistant") ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    text: record.text,
    sourceRole: record.sourceRole,
    createdAt: record.createdAt,
  };
}

export async function upsertContextSnippet(input: {
  sessionId: string;
  text: string;
  sourceRole: ContextSnippetSourceRole;
}): Promise<ContextSnippet> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/${encodeURIComponent(input.sessionId)}/context-snippet`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        sourceRole: input.sourceRole,
      }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to add context snippet");
  }
  const body = (await response.json()) as { snippet?: unknown };
  const snippet = body.snippet as ContextSnippet | undefined;
  if (!snippet) throw new Error("Failed to add context snippet");
  return snippet;
}

export async function removeContextSnippet(input: {
  sessionId: string;
  snippetId: string;
}): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/chat/context-snippet/${encodeURIComponent(input.snippetId)}?sessionId=${encodeURIComponent(input.sessionId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("Failed to remove context snippet");
}

// ─── User skills ────────────────────────────────────────────────────────────

export type UserSkill = {
  id: string;
  name: string;
  description: string;
  bodyMd?: string;
  isEnabled: boolean;
  status: string;
  version: number;
};

export type SkillIssue = { path: string; message: string };

export type SkillInput = {
  name: string;
  description: string;
  bodyMd: string;
};

async function throwSkillError(response: Response, fallback: string): Promise<never> {
  let detail = fallback;
  let issues: SkillIssue[] | undefined;
  try {
    const body = (await response.json()) as {
      error?: string;
      issues?: SkillIssue[];
    };
    if (body?.error) {
      issues = Array.isArray(body.issues) ? body.issues : undefined;
      const suffix = issues ? ` (${issues.map((issue) => issue.message).join("; ")})` : "";
      detail = `${body.error}${suffix}`;
    }
  } catch {
    // Fall through with the generic message.
  }
  const error = new Error(detail);
  if (issues) (error as Error & { issues?: SkillIssue[] }).issues = issues;
  throw error;
}

export async function listSkills(): Promise<UserSkill[]> {
  const response = await apiFetch(`${API_BASE}/api/skills`);
  if (!response.ok) throw new Error("Failed to load skills");
  return (await response.json()) as UserSkill[];
}

export async function createSkill(input: SkillInput): Promise<UserSkill> {
  const response = await apiFetch(`${API_BASE}/api/skills`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwSkillError(response, "Failed to create skill");
  return (await response.json()) as UserSkill;
}

export async function updateSkill(id: string, input: SkillInput): Promise<UserSkill> {
  const response = await apiFetch(`${API_BASE}/api/skills/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwSkillError(response, "Failed to save skill");
  return (await response.json()) as UserSkill;
}

export async function deleteSkill(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/skills/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete skill");
}

export async function setSkillEnabled(id: string, isEnabled: boolean): Promise<UserSkill> {
  const response = await apiFetch(
    `${API_BASE}/api/skills/${encodeURIComponent(id)}/enabled`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled }),
    },
  );
  if (!response.ok) throw new Error("Failed to update skill");
  return (await response.json()) as UserSkill;
}

// ─── User MCP servers ───────────────────────────────────────────────────────

export type UserMcpServer = {
  id: string;
  name: string;
  url: string;
  authType: "none" | "bearer";
  allowedTools: string[];
  isEnabled: boolean;
  status: string;
  lastError: string | null;
  hasCredentials: boolean;
  hasHeaders: boolean;
};

export type McpHeaderInput = {
  name: string;
  value: string;
};

export type McpServerInput = {
  name: string;
  url: string;
  authType: "none" | "bearer";
  token?: string;
  headers?: McpHeaderInput[];
  serverId?: string;
};

export type McpTestTool = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
};

export type McpTestResult =
  | { ok: true; tools: McpTestTool[] }
  | { ok: false; error: string };

function normalizeMcpServer(
  row: UserMcpServer & { allowedToolsJson?: unknown },
): UserMcpServer {
  return {
    ...row,
    allowedTools: Array.isArray(row.allowedTools)
      ? row.allowedTools
      : Array.isArray(row.allowedToolsJson)
        ? (row.allowedToolsJson as string[])
        : [],
  };
}

export async function listMcpServers(): Promise<UserMcpServer[]> {
  const response = await apiFetch(`${API_BASE}/api/mcp-servers`);
  if (!response.ok) throw new Error("Failed to load MCP servers");
  const rows = (await response.json()) as (UserMcpServer & { allowedToolsJson?: unknown })[];
  return rows.map(normalizeMcpServer);
}

export async function createMcpServer(input: McpServerInput): Promise<UserMcpServer> {
  const response = await apiFetch(`${API_BASE}/api/mcp-servers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwSkillError(response, "Failed to add MCP server");
  return normalizeMcpServer((await response.json()) as UserMcpServer);
}

export async function updateMcpServer(id: string, input: McpServerInput): Promise<UserMcpServer> {
  const response = await apiFetch(
    `${API_BASE}/api/mcp-servers/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) await throwSkillError(response, "Failed to save MCP server");
  return normalizeMcpServer((await response.json()) as UserMcpServer);
}

export async function deleteMcpServer(id: string): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/mcp-servers/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("Failed to delete MCP server");
}

export async function setMcpServerEnabled(id: string, isEnabled: boolean): Promise<UserMcpServer> {
  const response = await apiFetch(
    `${API_BASE}/api/mcp-servers/${encodeURIComponent(id)}/enabled`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled }),
    },
  );
  if (!response.ok) throw new Error("Failed to update MCP server");
  return normalizeMcpServer((await response.json()) as UserMcpServer);
}

export async function testMcpConnection(input: McpServerInput): Promise<McpTestResult> {
  const response = await apiFetch(`${API_BASE}/api/mcp-servers/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Failed to test MCP connection");
  return (await response.json()) as McpTestResult;
}

// ─── Provider connections (BYOK) ────────────────────────────────────────────

/** The per-kind image limits the server publishes (see the API's `/kinds`). */
export type ProviderKindImageLimits = {
  nMax: number;
  sizing: "sizes" | "resolutions";
  supportsQuality: boolean;
  supportsBackground: boolean;
  /** Non-null only for gcd-derived kinds: the ratios the adapter can reach. */
  representableAspectRatios: string[] | null;
};

export type ProviderKindInfo = {
  kind: string;
  label: string;
  credentialPlaceholder: string;
  supportsBaseUrl: boolean;
  requiresBaseUrl: boolean;
  apiVariants: ("chat" | "responses")[];
  defaultApi: "chat" | "responses" | null;
  imageStyle: "openrouter-images" | "gemini-native" | "grok-native" | "none";
  imageLimits: ProviderKindImageLimits | null;
};

export type ProviderConnection = {
  id: string;
  kind: string;
  label: string;
  slug: string;
  baseUrl: string | null;
  api: string | null;
  isActive: boolean;
  sortOrder: number;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
};

/** One row of a connection's registered models. Never carries credentials. */
export type ProviderModelRow = {
  id: string;
  slug: string;
  upstreamId: string;
  name: string;
  label: string;
  hint: string | null;
  description: string | null;
  /**
   * Who made the model, declared for a BYOK row and `null` when undeclared.
   * A filter facet only — never consulted by the run path.
   */
  vendorLabel: string | null;
  iconSvg: string;
  outputType: "text" | "image";
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
  capabilities: Record<string, unknown> | null;
  imageCapabilities: ImageModelCapabilities | null;
  isActive: boolean;
  sortOrder: number;
  connectionId: string;
  createdAt: string;
  updatedAt: string;
};

/** One entry of a provider's own model listing (discovery). */
export type ListedProviderModel = {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  createdAt?: string;
  ownedBy?: string;
  contextLength?: number;
};

export type ProviderConnectionInput = {
  kind: string;
  label: string;
  slug?: string;
  baseUrl?: string | null;
  api?: string | null;
  /** Write-only. Never returned by any endpoint; omit on update to keep it. */
  apiKey?: string;
  headers?: Record<string, string>;
};

export type ProviderModelInput = {
  upstreamId: string;
  name?: string;
  label?: string;
  hint?: string | null;
  description?: string | null;
  /**
   * Who made the model, declared by the user for a BYOK row. A filter facet
   * only — never consulted by the run path. Sent in full on every save: the
   * update path replaces it on each PATCH, so an omitted field clears the
   * stored vendor.
   */
  vendorLabel?: string;
  iconSvg?: string;
  outputType?: "text" | "image";
  /**
   * Image capability declaration for an image model. Validated against the
   * kind's published limits server-side; a text model must not carry it. Sent
   * in full on every save — a PATCH that omits it writes null.
   */
  imageCapabilities?: ImageModelCapabilities;
  contextWindowTokens?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  reasoningEfforts?: string[];
};

/**
 * The adapter's own declaration for an upstream id, read server-side so the
 * API key never reaches the browser. `providerReported: false` means the
 * adapter has no limits entry, so the context window must come from the user.
 */
export type ProviderModelPrefill = {
  name: string;
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  capabilities: Record<string, unknown> | null;
  providerReported: boolean;
};

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isProviderKindInfo(value: unknown): value is ProviderKindInfo {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.label === "string" &&
    typeof value.credentialPlaceholder === "string" &&
    typeof value.supportsBaseUrl === "boolean" &&
    typeof value.requiresBaseUrl === "boolean" &&
    Array.isArray(value.apiVariants)
  );
}

/** Parse the published per-kind image limits; null when absent or malformed. */
function parseImageLimits(value: unknown): ProviderKindImageLimits | null {
  if (!isRecord(value)) return null;
  const sizing = value.sizing;
  if (sizing !== "sizes" && sizing !== "resolutions") return null;
  if (typeof value.nMax !== "number" || !Number.isSafeInteger(value.nMax)) {
    return null;
  }
  const ratios = value.representableAspectRatios;
  if (ratios !== null && !Array.isArray(ratios)) return null;
  return {
    nMax: value.nMax,
    sizing,
    supportsQuality: value.supportsQuality === true,
    supportsBackground: value.supportsBackground === true,
    representableAspectRatios: Array.isArray(ratios)
      ? toStringArray(ratios)
      : null,
  };
}

function isProviderConnection(value: unknown): value is ProviderConnection {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.label === "string" &&
    typeof value.slug === "string" &&
    typeof value.hasCredentials === "boolean" &&
    typeof value.isActive === "boolean" &&
    typeof value.sortOrder === "number"
  );
}

function isProviderModelRow(value: unknown): value is ProviderModelRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.slug === "string" &&
    typeof value.upstreamId === "string" &&
    typeof value.name === "string" &&
    typeof value.label === "string" &&
    typeof value.connectionId === "string"
  );
}

export async function listProviderKinds(): Promise<{
  kinds: ProviderKindInfo[];
  effortVocabulary: string[];
}> {
  const response = await apiFetch(`${API_BASE}/api/providers/kinds`);
  if (!response.ok) await throwSkillError(response, "Failed to load provider kinds");
  const data: unknown = await response.json();
  if (!isRecord(data) || !Array.isArray(data.kinds)) {
    throw new Error("Unexpected provider kinds response shape");
  }
  return {
    kinds: data.kinds.filter(isProviderKindInfo).map((kind) => ({
      ...kind,
      // A server without the field publishes none; the editor then simply
      // offers no image registration for that kind.
      imageLimits: parseImageLimits((kind as { imageLimits?: unknown }).imageLimits),
    })),
    effortVocabulary: toStringArray(data.effortVocabulary),
  };
}

export async function listProviderConnections(): Promise<ProviderConnection[]> {
  const response = await apiFetch(`${API_BASE}/api/providers`);
  if (!response.ok) {
    await throwSkillError(response, "Failed to load provider connections");
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected provider connections response shape");
  }
  return data.filter(isProviderConnection);
}

export async function createProviderConnection(
  input: ProviderConnectionInput,
): Promise<ProviderConnection> {
  const response = await apiFetch(`${API_BASE}/api/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await throwSkillError(response, "Failed to save provider connection");
  }
  const data: unknown = await response.json();
  if (!isProviderConnection(data)) {
    throw new Error("Unexpected provider connection response shape");
  }
  invalidateModelsCache();
  return data;
}

export async function updateProviderConnection(
  id: string,
  input: ProviderConnectionInput,
): Promise<ProviderConnection> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to save provider connection");
  }
  const data: unknown = await response.json();
  if (!isProviderConnection(data)) {
    throw new Error("Unexpected provider connection response shape");
  }
  invalidateModelsCache();
  return data;
}

export async function deleteProviderConnection(id: string): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to delete provider connection");
  }
  invalidateModelsCache();
}

/** Flip a connection's active flag; mirrors `setMcpServerEnabled`. */
export async function setProviderConnectionEnabled(
  id: string,
  isEnabled: boolean,
): Promise<ProviderConnection> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(id)}/enabled`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled }),
    },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to update provider connection");
  }
  const data: unknown = await response.json();
  if (!isProviderConnection(data)) {
    throw new Error("Unexpected provider connection response shape");
  }
  invalidateModelsCache();
  return data;
}

export async function discoverProviderModels(
  connectionId: string,
): Promise<ListedProviderModel[]> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(connectionId)}/models/discover`,
    { method: "POST" },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to load the provider's models");
  }
  const data: unknown = await response.json();
  if (!isRecord(data) || !Array.isArray(data.data)) {
    throw new Error("Unexpected provider model listing response shape");
  }
  return data.data.filter(
    (item): item is ListedProviderModel =>
      isRecord(item) && typeof item.id === "string",
  );
}

export async function listProviderModels(
  connectionId: string,
): Promise<ProviderModelRow[]> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(connectionId)}/models`,
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to load provider models");
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected provider models response shape");
  }
  return data.filter(isProviderModelRow);
}

export async function createProviderModel(
  connectionId: string,
  input: ProviderModelInput,
): Promise<ProviderModelRow> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(connectionId)}/models`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to save provider model");
  }
  const data: unknown = await response.json();
  if (!isProviderModelRow(data)) {
    throw new Error("Unexpected provider model response shape");
  }
  invalidateModelsCache();
  return data;
}

export async function updateProviderModel(
  connectionId: string,
  modelId: string,
  input: ProviderModelInput,
): Promise<ProviderModelRow> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(connectionId)}/models/${encodeURIComponent(modelId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to save provider model");
  }
  const data: unknown = await response.json();
  if (!isProviderModelRow(data)) {
    throw new Error("Unexpected provider model response shape");
  }
  invalidateModelsCache();
  return data;
}

export async function deleteProviderModel(
  connectionId: string,
  modelId: string,
): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(connectionId)}/models/${encodeURIComponent(modelId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to delete provider model");
  }
  invalidateModelsCache();
}

export async function prefillProviderModel(
  connectionId: string,
  input: { upstreamId: string; reasoningEfforts?: string[] | null },
): Promise<ProviderModelPrefill> {
  const response = await apiFetch(
    `${API_BASE}/api/providers/${encodeURIComponent(connectionId)}/models/prefill`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    await throwSkillError(response, "Failed to read the model's metadata");
  }
  const data: unknown = await response.json();
  if (!isRecord(data) || typeof data.name !== "string") {
    throw new Error("Unexpected provider prefill response shape");
  }
  return {
    name: data.name,
    contextWindowTokens: numberOrNull(data.contextWindowTokens),
    maxInputTokens: numberOrNull(data.maxInputTokens),
    maxOutputTokens: numberOrNull(data.maxOutputTokens),
    reasoningEfforts: toStringArray(data.reasoningEfforts),
    defaultReasoningEffort: nullableString(data.defaultReasoningEffort),
    capabilities: isRecord(data.capabilities) ? data.capabilities : null,
    providerReported: data.providerReported === true,
  };
}

/**
 * Probe a connection without persisting anything. A blank `apiKey` with a
 * `connectionId` reuses that owned connection's stored credential server-side,
 * so an empty key field does not force re-entry. Editor fields the test does
 * not need may be sent and are ignored.
 */
export async function testProviderConnection(input: {
  kind: string;
  baseUrl?: string | null;
  api?: string | null;
  apiKey?: string | null;
  headers?: Record<string, string>;
  connectionId?: string;
}): Promise<{ ok: true; modelCount: number }> {
  const response = await apiFetch(`${API_BASE}/api/providers/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await throwSkillError(response, "Failed to test provider connection");
  }
  const data: unknown = await response.json();
  if (
    !isRecord(data) ||
    data.ok !== true ||
    typeof data.modelCount !== "number"
  ) {
    throw new Error("Unexpected provider test response shape");
  }
  return { ok: true, modelCount: data.modelCount };
}
