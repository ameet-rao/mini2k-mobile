#!/usr/bin/env python3
"""
Build 0-99 player ratings from raw box-score stats.  Stdlib only.

    python3 tools/build_ratings.py          # writes data/*.json and data/ratings.csv

Method (see docs/RATINGS.md):
  1. Pool 2026-27 season-to-date stats (weight 1.0) with 2025-26 full-season stats (weight 0.6).
  2. Shrink every per-minute rate / shooting percentage toward a position-group prior
     (empirical-Bayes style) so tiny samples don't produce silly ratings.
  3. Map shrunk numbers onto 0-99 attribute scales with piecewise-linear curves.
  4. Overall = 40 + 1.7 * EFF/36 (shrunk), minus a replacement discount for thin samples.
  5. Apply labeled judgment overrides from data/overrides.json (kept deliberately tiny).
Defense, speed, handle, strength and athleticism are PROXIES (box score + position + age);
there is no tracking data behind them.
"""
import csv
import json
import os
import re
import sys
import unicodedata
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import raw_data as R  # noqa: E402

ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
W_PREV = 0.6
AS_OF = date(2026, 11, 10)

# ----------------------------------------------------------------------------- helpers

def pw(x, pts):
    """Piecewise-linear map. pts = [(x0, y0), (x1, y1), ...] ascending in x; clamped at ends."""
    if x <= pts[0][0]:
        return float(pts[0][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return float(pts[-1][1])


def clamp(v, lo=25, hi=99):
    return int(round(max(lo, min(hi, v))))


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def pos_group(pos):
    return {"PG": "G", "SG": "G", "SF": "F", "PF": "F", "C": "C"}[pos]


# Position-group priors: per-36 rates for a league-average rotation player, and shooting pcts.
PRIOR = {
    "G": dict(orb=.7, drb=3.0, ast=4.5, stl=1.2, blk=.3, tov=2.2, pf=3.0, fga=12.0, tpa=5.5, fta=3.0,
              tp_pct=.360, ft_pct=.790, two_pct=.500),
    "F": dict(orb=1.4, drb=5.0, ast=2.5, stl=1.0, blk=.6, tov=1.8, pf=3.0, fga=11.5, tpa=4.0, fta=3.0,
              tp_pct=.355, ft_pct=.770, two_pct=.530),
    "C": dict(orb=3.2, drb=7.5, ast=2.0, stl=.7, blk=1.6, tov=1.9, pf=3.6, fga=9.5, tpa=1.0, fta=3.5,
              tp_pct=.310, ft_pct=.700, two_pct=.600),
}
# Pseudo-minutes of prior mixed into each per-minute rate (bigger = more shrinkage).
K_MIN = dict(orb=150, drb=150, ast=150, stl=250, blk=250, tov=250, pf=250, fga=120, tpa=120, fta=120)
# Pseudo-attempts for percentages.
K_ATT = dict(tp=150, ft=60, two=150)

POS_BASE = {
    #       speed athl  strength handle
    "PG": (78, 74, 45, 80),
    "SG": (76, 74, 52, 70),
    "SF": (72, 74, 62, 60),
    "PF": (66, 70, 72, 50),
    "C": (58, 66, 80, 40),
}

# ----------------------------------------------------------------------------- pooling


def pooled(name, cur_row, group):
    """Return dict of weighted totals + minutes for the player."""
    t = dict(min=0.0, orb=0.0, drb=0.0, ast=0.0, stl=0.0, blk=0.0, tov=0.0, pf=0.0,
             fgm=0.0, fga=0.0, tpm=0.0, tpa=0.0, ftm=0.0, fta=0.0)
    info = dict(cur_gp=0, cur_gs=0, cur_min=0.0, prev_gp=0, prev_min=0.0, cur_mpg=0.0, prev_mpg=0.0)
    if cur_row:
        (_, gp, gs, mpg, orb, drb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta) = cur_row
        w = 1.0
        t["min"] += w * gp * mpg
        for k, v in zip(("orb", "drb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta"),
                        (orb, drb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta)):
            t[k] += w * gp * v
        info.update(cur_gp=gp, cur_gs=gs, cur_min=gp * mpg, cur_mpg=mpg)
    prev = R.PREV.get(name)
    if prev and prev[2] is not None:
        (g, mp, fgm, fga, tpm, tpa, ftm, fta, orb, drb, ast, stl, blk, tov, pf) = prev
        w = W_PREV
        t["min"] += w * g * mp
        for k, v in zip(("orb", "drb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta"),
                        (orb, drb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta)):
            t[k] += w * g * v
        info.update(prev_gp=g, prev_min=g * mp, prev_mpg=mp)
    elif prev:
        info.update(prev_gp=prev[0], prev_min=prev[0] * prev[1], prev_mpg=prev[1])
    return t, info


def shrink(t, group):
    p = PRIOR[group]
    M = t["min"]
    out = {}
    for k in ("orb", "drb", "ast", "stl", "blk", "tov", "pf", "fga", "tpa", "fta"):
        K = K_MIN[k]
        out[k] = 36.0 * (t[k] + K * p[k] / 36.0) / (M + K)
    # percentages
    two_att = t["fga"] - t["tpa"]
    two_made = t["fgm"] - t["tpm"]
    out["tp_pct"] = (t["tpm"] + K_ATT["tp"] * p["tp_pct"]) / (t["tpa"] + K_ATT["tp"])
    out["ft_pct"] = (t["ftm"] + K_ATT["ft"] * p["ft_pct"]) / (t["fta"] + K_ATT["ft"])
    out["two_pct"] = (two_made + K_ATT["two"] * p["two_pct"]) / (max(two_att, 0) + K_ATT["two"])
    out["tpa"] = min(out["tpa"], out["fga"] * 0.95)
    # box-score value per 36 from shrunk components
    two_a = out["fga"] - out["tpa"]
    fgm = two_a * out["two_pct"] + out["tpa"] * out["tp_pct"]
    pts = 2 * two_a * out["two_pct"] + 3 * out["tpa"] * out["tp_pct"] + out["fta"] * out["ft_pct"]
    reb = out["orb"] + out["drb"]
    eff = (pts + reb + out["ast"] + out["stl"] + out["blk"]
           - (out["fga"] - fgm) - (out["fta"] - out["fta"] * out["ft_pct"]) - out["tov"])
    out.update(pts=pts, reb=reb, eff=eff)
    out["usage"] = out["fga"] + 0.44 * out["fta"] + out["tov"]
    out["three_rate"] = out["tpa"] / max(out["fga"], 1e-6)
    return out, M


_ZERO = dict(min=0.0, orb=0.0, drb=0.0, ast=0.0, stl=0.0, blk=0.0, tov=0.0, pf=0.0,
             fgm=0.0, fga=0.0, tpm=0.0, tpa=0.0, ftm=0.0, fta=0.0)
PRIOR_EFF = {g: shrink(dict(_ZERO), g)[0]["eff"] for g in PRIOR}

# ----------------------------------------------------------------------------- rating

def rate(pl, s, M, info, age, ht, group):
    pos = pl["pos"]
    sp_b, ath_b, str_b, hd_b = POS_BASE[pos]

    # age adjustment (only if we know it)
    age_pen = 0.0
    if age is not None and age >= 30:
        age_pen = (age - 29) * 1.3
    ath_pen = 0.0 if age is None or age < 30 else (age - 29) * 1.6
    young = 1.0 if (age is not None and age <= 24) else 0.0

    three_r = pw(s["tp_pct"], [(.26, 25), (.30, 45), (.33, 55), (.355, 66), (.38, 76), (.40, 83), (.43, 91), (.46, 97)])
    ft_r = pw(s["ft_pct"], [(.55, 30), (.65, 45), (.70, 55), (.77, 68), (.82, 78), (.87, 88), (.92, 96)])
    adj_two = s["two_pct"] - PRIOR[group]["two_pct"] + 0.52
    two_r = pw(adj_two, [(.40, 35), (.46, 50), (.50, 60), (.55, 72), (.60, 82), (.65, 90), (.70, 96)])
    ftrate_r = pw(s["fta"], [(1, 40), (3, 58), (5, 75), (7, 88), (9, 95), (11, 98)])

    three = 0.8 * three_r + 0.2 * ft_r
    midr = 0.45 * ft_r + 0.35 * three_r + 0.20 * two_r
    finishing = 0.8 * two_r + 0.2 * ftrate_r
    draw = ftrate_r

    ast_r = pw(s["ast"], [(1.0, 30), (1.5, 38), (3, 50), (4.5, 62), (6, 72), (8, 82), (10, 91), (12, 97)])
    passing = ast_r - max(0.0, s["tov"] - 3.0) * 2
    handle = hd_b + 0.45 * (ast_r - 60) - 4 * (s["tov"] - 2.2)

    speed = sp_b - age_pen + young
    athl = ath_b - ath_pen + young
    strength = str_b + ((ht - 78) * 1.5 if ht else 0)
    dunk = {"G": 45, "F": 62, "C": 72}[group] + ((ht - 78) * 1.5 if ht else 0) + 0.3 * (finishing - 65) + 0.25 * (athl - 70)

    oreb = pw(s["orb"], [(0.2, 25), (0.7, 42), (1.5, 58), (2.5, 72), (3.5, 83), (4.5, 90), (6, 97)])
    dreb = pw(s["drb"], [(1.5, 25), (3, 45), (4.5, 58), (6, 70), (8, 82), (10, 92), (12, 97)])
    stl_r = pw(s["stl"], [(0.3, 25), (0.7, 42), (1.0, 55), (1.5, 68), (2.0, 80), (2.5, 90), (3.0, 96)])
    blk_r = pw(s["blk"], [(0.1, 25), (0.3, 38), (0.6, 50), (1.0, 62), (1.5, 75), (2.0, 84), (3.0, 95)])
    perim = 0.6 * stl_r + 0.4 * speed
    interior = 0.55 * blk_r + 0.25 * dreb + 0.20 * strength

    # stamina proxy: role minutes (blended) with age penalty
    gp_w = info["cur_gp"] + W_PREV * info["prev_gp"]
    mpg = ((info["cur_gp"] * info["cur_mpg"] + W_PREV * info["prev_gp"] * info["prev_mpg"]) / gp_w) if gp_w > 0 else 12.0
    stamina = pw(mpg, [(5, 55), (12, 62), (20, 72), (30, 84), (36, 93), (40, 97)]) - 0.8 * max(0, (age or 0) - 33)

    usage = pw(s["usage"], [(8, 20), (12, 40), (16, 60), (20, 78), (24, 90), (28, 97)])

    # overall
    sw = 300.0 / (M + 300.0)  # 1.0 with no data -> ~0 with lots
    # Bigs post higher EFF at equal value; remove most of that bias for unknowns, ~40% of it for proven players.
    corr = (PRIOR_EFF[group] - PRIOR_EFF["G"]) * (0.4 + 0.6 * sw)
    ovr = 40 + 1.7 * (s["eff"] - corr)
    ovr -= 10.0 * sw * sw                                  # replacement discount for thin samples
    ovr += max(-2.5, min(2.5, 0.12 * (mpg - 20)))          # coach-trust / role signal
    spec = max(perim, interior, three, passing)
    ovr += 0.25 * max(0.0, spec - 70)                      # credit for elite specialists the box score underrates
    attrs = dict(
        three_pt=clamp(three), mid_range=clamp(midr), free_throw=clamp(ft_r), finishing=clamp(finishing),
        dunk=clamp(dunk), draw_foul=clamp(draw), passing=clamp(passing), ball_handle=clamp(handle),
        speed=clamp(speed), athleticism=clamp(athl), strength=clamp(strength),
        off_rebound=clamp(oreb), def_rebound=clamp(dreb),
        perimeter_def=clamp(perim), interior_def=clamp(interior), steal=clamp(stl_r), block=clamp(blk_r),
        stamina=clamp(stamina), usage=clamp(usage),
    )
    return clamp(ovr, 45, 99), attrs, s


def traits(a):
    out = []
    if a["three_pt"] >= 82: out.append("Sharpshooter")
    if a["perimeter_def"] >= 82: out.append("Lockdown")
    if a["block"] >= 82 or a["interior_def"] >= 85: out.append("Rim Protector")
    if a["passing"] >= 82: out.append("Playmaker")
    if a["off_rebound"] >= 85 or a["def_rebound"] >= 85: out.append("Glass Cleaner")
    if a["finishing"] >= 85: out.append("Finisher")
    if a["free_throw"] >= 88: out.append("Free-Throw Ace")
    if a["draw_foul"] >= 88: out.append("Foul Magnet")
    if a["dunk"] >= 85: out.append("Posterizer")
    return out


def confidence(M):
    return "high" if M >= 800 else "medium" if M >= 250 else "low" if M >= 40 else "none"


# ----------------------------------------------------------------------------- main

def main():
    overrides = json.load(open(os.path.join(DATA, "overrides.json"))) if os.path.exists(os.path.join(DATA, "overrides.json")) else {"overrides": []}
    ov_by_name = {}
    for o in overrides["overrides"]:
        ov_by_name.setdefault(o["name"], []).append(o)

    players, raw_dump, teams_out = [], {}, {}
    for team, roster in R.ROSTERS.items():
        cur_rows = {r[0]: r for r in R.CUR_PER_GAME.get(team, [])}
        raw_dump[team] = []
        team_players = []
        for (name, num, pos, ht, dob, age, status) in roster:
            if dob and age is None:
                b = date.fromisoformat(dob)
                age = AS_OF.year - b.year - ((AS_OF.month, AS_OF.day) < (b.month, b.day))
            group = pos_group(pos)
            t, info = pooled(name, cur_rows.get(name), group)
            s, M = shrink(t, group)
            ovr, attrs, _ = rate(dict(pos=pos), s, M, info, age, ht, group)

            # overrides (judgment, labeled)
            applied = []
            for o in ov_by_name.get(name, []):
                for k, d in o.get("delta", {}).items():
                    if k == "overall":
                        ovr = clamp(ovr + d, 45, 99)
                    else:
                        attrs[k] = clamp(attrs[k] + d)
                    applied.append(dict(field=k, delta=d, reason=o["reason"]))

            first, _, last = name.partition(" ")
            cur = cur_rows.get(name)
            gs_frac = (info["cur_gs"] / R.TEAM_GAMES[team]) if info["cur_gp"] else 0.0
            # a regular starter who missed the first weeks still starts (started nearly every game he played)
            if info["cur_gp"] >= 3:
                gs_frac = max(gs_frac, 0.9 * info["cur_gs"] / info["cur_gp"])
            injury = R.INJURIES.get(name)
            p = dict(
                id=f"{team.lower()}-{slug(name)}", team=team, name=name, first=first, last=last,
                number=num, pos=pos, height_in=ht, age=age, roster_status=status,
                injury=injury, available=injury is None,
                overall=ovr, attrs=attrs, traits=traits(attrs),
                tendencies=dict(
                    usage_per36=round(s["usage"], 1), three_rate=round(s["three_rate"], 3),
                    fta_per36=round(s["fta"], 2), pf_per36=round(s["pf"], 2), tov_per36=round(s["tov"], 2),
                    ast_per36=round(s["ast"], 2), mpg_role=round(
                        (info["cur_mpg"] if info["cur_gp"] else info["prev_mpg"]), 1)),
                per36=dict(pts=round(s["pts"], 1), reb=round(s["reb"], 1), ast=round(s["ast"], 1),
                           stl=round(s["stl"], 2), blk=round(s["blk"], 2), eff=round(s["eff"], 1),
                           tp_pct=round(s["tp_pct"], 3), ft_pct=round(s["ft_pct"], 3), two_pct=round(s["two_pct"], 3)),
                sample=dict(cur_gp=info["cur_gp"], cur_gs=info["cur_gs"], cur_min=round(info["cur_min"]),
                            prev_gp=info["prev_gp"], prev_min=round(info["prev_min"]),
                            pooled_min=round(M), confidence=confidence(M)),
                overrides=applied,
                _gs_frac=gs_frac,
            )
            players.append(p)
            team_players.append(p)
            raw_dump[team].append(dict(name=name, cur=cur, prev=R.PREV.get(name)))

        # lineup / rotation inference
        avail = [p for p in team_players if p["available"]]
        starters = sorted(avail, key=lambda p: (-p["_gs_frac"], -p["overall"]))[:5]
        # keep pos balance sane: at least one C-or-PF among starters when possible
        if not any(p["pos"] in ("C", "PF") for p in starters):
            big = next((p for p in sorted(avail, key=lambda p: -p["overall"]) if p["pos"] in ("C", "PF")), None)
            if big:
                starters[-1] = big
        sid = {p["id"] for p in starters}
        rest = sorted([p for p in avail if p["id"] not in sid],
                      key=lambda p: (-(p["sample"]["cur_gp"] > 0), -p["tendencies"]["mpg_role"], -p["overall"]))
        for p in team_players:
            if p["id"] in sid:
                p["role"] = "starter"
            elif not p["available"]:
                p["role"] = "injured"
            elif p in rest[:5]:
                p["role"] = "rotation"
            elif p["sample"]["cur_gp"] == 0 and p["sample"]["prev_gp"] == 0:
                p["role"] = "deep_bench"
            else:
                p["role"] = "bench"
        order = [p["id"] for p in starters] + [p["id"] for p in rest] + [p["id"] for p in team_players if not p["available"]]
        meta = R.TEAM_META[team]
        ovrs = sorted((p["overall"] for p in avail), reverse=True)
        teams_out[team] = dict(
            id=team, name=meta["name"], city=meta["city"], nickname=meta["nick"], colors=meta["colors"],
            roster_size=len(team_players), games_played=R.TEAM_GAMES[team],
            default_starters=[p["id"] for p in starters], depth_order=order,
            team_overall=round(0.55 * sum(ovrs[:5]) / 5 + 0.45 * sum(ovrs[5:10]) / 5, 1),
        )

    for p in players:
        p.pop("_gs_frac", None)

    meta = dict(season="2026-27", as_of=R.AS_OF, scale="0-99", model="shrinkage-v1",
                prev_weight=W_PREV, note="Ratings are generated from box-score stats; see docs/RATINGS.md. "
                "Defense/speed/handle/strength/athleticism are proxies.")
    json.dump(dict(meta=meta, players=players), open(os.path.join(DATA, "players.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(dict(meta=meta, teams=teams_out), open(os.path.join(DATA, "teams.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(dict(as_of=R.AS_OF, team_games=R.TEAM_GAMES,
                   columns_cur=["name", "gp", "gs", "mpg", "orb", "drb", "ast", "stl", "blk", "tov", "pf",
                                "fgm", "fga", "tpm", "tpa", "ftm", "fta"],
                   columns_prev=["g", "mp", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "orb", "drb", "ast", "stl",
                                 "blk", "tov", "pf"],
                   teams=raw_dump), open(os.path.join(DATA, "raw_stats.json"), "w"), indent=1, ensure_ascii=False)

    attr_keys = list(players[0]["attrs"].keys())
    with open(os.path.join(DATA, "ratings.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["team", "name", "pos", "num", "role", "overall", *attr_keys, "traits", "confidence", "injury"])
        for p in sorted(players, key=lambda p: (p["team"], -p["overall"])):
            w.writerow([p["team"], p["name"], p["pos"], p["number"], p["role"], p["overall"],
                        *[p["attrs"][k] for k in attr_keys], "|".join(p["traits"]), p["sample"]["confidence"],
                        p["injury"] or ""])
    print(f"wrote {len(players)} players")


if __name__ == "__main__":
    main()
