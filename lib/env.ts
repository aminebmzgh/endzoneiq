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
  /** HMAC key shared with the GitHub Actions pipeline. Internal API answers 503 without it. */
  INGEST_SECRET: z.string().min(32).optional(),
  FEATURE_ODDS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // --- Auth (Phase 5). Sign-in answers 503 without a secret. ---
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Comma-separated emails that get the admin role. */
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),

  // --- AI assistant (Phase 6). Model names come from env, never hardcoded. ---
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL_CHAT: z.string().optional(),
  /** Questions per UTC day. */
  CHAT_LIMIT_FREE: z.coerce.number().int().min(0).default(3),
  CHAT_LIMIT_PRO: z.coerce.number().int().min(0).default(50),

  // --- Email (Resend). Without a key, magic links are logged in development only. ---
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("EndzoneIQ <hello@endzoneiq.com>"),

  // --- Payments (Stripe). Billing answers 503 until these are set. ---
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().startsWith("price_").optional(),
  STRIPE_PRICE_PRO_SEASON: z.string().startsWith("price_").optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    // Treat empty strings (as in .env.example) as unset.
    const raw = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
    );
    cached = serverEnvSchema.parse(raw);
  }
  return cached;
}

/** Tests only: forget the cached env after changing process.env. */
export function resetServerEnvForTests(): void {
  cached = undefined;
}
