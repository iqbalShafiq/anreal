export type HistogramBin = { min: number; max: number; count: number };

export type ChartSpecInput =
  | { kind: "bar"; labels: string[]; series: Array<{ name: string; values: number[] }>; title?: string }
  | { kind: "line"; labels: string[]; series: Array<{ name: string; values: number[] }>; title?: string }
  | { kind: "pie"; labels: string[]; values: number[]; name?: string; title?: string }
  | { kind: "scatter"; points: Array<{ x: number; y: number }>; xLabel?: string; yLabel?: string; title?: string }
  | { kind: "histogram"; bins: HistogramBin[]; label?: string; title?: string };

/** Loud validation for chart specs: finite numbers only, shapes intact. */
export function assertValidChartSpec(spec: unknown): asserts spec is ChartSpecInput {
  const fail = () => {
    throw new Error("Invalid chart spec");
  };
  if (typeof spec !== "object" || spec === null) fail();
  const s = spec as Record<string, unknown>;
  if (s.kind !== "bar" && s.kind !== "line" && s.kind !== "pie" && s.kind !== "scatter" && s.kind !== "histogram") {
    fail();
  }
  const finiteArray = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n));
  const strArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((n) => typeof n === "string");
  switch (s.kind) {
    case "bar":
    case "line": {
      const o = s as { labels?: unknown; series?: unknown };
      if (!strArray(o.labels)) fail();
      if (
        !Array.isArray(o.series) ||
        o.series.length < 1 ||
        !o.series.every(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as { name?: unknown }).name === "string" &&
            finiteArray((item as { values?: unknown }).values),
        )
      ) {
        fail();
      }
      return;
    }
    case "pie": {
      const o = s as { labels?: unknown; values?: unknown };
      if (!strArray(o.labels) || !finiteArray(o.values)) fail();
      return;
    }
    case "scatter": {
      const o = s as { points?: unknown };
      if (
        !Array.isArray(o.points) ||
        !o.points.every(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as { x?: unknown }).x === "number" &&
            Number.isFinite((p as { x: number }).x) &&
            typeof (p as { y?: unknown }).y === "number" &&
            Number.isFinite((p as { y: number }).y),
        )
      ) {
        fail();
      }
      return;
    }
    case "histogram": {
      const o = s as { bins?: unknown };
      if (
        !Array.isArray(o.bins) ||
        o.bins.length < 1 ||
        !o.bins.every((bin) => {
          if (typeof bin !== "object" || bin === null) return false;
          const b = bin as { min?: unknown; max?: unknown; count?: unknown };
          return (
            typeof b.min === "number" &&
            Number.isFinite(b.min) &&
            typeof b.max === "number" &&
            Number.isFinite(b.max) &&
            typeof b.count === "number" &&
            Number.isFinite(b.count) &&
            b.count >= 0
          );
        })
      ) {
        fail();
      }
      return;
    }
  }
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const W = 640;
const H = 360;
const PAD = 56;
const PLOT_TOP = 42;
const COLORS = ["#4f8cff", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#06b6d4", "#ec4899", "#84cc16"];

/** Compact axis numbers: 12k, 1.2k, 12, 0.5 … */
function fmt(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1_000) return `${(value / 1000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

/** Round up to a readable axis maximum (1/2/2.5/5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const unit = value / pow;
  const step = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return step * pow;
}

function yTicks(max: number, steps = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i += 1) out.push((max / steps) * i);
  return out;
}

function label(value: string, max = 13): string {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function titleText(title: string): string {
  if (!title) return "";
  return `<text x="${W / 2}" y="24" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#111827" text-anchor="middle">${esc(title)}</text>`;
}

