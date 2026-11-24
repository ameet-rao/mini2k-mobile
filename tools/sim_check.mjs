#!/usr/bin/env node
// Calibration check: simulate N games per matchup headlessly, print league-style averages,
// and exit non-zero if anything is outside tolerance.
//
//   node tools/sim_check.mjs                 # 150 games per matchup (91 matchups, 14 teams)
//   node tools/sim_check.mjs --games 100 --seed 7
//   node tools/sim_check.mjs --players       # also print per-player averages
//   node tools/sim_check.mjs --quarter 6     # shorter quarters (per-48 stats are normalized)

import { loadData } from './load_data.mjs';
import { Game } from '../src/engine/game.js';
import { deriveBoxScore } from '../src/engine/boxscore.js';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const GAMES = Number(arg('games', 150)); // per matchup; 14 teams = 91 matchups
const SEED = Number(arg('seed', 12345));
const QUARTER = Number(arg('quarter', 12));
const SHOW_PLAYERS = args.includes('--players');

// Targets are per team per 48 minutes.
const TARGETS = {
  pts: { target: 113, tol: 4, label: 'PTS' },
  fg: { target: 0.47, tol: 0.015, label: 'FG%' },
  tp: { target: 0.36, tol: 0.015, label: '3P%' },
  ft: { target: 0.78, tol: 0.025, label: 'FT%' },
  poss: { target: 99, tol: 3, label: 'POSS' },
  tov: { target: 14, tol: 1.5, label: 'TOV' },
  pf: { target: 20, tol: 2, label: 'PF' },
};
const EXTRA = ['fga', 'tpa', 'fta', 'reb', 'oreb', 'ast', 'stl', 'blk', 'scv'];

const data = loadData();
const teamIds = Object.keys(data.teams);
const matchups = [];
for (let i = 0; i < teamIds.length; i++) for (let j = i + 1; j < teamIds.length; j++) matchups.push([teamIds[i], teamIds[j]]);

function teamGameStats(t, minutes48) {
  const T = t.totals;
  const k = 48 / minutes48; // normalize OT / short quarters to per-48
  return {
    pts: T.pts * k, fgm: T.fgm * k, fga: T.fga * k, tpm: T.tpm * k, tpa: T.tpa * k, ftm: T.ftm * k, fta: T.fta * k,
    poss: t.possessions * k, tov: T.tov * k, pf: T.pf * k, reb: (T.reb) * k, oreb: T.oreb * k, ast: T.ast * k,
    stl: T.stl * k, blk: T.blk * k, scv: t.shotClockViolations * k,
  };
}

function summarize(rows) {
  const sum = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] ?? 0) + v;
  const n = rows.length;
  const avg = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / n]));
  avg.fg = sum.fgm / sum.fga;
  avg.tp = sum.tpm / sum.tpa;
  avg.ft = sum.ftm / sum.fta;
  return avg;
}

const t0 = Date.now();
const all = [];
const perMatchup = [];
const wins = {};
const playerAgg = {};
let seed = SEED, ots = 0, foulOuts = 0, totalGames = 0, ties = 0;

for (const [a, b] of matchups) {
  const rows = [];
  let aWins = 0, margin = 0;
  for (let g = 0; g < GAMES; g++) {
    const [home, away] = g % 2 === 0 ? [a, b] : [b, a];
    const game = new Game(data, { home, away, seed: seed++, rules: { quarterMinutes: QUARTER } });
    game.simToEnd();
    const box = deriveBoxScore(game.events);
    if (box.home.totals.pts !== game.state.score.home || box.away.totals.pts !== game.state.score.away) {
      console.error('Box score does not match the scoreboard!', game.seed);
      process.exit(2);
    }
    if (box.final.home === box.final.away) ties++;
    const minutes = QUARTER * 4 + Math.max(0, box.periods - 4) * 5;
    const mins48 = minutes * (12 / QUARTER);
    if (box.periods > 4) ots++;
    totalGames++;
    for (const side of ['home', 'away']) {
      const s = teamGameStats(box[side], mins48);
      rows.push(s);
      all.push(s);
      foulOuts += box[side].fouledOut.length;
      if (SHOW_PLAYERS) {
        for (const id of box[side].order) {
          const l = box[side].players[id];
          const agg = (playerAgg[id] ??= { gp: 0, sec: 0, pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, stl: 0, blk: 0, tov: 0, pf: 0 });
          agg.gp += 1;
          for (const k of Object.keys(agg)) if (k !== 'gp') agg[k] += l[k];
        }
      }
    }
    const aSide = home === a ? 'home' : 'away';
    if (box.winner === aSide) aWins++;
    margin += box[aSide].totals.pts - box[aSide === 'home' ? 'away' : 'home'].totals.pts;
  }
  perMatchup.push({ name: `${a}-${b}`, avg: summarize(rows), aWin: aWins / GAMES, margin: margin / GAMES, a, b });
  wins[`${a}-${b}`] = aWins / GAMES;
}

