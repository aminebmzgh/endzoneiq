# Model card: EndzoneIQ NFL game model (`lgbm-v1`)

_Last updated 2026-11-07. Code: `pipeline/endzoneiq_pipeline/model/`. Backtest numbers:
[backtest.md](backtest.md)._

## What it predicts

For every NFL game, from data available **before kickoff**:

| Output                                       | Model                                            | Used for                                                     |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `win_prob`: P(home team wins), calibrated    | Elo anchor + LightGBM (binary), Platt-calibrated | The pick and its confidence tier                             |
| `pred_spread`: expected home margin (points) | Elo anchor + LightGBM (regression)               | "Wins by about N"; cover probability via N(margin, σ ≈ 12.7) |
| `pred_total`: expected total points          | LightGBM (regression)                            | Projected score                                              |

Confidence tiers come from the calibrated probability of the picked team: **Lean**
50–58%, **Solid** 58–68%, **Strong** 68%+. In the backtest the tiers are well ordered and
honest: the picks were right 55% / 64% / 74% of the time.

It is a fan-analysis model, **not betting advice**. It never uses betting lines as inputs,
so it stays independent of the market. Against the closing spread it is at about 50% in the
backtest, which means no edge over the market.

## Design

- **Elo backbone.** Classic NFL Elo with K = 20 and a margin-of-victory multiplier
  (damped for favourites). Ratings regress a third of the way to the mean between seasons.
  Ratings run from 1999, so 2012 starts with real history.
- **Elo-anchored boosting.** For win and margin, a linear Elo anchor (log-odds or points
  from Elo difference plus a neutral-site flag, refit on each training set) is LightGBM's
  starting score (`init_score`). The trees only learn corrections. With about 4,000 games
  this works better than asking trees to rebuild Elo's smooth curve from steps.
- **Heavy regularisation:** 5 leaves, at least 100 games per leaf, L2 = 10, learning rate
  0.02, bagging. Monotone constraints: a better Elo, QB, EPA or point differential can
  only help a team, and more injuries can only hurt it.
- **Rounds, calibration and σ** come from an inner walk-forward over the last 3 training
  seasons (about 800 out-of-fold games), never from the test season.
- **Home field is learned**, not hardcoded: it's the anchor's intercept plus the neutral
  flag.

## Features (all strictly pre-kickoff)

Matchup "edges" are home minus away, so positive favours the home team.

| Concept (shown to fans)    | Features                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall team strength      | `elo_diff`, `points_diff` (decayed points for − against)                                                                                                         |
| Quarterback change         | `qb_delta_diff`: expected starter's EPA/dropback minus the usual starter's (shrunk toward a below-average prior), for each side                                  |
| Efficiency                 | `epa_edge`, `success_edge`: offense vs opposing defense, EPA/play and success rate                                                                               |
| Pass / run matchups        | `pass_edge`, `rush_edge`                                                                                                                                         |
| Explosive plays            | `explosive_edge` (20+ yard passes, 10+ yard runs)                                                                                                                |
| Turnovers                  | `turnover_edge`: forced minus committed per play, heavily regressed                                                                                              |
| Injuries                   | `injury_diff`: players ruled Out (1.0) or Doubtful (0.75), weighted by position (OT, edge, CB 1.0 … K 0.3). QBs are left out here because `qb_delta` covers them |
| Rest                       | rest-day difference, short week (≤ 5 days), coming off a bye (≥ 13 days)                                                                                         |
| Travel                     | distance from each team's home stadium to the venue; time zones crossed                                                                                          |
| Venue / rivalry / playoffs | neutral site, divisional game, postseason                                                                                                                        |
| Weather                    | indoor (dome or closed roof), wind (km/h), temperature (°C)                                                                                                      |
| Totals only                | combined offense/defense EPA, pace, points for/against. These say how many points both teams score, not who wins, so the win and margin models don't use them    |

**Rolling team stats** are exponentially decayed sums (×0.92 per game; 40% of last season
carries over) shrunk toward the previous season's league mean with a prior worth 200–2,000
plays. That means early-season numbers lean on the league average.

**No look-ahead.** Games are processed in kickoff order. A result only becomes data 4 hours
after its kickoff, and injury report rows stamped after kickoff are ignored. Every feature
row carries `data_asof`. The training and backtest jobs refuse to run if any row has
`data_asof >= kickoff`. Unit tests (`pipeline/tests/test_model_leakage.py`) also check that
changing future results never changes past features, and that games kicking off at the
same time never see each other.

## Training data and window

- nflverse schedules (1999+, for Elo), play-by-play aggregated to team-game and QB-game
  totals (2011+), and weekly injury reports (2011+). Raw play-by-play never leaves the
  GitHub runner.
- Trains on every finished regular-season and postseason game from **2012** to the latest
  data. 3,951 games as of 2026-11-06. Ties are excluded from the win model only.
- Models are LightGBM text files plus `model.json`, about 0.5 MB. They're published as
  GitHub Releases (`model-<name>`) and registered via `/api/internal/ingest/model-version`.
  The name is a hash of the training data and settings, so retraining on the same data is a
  no-op.

