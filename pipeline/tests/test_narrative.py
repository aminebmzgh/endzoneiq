"""Explanations: facts, validation, templates, Claude writer with a fake client."""

from types import SimpleNamespace

import pytest

from endzoneiq_pipeline.narrative import (
    LOCALES,
    Explanation,
    build_facts,
    check,
    template_explanation,
    ungrounded_numbers,
)
from endzoneiq_pipeline.narrative_claude import (
    ClaudeWriter,
    Rejected,
    explain_pick,
    writer_from_env,
)

GAME = {
    "game_id": "2026_10_BUF_KC",
    "season": 2026,
    "week": 10,
    "game_type": "REG",
    "home_team": "KC",
    "away_team": "BUF",
    "stadium_id": "KAN00",
    "home_qb_name": "Patrick Mahomes",
    "away_qb_name": "Josh Allen",
}
FEATURES = {
    "elo_diff": -60.4,  # BUF stronger
    "points_diff": -3.2,
    "qb_delta_diff": 0.0,
    "pass_edge": -0.051,
    "injury_diff": 1.75,  # KC more hurt
    "home_short_week": 1.0,
    "away_short_week": 0.0,
    "travel_away_km": 1400.0,
    "travel_home_km": 0.0,
    "neutral": 0.0,
}
SHAP_AWAY = {
    "pick": "away",
    "for": [
        {
            "concept": "team_strength",
            "label": "Overall team strength",
            "impact": 0.31,
            "features": {"elo_diff": -60.4, "points_diff": -3.2},
        },
        {
            "concept": "pass_matchup",
            "label": "Passing offense vs pass defense",
            "impact": 0.12,
            "features": {"pass_edge": -0.051},
        },
        {
            "concept": "injuries",
            "label": "Injuries",
            "impact": 0.05,
            "features": {"injury_diff": 1.75},
        },
    ],
    "against": [
        {
            "concept": "travel",
            "label": "Travel",
            "impact": -0.04,
            "features": {"travel_away_km": 1400.0, "travel_home_km": 0.0},
        },
    ],
}
PRED = {"win_prob": 0.36, "pred_margin": -3.4, "pred_total": 47.2, "tier": "solid"}


@pytest.fixture
def facts():
    injuries = {"KC": [{"name": "Corner KC", "position": "CB", "status": "Out"}], "BUF": []}
    return build_facts(GAME, PRED, SHAP_AWAY, FEATURES, injuries)


def test_facts_are_oriented_toward_the_pick(facts):
    pred = facts["prediction"]
    assert pred["pick"]["abbr"] == "BUF" and pred["pick"]["name"] == "Buffalo Bills"
    assert pred["win_probability_pct"] == 64
    assert pred["projected_margin_pts"] == 3.4
    strength = facts["drivers_for_pick"][0]["evidence"]
    assert strength["elo_rating_advantage_points"] == 60
    assert strength["point_differential_advantage_per_game"] == 3.2
    assert facts["drivers_for_pick"][2]["evidence"] == {
        "injury_load_pick_minus_opponent_lower_is_better": -1.75
    }
    travel = facts["drivers_against_pick"][0]["evidence"]
    assert travel == {"pick_travel_km": 1400, "opponent_travel_km": 0}
    assert facts["game"]["venue"] == "GEHA Field at Arrowhead Stadium"
    assert facts["players_ruled_out"]["KC"][0]["name"] == "Corner KC"


@pytest.mark.parametrize("locale", LOCALES)
def test_templates_are_publishable_in_every_language(facts, locale):
    expl = template_explanation(facts, locale)
    assert len(expl.reasons) == 3
    assert "Bills" in expl.headline and "64" in expl.headline
    assert check(expl, facts, locale) == []


def test_templates_fill_in_when_there_are_few_drivers(facts):
    facts["drivers_for_pick"] = facts["drivers_for_pick"][:1]
    facts["drivers_against_pick"] = []
    for locale in LOCALES:
        expl = template_explanation(facts, locale)
        assert len(set(expl.reasons)) == 3
        assert check(expl, facts, locale) == []


def test_validation_limits():
    good = {"headline": "Bills edge the Chiefs", "reasons": ["a", "b", "c"], "matchup_notes": ["x"]}
    Explanation(**good)
    with pytest.raises(ValueError, match="exactly 3"):
        Explanation(**{**good, "reasons": ["a", "b"]})
    with pytest.raises(ValueError, match="20 words"):
        Explanation(**{**good, "reasons": ["a", "b", " ".join(["w"] * 21)]})
    with pytest.raises(ValueError, match="1-3 matchup notes"):
        Explanation(**{**good, "matchup_notes": []})


def test_check_rejects_betting_talk_invented_numbers_and_missing_team(facts):
    def expl(headline="Bills over Chiefs", reasons=("a.", "b.", "c."), notes=("d.",)):
        return Explanation(headline=headline, reasons=list(reasons), matchup_notes=list(notes))

    assert check(expl(), facts, "en") == []
    assert "banned" in check(expl(notes=("Great bet this week.",)), facts, "en")[0]
    assert "banned" in check(expl(notes=("Une victoire garantie.",)), facts, "fr")[0]
    assert "banned" in check(expl(notes=("Buena apuesta.",)), facts, "es")[0]
    assert "numbers" in check(expl(reasons=("Bills won 11 straight.", "b.", "c.")), facts, "en")[0]
    assert check(expl(headline="A big game in Kansas City"), facts, "en") == [
        "headline must name the picked team"
    ]