const league = summarize(all);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ---------- print ----------
const f1 = (x) => x.toFixed(1);
const fp = (x) => (x * 100).toFixed(1);
const cols = [
  ['PTS', (s) => f1(s.pts)], ['FG%', (s) => fp(s.fg)], ['3P%', (s) => fp(s.tp)], ['FT%', (s) => fp(s.ft)],
  ['POSS', (s) => f1(s.poss)], ['TOV', (s) => f1(s.tov)], ['PF', (s) => f1(s.pf)],
  ['FGA', (s) => f1(s.fga)], ['3PA', (s) => f1(s.tpa)], ['FTA', (s) => f1(s.fta)], ['REB', (s) => f1(s.reb)],
  ['OREB', (s) => f1(s.oreb)], ['AST', (s) => f1(s.ast)], ['STL', (s) => f1(s.stl)], ['BLK', (s) => f1(s.blk)],
  ['SCV', (s) => s.scv.toFixed(2)],
];
const pad = (s, n) => String(s).padStart(n);
console.log(`\nsim_check: ${GAMES} games x ${matchups.length} matchups = ${totalGames} games (${QUARTER}-min quarters, seed ${SEED}) in ${elapsed}s`);
console.log('Per team per game (per-48):\n');
console.log(pad('matchup', 9) + cols.map(([h]) => pad(h, 7)).join('') + pad('W%(1st)', 9) + pad('margin', 8));
for (const m of perMatchup) {
  console.log(pad(m.name, 9) + cols.map(([, fn]) => pad(fn(m.avg), 7)).join('') + pad(fp(m.aWin), 9) + pad(f1(m.margin), 8));
}
console.log(pad('LEAGUE', 9) + cols.map(([, fn]) => pad(fn(league), 7)).join(''));
console.log(pad('target', 9) + [
  '113', '47.0', '36.0', '78.0', '99', '14', '20',
].map((x) => pad(x, 7)).join(''));
console.log(`\nOT games: ${fp(ots / totalGames)}%   foul-outs/game: ${(foulOuts / totalGames).toFixed(2)}   ties at final: ${ties}`);

if (SHOW_PLAYERS) {
  for (const tid of teamIds) {
    console.log(`\n${tid}`);
    console.log(pad('player', 26) + ['GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'FG%', '3PA', '3P%'].map((h) => pad(h, 6)).join(''));
    for (const id of data.teams[tid].depth_order) {
      const a = playerAgg[id];
      if (!a) continue;
      const g = a.gp;
      console.log(pad(data.byId[id].name.slice(0, 25), 26) + [
        g, f1(a.sec / 60 / g), f1(a.pts / g), f1(a.reb / g), f1(a.ast / g), f1(a.stl / g), f1(a.blk / g), f1(a.tov / g), f1(a.pf / g),
        fp(a.fgm / Math.max(1, a.fga)), f1(a.tpa / g), fp(a.tpm / Math.max(1, a.tpa)),
      ].map((x) => pad(x, 6)).join(''));
    }
  }
}

// ---------- tolerance ----------
const failures = [];
for (const [k, { target, tol, label }] of Object.entries(TARGETS)) {
  const v = league[k];
  if (Math.abs(v - target) > tol) failures.push(`${label} ${k === 'fg' || k === 'tp' || k === 'ft' ? fp(v) : f1(v)} (target ${k === 'fg' || k === 'tp' || k === 'ft' ? fp(target) : target} +- ${k === 'fg' || k === 'tp' || k === 'ft' ? fp(tol) : tol})`);
}
for (const m of perMatchup) {
  if (Math.abs(m.avg.pts - 113) > 8) failures.push(`${m.name} PTS ${f1(m.avg.pts)} outside 105-121`);
}
if (ties) failures.push(`${ties} games ended tied`);

if (failures.length) {
  console.log('\nFAIL:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('\nPASS: all league averages within tolerance.');
