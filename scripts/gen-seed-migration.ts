/** `npm run db:seed-sql`: write the reference seed into its custom migration file. */
import fs from "node:fs";
import path from "node:path";
import { renderSeedSql, SEED_MIGRATION } from "../db/seed/render-sql";

const file = path.resolve(import.meta.dirname, "../db/migrations", SEED_MIGRATION);
if (!fs.existsSync(file)) {
  console.error(`${SEED_MIGRATION} not found. Create it first with:`);
  console.error("  npx drizzle-kit generate --custom --name=<name>");
  process.exit(1);
}
fs.writeFileSync(file, renderSeedSql());
console.log(`wrote ${path.relative(process.cwd(), file)}`);
