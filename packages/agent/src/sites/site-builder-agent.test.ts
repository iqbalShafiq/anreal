import { describe, expect, it, vi } from "vitest";
import {
  SITE_BUILDER_INSTRUCTIONS,
  buildSiteBuilderPrompt,
  createSiteBuilderAgent,
} from "./site-builder-agent.js";
import type { SiteBrief } from "./site-plan.js";

vi.stubEnv("OPENAI_API_KEY", "test-key");

const BRIEF: SiteBrief = {
  siteName: "Kopi Senja",
  audience: "pecinta kopi",
  cta: "Pesan Sekarang",
  sections: ["hero", "menu", "kontak"],
  vibe: "hangat minimalis",
};

describe("buildSiteBuilderPrompt", () => {
  it("lists every section exactly once", () => {
    const prompt = buildSiteBuilderPrompt(BRIEF);
    expect(prompt).toContain("Kopi Senja");
    expect(prompt).toContain("Pesan Sekarang");
    for (const section of BRIEF.sections) {
      expect(prompt).toContain(section);
    }
  });

  it("carries the user's verbatim request and the definition of done", () => {
    const prompt = buildSiteBuilderPrompt(BRIEF, "Warmer earth tones, please.");
    expect(prompt).toContain("Warmer earth tones, please.");
    expect(prompt).toContain("Definition of done");
    expect(prompt).toContain("dist stylesheet contains the page's classes");
  });
});

describe("createSiteBuilderAgent", () => {
  it("attaches only the provided sandbox tools", () => {
    const tools = [{ name: "write_file" }, { name: "exec_command" }] as never[];
    const agent = createSiteBuilderAgent({ tools }) as unknown as {
      tools: { name: string }[];
    };
    expect(agent.tools.map((tool) => tool.name).sort()).toEqual([
      "exec_command",
      "write_file",
    ]);
  });

  it("accepts an explicit model without throwing", () => {
    expect(() =>
      createSiteBuilderAgent({ model: { provider: "stub" } as never, tools: [] }),
    ).not.toThrow();
  });

  it("bans placeholders and backend code in the instructions", () => {
    expect(SITE_BUILDER_INSTRUCTIONS).toContain("lorem ipsum");
    expect(SITE_BUILDER_INSTRUCTIONS.toLowerCase()).toContain("no backend");
  });

  it("teaches the styling pipeline and the build verification", () => {
    expect(SITE_BUILDER_INSTRUCTIONS).toContain("reachable from that import");
    expect(SITE_BUILDER_INSTRUCTIONS).toContain("dist/assets");
    expect(SITE_BUILDER_INSTRUCTIONS).toContain("grep -o");
    expect(SITE_BUILDER_INSTRUCTIONS).toContain("no half-styled rebuilds");
  });
});
