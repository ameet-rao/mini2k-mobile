#!/usr/bin/env node
// Headless check of the REAL-TIME layer (src/engine/live.js): plays full games at 60 Hz with no
// rendering, CPU vs CPU and with a button-mashing "user", and verifies nothing breaks.
//
//   node tools/live_check.mjs               # 6 CPU-vs-CPU games + 2 bot-user games, 12-min quarters
//   node tools/live_check.mjs --games 12 --quarter 5

import assert from 'node:assert/strict';
import { loadData } from './load_data.mjs';
import { LiveGame } from '../src/engine/live.js';
import { deriveBoxScore } from '../src/engine/boxscore.js';
import { Rng } from '../src/engine/rng.js';
import * as AI from '../src/engine/ai.js';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const GAMES = arg('games', 6), QUARTER = arg('quarter', 12), SEED = arg('seed', 100);
const STEP = 1 / 60;
const data = loadData();
const teams = Object.keys(data.teams);

function botInput(rng, st) {
  // Changes its mind a few times a second: runs around, shoots with random timing, passes, steals, switches.
  if (--st.hold <= 0) {
    st.hold = rng.int(6, 40);
    const a = rng.next() * Math.PI * 2;
    st.mx = rng.chance(0.15) ? 0 : Math.cos(a); st.my = rng.chance(0.15) ? 0 : Math.sin(a);
    st.sprint = rng.chance(0.4);
    st.shoot = rng.chance(0.25);
  }
  return { mx: st.mx, my: st.my, sprint: st.sprint, shoot: st.shoot, pass: rng.chance(0.02), swap: rng.chance(0.01), steal: rng.chance(0.05), pick: rng.chance(0.01) };
}

// A "competent player": uses the keyboard intents only, but makes sensible decisions (runs the
// offense like the CPU does, releases the meter near the sweet spot with human-ish error, stays
// in front of his man, reaches now and then). Shows the game is winnable through the controls.
function skilledInput(L, rng, st) {
  const inp = { mx: 0, my: 0, sprint: false, shoot: false, pass: false, swap: false, steal: false };
  const c = L.ctrl, h = L.ball.holder;
  if (L.ftMeter) {
    // Free throw: press, hold, let go near the sweet spot.
    const m = L.ftMeter;
    if (!m.armed) return inp;
    if (!m.active) { inp.shoot = true; st.ftTarget = 0.78 + rng.normal(0, 0.05); return inp; }
    inp.shoot = m.t / m.dur < st.ftTarget;
    return inp;
  }
  if (L.phase !== 'live' || !c) { st.shooting = false; st.tap = 0; return inp; }
  const go = (tx, ty, sprint) => {
    const dx = tx - c.x, dy = ty - c.y;
    if (Math.hypot(dx, dy) > 1) { inp.mx = Math.abs(dx) > 0.5 ? Math.sign(dx) : 0; inp.my = Math.abs(dy) > 0.5 ? Math.sign(dy) : 0; inp.sprint = !!sprint; }
  };
  if (L.state.possession === L.user) {
    if (h !== c) { st.shooting = false; st.tap = 0; return inp; }
    if (st.tap > 0) { st.tap -= 1; inp.shoot = st.tap > 1; return inp; }            // quick tap = pump fake
    if (c.pivot && !st.shooting) { st.shooting = true; st.target = 0.78 + rng.normal(0, 0.06); return inp; }
    if (!st.shooting && rng.chance(0.002)) { inp.swap = true; return inp; }          // try an alley-oop now and then
    if (!st.shooting && rng.chance(0.002)) inp.pick = true;
    if (st.shooting) {
      inp.shoot = !L.meter || L.meter.t / L.meter.dur < st.target;
      if (!inp.shoot) st.shooting = false;
      return inp;
    }
    const o = AI.handlerThink(L, c, 1 / 60);
    if (o.shoot) { if (rng.chance(0.12)) { st.tap = 4; return inp; } st.shooting = true; st.target = 0.78 + rng.normal(0, 0.06); return inp; }
    if (o.pass) { inp.mx = Math.sign(o.pass.x - c.x); inp.my = Math.sign(o.pass.y - c.y); inp.pass = true; return inp; }
    go(o.tx, o.ty, o.sprint);
  } else {
    st.shooting = false;
    const be = L.ballEnt();
    if (be && L.matchOf(c) !== be && rng.chance(0.02)) inp.swap = true;
    if (rng.chance(0.002)) inp.pick = true;                                         // double team
    const t = AI.defendTarget(L, c, 1 / 60);
    go(t.tx, t.ty, t.sprint);
    inp.shoot = !!L.windup && L.windup.e === L.matchOf(c);
    if (h && Math.hypot(h.x - c.x, h.y - c.y) < 3.5 && rng.chance(0.004)) inp.steal = true;
  }
  return inp;
}

