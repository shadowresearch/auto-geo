import { describe, expect, it } from "vitest";
import {
  bold,
  bulletList,
  detectNarrow,
  dim,
  divider,
  effectiveWidth,
  footer,
  glyphs,
  green,
  header,
  indent,
  kv,
  padVisual,
  paint,
  red,
  rows,
  statusMark,
  stripAnsi,
  type Row,
  type UiOptions,
} from "../cli/ui";

/**
 * Test strategy: structural assertions only — we don't snapshot the
 * exact byte stream because that's brittle to design tweaks (different
 * padding, divider width, etc). Each test asserts the property that
 * matters for the design contract: alignment, ANSI presence/absence,
 * ASCII fallback, etc.
 */

const RICH: UiOptions = { colors: true, narrow: false };
const PLAIN: UiOptions = { colors: false, narrow: false };

// ── paint / color wrappers ─────────────────────────────────────────

describe("paint + color wrappers", () => {
  it("emits ANSI when on=true and passes through when on=false", () => {
    expect(paint("hi", "green", true)).toContain("\x1b[");
    expect(paint("hi", "green", false)).toBe("hi");
  });

  it("color helpers compose paint with the right codes", () => {
    expect(green("ok", true)).toContain("\x1b[32m");
    expect(red("bad", true)).toContain("\x1b[31m");
    expect(bold("h", true)).toContain("\x1b[1m");
    expect(dim("d", true)).toContain("\x1b[2m");
  });

  it("all wrappers return the bare string when colors disabled", () => {
    expect(green("ok", false)).toBe("ok");
    expect(red("bad", false)).toBe("bad");
    expect(bold("h", false)).toBe("h");
    expect(dim("d", false)).toBe("d");
  });
});

// ── glyphs ─────────────────────────────────────────────────────────

describe("glyphs", () => {
  it("returns unicode marks in rich mode", () => {
    const g = glyphs(true);
    expect(g.ok).toBe("\u2713");
    expect(g.fail).toBe("\u2717");
    expect(g.diamond).toBe("\u25c6");
    expect(g.arrow).toBe("\u25b8");
    expect(g.hr).toBe("\u2500");
    expect(g.statusWidth).toBe(1);
  });

  it("falls back to ASCII in plain mode", () => {
    const g = glyphs(false);
    expect(g.ok).toBe("[OK]");
    expect(g.fail).toBe("[FAIL]");
    expect(g.warn).toBe("[WARN]");
    expect(g.diamond).toBe("*");
    expect(g.arrow).toBe(">");
    expect(g.hr).toBe("-");
    expect(g.statusWidth).toBe(6);
  });
});

// ── stripAnsi + padVisual ─────────────────────────────────────────

describe("stripAnsi + padVisual", () => {
  it("strips ANSI sequences", () => {
    const s = "\x1b[32m✓\x1b[0m";
    expect(stripAnsi(s)).toBe("✓");
  });

  it("padVisual pads to visual width ignoring ANSI codes", () => {
    const colored = green("✓", true);
    // Visual width is 1; pad to 4 → expect 3 trailing spaces after the
    // visible glyph, regardless of how many ANSI bytes precede it.
    const padded = padVisual(colored, 4, true);
    expect(stripAnsi(padded)).toBe("✓   ");
  });

  it("returns input unchanged when already wide enough", () => {
    expect(padVisual("hello", 3, false)).toBe("hello");
  });
});

// ── indent + effectiveWidth + detectNarrow ────────────────────────

describe("layout helpers", () => {
  it("indent is 2 spaces normally, 1 in narrow mode", () => {
    expect(indent(RICH)).toBe("  ");
    expect(indent({ colors: true, narrow: true })).toBe(" ");
  });

  it("effectiveWidth caps at 80 in standard mode", () => {
    expect(effectiveWidth({ colors: true, width: 200 })).toBe(80);
    expect(effectiveWidth({ colors: true, width: 50 })).toBe(50);
  });

  it("effectiveWidth caps at 60 in narrow mode", () => {
    expect(effectiveWidth({ colors: true, narrow: true, width: 200 })).toBe(60);
  });

  it("detectNarrow respects the explicit flag", () => {
    expect(detectNarrow(120, true)).toBe(true);
    expect(detectNarrow(40, false)).toBe(false);
  });

  it("detectNarrow auto-detects from terminal columns", () => {
    expect(detectNarrow(60, undefined)).toBe(true);
    expect(detectNarrow(120, undefined)).toBe(false);
    expect(detectNarrow(undefined, undefined)).toBe(false);
  });
});

// ── header ────────────────────────────────────────────────────────

describe("header", () => {
  it("includes the name and tagline in rich mode", () => {
    const h = header("auto-geo doctor", "GEO audit", RICH);
    expect(h).toContain("auto-geo doctor");
    expect(h).toContain("GEO audit");
    expect(h).toContain("\u25c6"); // diamond glyph
  });

  it("uses an ASCII separator in plain mode (no diamond, no box-drawing)", () => {
    const h = header("auto-geo doctor", "GEO audit", PLAIN);
    expect(h).toContain("auto-geo doctor");
    expect(h).toContain("--");
    expect(h).not.toContain("\u25c6");
    expect(h).not.toContain("\x1b[");
  });
});

