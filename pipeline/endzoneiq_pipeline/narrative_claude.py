"""Claude-written pick explanations (spec 10.1), with a template fallback per locale.

English first, then French and Spanish, each written natively from the same facts
(the English version is given as a reference, not for literal translation). The
model name comes from CLAUDE_MODEL_FAST; without it (or ANTHROPIC_API_KEY) every
explanation uses the template. Each answer is validated with pydantic
(structured output + narrative.Explanation) and narrative.check(); a failure
gets one retry, then the template.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Protocol

from endzoneiq_pipeline.narrative import (
    LOCALES,
    Explanation,
    ExplanationDraft,
    Locale,
    check,
    template_explanation,
)

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You write short explanations of NFL game predictions for EndzoneIQ, a fan-first \
analysis site. It is not a betting site.

Rules:
- Use ONLY the facts in the JSON you are given. Do not add statistics, records, \
quotes, news, injuries or player details that are not in the facts.
- Only use numbers that appear in the facts (rounding is fine). Fewer numbers is better.
- The win probability and projections are model estimates: never present them as \
certain, never promise an outcome, no hype.
- No betting talk: no odds, spreads, bets, locks or "value".
- Plain language for casual fans. Avoid jargon such as "EPA"; say "efficiency per \
play" or similar instead.

Output fields:
- headline: one sentence of at most 12 words that names the picked team.
- reasons: exactly 3 sentences, each at most 20 words, each based on one of \
drivers_for_pick, most important first.
- matchup_notes: 1 to 3 short sentences on what works against the pick \
(drivers_against_pick, players_ruled_out) or what to watch.
"""

LANGUAGE_INSTRUCTIONS: dict[Locale, str] = {
    "en": "Write in American English.",
    "fr": (
        "Write in French for fans in France and other French-speaking countries. Use the "
        "NFL vocabulary French-speaking fans actually use (for example quarterback, "
        "touchdown, balle perdue, défense contre la passe). Keep team names in English."
    ),
    "es": (
        "Write in Spanish for fans in Spain and Latin America. Use the NFL vocabulary "
        "Spanish-speaking fans actually use (for example mariscal de campo or quarterback, "
        "touchdown, pérdida de balón). Keep team names in English."
    ),
}


class ExplanationWriter(Protocol):
    def write(
        self, facts: dict[str, Any], locale: Locale, english: Explanation | None
    ) -> Explanation | None: ...


@dataclass
class ClaudeWriter:
    """One structured-output call per locale. Returns None on any failure."""

    client: Any  # anthropic.Anthropic
    model: str
    effort: str | None = "low"
    max_tokens: int = 4000

    def write(
        self, facts: dict[str, Any], locale: Locale, english: Explanation | None
    ) -> Explanation | None:
        import anthropic

        parts = [LANGUAGE_INSTRUCTIONS[locale], "Facts:", json.dumps(facts, ensure_ascii=False)]
        if english is not None and locale != "en":
            parts += [
                "English version, for reference only. Write naturally in the target "
                "language rather than translating word for word:",
                json.dumps(english.model_dump(), ensure_ascii=False),
            ]
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": "\n\n".join(parts)}],
            "output_format": ExplanationDraft,
        }
        if self.effort:
            kwargs["output_config"] = {"effort": self.effort}
        try:
            response = self.client.messages.parse(**kwargs)
        except anthropic.APIStatusError as err:  # 4xx/5xx after the SDK's own retries
            log.warning("Claude API error %s for %s: %s", err.status_code, locale, err.message)
            return None
        except anthropic.APIConnectionError as err:
            log.warning("Claude API unreachable for %s: %s", locale, err)
            return None
        if response.stop_reason != "end_turn" or response.parsed_output is None:
            log.warning("Claude stopped with %s for %s", response.stop_reason, locale)
            return None
        draft = response.parsed_output
        try:
            return Explanation(
                headline=draft.headline,
                reasons=draft.reasons,
                matchup_notes=draft.matchup_notes,
            )
        except ValueError as err:
            log.warning("Claude explanation failed validation for %s: %s", locale, err)
            return None


def writer_from_env(env: dict[str, str] | None = None) -> ExplanationWriter | None:
    """A ClaudeWriter when ANTHROPIC_API_KEY and CLAUDE_MODEL_FAST are set, else None."""
    e = os.environ if env is None else env
    model = e.get("CLAUDE_MODEL_FAST")
    if not model or not e.get("ANTHROPIC_API_KEY"):
        log.info("CLAUDE_MODEL_FAST/ANTHROPIC_API_KEY not set: using template explanations")
        return None
    import anthropic

    client = anthropic.Anthropic(timeout=60.0, max_retries=2)
    effort = e.get("CLAUDE_EFFORT", "low") or None
    return ClaudeWriter(client=client, model=model, effort=effort)


@dataclass
class LocalizedExplanation:
    explanation: Explanation
    source: str  # "claude" | "template"


def explain_pick(
    facts: dict[str, Any], writer: ExplanationWriter | None, attempts: int = 2
) -> dict[Locale, LocalizedExplanation]:
    """All three locales. Each falls back to the template independently."""
    out: dict[Locale, LocalizedExplanation] = {}
    english: Explanation | None = None
    for locale in LOCALES:
        result: Explanation | None = None
        if writer is not None:
            for attempt in range(1, attempts + 1):
                candidate = writer.write(facts, locale, english)
                if candidate is None:
                    continue
                problems = check(candidate, facts, locale)
                if not problems:
                    result = candidate
                    break
                log.warning("%s explanation rejected (try %s): %s", locale, attempt, problems)
        if result is None:
            out[locale] = LocalizedExplanation(template_explanation(facts, locale), "template")
        else:
            out[locale] = LocalizedExplanation(result, "claude")
        if locale == "en":
            english = out["en"].explanation
    return out
