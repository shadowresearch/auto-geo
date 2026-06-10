import { defineConfig } from "tsup";

// v0.7.0: auto-geo is CLI-only. One build — a single executable at
// dist/cli/bin.js with the shebang injected via `banner` so the npm bin
// shim runs it directly.
//
// `linkedom` is bundled into the binary (used by `doctor` / `fix` to
// parse fetched HTML). The AI SDK packages (`ai`, `@ai-sdk/openai`,
// `@ai-sdk/anthropic`) and `zod` are kept external because some
// transitive deps (notably `@vercel/oidc`) rely on CJS `require()` at
// module load — bundling them via esbuild breaks the require shim under
// ESM. They are real runtime dependencies in package.json so
// `npm i auto-geo` installs them alongside.
export default defineConfig({
  entry: { "cli/bin": "cli/bin.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  sourcemap: true,
  splitting: false,
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  external: ["ai", "@ai-sdk/openai", "@ai-sdk/anthropic", "zod"],
  noExternal: ["linkedom"],
});
