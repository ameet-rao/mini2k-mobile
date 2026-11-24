"""
Raw inputs for the ratings pipeline.  Every number here was transcribed from a public
stats page (ESPN team stats, basketball-reference, nba.com Lakers game notes, legz.com.au
rosters) on 2026-11-10.  Nothing in this file is a rating - ratings are derived in
build_ratings.py.

Layout
------
ROSTERS[team]    -> list of player identity rows
CUR[team]        -> 2026-27 season-to-date rows (per-game, except LAL which is season totals)
PREV             -> 2025-26 full-season per-game rows keyed by player name (basketball-reference)
TEAM_GAMES       -> games each team has played this season (for starter inference)
INJURIES         -> players currently out (long-term)
"""

AS_OF = "2026-11-10"

TEAM_META = {
    "PHI": {"name": "Philadelphia 76ers", "city": "Philadelphia", "nick": "76ers", "colors": ["#006BB6", "#ED174C"]},
    "BOS": {"name": "Boston Celtics", "city": "Boston", "nick": "Celtics", "colors": ["#007A33", "#FFFFFF"]},
    "LAL": {"name": "Los Angeles Lakers", "city": "Los Angeles", "nick": "Lakers", "colors": ["#552583", "#FDB927"]},
    "GSW": {"name": "Golden State Warriors", "city": "Golden State", "nick": "Warriors", "colors": ["#1D428A", "#FFC72C"]},
}

TEAM_GAMES = {"PHI": 11, "BOS": 10, "LAL": 11, "GSW": 9}

