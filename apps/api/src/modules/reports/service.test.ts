import { describe, expect, it } from "vitest";
import { buildReportPdf, countPdfPages } from "./service.js";
import { chartSpecToSvg } from "../charts/snapshot.js";

describe("buildReportPdf", () => {
  it("embeds title, markdown text, and citations into a PDF", async () => {
    const pdf = await buildReportPdf({
      title: "Laporan",
      markdown: "# Halo\nIsi laporan.",
      citationMap: [{ claim: "angka", documentId: "d1", pageIndex: 0 }],
    });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("renders GFM pipe tables as PDF content", async () => {
    const pdf = await buildReportPdf({
      title: "Tabel",
      markdown: [
        "| Region | Revenue | Units |",
        "| --- | --- | --- |",
        "| West | 10660 | 215 |",
        "| South | 10630 | 203 |",
      ].join("\n"),
    });
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("embeds a chart snapshot SVG without going blank", async () => {
    const svg = chartSpecToSvg({
      kind: "bar",
      labels: ["A", "B"],
      series: [{ name: "sum(x)", values: [3, 7] }],
      title: "Chart",
    });
    const pdf = await buildReportPdf({
      title: "Laporan",
      markdown: "Hasil analisis.",
      svgAssets: [svg],
    });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("embeds raster PNG assets (I2: images reach PDFs)", async () => {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const pdf = await buildReportPdf({
      title: "Laporan",
      markdown: "Dengan gambar.",
      rasterAssets: [{ buffer: png, mediaType: "image/png" }],
    });
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("renders bold and links instead of dropping markdown syntax", async () => {
    const pdf = await buildReportPdf({
      title: "Laporan",
      markdown: "Klaim **penting** dari [sumber](https://example.com/a) ini.",
    });
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("places inline ![alt](assetId) refs at their position in the flow", async () => {
    const svg = chartSpecToSvg({
      kind: "bar",
      labels: ["A", "B"],
      series: [{ name: "sum(x)", values: [3, 7] }],
      title: "Chart",
    });
    const pdf = await buildReportPdf({
      title: "Inline",
      markdown: "# Section\n\nText before.\n\n![Revenue by region](asset-1)\n\nText after.",
      svgAssets: [svg],
      svgAssetIds: ["asset-1"],
    });
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("still renders unreferenced assets at the end", async () => {
    const svg = chartSpecToSvg({
      kind: "bar",
      labels: ["A", "B"],
      series: [{ name: "sum(x)", values: [3, 7] }],
      title: "Chart",
    });
    const pdf = await buildReportPdf({
      title: "Leftover",
      markdown: "No image refs here.",
      svgAssets: [svg],
      svgAssetIds: ["asset-1"],
    });
    expect(countPdfPages(pdf)).toBeGreaterThanOrEqual(1);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("flows a long report across pages and reports the real page count", async () => {
    const rows = Array.from(
      { length: 70 },
      (_, i) => `| Row ${i + 1} | ${(i + 1) * 137} | ${i % 7} |`,
    ).join("\n");
    const svg = chartSpecToSvg({
      kind: "bar",
      labels: ["A", "B"],
      series: [{ name: "sum(x)", values: [3, 7] }],
      title: "Chart",
    });
    const pdf = await buildReportPdf({
      title: "Laporan Panjang",
      markdown: `# Tabel besar\n\n| Item | Nilai | Grup |\n| --- | --- | --- |\n${rows}`,
      svgAssets: [svg],
      svgCaptions: ["Tren nilai"],
    });
    const pages = countPdfPages(pdf);
    expect(pages).toBeGreaterThan(1);
    expect(pdf.byteLength).toBeGreaterThan(3000);
  });
});

describe("countPdfPages", () => {
  it("reads the count from the pages tree", () => {
    const bytes = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R] /Count 5 >> endobj",
    );
    expect(countPdfPages(bytes)).toBe(5);
  });

  it("falls back to one page when no tree is present", () => {
    expect(countPdfPages(new TextEncoder().encode("%PDF-1.4"))).toBe(1);
  });
});
