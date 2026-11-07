"""LightGBM models (spec 7.1/7.3): home win, home margin, total points.

Elo is the backbone ("Elo baseline, then the LightGBM models"). For the win and
margin models, a linear Elo anchor (fitted on the training games: log-odds or
points from Elo difference and the neutral-site flag) is the starting score
(`init_score`), and LightGBM learns only the corrections: QB changes, injuries,
efficiency matchups, rest, travel, weather. On ~4k games this beats asking trees
to rebuild Elo's smooth curve from steps. The total model starts from the mean.

Fitting a bundle on seasons S:
1. Inner walk-forward over the last INNER_FOLDS seasons of S: each is predicted by
   a model (anchor + boosting) trained only on earlier seasons, with early
   stopping. The pooled out-of-fold predictions choose the round counts (median)
   and fit the Platt calibration and the residual sigmas.
2. Refit anchor and boosting on all of S with those round counts.

The public model never sees betting lines (spread_line/total_line are not features).
Strong regularisation and monotone constraints keep 4k games from being overfit.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.linear_model import LinearRegression, LogisticRegression

from endzoneiq_pipeline.model.features import FEATURES, MODEL_FEATURES

# +1: higher value can only help the home team; -1: can only hurt.
MONOTONE = {
    "elo_diff": 1,
    "qb_delta_diff": 1,
    "epa_edge": 1,
    "pass_edge": 1,
    "rush_edge": 1,
    "points_diff": 1,
    "injury_diff": -1,
}

BASE_PARAMS = {
    "learning_rate": 0.02,
    "num_leaves": 5,
    "min_data_in_leaf": 100,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 10.0,
    "verbose": -1,
    "seed": 7,
    "deterministic": True,
    "force_col_wise": True,
    "num_threads": 2,
}
MAX_ROUNDS = 3000
PATIENCE = 150
INNER_FOLDS = 3
MIN_ROUNDS = 10

ANCHOR_FEATURES = ["elo_diff", "neutral"]
SPECS = {  # model -> (objective, monotone, target, anchored)
    "win": ("binary", True, "home_win", True),
    "margin": ("regression", True, "margin", True),
    "total": ("regression", False, "total", False),
}

TIERS = [("strong", 0.68), ("solid", 0.58), ("lean", 0.0)]


def tier(win_prob_home: float) -> str:
    p = max(win_prob_home, 1.0 - win_prob_home)
    return next(name for name, cut in TIERS if p >= cut)


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def _x(df: pd.DataFrame, model: str) -> np.ndarray:
    return df[MODEL_FEATURES[model]].to_numpy(dtype=float)


def finished(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["margin"].notna()]


# -- Elo anchor -------------------------------------------------------------


def fit_anchor(frame: pd.DataFrame, model: str) -> list[float]:
    """[intercept, coef_elo_diff, coef_neutral]; win in log-odds, margin in points."""
    X = frame[ANCHOR_FEATURES].to_numpy(dtype=float)
    if model == "win":
        lr = LogisticRegression(C=1e6).fit(X, frame["home_win"].to_numpy())
        return [float(lr.intercept_[0]), *map(float, lr.coef_[0])]
    if model == "margin":
        lin = LinearRegression().fit(X, frame["margin"].to_numpy())
        return [float(lin.intercept_), *map(float, lin.coef_)]
    raise ValueError(model)


def anchor_score(df: pd.DataFrame, coefs: list[float] | None) -> np.ndarray:
    if coefs is None:
        return np.zeros(len(df))
    return coefs[0] + df[ANCHOR_FEATURES].to_numpy(dtype=float) @ np.asarray(coefs[1:])


# -- LightGBM ---------------------------------------------------------------


def _params(model: str) -> dict:
    objective, monotone, _, _ = SPECS[model]
    params = {**BASE_PARAMS, "objective": objective}
    if monotone:
        params["monotone_constraints"] = [MONOTONE.get(f, 0) for f in MODEL_FEATURES[model]]
        params["monotone_constraints_method"] = "advanced"
    return params


def _dataset(frame: pd.DataFrame, model: str, anchor: list[float] | None, reference=None):
    target = SPECS[model][2]
    f = frame[frame[target].notna()]
    init = anchor_score(f, anchor) if anchor is not None else None
    return (
        lgb.Dataset(
            _x(f, model),
            f[target].to_numpy(dtype=float),
            feature_name=MODEL_FEATURES[model],
            init_score=init,
            reference=reference,
            free_raw_data=False,
        ),
        f,
    )


def _train(model: str, frame: pd.DataFrame, anchor, rounds: int, valid=None) -> lgb.Booster:
    train, _ = _dataset(frame, model, anchor)
    if valid is None:
        return lgb.train(_params(model), train, num_boost_round=rounds)
    va, _ = _dataset(valid, model, anchor, reference=train)
    return lgb.train(
        _params(model),
        train,
        num_boost_round=rounds,
        valid_sets=[va],
        callbacks=[lgb.early_stopping(PATIENCE, verbose=False)],
    )


def _score(booster: lgb.Booster, df: pd.DataFrame, model: str, anchor, it=None) -> np.ndarray:
    """Anchor + boosted correction, in log-odds (win) or points (margin/total)."""
    raw = booster.predict(_x(df, model), raw_score=True, num_iteration=it)
    return anchor_score(df, anchor) + raw


@dataclass
class ModelBundle:
    win: lgb.Booster
    margin: lgb.Booster
    total: lgb.Booster
    anchors: dict[str, list[float] | None]
    platt: tuple[float, float]
    sigma_margin: float
    sigma_total: float
    meta: dict = field(default_factory=dict)

    # -- prediction ---------------------------------------------------------
    def win_logit(self, df: pd.DataFrame) -> np.ndarray:
        """Uncalibrated log-odds of a home win (Elo anchor + LightGBM)."""
        return _score(self.win, df, "win", self.anchors["win"])

    def raw_win(self, df: pd.DataFrame) -> np.ndarray:
        return _sigmoid(self.win_logit(df))

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        z = self.win_logit(df)
        a, b = self.platt
        p = _sigmoid(a * z + b)
        out = pd.DataFrame(index=df.index)
        out["win_prob_raw"] = _sigmoid(z)
        out["win_prob"] = p  # calibrated P(home wins)
        out["pred_margin"] = _score(self.margin, df, "margin", self.anchors["margin"])
        out["pred_total"] = _score(self.total, df, "total", self.anchors["total"])
        out["tier"] = [tier(x) for x in p]
        return out

    def cover_prob(self, pred_margin: np.ndarray, spread_line: np.ndarray) -> np.ndarray:
        """P(home margin > spread_line) under N(pred_margin, sigma_margin)."""
        return 1.0 - norm.cdf((spread_line - pred_margin) / self.sigma_margin)

    # -- persistence --------------------------------------------------------
    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        for name in SPECS:
            getattr(self, name).save_model(str(directory / f"{name}.txt"))
        meta = {
            **self.meta,
            "features": FEATURES,
            "model_features": MODEL_FEATURES,
            "anchor_features": ANCHOR_FEATURES,
            "anchors": self.anchors,
            "platt": list(self.platt),
            "sigma_margin": self.sigma_margin,
            "sigma_total": self.sigma_total,
            "tiers": {name: cut for name, cut in TIERS},
        }
        (directory / "model.json").write_text(json.dumps(meta, indent=2, default=str))

    @classmethod
    def load(cls, directory: Path) -> ModelBundle:
        meta = json.loads((directory / "model.json").read_text())
        if meta.get("model_features") != MODEL_FEATURES:
            raise ValueError("model was trained with a different feature list")
        if meta.get("anchor_features") != ANCHOR_FEATURES:
            raise ValueError("model was trained with a different Elo anchor")
        boosters = {n: lgb.Booster(model_file=str(directory / f"{n}.txt")) for n in SPECS}
        return cls(
            **boosters,
            anchors=meta["anchors"],
            platt=(meta["platt"][0], meta["platt"][1]),
            sigma_margin=meta["sigma_margin"],
            sigma_total=meta["sigma_total"],
            meta=meta,
        )


def _anchors(frame: pd.DataFrame) -> dict[str, list[float] | None]:
    wins = frame[frame["home_win"].notna()]
    return {"win": fit_anchor(wins, "win"), "margin": fit_anchor(frame, "margin"), "total": None}


def fit_bundle(df: pd.DataFrame, seasons: list[int]) -> ModelBundle:
    """Fit on the finished games of `seasons`."""
    data = finished(df[df["season"].isin(seasons)])
    ordered = sorted(set(int(x) for x in data["season"]))
    if len(ordered) < 2:
        raise ValueError(f"need at least two seasons with results, got {seasons}")
    # Inner walk-forward over the last INNER_FOLDS seasons: each is predicted by a model
    # trained only on the seasons before it. Their pooled out-of-fold predictions pick the
    # round counts and fit the calibration and sigmas (about 800 games, not one season).
    val_seasons = ordered[-min(INNER_FOLDS, len(ordered) - 1) :]

    best: dict[str, list[int]] = {name: [] for name in SPECS}
    oof: dict[str, tuple[list, list]] = {name: ([], []) for name in SPECS}
    for v in val_seasons:
        tr, va = data[data["season"] < v], data[data["season"] == v]
        anchors = _anchors(tr)
        for name in SPECS:
            booster = _train(name, tr, anchors[name], MAX_ROUNDS, valid=va)
            it = max(booster.best_iteration or MAX_ROUNDS, MIN_ROUNDS)
            best[name].append(it)
            target = SPECS[name][2]
            vf = va[va[target].notna()]
            oof[name][0].append(_score(booster, vf, name, anchors[name], it))
            oof[name][1].append(vf[target].to_numpy(dtype=float))
    rounds = {name: int(np.median(its)) for name, its in best.items()}
    pred = {name: (np.concatenate(p), np.concatenate(y)) for name, (p, y) in oof.items()}

    z_v, y_v = pred["win"]  # log-odds
    lr = LogisticRegression(C=1e6).fit(z_v.reshape(-1, 1), y_v)
    platt = (float(lr.coef_[0][0]), float(lr.intercept_[0]))
    sigma_margin = float(np.std(pred["margin"][1] - pred["margin"][0]))
    sigma_total = float(np.std(pred["total"][1] - pred["total"][0]))

    # Refit on all seasons; scale rounds by how much more data the final model sees.
    last_train = data[data["season"] < val_seasons[-1]]
    scale = len(data) / max(len(last_train), 1)
    anchors = _anchors(data)
    final = {
        name: _train(name, data, anchors[name], max(math.ceil(rounds[name] * scale), MIN_ROUNDS))
        for name in SPECS
    }
    return ModelBundle(
        **final,
        anchors=anchors,
        platt=platt,
        sigma_margin=sigma_margin,
        sigma_total=sigma_total,
        meta={
            "train_seasons": [min(seasons), max(seasons)],
            "train_games": len(data),
            "rounds": rounds,
            "calibration_games": len(y_v),
        },
    )
