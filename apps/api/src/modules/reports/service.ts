import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type BufferedRange = { start: number; count: number };

// eslint-disable-next-line @typescript-eslint/no-require-imports
type PdfDoc = {
  font(name: string): PdfDoc;
  fontSize(n: number): PdfDoc;
  text(t: string, opts?: Record<string, unknown>): PdfDoc;
  text(t: string, x: number, y: number, opts?: Record<string, unknown>): PdfDoc;
  image(src: Buffer | string, opts?: Record<string, unknown>): PdfDoc;
  image(src: Buffer | string, x: number, y: number, opts?: Record<string, unknown>): PdfDoc;
  openImage(src: Buffer | string): { width: number; height: number };
  moveDown(n?: number): PdfDoc;
  addPage(): PdfDoc;
  switchToPage(n: number): PdfDoc;
  bufferedPageRange(): BufferedRange;
  rect(x: number, y: number, w: number, h: number): PdfDoc;
  fillColor(color: string): PdfDoc;
  fill(color?: string): PdfDoc;
  strokeColor(color: string): PdfDoc;
  lineWidth(n: number): PdfDoc;
  moveTo(x: number, y: number): PdfDoc;
  lineTo(x: number, y: number): PdfDoc;
  stroke(): PdfDoc;
  widthOfString(t: string): number;
  page: { width: number; height: number };
  end(): void;
  on(ev: string, fn: (arg?: unknown) => void): void;
  y: number;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require("pdfkit") as new (opts?: Record<string, unknown>) => PdfDoc;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SVGtoPDF = require("svg-to-pdfkit") as (
  doc: unknown,
  svg: string,
  x: number,
  y: number,
  opts?: Record<string, unknown>,
) => void;

export type ReportCitation = {
  claim: string;
  documentId?: string;
  pageIndex?: number;
  webBundleId?: string;
  url?: string;
};

export type ReportRasterAsset = { buffer: Uint8Array; mediaType: string };

/**
 * Editorial layout tokens for the report PDF. Everything on the page uses
 * this scale so hierarchy stays consistent across sections and pages.
 */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 62, bottom: 66, left: 60, right: 60 };
const CONTENT_W = PAGE.width - MARGIN.left - MARGIN.right;
const CONTENT_BOTTOM = PAGE.height - MARGIN.bottom;
const FIGURE_H = (CONTENT_W * 360) / 640;
const FOOTER_LINE_Y = PAGE.height - 48;

const COLORS = {
  ink: "#1f2937",
  heading: "#111827",
  muted: "#6b7280",
  faint: "#9ca3af",
  hairline: "#e5e7eb",
  rule: "#d1d5db",
  accent: "#2563eb",
  tableHead: "#f3f4f6",
  code: "#334155",
};

const TYPE = {
  eyebrow: 8,
  title: 21,
  meta: 8.5,
  h1: 15,
  h2: 12.5,
  h3: 11,
  body: 10.5,
  table: 9.5,
  caption: 9,
  small: 9,
  tiny: 8,
};

const BODY_LINE_GAP = 3.6;
const SPACING = { h1Before: 24, h1After: 10, h2Before: 18, h2After: 7, h3Before: 14, h3After: 6 };
const TABLE_ROW_H = 21;
const TABLE_CELL_PAD = 6;

function resetCursor(doc: PdfDoc): void {
  doc.y = MARGIN.top;
}

function ensureSpace(doc: PdfDoc, needed: number): void {
  if (doc.y + needed > CONTENT_BOTTOM) {
    doc.addPage();
    resetCursor(doc);
  }
}

/** Count pages straight from the produced bytes (used for the document row). */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  const match =
    text.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/) ?? text.match(/\/Count\s+(\d+)/);
  const count = match ? Number(match[1]) : 1;
  return Number.isFinite(count) && count > 0 ? count : 1;
}

