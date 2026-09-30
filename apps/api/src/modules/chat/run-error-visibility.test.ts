import { describe, expect, it } from "vitest";
import { ProviderConnectionMissingError } from "./run-recipe.js";
import { isUserFacingRunError } from "./run-worker.js";

describe("user-facing run errors", () => {
  it("lets the provider-connection message through", () => {
    expect(isUserFacingRunError(new ProviderConnectionMissingError("pc_1"))).toBe(true);
  });

  it("keeps an ordinary failure opaque", () => {
    expect(isUserFacingRunError(new Error("boom"))).toBe(false);
  });

  it("keeps unknown shapes opaque", () => {
    expect(isUserFacingRunError(undefined)).toBe(false);
    expect(isUserFacingRunError("boom")).toBe(false);
    expect(isUserFacingRunError({ code: "SOMETHING_ELSE" })).toBe(false);
  });

  it("does not treat cancellation as user-facing", () => {
    // Cancellation has its own copy; it must not be reclassified here.
    expect(isUserFacingRunError({ code: "CHAT_RUN_CANCELLED" })).toBe(false);
  });
});