/** Y gridlines + tick labels + axis lines inside the plot box. */
function axes(max: number, plotBottom: number): string {
  const plotW = W - PAD * 2;
  const plotH = plotBottom - PLOT_TOP;
  let body = "";
  for (const tick of yTicks(max)) {
    const y = plotBottom - (tick / max) * plotH;
    body += `<line x1="${PAD}" y1="${y.toFixed(1)}" x2="${(PAD + plotW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${tick === 0 ? "#d1d5db" : "#eef0f4"}"/>`;
    body += `<text x="${(PAD - 8).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="#6b7280" text-anchor="end">${esc(fmt(tick))}</text>`;
  }
  body += `<line x1="${PAD}" y1="${PLOT_TOP}" x2="${PAD}" y2="${plotBottom}" stroke="#d1d5db"/>`;
  return body;
}

function legend(items: Array<{ name: string; color: string }>): string {
  if (items.length === 0) return "";
  const widths = items.map((item) => item.name.length * 5.6 + 27);
  const total = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * 14;
  let x = Math.max(PAD, (W - total) / 2);
  let body = "";
  items.forEach((item, i) => {
    body += `<rect x="${x.toFixed(1)}" y="${H - 21}" width="10" height="10" rx="2" fill="${item.color}"/>`;
    body += `<text x="${(x + 15).toFixed(1)}" y="${H - 12}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#374151">${esc(item.name)}</text>`;
    x += (widths[i] ?? 0) + 14;
  });
  return body;
}

export function chartSpecToSvg(spec: ChartSpecInput): string {
  assertValidChartSpec(spec);
  const title = spec.kind === "pie"
    ? (spec.title ?? spec.name ?? "")
    : "title" in spec
      ? (spec.title ?? "")
      : "";
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    (title ? `<title>${esc(title)}</title>` : "");
  if (spec.kind === "pie") return head + pieBody(spec) + "</svg>";
  if (spec.kind === "scatter") return head + scatterBody(spec) + "</svg>";
  if (spec.kind === "histogram") return head + histogramBody(spec) + "</svg>";
  return head + seriesBody(spec) + "</svg>";
}

function seriesBody(spec: Extract<ChartSpecInput, { kind: "bar" | "line" }>): string {
  const all = spec.series.flatMap((s) => s.values);
  const max = niceMax(Math.max(1, ...all));
  const n = Math.max(1, spec.labels.length);
  const plotW = W - PAD * 2;
  // Leave room below the plot for category labels and a separate legend row.
  const plotBottom = H - 50;
  const plotH = plotBottom - PLOT_TOP;
  let body = titleText(spec.title ?? "") + axes(max, plotBottom);
  if (spec.kind === "bar") {
    const groupW = plotW / n;
    const barW = Math.max(4, (groupW * 0.68) / spec.series.length);
    spec.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const h = (v / max) * plotH;
        const x = PAD + i * groupW + groupW * 0.16 + si * barW;
        const y = plotBottom - h;
        body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${COLORS[si % COLORS.length]}" rx="2"><title>${esc(`${s.name} · ${spec.labels[i] ?? ""}: ${v}`)}</title></rect>`;
      });
    });
  } else {
    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => {
        const x = PAD + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const y = plotBottom - (v / max) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      body += `<polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS[si % COLORS.length]}" stroke-width="2"/>`;
      s.values.forEach((v, i) => {
        const x = PAD + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const y = plotBottom - (v / max) * plotH;
        body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${COLORS[si % COLORS.length]}"><title>${esc(`${s.name} · ${spec.labels[i] ?? ""}: ${v}`)}</title></circle>`;
      });
    });
  }
  spec.labels.forEach((item, i) => {
    const x = spec.kind === "bar"
      ? PAD + i * (plotW / n) + plotW / n / 2
      : PAD + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    body += `<text x="${x.toFixed(1)}" y="${(plotBottom + 15).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#6b7280" text-anchor="middle">${esc(label(item))}</text>`;
  });
  body += legend(spec.series.map((s, si) => ({ name: s.name, color: COLORS[si % COLORS.length] })));
  return body;
}

