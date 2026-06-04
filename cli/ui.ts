/**
 * Shared CLI presentation primitives — colors, glyphs, layout helpers.
 *
 * Every human-facing renderer (`cli/render.ts`, `cli/fix.ts`,
 * `cli/write.ts`) builds its output from these primitives so the four
 * subcommands share a single visual language: aligned status rows,
 * branded headers, dim footers, ASCII fallbacks for non-TTY / --no-color.
 *
 * Design intent:
 *   - Two-space body indent everywhere. Breathing room without giving
 *     up vertical real estate.
 *   - Status mark → name → detail rows align in a column. Compute the
 *     max name width once and pad — this is the single biggest
 *     readability win versus the v0.2.x flat output.
 *   - Color is a signal, not decoration. Only ✓ ✗ ! carry color.
 *     Body text default, detail text dim, divider/footer dim.
 *   - When `colors: false` we also drop the box-drawing glyphs to ASCII
 *     so piping to file / CI logs stays clean. Conceptually `colors`
 *     == "rich terminal" here.
 *
 * Bundle posture: zero new runtime deps. Hand-rolled ANSI like the
 * rest of the CLI.
 */

// ── ANSI ───────────────────────────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

export type AnsiCode = keyof typeof ANSI;

/**
 * Wrap `s` in the named ANSI sequence when `on` is true. When `on` is
 * false the string passes through unchanged — the single place
 * --no-color and non-TTY gate the entire CLI's color output.
 */
export function paint(s: string, code: AnsiCode, on: boolean): string {
  return on ? `${ANSI[code]}${s}${ANSI.reset}` : s;
}

// Convenience wrappers — every call site uses them so the choice of
// "dim" vs "gray" stays consistent and is one edit away.
export const bold = (s: string, on: boolean) => paint(s, "bold", on);
export const dim = (s: string, on: boolean) => paint(s, "dim", on);
export const muted = (s: string, on: boolean) => paint(s, "gray", on);
export const green = (s: string, on: boolean) => paint(s, "green", on);
export const red = (s: string, on: boolean) => paint(s, "red", on);
export const yellow = (s: string, on: boolean) => paint(s, "yellow", on);
export const cyan = (s: string, on: boolean) => paint(s, "cyan", on);

// ── Glyphs ─────────────────────────────────────────────────────────

/**
 * Visual glyph set. When colors are enabled we assume a modern terminal
 * that can render box-drawing + unicode marks. When disabled we fall
 * back to ASCII so CI logs / piped output stay grep-able.
 *
 * Status marks (`ok`, `fail`, `warn`) widen in ASCII mode (`[OK]`,
 * `[FAIL]`, `[WARN]`) — the renderer pads around the rendered glyph,
 * not the codepoint, so column alignment still works.
 */
export type Glyphs = {
  ok: string;
  fail: string;
  warn: string;
  diamond: string;
  arrow: string;
  hr: string;
  vbar: string;
  bullet: string;
  /** Visual width of the status mark column (max of ok/fail/warn). */
  statusWidth: number;
};

export function glyphs(on: boolean): Glyphs {
  if (on) {
    return {
      ok: "\u2713", // ✓
      fail: "\u2717", // ✗
      warn: "!",
      diamond: "\u25c6", // ◆
      arrow: "\u25b8", // ▸
      hr: "\u2500", // ─
      vbar: "\u2502", // │
      bullet: "\u00b7", // ·
      statusWidth: 1,
    };
  }
  return {
    ok: "[OK]",
    fail: "[FAIL]",
    warn: "[WARN]",
    diamond: "*",
    arrow: ">",
    hr: "-",
    vbar: "|",
    bullet: "-",
    statusWidth: 6, // widest of [OK]/[FAIL]/[WARN]
  };
}

// ── Layout ─────────────────────────────────────────────────────────

/**
 * Layout options carried by every helper. `colors` is the rich-terminal
 * gate (ANSI + box-drawing). `narrow` tightens indent + divider width
 * for sub-80-col terminals.
 */
export type UiOptions = {
  colors: boolean;
  narrow?: boolean;
  /** Override terminal width (tests / explicit --narrow). */
  width?: number;
};

/** Effective body indent. Narrow terminals lose the breathing room. */
export function indent(opts: UiOptions): string {
  return opts.narrow ? " " : "  ";
}

/**
 * Effective divider / wrap width. Caps at 80 by default so the design
 * stays visually consistent across wide terminals; `--narrow` or a
 * sub-80 column terminal tightens it.
 */
export function effectiveWidth(opts: UiOptions): number {
  const w = opts.width ?? 80;
  if (opts.narrow) return Math.min(w, 60);
  return Math.min(w, 80);
}

/**
 * Auto-detect narrow mode from `process.stdout.columns` when the caller
 * didn't pass `narrow` explicitly. Pulled out so tests can stub it.
 */
export function detectNarrow(
  cols: number | undefined,
  explicit: boolean | undefined
): boolean {
  if (explicit !== undefined) return explicit;
  if (cols === undefined) return false;
  return cols < 80;
}

// ── Header ─────────────────────────────────────────────────────────

/**
 * Branded header line.
 *
 *   `◆ auto-geo doctor  ╶╴  GEO citation readiness audit`
 *
 * In plain mode the diamond and the ╶╴ separator drop to ASCII so the
 * line is still skimmable. A blank line is appended so callers can
 * concatenate headers without thinking about trailing whitespace.
 */
export function header(name: string, tagline: string, opts: UiOptions): string {
  const g = glyphs(opts.colors);
  const id = opts.narrow ? " " : "  ";
  if (opts.colors) {
    const left = `${id}${g.diamond} ${bold(name, true)}`;
    const sep = `${dim("\u2576\u2574", true)}`; // ╶╴
    return `${left}  ${sep}  ${dim(tagline, true)}`;
  }
  return `${id}${name} -- ${tagline}`;
}

