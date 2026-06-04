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
  // CLI build — single executable, esm-only, linkedom + AI SDK bundled in.
  // Shebang is injected via `banner` so the bin shim runs directly.
  // `clean` is intentionally false here so this build does not wipe
  // the library output that ran first in the same `tsup` invocation.
  //
  // We bundle `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic` into the CLI
  // binary so `npx auto-geo write` works without users installing those
  // packages themselves. They are devDependencies in package.json (not
  // runtime deps) because the library exports do NOT depend on them —
  // only the CLI does, and the CLI is single-file via tsup.
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
    // `linkedom` is bundled into the CLI (single executable for the
    // `doctor` subcommand). The AI SDK packages (`ai`, `@ai-sdk/openai`,
    // `@ai-sdk/anthropic`) are kept external because some transitive
    // deps (notably `@vercel/oidc`) rely on CJS `require()` at module
    // load — bundling them via esbuild breaks the require shim under
    // ESM. They are listed as real runtime dependencies in
    // package.json so `npm i auto-geo` installs them alongside.
    external: ["ai", "@ai-sdk/openai", "@ai-sdk/anthropic"],
    noExternal: ["linkedom"],
  },
]);
