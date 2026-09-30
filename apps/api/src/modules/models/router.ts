import { Hono } from "hono";
import z from "zod";
import { prisma } from "../../utils/prisma.js";
import { requireUser, type AuthVariables } from "../auth/middleware.js";
import {
  ROLE_KEYS,
  RoleInputError,
  listRoleAssignments,
  setRoleAssignment,
  type RoleIssue,
} from "./roles.js";
import { listModels } from "./service.js";

/**
 * The roles service may be mocked in focused tests, where class identity is
 * lost, so recognise `RoleInputError` by name as well as by instance.
 */
function asRoleError(error: unknown): { issues: RoleIssue[] } | null {
  if (error instanceof RoleInputError) return { issues: error.issues };
  if (typeof error === "object" && error !== null) {
    const candidate = error as { name?: unknown; issues?: unknown };
    if (candidate.name === "RoleInputError" && Array.isArray(candidate.issues)) {
      return { issues: candidate.issues as RoleIssue[] };
    }
  }
  return null;
}

/** Map a service failure onto a status plus a field-level body. */
function roleErrorResponse(error: unknown) {
  const roleError = asRoleError(error);
  if (!roleError) return null;
  if (roleError.issues.some((issue) => /not found/i.test(issue.message))) {
    return {
      status: 404 as const,
      body: {
        error: "Role assignment not found",
        issues: roleError.issues,
      },
    };
  }
  return {
    status: 400 as const,
    body: {
      error: roleError.issues[0]?.message ?? "Invalid role assignment",
      issues: roleError.issues,
    },
  };
}

const roleAssignmentSchema = z
  .object({
    role: z.enum(ROLE_KEYS),
    modelId: z.string().max(256).nullable(),
  })
  .strict();

export const modelsRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const outputType = c.req.query("outputType");
    if (
      outputType !== undefined &&
      outputType !== "text" &&
      outputType !== "image"
    ) {
      return c.json({ error: "outputType must be 'text' or 'image'" }, 400);
    }
    return c.json(
      await listModels({
        ...(outputType ? { outputType } : {}),
        userId: user.id,
      }),
    );
  })
  // Registered before any `:id`-shaped route so "roles" is never captured as an id.
  .get("/roles", async (c) =>
    c.json({ roles: await listRoleAssignments(prisma, c.get("user").id) }),
  )
  .put("/roles", async (c) => {
    const parsed = roleAssignmentSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid role assignment" }, 400);
    }
    try {
      return c.json(
        await setRoleAssignment(
          prisma,
          c.get("user").id,
          parsed.data.role,
          parsed.data.modelId,
        ),
      );
    } catch (error) {
      const response = roleErrorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });
