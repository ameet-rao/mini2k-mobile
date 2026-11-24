// Possession-resolution probability model. Pure functions of player ratings,
// league baselines (data.league) and a small context. All tuning knobs live in MODEL
// so calibration (tools/sim_check.mjs) only ever touches this object.

import { posGroup } from './data.js';

export const MODEL = {
  // --- pace (seconds of game clock) ---
  backcourtAfterMake: [4.0, 7.0],   // inbound + bring it up
  backcourtAfterDefReb: [2.5, 5.0],
  halfcourtMean: 10.5,
  halfcourtSd: 4.6,
  orebResetMean: 6.5,
  orebResetSd: 3.5,
  putbackRate: 0.36,                // OREB -> immediate putback attempt
  fastBreakAfterSteal: 0.62,
  earlyOffenseAfterDefReb: 0.16,
  lateClockBailout: 0.90,           // shot clock about to expire: chance a bad shot gets up anyway

  // --- turnovers (per offensive segment) ---
  tovBase: 0.121,
  tovStealShare: 0.56,              // live-ball turnovers credited as steals
  offFoulShare: 0.09,               // of non-steal turnovers -> offensive foul
  eightSecPerPoss: 0.0015,
  fiveSecPerInbound: 0.001,

  // --- non-shooting fouls (per segment, by defense) ---
  nonShootFoulBase: 0.089,
  looseBallFoulOnMiss: 0.035,

  // --- shot selection ---
  rimShareBase: 0.48,               // share of 2PA at the rim (before attribute/pos tilt)

  // --- make probabilities (at league-average shooter vs league-average defender) ---
  base: { rim: 0.612, mid: 0.402, three: 0.352 },
  attrSlope: { rim: 0.0040, mid: 0.0036, three: 0.0034 },
  defSlope: { rim: 0.0024, mid: 0.0016, three: 0.0012 },
  assistedBonus: { rim: 0.02, mid: 0.02, three: 0.015 },
  fastBreakBonus: 0.13,
  putbackBonus: 0.02,
  earlyBonus: 0.03,
  lateClockPenalty: 0.09,
  lastShotPenalty: 0.03,
  heaveProb: 0.04,
  fatigueKnee: 0.65,                // energy below this hurts
  fatigueSlope: 0.22,
  streakStep: 0.012,                // hot/cold, capped at +-2 steps
  andOneFactor: 0.40,               // make prob multiplier when fouled in the act

  // --- shooting fouls ---
  shootFoulBase: { rim: 0.172, mid: 0.062, three: 0.018 },

  // --- free throws: p = ftIntercept + ftSlope * free_throw (fit from per36.ft_pct vs attr) ---
  ftIntercept: 0.424,
  ftSlope: 0.00505,

  // --- blocks / assists ---
  blockOnMiss: { rim: 0.21, mid: 0.07, three: 0.02 },
  assistRate: { rim: 0.56, mid: 0.47, three: 0.84 },
  putbackAssist: 0.03,

  // --- rebounding ---
  orebBase: 0.255,
  orebSlope: 0.0045,                // per point of (avg off_reb+strength) diff vs defense
  ftOrebBase: 0.13,
  teamReboundShare: 0.06,

  // --- fatigue (energy 0..1) ---
  drainMin: 0.00060,                // per second on court at stamina 99
  drainMax: 0.00125,                // at stamina 25
  recoverPerSec: 0.0030,
  quarterBreakRecover: 0.22,
  halftimeRecover: 0.65,
  timeoutRecover: 0.05,
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function energyDrainPerSec(p, sprint = 1) {
  const s = clamp((p.attrs.stamina - 25) / 74, 0, 1);
  return (MODEL.drainMax - (MODEL.drainMax - MODEL.drainMin) * s) * sprint;
}

export function fatiguePenalty(energy) {
  return energy >= MODEL.fatigueKnee ? 0 : (MODEL.fatigueKnee - energy) * MODEL.fatigueSlope;
}

/** Weight for being the shooter on a possession. */
export function usageWeight(p, energy) {
  return p.tendencies.usage_per36 * (0.6 + 0.4 * energy);
}

/** rim / mid / three for a shooter on a normal half-court look. */
export function chooseShotType(p, rng, ctx = {}) {
  if (ctx.forceRim) return 'rim';
  let three = p.tendencies.three_rate;
  if (ctx.defender) {
    // A good perimeter defender nudges shooters inside a little.
    three *= 1 - 0.002 * (ctx.defender.attrs.perimeter_def - ctx.league.attrs.perimeter_def);
  }
  if (rng.chance(clamp(three, 0, 0.9))) return 'three';
  const g = posGroup(p);
  let rim = MODEL.rimShareBase + 0.006 * (p.attrs.finishing - p.attrs.mid_range) + 0.003 * (p.attrs.dunk - 55);
  rim += g === 'B' ? 0.18 : g === 'W' ? 0.05 : 0;
  return rng.chance(clamp(rim, 0.15, 0.92)) ? 'rim' : 'mid';
}

/** Probability the shot goes in (before any shooting-foul adjustment). */
export function shotMakeProb(shooter, type, defender, league, ctx = {}) {
  if (ctx.heave) return MODEL.heaveProb;
  const A = shooter.attrs;
  const L = league.attrs;
  let off;
  if (type === 'three') off = A.three_pt - L.three_pt;
  else if (type === 'mid') off = A.mid_range - L.mid_range;
  else off = 0.75 * (A.finishing - L.finishing) + 0.25 * (A.dunk - L.dunk);

  let p = MODEL.base[type] + MODEL.attrSlope[type] * off;

  if (defender) {
    const D = defender.attrs;
    const d = type === 'rim' ? D.interior_def - L.interior_def : D.perimeter_def - L.perimeter_def;
    p -= MODEL.defSlope[type] * d;
  }
  if (ctx.assisted) p += MODEL.assistedBonus[type];
  if (ctx.fastBreak) p += MODEL.fastBreakBonus;
  if (ctx.putback) p += MODEL.putbackBonus;
  if (ctx.early) p += MODEL.earlyBonus;
  if (ctx.lateClock) p -= MODEL.lateClockPenalty;
  if (ctx.lastShot) p -= MODEL.lastShotPenalty;
  if (ctx.energy != null) p -= fatiguePenalty(ctx.energy);
  if (ctx.streak) p += MODEL.streakStep * clamp(ctx.streak, -2, 2);
  if (ctx.difficultyMod) p += ctx.difficultyMod;
  return clamp(p, 0.02, 0.95);
}

export function shootingFoulProb(shooter, type, defender, league) {
  const draw = shooter.attrs.draw_foul / league.attrs.draw_foul;
  const pf = defender ? defender.tendencies.pf_per36 / league.tend.pf_per36 : 1;
  return MODEL.shootFoulBase[type] * Math.pow(draw, 1.6) * Math.pow(pf, 0.5);
}

export function freeThrowProb(shooter, energy = 1) {
  return clamp(MODEL.ftIntercept + MODEL.ftSlope * shooter.attrs.free_throw - 0.5 * fatiguePenalty(energy), 0.3, 0.97);
}

export function blockProb(type, blocker, league) {
  return MODEL.blockOnMiss[type] * Math.pow(blocker.attrs.block / league.attrs.block, 2);
}

/** Probability the offense gets the offensive rebound on a missed FG. */
export function offRebProb(offense, defense, league, ft = false) {
  const avg = (ps, f) => ps.reduce((s, p) => s + f(p), 0) / ps.length;
  const o = avg(offense, (p) => 0.75 * p.attrs.off_rebound + 0.25 * p.attrs.strength);
  const d = avg(defense, (p) => 0.75 * p.attrs.def_rebound + 0.25 * p.attrs.strength);
  const lo = 0.75 * league.attrs.off_rebound + 0.25 * league.attrs.strength;
  const ld = 0.75 * league.attrs.def_rebound + 0.25 * league.attrs.strength;
  const base = ft ? MODEL.ftOrebBase : MODEL.orebBase;
  return clamp(base + MODEL.orebSlope * ((o - lo) - (d - ld)), 0.05, 0.5);
}

export function reboundWeight(p, off) {
  const r = off ? p.attrs.off_rebound : p.attrs.def_rebound;
  return Math.pow(r, 2.6) * (0.8 + 0.2 * p.attrs.strength / 60);
}
