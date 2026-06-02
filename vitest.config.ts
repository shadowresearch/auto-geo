import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    // Use the automatic JSX runtime so test files don't need to import React.
    jsx: "automatic",
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    environmentMatchGlobs: [
      ["tests/**/*.test.tsx", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["core/**", "adapters/**", "components/**"],
      exclude: [
        "**/*.d.ts",
        "**/index.ts",
        // Integration/UI surfaces covered by other test strategies, not
        // unit tests. Keeping them in `include` would pull their 0%
        // coverage into the global thresholds.
        "adapters/**",
        "components/react/ResourceArticle.tsx",
        "core/store.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