// ── divider ───────────────────────────────────────────────────────

describe("divider", () => {
  it("uses ─ in rich mode and - in plain mode", () => {
    expect(divider({ colors: true, width: 80 })).toContain("\u2500");
    expect(divider({ colors: false, width: 80 })).toContain("-");
    expect(divider({ colors: false, width: 80 })).not.toContain("\u2500");
  });
});

// ── kv ────────────────────────────────────────────────────────────

describe("kv", () => {
  it("renders label + colon + padding + value", () => {
    const line = kv("domain", "shadow.inc", { ...PLAIN, valueCol: 11 });
    expect(line).toContain("domain:");
    expect(line).toContain("shadow.inc");
    // Value column at 11 → "domain:" (7 chars) + 4 spaces = "domain:    ".
    expect(line).toContain("domain:    shadow.inc");
  });

  it("two rows with the same valueCol align their values", () => {
    const a = kv("domain", "x", { ...PLAIN, valueCol: 11 });
    const b = kv("queries", "2", { ...PLAIN, valueCol: 11 });
    const valueA = a.indexOf("x");
    const valueB = b.indexOf("2");
    expect(valueA).toBe(valueB);
  });
});

// ── rows ──────────────────────────────────────────────────────────

describe("rows", () => {
  const items: Row[] = [
    { status: "ok", name: "TL;DR present", detail: "found, 50 words" },
    { status: "fail", name: "Image cadence", detail: "0 images (target ~4)" },
    { status: "warn", name: "Schema warning", detail: "soft" },
  ];

  it("emits one line per item", () => {
    expect(rows(items, PLAIN)).toHaveLength(3);
  });

  it("aligns names to the same column", () => {
    const out = rows(items, PLAIN);
    // Find where each detail starts. In plain mode, marks are wider
    // ([OK]/[FAIL]/[WARN]) so we compare positions of the first
    // detail-token instead of relying on visual offset.
    const detailIndices = out.map((line) =>
      line.indexOf("found") >= 0
        ? line.indexOf("found")
        : line.indexOf("0 images") >= 0
          ? line.indexOf("0 images")
          : line.indexOf("soft")
    );
    // After the mark column is normalized + name column padded, all
    // detail starts are equal.
    const first = detailIndices[0]!;
    for (const idx of detailIndices) expect(idx).toBe(first);
  });

  it("includes ASCII status marks in plain mode", () => {
    const out = rows(items, PLAIN).join("\n");
    expect(out).toContain("[OK]");
    expect(out).toContain("[FAIL]");
    expect(out).toContain("[WARN]");
    expect(out).not.toContain("\x1b[");
  });

  it("includes unicode marks + ANSI in rich mode", () => {
    const out = rows(items, RICH).join("\n");
    expect(out).toContain("\u2713");
    expect(out).toContain("\u2717");
    expect(out).toContain("\x1b[");
  });

  it("returns [] for empty input", () => {
    expect(rows([], PLAIN)).toEqual([]);
  });
});

// ── statusMark ────────────────────────────────────────────────────

describe("statusMark", () => {
  it("returns the colored glyph in rich mode", () => {
    expect(statusMark("ok", true)).toContain("\u2713");
    expect(statusMark("fail", true)).toContain("\u2717");
  });

  it("returns the ASCII variant in plain mode", () => {
    expect(statusMark("ok", false)).toBe("[OK]");
    expect(statusMark("fail", false)).toBe("[FAIL]");
    expect(statusMark("warn", false)).toBe("[WARN]");
  });
});

// ── bulletList ────────────────────────────────────────────────────

describe("bulletList", () => {
  it("numbers items starting at 1", () => {
    const out = bulletList(["alpha", "beta"], PLAIN);
    expect(out[0]).toContain("1. alpha");
    expect(out[1]).toContain("2. beta");
  });

  it("returns [] for empty input", () => {
    expect(bulletList([], PLAIN)).toEqual([]);
  });
});

// ── footer ────────────────────────────────────────────────────────

describe("footer", () => {
  it("emits a divider followed by the dim lines", () => {
    const out = footer(["a", "b"], PLAIN);
    // First line is the blank separator, second is the divider.
    expect(out[0]).toBe("");
    expect(out[1]).toMatch(/^[\s-]+$/);
    expect(out.length).toBeGreaterThan(3);
  });

  it("does not emit ANSI when colors disabled", () => {
    const out = footer(["x"], PLAIN).join("\n");
    expect(out).not.toContain("\x1b[");
  });

  it("emits ANSI for the dim metadata lines in rich mode", () => {
    const out = footer(["x"], RICH).join("\n");
    expect(out).toContain("\x1b[2m");
  });
});