function readableDate(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type InlineRun = { text: string; bold: boolean; italic?: boolean; code?: boolean; link?: string };

/** Split a markdown line into bold / italic / code / link runs (no external parser). */
export function parseInlineMarkdown(line: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: line.slice(lastIndex, match.index), bold: false });
    }
    const token = match[0];
    if (token.startsWith("**")) {
      runs.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith("*")) {
      runs.push({ text: token.slice(1, -1), bold: false, italic: true });
    } else if (token.startsWith("`")) {
      runs.push({ text: token.slice(1, -1), bold: false, code: true });
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        runs.push({ text: linkMatch[1]!, bold: false, link: linkMatch[2]! });
      }
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < line.length) {
    runs.push({ text: line.slice(lastIndex), bold: false });
  }
  return runs;
}

type InlineOptions = {
  x?: number;
  y?: number;
  width?: number;
  lineGap?: number;
  align?: string;
};

/**
 * Render one line of inline markdown as styled runs. pdfkit's `text()` ignores
 * `options.x/y`, so the first run is always anchored with positional
 * arguments; later runs continue on the same line via `continued: true`.
 */
function renderInline(
  doc: PdfDoc,
  line: string,
  size: number,
  color: string,
  options: InlineOptions = {},
): void {
  const runs = parseInlineMarkdown(line);
  if (runs.length === 0) return;
  const startX = options.x ?? MARGIN.left;
  const width = options.width ?? CONTENT_W;
  doc.fillColor(color);
  runs.forEach((run, index) => {
    const isLast = index === runs.length - 1;
    const opts: Record<string, unknown> = { width, continued: !isLast };
    if (options.lineGap !== undefined) opts.lineGap = options.lineGap;
    if (options.align !== undefined) opts.align = options.align;
    if (run.code) {
      doc.font("Courier").fontSize(size - 0.5).fillColor(COLORS.code);
    } else if (run.italic) {
      doc.font("Helvetica-Oblique").fontSize(size).fillColor(color);
    } else {
      doc.font(run.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
    }
    if (run.link) {
      opts.link = run.link;
      opts.underline = true;
      doc.fillColor(COLORS.accent);
    }
    if (index === 0) {
      doc.text(run.text, startX, options.y ?? doc.y, opts);
    } else {
      doc.text(run.text, opts);
    }
  });
  doc.fillColor(color);
}

/** Report header block: eyebrow, title, meta line, and an accent rule. */
function renderReportHeader(doc: PdfDoc, title: string): void {
  doc.font("Helvetica-Bold").fontSize(TYPE.eyebrow).fillColor(COLORS.accent);
  doc.text("REPORT", MARGIN.left, doc.y, {
    width: CONTENT_W,
    characterSpacing: 1.6,
    lineBreak: false,
  });
  doc.y += TYPE.eyebrow + 8;
  doc.font("Helvetica-Bold").fontSize(TYPE.title).fillColor(COLORS.heading);
  doc.text(title, MARGIN.left, doc.y, { width: CONTENT_W, lineGap: 2 });
  doc.y += 6;
  doc.font("Helvetica").fontSize(TYPE.meta).fillColor(COLORS.muted);
  doc.text(`Generated by Anreal · ${readableDate()}`, MARGIN.left, doc.y, {
    width: CONTENT_W,
    lineBreak: false,
  });
  doc.y += TYPE.meta + 12;
  doc.rect(MARGIN.left, doc.y, 64, 2.5).fill(COLORS.accent);
  doc.y += 22;
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "figure"; alt: string; target: string }
  | { kind: "rule" };

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const body = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return body.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/** Inline image refs become figure blocks; keep only the alt text elsewhere. */
function stripInlineImages(text: string): string {
  return text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1").trim();
}

/** Parse the report markdown into renderable blocks. */
function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: stripInlineImages(paragraph.join(" ")) });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const figure = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
    if (figure) {
      flushParagraph();
      blocks.push({ kind: "figure", alt: figure[1]!.trim(), target: figure[2]!.trim() });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: stripInlineImages(heading[2]!.trim()),
      });
      continue;
    }
    if (line.startsWith("|")) {
      flushParagraph();
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = splitTableRow(lines[i]!);
        if (!isSeparatorRow(cells)) rows.push(cells);
        i += 1;
      }
      i -= 1;
      if (rows.length > 0) blocks.push({ kind: "table", rows });
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!.trim())) {
        items.push(stripInlineImages(lines[i]!.trim().replace(/^[-*+]\s+/, "")));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "bullets", items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i]!.trim())) {
        items.push(stripInlineImages(lines[i]!.trim().replace(/^\d+[.)]\s+/, "")));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "numbers", items });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function renderHeading(doc: PdfDoc, block: Extract<Block, { kind: "heading" }>): void {
  const size = block.level === 1 ? TYPE.h1 : block.level === 2 ? TYPE.h2 : TYPE.h3;
  const before = block.level === 1 ? SPACING.h1Before : block.level === 2 ? SPACING.h2Before : SPACING.h3Before;
  const after = block.level === 1 ? SPACING.h1After : block.level === 2 ? SPACING.h2After : SPACING.h3After;
  // Keep the heading with the first lines of the section it introduces.
  ensureSpace(doc, before + size + after + 36);
  if (doc.y > MARGIN.top + 4) doc.y += before;
  renderInline(doc, block.text, size, COLORS.heading, { lineGap: 1 });
  doc.y += after;
  if (block.level === 1) {
    doc.strokeColor(COLORS.hairline).lineWidth(0.75);
    doc.moveTo(MARGIN.left, doc.y - 4).lineTo(PAGE.width - MARGIN.right, doc.y - 4).stroke();
    doc.y += 3;
  }
}