function playLive(opts, bot) {
  const L = new LiveGame(data, opts);
  const rng = new Rng(opts.seed + 999), st = { hold: 0 };
  const maxSteps = (QUARTER * 4 + 30) * 60 * 60 * 12; // generous: real time incl. dead balls and OT
  const phases = {};
  let steps = 0;
  while (L.phase !== 'final') {
    L.update(STEP, bot === 'skilled' ? skilledInput(L, rng, st) : bot ? botInput(rng, st) : undefined);
    phases[L.phase] = (phases[L.phase] ?? 0) + 1;
    if (++steps > maxSteps) throw new Error(`live game did not finish (phase ${L.phase}, period ${L.state.period}, clock ${L.state.clock})`);
    if (steps % 30 === 0) {
      for (const e of L.all) {
        assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), 'entity position is NaN');
        assert.ok(e.x > -4 && e.x < 98 && e.y > -4 && e.y < 54, `entity left the arena: ${e.x},${e.y}`);
      }
      assert.ok(Number.isFinite(L.ball.x) && Number.isFinite(L.ball.y) && Number.isFinite(L.ball.z), 'ball position is NaN');
      if (L.phase === 'live' || L.phase === 'inbound') for (const side of ['home', 'away']) {
        assert.deepEqual(L.ents[side].map((e) => e.id), L.state.teams[side].onCourt, 'entities out of sync with on-court list');
        assert.equal(new Set(L.ents[side].map((e) => e.role)).size, 5);
      }
      if (L.phase === 'live') assert.ok(L.ball.holder || L.ball.flight, 'live ball with nobody holding it');
    }
  }
  return { L, steps, phases };
}

const f1 = (x) => x.toFixed(1), fp = (x) => (x * 100).toFixed(1);
const pad = (s, n) => String(s).padStart(n);
const rows = [];
const t0 = Date.now();
console.log(`live_check: ${GAMES} CPU-vs-CPU games, 2 button-masher games, 2 competent-player games, ${QUARTER}-min quarters (score = away-home, user is home)\n`);
console.log(pad('game', 22) + ['score', 'FG%', '3P%', '3PA', 'FTA', 'POSS', 'TOV', 'STL', 'PF', 'REB', 'AST', 'real min'].map((h) => pad(h, 9)).join(''));

