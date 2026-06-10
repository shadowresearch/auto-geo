import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMMAND_HELP,
  _resetVersionCacheForTests,
  getPackageVersion,
  renderCommandHelp,
  renderGlobalHelp,
  renderHelpPointer,
  renderVersion,
  wrap,
  type CommandName,
} from "../cli/help";
import { parseArgs, run } from "../cli/run";

/**
 * Test strategy for the help redesign (v0.4.2):
 *   - Assert on STRUCTURE, not byte-exact output. Each test pins one
 *     property: the renderer includes X, excludes Y, wraps at width Z.
 *   - The width-handling test pins the bug that motivated this work:
 *     long flag descriptions wrapped through ANSI bytes producing
 *     `--doin <d>` (instead of `--domain`). Test renders at columns=60,
 *     strips ANSI, and re-scans every output line — every emitted flag
 *     token must survive intact.
 *   - End-to-end CLI integration via `run([...])` validates the
 *     dispatcher routing (`help <cmd>`, `<cmd> --help`, `--version`).
 */

const PLAIN = { colors: false } as const;

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => {
    out.push(args.join(" "));
  };
  console.error = (...args: unknown[]) => {
    err.push(args.join(" "));
  };
  const restore = () => {
    console.log = origOut;
    console.error = origErr;
  };
  return { out, err, restore };
}

// ── wrap helper ────────────────────────────────────────────────────

describe("wrap", () => {
  it("returns [''] for empty input", () => {
    expect(wrap("", 80)).toEqual([""]);
    expect(wrap("   ", 80)).toEqual([""]);
  });

  it("returns a single line when text fits within width", () => {
    expect(wrap("hello world", 80)).toEqual(["hello world"]);
  });

  it("wraps on word boundaries", () => {
    const out = wrap("alpha beta gamma delta", 12);
    // Each line <= 12 chars.
    for (const line of out) expect(line.length).toBeLessThanOrEqual(12);
    expect(out.join(" ")).toBe("alpha beta gamma delta");
  });

  it("never splits inside a word", () => {
    const out = wrap("supercalifragilistic short", 10);
    expect(out).toContain("supercalifragilistic");
  });
});

// ── Global help ────────────────────────────────────────────────────

describe("renderGlobalHelp", () => {
  it("renders the version trailer when version supplied", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "9.9.9" });
    expect(out).toContain("v9.9.9");
  });

  it("lists every subcommand with its one-line summary", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "0.4.1" });
    const cmds: CommandName[] = [
      "init",
      "doctor",
      "write",
      "fix",
      "prompts",
      "check",
      "history",
    ];
    for (const c of cmds) expect(out).toContain(c);
    // Spot-check summaries (no flag-blob).
    expect(out).toContain("Set up the full system");
    expect(out).toContain("Audit a page for citation readiness");
    expect(out).toContain("Rewrite a page so it passes the doctor checks");
    expect(out).toContain("Generate publish-ready resource pages");
    expect(out).toContain("Measure if AI engines");
    expect(out).toContain("Manage the tracked prompts");
    expect(out).toContain("Citation coverage over time");
  });

  it("orders commands in workflow order: init, doctor, write, fix, prompts, check, history", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "0.4.1" });
    const order = [
      "init",
      "doctor",
      "write",
      "fix",
      "prompts",
      "check",
      "history",
    ];
    let lastIdx = -1;
    for (const cmd of order) {
      const idx = out.indexOf(`  ${cmd}`);
      expect(idx, `expected ${cmd} after position ${lastIdx}`).toBeGreaterThan(
        lastIdx
      );
      lastIdx = idx;
    }
  });

  it("includes a 'First run?' workflow hint pointing at init (v0.6.0)", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "0.6.0" });
    expect(out).toContain("First run?");
    expect(out).toContain("auto-geo init");
    // Mentions the workflow ordering somewhere.
    expect(out).toMatch(/doctor\s*[→-]+\s*write\s*[→-]+\s*fix\s*[→-]+\s*check/);
  });

  it("points users at `auto-geo <cmd> --help`, leading with init", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "0.4.1" });
    expect(out).toContain("--help");
    expect(out).toContain("auto-geo init --help");
    expect(out).toContain("auto-geo check --help");
  });

  it("includes Docs / npm / Shadow attribution links", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "0.4.1" });
    expect(out).toContain("github.com/shadowresearch/auto-geo");
    expect(out).toContain("npmjs.com/package/auto-geo");
    expect(out).toContain("Shadow");
    expect(out).toContain("shadow.inc");
    // v0.7.0: the library surface is gone — no more Library link.
    expect(out).not.toContain("Library");
  });

  it("excludes per-command flags (no flag-blob)", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "0.4.1" });
    expect(out).not.toContain("--queries-file");
    expect(out).not.toContain("--max-retries");
    expect(out).not.toContain("--timeout-per-query");
    expect(out).not.toContain("--author-bio");
  });

  it("emits no ANSI in plain mode", () => {
    const out = renderGlobalHelp({ ...PLAIN, version: "0.4.1" });
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
  });
});

