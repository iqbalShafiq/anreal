/**
 * The one test that drives the whole vendor path against a real database.
 *
 * Every layer has its own unit test — `provider-connections/service.test.ts`
 * proves `vendorLabel` persists, `models/service.test.ts` proves the projection,
 * `model-picker.test.ts` proves the filter — but those use hand-built rows. A
 * regression that flipped `listModels`'s connection query from `include` to
 * `select` (or renamed the column) would drop `vendorLabel` at runtime while
 * every fake stayed green. This test writes a real connection and model, calls
 * the real `listModels`, and asserts the value survived the real Prisma query.
 *
 * Follows the `native-memory.integration.test.ts` idiom: the configured Postgres
 * service and migrated schema are required, and the rows this test owns are
 * removed in `afterAll`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../utils/prisma.js";
import { listModels } from "./service.js";
import {
  createConnection,
  createConnectionModel,
} from "../provider-connections/service.js";

const suffix = randomUUID().slice(0, 8);
const ownerId = `models-vendor-integration-owner-${suffix}`;
const strangerId = `models-vendor-integration-stranger-${suffix}`;

/** Two users must exist: provider rows cascade from `User`. */
const userIds = [ownerId, strangerId];

/** A distinctive upstream id that is trivially attributable in the result. */
const ownerUpstreamId = `vendor-path-proof-${suffix}`;

describe("listModels vendor path (real database)", () => {
  let databaseReady = false;
  let ownerConnectionId = "";
  let ownerModelSlug = "";

  beforeAll(async () => {
    try {
      // A trivial read both proves connectivity and forces the schema check.
      await prisma.user.count();
      await prisma.user.createMany({
        data: userIds.map((id, index) => ({
          id,
          name: `Models vendor integration ${index}`,
          email: `${id}@example.test`,
        })),
      });
      databaseReady = true;
    } catch (error) {
      throw new Error(
        "Vendor integration requires the configured Postgres service and migrated schema. Run `pnpm --filter @anreal/api db:deploy` first.",
        { cause: error },
      );
    }

    // Build the fixture through the real service functions, not raw inserts:
    // this is what makes the test a whole-path test rather than another fake.
    const connection = await createConnection(
      prisma as never,
      ownerId,
      {
        kind: "compatible",
        label: `Vendor Path ${suffix}`,
        slug: `vendor-path-${suffix}`,
        baseUrl: "https://gateway.example/v1",
        apiKey: "sk-integration-vendor-path",
      },
    );
    ownerConnectionId = connection.id;

    await createConnectionModel(prisma as never, ownerId, ownerConnectionId, {
      upstreamId: ownerUpstreamId,
      name: `Vendor Path Model ${suffix}`,
      label: `Vendor Path Model ${suffix}`,
      vendorLabel: "OpenAI",
      contextWindowTokens: 200_000,
      reasoningEfforts: ["low"],
    });

    const created = await prisma.providerModel.findFirst({
      where: { userId: ownerId, upstreamId: ownerUpstreamId },
      select: { slug: true },
    });
    ownerModelSlug = created?.slug ?? "";
  });

  afterAll(async () => {
    if (!databaseReady) return;
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("carries a stored vendorLabel through the real merged query", async () => {
    const result = await listModels({ userId: ownerId });
    const row = result.models.find((model) => model.modelId === ownerModelSlug);

    expect(row).toBeDefined();
    // The vendor survives the real Prisma query, not a hand-built fake row.
    expect(row?.vendorLabel).toBe("OpenAI");
    expect(row?.source).toBe("connection");
  });

  it("projects a null vendorLabel for a catalog row in the same result", async () => {
    const result = await listModels({ userId: ownerId });
    const catalog = result.models.find((model) => model.source === "catalog");

    expect(catalog).toBeDefined();
    expect(catalog?.vendorLabel).toBeNull();
  });

  it("does not leak one user's connection model into another user's list", async () => {
    const stranger = await listModels({ userId: strangerId });

    expect(
      stranger.models.some((model) => model.modelId === ownerModelSlug),
    ).toBe(false);
    expect(
      stranger.models.some((model) => model.source === "connection"),
    ).toBe(false);
  });

  it("carries the vendor through the composer's consumption shape", async () => {
    // Put the real row through the API surface the picker reads, so any
    // field the picker needs is proven present end-to-end.
    const result = await listModels({ userId: ownerId });
    const row = result.models.find((model) => model.modelId === ownerModelSlug);

    expect(row).toMatchObject({
      modelId: ownerModelSlug,
      vendorLabel: "OpenAI",
      source: "connection",
      connectionId: ownerConnectionId,
      provider: { slug: `vendor-path-${suffix}` },
    });
    expect(Array.isArray(row?.inputModalities)).toBe(true);
    expect(Array.isArray(row?.reasoningEfforts)).toBe(true);
  });
});
