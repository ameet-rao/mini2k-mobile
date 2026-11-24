#!/usr/bin/env python3
"""Builds data/franchise.json: the extra per-player fields Franchise mode needs.

It never touches players.json / teams.json (the other modes read those, so they stay byte-for-byte the same).
Inputs (saved pages, read 2026-11-23 through Firecrawl):
  data/sources/bbref_contracts_2026-11-23.md   basketball-reference contracts/players.html (salaries by season)
  data/sources/bbref_advanced_2026-11-23.md    basketball-reference leagues/NBA_2027_advanced.html (age, rate stats)
Everything else (potential, peak ages, work ethic, durability, personality, mood traits) is generated
with a fixed seed per player id (PRD 19.4, all "Derived"). Override any field in data/overrides.json under
"franchise": {"<player id>": {"pot": 88, ...}}.

Run: python3 tools/build_franchise.py
"""
import json, re, unicodedata, hashlib, random, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'sources')
CAP = 164_961_000
MIN0 = round(0.00823 * CAP)

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z ]', '', s)
    s = re.sub(r'\b(jr|sr|ii|iii|iv)\b', '', s)
    return ' '.join(s.split())

def strip_link(s):
    return re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', s).replace('**', '').strip()

def rows(name):
    out = []
    for line in open(os.path.join(SRC, name), encoding='utf8'):
        if not line.startswith('| ') or line.startswith('| Rk') or line.startswith('| ---'):
            continue
        cells = [strip_link(x.strip()) for x in line.strip().strip('|').split('|')]
        if cells and cells[0].isdigit():
            out.append(cells)
    return out

def money(s):
    s = s.replace('$', '').replace(',', '').strip()
    return int(s) if s.isdigit() else 0

def num(s, d=None):
    try:
        return float(s)
    except ValueError:
        return d

TEAM_FIX = {'PHO': 'PHX', 'BRK': 'BKN', 'CHO': 'CHA'}

def main():
    players = json.load(open(os.path.join(ROOT, 'data', 'players.json')))['players']
    overrides = json.load(open(os.path.join(ROOT, 'data', 'overrides.json'))).get('franchise', {})

    contracts = {}
    for c in rows('bbref_contracts_2026-11-23.md'):
        # Rk | Player | Tm | 2026-27 .. 2031-32 | Guaranteed
        sal = [money(x) for x in c[3:9]]
        while sal and sal[-1] == 0:
            sal.pop()
        if not sal or sal[0] == 0:
            continue
        contracts.setdefault(norm(c[1]), []).append({'team': TEAM_FIX.get(c[2], c[2]), 'salaries': sal, 'guaranteed': money(c[9])})

    adv = {}
    for a in rows('bbref_advanced_2026-11-23.md'):
        # Rk Player Age Team Pos G GS MP PER TS% 3PAr FTr ORB% DRB% TRB% AST% STL% BLK% TOV% USG%
        k = norm(a[1])
        mp = num(a[7], 0)
        if k in adv and adv[k]['mp'] >= mp:
            continue
        adv[k] = dict(age=int(num(a[2], 25)), mp=mp, per=num(a[8]), ts=num(a[9]), orb=num(a[12]), drb=num(a[13]),
                      ast=num(a[15]), stl=num(a[16]), blk=num(a[17]), tov=num(a[18]), usg=num(a[19]))

    out, stats = {}, {'contract': 0, 'age': 0, 'twoway': 0}
    for p in players:
        pid = p['id']
        rng = random.Random(int(hashlib.md5(pid.encode()).hexdigest()[:8], 16))
        k = norm(p['name'])
        a = adv.get(k)
        if a:
            age = a['age']; stats['age'] += 1
        else:
            age = rng.choice([21, 22, 22, 23, 23, 24, 25, 26, 27])
        ovr = p['overall']
        # contract: prefer the row for this team, else any row with this name
        cands = contracts.get(k, [])
        c = next((x for x in cands if x['team'] == p['team']), cands[0] if cands else None)
        if c:
            stats['contract'] += 1
            total = sum(c['salaries'])
            opt = None
            if len(c['salaries']) > 1 and c['guaranteed'] < total - 1000:
                # the last year is not guaranteed: an option. bbref marks the kind by colour only, so we guess:
                # rookie-scale-age players -> team option, veterans -> player option. (Derived)
                opt = 'TO' if age <= 24 else 'PO'
            contract = {'salaries': c['salaries'], 'option': opt, 'type': 'std'}
        else:
            contract = {'salaries': [MIN0], 'option': None, 'type': 'unsigned'}   # two-way / camp deal: decided at league start
        # hidden generated fields (PRD 19.4)
        big = p['pos'] in ('PF', 'C')
        ps = max(24, min(29, round(rng.gauss(26, 1.2)) + (1 if big else 0)))
        pe = ps + max(2, min(7, round(rng.gauss(4, 1.2))))
        if p['attrs']['athleticism'] >= 85: pe -= 1
        if p['attrs']['three_pt'] >= 80: pe += 1
        w = max(0, min(100, round(rng.gauss(55, 18))))
        pot = min(99, round(ovr + max(0, ps - age) * 1.6 * (1 + (w - 50) / 200)))
        dur = max(20, min(100, round(rng.gauss(70, 15) - (0 if p['available'] else 15))))
        pers = rng.choices(['alpha', 'realtalk', 'praise', 'teamfirst', 'quietpro', 'wildcard'], [10, 16, 16, 24, 22, 12])[0]
        if ovr >= 82 and rng.random() < 0.5:
            pers = 'alpha'
        traits = rng.sample(['F', 'L', '$', 'W'], rng.choice([1, 1, 2]))
        rec = dict(age=age, yos=max(0, min(20, age - 20 + rng.choice([-1, 0, 0, 1]))), contract=contract,
                   pot=pot, ps=ps, pe=pe, work=w, dur=dur, pers=pers, mood=traits)
        if a:
            rec['adv'] = {x: a[x] for x in ('usg', 'ast', 'orb', 'drb', 'stl', 'blk', 'tov', 'ts', 'per') if a[x] is not None}
        rec.update(overrides.get(pid, {}))
        out[pid] = rec

    meta = {'season': '2026-27', 'cap': CAP, 'built_from': ['bbref_contracts_2026-11-23.md', 'bbref_advanced_2026-11-23.md'],
            'note': 'Generated by tools/build_franchise.py; do not hand-edit. Options and years of service are estimates (Derived).',
            'matched': stats}
    with open(os.path.join(ROOT, 'data', 'franchise.json'), 'w') as f:
        json.dump({'meta': meta, 'players': out}, f, separators=(',', ':'))
    print('franchise.json:', len(out), 'players', stats)

if __name__ == '__main__':
    main()
