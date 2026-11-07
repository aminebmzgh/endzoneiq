import { useLocale, useTranslations } from "next-intl";
import { pct } from "@/lib/site/labels";

/**
 * Two-sided win probability bar: away on the left, home on the right, the picked
 * side in the accent color. Screen readers get both numbers.
 */
export function ProbabilityBar({
  homeProb,
  homeName,
  awayName,
  pickedSide,
}: {
  homeProb: number;
  homeName: string;
  awayName: string;
  pickedSide: "home" | "away";
}) {
  const t = useTranslations("Card");
  const locale = useLocale();
  const awayProb = 1 - homeProb;
  const label = t("probLabel", {
    home: homeName,
    homePct: pct(locale, homeProb),
    away: awayName,
    awayPct: pct(locale, awayProb),
  });
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-2 w-full overflow-hidden rounded-full bg-track"
    >
      <div
        className={pickedSide === "away" ? "bg-accent" : "bg-muted-foreground/40"}
        style={{ width: `${awayProb * 100}%` }}
      />
      <div className="w-0.5 bg-background" />
      <div
        className={pickedSide === "home" ? "bg-accent" : "bg-muted-foreground/40"}
        style={{ width: `${homeProb * 100}%` }}
      />
    </div>
  );
}