function renderParagraph(doc: PdfDoc, text: string): void {
  ensureSpace(doc, TYPE.body * 2 + 12);
  renderInline(doc, text, TYPE.body, COLORS.ink, {
    width: CONTENT_W,
    lineGap: BODY_LINE_GAP,
  });
  doc.y += 8;
}

function renderListItems(doc: PdfDoc, items: string[], numbered: boolean): void {
  const textX = MARGIN.left + 16;
  items.forEach((item, index) => {
    ensureSpace(doc, TYPE.body + BODY_LINE_GAP + 8);
    const lineY = doc.y;
    const marker = numbered ? `${index + 1}.` : "•";
    doc.font(numbered ? "Helvetica" : "Helvetica-Bold").fontSize(TYPE.body).fillColor(COLORS.accent);
    doc.text(marker, MARGIN.left, lineY, { width: 14, lineBreak: false });
    renderInline(doc, item, TYPE.body, COLORS.ink, {
      x: textX,
      y: lineY,
      width: CONTENT_W - 16,
      lineGap: BODY_LINE_GAP - 0.4,
    });
    doc.y += 3.5;
  });
  doc.y += 5.5;
}

function isNumericCell(value: string): boolean {
  return /^[$€£]?\s?-?[\d.,]+\s?%?$/.test(value.trim()) && /\d/.test(value);
}

/** Editorial table: measured columns, shaded header, hairlines, alignment. */
function renderTable(doc: PdfDoc, rows: string[][]): void {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  doc.font("Helvetica").fontSize(TYPE.table);
  const widths: number[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    let widest = 0;
    for (const row of rows) {
      widest = Math.max(widest, doc.widthOfString((row[c] ?? "").trim()));
    }
    widths.push(Math.min(220, Math.max(52, widest + TABLE_CELL_PAD * 2)));
  }
  const totalW = widths.reduce((a, b) => a + b, 0);
  const scale = CONTENT_W / totalW;
  const colWidths = widths.map((w) => w * scale);

  const numericColumn: boolean[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    const cells = rows.slice(1).map((row) => (row[c] ?? "").trim()).filter(Boolean);
    numericColumn.push(cells.length > 0 && cells.filter(isNumericCell).length / cells.length >= 0.6);
  }

  const drawRow = (cells: string[], options: { header: boolean }): void => {
    const y = doc.y;
    if (options.header) {
      doc.rect(MARGIN.left, y, CONTENT_W, TABLE_ROW_H).fill(COLORS.tableHead);
    }
    let x = MARGIN.left;
    for (let c = 0; c < columnCount; c += 1) {
      const text = (cells[c] ?? "").trim();
      const align = !options.header && numericColumn[c] ? "right" : "left";
      if (text) {
        doc
          .font(options.header ? "Helvetica-Bold" : "Helvetica")
          .fontSize(TYPE.table)
          .fillColor(options.header ? COLORS.heading : COLORS.ink);
        doc.text(text, x + TABLE_CELL_PAD, y + 6, {
          width: colWidths[c]! - TABLE_CELL_PAD * 2,
          height: TABLE_ROW_H - 8,
          ellipsis: true,
          lineBreak: false,
          align,
        });
      }
      x += colWidths[c]!;
    }
    doc.strokeColor(COLORS.hairline).lineWidth(0.5);
    doc.moveTo(MARGIN.left, y + TABLE_ROW_H).lineTo(PAGE.width - MARGIN.right, y + TABLE_ROW_H).stroke();
    doc.y = y + TABLE_ROW_H;
  };

  rows.forEach((cells, index) => {
    // Keep the header together with at least one data row so a page break
    // never strands the header alone at the bottom of a page.
    const needed = index === 0 && rows.length > 1 ? TABLE_ROW_H * 2 : TABLE_ROW_H;
    if (doc.y + needed > CONTENT_BOTTOM) {
      doc.addPage();
      resetCursor(doc);
      drawRow(rows[0] ?? [], { header: true }); // repeat the header on every page
    }
    drawRow(cells, { header: index === 0 });
  });
  doc.y += 12;
}

