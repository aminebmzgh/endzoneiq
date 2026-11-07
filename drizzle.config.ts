import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://endzoneiq:endzoneiq@127.0.0.1:3306/endzoneiq",
  },
  strict: true,
  verbose: true,
});
