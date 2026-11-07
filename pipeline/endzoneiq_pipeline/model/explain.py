"""SHAP explanations (spec 7.4) mapped to human concepts.

LightGBM's `pred_contrib=True` returns exact TreeSHAP values (in log-odds of a
home win) for each feature plus a bias term; the linear Elo anchor adds its exact
per-feature terms on top. Features are grouped into concepts
fans recognise; the result (`shap_json`) is the ONLY factual input the AI
explanation step may use.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from endzoneiq_pipeline.model.features import WIN_FEATURES
from endzoneiq_pipeline.model.train import ANCHOR_FEATURES, ModelBundle

_RAW_CONCEPTS = [
    ("team_strength", "Overall team strength (Elo and point differential)", "elo_diff points_diff"),
    ("qb_change", "Quarterback change vs the usual starter", "qb_delta_diff"),
    ("efficiency", "Overall efficiency edge (EPA/play, success rate)", "epa_edge success_edge"),
    ("pass_matchup", "Passing offense vs pass defense", "pass_edge"),
    ("run_matchup", "Running game vs run defense", "rush_edge"),
    ("big_plays", "Explosive plays", "explosive_edge"),
    ("turnovers", "Turnover tendencies", "turnover_edge"),
    ("injuries", "Injuries (players ruled out)", "injury_diff"),
    (
        "rest",
        "Rest and schedule",
        "rest_diff home_short_week away_short_week home_off_bye away_off_bye",
    ),
    ("travel", "Travel and time zones", "travel_away_km travel_home_km tz_shift_away"),
    ("venue", "Venue (home field or neutral site)", "neutral"),
    ("rivalry", "Divisional game", "div_game"),
    ("playoffs", "Playoff game", "playoff"),
    ("weather", "Weather and roof", "indoor wind_kph temp_c"),
]
CONCEPTS: dict[str, tuple[str, list[str]]] = {
    key: (label, feats.split()) for key, label, feats in _RAW_CONCEPTS
}

_FEATURE_CONCEPT = {f: c for c, (_, feats) in CONCEPTS.items() for f in feats}
assert set(_FEATURE_CONCEPT) == set(WIN_FEATURES), "every win-model feature needs one concept"


def contributions(bundle: ModelBundle, df: pd.DataFrame) -> pd.DataFrame:
    """Per-feature contributions to the home-win log-odds, plus `bias`; they sum to
    bundle.win_logit(df). TreeSHAP for the boosted part; the linear Elo anchor's terms
    are exact contributions of elo_diff and neutral, its intercept joins the bias."""
    contrib = bundle.win.predict(df[WIN_FEATURES].to_numpy(dtype=float), pred_contrib=True)
    out = pd.DataFrame(contrib, columns=[*WIN_FEATURES, "bias"], index=df.index)
    anchor = bundle.anchors["win"]
    if anchor is not None:
        out["bias"] += anchor[0]
        for coef, feat in zip(anchor[1:], ANCHOR_FEATURES, strict=True):
            out[feat] += coef * df[feat].to_numpy(dtype=float)
    return out


def shap_json(
    contrib_row: pd.Series,
    feature_row: pd.Series,
    pick_home: bool,
    *,
    top_for: int = 3,
    top_against: int = 2,
) -> dict[str, Any]:
    """Drivers for one game, signed toward the picked team (positive = supports the pick)."""
    sign = 1.0 if pick_home else -1.0
    by_concept: dict[str, float] = {}
    for f in WIN_FEATURES:
        c = _FEATURE_CONCEPT[f]
        by_concept[c] = by_concept.get(c, 0.0) + sign * float(contrib_row[f])

    def driver(concept: str) -> dict[str, Any]:
        label, feats = CONCEPTS[concept]
        return {
            "concept": concept,
            "label": label,
            "impact": round(by_concept[concept], 4),
            "features": {
                f: (None if pd.isna(feature_row[f]) else round(float(feature_row[f]), 4))
                for f in feats
            },
        }

    ranked = sorted(by_concept, key=by_concept.__getitem__, reverse=True)
    pro = [c for c in ranked if by_concept[c] > 0][:top_for]
    con = [c for c in reversed(ranked) if by_concept[c] < 0][:top_against]
    return {
        "pick": "home" if pick_home else "away",
        "units": "log-odds toward the picked team",
        "base": round(sign * float(contrib_row["bias"]), 4),
        "for": [driver(c) for c in pro],
        "against": [driver(c) for c in con],
    }


def explain(bundle: ModelBundle, df: pd.DataFrame, win_prob: np.ndarray) -> list[dict[str, Any]]:
    contrib = contributions(bundle, df)
    return [
        shap_json(contrib.loc[idx], df.loc[idx], bool(p >= 0.5))
        for idx, p in zip(df.index, win_prob, strict=True)
    ]
