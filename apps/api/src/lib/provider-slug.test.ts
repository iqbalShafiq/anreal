import { describe, expect, it } from "vitest";
import {
  deriveConnectionSlug,
  deriveModelSlug,
  isReservedConnectionSlug,
  PROVIDER_MODEL_SLUG_RE,
  sanitizeSlugPart,
  suffixSlug,
} from "./provider-slug.js";

describe("sanitizeSlugPart", () => {
  it("lowercases and keeps safe characters", () => {
    expect(sanitizeSlugPart("GPT-5.6_Luna", "custom")).toBe("gpt-5.6_luna");
  });

  it("replaces unsafe runs with a single hyphen", () => {
    expect(sanitizeSlugPart("openai/GPT 5.6  Luna", "custom")).toBe(
      "openai-gpt-5.6-luna",
    );
  });

  it("defuses path traversal", () => {
    expect(sanitizeSlugPart("../../etc/passwd", "custom")).toBe("etc-passwd");
  });

  it("strips leading and trailing separators", () => {
    expect(sanitizeSlugPart("--a--", "custom")).toBe("a");
  });

  it("falls back when nothing survives", () => {
    expect(sanitizeSlugPart("模型", "custom")).toBe("custom");
    expect(sanitizeSlugPart("", "custom")).toBe("custom");
    expect(sanitizeSlugPart("///", "custom")).toBe("custom");
  });

  it("caps length", () => {
    expect(sanitizeSlugPart("a".repeat(300), "custom").length).toBe(96);
  });
});

describe("deriveConnectionSlug", () => {
  it("derives a kebab slug from a label", () => {
    expect(deriveConnectionSlug("My OpenRouter")).toBe("my-openrouter");
    expect(deriveConnectionSlug("OpenAI")).toBe("openai");
  });
});

describe("deriveModelSlug", () => {
  it("prefixes with the connection slug and keeps slashes in the upstream id", () => {
    expect(deriveModelSlug("openrouter", "openai/gpt-5.6-luna")).toBe(
      "openrouter/openai-gpt-5.6-luna",
    );
  });

  it("distinguishes the same model on two providers", () => {
    const a = deriveModelSlug("openrouter", "openai/gpt-5.6-luna");
    const b = deriveModelSlug("my-azure", "openai/gpt-5.6-luna");
    expect(a).not.toBe(b);
  });

  it("always produces a slug matching PROVIDER_MODEL_SLUG_RE", () => {
    for (const upstream of [
      "openai/GPT-5.6 Luna",
      "anthropic/claude-sonnet-5",
      "../../etc/passwd",
      "模型",
      "///",
      "",
      "a".repeat(200),
    ]) {
      expect(deriveModelSlug("conn", upstream)).toMatch(PROVIDER_MODEL_SLUG_RE);
    }
  });

  it("caps total length", () => {
    expect(deriveModelSlug("c".repeat(60), "m".repeat(200)).length).toBeLessThanOrEqual(96);
  });
});

describe("suffixSlug", () => {
  it("returns the base for attempt 1 and suffixes afterwards", () => {
    expect(suffixSlug("a/b", 1)).toBe("a/b");
    expect(suffixSlug("a/b", 2)).toBe("a/b-2");
    expect(suffixSlug("a/b", 3)).toBe("a/b-3");
  });

  it("keeps the result within the slug shape for long bases", () => {
    const result = suffixSlug(`${"c".repeat(90)}/x`, 12);
    expect(result.length).toBeLessThanOrEqual(96);
    expect(result).toMatch(PROVIDER_MODEL_SLUG_RE);
  });
});

describe("isReservedConnectionSlug", () => {
  it("reserves the global provider namespaces", () => {
    expect(isReservedConnectionSlug("openai")).toBe(true);
    expect(isReservedConnectionSlug("google")).toBe(true);
    expect(isReservedConnectionSlug("my-openrouter")).toBe(false);
  });
});
