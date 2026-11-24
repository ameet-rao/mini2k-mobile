#!/usr/bin/env node
// Rules + engine invariant tests. No dependencies: `node tools/test_rules.mjs`.

import assert from 'node:assert/strict';
import { loadData } from './load_data.mjs';
import { Game } from '../src/engine/game.js';
import { deriveBoxScore } from '../src/engine/boxscore.js';
import { describe } from '../src/engine/pbp.js';
import { Rng } from '../src/engine/rng.js';
import * as R from '../src/engine/rules.js';

const data = loadData();
const rules = R.makeRules();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); }
}
const newGame = (o = {}) => new Game(data, { home: 'PHI', away: 'BOS', seed: 42, ...o });
const playedGames = [];
for (let seed = 1; seed <= 60; seed++) {
  const teams = Object.keys(data.teams);
  const NT = teams.length;
  const home = teams[(seed * 5) % NT], away = teams[(seed * 5 + 1 + (seed % 3)) % NT];
  if (home === away) continue;
  playedGames.push(new Game(data, { home, away, seed }).simToEnd());
}

console.log('rules.js');
test('period lengths: 12:00 quarters, 5:00 overtime, menu lengths', () => {
  assert.equal(R.periodLength(1, rules), 720);
  assert.equal(R.periodLength(5, rules), 300);
  for (const q of [5, 6, 8, 12]) assert.equal(R.periodLength(4, R.makeRules({ quarterMinutes: q })), q * 60);
});
test('shot clock: 24 on made FG / def rebound / turnover', () => {
  for (const why of ['made', 'defreb', 'turnover']) assert.equal(R.shotClockAfter(why, 3, rules), 24);
});
test('shot clock: 14 on offensive rebound', () => {
  assert.equal(R.shotClockAfter('oreb', 2, rules), 14);
  assert.equal(R.shotClockAfter('oreb', 20, rules), 14);
});
test('shot clock: kicked ball / frontcourt foul -> stays if above 14, else 14', () => {
  assert.equal(R.shotClockAfter('kicked', 6, rules), 14);
  assert.equal(R.shotClockAfter('foul_frontcourt', 6, rules), 14);
  assert.equal(R.shotClockAfter('foul_frontcourt', 19, rules), 19);
});
test('shot clock off when game clock is shorter', () => {
  assert.equal(R.shotClockActive(20, 24), false);
  assert.equal(R.shotClockActive(30, 24), true);
});
test('bonus on 5th team foul of a quarter, 4th in OT', () => {
  assert.equal(R.isPenaltyFoul(4, 0, 400, 2, rules), false);
  assert.equal(R.isPenaltyFoul(5, 0, 400, 2, rules), true);
  assert.equal(R.isPenaltyFoul(3, 0, 200, 5, rules), false);
  assert.equal(R.isPenaltyFoul(4, 0, 200, 5, rules), true);
});
test('last-2:00 rule: 2nd team foul in final two minutes is a penalty (optional)', () => {
  assert.equal(R.isPenaltyFoul(2, 1, 90, 1, rules), false);
  assert.equal(R.isPenaltyFoul(2, 2, 90, 1, rules), true);
  assert.equal(R.isPenaltyFoul(2, 2, 90, 1, R.makeRules({ twoMinuteRule: false })), false);
});
test('shooting foul free throws: 2, 3 on a three, 1 on and-1', () => {
  assert.equal(R.shootingFoulFTs('rim', false), 2);
  assert.equal(R.shootingFoulFTs('mid', false), 2);
  assert.equal(R.shootingFoulFTs('three', false), 3);
  assert.equal(R.shootingFoulFTs('three', true), 1);
  assert.equal(R.shootingFoulFTs('rim', true), 1);
});
test('6 personal fouls = foul-out', () => {
  assert.equal(R.isFouledOut(5, rules), false);
  assert.equal(R.isFouledOut(6, rules), true);
});
test('foul trouble thresholds: 2 in Q1, 3 in 1H, 4 before 8:00 of Q4', () => {
  assert.equal(R.inFoulTrouble(2, 1, 300, rules), true);
  assert.equal(R.inFoulTrouble(2, 2, 300, rules), false);
  assert.equal(R.inFoulTrouble(3, 2, 300, rules), true);
  assert.equal(R.inFoulTrouble(4, 4, 600, rules), true);
  assert.equal(R.inFoulTrouble(4, 4, 400, rules), false);
  assert.equal(R.inFoulTrouble(5, 5, 100, rules), false);
});
test('substitutions only on dead balls; after a make only in last 2:00 of Q4/OT', () => {
  assert.equal(R.canSubstitute('foul', 1, 500, rules), true);
  assert.equal(R.canSubstitute('timeout', 2, 500, rules), true);
  assert.equal(R.canSubstitute('made', 2, 500, rules), false);
  assert.equal(R.canSubstitute('made', 4, 100, rules), true);
  assert.equal(R.canSubstitute('live', 1, 500, rules), false);
});
test('tie after regulation or OT -> not over', () => {
  assert.equal(R.gameIsOver(4, 100, 100, rules), false);
  assert.equal(R.gameIsOver(4, 101, 100, rules), true);
  assert.equal(R.gameIsOver(3, 101, 100, rules), false);
  assert.equal(R.gameIsOver(5, 110, 110, rules), false);
});
test('alternating possession: tip winner gets Q1+Q4, loser Q2+Q3, jump ball in OT', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((p) => R.periodStartPossession(p, 'home', rules)), ['home', 'away', 'away', 'home', null]);
});

