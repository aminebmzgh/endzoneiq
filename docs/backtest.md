# Backtest report

_Generated 2026-11-07 by `python -m endzoneiq_pipeline.jobs.backtest`. Data: nflverse through 2026-11-06._

Walk-forward validation: every test season is predicted by models trained only on
earlier seasons (2012 through the season before). Test seasons: 2015–2026 (3139 games, ties excluded). Features are built strictly
from data available before kickoff (see the leakage tests).

## Headline

|                                              | Log loss ↓ | Brier ↓ | Accuracy |
| -------------------------------------------- | ---------- | ------- | -------- |
| **EndzoneIQ model** (LightGBM, calibrated)   | 0.6339     | 0.2215  | 64.8%    |
| Model before calibration                     | 0.6338     | 0.2214  | 64.2%    |
| Elo only (baseline)                          | 0.6368     | 0.2229  | 63.7%    |
| Home team always (baseline)                  | 0.6892     | 0.2480  | 54.9%    |
| Market favourite (reference, closing spread) | 0.6145     | 0.2131  | 66.1%    |

**Beats the Elo-only baseline on log loss: yes** (0.6339 vs 0.6368).

- Paired difference per game (model − Elo): -0.0029, 95% bootstrap interval [-0.0058, +0.0002] (includes zero: not conclusive). The model has the lower log loss in 7 of 12 test seasons.
- Against the spread (model margin vs closing line, pushes excluded): 49.5% over 3058 games. Break-even at standard prices is about 52.4%; this is a measurement, not betting advice.
- Mean absolute error: margin 10.21 pts, total 10.75 pts.

## By season

| Season         | Games | Model LL | Elo LL | Home LL | Model acc | Elo acc | Market acc | ATS   |
| -------------- | ----- | -------- | ------ | ------- | --------- | ------- | ---------- | ----- |
| 2015           | 267   | 0.6561   | 0.6529 | 0.6945  | 64.8%     | 65.5%   | 62.9%      | 55.6% |
| 2016           | 265   | 0.6263   | 0.6252 | 0.6787  | 64.5%     | 64.2%   | 64.9%      | 47.3% |
| 2017           | 267   | 0.6197   | 0.6219 | 0.6822  | 66.7%     | 64.8%   | 69.3%      | 50.6% |
| 2018           | 265   | 0.6317   | 0.6331 | 0.6739  | 62.6%     | 62.6%   | 65.7%      | 51.2% |
| 2019           | 266   | 0.6424   | 0.6415 | 0.6986  | 63.9%     | 63.2%   | 64.3%      | 47.3% |
| 2020           | 268   | 0.6109   | 0.6251 | 0.7028  | 66.8%     | 66.4%   | 67.2%      | 51.1% |
| 2021           | 284   | 0.6589   | 0.6580 | 0.6980  | 60.9%     | 60.2%   | 62.3%      | 49.3% |
| 2022           | 282   | 0.6399   | 0.6343 | 0.6827  | 64.5%     | 63.8%   | 66.3%      | 48.2% |
| 2023           | 285   | 0.6477   | 0.6576 | 0.6846  | 62.8%     | 60.4%   | 67.4%      | 46.5% |
| 2024           | 285   | 0.6074   | 0.6144 | 0.6919  | 70.2%     | 66.3%   | 70.5%      | 49.1% |
| 2025           | 284   | 0.6298   | 0.6356 | 0.6917  | 65.5%     | 64.4%   | 65.8%      | 48.8% |
| 2026 (to date) | 121   | 0.6374   | 0.6468 | 0.6929  | 64.5%     | 61.2%   | 66.1%      | 49.6% |

## Calibration (all test games)

| Predicted home win | Games | Mean predicted | Observed |
| ------------------ | ----- | -------------- | -------- |
| 0.1–0.2            | 48    | 16.9%          | 35.4%    |
| 0.2–0.3            | 188   | 25.5%          | 25.5%    |
| 0.3–0.4            | 404   | 35.2%          | 33.2%    |
| 0.4–0.5            | 552   | 45.1%          | 43.5%    |
| 0.5–0.6            | 640   | 55.1%          | 56.2%    |
| 0.6–0.7            | 657   | 64.8%          | 64.7%    |
| 0.7–0.8            | 437   | 74.6%          | 72.3%    |
| 0.8–0.9            | 200   | 84.0%          | 84.5%    |
| 0.9–1.0            | 13    | 91.5%          | 92.3%    |

## Confidence tiers

| Tier   | Games | Mean confidence | Pick accuracy |
| ------ | ----- | --------------- | ------------- |
| Lean   | 945   | 53.9%           | 55.0%         |
| Solid  | 1123  | 62.8%           | 64.4%         |
| Strong | 1071  | 76.0%           | 73.9%         |

Tiers: Lean 50–58%, Solid 58–68%, Strong 68%+ (calibrated probability of the picked team).