def test_grounding_allows_rounded_fact_numbers(facts):
    assert ungrounded_numbers(["64% chance", "about 60 Elo points", "3,4 points"], facts) == []
    assert ungrounded_numbers(["won by 27"], facts) == ["27"]


@pytest.mark.parametrize(
    "text", ["a 1,400 km trip", "un trajet de 1 400 km", "1.400 km", "1" + chr(0x202F) + "400 km"]
)
def test_grounding_reads_thousands_separators(facts, text):
    assert ungrounded_numbers([text], facts) == []


def test_grounding_still_catches_grouped_inventions(facts):
    assert ungrounded_numbers(["a 6,943 km trip"], facts) == ["6,943"]
    assert ungrounded_numbers(["Week 10, 64% chance"], facts) == []
    assert ungrounded_numbers(["week 10 64 percent"], facts) == []  # two numbers


class FakeWriter:
    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def write(self, facts, locale, english, feedback=None):
        self.calls.append((locale, english is not None, feedback))
        answer = self.answers.get(locale)
        return answer() if callable(answer) else answer


def test_explain_pick_falls_back_per_locale(facts):
    en = Explanation(
        headline="Bills favored at Arrowhead",
        reasons=[
            "Buffalo rates as the stronger team.",
            "Their passing game has the edge.",
            "Fewer key absences.",
        ],
        matchup_notes=["Travel works against Buffalo."],
    )
    fr_bad = Explanation(
        headline="Les Bills favoris",
        reasons=["Les Bills ont gagné 11 matchs de suite.", "b.", "c."],  # invented number
        matchup_notes=["d."],
    )
    writer = FakeWriter({"en": en, "fr": fr_bad, "es": None})
    out = explain_pick(facts, writer)
    assert out["en"].source == "claude" and out["en"].explanation == en
    assert out["fr"].source == "template"  # rejected three times, then template
    assert out["es"].source == "template"  # API failure
    fr_calls = [c for c in writer.calls if c[0] == "fr"]
    assert len(fr_calls) == 3 and all(c[1] for c in fr_calls)  # English given as reference
    # Retries carry the reasons the previous answer was rejected.
    assert fr_calls[0][2] is None and "numbers" in fr_calls[1][2][0]


def test_explain_pick_succeeds_after_feedback(facts):
    good = template_explanation(facts, "en")
    answers = iter([Rejected(["each reason must be 1-20 words"]), good])
    writer = FakeWriter({"en": lambda: next(answers)})
    out = explain_pick(facts, writer)
    assert out["en"].source == "claude"
    assert writer.calls[1] == ("en", False, ["each reason must be 1-20 words"])


def test_explain_pick_without_writer_uses_templates(facts):
    out = explain_pick(facts, None)
    assert {lo.source for lo in out.values()} == {"template"}


def test_writer_only_with_key_and_model():
    assert writer_from_env({}) is None
    assert writer_from_env({"ANTHROPIC_API_KEY": "x"}) is None
    w = writer_from_env({"ANTHROPIC_API_KEY": "x", "CLAUDE_MODEL_FAST": "some-model"})
    assert isinstance(w, ClaudeWriter) and w.model == "some-model" and w.effort == "low"


class FakeMessages:
    def __init__(self, response):
        self.response = response
        self.kwargs = None

    def parse(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def fake_client(stop_reason="end_turn", parsed=None):
    return SimpleNamespace(
        messages=FakeMessages(SimpleNamespace(stop_reason=stop_reason, parsed_output=parsed))
    )


def test_claude_writer_request_and_parsing(facts):
    draft = SimpleNamespace(
        headline="Bills favored", reasons=["a.", "b.", "c."], matchup_notes=["d."]
    )
    client = fake_client(parsed=draft)
    writer = ClaudeWriter(client=client, model="m", effort="low")
    english = template_explanation(facts, "en")
    out = writer.write(facts, "fr", english)
    assert out is not None and out.headline == "Bills favored"
    kw = client.messages.kwargs
    assert kw["model"] == "m" and kw["output_config"] == {"effort": "low"}
    assert "French" in kw["messages"][0]["content"]
    assert "Buffalo Bills" in kw["messages"][0]["content"]  # facts are in the prompt
    assert english.headline in kw["messages"][0]["content"]


def test_claude_writer_rejects_refusals_and_bad_shapes(facts):
    assert ClaudeWriter(fake_client("refusal"), "m").write(facts, "en", None) is None
    assert ClaudeWriter(fake_client("max_tokens"), "m").write(facts, "en", None) is None
    two = SimpleNamespace(headline="h", reasons=["a", "b"], matchup_notes=["n"])
    rejected = ClaudeWriter(fake_client(parsed=two), "m").write(facts, "en", None)
    assert isinstance(rejected, Rejected) and "exactly 3" in rejected.problems[0]


def test_claude_writer_sends_feedback(facts):
    draft = SimpleNamespace(headline="Bills", reasons=["a.", "b.", "c."], matchup_notes=["d."])
    client = fake_client(parsed=draft)
    ClaudeWriter(client, "m").write(facts, "en", None, ["numbers not in the facts: ['27']"])
    content = client.messages.kwargs["messages"][0]["content"]
    assert "previous answer was rejected" in content and "27" in content
