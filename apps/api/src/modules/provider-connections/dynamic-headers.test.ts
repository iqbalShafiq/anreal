import { describe, expect, it } from "vitest";
import {
  DYNAMIC_HEADER_SOURCES,
  HEADER_VALUE_MAX,
  isDynamicHeaderSource,
  resolveConnectionHeaders,
} from "./dynamic-headers.js";

const context = { sessionId: "s_1", userId: "u_1", requestId: "r_1" };

describe("dynamic provider headers", () => {
  it("keeps the vocabulary closed to the three declared sources", () => {
    expect(DYNAMIC_HEADER_SOURCES).toEqual(["sessionId", "requestId", "userId"]);
    expect(isDynamicHeaderSource("sessionId")).toBe(true);
    expect(isDynamicHeaderSource("apiKey")).toBe(false);
    expect(isDynamicHeaderSource("authorization")).toBe(false);
  });

  it("returns null for an absent or empty map", () => {
    expect(resolveConnectionHeaders(null, context)).toBeNull();
    expect(resolveConnectionHeaders(undefined, context)).toBeNull();
    expect(resolveConnectionHeaders({}, context)).toBeNull();
  });

  it("resolves a literal unchanged", () => {
    expect(resolveConnectionHeaders({ "x-static": "v" }, context)).toEqual({
      "x-static": "v",
    });
  });

  it("resolves each source from the context", () => {
    expect(
      resolveConnectionHeaders(
        {
          a: { dynamic: "sessionId" },
          b: { dynamic: "requestId" },
          c: { dynamic: "userId" },
        },
        context,
      ),
    ).toEqual({ a: "s_1", b: "r_1", c: "u_1" });
  });

  it("resolves literals and sources in one map", () => {
    expect(
      resolveConnectionHeaders(
        { "x-opencode-session": { dynamic: "sessionId" }, "x-tenant": "acme" },
        context,
      ),
    ).toEqual({ "x-opencode-session": "s_1", "x-tenant": "acme" });
  });

  it("fails loudly on an unknown source instead of sending the object", () => {
    const broken = { "x-bad": { dynamic: "goneInV2" } } as never;
    expect(() => resolveConnectionHeaders(broken, context)).toThrow(/x-bad/);
    // The serialization must never be produced as a value.
    expect(() => resolveConnectionHeaders(broken, context)).toThrow(
      /goneInV2/,
    );
  });

  it("rejects a resolved value longer than the header limit", () => {
    expect(() =>
      resolveConnectionHeaders(
        { "x-long": { dynamic: "sessionId" } },
        { ...context, sessionId: "s".repeat(HEADER_VALUE_MAX + 1) },
      ),
    ).toThrow(/x-long/);
  });

  it("accepts a resolved value exactly at the header limit", () => {
    const atLimit = "s".repeat(HEADER_VALUE_MAX);
    expect(
      resolveConnectionHeaders(
        { "x-long": { dynamic: "userId" } },
        { ...context, userId: atLimit },
      ),
    ).toEqual({ "x-long": atLimit });
  });
});
