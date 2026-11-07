import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/components/locale-link";
import { AfterKickoff } from "@/components/after-kickoff";
import { LocalTime } from "@/components/local-time";
import { pct } from "@/lib/site/labels";
import type { GameSummary, TeamLite } from "@/lib/site/types";
import { OutcomeBadge, TeamSwatch, TierBadge, UpdatedBadge } from "./badges";
import { ProbabilityBar } from "./probability-bar";

function TeamLine({
  team,
  score,
  picked,
  won,
}: {
  team: TeamLite;
  score: number | null;
  picked: boolean;
  won: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2">
        <TeamSwatch color={team.color} />
        <span className={`truncate ${picked ? "font-semibold" : "text-muted-foreground"}`}>
          <span className="sm:hidden">{team.name}</span>
          <span className="hidden sm:inline">
            {team.city} {team.name}
          </span>
        </span>
      </span>
      {score !== null && (
        <span className={`tabular-nums ${won ? "font-semibold" : "text-muted-foreground"}`}>
          {score}
        </span>
      )}
    </div>
  );
}

/**
 * Answer first (spec principle 1): teams, kickoff, the pick, its probability and the
 * top reason are all visible without opening the game.
 */
export function GameCard({ game }: { game: GameSummary }) {
  const t = useTranslations("Card");
  const locale = useLocale();
  const { pick } = game;
  const final = game.status === "final" && game.homeScore !== null && game.awayScore !== null;
  const winnerSide = final
    ? game.homeScore! > game.awayScore!
      ? "home"
      : game.awayScore! > game.homeScore!
        ? "away"
        : null
    : null;
  const pickedTeam = pick ? (pick.side === "home" ? game.home : game.away) : null;
  const homeProb = pick ? (pick.side === "home" ? pick.winProb : 1 - pick.winProb) : 0.5;

  return (
    <article className="relative rounded-lg border border-border bg-card p-4 transition-colors focus-within:border-accent hover:border-accent/60">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {final ? (
          <span className="font-medium text-foreground">{t("final")}</span>
        ) : (
          <LocalTime iso={game.kickoffAt} locale={locale} />
        )}
        <span className="flex items-center gap-1.5">
          {pick?.outcome && <OutcomeBadge outcome={pick.outcome} />}
          {pick && !pick.outcome && pick.versionNo > 1 && <UpdatedBadge />}
          {pick && <TierBadge tier={pick.tier} />}
        </span>
      </div>

      <div className="space-y-1.5">
        <TeamLine
          team={game.away}
          score={final ? game.awayScore : null}
          picked={pick?.side === "away"}
          won={winnerSide === "away"}
        />
        <TeamLine
          team={game.home}
          score={final ? game.homeScore : null}
          picked={pick?.side === "home"}
          won={winnerSide === "home"}
        />
      </div>

      {pick && pickedTeam ? (
        <div className="mt-4 space-y-2">
          <ProbabilityBar
            homeProb={homeProb}
            homeName={game.home.name}
            awayName={game.away.name}
            pickedSide={pick.side}
          />
          <p className="text-sm">
            <span className="font-semibold">
              {t("pick")}: {pickedTeam.name}
            </span>{" "}
            <span className="text-muted-foreground">
              · {t("winProb", { pct: pct(locale, pick.winProb) })}
            </span>
          </p>
          {pick.topReason && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{pick.topReason}</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {game.status === "scheduled" ? (
            <AfterKickoff iso={game.kickoffAt} before={t("noPick")} after={t("noPickPast")} />
          ) : (
            t("noPickPast")
          )}
        </p>
      )}

      {!final && pick && (
        <AfterKickoff
          iso={game.kickoffAt}
          after={<p className="mt-2 text-xs text-muted-foreground">{t("locked")}</p>}
        />
      )}

      <Link
        href={`/game/${game.slug}`}
        prefetch={false}
        className="absolute inset-0 rounded-lg focus:outline-none"
        aria-label={`${game.away.city} ${game.away.name} ${t("at")} ${game.home.city} ${game.home.name}`}
      />
    </article>
  );
}
