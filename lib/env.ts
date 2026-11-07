import "server-only";
import { z } from "zod";

/**
 * Server-only runtime environment. Read lazily so `next build` never needs
 * production secrets (they live only in Hostinger's environment variables).
 * Variables for later phases are added here as they are introduced.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) cached = serverEnvSchema.parse(process.env);
  return cached;
}