# (name, jersey, position, height_inches|None, dob "YYYY-MM-DD"|None, age|None, roster_status)
# roster_status: "active" = has 2026-27 games, "reserve" = on roster but no 2026-27 games yet,
#                "two-way" = two-way contract
ROSTERS = {
    "PHI": [
        ("Tyrese Maxey", 0, "PG", None, None, None, "active"),
        ("Jaylen Brown", 7, "SG", None, None, None, "active"),
        ("Joel Embiid", 21, "C", None, None, None, "active"),
        ("LeBron James", 23, "SF", None, None, 41, "active"),
        ("VJ Edgecombe", 77, "SG", None, None, None, "active"),
        ("Anfernee Simons", 5, "SG", None, None, None, "active"),
        ("Kentavious Caldwell-Pope", 1, "SG", None, None, None, "active"),
        ("Jabari Walker", 33, "PF", None, None, None, "active"),
        ("Dean Wade", 45, "PF", None, None, None, "active"),
        ("Labaron Philon Jr.", None, "PG", None, None, None, "active"),
        ("Adem Bona", 30, "C", None, None, None, "active"),
        ("Rayan Rupert", 12, "SF", None, None, None, "active"),
        ("Justin Edwards", 11, "SF", None, None, None, "active"),
        ("Caleb Love", 8, "SG", None, None, None, "active"),
        ("Tacko Fall", 99, "C", 89, None, None, "active"),
        ("Jameer Nelson Jr.", 14, "PG", None, None, None, "reserve"),
        ("Saint Thomas", 19, "SF", None, None, None, "reserve"),
        ("Dominick Barlow", 25, "PF", None, None, None, "reserve"),
        ("Duke Miles", 31, "PG", None, None, None, "reserve"),
        ("Dillon Jones", 35, "SF", None, None, None, "reserve"),
        ("Ariel Hukporti", 55, "C", None, None, None, "reserve"),
    ],
    "BOS": [
        ("Jayson Tatum", 0, "SF", None, None, None, "active"),
        ("Paul George", 13, "SF", None, None, None, "active"),
        ("Derrick White", 9, "SG", None, None, None, "active"),
        ("Payton Pritchard", 11, "PG", None, None, None, "active"),
        ("Neemias Queta", 88, "C", None, None, None, "active"),
        ("Sam Hauser", 30, "SF", None, None, None, "active"),
        ("Luka Garza", 52, "C", None, None, None, "active"),
        ("Mitchell Robinson", 4, "C", None, None, None, "active"),
        ("Baylor Scheierman", 55, "SF", None, None, None, "active"),
        ("Jordan Walsh", 27, "SF", None, None, None, "active"),
        ("Hugo Gonzalez", 28, "SF", None, None, None, "active"),
        ("Mike Conley", 45, "PG", None, None, None, "active"),
        ("Chris Cenac Jr.", 12, "PF", None, None, None, "active"),
        ("Ron Harper Jr.", 8, "SF", None, None, None, "active"),
        ("Dillon Mitchell", 20, "SF", None, None, None, "active"),
        ("Tucker DeVries", 26, "PF", None, None, None, "reserve"),
        ("Milos Uzan", 29, "PG", None, None, None, "reserve"),
        ("Gabe McGlothan", 41, "PF", None, None, None, "reserve"),
        ("Hayden Gray", 44, "SG", None, None, None, "reserve"),
        ("Amari Williams", 77, "C", None, None, None, "reserve"),
        ("Devin Carter", 99, "PG", None, None, None, "reserve"),
    ],
    "LAL": [
        ("Luka Doncic", 77, "PG", 80, "1999-02-28", None, "active"),
        ("Austin Reaves", 15, "SG", 77, "1998-05-29", None, "active"),
        ("Walker Kessler", 14, "C", 85, "2001-07-26", None, "active"),
        ("Ziaire Williams", 11, "SF", 81, "2001-09-12", None, "active"),
        ("Collin Sexton", 10, "SG", 73, "1999-01-04", None, "active"),
        ("Sandro Mamukelashvili", 54, "PF", 82, "1999-05-23", None, "active"),
        ("Quentin Grimes", 5, "SG", 76, "2000-05-08", None, "active"),
        ("Matisse Thybulle", 4, "SF", 77, "1997-03-04", None, "active"),
        ("Jake LaRavia", 12, "PF", 79, "2001-11-03", None, "active"),
        ("Adou Thiero", 1, "SF", 79, "2004-05-08", None, "active"),
        ("Kevon Looney", 55, "C", 81, "1996-02-06", None, "active"),
        ("Jaden Hardy", 7, "SG", 76, "2002-07-05", None, "active"),
        ("Jarred Vanderbilt", 2, "PF", 80, "1999-04-03", None, "active"),
        ("Chris Mañon", 30, "SG", 76, "2001-12-09", None, "two-way"),
        ("Bronny James", 9, "PG", 74, "2004-10-06", None, "active"),
        ("Cameron Carr", 43, "SG", 77, "2004-11-21", None, "active"),
        ("Lawson Lovering", 18, "C", 84, "2003-05-09", None, "two-way"),
        ("Arthur Kaluma", 47, "SF", 79, "2002-03-01", None, "two-way"),
    ],
    "GSW": [
        ("Stephen Curry", 30, "PG", 74, None, 38, "active"),
        ("Yaxel Lendeborg", 1, "PF", None, None, None, "active"),
        ("Brandin Podziemski", 2, "SG", 76, None, 23, "active"),
        ("Brandon Williams", 12, "PG", None, None, None, "active"),
        ("De'Anthony Melton", 8, "PG", 74, None, 28, "active"),
        ("Georges Niang", 32, "PF", None, None, None, "active"),
        ("Gui Santos", 15, "PF", 79, None, 24, "active"),
        ("Charles Bassey", 28, "C", 82, None, 26, "active"),
        ("Al Horford", 20, "C", 80, None, 40, "active"),
        ("Will Richard", 3, "SG", 75, None, 24, "active"),
        ("Gary Payton II", 0, "SG", 74, None, 34, "active"),
        ("Graham Ike", 45, "PF", None, None, None, "active"),
        ("Draymond Green", 23, "PF", 78, None, 36, "active"),
        ("LJ Cryer", 18, "PG", 72, None, 25, "active"),
        ("Malevy Leons", 33, "SF", 81, None, 27, "active"),
        ("Moses Moody", 4, "SG", 77, None, 24, "reserve"),
        ("Kristaps Porzingis", 7, "C", 86, None, 31, "reserve"),
        ("Jimmy Butler III", 10, "SF", 78, None, 37, "reserve"),
        ("Alex Toohey", 22, "PF", None, None, None, "reserve"),
        ("Miles Kelly", 26, "SG", None, None, None, "reserve"),
    ],
}

