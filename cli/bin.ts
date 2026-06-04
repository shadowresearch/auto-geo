import { run } from "./run";

/**
 * `auto-geo` CLI entry. Wired to the `bin.auto-geo` field in
 * `package.json` so `npx auto-geo doctor <url>` (and post-install
 * `auto-geo doctor <url>`) execute this file.
 *
 * Kept minimal on purpose — all logic lives in `cli/run.ts` so tests
 * can import the parser and runner without triggering `process.exit`.
 *
 * The shebang line is injected by tsup's `banner` option at build
 * time; sources stay plain TS so `tsc --noEmit` doesn't choke.
 */

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