console.log('rng.js');
test('mulberry32 is deterministic and in [0,1)', () => {
  const a = new Rng(99), b = new Rng(99);
  for (let i = 0; i < 1000; i++) { const x = a.next(); assert.equal(x, b.next()); assert.ok(x >= 0 && x < 1); }
});

console.log('engine primitives');
test('made three is worth 3, made rim shot 2, updates scoreboard', () => {
  const g = newGame(); g.step();
  const off = g.state.possession, sh = g.state.teams[off].onCourt[0];
  g.resolveShot({ offSide: off, shooter: sh, type: 'three', defender: g.matchup(sh, off), forceMade: true, forceFoul: false });
  assert.equal(g.state.score[off], 3);
  assert.equal(g.state.shotClock, 24);
  assert.notEqual(g.state.possession, off);
});
test('fouled on a missed three -> exactly 3 free throws; and-1 -> basket counts + 1 FT', () => {
  const g = newGame(); g.step();
  let off = g.state.possession, sh = g.state.teams[off].onCourt[0];
  g.resolveShot({ offSide: off, shooter: sh, type: 'three', defender: g.matchup(sh, off), forceMade: false, forceFoul: true });
  assert.equal(g.events.filter((e) => e.type === 'ft').length, 3);
  const g2 = newGame(); g2.step();
  off = g2.state.possession; sh = g2.state.teams[off].onCourt[0];
  g2.resolveShot({ offSide: off, shooter: sh, type: 'rim', defender: g2.matchup(sh, off), forceMade: true, forceFoul: true });
  const fts = g2.events.filter((e) => e.type === 'ft');
  assert.equal(fts.length, 1);
  assert.equal(g2.state.score[off], 2 + (fts[0].made ? 1 : 0));
  assert.ok(g2.events.some((e) => e.type === 'shot' && e.and1));
});
test('5th team foul in a quarter is flagged as penalty and gives 2 FTs', () => {
  const g = newGame(); g.step();
  const off = g.state.possession, def = off === 'home' ? 'away' : 'home';
  const d = g.state.teams[def].onCourt, o = g.state.teams[off].onCourt;
  let res;
  for (let i = 0; i < 5; i++) res = g.commitFoul(def, d[i % 5], off, o[0], 'personal');
  assert.equal(res.penalty, true);
  assert.equal(g.events.filter((e) => e.type === 'foul' && e.penalty).length, 1);
});
test('offensive fouls do not count as team fouls', () => {
  const g = newGame(); g.step();
  const t = g.state.teams.home;
  g.commitFoul('home', t.onCourt[0], 'away', g.state.teams.away.onCourt[0], 'offensive');
  assert.equal(t.teamFouls, 0);
  assert.equal(t.pf[t.onCourt.includes(t.starters[0]) ? t.starters[0] : t.starters[0]], 1);
});
test('6th foul: foul_out event, removed from floor immediately, cannot return', () => {
  const g = newGame(); g.step();
  const t = g.state.teams.home, id = t.onCourt[0];
  for (let i = 0; i < 6; i++) g.commitFoul('home', id, 'away', g.state.teams.away.onCourt[0], 'offensive');
  assert.ok(g.events.some((e) => e.type === 'foul_out' && e.player === id));
  assert.ok(!t.onCourt.includes(id));
  assert.equal(t.onCourt.length, 5);
  assert.throws(() => g.substitute('home', t.onCourt[0], id));
  g.simToEnd();
  assert.ok(!g.events.some((e) => e.type === 'sub' && e.in === id && e.seq > 20));
});
test('team fouls reset every period', () => {
  const g = newGame(); g.step();
  g.commitFoul('home', g.state.teams.home.onCourt[0], 'away', g.state.teams.away.onCourt[0], 'personal');
  g.simToEnd();
  const firstFoul = g.events.find((e) => e.type === 'foul' && e.period === 2 && e.kind !== 'offensive');
  assert.equal(firstFoul.teamFouls, 1);
});
test('injured (available:false) players cannot be subbed in', () => {
  const g = new Game(data, { home: 'GSW', away: 'BOS', seed: 3 }); g.step();
  const inj = g.state.teams.home.roster.find((id) => !data.byId[id].available);
  assert.ok(inj, 'GSW should have an injured player');
  assert.throws(() => g.substitute('home', g.state.teams.home.onCourt[0], inj));
});
test('timeouts: 7 per team, decrement, cannot go below 0', () => {
  const g = newGame(); g.step();
  assert.equal(g.state.teams.home.timeouts, 7);
  for (let i = 0; i < 7; i++) assert.equal(g.callTimeout('home'), true);
  assert.equal(g.callTimeout('home'), false);
  assert.equal(g.state.teams.home.timeouts, 0);
});