// ── Per-command help ──────────────────────────────────────────────

describe("renderCommandHelp — check", () => {
  it("includes the check flags + examples", () => {
    const out = renderCommandHelp("check", PLAIN);
    expect(out).toContain("auto-geo check");
    expect(out).toContain("--domain");
    expect(out).toContain("--query");
    expect(out).toContain("--engine");
    expect(out).toContain("--ndjson");
    expect(out).toContain("--answers");
    expect(out).toContain("--max-runtime");
    // v0.5.0 additions:
    expect(out).toContain("--format");
    expect(out).toContain("geo-audit");
    // Env vars surfaced.
    expect(out).toContain("PERPLEXITY_API_KEY");
    expect(out).toContain("XAI_API_KEY");
    // Examples.
    expect(out).toContain("Examples:");
    expect(out).toContain('--query "what is GEO"');
    // Exit code.
    expect(out).toContain("Exit code");
  });

  it("excludes other commands' unique flags", () => {
    const out = renderCommandHelp("check", PLAIN);
    expect(out).not.toContain("--author-bio");
    expect(out).not.toContain("--author-linkedin");
    expect(out).not.toContain("--max-pages");
    expect(out).not.toContain("--dry-run");
  });
});

describe("renderCommandHelp — doctor", () => {
  it("includes doctor-specific flags and excludes others", () => {
    const out = renderCommandHelp("doctor", PLAIN);
    expect(out).toContain("auto-geo doctor");
    expect(out).toContain("--site");
    expect(out).toContain("--max-pages");
    expect(out).toContain("--concurrency");
    // Excludes:
    expect(out).not.toContain("--author-bio");
    expect(out).not.toContain("--ndjson");
    expect(out).not.toContain("--engine");
  });
});

describe("renderCommandHelp — fix", () => {
  it("includes fix-specific flags and excludes others", () => {
    const out = renderCommandHelp("fix", PLAIN);
    expect(out).toContain("auto-geo fix");
    expect(out).toContain("--provider");
    expect(out).toContain("--max-retries");
    expect(out).toContain("--author-bio");
    expect(out).toContain("--author-linkedin");
    expect(out).toContain("OPENAI_API_KEY");
    expect(out).toContain("ANTHROPIC_API_KEY");
    // Excludes:
    expect(out).not.toContain("--site");
    expect(out).not.toContain("--ndjson");
    expect(out).not.toContain("--engine");
  });
});

describe("renderCommandHelp — write", () => {
  it("includes write-specific flags and excludes others", () => {
    const out = renderCommandHelp("write", PLAIN);
    expect(out).toContain("auto-geo write");
    expect(out).toContain("--domain");
    expect(out).toContain("--queries-file");
    expect(out).toContain("--basepath");
    expect(out).toContain("--author-name");
    // Excludes:
    expect(out).not.toContain("--site");
    expect(out).not.toContain("--ndjson");
    expect(out).not.toContain("--engine");
  });
});

// ── Width handling — the bug behind the redesign ───────────────────

