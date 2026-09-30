import {
  createCompletionModel,
  createCompletionModelFor,
  type ModelContextLimits,
  type ProviderKind,
} from "@anreal/agent";
import type { CompletionModel } from "@anvia/core";
import { decodeProviderCredentials } from "../provider-connections/credentials.js";
import {
  ROLE_KEYS,
  roleDefaultModelId,
  roleEnvModelId,
  type RoleKey,
} from "./role-defaults.js";
import { findActiveModel } from "./service.js";

export { ROLE_KEYS, roleDefaultModelId, roleEnvModelId };
export type { RoleKey };

export type RoleIssue = { path: string; message: string };

/** Mirrors `ProviderInputError`: one thrown error carrying every field issue. */
export class RoleInputError extends Error {
  readonly issues: RoleIssue[];
  constructor(issues: RoleIssue[]) {
    super(issues[0]?.message ?? "Invalid model role assignment");
    this.name = "RoleInputError";
    this.issues = issues;
  }
}

export type RoleTarget = { modelId: string; connectionId: string | null };

export type RoleInfo = {
  role: RoleKey;
  modelId: string | null;
  defaultModelId: string | null;
};

/**
 * Duck-typed so focused tests can inject a fake without a Prisma client,
 * mirroring `ProviderConnectionsDb` and `SkillsDb`.
 */
