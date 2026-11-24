// Auto-substitution AI (pure: reads game state, returns a list of swaps).
//
// Each player has a target share of minutes from tendencies.mpg_role. At every legal
// sub window we score everyone ("desire to be on the floor") from how far behind their
// target minutes they are, their energy, foul trouble, and game situation (closers in a
// close finish, deep bench in garbage time). A bench player replaces an on-court player
// only if his desire is higher by a hysteresis margin, so rotations come in stints.

import { posGroup } from './data.js';
import { inFoulTrouble, scaledClock, isFouledOut } from './rules.js';

const HYSTERESIS = 230;       // seconds-equivalent margin needed to make a swap
const ROTATION_SIZE = 10;

/** Per-player target share of game minutes (sums to ~5 over the rotation). */
export function minuteTargets(team, byId) {
  const avail = team.roster.filter((id) => byId[id].available);
  const sorted = [...avail].sort((a, b) => byId[b].tendencies.mpg_role - byId[a].tendencies.mpg_role);
  const rot = sorted.slice(0, ROTATION_SIZE);
  const sum = rot.reduce((s, id) => s + byId[id].tendencies.mpg_role, 0);
  const targets = {};
  for (const id of avail) targets[id] = 0;
  // Two passes so capped stars push minutes down the bench instead of vanishing.
  let scale = 5 / sum;
  for (let pass = 0; pass < 3; pass++) {
    let capped = 0, freeSum = 0;
    for (const id of rot) {
      const f = byId[id].tendencies.mpg_role * scale;
      if (f >= 0.8) capped += 0.8; else freeSum += byId[id].tendencies.mpg_role;
    }
    scale = (5 - capped) / Math.max(freeSum, 1);
  }
  for (const id of rot) targets[id] = Math.min(0.8, byId[id].tendencies.mpg_role * scale);
  return { targets, rotation: new Set(rot) };
}

function groupCompat(a, b) {
  if (a === b) return 0;
  if ((a === 'G' && b === 'B') || (a === 'B' && b === 'G')) return null; // never swap guard <-> big
  return 60; // adjacent (G<->W, W<->B) costs a bit
}

function lineupOk(ids, byId) {
  const groups = ids.map((id) => posGroup(byId[id]));
  const guards = groups.filter((g) => g === 'G').length;
  const bigs = groups.filter((g) => g === 'B').length;
  return guards >= 1 && bigs >= 1 && guards <= 3 && bigs <= 3;
}

/**
 * @param ctx { team, byId, period, clock, rules, elapsed, margin, forced:Set<id> }
 *   margin = team score - opponent score; forced = on-court ids that must come out (fouled out).
 * @returns [{out, in, reason}]
 */
export function planSubs(ctx) {
  const { team, byId, period, clock, rules, elapsed, margin } = ctx;
  const lateClock = scaledClock(5 * 60, rules);
  const garbage = period >= rules.periods && Math.abs(margin) >= 20 && clock <= scaledClock(6 * 60, rules)
    || period >= rules.periods && Math.abs(margin) >= 15 && clock <= scaledClock(3 * 60, rules);
  const closing = !garbage && period >= rules.periods && clock <= lateClock && Math.abs(margin) <= 12;

  const closers = new Set(
    team.roster
      .filter((id) => byId[id].available && !isFouledOut(team.pf[id] ?? 0, rules))
      .sort((a, b) => byId[b].overall - byId[a].overall)
      .slice(0, 5),
  );

  const desire = (id) => {
    const p = byId[id];
    const fouls = team.pf[id] ?? 0;
    const energy = team.energy[id];
    const target = team.targets[id] ?? 0;
    let d = target * elapsed - (team.played[id] ?? 0);
    d += 500 * (energy - 0.75);
    if (energy < 0.4) d -= 600;
    if (!team.rotation.has(id)) d -= garbage ? -2500 : 1500;
    if (inFoulTrouble(fouls, period, clock, rules)) d -= 2000;
    if (garbage) d += team.starters.includes(id) ? -3000 : 0;
    if (closing && closers.has(id) && energy > 0.3) d += 3000;
    d += 3 * (p.overall - 70);
    return d;
  };

  const swaps = [];
  const onCourt = [...team.onCourt];
  const bench = team.roster.filter(
    (id) => byId[id].available && !onCourt.includes(id) && !isFouledOut(team.pf[id] ?? 0, rules),
  );
  const score = Object.fromEntries([...onCourt, ...bench].map((id) => [id, desire(id)]));

  // Forced removals first (fouled out / ejected / injured).
  const forced = ctx.forced ?? new Set();
  const order = [...onCourt].sort((a, b) => (forced.has(b) - forced.has(a)) || score[a] - score[b]);

  for (const outId of order) {
    const isForced = forced.has(outId);
    const gOut = posGroup(byId[outId]);
    let best = null, bestVal = -Infinity;
    for (const inId of bench) {
      const cost = groupCompat(gOut, posGroup(byId[inId]));
      const val = score[inId] - (cost ?? (isForced ? 400 : Infinity));
      if (val === -Infinity) continue;
      const trial = onCourt.map((id) => (id === outId ? inId : id));
      if (!lineupOk(trial, byId) && !isForced) continue;
      if (val > bestVal) { bestVal = val; best = inId; }
    }
    if (best == null) continue;
    if (!isForced && bestVal - score[outId] < HYSTERESIS) continue;
    swaps.push({ out: outId, in: best, reason: isForced ? 'foul_out' : reasonFor(team, outId, ctx, garbage) });
    onCourt[onCourt.indexOf(outId)] = best;
    bench.splice(bench.indexOf(best), 1);
  }
  return swaps;
}

function reasonFor(team, id, ctx, garbage) {
  if (garbage) return 'garbage_time';
  if (inFoulTrouble(team.pf[id] ?? 0, ctx.period, ctx.clock, ctx.rules)) return 'foul_trouble';
  if (team.energy[id] < 0.55) return 'fatigue';
  return 'rotation';
}