for (let i = 0; i < GAMES + 4; i++) {
  const bot = i >= GAMES + 2 ? 'skilled' : i >= GAMES ? 'masher' : null;
  const NT = teams.length;
  const home = teams[(i * 3) % NT], away = teams[(i * 3 + 1 + (i % 3 === 2 ? 1 : 0)) % NT];
  const { L, steps } = playLive({ home, away, seed: SEED + i, rules: { quarterMinutes: QUARTER }, user: bot ? 'home' : null }, bot);
  const box = deriveBoxScore(L.game.events);
  const s = L.state;
  // Invariants: box score from the log matches the scoreboard; no tie; five on the floor all game.
  for (const side of ['home', 'away']) {
    assert.equal(box[side].totals.pts, s.score[side], 'box score != scoreboard');
    const len = QUARTER * 60 * 4 + (box.periods - 4) * 300;
    assert.ok(Math.abs(box[side].totals.sec - 5 * len) < 2, `minutes ${box[side].totals.sec} vs ${5 * len}`);
  }
  assert.notEqual(s.score.home, s.score.away);
  const T = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, fta: 0, tov: 0, stl: 0, pf: 0, reb: 0, ast: 0 };
  for (const side of ['home', 'away']) for (const k of Object.keys(T)) T[k] += box[side].totals[k] / 2;
  const poss = (box.home.possessions + box.away.possessions) / 2;
  if (!bot) rows.push({ ...T, poss });
  console.log(pad(`${bot === 'skilled' ? 'SKILLED ' : bot ? 'MASHER ' : ''}${away}@${home} #${SEED + i}`, 22) + [
    `${s.score.away}-${s.score.home}${box.periods > 4 ? ' OT' : ''}`, fp(T.fgm / T.fga), fp(T.tpm / Math.max(1, T.tpa)), f1(T.tpa), f1(T.fta), f1(poss), f1(T.tov), f1(T.stl), f1(T.pf), f1(T.reb), f1(T.ast),
    f1(steps / 3600),
  ].map((x) => pad(x, 9)).join('') + `   timeouts ${L.game.events.filter((e) => e.type === 'timeout').length}  subs ${L.game.events.filter((e) => e.type === 'sub').length}`);
  {
    const ev = L.game.events, n = (f) => ev.filter(f).length;
    const kinds = {};
    for (const e of ev) if (e.type === 'turnover') kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    const sh = (t) => `${t} ${n((e) => e.type === 'shot' && e.shot === t && e.made)}/${n((e) => e.type === 'shot' && e.shot === t)}`;
    L._to = n((e) => e.type === 'timeout'); L._subs = n((e) => e.type === 'sub');
    if (args.includes('--detail')) console.log(pad('', 22) + `  shots: ${sh('rim')} ${sh('mid')} ${sh('three')}  blocks ${n((e) => e.type === 'shot' && e.block)}  fastbreak ${n((e) => e.type === 'shot' && e.fastBreak)}  tov: ${JSON.stringify(kinds)}`);
  }
  if (bot) {
    const shots = L.stats.userShots.length;
    assert.ok(shots > 0, 'bot user never shot');
    const perfect = L.stats.userShots.filter((x) => x.label === 'Perfect').length;
    const ut = box.home.totals;
    const fts = L.stats.userFts ?? [], oops = L.game.events.filter((e) => e.type === 'shot' && e.team === 'home').length;
    console.log(pad('', 22) + `  ${bot} user (home): ${shots} metered shots (${perfect} perfect), FG ${ut.fgm}/${ut.fga}, 3P ${ut.tpm}/${ut.tpa}, FT ${ut.ftm}/${ut.fta} (${fts.length} on the meter, ${fts.filter((x) => x.label === 'Perfect').length} perfect), ${L.stats.fakes ?? 0} pump fakes, ${L.stats.lobs ?? 0} lobs, ${L.stats.doubles ?? 0} double teams, ${ut.tov} turnovers, ${ut.stl} steals, ${ut.pf} fouls`);
  }
}

const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
const k48 = 12 / QUARTER;
console.log('\n' + pad('CPU avg per team /48', 22) + [
  f1(avg('pts') * k48), fp(avg('fgm') / avg('fga')), fp(avg('tpm') / avg('tpa')), f1(avg('tpa') * k48), f1(avg('fta') * k48), f1(avg('poss') * k48),
  f1(avg('tov') * k48), f1(avg('stl') * k48), f1(avg('pf') * k48), f1(avg('reb') * k48), f1(avg('ast') * k48),
].map((x) => pad(x, 9)).join(''));
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Loose sanity band for the real-time game (tight calibration is M5).
const pts = avg('pts') * k48, fg = avg('fgm') / avg('fga');
const fails = [];
// Scoring was made 15% and then another 25% harder on request, so the band sits low on purpose.
if (pts < 55 || pts > 135) fails.push(`points per team ${f1(pts)} outside 55-135`);
if (fg < 0.24 || fg > 0.55) fails.push(`FG% ${fp(fg)} outside 24-55`);
if (fails.length) { console.log('FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('PASS: every live game finished; box scores match; stats in a sane range.');
