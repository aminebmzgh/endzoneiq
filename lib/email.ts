import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let client: Resend | undefined;

/**
 * Send one transactional email through Resend. Without RESEND_API_KEY the email is
 * logged in development (so magic links work locally) and refused in production.
 */
export async function sendEmail(email: Email): Promise<void> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set: cannot send email");
    }
    console.info(`[email:dev] to=${email.to} subject=${email.subject}\n${email.text}`);
    return;
  }
  client ??= new Resend(env.RESEND_API_KEY);
  const { error } = await client.emails.send({ from: env.EMAIL_FROM, ...email });
  if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
}

type Copy = { subject: string; body: string; button: string; ignore: string };
type Kind = "magicLink" | "verifyEmail" | "resetPassword";

const IGNORE = {
  en: "If you didn't ask for this, you can ignore this email.",
  fr: "Si vous n'avez rien demandé, ignorez simplement cet e-mail.",
  es: "Si no lo has pedido, puedes ignorar este correo.",
};

const COPY: Record<Kind, Record<"en" | "fr" | "es", Omit<Copy, "ignore">>> = {
  magicLink: {
    en: {
      subject: "Your EndzoneIQ sign-in link",
      body: "Click the button below to sign in to EndzoneIQ. The link expires in 15 minutes and works once.",
      button: "Sign in",
    },
    fr: {
      subject: "Votre lien de connexion EndzoneIQ",
      body: "Cliquez sur le bouton ci-dessous pour vous connecter à EndzoneIQ. Le lien expire dans 15 minutes et ne fonctionne qu'une fois.",
      button: "Se connecter",
    },
    es: {
      subject: "Tu enlace de acceso a EndzoneIQ",
      body: "Haz clic en el botón de abajo para entrar en EndzoneIQ. El enlace caduca en 15 minutos y solo funciona una vez.",
      button: "Entrar",
    },
  },
  verifyEmail: {
    en: {
      subject: "Confirm your EndzoneIQ account",
      body: "Welcome to EndzoneIQ! Confirm your email address to finish creating your account. You only need to do this once; after that you sign in with your password.",
      button: "Confirm my email",
    },
    fr: {
      subject: "Confirmez votre compte EndzoneIQ",
      body: "Bienvenue sur EndzoneIQ ! Confirmez votre adresse e-mail pour terminer la création de votre compte. Une seule fois : ensuite, vous vous connectez avec votre mot de passe.",
      button: "Confirmer mon e-mail",
    },
    es: {
      subject: "Confirma tu cuenta de EndzoneIQ",
      body: "¡Bienvenido a EndzoneIQ! Confirma tu correo para terminar de crear tu cuenta. Solo hace falta una vez; después entras con tu contraseña.",
      button: "Confirmar mi correo",
    },
  },
  resetPassword: {
    en: {
      subject: "Set your EndzoneIQ password",
      body: "Click the button below to choose a new password for EndzoneIQ. The link expires in 1 hour.",
      button: "Choose a password",
    },
    fr: {
      subject: "Choisissez votre mot de passe EndzoneIQ",
      body: "Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe EndzoneIQ. Le lien expire dans 1 heure.",
      button: "Choisir un mot de passe",
    },
    es: {
      subject: "Elige tu contraseña de EndzoneIQ",
      body: "Haz clic en el botón de abajo para elegir una nueva contraseña de EndzoneIQ. El enlace caduca en 1 hora.",
      button: "Elegir contraseña",
    },
  },
};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** One-button transactional email (sign-in link, email confirmation, password reset). */
export function actionEmail(kind: Kind, to: string, url: string, locale: string): Email {
  const l = (locale in IGNORE ? locale : "en") as keyof typeof IGNORE;
  const t: Copy = { ...COPY[kind][l], ignore: IGNORE[l] };
  const href = escape(url);
  return {
    to,
    subject: t.subject,
    text: `${t.body}

${url}

${t.ignore}`,
    html: `<!doctype html><html lang="${l}"><body style="font-family:system-ui,sans-serif;background:#f1f4f8;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border-radius:10px;padding:28px;color:#0b0f17">
<p style="font-size:20px;font-weight:700;margin:0 0 16px">Endzone<span style="color:#0a7d55">IQ</span></p>
<p style="line-height:1.5">${escape(t.body)}</p>
<p style="margin:24px 0"><a href="${href}" style="background:#0a7d55;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escape(t.button)}</a></p>
<p style="font-size:13px;color:#4a5567">${escape(t.ignore)}</p>
</div></body></html>`,
  };
}

export const magicLinkEmail = (to: string, url: string, locale: string) =>
  actionEmail("magicLink", to, url, locale);