type FigureEntry =
  | { id: string | null; kind: "svg"; svg: string; caption?: string }
  | { id: string | null; kind: "raster"; asset: ReportRasterAsset; caption?: string };

/** Figures: chart image with a numbered caption, kept together on one page. */
function drawFigure(doc: PdfDoc, entry: FigureEntry, number: number, captionOverride?: string): void {
  const caption = (captionOverride ?? entry.caption ?? "").trim();
  const label = caption ? `Figure ${number} — ${caption}` : `Figure ${number}`;
  if (entry.kind === "svg") {
    ensureSpace(doc, FIGURE_H + 40);
    const top = doc.y;
    SVGtoPDF(doc, entry.svg, MARGIN.left, top, { width: CONTENT_W });
    doc.y = top + FIGURE_H + 6;
  } else {
    let height = 300;
    try {
      const opened = doc.openImage(Buffer.from(entry.asset.buffer));
      height = Math.min(300, (CONTENT_W * opened.height) / Math.max(1, opened.width));
    } catch {
      // Unknown dimensions fall back to the fixed height below.
    }
    ensureSpace(doc, height + 40);
    const top = doc.y;
    try {
      doc.image(Buffer.from(entry.asset.buffer), MARGIN.left, top, { fit: [CONTENT_W, height] });
    } catch {
      return; // A corrupt asset must not sink the whole report.
    }
    doc.y = top + height + 6;
  }
  doc.font("Helvetica-Oblique").fontSize(TYPE.caption).fillColor(COLORS.muted);
  doc.text(label, MARGIN.left, doc.y, {
    width: CONTENT_W,
    align: "center",
    lineBreak: false,
    ellipsis: true,
  });
  doc.y += TYPE.caption + 16;
}

function renderRule(doc: PdfDoc): void {
  ensureSpace(doc, 20);
  doc.strokeColor(COLORS.hairline).lineWidth(0.75);
  doc.moveTo(MARGIN.left, doc.y + 6).lineTo(PAGE.width - MARGIN.right, doc.y + 6).stroke();
  doc.y += 18;
}

function renderSources(doc: PdfDoc, citations: ReportCitation[]): void {
  renderHeading(doc, { kind: "heading", level: 2, text: "Sources" });
  citations.forEach((cite, index) => {
    ensureSpace(doc, TYPE.small + 10);
    const y = doc.y;
    const ref = cite.documentId
      ? `${cite.documentId}${cite.pageIndex !== undefined ? ` p.${cite.pageIndex + 1}` : ""}`
      : (cite.webBundleId ?? cite.url ?? "web");
    doc.font("Helvetica").fontSize(TYPE.small).fillColor(COLORS.faint);
    doc.text(`${index + 1}.`, MARGIN.left, y, { width: 16, lineBreak: false });
    doc.fillColor(COLORS.muted);
    doc.text(`${cite.claim} — ${ref}`, MARGIN.left + 16, y, {
      width: CONTENT_W - 16,
      lineGap: 1.5,
    });
    doc.y += 3;
  });
}

