import { Hono } from "hono";
import z from "zod";
import {
  PROVIDER_KINDS,
  PROVIDER_KIND_META,
  effortVocabulary,
} from "@anreal/agent";
import { prisma } from "../../utils/prisma.js";
import { requireUser, type AuthVariables } from "../auth/middleware.js";
import {
  CONNECTION_LABEL_MAX,
  ICON_SVG_MAX,
  MODEL_DESCRIPTION_MAX,
  MODEL_HINT_MAX,
  MODEL_NAME_MAX,
  MODEL_UPSTREAM_ID_MAX,
  ProviderInputError,
  createConnection,
  createConnectionModel,
  deleteConnection,
  deleteConnectionModel,
  discoverConnectionModels,
  listConnectionModels,
  listConnections,
  prefillConnectionModel,
  publishedImageLimits,
  setConnectionEnabled,
  testProviderConnection,
  updateConnection,
  updateConnectionModel,
  type ProviderIssue,
} from "./service.js";

const connectionBaseSchema = z
  .object({
    kind: z.string().max(40).optional(),
    label: z.string().max(CONNECTION_LABEL_MAX + 10).optional(),
    slug: z.string().max(120).optional(),
    baseUrl: z.string().max(2048).nullable().optional(),
    api: z.string().max(20).nullable().optional(),
    apiKey: z.string().max(4096).optional(),
    // Shape is validated by sanitizeHeaders, which owns the header rules.
    headers: z.unknown().optional(),
  })
  .strict();

/** Creating needs a kind and a label; updating may change any subset. */
const connectionCreateSchema = connectionBaseSchema.extend({
  kind: z.string().min(1).max(40),
  label: z.string().min(1).max(CONNECTION_LABEL_MAX + 10),
});

const connectionUpdateSchema = connectionBaseSchema;

const modelCreateSchema = z
  .object({
    upstreamId: z.string().max(MODEL_UPSTREAM_ID_MAX + 10),
    name: z.string().max(MODEL_NAME_MAX + 10).optional(),
    label: z.string().max(MODEL_NAME_MAX + 10).optional(),
    hint: z.string().max(MODEL_HINT_MAX + 10).nullable().optional(),
    description: z
      .string()
      .max(MODEL_DESCRIPTION_MAX + 10)
      .nullable()
      .optional(),
    iconSvg: z.string().max(ICON_SVG_MAX).optional(),
    outputType: z.enum(["text", "image"]).optional(),
    // Shape is validated by parseImageCapabilities, which owns the rules.
    imageCapabilities: z.unknown().optional(),
    contextWindowTokens: z.number().int().positive().nullable().optional(),
    maxInputTokens: z.number().int().positive().nullable().optional(),
    maxOutputTokens: z.number().int().positive().nullable().optional(),
    reasoningEfforts: z.array(z.string().max(40)).max(20).optional(),
  })
  .strict();

const modelUpdateSchema = modelCreateSchema.partial();

const prefillBodySchema = z
  .object({
    upstreamId: z.string().max(MODEL_UPSTREAM_ID_MAX + 10),
    reasoningEfforts: z.array(z.string().max(40)).max(20).nullable().optional(),
  })
  .strict();

/**
 * Deliberately non-strict: the editor may send fields the test does not need
 * (label, slug); unknown keys are stripped, not rejected.
 */
const connectionTestSchema = z.object({
  kind: z.string().min(1).max(40),
  baseUrl: z.string().max(2048).nullable().optional(),
  api: z.string().max(20).nullable().optional(),
  apiKey: z.string().max(4096).nullable().optional(),
  headers: z.unknown().optional(),
  connectionId: z.string().max(256).nullable().optional(),
});

/**
 * The service may be mocked in focused tests, where class identity is lost, so
 * recognise the error by name as well as by instance.
 */