describe("renderCommandHelp — width handling", () => {
  it("preserves every flag token intact at columns=60", () => {
    const out = renderCommandHelp("check", { colors: false, columns: 60 });
    // Every flag from the data model must survive wrap intact — no
    // `--doin <d>` style mangling.
    for (const section of COMMAND_HELP.check.sections) {
      for (const item of section.items) {
        // Plain mode and no ANSI → check raw substring match.
        expect(out).toContain(item.flag);
      }
    }
  });

  it("preserves every flag token intact under rich (colored) mode at 60 cols", () => {
    // The original bug: ANSI bytes inside the wrap math broke the
    // measure, so flags would split mid-token after stripping color.
    const out = renderCommandHelp("check", { colors: true, columns: 60 });
    // eslint-disable-next-line no-control-regex
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    for (const section of COMMAND_HELP.check.sections) {
      for (const item of section.items) {
        expect(plain).toContain(item.flag);
      }
    }
    // Same for the `fix` command (which has the `--author-name <text>`
    // case from the bug report).
    const fixOut = renderCommandHelp("fix", { colors: true, columns: 60 });
    // eslint-disable-next-line no-control-regex
    const fixPlain = fixOut.replace(/\x1b\[[0-9;]*m/g, "");
    for (const section of COMMAND_HELP.fix.sections) {
      for (const item of section.items) {
        expect(fixPlain).toContain(item.flag);
      }
    }
  });

  it("wraps long descriptions with a hanging indent that aligns with the label column", () => {
    const out = renderCommandHelp("check", { colors: false, columns: 60 });
    const lines = out.split("\n");
    // Find the `--engine <name>` row + its continuation. The wrap
    // budget at 60 cols is small enough that the description does
    // wrap.
    const engineIdx = lines.findIndex((l) => l.includes("--engine <name>"));
    expect(engineIdx).toBeGreaterThan(-1);
    const engineLine = lines[engineIdx]!;
    const descStart = engineLine.indexOf("perplexity");
    expect(descStart).toBeGreaterThan(0);

    // The next continuation line must align its first non-space char
    // with `descStart`.
    const next = lines[engineIdx + 1];
    if (next && next.trim().length > 0 && !next.trim().startsWith("--")) {
      const firstNonSpace = next.search(/\S/);
      expect(firstNonSpace).toBe(descStart);
    }
  });

  it("respects narrow terminal columns when explicit columns < 80", () => {
    const out = renderCommandHelp("check", { colors: false, columns: 50 });
    // No line longer than 100 (the hard cap on help width).
    for (const line of out.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });
});

// ── Pointer ────────────────────────────────────────────────────────

describe("renderHelpPointer", () => {
  it("steers the user at the per-command help", () => {
    expect(renderHelpPointer("doctor")).toBe(
      "Run 'auto-geo doctor --help' to see available flags."
    );
    expect(renderHelpPointer("check")).toBe(
      "Run 'auto-geo check --help' to see available flags."
    );
  });
});

// ── Version ────────────────────────────────────────────────────────

describe("renderVersion + getPackageVersion", () => {
  beforeEach(() => {
    _resetVersionCacheForTests();
  });
  afterEach(() => {
    _resetVersionCacheForTests();
  });

  it("renderVersion returns the `auto-geo v\\d+.\\d+.\\d+` format", async () => {
    const out = await renderVersion();
    expect(out).toMatch(/^auto-geo v\d+\.\d+\.\d+/);
  });

  it("getPackageVersion reads the on-disk version", async () => {
    const v = await getPackageVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ── parseArgs — help / version / help <cmd> routing ────────────────

describe("parseArgs — help routing", () => {
  it("bare argv => global help", () => {
    const a = parseArgs([]);
    expect(a.command).toBe("help");
    if (a.command === "help") expect(a.topic).toBeUndefined();
  });

  it("--help => global help", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
  });

  it("help <cmd> => focused help for that command", () => {
    const a = parseArgs(["help", "check"]);
    expect(a.command).toBe("help");
    if (a.command === "help") expect(a.topic).toBe("check");
  });

  it("help <unknown> => falls back to global help", () => {
    const a = parseArgs(["help", "bogus"]);
    expect(a.command).toBe("help");
    if (a.command === "help") expect(a.topic).toBeUndefined();
  });

  it("<cmd> --help => focused help for that command", () => {
    for (const c of ["doctor", "fix", "write", "check"] as CommandName[]) {
      const a = parseArgs([c, "--help"]);
      expect(a.command).toBe("help");
      if (a.command === "help") expect(a.topic).toBe(c);
      const b = parseArgs([c, "-h"]);
      expect(b.command).toBe("help");
      if (b.command === "help") expect(b.topic).toBe(c);
    }
  });

  it("--version / -v => version command", () => {
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["-v"]).command).toBe("version");
  });
});

// ── run() integration — exit codes + output ────────────────────────

describe("run() — help + version paths", () => {
  let restore: () => void;
  afterEach(() => {
    if (restore) restore();
  });

  it("bare invocation prints global help and exits 0", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run([]);
    expect(code).toBe(0);
    const out = cap.out.join("\n");
    expect(out).toContain("auto-geo");
    expect(out).toContain("Commands:");
  });

  it("auto-geo help prints global help and exits 0", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run(["help"]);
    expect(code).toBe(0);
    expect(cap.out.join("\n")).toContain("Commands:");
  });

  it("auto-geo help <cmd> prints focused help and exits 0", async () => {
    for (const c of ["doctor", "fix", "write", "check"] as CommandName[]) {
      const cap = captureConsole();
      restore = cap.restore;
      const code = await run(["help", c]);
      expect(code).toBe(0);
      const out = cap.out.join("\n");
      expect(out).toContain(`auto-geo ${c}`);
      cap.restore();
    }
  });

  it("auto-geo <cmd> --help prints focused help and exits 0", async () => {
    for (const c of ["doctor", "fix", "write", "check"] as CommandName[]) {
      const cap = captureConsole();
      restore = cap.restore;
      const code = await run([c, "--help"]);
      expect(code).toBe(0);
      const out = cap.out.join("\n");
      expect(out).toContain(`auto-geo ${c}`);
      cap.restore();
    }
  });

  it("auto-geo --version prints version and exits 0", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run(["--version"]);
    expect(code).toBe(0);
    expect(cap.out.join("\n")).toMatch(/^auto-geo v\d+\.\d+\.\d+/);
  });

  it("auto-geo -v prints version and exits 0", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run(["-v"]);
    expect(code).toBe(0);
    expect(cap.out.join("\n")).toMatch(/^auto-geo v\d+\.\d+\.\d+/);
  });
});