// ── Divider ────────────────────────────────────────────────────────

/**
 * Horizontal divider. Rendered as `─` × width in rich mode, `-` × width
 * in plain. Width auto-clamps to `effectiveWidth(opts)`.
 */
export function divider(opts: UiOptions): string {
  const g = glyphs(opts.colors);
  const w = effectiveWidth(opts);
  const id = indent(opts);
  const line = g.hr.repeat(Math.max(20, w - id.length));
  return opts.colors ? dim(`${id}${line}`, true) : `${id}${line}`;
}

// ── Key/value ──────────────────────────────────────────────────────

/**
 * `kv("domain", "shadow.inc", { valueCol: 11, colors })`
 *   →  `  domain:    shadow.inc`
 *
 * `valueCol` is the visual column (after the indent) where the value
 * text starts. `"label:".padEnd(valueCol)` left-aligns the label inside
 * that column, so a stack of `kv` rows with the same `valueCol` form an
 * aligned key/value table.
 */
export function kv(
  label: string,
  value: string,
  opts: UiOptions & { valueCol?: number; valueColor?: AnsiCode }
): string {
  const id = indent(opts);
  // Default value column accommodates the label + colon + 1 space.
  const col = opts.valueCol ?? label.length + 2;
  const lab = `${label}:`.padEnd(col, " ");
  const v = opts.valueColor
    ? paint(value, opts.valueColor, opts.colors)
    : value;
  return `${id}${lab}${v}`;
}

// ── Aligned status rows (the centerpiece) ──────────────────────────

export type RowStatus = "ok" | "fail" | "warn" | "info";

export type Row = {
  status: RowStatus;
  name: string;
  detail?: string;
};

/**
 * Render a list of status rows with aligned columns. Computes the max
 * name width once and pads every name to that width so the detail
 * column lines up regardless of name length.
 *
 *   `  ✓  TL;DR present           Found TL;DR label, 59 words, in range`
 *   `  ✗  Image cadence           0 images (target ~4)`
 *
 * In plain mode the mark widens (`[OK]`/`[FAIL]`/`[WARN]`) but rows
 * still align because we pad with rendered visual width, not codepoints.
 */
export function rows(items: Row[], opts: UiOptions): string[] {
  if (items.length === 0) return [];
  const g = glyphs(opts.colors);
  const id = indent(opts);

  // Compute name-column width once (capped so a one-off long name
  // doesn't blow out the alignment for the rest).
  const maxName = items.reduce((m, r) => Math.max(m, r.name.length), 0);
  const nameCol = Math.min(maxName, 40);

  // Compute the status-mark column width based on the widest possible
  // glyph in this mode so rows are uniform.
  const markCol = g.statusWidth;

  return items.map((r) => {
    const mark = renderMark(r.status, g, opts.colors);
    const paddedMark = padVisual(mark, markCol, opts.colors);
    const paddedName = r.name.padEnd(nameCol, " ");
    const detail = r.detail ? `  ${dim(r.detail, opts.colors)}` : "";
    return `${id}${paddedMark}  ${paddedName}${detail}`;
  });
}

function renderMark(status: RowStatus, g: Glyphs, colors: boolean): string {
  switch (status) {
    case "ok":
      return paint(g.ok, "green", colors);
    case "fail":
      return paint(g.fail, "red", colors);
    case "warn":
      return paint(g.warn, "yellow", colors);
    case "info":
      return dim(g.bullet, colors);
  }
}

/**
 * Render a single status mark inline (no row indent / no padding).
 * Used by renderers that compose their own per-line layout but still
 * want the canonical colored ✓ / ✗ / ! glyph.
 */
export function statusMark(status: RowStatus, colors: boolean): string {
  return renderMark(status, glyphs(colors), colors);
}

// ── Numbered bullet list ───────────────────────────────────────────

/**
 *   `   1. Add 4 images with descriptive alt text.`
 *
 * Used for the "Top fixes" block and the "Next steps" block. Numbering
 * starts at 1; multi-line items aren't supported (each entry is rendered
 * as one row).
 */
export function bulletList(items: string[], opts: UiOptions): string[] {
  const id = indent(opts);
  return items.map((item, i) => `${id}  ${i + 1}. ${item}`);
}

// ── Footer ─────────────────────────────────────────────────────────

/**
 * Footer block: a horizontal divider followed by dim metadata lines.
 * Intent is the "small wordmark" Vercel-style sign-off.
 *
 *   ────────────────────────────────────────
 *     auto-geo doctor · github.com/… · v0.2.3
 *     Audit another page: npx auto-geo doctor <url>
 *     Learn more: shadow.inc/resources/what-is-geo
 */
export function footer(lines: string[], opts: UiOptions): string[] {
  const id = indent(opts);
  const out: string[] = [];
  out.push("");
  out.push(divider(opts));
  for (const line of lines) {
    out.push(`${id}${dim(line, opts.colors)}`);
  }
  return out;
}

// ── Visual-width helpers ───────────────────────────────────────────

/**
 * Strip ANSI escape sequences so we can measure the *visual* width
 * of a possibly-colored string. Conservative — only matches the CSI
 * sequences this module emits.
 */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Pad a possibly-colored string to a visual width. Pads with spaces
 * on the right. Used so the status-mark column stays uniform even when
 * the mark itself is colored (`\x1b[32m✓\x1b[0m` is visually 1 char).
 */
export function padVisual(s: string, width: number, _colors: boolean): string {
  const visual = stripAnsi(s).length;
  if (visual >= width) return s;
  return s + " ".repeat(width - visual);
}