/** Hairline footer with the running title and page number on every page. */
function stampFooters(doc: PdfDoc, title: string): void {
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    // Drawing inside the bottom margin would otherwise trigger pdfkit's
    // overflow pagination and append blank pages, so lift the margin first.
    const margins = (doc.page as { margins?: { bottom: number } }).margins;
    const savedBottom = margins?.bottom ?? 0;
    if (margins) margins.bottom = 0;
    doc.strokeColor(COLORS.hairline).lineWidth(0.75);
    doc.moveTo(MARGIN.left, FOOTER_LINE_Y).lineTo(PAGE.width - MARGIN.right, FOOTER_LINE_Y).stroke();
    doc.font("Helvetica").fontSize(TYPE.tiny).fillColor(COLORS.faint);
    doc.text(title, MARGIN.left, FOOTER_LINE_Y + 7, {
      width: CONTENT_W - 90,
      lineBreak: false,
      ellipsis: true,
    });
    doc.text(`Page ${page - range.start + 1} of ${range.count}`, PAGE.width - MARGIN.right - 90, FOOTER_LINE_Y + 7, {
      width: 90,
      align: "right",
      lineBreak: false,
    });
    if (margins) margins.bottom = savedBottom;
  }
}

export async function buildReportPdf(input: {
  title: string;
  markdown: string;
  svgAssets?: string[];
  /** Asset ids for svgAssets, same order; lets inline ![alt](id) refs place them. */
  svgAssetIds?: string[];
  /** Captions for svgAssets, same order; rendered as “Figure N — caption”. */
  svgCaptions?: string[];
  rasterAssets?: ReportRasterAsset[];
  rasterAssetIds?: string[];
  rasterCaptions?: string[];
  citationMap?: ReportCitation[];
}): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN.top, bottom: MARGIN.bottom, left: MARGIN.left, right: MARGIN.right },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve());
    doc.on("error", (e) => reject(e as Error));
  });

  renderReportHeader(doc, input.title);

  const svgCaptions = input.svgCaptions ?? [];
  const rasterCaptions = input.rasterCaptions ?? [];
  const entries: FigureEntry[] = [];
  (input.svgAssets ?? []).forEach((svg, index) => {
    entries.push({
      id: input.svgAssetIds?.[index] ?? null,
      kind: "svg",
      svg,
      caption: svgCaptions[index],
    });
  });
  (input.rasterAssets ?? []).forEach((asset, index) => {
    entries.push({
      id: input.rasterAssetIds?.[index] ?? null,
      kind: "raster",
      asset,
      caption: rasterCaptions[index],
    });
  });
  const byId = new Map<string, FigureEntry>();
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
  }
  const consumed = new Set<FigureEntry>();
  let figureNumber = 0;
  const drawNext = (entry: FigureEntry, captionOverride?: string) => {
    consumed.add(entry);
    figureNumber += 1;
    drawFigure(doc, entry, figureNumber, captionOverride);
  };

  const blocks = parseBlocks(input.markdown);
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        renderHeading(doc, block);
        break;
      case "paragraph":
        renderParagraph(doc, block.text);
        break;
      case "bullets":
        renderListItems(doc, block.items, false);
        break;
      case "numbers":
        renderListItems(doc, block.items, true);
        break;
      case "table":
        renderTable(doc, block.rows);
        break;
      case "figure": {
        const entry = byId.get(block.target);
        if (entry && !consumed.has(entry)) drawNext(entry, block.alt);
        break;
      }
      case "rule":
        renderRule(doc);
        break;
    }
  }

  // Assets the markdown never referenced still belong in the report.
  for (const entry of entries) {
    if (!consumed.has(entry)) drawNext(entry);
  }

  if (input.citationMap?.length) {
    renderSources(doc, input.citationMap);
  }

  stampFooters(doc, input.title);
  doc.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
