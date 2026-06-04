import { defineConfig } from "tsup";

// Each entry maps a public subpath in `package.json#exports` to its source
// file. Output names preserve the structure so the published `dist/` layout
// reads like the source tree (dist/storage/kv.js, dist/react/index.js, etc.).
//
// External packages are not bundled — consumers bring their own copies of
// react / zod / next / hono / @vercel/kv / @supabase/supabase-js via the
// peer-dependency contract in package.json.

export default defineConfig({
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
});