export type RolesDb = {
  modelRoleAssignment: {
    findMany(args: unknown): Promise<unknown[]>;
    findFirst(args: unknown): Promise<unknown | null>;
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  chatModel: {
    findFirst(args: unknown): Promise<unknown | null>;
  };
  providerModel: {
    findFirst(args: unknown): Promise<unknown | null>;
  };
  providerConnection: {
    findFirst(args: unknown): Promise<unknown | null>;
  };
};

type RoleAssignmentRow = {
  role: string;
  catalogModelId: string | null;
  providerModelId: string | null;
};

type ConnectionRow = {
  kind: string;
  baseUrl: string | null;
  api: string | null;
  credentialsRef: string;
  models: {
    upstreamId: string;
    reasoningEfforts: string[];
    contextWindowTokens: number | null;
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
  }[];
};

function isRoleKey(value: unknown): value is RoleKey {
  return (
    typeof value === "string" &&
    (ROLE_KEYS as readonly string[]).includes(value)
  );
}

function unknownRole(path: string, role: unknown): never {
  throw new RoleInputError([
    { path, message: `Unknown role: ${String(role)}` },
  ]);
}

/** The env/default target for a role, or null when the role has no default. */
function defaultTarget(role: RoleKey): RoleTarget | null {
  const modelId = roleDefaultModelId(role);
  return modelId === null ? null : { modelId, connectionId: null };
}

/**
 * Every assignment the user has ever saved, one row per role, in `ROLE_KEYS`
 * order. A BYOK row's `modelId` is its stored slug; a row whose model has since
 * vanished (a pruned catalog row, a deleted connection model, an inactive
 * provider) projects `modelId: null` rather than throwing or showing a phantom
 * selection the resolver would silently ignore.
 */
export async function listRoleAssignments(
  db: RolesDb,
  userId: string,
): Promise<RoleInfo[]> {
  const rows = (await db.modelRoleAssignment.findMany({
    where: { userId },
  })) as RoleAssignmentRow[];
  const byRole = new Map(rows.map((row) => [row.role, row]));

  const infos: RoleInfo[] = [];
  for (const role of ROLE_KEYS) {
    const row = byRole.get(role);
    let modelId: string | null = null;
    if (row?.catalogModelId) {
      const catalog = await db.chatModel.findFirst({
        where: {
          modelId: row.catalogModelId,
          isActive: true,
          provider: { isActive: true },
        },
        select: { modelId: true },
      });
      if (catalog) {
        modelId = row.catalogModelId;
      } else {
        console.warn(
          `[models] role ${role} is assigned to catalog model "${row.catalogModelId}", which no longer exists — projecting no assignment`,
        );
      }
    } else if (row?.providerModelId) {
      const model = (await db.providerModel.findFirst({
        where: { id: row.providerModelId, userId },
        select: { slug: true },
      })) as { slug: string } | null;
      modelId = model?.slug ?? null;
    }
    infos.push({ role, modelId, defaultModelId: roleDefaultModelId(role) });
  }
  return infos;
}

/**
 * Resolve which model a role should use, honouring the exact precedence
 * `user assignment -> env var -> existing default`. A dangling assignment
 * (a pruned catalog row, or a deleted connection model) warns and falls back;
 * it never throws, so a background job cannot crash on a stale assignment.
 */
export async function resolveRoleTarget(
  db: RolesDb,
  userId: string,
  role: RoleKey,
): Promise<RoleTarget | null> {
  if (!isRoleKey(role)) unknownRole("role", role);

  const assignment = (await db.modelRoleAssignment.findFirst({
    where: { userId, role },
  })) as RoleAssignmentRow | null;

  if (assignment?.catalogModelId) {
    const catalog = await db.chatModel.findFirst({
      where: {
        modelId: assignment.catalogModelId,
        isActive: true,
        provider: { isActive: true },
      },
    });
    if (catalog) {
      return { modelId: assignment.catalogModelId, connectionId: null };
    }
    console.warn(
      `[models] role ${role} is assigned to catalog model "${assignment.catalogModelId}", which no longer exists — falling back`,
    );
  } else if (assignment?.providerModelId) {
    const model = (await db.providerModel.findFirst({
      where: { id: assignment.providerModelId, userId },
      select: { slug: true, connectionId: true },
    })) as { slug: string; connectionId: string } | null;
    if (model) {
      return { modelId: model.slug, connectionId: model.connectionId };
    }
    console.warn(
      `[models] role ${role} is assigned to a connection model that no longer exists — falling back`,
    );
  }

  return defaultTarget(role);
}

/**
 * Save or clear a role assignment. The model id is the merged catalog id
 * (Task 2's API and Task 5's UI never learn which table a model lives in), so
 * it is validated against the caller's scope before being stored as either a
 * `catalogModelId` or a `providerModelId`.
 */
export async function setRoleAssignment(
  db: RolesDb,
  userId: string,
  role: RoleKey,
  modelId: string | null,
): Promise<RoleInfo> {
  if (!isRoleKey(role)) unknownRole("role", role);
  const defaultModelId = roleDefaultModelId(role);

  if (modelId === null) {
    await db.modelRoleAssignment.deleteMany({ where: { userId, role } });
    return { role, modelId: null, defaultModelId };
  }

  const info = await findActiveModel(modelId, userId);
  if (!info) {
    throw new RoleInputError([
      { path: "modelId", message: `Unknown model: ${modelId}` },
    ]);
  }
  if (role === "visionHelper" && !info.inputModalities.includes("image")) {
    throw new RoleInputError([
      {
        path: "modelId",
        message: "The vision helper model must accept image input",
      },
    ]);
  }

  let catalogModelId: string | null = null;
  let providerModelId: string | null = null;
  if (info.source === "connection") {
    const model = (await db.providerModel.findFirst({
      where: { slug: modelId, userId },
      select: { id: true },
    })) as { id: string } | null;
    if (!model) {
      throw new RoleInputError([
        { path: "modelId", message: `Unknown model: ${modelId}` },
      ]);
    }
    providerModelId = model.id;
  } else {
    catalogModelId = modelId;
  }

  await db.modelRoleAssignment.upsert({
    where: { userId_role: { userId, role } },
    create: { userId, role, catalogModelId, providerModelId },
    update: { catalogModelId, providerModelId },
  });

  return { role, modelId, defaultModelId };
}

/**
 * Build the completion model a role should run on, resolving a BYOK target's
 * connection in place (credentials never enter the store). Mirrors
 * `resolveRecipeCompletionModel`: the upstream model id comes from the stored
 * `upstreamId`, never parsed back out of the lowercased slug. Returns null when
 * the role has no target, the connection/model vanished, or its stored
 * credentials cannot be decoded, so the caller falls back to its previous
 * behaviour. A role lookup never throws.
 */
export async function buildRoleCompletionModel(
  db: RolesDb,
  userId: string,
  role: RoleKey,
): Promise<CompletionModel | null> {
  const target = await resolveRoleTarget(db, userId, role);
  if (!target) return null;
  if (target.connectionId === null) {
    return createCompletionModel(target.modelId);
  }

  const row = (await db.providerConnection.findFirst({
    where: { id: target.connectionId, userId },
    select: {
      kind: true,
      baseUrl: true,
      api: true,
      credentialsRef: true,
      models: {
        where: { slug: target.modelId },
        select: {
          upstreamId: true,
          reasoningEfforts: true,
          contextWindowTokens: true,
          maxInputTokens: true,
          maxOutputTokens: true,
        },
      },
    },
  })) as ConnectionRow | null;

  const model = row?.models[0];
  if (!row || !model) {
    console.warn(
      `[models] role ${role} could not resolve its provider connection — falling back`,
    );
    return null;
  }

  try {
    const credentials = decodeProviderCredentials(row.credentialsRef);
    const contextLimits: ModelContextLimits | null =
      model.contextWindowTokens === null
        ? null
        : {
            contextWindow: model.contextWindowTokens,
            ...(model.maxInputTokens !== null
              ? { maxInputTokens: model.maxInputTokens }
              : {}),
            ...(model.maxOutputTokens !== null
              ? { maxOutputTokens: model.maxOutputTokens }
              : {}),
          };

    return createCompletionModelFor({
      kind: row.kind as ProviderKind,
      upstreamId: model.upstreamId,
      api: row.api as "chat" | "responses" | null,
      credentials: {
        apiKey: credentials.apiKey,
        baseUrl: row.baseUrl,
        headers: credentials.headers ?? null,
      },
      contextLimits,
      reasoningEfforts: model.reasoningEfforts,
    });
  } catch (error) {
    // A corrupt reference — or a rotated/ephemeral PROVIDER_CREDENTIALS_KEY,
    // which makes every stored ref undecryptable at once — must not fail the
    // profile job, the site build, or an in-flight run. Match the vanished-row
    // contract: warn and let the caller fall back.
    console.warn(
      `[models] role ${role} could not build its provider connection — falling back`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
