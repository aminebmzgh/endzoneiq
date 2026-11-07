/**
 * Notification text (push and email) in the recipient's language. Kept here rather than
 * in messages/*.json because it is built outside any page render (ingest, cron).
 */
export type Lang = "en" | "fr" | "es";

const pct = (lang: Lang, p: number) =>
  new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 }).format(p);

export function pickChangeCopy(
  lang: Lang,
  c: {
    away: string;
    home: string;
    winner: string;
    winProb: number;
    prevWinner: string;
    prevWinProb: number;
  },
) {
  const now = `${c.winner} ${pct(lang, c.winProb)}`;
  const before = `${c.prevWinner} ${pct(lang, c.prevWinProb)}`;
  const flipped = c.winner !== c.prevWinner;
  switch (lang) {
    case "fr":
      return {
        title: `Pronostic mis à jour : ${c.away} à ${c.home}`,
        body: flipped
          ? `Changement de pronostic : ${now} (avant : ${before}).`
          : `Maintenant ${now} (avant : ${before}).`,
      };
    case "es":
      return {
        title: `Pronóstico actualizado: ${c.away} en ${c.home}`,
        body: flipped
          ? `Cambio de pronóstico: ${now} (antes: ${before}).`
          : `Ahora ${now} (antes: ${before}).`,
      };
    default:
      return {
        title: `Pick updated: ${c.away} at ${c.home}`,
        body: flipped ? `Pick changed: ${now} (was ${before}).` : `Now ${now} (was ${before}).`,
      };
  }
}

export function weeklyCopy(lang: Lang, round: string) {
  switch (lang) {
    case "fr":
      return {
        subject: `Les pronostics NFL de la ${round}`,
        intro: `Voici nos pronostics pour la ${round}. Chaque match a sa probabilité et ses raisons sur EndzoneIQ.`,
        cta: "Voir tous les pronostics",
        footer:
          "À des fins de divertissement et d'information. Ceci n'est pas un conseil de pari. Désactivez cet e-mail dans votre compte.",
      };
    case "es":
      return {
        subject: `Los pronósticos NFL de la ${round}`,
        intro: `Estos son nuestros pronósticos para la ${round}. Cada partido tiene su probabilidad y sus razones en EndzoneIQ.`,
        cta: "Ver todos los pronósticos",
        footer:
          "Con fines de entretenimiento e información. No es asesoramiento de apuestas. Desactiva este correo en tu cuenta.",
      };
    default:
      return {
        subject: `Your NFL picks for ${round}`,
        intro: `Here are our picks for ${round}. Every game has its win probability and reasons on EndzoneIQ.`,
        cta: "See all the picks",
        footer:
          "For entertainment and informational purposes. Not betting advice. Turn this email off in your account.",
      };
  }
}

export function roundName(lang: Lang, gameType: string, week: number): string {
  const post: Record<string, Record<Lang, string>> = {
    WC: { en: "the Wild Card round", fr: "Wild Card", es: "ronda de comodines" },
    DIV: { en: "the Divisional round", fr: "tour de division", es: "ronda divisional" },
    CON: {
      en: "the conference championships",
      fr: "finales de conférence",
      es: "finales de conferencia",
    },
    SB: { en: "the Super Bowl", fr: "Super Bowl", es: "Super Bowl" },
  };
  if (gameType !== "REG") return post[gameType]?.[lang] ?? gameType;
  return { en: `Week ${week}`, fr: `semaine ${week}`, es: `semana ${week}` }[lang];
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Simple branded email layout around a body of paragraphs/rows (already escaped HTML). */
export function emailHtml(lang: Lang, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html lang="${lang}"><body style="font-family:system-ui,sans-serif;background:#f1f4f8;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:10px;padding:28px;color:#0b0f17">
<p style="font-size:20px;font-weight:700;margin:0 0 16px">Endzone<span style="color:#0a7d55">IQ</span></p>
${bodyHtml}
${cta ? `<p style="margin:24px 0"><a href="${escape(cta.url)}" style="background:#0a7d55;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escape(cta.label)}</a></p>` : ""}
</div></body></html>`;
}

export { escape as escapeHtml };
