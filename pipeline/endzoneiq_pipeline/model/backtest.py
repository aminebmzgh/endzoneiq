"""Walk-forward backtest (spec 7.3): for each test season N, train on 2012..N-1 only.

Baselines, all fitted on the same training seasons:
- home:   always pick the home team; probability = training home-win rate (non-neutral)
- elo:    logistic regression on Elo difference and neutral-site flag ("Elo only")
- market: closing spread converted to a probability (reference only; the public
          model never uses betting lines)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.linear_model import LogisticRegression

from endzoneiq_pipeline.model.train import finished, fit_bundle

log = logging.getLogger(__name__)

FIRST_TEST_SEASON = 2015
MARKET_SIGMA = 13.5  # points; converts a spread into a win probability


def log_loss(y: np.ndarray, p: np.ndarray) -> float:
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def brier(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


def accuracy(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p > 0.5) == (y == 1)))


def ats(margin: np.ndarray, pred_margin: np.ndarray, spread: np.ndarray) -> tuple[float, int]:
    """Against the spread: pick the side the model's margin favours vs the closing line.
    spread_line > 0 means home favoured; home covers if margin > spread. Pushes excluded."""
    ok = ~np.isnan(spread) & (margin != spread) & (pred_margin != spread)
    if not ok.any():
        return float("nan"), 0
    pick_home = pred_margin[ok] > spread[ok]
    home_cover = margin[ok] > spread[ok]
    return float(np.mean(pick_home == home_cover)), int(ok.sum())


@dataclass
class SeasonResult:
    season: int
    frame: pd.DataFrame  # test games with y, model and baseline probabilities


def walk_forward(features: pd.DataFrame, test_seasons: list[int]) -> list[SeasonResult]:
    results = []
    for season in test_seasons:
        train_seasons = sorted(s for s in features["season"].unique() if s < season)
        test = finished(features[features["season"] == season])
        test = test[test["home_win"].notna()]
        if test.empty or len(train_seasons) < 3:
            continue
        bundle = fit_bundle(features, train_seasons)
        pred = bundle.predict(test)

        train = finished(features[features["season"].isin(train_seasons)])
        train = train[train["home_win"].notna()]
        home_rate = train.loc[train["neutral"] == 0, "home_win"].mean()
        elo_lr = LogisticRegression(C=1e6).fit(
            train[["elo_diff", "neutral"]].to_numpy(), train["home_win"].to_numpy()
        )

        frame = test[["game_id", "season", "week", "game_type", "home_team", "away_team"]].copy()
        frame["y"] = test["home_win"].to_numpy()
        frame["margin"] = test["margin"].to_numpy()
        frame["total"] = test["total"].to_numpy()
        frame["spread_line"] = test["spread_line"].to_numpy()
        frame["total_line"] = test["total_line"].to_numpy()
        frame["p_model"] = pred["win_prob"].to_numpy()
        frame["p_raw"] = pred["win_prob_raw"].to_numpy()
        frame["tier"] = pred["tier"].to_numpy()
        frame["pred_margin"] = pred["pred_margin"].to_numpy()
        frame["pred_total"] = pred["pred_total"].to_numpy()
        frame["p_home"] = np.where(test["neutral"] == 1, 0.5, home_rate)
        frame["p_elo"] = elo_lr.predict_proba(test[["elo_diff", "neutral"]].to_numpy())[:, 1]
        frame["p_market"] = norm.cdf(test["spread_line"].to_numpy() / MARKET_SIGMA)
        frame["sigma_margin"] = bundle.sigma_margin
        results.append(SeasonResult(season, frame))
        log.info(
            "%s: model %.4f vs elo %.4f log loss (%s games)",
            season,
            log_loss(frame["y"].to_numpy(), frame["p_model"].to_numpy()),
            log_loss(frame["y"].to_numpy(), frame["p_elo"].to_numpy()),
            len(frame),
        )
    return results


def summarize(frame: pd.DataFrame) -> dict:
    y = frame["y"].to_numpy()
    out = {"games": len(frame)}
    for name in ("model", "raw", "elo", "home", "market"):
        p = frame[f"p_{name}"].to_numpy()
        ok = ~np.isnan(p)
        out[name] = {
            "log_loss": log_loss(y[ok], p[ok]),
            "brier": brier(y[ok], p[ok]),
            "accuracy": accuracy(y[ok], p[ok]),
            "games": int(ok.sum()),
        }
    ats_pct, ats_n = ats(
        frame["margin"].to_numpy(), frame["pred_margin"].to_numpy(), frame["spread_line"].to_numpy()
    )
    out["ats"] = {"pct": ats_pct, "games": ats_n}
    out["margin_mae"] = float(np.mean(np.abs(frame["margin"] - frame["pred_margin"])))
    out["total_mae"] = float(np.mean(np.abs(frame["total"] - frame["pred_total"])))
    return out


def paired_bootstrap(
    frame: pd.DataFrame, a: str, b: str, n: int = 2000
) -> tuple[float, float, float]:
    """Mean per-game log-loss difference (a - b) and a 95% CI, resampling games."""
    y = frame["y"].to_numpy()

    def per_game(p: np.ndarray) -> np.ndarray:
        p = np.clip(p, 1e-12, 1 - 1e-12)
        return -(y * np.log(p) + (1 - y) * np.log(1 - p))

    d = per_game(frame[f"p_{a}"].to_numpy()) - per_game(frame[f"p_{b}"].to_numpy())
    rng = np.random.default_rng(2012)
    means = d[rng.integers(0, len(d), size=(n, len(d)))].mean(axis=1)
    return float(d.mean()), float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))


def calibration_table(frame: pd.DataFrame, bins: int = 10) -> pd.DataFrame:
    edges = np.linspace(0, 1, bins + 1)
    b = np.clip(np.digitize(frame["p_model"], edges) - 1, 0, bins - 1)
    g = frame.assign(bin=b).groupby("bin")
    return pd.DataFrame(
        {
            "range": [f"{edges[i]:.1f}–{edges[i + 1]:.1f}" for i in g.size().index],
            "games": g.size().to_numpy(),
            "predicted": g["p_model"].mean().to_numpy(),
            "observed": g["y"].mean().to_numpy(),
        }
    )


def tier_table(frame: pd.DataFrame) -> pd.DataFrame:
    pick_home = frame["p_model"] > 0.5
    correct = pick_home == (frame["y"] == 1)
    g = frame.assign(correct=correct, conf=np.maximum(frame["p_model"], 1 - frame["p_model"]))
    t = g.groupby("tier").agg(
        games=("y", "size"), accuracy=("correct", "mean"), conf=("conf", "mean")
    )
    return t.reindex(["lean", "solid", "strong"]).dropna(how="all")


def render_markdown(results: list[SeasonResult], generated: str, data_note: str) -> str:
    allf = pd.concat([r.frame for r in results], ignore_index=True)
    total = summarize(allf)
    seasons = [r.season for r in results]
    beats = total["model"]["log_loss"] < total["elo"]["log_loss"]
    diff, lo, hi = paired_bootstrap(allf, "model", "elo")
    season_wins = sum(
        summarize(r.frame)["model"]["log_loss"] < summarize(r.frame)["elo"]["log_loss"]
        for r in results
    )

    lines = [
        "# Backtest report",
        "",
        f"_Generated {generated} by `python -m endzoneiq_pipeline.jobs.backtest`. {data_note}_",
        "",
        "Walk-forward validation: every test season is predicted by models trained only on",
        f"earlier seasons (2012 through the season before). Test seasons: {seasons[0]}–"
        f"{seasons[-1]} ({total['games']} games, ties excluded). Features are built strictly",
        "from data available before kickoff (see the leakage tests).",
        "",
        "## Headline",
        "",
        "| | Log loss ↓ | Brier ↓ | Accuracy |",
        "|---|---|---|---|",
    ]
    names = {
        "model": "**EndzoneIQ model** (LightGBM, calibrated)",
        "raw": "Model before calibration",
        "elo": "Elo only (baseline)",
        "home": "Home team always (baseline)",
        "market": "Market favourite (reference, closing spread)",
    }
    for key, label in names.items():
        m = total[key]
        lines.append(f"| {label} | {m['log_loss']:.4f} | {m['brier']:.4f} | {m['accuracy']:.1%} |")
    lines += [
        "",
        f"**Beats the Elo-only baseline on log loss: {'yes' if beats else 'NO'}** "
        f"({total['model']['log_loss']:.4f} vs {total['elo']['log_loss']:.4f}).",
        "",
        f"- Paired difference per game (model − Elo): {diff:+.4f}, 95% bootstrap interval "
        f"[{lo:+.4f}, {hi:+.4f}]"
        + (" (excludes zero)." if hi < 0 else " (includes zero: not conclusive).")
        + f" The model has the lower log loss in {season_wins} of {len(results)} test seasons.",
        f"- Against the spread (model margin vs closing line, pushes excluded): "
        f"{total['ats']['pct']:.1%} over {total['ats']['games']} games. Break-even at standard "
        "prices is about 52.4%; this is a measurement, not betting advice.",
        f"- Mean absolute error: margin {total['margin_mae']:.2f} pts, total "
        f"{total['total_mae']:.2f} pts.",
        "",
        "## By season",
        "",
        "| Season | Games | Model LL | Elo LL | Home LL | Model acc | Elo acc | Market acc | ATS |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        s = summarize(r.frame)
        label = f"{r.season}" + (" (to date)" if r.season == seasons[-1] else "")
        lines.append(
            f"| {label} | {s['games']} | {s['model']['log_loss']:.4f} | {s['elo']['log_loss']:.4f} "
            f"| {s['home']['log_loss']:.4f} | {s['model']['accuracy']:.1%} "
            f"| {s['elo']['accuracy']:.1%} | {s['market']['accuracy']:.1%} "
            f"| {s['ats']['pct']:.1%} |"
        )
    lines += [
        "",
        "## Calibration (all test games)",
        "",
        "| Predicted home win | Games | Mean predicted | Observed |",
        "|---|---|---|---|",
    ]
    for row in calibration_table(allf).itertuples(index=False):
        lines.append(f"| {row.range} | {row.games} | {row.predicted:.1%} | {row.observed:.1%} |")
    lines += [
        "",
        "## Confidence tiers",
        "",
        "| Tier | Games | Mean confidence | Pick accuracy |",
        "|---|---|---|---|",
    ]
    for name, row in tier_table(allf).iterrows():
        lines.append(f"| {name.title()} | {int(row.games)} | {row.conf:.1%} | {row.accuracy:.1%} |")
    lines += [
        "",
        "Tiers: Lean 50–58%, Solid 58–68%, Strong 68%+ "
        "(calibrated probability of the picked team).",
        "",
    ]
    return "\n".join(lines)
