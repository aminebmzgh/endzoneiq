"""Elo ratings with a margin-of-victory multiplier and regression to the mean.

Classic NFL Elo (FiveThirtyEight-style):
- K = 20, ratings centred on 1505.
- Home field worth HFA Elo points (none at neutral sites) when computing the
  expected result. The model itself learns home field from data; this HFA only
  shapes the rating updates.
- Margin-of-victory multiplier ln(|MOV| + 1) * 2.2 / (winner_elo_diff * 0.001 + 2.2),
  which damps blowouts by favourites (autocorrelation correction).
- Between seasons every rating moves a third of the way back to the mean.

The QB adjustment lives in the features (qb_delta), so Elo here rates the team.
Ratings are taken strictly before kickoff; a game's own result only ever
updates ratings for later games.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

MEAN = 1505.0
K = 20.0
HFA = 48.0
SEASON_REVERT = 1 / 3


def expected(elo_diff: float) -> float:
    """P(team A wins) for elo_diff = A - B (home field already folded in)."""
    return 1.0 / (1.0 + 10 ** (-elo_diff / 400.0))


def mov_multiplier(margin: float, winner_elo_diff: float) -> float:
    return math.log(abs(margin) + 1.0) * 2.2 / (winner_elo_diff * 0.001 + 2.2)


@dataclass
class EloBook:
    ratings: dict[str, float] = field(default_factory=dict)
    season: int | None = None

    def rating(self, team: str) -> float:
        return self.ratings.get(team, MEAN)

    def start_season(self, season: int) -> None:
        if self.season is not None and season != self.season:
            for t, r in self.ratings.items():
                self.ratings[t] = r + (MEAN - r) * SEASON_REVERT
        self.season = season

    def pregame(self, home: str, away: str) -> tuple[float, float]:
        return self.rating(home), self.rating(away)

    def update(self, home: str, away: str, home_pts: int, away_pts: int, neutral: bool) -> None:
        rh, ra = self.pregame(home, away)
        hfa = 0.0 if neutral else HFA
        diff = rh + hfa - ra
        p_home = expected(diff)
        margin = home_pts - away_pts
        actual = 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
        winner_diff = diff if margin > 0 else -diff if margin < 0 else 0.0
        mult = mov_multiplier(margin, winner_diff) if margin != 0 else 1.0
        shift = K * mult * (actual - p_home)
        self.ratings[home] = rh + shift
        self.ratings[away] = ra - shift
