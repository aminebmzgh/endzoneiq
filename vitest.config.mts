import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // `server-only` throws outside a React Server Components build; no-op it in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Integration tests share one MariaDB test database (and one resets append-only
    // tables), so test files run one at a time.
    fileParallelism: false,
    // Loads .env / .env.local so DB integration tests find the local docker MariaDB.
    env: loadEnv(mode, process.cwd(), ""),
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "pipeline/**", "dist-*/**"],
  },
}));
