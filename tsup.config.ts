import { defineConfig } from "tsup";

// Each entry maps a public subpath in `package.json#exports` (or the
// `bin` field) to its source file. Output names preserve the structure
// so the published `dist/` layout reads like the source tree
// (dist/storage/kv.js, dist/react/index.js, dist/cli/bin.js, etc.).
//
// External packages are not bundled — consumers bring their own copies of
// react / zod / next / hono / @vercel/kv / @supabase/supabase-js via the
// peer-dependency contract in package.json. `linkedom` is a real runtime
// dep (used by the CLI) so it's bundled into dist/cli/bin.js as a single
// executable — the install-time npm bin shim then runs it directly.

export default defineConfig([
  // Library build — every public subpath import { ... } from "auto-geo/...".
  {
    entry: {
      index: "core/index.ts",
      schema: "core/schema.ts",
      validation: "core/validation.ts",
      jsonld: "core/jsonld.ts",
      "react/index": "components/react/index.ts",
      next: "adapters/http/next.ts",
      hono: "adapters/http/hono.ts",
      cloudflare: "adapters/http/cloudflare.ts",
      "storage/kv": "adapters/storage/kv.ts",
      "storage/supabase": "adapters/storage/supabase.ts",
      "storage/memory": "adapters/storage/memory.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    target: "es2022",
    external: [
      "react",
      "react-dom",
      "zod",
      "next",
      "hono",
      "@vercel/kv",
      "@supabase/supabase-js",
    ],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  // CLI build — single executable, esm-only, linkedom bundled in.
  // Shebang is injected via `banner` so the bin shim runs directly.
  // `clean` is intentionally false here so this build does not wipe
  // the library output that ran first in the same `tsup` invocation.
  {
    entry: { "cli/bin": "cli/bin.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    sourcemap: true,
    splitting: false,
    clean: false,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
    // Bundle linkedom so the CLI is self-contained — users running
    // `npx auto-geo doctor` shouldn't need a separate install step.
  },
]);
