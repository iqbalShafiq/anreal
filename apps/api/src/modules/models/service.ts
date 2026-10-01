import {
  PROVIDER_KIND_META,
  type ProviderKind,
} from "@anreal/agent";

import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../utils/prisma.js";

type Decimal = Prisma.Decimal;

/**
 * A connection image model is only offered when its connection's kind actually
 * speaks an image endpoint. `PROVIDER_KIND_META[kind].imageStyle` is the
 * authority for that — never a kind list, which would drift. The save path
 * (`provider-connections/service.ts`) already refuses to register an image
 * model on a `"none"` kind, so this is defence in depth: it also protects
 * against a row that predates that rule or was written directly. An unknown
 * kind is treated as image-incapable.
 */
function isImageAccessible(row: {
  outputType: string;
  connection: { kind: string };
}): boolean {
  if (row.outputType !== "image") return true;
  const meta = PROVIDER_KIND_META[row.connection.kind as ProviderKind];
  return meta !== undefined && meta.imageStyle !== "none";
}

export type ModelInfo = {
  modelId: string;
  label: string;
  /** Full display name, e.g. "GPT 5.6 Luna" (falls back to label). */
  name: string;
  hint: string | null;
  description: string | null;
  /**
   * Who made the model, declared by the user on a BYOK row. Filter facet only
   * — never routing. Catalog rows have no such column and project null.
   */
  vendorLabel: string | null;
  iconSvg: string;
  provider: { slug: string; name: string };
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
  /** "text" | "image" — chat model or image generator. */
  outputType: "text" | "image";
  /** Image-gen capability descriptors (from OpenRouter discovery). */
  imageCapabilities: Prisma.JsonValue | null;
  /** Input modalities the model accepts, e.g. ["text","image","file"]. */
  inputModalities: string[];
  sortOrder: number;
  /** Seeded global catalog, or a model registered on a user connection. */
  source: "catalog" | "connection";
  /** Set only for `source: "connection"` rows. */
  connectionId: string | null;
};

export type ReasoningEffortInfo = {
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
};

