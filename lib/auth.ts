import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { account, profiles, session, user, verification } from "@/db/schema";
import { routing } from "@/i18n/routing";
import { getDb } from "@/lib/db";
import { actionEmail, magicLinkEmail, sendEmail } from "@/lib/email";
import { serverEnv } from "@/lib/env";

/** The locale a sign-in started from, read from its callback URL (/fr/account -> fr). */
export function localeFromUrl(url: string): (typeof routing.locales)[number] {
  try {
    const callback = new URL(url).searchParams.get("callbackURL") ?? "";
    const seg = callback.split("/")[1] ?? "";
    return (routing.locales as readonly string[]).includes(seg)
      ? (seg as (typeof routing.locales)[number])
      : routing.defaultLocale;
  } catch {
    return routing.defaultLocale;
  }
}

function createAuth() {
  const env = serverEnv();
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set");
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_SITE_URL,
    database: drizzleAdapter(getDb(), {
      provider: "mysql",
      schema: { user, session, account, verification },
    }),
    socialProviders: google,
    // Email + password. A new account confirms its email once (prevents someone from
    // registering another person's address with their own password); after that,
    // sign-in is email + password only. Accounts created by magic link have no password
    // until they set one through "forgot password".
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }) => {
        await sendEmail(actionEmail("resetPassword", u.email, url, localeFromUrl(url)));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true, // signing in before confirming re-sends the link
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user: u, url }) => {
        await sendEmail(actionEmail("verifyEmail", u.email, url, localeFromUrl(url)));
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refreshed at most daily
    },
    // In-memory limits suit the single Node process (see BACKLOG for multi-process).
    // Production only (tests and dev sign in many times in a row). Better Auth adds
    // stricter limits on sign-in and password-reset routes (brute-force protection).
    rateLimit: { enabled: process.env.NODE_ENV === "production", window: 60, max: 60 },
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
    databaseHooks: {
      user: {
        create: {
          // Every account gets a profile. Admins come from ADMIN_EMAILS.
          after: async (u) => {
            const admins = serverEnv().ADMIN_EMAILS;
            await getDb()
              .insert(profiles)
              .ignore()
              .values({
                userId: u.id,
                role: admins.includes(u.email.toLowerCase()) ? "admin" : "user",
              });
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(magicLinkEmail(email, url, localeFromUrl(url)));
        },
      }),
      nextCookies(), // must stay last
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __ezAuth?: Auth };

/** Lazily created so `next build` never needs the auth secret. */
export function getAuth(): Auth {
  globalForAuth.__ezAuth ??= createAuth();
  return globalForAuth.__ezAuth;
}

export function authConfigured(): boolean {
  return Boolean(serverEnv().BETTER_AUTH_SECRET);
}

export function googleConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