INJURIES = {
    "Jimmy Butler III": "Out - right ACL repair, expected return ~Jan-Feb 2027",
    "Moses Moody": "Out - left patellar tendon repair, expected return ~Dec 2026-Jan 2027",
    "Kristaps Porzingis": "Out - undisclosed, not with team",
}

# ---------------------------------------------------------------------------------------
# 2026-27 season to date, PER GAME (ESPN) for PHI / BOS / GSW.
# (name, gp, gs, mpg, orb, drb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta)
# ---------------------------------------------------------------------------------------
CUR_PER_GAME = {
    "PHI": [
        ("Tyrese Maxey", 11, 11, 36.5, .3, 3.5, 5.5, 1.4, .6, 2.0, 2.5, 9.2, 19.1, 2.5, 7.5, 6.0, 7.0),
        ("Jaylen Brown", 10, 10, 35.8, 1.8, 4.9, 4.0, 1.2, .4, 2.1, 2.2, 8.4, 17.6, 2.0, 5.1, 3.5, 4.9),
        ("Joel Embiid", 9, 9, 31.9, 2.4, 7.2, 4.1, .8, .8, 3.1, 2.2, 5.8, 15.2, .3, 3.3, 6.0, 6.7),
        ("LeBron James", 9, 9, 32.9, .4, 6.7, 6.7, 1.4, .8, 2.9, 2.0, 5.9, 13.3, .9, 3.6, 2.9, 4.2),
        ("VJ Edgecombe", 10, 10, 33.5, 1.4, 5.1, 2.9, 1.6, .4, 1.1, 3.4, 5.2, 11.3, 1.9, 4.9, .9, 1.3),
        ("Anfernee Simons", 11, 0, 21.9, .5, 1.6, 1.3, .5, .2, .6, 2.5, 2.9, 7.7, 2.2, 5.6, 1.0, 1.2),
        ("Kentavious Caldwell-Pope", 11, 1, 21.9, .7, 1.9, 1.4, .8, .4, .5, 2.3, 1.9, 4.1, 1.4, 2.8, .5, .5),
        ("Jabari Walker", 7, 0, 10.9, 1.6, 2.1, .6, .1, 0, 0, 1.6, 2.0, 3.6, .3, 1.0, 1.0, 1.7),
        ("Dean Wade", 9, 4, 24.7, 1.1, 2.0, 1.9, 1.4, .4, .3, 1.9, 1.1, 2.8, .6, 1.8, .4, .8),
        ("Labaron Philon Jr.", 6, 0, 6.3, .2, .8, .3, 0, 0, .5, .7, 1.0, 2.7, .3, 1.3, .2, .7),
        ("Adem Bona", 9, 1, 14.2, 1.7, 2.2, .8, .4, 1.0, .9, 2.9, .9, 2.3, 0, .3, .3, .8),
        ("Rayan Rupert", 1, 0, 2.0, 2.0, 0, 0, 0, 0, 0, 0, 1.0, 1.0, 0, 0, 0, 0),
        ("Justin Edwards", 4, 0, 2.3, .5, .3, 0, 0, 0, .3, .5, .5, 1.0, .3, .5, 0, 0),
        ("Tacko Fall", 1, 0, 3.0, 0, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        ("Caleb Love", 1, 0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ],
    "BOS": [
        ("Jayson Tatum", 9, 9, 33.8, .7, 5.3, 7.8, .8, .6, 2.9, 2.3, 8.2, 19.6, 2.3, 7.4, 8.3, 9.3),
        ("Paul George", 9, 9, 30.1, .8, 4.4, 4.1, 2.3, .4, 3.1, 2.8, 7.3, 15.8, 3.4, 8.1, 2.3, 2.9),
        ("Derrick White", 10, 10, 29.8, 1.2, 2.1, 5.3, 1.4, .5, 2.4, 1.7, 4.7, 10.7, 1.7, 5.2, 1.8, 1.8),
        ("Payton Pritchard", 10, 0, 26.7, 1.1, 2.2, 3.8, .8, .2, 1.3, 1.7, 4.1, 10.1, 2.1, 5.9, 2.5, 2.9),
        ("Neemias Queta", 10, 5, 21.8, 2.4, 3.8, 1.6, .2, 1.3, 1.0, 2.7, 3.6, 6.4, .2, .3, 2.1, 3.4),
        ("Sam Hauser", 10, 1, 21.0, .6, 2.3, 1.1, .2, .1, .1, 1.7, 2.8, 6.2, 2.1, 5.2, 0, 0),
        ("Luka Garza", 10, 0, 12.8, 2.2, 1.6, 1.3, .4, .4, .7, 1.9, 2.2, 4.9, 1.3, 2.4, 1.3, 2.1),
        ("Mitchell Robinson", 9, 5, 18.8, 2.7, 3.0, .7, .8, .8, .8, 2.2, 2.9, 4.2, 0, 0, .7, 2.0),
        ("Baylor Scheierman", 10, 1, 20.2, 1.1, 2.7, 1.2, .7, 0, .9, 1.8, 2.1, 4.9, 1.3, 3.0, .4, .4),
        ("Jordan Walsh", 10, 6, 15.6, .9, 2.7, .6, .6, .1, .7, 2.2, 1.5, 4.0, .7, 2.4, .3, .3),
        ("Hugo Gonzalez", 10, 3, 12.8, .7, 1.4, .5, .4, .2, .4, 1.2, 1.3, 3.1, .3, 1.7, .9, 1.3),
        ("Mike Conley", 4, 1, 8.0, .3, .5, .5, .5, .3, .5, .8, 1.0, 1.5, 1.0, 1.5, 0, 0),
        ("Chris Cenac Jr.", 3, 0, 3.3, 0, 1.0, 0, 0, 0, .7, 0, 1.0, 1.3, .3, .7, .3, .7),
        ("Ron Harper Jr.", 5, 0, 6.2, .2, .2, .6, .2, 0, .6, .4, .6, 2.0, .4, 1.2, 0, 0),
        ("Dillon Mitchell", 1, 0, 2.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ],
    "GSW": [
        ("Stephen Curry", 7, 7, 28.7, .4, 3.3, 4.4, 1.3, .1, 1.7, 1.4, 8.6, 18.3, 4.7, 10.7, 8.0, 8.1),
        ("Yaxel Lendeborg", 9, 9, 31.8, 2.8, 4.3, 4.1, 1.1, .6, 3.2, 3.0, 6.9, 14.0, 2.3, 5.9, 4.9, 6.4),
        ("Brandin Podziemski", 7, 7, 33.3, 1.4, 3.7, 4.7, 1.1, .4, 1.7, 2.7, 5.7, 12.6, 2.3, 6.6, 2.1, 3.1),
        ("Brandon Williams", 8, 1, 17.8, .9, 1.8, 2.6, .9, .5, 1.6, 1.3, 3.5, 8.8, .9, 2.6, 3.5, 4.1),
        ("De'Anthony Melton", 9, 2, 22.3, 1.1, 3.6, 2.2, 1.7, .3, 1.6, 2.1, 3.1, 7.4, 2.1, 5.0, 1.7, 2.0),
        ("Georges Niang", 9, 2, 20.1, 1.1, 2.0, 1.7, .7, .1, 1.4, 1.6, 3.1, 6.8, 1.2, 4.0, .4, .7),
        ("Gui Santos", 6, 4, 20.2, 1.5, 2.5, 1.3, .5, .3, .7, 2.5, 2.5, 5.2, .7, 1.8, 1.5, 2.3),
        ("Charles Bassey", 7, 1, 11.9, 1.7, 3.6, .6, .1, 1.0, .9, 2.0, 2.7, 4.1, 0, .3, 1.6, 1.9),
        ("Al Horford", 7, 0, 18.6, .6, 3.6, 1.0, .3, .6, .9, 1.3, 2.0, 4.3, 1.4, 3.1, 0, .1),
        ("Will Richard", 9, 3, 17.8, 1.0, .8, 1.0, .4, .3, .4, 1.7, 2.0, 4.3, 1.0, 2.3, .2, .3),
        ("Gary Payton II", 9, 0, 13.4, .9, .9, .4, .7, 0, .8, 1.7, 2.2, 4.7, .4, 1.9, .2, .2),
        ("Graham Ike", 7, 2, 9.7, 1.3, 1.1, .7, .4, .1, .3, 1.3, 1.9, 3.6, .6, .6, .7, .9),
        ("Draymond Green", 7, 7, 26.7, 1.0, 4.0, 7.0, .9, .9, 3.1, 2.6, 1.1, 3.0, .3, 1.3, .4, .6),
        ("LJ Cryer", 7, 0, 4.3, 0, .3, 1.0, 0, 0, .1, .6, .9, 2.3, .7, 1.4, .1, .3),
        ("Malevy Leons", 5, 0, 3.6, 0, .4, 0, .4, 0, 0, .4, .2, 1.2, 0, .2, 0, 0),
    ],
}

# Lakers: season TOTALS through Nov 8 (nba.com game notes).
# (name, g, gs, min, fg, fga, 3fg, 3fga, ft, fta, off, def, ast, pf, stl, to, blk, pts)
CUR_TOTALS_LAL = [
    ("Luka Doncic", 9, 9, 324, 110, 221, 52, 124, 89, 102, 3, 67, 69, 23, 15, 44, 6, 361),
    ("Austin Reaves", 11, 11, 398, 91, 179, 26, 63, 70, 77, 8, 29, 51, 33, 11, 40, 4, 278),
    ("Walker Kessler", 11, 11, 341, 68, 98, 0, 0, 22, 38, 39, 81, 16, 33, 14, 17, 27, 158),
    ("Ziaire Williams", 8, 4, 193, 31, 56, 17, 37, 10, 12, 8, 15, 13, 22, 11, 4, 2, 89),
    ("Collin Sexton", 10, 0, 173, 33, 80, 8, 33, 21, 28, 6, 13, 22, 27, 5, 13, 3, 95),
    ("Sandro Mamukelashvili", 11, 0, 248, 35, 75, 11, 35, 14, 18, 12, 35, 16, 18, 8, 9, 6, 95),
    ("Quentin Grimes", 11, 2, 287, 28, 65, 8, 33, 24, 34, 4, 24, 28, 18, 10, 15, 2, 88),
    ("Matisse Thybulle", 11, 11, 271, 26, 60, 18, 46, 8, 9, 5, 14, 12, 24, 22, 11, 9, 78),
    ("Jake LaRavia", 10, 7, 241, 22, 40, 12, 21, 7, 14, 16, 20, 17, 36, 14, 14, 8, 63),
    ("Adou Thiero", 2, 0, 15, 3, 5, 0, 0, 0, 0, 5, 1, 2, 3, 0, 1, 0, 6),
    ("Kevon Looney", 5, 0, 29, 3, 6, 0, 0, 2, 2, 4, 4, 1, 7, 0, 0, 0, 8),
    ("Jaden Hardy", 6, 0, 21, 1, 10, 1, 8, 5, 6, 0, 3, 3, 2, 2, 1, 0, 8),
    ("Jarred Vanderbilt", 6, 0, 73, 4, 5, 0, 0, 0, 1, 9, 16, 9, 12, 1, 6, 2, 8),
    ("Chris Mañon", 2, 0, 7, 1, 3, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2),
    ("Bronny James", 5, 0, 12, 2, 3, 0, 1, 0, 0, 0, 0, 0, 4, 0, 2, 1, 4),
    ("Cameron Carr", 3, 0, 4, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ("Lawson Lovering", 2, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0),
]


def _lal_per_game():
    rows = []
    for (n, g, gs, mn, fg, fga, tp, tpa, ft, fta, off, de, ast, pf, stl, to, blk, pts) in CUR_TOTALS_LAL:
        d = float(g)
        rows.append((n, g, gs, mn / d, off / d, de / d, ast / d, stl / d, blk / d, to / d, pf / d,
                     fg / d, fga / d, tp / d, tpa / d, ft / d, fta / d))
    return rows


CUR_PER_GAME["LAL"] = _lal_per_game()

# ---------------------------------------------------------------------------------------
# 2025-26 full season PER GAME (basketball-reference), keyed by player.  Used for blending
# at weight 0.6.  Players moved teams; this is their own 2025-26 line wherever they played.
# (g, mp, fgm, fga, tpm, tpa, ftm, fta, orb, drb, ast, stl, blk, tov, pf)
# ---------------------------------------------------------------------------------------
PREV = {
    # PHI
    "Tyrese Maxey": (70, 38.0, 9.9, 21.4, 3.1, 8.6, 5.3, 6.0, .3, 3.8, 6.6, 1.9, .8, 2.4, 2.2),
    "Joel Embiid": (38, 31.6, 9.0, 18.3, 1.4, 4.2, 7.5, 8.8, 2.0, 5.7, 3.9, .6, 1.2, 2.9, 2.2),
    "VJ Edgecombe": (75, 35.0, 6.0, 13.7, 2.0, 5.6, 2.0, 2.4, 1.6, 4.0, 4.2, 1.4, .5, 1.8, 2.9),
    "Dominick Barlow": (71, 23.8, 3.0, 5.6, .3, 1.2, 1.3, 1.8, 1.9, 2.9, 1.2, .9, .7, .8, 2.1),
    "Adem Bona": (71, 17.4, 1.8, 3.1, 0, .1, 1.1, 1.6, 1.8, 2.5, .5, .4, 1.2, .8, 2.2),
    "Justin Edwards": (64, 15.3, 2.2, 5.0, 1.0, 2.8, .5, .6, .4, 1.1, 1.3, .8, .2, .6, 1.4),
    "Jabari Walker": (64, 11.9, 1.5, 3.3, .5, 1.5, .8, 1.1, 1.1, 1.9, .5, .4, .2, .4, 1.6),
    # moved to PHI / BOS / LAL from elsewhere
    "Paul George": (37, 30.7, 6.1, 13.9, 2.7, 6.9, 2.5, 3.0, .5, 4.8, 3.6, 1.7, .4, 1.7, 2.3),
    "Quentin Grimes": (75, 29.4, 4.5, 10.1, 1.7, 5.1, 2.7, 3.2, .6, 3.0, 3.3, .9, .4, 1.8, 2.1),
    "Jaylen Brown": (71, 34.4, 10.4, 21.7, 2.0, 5.7, 6.0, 7.5, 1.1, 5.8, 5.1, 1.0, .4, 3.6, 2.7),
    "Anfernee Simons": (49, 24.5, 5.1, 11.6, 2.7, 6.7, 1.3, 1.5, .5, 1.9, 2.4, .6, .1, 1.1, 1.7),
    "LeBron James": (60, 33.2, 7.9, 15.3, 1.3, 4.1, 3.9, 5.3, .7, 5.4, 7.2, 1.2, .6, 3.0, 1.4),
    # BOS
    "Jayson Tatum": (16, 32.6, 7.4, 17.9, 2.9, 8.9, 4.1, 4.9, .5, 9.5, 5.3, 1.4, .2, 2.4, 1.6),
    "Derrick White": (77, 34.1, 5.7, 14.4, 2.7, 8.3, 2.4, 2.6, 1.1, 3.3, 5.4, 1.1, 1.3, 1.7, 1.5),
    "Payton Pritchard": (79, 32.4, 6.4, 13.8, 2.7, 7.1, 1.5, 1.7, .9, 3.1, 5.2, .7, .1, 1.4, 1.5),
    "Neemias Queta": (76, 25.3, 4.3, 6.6, 0, .1, 1.6, 2.3, 3.0, 5.3, 1.7, .8, 1.3, 1.0, 2.8),
    "Sam Hauser": (78, 24.8, 3.2, 7.7, 2.5, 6.5, .2, .3, .7, 3.1, 1.5, .5, .3, .4, 1.4),
    "Baylor Scheierman": (77, 18.6, 2.0, 4.3, 1.3, 3.2, .4, .4, .7, 2.8, 1.5, .5, .1, .6, 1.4),
    "Jordan Walsh": (68, 17.8, 2.0, 3.9, .7, 1.8, .6, .8, 1.3, 2.8, .8, .7, .5, .5, 2.0),
    "Luka Garza": (69, 16.2, 3.0, 5.2, .8, 1.8, 1.3, 1.7, 2.3, 1.8, 1.0, .4, .4, .7, 2.3),
    "Hugo Gonzalez": (74, 14.6, 1.6, 3.3, .6, 1.6, .2, .4, .8, 2.5, .5, .6, .3, .5, 1.7),
    "Ron Harper Jr.": (29, 11.0, 1.6, 3.8, 1.0, 2.8, .1, .1, .5, 1.1, .8, .3, .3, .3, .7),
    "Amari Williams": (22, 6.6, .5, .9, 0, 0, .5, .6, .4, 1.4, .5, .1, .5, .5, .9),
    # LAL
    "Luka Doncic": (64, 35.8, 10.8, 22.8, 4.0, 10.8, 7.9, 10.1, .6, 7.1, 8.3, 1.6, .5, 4.0, 2.4),
    "Austin Reaves": (51, 34.5, 7.3, 14.9, 2.3, 6.4, 6.3, 7.3, .6, 4.1, 5.5, 1.1, .4, 3.0, 2.2),
    "Jake LaRavia": (82, 25.1, 2.9, 6.4, 1.0, 3.0, 1.4, 1.9, 1.4, 2.6, 1.8, 1.3, .5, 1.1, 2.4),
    "Jarred Vanderbilt": (65, 17.4, 1.7, 3.7, .4, 1.5, .5, .9, 1.2, 3.3, 1.3, .8, .3, .9, 1.6),
    "Bronny James": (42, 8.9, 1.1, 2.7, .5, 1.4, .1, .2, .1, .4, 1.2, .5, .1, .6, .7),
    "Adou Thiero": (25, 6.0, .6, 1.2, 0, .1, .6, .9, .4, .8, .4, .3, .1, .4, .8),
    "Chris Mañon": (9, 5.1, None, None, None, None, None, None, None, None, None, None, None, None, None),
    # GSW
    "Jimmy Butler III": (38, 31.1, 6.3, 12.2, .8, 2.2, 6.5, 7.6, 2.3, 3.2, 4.9, 1.4, .2, 1.6, 1.2),
    "Stephen Curry": (43, 30.9, 8.7, 18.6, 4.4, 11.3, 4.7, 5.1, .4, 3.2, 4.7, 1.1, .4, 2.8, 1.7),
    "Brandin Podziemski": (82, 28.5, 4.8, 10.6, 1.9, 5.0, 2.3, 2.9, .9, 4.2, 3.7, 1.1, .2, 1.6, 1.7),
    "Draymond Green": (68, 27.5, 3.0, 7.2, 1.5, 4.6, .9, 1.2, .8, 4.7, 5.5, .9, .6, 2.7, 2.9),
    "Moses Moody": (60, 25.7, 4.1, 9.3, 2.5, 6.3, 1.5, 1.9, .9, 2.5, 1.6, 1.0, .6, 1.0, 2.0),
    "Kristaps Porzingis": (15, 23.7, 5.1, 11.9, 1.5, 4.9, 4.3, 5.1, 1.3, 4.1, 2.3, .6, 1.1, 1.7, 2.5),
    "De'Anthony Melton": (49, 23.0, 4.4, 10.8, 1.5, 5.0, 2.0, 2.5, .8, 2.4, 2.6, 1.6, .4, 1.9, 1.9),
    "Al Horford": (45, 21.5, 3.1, 7.2, 1.6, 4.6, .5, .6, 1.0, 3.9, 2.6, .7, 1.1, .9, 1.1),
    "Gui Santos": (68, 20.5, 3.4, 6.8, 1.1, 3.3, 1.3, 1.8, 1.1, 2.8, 2.3, .9, .3, 1.5, 2.1),
    "Charles Bassey": (5, 20.0, 4.2, 6.2, 0, 0, 2.2, 2.6, 2.4, 4.8, 1.0, .4, 1.4, .8, 2.2),
    "Will Richard": (69, 20.0, 2.3, 5.0, 1.0, 3.1, .7, .8, 1.0, 1.5, 1.3, 1.2, .1, .8, 1.9),
    "Gary Payton II": (73, 15.6, 3.3, 5.7, .5, 1.7, .4, .5, 1.4, 2.2, 1.7, .9, .3, .8, 1.8),
    "LJ Cryer": (18, 16.2, 2.6, 6.5, 2.1, 5.2, .9, 1.1, .2, 1.3, 1.0, .2, 0, .8, 1.6),
    "Malevy Leons": (25, 11.0, 1.3, 2.9, .2, .6, .6, .8, 1.2, .9, .9, .6, .4, .5, 1.2),
}


# ---------------------------------------------------------------------------------------
# Ten more teams (SAS OKC NYK HOU WAS CHI TOR CLE DEN MIA) and real heights for everyone.
# The rows live in data/sources/*.txt exactly as transcribed from basketball-reference.com
# (2026-27 roster + per-game tables, 2025-26 per-game rows); this block only parses them
# into the same structures as above.
# ---------------------------------------------------------------------------------------
def _load_sources():
    import os
    import re
    import unicodedata
    src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "sources")

    def lines(name):
        with open(os.path.join(src, name), encoding="utf-8") as f:
            return [ln.rstrip("\n") for ln in f if ln.strip() and not ln.startswith("#")]

    def key(s):
        s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
        return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z]", "", s)

    team, has_stats = None, set()
    for ln in lines("bbref_cur_2026-11-13.txt"):
        kind, _, rest = ln.partition("|")
        if kind == "T":
            code, name, city, nick, c1, c2, games = rest.split("|")
            team = code
            TEAM_META[code] = {"name": name, "city": city, "nick": nick, "colors": [c1, c2]}
            TEAM_GAMES[code] = int(games)
            ROSTERS[code], CUR_PER_GAME[code] = [], []
        elif kind == "R":
            name, num, pos, ht, dob = rest.split(",")
            ROSTERS[team].append([name, int(num) if num else None, pos, int(ht), dob, None, "reserve"])
        elif kind == "P":
            f = rest.split(",")
            CUR_PER_GAME[team].append((f[0], int(f[1]), int(f[2]), *[float(x) for x in f[3:]]))
            has_stats.add((team, f[0]))
    for code in list(ROSTERS):
        ROSTERS[code] = [tuple(r[:6]) + ("active" if (code, r[0]) in has_stats else r[6],) for r in ROSTERS[code]]

    for ln in lines("bbref_prev_2025-26.txt"):
        f = ln.split(",")
        PREV.setdefault(f[0], (int(f[1]), *[float(x) for x in f[2:]]))

    heights = {}
    for ln in lines("bbref_heights_2026-11-13.txt"):
        name, ht = ln.rsplit(",", 1)
        heights[key(name)] = int(ht)
    missing = []
    for code, roster in ROSTERS.items():
        out = []
        for (name, num, pos, ht, dob, age, status) in roster:
            if ht is None:
                ht = heights.get(key(name))
                if ht is None:
                    missing.append(name)
            out.append((name, num, pos, ht, dob, age, status))
        ROSTERS[code] = out
    return missing


NO_HEIGHT = _load_sources()   # players whose height was not on the source page (position default is used)