function asProviderError(
  error: unknown,
): { issues: ProviderIssue[] } | null {
  if (error instanceof ProviderInputError) return { issues: error.issues };
  if (typeof error === "object" && error !== null) {
    const candidate = error as { name?: unknown; issues?: unknown };
    if (candidate.name === "ProviderInputError" && Array.isArray(candidate.issues)) {
      return { issues: candidate.issues as ProviderIssue[] };
    }
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function notFound(path = "id") {
  return { error: "Connection not found", issues: [{ path, message: "Connection not found" }] };
}

/**
 * The image limits a kind publishes to the client come from the save path
 * itself (`publishedImageLimits` in `./service.js`), so the client applies the
 * same rules the server enforces and this layer restates nothing.
 */

/** Map a service failure onto a status plus a field-level body. */
function providerErrorResponse(error: unknown) {
  // A Prisma unique violation has no ProviderInputError shape, so it has to be
  // recognised before the gate below or it degrades to a generic 500.
  if (isUniqueViolation(error)) {
    return {
      status: 400 as const,
      body: {
        error: "That slug or model id is already in use",
        issues: [
          { path: "slug", message: "That slug or model id is already in use" },
        ],
      },
    };
  }
  const providerError = asProviderError(error);
  if (!providerError) return null;
  const missing = providerError.issues.some((issue) =>
    /not found/i.test(issue.message),
  );
  if (missing) return { status: 404 as const, body: notFound() };
  return {
    status: 400 as const,
    body: { error: providerError.issues[0]?.message ?? "Invalid provider configuration", issues: providerError.issues },
  };
}

export const providerConnectionsRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", requireUser)
  // Registered before `/:id` so "kinds" is never captured as an id.
  .get("/kinds", (c) =>
    c.json({
      kinds: PROVIDER_KINDS.map((kind) => {
        const meta = PROVIDER_KIND_META[kind];
        return {
          kind,
          ...meta,
          imageLimits: publishedImageLimits(meta.imageStyle),
        };
      }),
      effortVocabulary: effortVocabulary(),
    }),
  )
  .get("/", async (c) =>
    c.json(await listConnections(prisma, c.get("user").id)),
  )
  // Registered before `/:id` so "test" is never captured as an id.
  .post("/test", async (c) => {
    const parsed = connectionTestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid provider test request" }, 400);
    }
    try {
      return c.json(
        await testProviderConnection(prisma, c.get("user").id, parsed.data),
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .post("/", async (c) => {
    const parsed = connectionCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid provider connection" }, 400);
    }
    try {
      return c.json(await createConnection(prisma, c.get("user").id, parsed.data), 201);
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .patch("/:id/enabled", async (c) => {
    const parsed = z
      .object({ isEnabled: z.boolean() })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid enabled request" }, 400);
    }
    try {
      return c.json(
        await setConnectionEnabled(
          prisma,
          c.get("user").id,
          c.req.param("id"),
          parsed.data.isEnabled,
        ),
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    const row = (await listConnections(prisma, user.id)).find(
      (connection) => connection.id === c.req.param("id"),
    );
    if (!row) return c.json(notFound(), 404);
    return c.json(row);
  })
  .patch("/:id", async (c) => {
    const parsed = connectionUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid provider connection" }, 400);
    }
    try {
      return c.json(
        await updateConnection(prisma, c.get("user").id, c.req.param("id"), parsed.data),
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .delete("/:id", async (c) => {
    try {
      await deleteConnection(prisma, c.get("user").id, c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .get("/:id/models", async (c) => {
    try {
      return c.json(
        await listConnectionModels(prisma, c.get("user").id, c.req.param("id")),
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .post("/:id/models", async (c) => {
    const parsed = modelCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid provider model" }, 400);
    }
    try {
      return c.json(
        await createConnectionModel(prisma, c.get("user").id, c.req.param("id"), parsed.data),
        201,
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .post("/:id/models/discover", async (c) => {
    try {
      return c.json(
        await discoverConnectionModels(prisma, c.get("user").id, c.req.param("id")),
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .post("/:id/models/prefill", async (c) => {
    const parsed = prefillBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid prefill request" }, 400);
    }
    try {
      return c.json(
        await prefillConnectionModel(prisma, c.get("user").id, c.req.param("id"), parsed.data),
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .patch("/:id/models/:modelId", async (c) => {
    const parsed = modelUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid provider model" }, 400);
    }
    try {
      return c.json(
        await updateConnectionModel(
          prisma,
          c.get("user").id,
          c.req.param("id"),
          c.req.param("modelId"),
          parsed.data,
        ),
      );
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  })
  .delete("/:id/models/:modelId", async (c) => {
    try {
      await deleteConnectionModel(
        prisma,
        c.get("user").id,
        c.req.param("id"),
        c.req.param("modelId"),
      );
      return c.json({ ok: true });
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });
