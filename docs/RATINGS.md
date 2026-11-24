# How the ratings were made

Generated 2026-11-10 from box-score stats; no official 2K or NBA ratings used.

**Inputs** (`tools/raw_data.py`): 2026-27 season-to-date (ESPN per-game for PHI/BOS/GSW; nba.com
Lakers game notes totals through Nov 8) and 2025-26 full-season per-game lines (basketball-reference).
Rosters/numbers from legz.com.au and ESPN; Lakers heights/birthdates from the nba.com game notes.

**Steps** (`tools/build_ratings.py`)
1. Pool current season (weight 1.0) with 2025-26 (weight 0.6).
2. Shrink every per-36 rate and shooting percentage toward a position-group prior
   (G / F / C) with pseudo-minutes / pseudo-attempts, so a 4-game sample can't make a superstar.
3. Map onto 25-99 attribute scales with piecewise-linear curves.
4. `overall = 40 + 1.7 * (EFF/36 - position correction) - replacement discount + role-minutes nudge + specialist credit`.
   Players with no data land around 53-57 (end of bench).
5. Two judgment overrides in `data/overrides.json` (Draymond Green, Matisse Thybulle), each with a reason.

**Real vs proxy**
- Real (stat-derived): three_pt, free_throw, finishing, draw_foul, passing, off/def_rebound, steal, block, usage.
- Proxies: mid_range (FT% + 3P% + 2P%), ball_handle (position + assists - turnovers), perimeter_def
  (steals + speed), interior_def (blocks + rebounds + strength), speed/athleticism/strength (position base,
  age penalty when age known, height when known), dunk, stamina (role minutes).

**Known quirks**
- 9-11 game samples are noisy; efficient bigs (e.g., Queta) read high, low-usage guards read low.
- Heights/ages are only filled where a source gave them (Lakers, Warriors, Fall).
- Injured: Butler, Moody, Porzingis (`available:false`).
- Reserves with no 2026-27 games have prior-based ratings (`sample.confidence: "none"`).

To tweak: edit `tools/raw_data.py` or `data/overrides.json`, rerun `python3 tools/build_ratings.py`.
