"""Synthetic nflverse-shaped inputs for model tests (no network, no polars)."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

TEAMS = ["KC", "BUF", "MIA", "NE"]
HOME_STADIUM = {"KC": "KAN00", "BUF": "BUF00", "MIA": "MIA00", "NE": "BOS00"}
STATS = [
    "plays",
    "epa",
    "pass_plays",
    "pass_epa",
    "rush_plays",
    "rush_epa",
    "success",
    "explosive",
    "turnovers",
]


def synthetic(seasons=(2011, 2012, 2013, 2014), weeks: int = 8, seed: int = 1):
    """Two games per week (13:00 and 16:25 ET), strength-driven scores, matching stats."""
    rng = np.random.default_rng(seed)
    strength = {t: rng.normal(0, 4) for t in TEAMS}
    pairings = [
        [("KC", "BUF"), ("MIA", "NE")],
        [("BUF", "MIA"), ("NE", "KC")],
        [("KC", "MIA"), ("BUF", "NE")],
    ]
    sched, team_rows, qb_rows, inj_rows = [], [], [], []
    for season in seasons:
        start = date(season, 9, 8)
        for week in range(1, weeks + 1):
            day = start + timedelta(days=7 * (week - 1))
            for slot, (home, away) in enumerate(pairings[week % 3]):
                gid = f"{season}_{week:02d}_{away}_{home}"
                margin = strength[home] - strength[away] + 2 + rng.normal(0, 10)
                hs = int(max(0, round(21 + margin / 2)))
                as_ = int(max(0, round(21 - margin / 2)))
                if hs == as_:
                    hs += 1
                sched.append(
                    {
                        "game_id": gid,
                        "season": season,
                        "week": week,
                        "game_type": "REG",
                        "gameday": day.isoformat(),
                        "gametime": "13:00" if slot == 0 else "16:25",
                        "home_team": home,
                        "away_team": away,
                        "home_score": hs,
                        "away_score": as_,
                        "location": "Home",
                        "stadium_id": HOME_STADIUM[home],
                        "roof": "outdoors",
                        "temp": 60,
                        "wind": 8,
                        "div_game": 1,
                        "home_rest": 7,
                        "away_rest": 7,
                        "home_qb_id": f"QB-{home}",
                        "away_qb_id": f"QB-{away}" if week != 5 else f"BACKUP-{away}",
                        "spread_line": round(strength[home] - strength[away] + 2, 1),
                        "total_line": 43.5,
                    }
                )
                for team, pts in ((home, hs), (away, as_)):
                    plays = 60 + int(rng.integers(0, 10))
                    epa = (pts - 21) / 3 + rng.normal(0, 2)
                    team_rows.append(
                        {
                            "game_id": gid,
                            "posteam": team,
                            "plays": plays,
                            "epa": epa,
                            "pass_plays": plays // 2,
                            "pass_epa": epa * 0.6,
                            "rush_plays": plays - plays // 2,
                            "rush_epa": epa * 0.4,
                            "success": plays * 0.45,
                            "explosive": 5,
                            "turnovers": int(rng.integers(0, 3)),
                        }
                    )
                    qb = f"QB-{team}" if not (week == 5 and team == away) else f"BACKUP-{team}"
                    qb_rows.append(
                        {"game_id": gid, "posteam": team, "qb_id": qb, "dropbacks": 35, "epa": epa}
                    )
                kickoff_day = pd.Timestamp(day.isoformat(), tz="UTC")
                inj_rows.append(
                    {
                        "season": season,
                        "game_type": "REG",
                        "team": home,
                        "week": week,
                        "gsis_id": f"P-{home}-1",
                        "position": "CB",
                        "full_name": f"Corner {home}",
                        "report_status": "Out",
                        "date_modified": kickoff_day - pd.Timedelta(days=2),
                    }
                )
                # A report row stamped after kickoff: must be ignored.
                inj_rows.append(
                    {
                        "season": season,
                        "game_type": "REG",
                        "team": away,
                        "week": week,
                        "gsis_id": f"P-{away}-9",
                        "position": "T",
                        "full_name": f"Tackle {away}",
                        "report_status": "Out",
                        "date_modified": kickoff_day + pd.Timedelta(days=1),
                    }
                )
    return (
        pd.DataFrame(sched),
        pd.DataFrame(team_rows),
        pd.DataFrame(qb_rows),
        pd.DataFrame(inj_rows),
    )
