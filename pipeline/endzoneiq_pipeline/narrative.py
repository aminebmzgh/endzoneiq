"""Pick explanations (spec 10.1): facts, validation, and the template fallback.

Flow per pick: build `facts` (game, prediction, SHAP drivers, injuries, weather),
ask Claude for English then French and Spanish (narrative_claude.py), validate
every answer here, and fall back to templates built from the top SHAP drivers
when the API fails or an answer doesn't pass validation.

Validation is deliberately strict because explanations are public:
- exactly 3 reasons of at most 20 words, 1-3 matchup notes, a short headline;
- no betting or guarantee language (EN/FR/ES);
- grounding: every number in the text must appear in the facts (rounding allowed).
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from pydantic import BaseModel, field_validator

from endzoneiq_pipeline import reference

Locale = Literal["en", "fr", "es"]
LOCALES: tuple[Locale, ...] = ("en", "fr", "es")

MAX_REASON_WORDS = 20
MAX_NOTE_WORDS = 30
MAX_HEADLINE_CHARS = 120


class ExplanationDraft(BaseModel):
    """Shape requested from Claude (structured output). Checked again by Explanation."""

    headline: str
    reasons: list[str]
    matchup_notes: list[str]


class Explanation(BaseModel):
    headline: str
    reasons: list[str]
    matchup_notes: list[str]

    @field_validator("headline")
    @classmethod
    def _headline(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > MAX_HEADLINE_CHARS:
            raise ValueError(f"headline must be 1-{MAX_HEADLINE_CHARS} characters")
        return v

    @field_validator("reasons")
    @classmethod
    def _reasons(cls, v: list[str]) -> list[str]:
        v = [r.strip() for r in v]
        if len(v) != 3:
            raise ValueError("exactly 3 reasons are required")
        for r in v:
            if not r or len(r.split()) > MAX_REASON_WORDS:
                raise ValueError(f"each reason must be 1-{MAX_REASON_WORDS} words: {r!r}")
        return v

    @field_validator("matchup_notes")
    @classmethod
    def _notes(cls, v: list[str]) -> list[str]:
        v = [n.strip() for n in v if n.strip()]
        if not 1 <= len(v) <= 3:
            raise ValueError("1-3 matchup notes are required")
        for n in v:
            if len(n.split()) > MAX_NOTE_WORDS:
                raise ValueError(f"each matchup note must be at most {MAX_NOTE_WORDS} words")
        return v

    def texts(self) -> list[str]:
        return [self.headline, *self.reasons, *self.matchup_notes]

    def to_api(self) -> dict[str, Any]:
        return {
            "headline": self.headline,
            "reasons": self.reasons,
            "matchupNotes": self.matchup_notes,
        }


# --- Facts ------------------------------------------------------------------

GAME_LABEL = {"WC": "Wild Card round", "DIV": "Divisional round", "CON": "Conference championship", "SB": "Super Bowl"}  # fmt: skip

# feature -> (fact key, scale, decimals). Edge features are home-minus-away and are
# re-signed toward the picked team; "home_/away_" features become "pick_/opponent_".
EDGE_FACTS = {
    "elo_diff": ("elo_rating_advantage_points", 1, 0),
    "points_diff": ("point_differential_advantage_per_game", 1, 1),
    "qb_delta_diff": ("qb_change_impact_epa_per_dropback", 1, 3),
    "epa_edge": ("efficiency_edge_epa_per_play", 1, 3),
    "success_edge": ("success_rate_edge_pct_points", 100, 1),
    "pass_edge": ("pass_matchup_edge_epa_per_play", 1, 3),
    "rush_edge": ("run_matchup_edge_epa_per_play", 1, 3),
    "explosive_edge": ("explosive_play_rate_edge_pct_points", 100, 1),
    "turnover_edge": ("turnover_rate_edge_pct_points", 100, 2),
    "injury_diff": ("injury_load_pick_minus_opponent_lower_is_better", 1, 2),
    "rest_diff": ("rest_days_advantage", 1, 0),
}
SIDE_FACTS = {
    "short_week": "short_week",
    "off_bye": "coming_off_bye",
}


def _r(v: float, decimals: int) -> float | int | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return round(v) if decimals == 0 else round(float(v), decimals)


def driver_evidence(
    features: dict[str, float], feats: list[str], pick_home: bool
) -> dict[str, Any]:
    """Feature values for one SHAP driver, oriented toward the picked team."""
    sign = 1.0 if pick_home else -1.0
    out: dict[str, Any] = {}
    for f in feats:
        v = features.get(f)
        if f in EDGE_FACTS:
            key, scale, dec = EDGE_FACTS[f]
            out[key] = _r(sign * v * scale if v is not None else None, dec)
        elif f.startswith(("home_", "away_")):
            side, rest = f.split("_", 1)
            who = "pick" if (side == "home") == pick_home else "opponent"
            out[f"{who}_{SIDE_FACTS.get(rest, rest)}"] = bool(v)
        elif f in ("travel_away_km", "travel_home_km"):
            who = "pick" if (f == "travel_home_km") == pick_home else "opponent"
            out[f"{who}_travel_km"] = _r(v, 0)
        elif f == "tz_shift_away":
            out["time_zones_crossed_by_away_team"] = _r(abs(v) if v is not None else None, 0)
        elif f in ("neutral", "div_game", "playoff", "indoor"):
            out[{"div_game": "divisional_game", "playoff": "playoff_game"}.get(f, f)] = bool(v)
        elif f == "wind_kph":
            out["wind_kph"] = _r(v, 0)
        elif f == "temp_c":
            out["temperature_c"] = _r(v, 0)
    return out


def plausible(concept: str, evidence: dict[str, Any], helps_pick: bool) -> bool:
    """False when a driver's direction contradicts its own evidence, e.g. the model
    credits the pick for travelling farther. Such a reason can't be explained honestly
    in plain words, so it is left out of the text (the stored SHAP is unchanged)."""

    def favours_pick(v: float | None, lower_is_better: bool = False) -> bool | None:
        if v is None or v == 0:
            return None
        return (v < 0) if lower_is_better else (v > 0)

    if concept == "travel":
        mine, theirs = evidence.get("pick_travel_km"), evidence.get("opponent_travel_km")
        if mine is None or theirs is None:
            return True
        good = favours_pick(mine - theirs, lower_is_better=True)
    elif concept == "injuries":
        good = favours_pick(
            evidence.get("injury_load_pick_minus_opponent_lower_is_better"), lower_is_better=True
        )
    elif concept == "rest":
        good = favours_pick(evidence.get("rest_days_advantage"))
    else:
        return True
    return good is None or good == helps_pick


def build_facts(
    game: dict[str, Any],
    prediction: dict[str, Any],
    shap: dict[str, Any],
    features: dict[str, float],
    injuries: dict[str, list[dict[str, str]]] | None = None,
) -> dict[str, Any]:
    """Everything the explanation may say, as plain JSON. Nothing else is allowed."""
    home, away = game["home_team"], game["away_team"]
    pick_home = shap["pick"] == "home"
    pick, opp = (home, away) if pick_home else (away, home)
    win_prob_pick = prediction["win_prob"] if pick_home else 1 - prediction["win_prob"]
    margin_pick = prediction["pred_margin"] if pick_home else -prediction["pred_margin"]
    teams = reference.teams()

    def team(abbr: str) -> dict[str, str]:
        return {"abbr": abbr, "name": f"{teams[abbr]['city']} {teams[abbr]['name']}", "nickname": teams[abbr]["name"]}  # fmt: skip

    def drivers(items: list[dict], helps_pick: bool) -> list[dict[str, Any]]:
        out = []
        for d in items:
            evidence = driver_evidence(features, list(d["features"]), pick_home)
            if not plausible(d["concept"], evidence, helps_pick):
                continue
            out.append(
                {
                    "concept": d["concept"],
                    "label": d["label"],
                    "strength": "major" if abs(d["impact"]) >= 0.15 else "minor",
                    "evidence": evidence,
                }
            )
        return out

    venue = reference.stadiums().get(game.get("stadium_id") or "", {})
    gt = game.get("game_type", "REG")
    return {
        "game": {
            "season": int(game["season"]),
            "round": f"Week {int(game['week'])}" if gt == "REG" else GAME_LABEL[gt],
            "home": team(home),
            "away": team(away),
            "venue": venue.get("name"),
            "neutral_site": bool(features.get("neutral")),
            "home_qb": game.get("home_qb_name"),
            "away_qb": game.get("away_qb_name"),
        },
        "prediction": {
            "pick": team(pick),
            "opponent": team(opp),
            "win_probability_pct": round(win_prob_pick * 100),
            "confidence_tier": prediction["tier"],
            "projected_margin_pts": round(margin_pick, 1),
            "projected_total_pts": round(prediction["pred_total"], 1),
            "note": "Model estimates, not certainties.",
        },
        "drivers_for_pick": drivers(shap["for"], helps_pick=True),
        "drivers_against_pick": drivers(shap["against"], helps_pick=False),
        "players_ruled_out": injuries or {},
    }


# --- Validation -------------------------------------------------------------

BANNED = {
    "en": r"\b(guarantee[ds]?|lock of the (week|day)|sure thing|can'?t lose|bets?|betting|wagers?|parlays?|odds)\b",
    "fr": r"\b(garanti(e|es|s)?|parier|paris? sportifs?|mise[sr]?)\b",
    "es": r"\b(garantiza(do|da|r)?|apuestas?|apostar|momios?|cuotas?)\b",
}  # fmt: skip
_GROUPED = re.compile(r"\d{1,3}(?:[,.   ]\d{3})+")
_NUMBER = re.compile(r"(?<![\w.])(?:\d{1,3}(?:[,.   ]\d{3})+(?![\d,.])|\d+(?:[.,]\d+)?)")


def _fact_numbers(obj: Any) -> list[float]:
    nums: list[float] = []
    if isinstance(obj, bool):
        return nums
    if isinstance(obj, int | float):
        if not (isinstance(obj, float) and math.isnan(obj)):
            nums.append(abs(float(obj)))
    elif isinstance(obj, dict):
        for v in obj.values():
            nums.extend(_fact_numbers(v))
    elif isinstance(obj, list | tuple):
        for v in obj:
            nums.extend(_fact_numbers(v))
    elif isinstance(obj, str):
        nums.extend(r for m in _NUMBER.findall(obj) for r in _readings(m))
    return nums


def ungrounded_numbers(texts: list[str], facts: dict[str, Any]) -> list[str]:
    """Numbers in the text that appear nowhere in the facts (allowing rounding)."""
    allowed = _fact_numbers(facts)
    bad = []
    for text in texts:
        for raw in _NUMBER.findall(text):
            if not _grounded(raw, allowed) and not (
                # "week 10 107 points" is two numbers, not 10 107
                re.search(r"\s", raw) and all(_grounded(p, allowed) for p in raw.split())
            ):
                bad.append(raw)
    return bad


def _grounded(raw: str, allowed: list[float]) -> bool:
    readings = _readings(raw)
    if all(n <= 3 for n in readings):  # "1st", "3 games": too small to be a made-up stat
        return True
    return any(_close(n, v) for n in readings for v in allowed)


def _close(n: float, v: float) -> bool:
    return abs(n - v) <= 0.51 or bool(v and abs(n - v) / v <= 0.02)


def _readings(raw: str) -> list[float]:
    """Possible values of a number as written: "6,943" is 6943 in English and 6.943 in
    French; "6.943" the reverse; "6 943" (French grouping) is 6943."""
    out = []
    if _GROUPED.fullmatch(raw):
        out.append(float(re.sub(r"[,.\s]", "", raw)))
    if not re.search(r"\s", raw) and raw.count(",") + raw.count(".") <= 1:
        out.append(float(raw.replace(",", ".")))
    return out


def check(expl: Explanation, facts: dict[str, Any], locale: Locale) -> list[str]:
    """Problems with a validated explanation; empty means publishable."""
    problems = []
    text = " ".join(expl.texts())
    if m := re.search(BANNED[locale], text, flags=re.IGNORECASE):
        problems.append(f"banned wording: {m.group(0)!r}")
    if bad := ungrounded_numbers(expl.texts(), facts):
        problems.append(f"numbers not in the facts: {bad}")
    pick = facts["prediction"]["pick"]
    if pick["nickname"].lower() not in expl.headline.lower() and pick["abbr"] not in expl.headline:
        problems.append("headline must name the picked team")
    return problems


# --- Template fallback --------------------------------------------------------

TIER_WORD = {
    "en": {"lean": "Lean", "solid": "Solid", "strong": "Strong"},
    "fr": {"lean": "léger", "solid": "solide", "strong": "fort"},
    "es": {"lean": "ligero", "solid": "sólido", "strong": "fuerte"},
}
HEADLINE = {
    "en": "{pick} over {opp}: {tier} pick at {pct}%",
    "fr": "Les {pick} devant les {opp} : choix {tier} à {pct} %",
    "es": "Los {pick} sobre los {opp}: pronóstico {tier} con {pct} %",
}
NOTE_PREFIX = {"en": "Against the pick: ", "fr": "À surveiller : ", "es": "En contra: "}
NO_NOTES = {
    "en": "No single factor strongly favors the {opp}; game-day variance remains the main risk.",
    "fr": "Aucun facteur ne favorise nettement les {opp} ; l'incertitude du match reste le principal risque.",
    "es": "Ningún factor favorece claramente a los {opp}; la variabilidad del partido sigue siendo el mayor riesgo.",
}  # fmt: skip
CONCEPT_SENTENCE: dict[str, dict[str, str]] = {
    "home_field": {
        "en": "Home-field advantage favors the {team}.",
        "fr": "L'avantage du terrain profite aux {team}.",
        "es": "La ventaja de jugar en casa favorece a los {team}.",
    },
    "team_strength": {
        "en": "The {team} rate as the stronger team overall by Elo and point differential.",
        "fr": "Les {team} sont l'équipe la plus solide selon l'Elo et le différentiel de points.",
        "es": "Los {team} son el equipo más fuerte según el Elo y el diferencial de puntos.",
    },
    "qb_change": {
        "en": "The quarterback situation favors the {team} compared with the usual starters.",
        "fr": "La situation au poste de quarterback avantage les {team} par rapport aux titulaires habituels.",
        "es": "La situación de los quarterbacks favorece a los {team} frente a los titulares habituales.",
    },
    "efficiency": {
        "en": "The {team} hold the edge in efficiency per play in this matchup.",
        "fr": "Les {team} ont l'avantage en efficacité par action dans ce duel.",
        "es": "Los {team} tienen ventaja en eficiencia por jugada en este duelo.",
    },
    "pass_matchup": {
        "en": "The {team} hold the advantage when passing offense meets pass defense.",
        "fr": "Les {team} dominent le duel entre attaque aérienne et défense contre la passe.",
        "es": "Los {team} dominan el duelo entre ataque aéreo y defensa contra el pase.",
    },
    "run_matchup": {
        "en": "The {team} hold the advantage in the running game matchup.",
        "fr": "Les {team} ont l'avantage dans le jeu au sol.",
        "es": "Los {team} tienen ventaja en el juego terrestre.",
    },
    "big_plays": {
        "en": "The {team} create more big plays than their opponent tends to allow.",
        "fr": "Les {team} réussissent plus de grosses actions que leur adversaire n'en concède d'habitude.",
        "es": "Los {team} generan más jugadas explosivas de las que su rival suele permitir.",
    },
    "turnovers": {
        "en": "Turnover trends tilt toward the {team}.",
        "fr": "Les tendances aux pertes de balle penchent en faveur des {team}.",
        "es": "Las tendencias de pérdidas de balón favorecen a los {team}.",
    },
    "injuries": {
        "en": "The {team} are less affected by players ruled out this week.",
        "fr": "Les {team} sont moins touchés par les joueurs forfaits cette semaine.",
        "es": "Los {team} sufren menos bajas confirmadas esta semana.",
    },
    "rest": {
        "en": "Rest and schedule favor the {team}.",
        "fr": "Le repos et le calendrier avantagent les {team}.",
        "es": "El descanso y el calendario favorecen a los {team}.",
    },
    "travel": {
        "en": "Travel and time zones favor the {team}.",
        "fr": "Les déplacements et les fuseaux horaires avantagent les {team}.",
        "es": "Los viajes y los husos horarios favorecen a los {team}.",
    },
    "venue": {
        "en": "The venue favors the {team}.",
        "fr": "Le lieu du match avantage les {team}.",
        "es": "La sede del partido favorece a los {team}.",
    },
    "rivalry": {
        "en": "Divisional familiarity slightly favors the {team}.",
        "fr": "Le contexte de match de division avantage légèrement les {team}.",
        "es": "El duelo divisional favorece ligeramente a los {team}.",
    },
    "playoffs": {
        "en": "The playoff setting slightly favors the {team}.",
        "fr": "Le contexte de playoffs avantage légèrement les {team}.",
        "es": "El contexto de playoffs favorece ligeramente a los {team}.",
    },
    "weather": {
        "en": "Expected conditions favor the {team}.",
        "fr": "Les conditions attendues avantagent les {team}.",
        "es": "Las condiciones previstas favorecen a los {team}.",
    },
}
# Used, in order, when fewer than 3 drivers support the pick.
FILLERS = {
    "en": [
        "Our model gives the {team} a {pct}% chance to win.",
        "The model projects the {team} to win by about {margin} points.",
        "Overall the matchup data leans toward the {team}.",
    ],
    "fr": [
        "Notre modèle donne {pct} % de chances de victoire aux {team}.",
        "Le modèle projette une victoire des {team} d'environ {margin} points.",
        "Dans l'ensemble, les données du duel penchent vers les {team}.",
    ],
    "es": [
        "Nuestro modelo da a los {team} un {pct} % de probabilidad de ganar.",
        "El modelo proyecta una victoria de los {team} por unos {margin} puntos.",
        "En conjunto, los datos del duelo se inclinan hacia los {team}.",
    ],
}


def template_explanation(facts: dict[str, Any], locale: Locale) -> Explanation:
    pred = facts["prediction"]
    pick, opp = pred["pick"]["nickname"], pred["opponent"]["nickname"]
    pct = pred["win_probability_pct"]
    reasons = [
        CONCEPT_SENTENCE[d["concept"]][locale].format(team=pick) for d in facts["drivers_for_pick"]
    ][:3]
    margin = abs(pred["projected_margin_pts"])
    margin_text = f"{margin:.1f}".replace(".", "," if locale != "en" else ".")
    for filler in FILLERS[locale]:
        if len(reasons) == 3:
            break
        reasons.append(filler.format(team=pick, pct=pct, margin=margin_text))
    notes = [
        NOTE_PREFIX[locale] + CONCEPT_SENTENCE[d["concept"]][locale].format(team=opp)
        for d in facts["drivers_against_pick"]
    ][:2] or [NO_NOTES[locale].format(opp=opp)]
    headline = HEADLINE[locale].format(
        pick=pick, opp=opp, tier=TIER_WORD[locale][pred["confidence_tier"]], pct=pct
    )
    return Explanation(headline=headline, reasons=reasons, matchup_notes=notes)