function pieBody(spec: Extract<ChartSpecInput, { kind: "pie" }>): string {
  const total = spec.values.reduce((a, b) => a + b, 0) || 1;
  const cx = 200;
  const bottom = H - 28;
  const cy = PLOT_TOP + (bottom - PLOT_TOP) / 2 + 4;
  const r = 104;
  let angle = -Math.PI / 2;
  let body = titleText(spec.title ?? spec.name ?? "");
  spec.values.forEach((v, i) => {
    const frac = v / total;
    const a2 = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    body += `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${COLORS[i % COLORS.length]}"><title>${esc(spec.labels[i] ?? "")}: ${v} (${(frac * 100).toFixed(1)}%)</title></path>`;
    angle = a2;
  });
  const legendX = 372;
  spec.labels.forEach((item, i) => {
    const y = PLOT_TOP + 12 + i * 24;
    if (y > H - 20) return;
    const pct = ((spec.values[i] ?? 0) / total) * 100;
    body += `<rect x="${legendX}" y="${y - 10}" width="11" height="11" rx="2" fill="${COLORS[i % COLORS.length]}"/>`;
    body += `<text x="${legendX + 17}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#374151">${esc(label(item, 22))} · ${pct.toFixed(1)}%</text>`;
  });
  return body;
}

function scatterBody(spec: Extract<ChartSpecInput, { kind: "scatter" }>): string {
  const xs = spec.points.map((p) => p.x);
  const ys = spec.points.map((p) => p.y);
  const maxX = niceMax(Math.max(1, ...xs));
  const maxY = niceMax(Math.max(1, ...ys));
  const plotW = W - PAD * 2;
  const plotBottom = H - 40;
  const plotH = plotBottom - PLOT_TOP;
  let body = titleText(spec.title ?? "") + axes(maxY, plotBottom);
  for (const tick of yTicks(maxX)) {
    const x = PAD + (tick / maxX) * plotW;
    body += `<text x="${x.toFixed(1)}" y="${(plotBottom + 15).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="#6b7280" text-anchor="middle">${esc(fmt(tick))}</text>`;
  }
  for (const p of spec.points.slice(0, 500)) {
    const x = PAD + (p.x / maxX) * plotW;
    const y = plotBottom - (p.y / maxY) * plotH;
    body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#4f8cff" opacity="0.85"><title>${esc(`${p.x}, ${p.y}`)}</title></circle>`;
  }
  if (spec.xLabel) {
    body += `<text x="${W / 2}" y="${H - 6}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#374151" text-anchor="middle">${esc(spec.xLabel)}</text>`;
  }
  if (spec.yLabel) {
    body += `<text x="16" y="${((PLOT_TOP + plotBottom) / 2).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#374151" text-anchor="middle" transform="rotate(-90 16 ${((PLOT_TOP + plotBottom) / 2).toFixed(1)})">${esc(spec.yLabel)}</text>`;
  }
  return body;
}

function histogramBody(spec: Extract<ChartSpecInput, { kind: "histogram" }>): string {
  const max = niceMax(Math.max(1, ...spec.bins.map((b) => b.count)));
  const plotW = W - PAD * 2;
  const plotBottom = H - 40;
  const plotH = plotBottom - PLOT_TOP;
  let body = titleText(spec.title ?? "") + axes(max, plotBottom);
  const bw = plotW / Math.max(1, spec.bins.length);
  spec.bins.forEach((bin, i) => {
    const h = (bin.count / max) * plotH;
    const x = PAD + i * bw + 1;
    const y = plotBottom - h;
    body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#4f8cff" rx="2"><title>${esc(`${bin.min}–${bin.max}: ${bin.count}`)}</title></rect>`;
    body += `<text x="${(x + bw / 2 - 1).toFixed(1)}" y="${(plotBottom + 15).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="#6b7280" text-anchor="middle">${esc(fmt(bin.min))}</text>`;
  });
  const last = spec.bins.at(-1);
  if (last) {
    body += `<text x="${(PAD + plotW).toFixed(1)}" y="${(plotBottom + 15).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="#6b7280" text-anchor="middle">${esc(fmt(last.max))}</text>`;
  }
  if (spec.label) {
    body += `<text x="${W / 2}" y="${H - 6}" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#374151" text-anchor="middle">${esc(spec.label)}</text>`;
  }
  return body;
}
