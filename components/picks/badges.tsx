import { Check, Minus, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Outcome, Tier } from "@/lib/site/types";

const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";

export function TierBadge({ tier }: { tier: Tier }) {
  const t = useTranslations("Tier");
  const style =
    tier === "strong"
      ? "bg-accent text-accent-foreground"
      : tier === "solid"
        ? "border border-accent text-foreground"
        : "border border-border text-muted-foreground";
  return (
    <span className={`${base} ${style}`} title={t("help")}>
      {t(tier)}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const t = useTranslations("Outcome");
  const Icon = outcome === "win" ? Check : outcome === "loss" ? X : Minus;
  const style =
    outcome === "win"
      ? "bg-accent/15 text-accent"
      : outcome === "loss"
        ? "bg-danger/15 text-danger"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`${base} ${style}`}>
      <Icon aria-hidden className="size-3" />
      {t(outcome)}
    </span>
  );
}

export function UpdatedBadge() {
  const t = useTranslations("Card");
  return (
    <span className={`${base} bg-muted text-foreground`}>
      <RefreshCw aria-hidden className="size-3" />
      {t("updated")}
    </span>
  );
}

/** Small team-color swatch: a neutral accent, never a logo. */
export function TeamSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-border"
      style={{ backgroundColor: color }}
    />
  );
}
