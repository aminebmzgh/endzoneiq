import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { alertPrefs, alertTeams, games, picks, profiles, teams } from "@/db/schema";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { getWeekGames } from "@/lib/site/data";
import { emailHtml, escapeHtml, pickChangeCopy, roundName, weeklyCopy, type Lang } from "./copy";
import { enqueue, type QueueRow } from "./queue";

/**
 * Who gets told what (spec 7.5, 15):
 * - Pick-change alerts: Pro users and admins, by push (on by default once they enable
 *   push on a device) and/or email (opt-in), for the teams they follow (none = all).
 * - Weekly picks email: anyone who opted in.
 * - Admin emails: failed pipeline runs, a broken hash chain.
 */

const home = alias(teams, "home_team");
const away = alias(teams, "away_team");
const winner = alias(teams, "winner_team");

/** Queue alerts for new pick versions (version 1 is a first publish, not a change). */
export async function queuePickChangeAlerts(created: { gameId: string; versionNo: number }[]) {
  const changes = created.filter((c) => c.versionNo > 1);
  if (changes.length === 0) return 0;
  const db = getDb();
  const site = serverEnv().NEXT_PUBLIC_SITE_URL;

  const recipients = await db
    .select({
      userId: profiles.userId,
      locale: profiles.locale,
      push: alertPrefs.notifyPickChange,
      email: alertPrefs.notifyPickChangeEmail,
    })
    .from(profiles)
    .leftJoin(alertPrefs, eq(alertPrefs.userId, profiles.userId))
    .where(or(eq(profiles.plan, "pro"), eq(profiles.role, "admin")));
  if (recipients.length === 0) return 0;
  const follows = await db
    .select({ userId: alertTeams.userId, teamId: alertTeams.teamId })
    .from(alertTeams)
    .where(
      inArray(
        alertTeams.userId,
        recipients.map((r) => r.userId),
      ),
    );
  const followed = new Map<string, Set<number>>();
  for (const f of follows)
    followed.set(f.userId, (followed.get(f.userId) ?? new Set()).add(f.teamId));

  const rows: QueueRow[] = [];
  for (const c of changes) {
    const versions = await db
      .select({
        pickId: picks.id,
        versionNo: picks.versionNo,
        winProb: picks.winProb,
        winner: winner.name,
        home: home.name,
        away: away.name,
        homeId: games.homeTeamId,
        awayId: games.awayTeamId,
        slug: games.slug,
      })
      .from(picks)
      .innerJoin(games, eq(games.id, picks.gameId))
      .innerJoin(home, eq(home.id, games.homeTeamId))
      .innerJoin(away, eq(away.id, games.awayTeamId))
      .innerJoin(winner, eq(winner.id, picks.winnerTeamId))
      .where(
        and(eq(picks.gameId, c.gameId), inArray(picks.versionNo, [c.versionNo, c.versionNo - 1])),
      );
    const now = versions.find((v) => v.versionNo === c.versionNo);
    const prev = versions.find((v) => v.versionNo === c.versionNo - 1);
    if (!now || !prev) continue;

    for (const r of recipients) {
      const teamsFollowed = followed.get(r.userId);
      if (teamsFollowed && !teamsFollowed.has(now.homeId) && !teamsFollowed.has(now.awayId))
        continue;
      const lang = r.locale as Lang;
      const copy = pickChangeCopy(lang, {
        away: now.away,
        home: now.home,
        winner: now.winner,
        winProb: now.winProb,
        prevWinner: prev.winner,
        prevWinProb: prev.winProb,
      });
      const url = `${site}/${lang}/game/${now.slug}`;
      if (r.push ?? true) {
        rows.push({
          userId: r.userId,
          channel: "push",
          dedupeKey: `pick:${now.pickId}:${r.userId}:push`,
          payload: { ...copy, url, tag: `pick-${c.gameId}` },
        });
      }
      if (r.email) {
        rows.push({
          userId: r.userId,
          channel: "email",
          dedupeKey: `pick:${now.pickId}:${r.userId}:email`,
          payload: {
            subject: copy.title,
            text: `${copy.body}\n\n${url}`,
            html: emailHtml(lang, `<p style="line-height:1.5">${escapeHtml(copy.body)}</p>`, {
              label: copy.title,
              url,
            }),
          },
        });
      }
    }
  }
  return enqueue(rows);
}

/** Weekly picks email to everyone who opted in (once per user and week). */
export async function queueWeeklyEmails(season: number, week: number): Promise<number> {
  const db = getDb();
  const site = serverEnv().NEXT_PUBLIC_SITE_URL;
  const subscribers = await db
    .select({ userId: alertPrefs.userId, locale: profiles.locale })
    .from(alertPrefs)
    .innerJoin(profiles, eq(profiles.userId, alertPrefs.userId))
    .where(eq(alertPrefs.notifyWeekly, true));
  if (subscribers.length === 0) return 0;

  const byLang = new Map<Lang, Awaited<ReturnType<typeof getWeekGames>>>();
  for (const lang of new Set(subscribers.map((s) => s.locale as Lang))) {
    byLang.set(lang, await getWeekGames(season, week, lang));
  }
  const rows: QueueRow[] = [];
  for (const s of subscribers) {
    const lang = s.locale as Lang;
    const list = (byLang.get(lang) ?? []).filter((g) => g.pick);
    if (list.length === 0) continue;
    const copy = weeklyCopy(lang, roundName(lang, list[0]!.gameType, week));
    const pct = (p: number) =>
      new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 }).format(p);
    const lines = list.map((g) => {
      const w = g.pick!.side === "home" ? g.home : g.away;
      return {
        game: `${g.away.name} @ ${g.home.name}`,
        pick: `${w.name} ${pct(g.pick!.winProb)}`,
        why: g.pick!.topReason ?? "",
      };
    });
    const url = `${site}/${lang}`;
    rows.push({
      userId: s.userId,
      channel: "email",
      dedupeKey: `weekly:${season}:${week}:${s.userId}`,
      payload: {
        subject: copy.subject,
        text: [
          copy.intro,
          "",
          ...lines.map((l) => `${l.game}: ${l.pick}. ${l.why}`),
          "",
          url,
          "",
          copy.footer,
        ].join("\n"),
        html: emailHtml(
          lang,
          `<p style="line-height:1.5">${escapeHtml(copy.intro)}</p>` +
            lines
              .map(
                (l) =>
                  `<p style="margin:12px 0;line-height:1.4"><strong>${escapeHtml(l.game)}</strong><br>${escapeHtml(l.pick)}<br><span style="color:#4a5567">${escapeHtml(l.why)}</span></p>`,
              )
              .join("") +
            `<p style="font-size:12px;color:#4a5567;margin-top:24px">${escapeHtml(copy.footer)}</p>`,
          { label: copy.cta, url },
        ),
      },
    });
  }
  return enqueue(rows);
}

/** An email to every admin (ADMIN_EMAILS). `key` dedupes it. */
export async function queueAdminEmail(key: string, subject: string, text: string): Promise<number> {
  const admins = serverEnv().ADMIN_EMAILS;
  return enqueue(
    admins.map((to) => ({
      toEmail: to,
      channel: "email" as const,
      dedupeKey: `admin:${key}:${to}`,
      payload: {
        subject: `[EndzoneIQ] ${subject}`,
        text,
        html: emailHtml(
          "en",
          `<p style="white-space:pre-wrap;line-height:1.5">${escapeHtml(text)}</p>`,
        ),
      },
    })),
  );
}
