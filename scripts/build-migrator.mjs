// Bundles db/migrator.ts (with drizzle-orm + mysql2) into one self-contained
// CommonJS file, so the deploy package needs no node_modules for migrations.
import { build } from "esbuild";

await build({
  entryPoints: ["db/migrator.ts"],
  outfile: "dist-migrator/migrate.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