## Evaluation (walk-forward, test seasons 2015–2026)

|                                                              | Log loss   | Brier      | Accuracy  |
| ------------------------------------------------------------ | ---------- | ---------- | --------- |
| **Model**                                                    | **0.6334** | **0.2212** | **64.9%** |
| Elo only (logistic on Elo diff + neutral, refit each season) | 0.6368     | 0.2229     | 63.7%     |
| Home team always                                             | 0.6892     | 0.2480     | 54.9%     |
| Market favourite (reference only)                            | 0.6145     | 0.2131     | 66.1%     |

The model beats the Elo-only baseline on log loss, Brier and accuracy. **The margin is
small:** the paired 95% bootstrap interval for the per-game log-loss difference is
[−0.0064, −0.0003]: it excludes zero, but only just. It has the lower log loss in 7 of 12
test seasons, with its clearest gains in 2020 and 2023–2026. The betting market remains clearly
better (as expected: closing lines carry information such as late injury news and expert
judgment that free data doesn't).

### How the design was reached (all runs on the same test seasons)

Hyperparameters were not grid-searched. The design changed four times after looking at
backtest results, and run 5 fixed a data bug. Every run is listed here, so no result is cherry-picked:

| Run | Change                                                                                                                                | Model log loss (Elo 0.6368) |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | LightGBM on all features; calibration and round count from one held-out season                                                        | 0.6387                      |
| 2   | Calibration and rounds pooled over 3 inner seasons; 5 leaves / 100 per leaf                                                           | 0.6358                      |
| 3   | Symmetric "scoring environment" features moved to the totals model only (they produced meaningless "reasons" for a winner)            | 0.6382                      |
| 4   | Elo-anchored boosting (`init_score`), kept the run-3 feature split                                                                    | 0.6339                      |
| 5   | **Bug fix:** nflverse injury rows have no timestamp from 2025 on and were all being dropped; undated reports now count (see Injuries) | **0.6334**                  |

Because these choices were made while looking at the same seasons, treat the reported edge
over Elo as optimistic. The 2026 season to date is the closest thing to an untouched
holdout; it shows 0.6298 vs 0.6468 over 121 games (0.6374 before the run-5 fix). New weeks will be tracked publicly
through the hash-chained track record.

## Explanations

Each prediction carries `shap_json`:

- exact TreeSHAP values from LightGBM (`pred_contrib`), plus the Elo anchor's exact linear
  terms;
- grouped into the concepts above and signed toward the picked team;
- the top 3 supporting drivers and top 2 opposing ones;
- home-field advantage (the Elo anchor's intercept at non-neutral venues) as its own
  driver;
- never a factor at its neutral value (no QB change, equal injuries, not divisional, no
  weather data). SHAP measures against an average game, so such factors get small
  contributions that would read as misleading reasons. Their effect stays in `base`.

This is the **only** factual input the AI explanation step may use (Phase 3). Share of
average |contribution| for the current model on 2024–2026 games: team strength 57%, QB
change 9%, turnovers 6%, injuries 6%, efficiency 5%, travel 5%, weather 3%, big plays 3%,
others ≤ 2% each.

## Known limitations

- **Small edge over Elo.** Most of the signal is team strength. Free data lags real news;
  admin injury overrides (Phase 7) are meant to close part of that gap.
- **Injuries** are weighted by position only, not by player quality, so losing a backup
  CB counts the same as losing a starter. nflverse injury rows have no `date_modified` from
  2025 on. Undated Out/Doubtful statuses come from the final pre-game report, so they are
  treated as published 24 hours before kickoff; rows that do carry a timestamp after
  kickoff are still ignored. Players on IR aren't on reports and are only
  captured indirectly, through team stats.
- **The QB starter** for past games is the one who actually started. That is known before
  kickoff in practice, but late surprise changes are counted as known. For upcoming games
  it is nflverse's projected starter, and admins can override it.
- **Weather** in training uses nflverse's game-day temperature and wind. There is no
  precipitation, because no historical source is free. Upcoming games need forecasts
  (Open-Meteo, Phase 7). Until then those values are missing, which LightGBM handles but
  which removes the weather signal.
- **Neutral sites** (international games) are rare, so the model barely uses the neutral
  flag and leans on travel distance instead. Treat international-game picks with extra
  caution.
- **Weeks 1–2** lean on last season's ratings and league-average priors, so expect
  lower accuracy early in the season.
- **The market reference** uses the closing spread converted with σ = 13.5 points, and is
  only for comparison.

## Retraining

`.github/workflows/retrain.yml`:

- **Manual runs** always retrain and publish a release. They can also rerun the backtest.
- **The weekly schedule** (Tuesday) retrains only in the offseason. During the season, Elo
  and rolling stats change but they are computed at prediction time, so the trained
  weights don't need to.

To regenerate the backtest locally:

```bash
cd pipeline && uv run python -m endzoneiq_pipeline.jobs.backtest --out ../docs/backtest.md
```
