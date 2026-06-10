import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Make the suite hermetic. `run()`-level tests exercise the real CLI
 * entry, which resolves `auto-geo.config.json`, the `.auto-geo/`
 * workspace, and `.env.local` by walking UP from `process.cwd()` — so a
 * developer's own config anywhere above their clone (e.g. created by
 * testing the published CLI in a parent directory) would leak into
 * assertions and flip test outcomes.
 *
 * Chdir each worker into a fresh tmpdir before any test runs. Unit
 * tests that care about location already pass an explicit `cwd`; this
 * protects everything that doesn't.
 */
process.chdir(mkdtempSync(join(tmpdir(), "auto-geo-tests-")));