console.log(`full games (${playedGames.length} seeded sims)`);
test('same seed -> identical event log; different seed -> different game', () => {
  const a = newGame({ seed: 777 }).simToEnd(), b = newGame({ seed: 777 }).simToEnd(), c = newGame({ seed: 778 }).simToEnd();
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.notEqual(JSON.stringify(a.events), JSON.stringify(c.events));
});
test('box score (from event log) matches the scoreboard and its own totals', () => {
  for (const g of playedGames) {
    const box = deriveBoxScore(g.events);
    for (const side of ['home', 'away']) {
      const t = box[side], T = t.totals;
      assert.equal(T.pts, g.state.score[side]);
      assert.equal(T.pts, 2 * (T.fgm - T.tpm) + 3 * T.tpm + T.ftm);
      assert.equal(t.byPeriod.reduce((a, b) => a + b, 0), T.pts);
      assert.equal(T.reb, T.oreb + T.dreb);
      for (const id of t.order) assert.equal(t.players[id].pf, g.state.teams[side].pf[id]);
    }
    assert.equal(box.home.totals.stl <= box.away.totals.tov, true);
    assert.equal(box.final.home, g.state.score.home);
  }
});
test('every event carries a running score that matches replaying the log', () => {
  const g = playedGames[0];
  const sc = { home: 0, away: 0 };
  for (const e of g.events) {
    if (e.type === 'shot' && e.made) sc[e.team] += e.pts;
    if (e.type === 'ft' && e.made) sc[e.team] += 1;
    if (e.type === 'shot' || e.type === 'ft') assert.deepEqual(e.score, sc);
  }
});
test('minutes: exactly 5 on the floor all game (team minutes = 5 x game length)', () => {
  for (const g of playedGames) {
    const box = deriveBoxScore(g.events);
    const len = 4 * 720 + (box.periods - 4) * 300;
    for (const side of ['home', 'away']) {
      assert.ok(Math.abs(box[side].totals.sec - 5 * len) < 1, `${box[side].totals.sec} vs ${5 * len}`);
      assert.equal(new Set(g.state.teams[side].onCourt).size, 5);
    }
  }
});
test('no game ends tied; tied after regulation -> 5:00 overtime(s)', () => {
  let ot = null;
  for (const g of playedGames) {
    assert.notEqual(g.state.score.home, g.state.score.away);
    const reg = g.events.find((e) => e.type === 'period_end' && e.period === 4);
    if (reg.score.home === reg.score.away) { assert.ok(g.state.period > 4); ot = ot ?? g; }
    else assert.equal(g.state.period, 4);
  }
  for (let seed = 1000; !ot && seed < 1400; seed++) {
    const g = newGame({ seed }).simToEnd();
    if (g.state.period > 4) ot = g;
  }
  assert.ok(ot, 'expected at least one OT game');
  const start = ot.events.find((e) => e.type === 'period_start' && e.period === 5);
  assert.equal(start.clock, 300);
  assert.ok(ot.events.some((e) => e.type === 'jump_ball' && e.period === 5));
});
test('nobody plays with 6 fouls; fouled-out and injured players never (re)enter', () => {
  for (const g of playedGames) {
    const out = new Set();
    for (const e of g.events) {
      if (e.type === 'foul') assert.ok(e.personal <= 6);
      if (e.type === 'foul_out') out.add(e.player);
      if (e.type === 'sub') { assert.ok(!out.has(e.in)); assert.ok(data.byId[e.in].available); }
      if (e.type === 'period_start') for (const id of [...e.lineups.home, ...e.lineups.away]) {
        assert.ok(!out.has(id)); assert.ok(data.byId[id].available);
      }
    }
  }
});
test('free throw shooters, scorers and rebounders are always on the floor at the time', () => {
  for (const g of playedGames) {
    const on = { home: new Set(), away: new Set() };
    for (const e of g.events) {
      if (e.type === 'period_start') { on.home = new Set(e.lineups.home); on.away = new Set(e.lineups.away); }
      if (e.type === 'sub') { on[e.team].delete(e.out); on[e.team].add(e.in); }
      if ((e.type === 'ft' || e.type === 'shot' || e.type === 'rebound') && e.player) assert.ok(on[e.team].has(e.player), `${e.type} by ${e.player} who is on the bench`);
    }
  }
});
test('substitutions only happen on dead balls (never right after a live rebound/steal)', () => {
  for (const g of playedGames) {
    for (let i = 1; i < g.events.length; i++) {
      const e = g.events[i];
      if (e.type !== 'sub') continue;
      let j = i - 1;
      while (g.events[j].type === 'sub') j--;
      const prev = g.events[j];
      const dead = ['foul', 'foul_out', 'timeout', 'period_end', 'ft', 'turnover', 'rebound', 'shot'].includes(prev.type);
      assert.ok(dead, `sub after ${prev.type}`);
      if (prev.type === 'rebound') assert.equal(prev.player, null, 'sub after live rebound');
      if (prev.type === 'turnover') assert.equal(prev.steal, null, 'sub after steal');
      if (prev.type === 'shot') assert.ok(prev.made && prev.period >= 4 && prev.clock <= 120, 'sub after a made FG outside last 2:00');
    }
  }
});
test('shot clock violations, bonus FTs, and-1s, 3-shot fouls and foul-outs all occur', () => {
  const seen = { scv: 0, bonus: 0, and1: 0, three: 0, out: 0, oreb: 0, to: 0 };
  for (const g of playedGames) for (const e of g.events) {
    if (e.type === 'turnover' && e.kind === 'shot_clock') seen.scv++;
    if (e.type === 'foul' && e.penalty) seen.bonus++;
    if (e.type === 'shot' && e.and1) seen.and1++;
    if (e.type === 'ft' && e.of === 3) seen.three++;
    if (e.type === 'foul_out') seen.out++;
    if (e.type === 'rebound' && e.off) seen.oreb++;
    if (e.type === 'timeout') seen.to++;
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `never saw ${k}`);
});
test('clock never goes negative and never increases within a period', () => {
  for (const g of playedGames.slice(0, 10)) {
    let last = Infinity, period = 0;
    for (const e of g.events) {
      if (e.period !== period) { period = e.period; last = Infinity; }
      assert.ok(e.clock >= 0 && e.clock <= last + 1e-9, `clock ${e.clock} after ${last}`);
      last = e.clock;
    }
  }
});
test('short-quarter games (5/6/8 min) finish with scaled scores', () => {
  for (const q of [5, 6, 8]) {
    const g = newGame({ seed: q, rules: { quarterMinutes: q } }).simToEnd();
    const total = g.state.score.home + g.state.score.away;
    assert.ok(total > 226 * (q / 12) * 0.6 && total < 226 * (q / 12) * 1.5, `q=${q} total=${total}`);
  }
});
test('play-by-play text exists for every event', () => {
  const g = playedGames[0];
  for (const e of g.events) {
    const txt = describe(e, data.byId, { home: g.state.teams.home.id, away: g.state.teams.away.id });
    assert.ok(typeof txt === 'string' && txt.length > 3 && !txt.includes('undefined'), `${e.type}: ${txt}`);
  }
});
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './load_data.mjs';
test('deferred mode: free throws are shot one at a time, the last miss leaves a rebound pending', () => {
  const g = newGame(); g.startPeriod(); g.deferred = true;
  const side = g.state.possession, team = g.state.teams[side], shooter = team.onCourt[0];
  const before = g.state.score[side];
  g.freeThrows(side, shooter, 2);
  assert.deepEqual({ kind: g.state.pending.kind, n: g.state.pending.n, i: g.state.pending.i }, { kind: 'ft', n: 2, i: 0 });
  assert.equal(g.events.filter((e) => e.type === 'ft').length, 0);
  const e1 = g.freeThrow({ makeProb: 1 });
  assert.equal(e1.made, true); assert.equal(g.state.score[side], before + 1); assert.equal(g.state.pending.kind, 'ft');
  const e2 = g.freeThrow({ makeProb: 0 });
  assert.equal(e2.made, false); assert.equal(e2.n, 2);
  assert.equal(g.state.pending.kind, 'rebound');
  assert.equal(g.events.filter((e) => e.type === 'rebound').length, 0);
  g.resolveRebound();
  assert.equal(g.state.pending, null);
  assert.equal(g.events.filter((e) => e.type === 'rebound').length, 1);
});
test('deferred mode: positional factors decide who gets the rebound', () => {
  let off = 0, n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const g = newGame({ seed }); g.startPeriod(); g.deferred = true;
    const side = g.state.possession;
    g.rebound(side);
    const mult = {};
    for (const id of g.state.teams[side].onCourt) mult[id] = 1.8;                         // offense has inside position
    for (const id of g.state.teams[side === 'home' ? 'away' : 'home'].onCourt) mult[id] = 0.2;
    g.resolveRebound(mult, 1);
    const ev = g.events.filter((e) => e.type === 'rebound').pop();
    n++; if (ev.off) off++;
  }
  assert.ok(off / n > 0.55, `offense with position only got ${off}/${n}`);
});
test('src/engine is pure (no document/window/canvas/fetch/fs/Math.random)', () => {
  const dir = join(ROOT, 'src/engine');
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of [/\bdocument\./, /\bwindow\./, /getContext/, /\bfetch\(/, /node:/, /Math\.random/, /Date\.now/]) {
      assert.ok(!bad.test(src), `${f} uses ${bad}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