function toNumber(value: Decimal | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toModelInfo(row: {
  modelId: string;
  label: string;
  name: string;
  hint: string | null;
  description: string | null;
  iconSvg: string;
  contextWindowTokens: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputPricePerMTokens: Decimal | null;
  cachedInputPricePerMTokens: Decimal | null;
  outputPricePerMTokens: Decimal | null;
  cacheWriteMultiplier: Decimal | null;
  longPromptThresholdTokens: number | null;
  longPromptInputMultiplier: Decimal | null;
  longPromptOutputMultiplier: Decimal | null;
  sortOrder: number;
  provider: { slug: string; name: string };
  reasoningEfforts: { effort: { key: string } }[];
  outputType: string;
  imageCapabilities: Prisma.JsonValue | null;
  inputModalities: Prisma.JsonValue | null;
}): ModelInfo {
  const inputModalities = Array.isArray(row.inputModalities)
    ? row.inputModalities.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  return {
    modelId: row.modelId,
    label: row.label,
    name: row.name || row.label,
    hint: row.hint,
    description: row.description,
    vendorLabel: null,
    iconSvg: row.iconSvg,
    provider: row.provider,
    contextWindowTokens: row.contextWindowTokens,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    prices: {
      input: toNumber(row.inputPricePerMTokens),
      cachedInput: toNumber(row.cachedInputPricePerMTokens),
      output: toNumber(row.outputPricePerMTokens),
      cacheWriteMultiplier: toNumber(row.cacheWriteMultiplier),
      longPromptThresholdTokens: row.longPromptThresholdTokens,
      longPromptInputMultiplier: toNumber(row.longPromptInputMultiplier),
      longPromptOutputMultiplier: toNumber(row.longPromptOutputMultiplier),
    },
    reasoningEfforts: row.reasoningEfforts
      .map((entry) => entry.effort.key)
      .sort(),
    outputType: row.outputType === "image" ? "image" : "text",
    imageCapabilities: row.imageCapabilities,
    inputModalities,
    sortOrder: row.sortOrder,
    source: "catalog",
    connectionId: null,
  };
}

/**
 * Project a user connection model onto the catalog shape so the composer and
 * the run resolver see one vocabulary. Prices stay null: a BYOK model's cost
 * is the user's own contract with their provider.
 */
function toConnectionModelInfo(row: {
  slug: string;
  name: string;
  label: string;
  hint: string | null;
  description: string | null;
  vendorLabel: string | null;
  iconSvg: string;
  outputType: string;
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEfforts: string[];
  capabilities: Prisma.JsonValue | null;
  imageCapabilities: Prisma.JsonValue | null;
  sortOrder: number;
  connectionId: string;
  connection: { slug: string; label: string };
}): ModelInfo {
  const capabilities =
    typeof row.capabilities === "object" &&
    row.capabilities !== null &&
    !Array.isArray(row.capabilities)
      ? (row.capabilities as Record<string, unknown>)
      : null;
  // The adapter's own capability declaration decides modalities — the same
  // source the run resolver uses to pick vision instructions.
  const inputModalities = [
    "text",
    ...(capabilities?.imageInput === true ? ["image"] : []),
    ...(capabilities?.documentInput === true ? ["file"] : []),
  ];
  return {
    modelId: row.slug,
    label: row.label,
    name: row.name || row.label,
    hint: row.hint,
    description: row.description,
    vendorLabel: row.vendorLabel,
    iconSvg: row.iconSvg,
    provider: { slug: row.connection.slug, name: row.connection.label },
    contextWindowTokens: row.contextWindowTokens ?? 0,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    prices: {
      input: null,
      cachedInput: null,
      output: null,
      cacheWriteMultiplier: null,
      longPromptThresholdTokens: null,
      longPromptInputMultiplier: null,
      longPromptOutputMultiplier: null,
    },
    reasoningEfforts: [...row.reasoningEfforts],
    outputType: row.outputType === "image" ? "image" : "text",
    imageCapabilities: row.imageCapabilities,
    inputModalities,
    sortOrder: row.sortOrder,
    source: "connection",
    connectionId: row.connectionId,
  };
}

export const MODEL_SELECT = {
  modelId: true,
  label: true,
  name: true,
  hint: true,
  description: true,
  iconSvg: true,
  contextWindowTokens: true,
  maxInputTokens: true,
  maxOutputTokens: true,
  inputPricePerMTokens: true,
  cachedInputPricePerMTokens: true,
  outputPricePerMTokens: true,
  cacheWriteMultiplier: true,
  longPromptThresholdTokens: true,
  longPromptInputMultiplier: true,
  longPromptOutputMultiplier: true,
  outputType: true,
  inputModalities: true,
  outputModalities: true,
  imageCapabilities: true,
  sortOrder: true,
  provider: { select: { slug: true, name: true } },
  reasoningEfforts: {
    select: { effort: { select: { key: true } } },
    orderBy: { effort: { sortOrder: "asc" } },
  },
} as const;

export async function listModels(input?: {
  outputType?: "text" | "image";
  userId?: string;
}): Promise<{
  models: ModelInfo[];
  reasoningEfforts: ReasoningEffortInfo[];
}> {
  const outputType = input?.outputType;
  const [catalogRows, connectionRows, reasoningEfforts] = await Promise.all([
    prisma.chatModel.findMany({
      where: {
        isActive: true,
        provider: { isActive: true },
        ...(outputType ? { outputType } : {}),
      },
      select: MODEL_SELECT,
      orderBy: [{ sortOrder: "asc" }, { modelId: "asc" }],
    }),
    input?.userId
      ? prisma.providerModel.findMany({
          where: {
            userId: input.userId,
            isActive: true,
            connection: { isActive: true },
            ...(outputType ? { outputType } : {}),
          },
          include: {
            connection: { select: { slug: true, label: true, kind: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
        })
      : Promise.resolve([]),
    prisma.reasoningEffort.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { key: true, label: true, description: true, sortOrder: true },
    }),
  ]);

  return {
    models: [
      ...catalogRows.map(toModelInfo),
      // A connection image model joins the merged catalog only when its
      // connection's kind can actually generate images (see `isImageAccessible`).
      ...connectionRows
        .filter(isImageAccessible)
        .map(toConnectionModelInfo),
    ],
    reasoningEfforts: reasoningEfforts.map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      sortOrder: row.sortOrder,
    })),
  };
}

/**
 * Resolve a model id inside one user's scope. The global catalog wins for an
 * unqualified id; a connection model is only reachable through its owner.
 */
export async function findActiveModel(
  modelId: string,
  userId?: string,
): Promise<ModelInfo | null> {
  const catalog = await prisma.chatModel.findFirst({
    where: { modelId, isActive: true, provider: { isActive: true } },
    select: MODEL_SELECT,
  });
  if (catalog) return toModelInfo(catalog);
  if (!userId) return null;
  const connection = await prisma.providerModel.findFirst({
    where: {
      slug: modelId,
      userId,
      isActive: true,
      connection: { isActive: true },
    },
    include: {
      connection: { select: { slug: true, label: true, kind: true } },
    },
  });
  if (!connection || !isImageAccessible(connection)) return null;
  return toConnectionModelInfo(connection);
}
