"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Outcome, RecordRow } from "@/lib/site/types";

const PAGE = 100;
type ResultFilter = "all" | Outcome | "pending";

const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-sm";

/** Labels translated on the server (no message catalog in the browser). */
export interface RecordTableLabels {
  filterSeason: string;
  filterTeam: string;
  filterResult: string;
  all: string;
  /** Template with {shown} and {total}. */
  showing: string;
  noRows: string;
  colWeek: string;
  colGame: string;
  colPick: string;
  colProb: string;
  colScore: string;
  colResult: string;
  outcome: Record<Outcome | "pending", string>;
}

/** Every published pick with its result, filterable (spec 11.3). */
export function RecordTable({
  rows,
  labels,
  locale,
}: {
  rows: RecordRow[];
  labels: RecordTableLabels;
  locale: string;
}) {
  const t = (key: Exclude<keyof RecordTableLabels, "outcome">) => labels[key];
  const to = (key: Outcome | "pending") => labels.outcome[key];
  const seasons = useMemo(() => [...new Set(rows.map((r) => r.season))], [rows]);
  const teams = useMemo(() => [...new Set(rows.flatMap((r) => [r.home, r.away]))].sort(), [rows]);
  const [season, setSeason] = useState<string>(seasons[0] ? String(seasons[0]) : "all");
  const [team, setTeam] = useState("all");
  const [result, setResult] = useState<ResultFilter>("all");
  const [limit, setLimit] = useState(PAGE);

  const filtered = rows.filter(
    (r) =>
      (season === "all" || r.season === Number(season)) &&
      (team === "all" || r.home === team || r.away === team) &&
      (result === "all" || (result === "pending" ? r.outcome === null : r.outcome === result)),
  );
  const shown = filtered.slice(0, limit);
  const pctFmt = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filterSeason")}
          <select
            className={selectClass}
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            <option value="all">{t("all")}</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filterTeam")}
          <select className={selectClass} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">{t("all")}</option>
            {teams.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filterResult")}
          <select
            className={selectClass}
            value={result}
            onChange={(e) => setResult(e.target.value as ResultFilter)}
          >
            <option value="all">{t("all")}</option>
            <option value="win">{to("win")}</option>
            <option value="loss">{to("loss")}</option>
            <option value="tie">{to("tie")}</option>
            <option value="pending">{to("pending")}</option>
          </select>
        </label>
      </div>

      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {labels.showing
          .replace("{shown}", String(shown.length))
          .replace("{total}", String(filtered.length))}
      </p>

      {filtered.length === 0 ? (
        <p className="mt-4 text-muted-foreground">{t("noRows")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("colWeek")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("colGame")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("colPick")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colProb")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colScore")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("colResult")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.gameId} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                    {r.season} · {r.gameType === "REG" ? r.week : r.gameType}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/${locale}/game/${r.slug}`}
                      prefetch={false}
                      className="hover:underline"
                    >
                      {r.away} @ {r.home}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-medium">{r.winner}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pctFmt.format(r.winProb)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {r.homeScore !== null && r.awayScore !== null
                      ? `${r.awayScore}–${r.homeScore}`
                      : "–"}
                  </td>
                  <td
                    className={`px-3 py-2 whitespace-nowrap ${
                      r.outcome === "win"
                        ? "text-accent"
                        : r.outcome === "loss"
                          ? "text-danger"
                          : "text-muted-foreground"
                    }`}
                  >
                    {to(r.outcome ?? "pending")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="mt-3 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          +{Math.min(PAGE, filtered.length - limit)}
        </button>
      )}
    </div>
  );
}
