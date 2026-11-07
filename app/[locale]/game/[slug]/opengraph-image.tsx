import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getGame } from "@/lib/site/data";
import { pct, roundLabel } from "@/lib/site/labels";

export const alt = "EndzoneIQ pick";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0b0f17";
const FG = "#eef2f7";
const MUTED = "#9aa6b8";
const ACCENT = "#34d399";
const TRACK = "#253043";

/** Per-game share image: matchup, pick, probability and the headline. Text only, no logos. */
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const game = /^[a-z0-9-]{8,64}$/.test(slug) ? await getGame(slug, locale as Locale) : null;
  const [tc, tw] = await Promise.all([
    getTranslations({ locale, namespace: "Card" }),
    getTranslations({ locale, namespace: "Week" }),
  ]);

  const pick = game?.pick ?? null;
  const picked = game && pick ? (pick.side === "home" ? game.home : game.away) : null;
  const awayProb = pick ? (pick.side === "away" ? pick.winProb : 1 - pick.winProb) : 0.5;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: BG,
        color: FG,
        padding: 64,
        fontSize: 32,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", color: MUTED }}>
        <div style={{ display: "flex", fontWeight: 700, color: FG }}>
          Endzone<span style={{ color: ACCENT }}>IQ</span>
        </div>
        {game && (
          <div style={{ display: "flex" }}>
            {roundLabel(tw, game.gameType, game.week)} · {game.season}
          </div>
        )}
      </div>

      {game ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700 }}>
            {game.away.name}
            <span style={{ color: MUTED, fontWeight: 400, margin: "0 20px" }}>{tc("at")}</span>
            {game.home.name}
          </div>
          {pick && picked ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
                <span style={{ color: MUTED }}>{tc("pick")}</span>
                <span style={{ fontSize: 72, fontWeight: 700 }}>{picked.name}</span>
                <span style={{ fontSize: 72, fontWeight: 700, color: ACCENT }}>
                  {pct(locale, pick.winProb)}
                </span>
              </div>
              <div style={{ display: "flex", height: 16, borderRadius: 8, background: TRACK }}>
                <div
                  style={{
                    width: `${awayProb * 100}%`,
                    background: pick.side === "away" ? ACCENT : "#4a5567",
                    borderRadius: 8,
                  }}
                />
                <div
                  style={{
                    width: `${(1 - awayProb) * 100}%`,
                    background: pick.side === "home" ? ACCENT : "#4a5567",
                    borderRadius: 8,
                    marginLeft: 6,
                  }}
                />
              </div>
              {pick.headline && (
                <div style={{ display: "flex", color: MUTED, fontSize: 30 }}>{pick.headline}</div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", color: MUTED }}>{tc("noPick")}</div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>EndzoneIQ</div>
      )}

      <div style={{ display: "flex", color: MUTED, fontSize: 22 }}>endzoneiq.com</div>
    </div>,
    size,
  );
}