describe("run() — bare subcommand emits short pointer (not the USAGE blob)", () => {
  let restore: () => void;
  afterEach(() => {
    if (restore) restore();
  });

  it("bare `doctor` => exit 2 + one-liner pointer", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run(["doctor"]);
    expect(code).toBe(2);
    const err = cap.err.join("\n");
    expect(err).toContain("missing URL");
    expect(err).toContain("auto-geo doctor --help");
    // Critically: not the WHOLE flag blob — these tokens belong to
    // other commands and would prove a USAGE-dump regression.
    expect(err).not.toContain("--ndjson");
    expect(err).not.toContain("--author-bio");
  });

  it("bare `fix` => exit 2 + one-liner pointer", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run(["fix"]);
    expect(code).toBe(2);
    const err = cap.err.join("\n");
    expect(err).toContain("missing URL");
    expect(err).toContain("auto-geo fix --help");
    expect(err).not.toContain("--ndjson");
  });

  it("bare `write` => exit 2 + one-liner pointer", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run(["write"]);
    expect(code).toBe(2);
    const err = cap.err.join("\n");
    expect(err).toContain("--domain");
    expect(err).toContain("auto-geo write --help");
    expect(err).not.toContain("--ndjson");
    expect(err).not.toContain("--site");
  });

  it("bare `check` => exit 2 + one-liner pointer", async () => {
    const cap = captureConsole();
    restore = cap.restore;
    const code = await run(["check"]);
    expect(code).toBe(2);
    const err = cap.err.join("\n");
    expect(err).toContain("--domain");
    expect(err).toContain("auto-geo check --help");
    expect(err).not.toContain("--author-bio");
    expect(err).not.toContain("--site");
  });
});
