// Real-time layer (pure, headless): 10 players and a ball moving on the court at 60 Hz.
// It owns positions, movement, AI and input intents, and calls the rules engine (game.js)
// for every outcome (shots, fouls, free throws, rebounds, turnovers, subs, clock), so the
// event log and box score work exactly as in the headless sim.
//
// update(dt, input) with input = { mx, my, sprint, shoot (held), pass, swap, steal (edges) }.
// Phases: tip -> live -> anim (plays out what the engine just decided) -> inbound -> live ...
//         -> break (end of period) -> final.

import { Game } from './game.js';
import { Rng } from './rng.js';
import * as R from './rules.js';
import * as M from './model.js';
import { POS_ORDER } from './data.js';
import { COURT, distE, hoopPos, shotZone, segPoint } from './court.js';
import * as AI from './ai.js';
import { describe, periodName } from './pbp.js';

const DT_CLOCK = 0.1;
const other = (s) => (s === 'home' ? 'away' : 'home');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;

// Shot contest feedback tiers (upper bound of the contest score, label, indicator colour).
const CONTEST_CUTS = [0.05, 0.18, 0.31, 0.44, 0.57, 0.70, 0.84, Infinity];
export const CONTEST_TIERS = [
  ['Wide Open', '#ffffff'], ['Open', '#ffffff'], ['Semi-Open', '#ffd84a'], ['Bothered', '#ffd84a'],
  ['Light Contest', '#ff9a3a'], ['Solid Contest', '#ff9a3a'], ['Heavy Contest', '#ff4a3a'], ['Smothered', '#ff4a3a'],
];
export const PERFECT_MAKE = 0.9;   // a perfectly timed release goes in 90% of the time

export const NO_INPUT = Object.freeze({ mx: 0, my: 0, sprint: false, shoot: false, pass: false, swap: false, steal: false, timeout: false, pick: false, spin: false });

// Formations, normalized to a team attacking the right hoop.
const TIP = [[33, 25], [41, 12], [41, 38], [38, 31], [45.2, 25]];
const FT_OFF = [[81.5, 17.2], [81.5, 32.8], [62, 15], [62, 35]];
const FT_DEF = [[85, 17.2], [85, 32.8], [78.2, 32.8], [66, 22], [66, 30]];

/** Overall size of the green window (0.9 = 10% tighter than the first adaptive meter). */
const GREEN_SCALE = 0.9;
/** Real-time shots go in this much less often than the base model says (15% harder, then 25% harder again). */
const SCORE_HARD = 0.85 * 0.75;
/** A dunk-range finish by a dunker with a defender on him (Light Contest or tighter): 20% harder, then 25% again. */
const DUNK_HARD = 0.8 * 0.75, DUNK_CONTEST = 0.31;
/** Space held for less than this is a pump fake, not a shot. */
export const TAP_FAKE = 0.14;
export const FAKE_COOLDOWN = 2;   // seconds between pump fakes (no spamming)
const LATE_CAP = 0.83;            // a defender who arrives after a layup starts can make it Heavy Contest at most
const PIVOT_STEP = 1.3;           // feet the body swings around the pivot foot
/** C held sideways cycles through these (crossover in front, through the legs, behind the back, a shift). */
const SIDE_MOVES = ['shift', 'crossover', 'between_legs', 'behind_back'];
/** A timeout lasts this long (seconds); both coaches make substitutions during it, in when it ends. */
export const TIMEOUT_SECS = 10;
// Multiplayer online: several people per team, each running some positions (roles 0..4 = PG SG SF PF C).
// 2v2: 'home'/'away' run the PG and C, 'home2'/'away2' the SG, SF and PF.
// 3v3: 'home' PG+SG, 'home2' SF, 'home3' PF+C (same for away). The game config carries the roles.
export const SEAT_KEYS = ['home', 'home2', 'home3', 'away', 'away2', 'away3'];
export const MODES = {
  '2v2': { roles: { home: [0, 4], home2: [1, 2, 3], away: [0, 4], away2: [1, 2, 3] }, names: { home: 'PG + C', home2: 'SG + SF + PF', away: 'PG + C', away2: 'SG + SF + PF' } },
  '3v3': { roles: { home: [0, 1], home2: [2], home3: [3, 4], away: [0, 1], away2: [2], away3: [3, 4] }, names: { home: 'PG + SG', home2: 'SF', home3: 'PF + C', away: 'PG + SG', away2: 'SF', away3: 'PF + C' } },
  // StreetBall 3on3: three players a side, one person each (the guard plays role 0, the wing 2, the big 4)
  street: { street: true, roles: { home: [0], home2: [2], home3: [4], away: [0], away2: [2], away3: [4] }, names: { home: 'Guard', home2: 'Wing', home3: 'Big', away: 'Guard', away2: 'Wing', away3: 'Big' } },
};
/** StreetBall: the three players a side take these roles (so they space like a PG, a wing and a big). */
const STREET_ROLES = [0, 2, 4];
/** StreetBall check ball: how long everybody stands set before the ball is live. */
export const CHECK_SECS = 1.2;
export const SEAT_ROLES = MODES['2v2'].roles;
export const sideOfKey = (k) => (k.startsWith('home') ? 'home' : 'away');
const hasDir = (i) => !!i && (Math.abs(i.mx) > 0.01 || Math.abs(i.my) > 0.01);
/** Usual offense/defense ratio of the positional rebound factors (keeps the offensive-rebound rate calibrated). */
const REB_NORM = 0.66;
/**
 * Online play: an input can carry `lag` (seconds between what that player's screen showed and the
 * host's game when the input arrived). Timing actions (shot meter, free throw meter, rebound jump)
 * are judged against what the player SAW, so a remote player is not penalised for the network.
 * Capped so nobody can act much in the past. A local input has no lag and plays exactly as before.
 */
export const MAX_LAG = 0.35;
const lagOf = (input) => (input.lag > 0 ? Math.min(MAX_LAG, input.lag) : 0);
/**
 * Meter time the player saw when letting go. An online guest measures its own hold on its screen and
 * sends it with the release (input.hold, in steps), so the judgement does not depend on the network.
 * The hold is kept within MAX_LAG of the meter that is running here.
 */
const perceived = (input, t) => (input.hold > 0
  ? clamp(input.hold / 60, t - MAX_LAG, t + MAX_LAG)
  : t - lagOf(input));

/**
 * Local shot meter (online guest). The guest's own screen runs the meter and decides the result the
 * moment Space is let go; it sends that result (`input.res`) with the release, inside the normal input
 * stream, so the host and every screen apply the very same result at the very same step. Lag can delay
 * the shot, never change it: a green on the guest's screen is a green.
 */
export const RES = { FAKE: 1, GREEN: 2, ORANGE: 3, EARLY: 4, LATE: 5 };
/** Which part of the meter a release lands in (shared by the engine and the guest's local meter). */
export function meterZone(m, rel, ft = false) {
  const hasGreen = ft || (m.green ?? 0) > 0, hasOrange = ft || (m.orange ?? 0) > 0;
  if (hasGreen && rel >= m.greenStart && rel <= m.greenEnd) return RES.GREEN;
  if (hasOrange && rel >= m.orangeStart && rel < m.greenStart) return RES.ORANGE;
  if (rel > (hasGreen ? m.greenEnd : 1.0)) return RES.LATE;
  return RES.EARLY;
}
/** A remote player's meter waits this long past the top for their release before the host lets it go. */
const NET_GRACE = 1.5;

export class LiveGame {
  /**
   * @param data  buildIndex(...) result
   * @param opts  { home, away, seed, rules, user:'home'|'away'|'both'|null, difficulty:'easy'|'rookie'|'pro'|'allstar' }
   *
   * Human players: `humans` lists the sides a person controls (one for a normal game, both for a
   * two-player game, none for a CPU demo). Each human side has its own context in `uc[side]`
   * (controlled player, timeout and sub requests). `user` is only the side THIS screen shows as
   * "you" (HUD, meter, controlled-player marker); the simulation never reads it, so two screens
   * with different `user` values run the exact same game.
   */
  constructor(data, { user = 'home', difficulty = 'pro', ...opts } = {}) {
    // StreetBall (rules.street): no coaches, so no auto subs or timeouts
    this.street = !!opts.rules?.street;
    if (this.street) opts = { ...opts, autoSubs: { home: false, away: false } };
    this.game = new Game(data, opts);
    this.game.deferred = true;  // free throws and rebounds are played out here, one step at a time
    this.data = this.game.data;
    // Controllers: one per person. Normally the key is the side ('home', 'away') and the person runs
    // the whole team. In 2v2 (`seats`), each side can have two people: 'home' runs the PG and C,
    // 'home2' the SG, SF and PF (SEAT_ROLES); roles nobody holds are played by the CPU.
    const seats = opts.seats ?? null, seatRoles = opts.seatRoles ?? SEAT_ROLES;
    this.ctls = seats ? SEAT_KEYS.filter((k) => seats.includes(k)) : user === 'both' ? ['home', 'away'] : user ? [user] : [];
    this.humans = ['home', 'away'].filter((sd) => this.ctls.some((k) => sideOfKey(k) === sd));
    this.user = user === 'both' ? 'home' : user;
    this.me = this.user;           // controller key of THIS screen (display only, like `user`)
    const uctx = (k) => ({ side: sideOfKey(k), roles: seats ? seatRoles[k] ?? null : null, ctrl: null, wantTimeout: false, pendingSubs: [], shootHeld: false });
    this.uc = {};
    for (const k of [...new Set(['home', 'away', ...this.ctls])]) this.uc[k] = uctx(k);
    this.difficulty = difficulty;
    this.diff = AI.DIFFICULTY[difficulty] ?? AI.DIFFICULTY.pro;
    this.rng = new Rng(((opts.seed ?? 1) * 7919 + 17) >>> 0);
    this.time = 0;
    this.ball = { x: 47, y: 25, z: 0, holder: null, flight: null };
    this.passTarget = null;    // who E would pass to right now
    this.meter = null;         // user's shot meter { t, dur, sweet, green, type }
    this.windup = null;        // CPU shot wind-up { e, t, dur }
    this.queue = [];           // animation steps for the 'anim' phase
    this.banner = null;        // { text, t, dur }
    this.feed = [];            // recent play-by-play lines
    this.fx = [];              // floating texts { text, x, y, t, dur, color }
    this.lastPass = null;
    this.plan = null;
    this.helper = null;
    this.acc = 0;
    this.crossed = false; this.bcT = 0; this.possT = 0; this.transition = false;
    this.needRelease = false;
    this.ftLine = null; this.inb = null;
    this._seen = 0;
    this.stats = { userShots: [] };
    this.ftMeter = null;       // user's free throw meter { t, dur, sweet, green, active }
    this.double = null;        // user's double team { e, t }
    this.rebCtx = null;        // { hoop, side, land } while a shot is in the air

    this.game.startPeriod();
    this.ents = { home: [], away: [] };
    for (const side of ['home', 'away']) {
      this.game.state.teams[side].onCourt.forEach((id, slot) => {
        this.ents[side].push({
          side, slot, id, role: slot, x: 47, y: 25, vx: 0, vy: 0, dvx: 0, dvy: 0, fx: 1, fy: 0,
          trkx: 47, trky: 25, stun: 0, stealCd: 0, spot: null, spotT: 0, cut: 0, screen: 0, roll: false,
          sprinting: false, handsUp: false, oob: false,
          pivot: false, dribbled: false, faked: 0, fakeT: -9, bitT: -9, jumpT: -9,
        });
      });
    }
    this.all = [...this.ents.home, ...this.ents.away];
    this.sync();
    this.dispClock = this.game.state.clock;
    this.checkN = 0;           // StreetBall: counts check balls (the camera cuts to the new half on each)
    if (this.street) { this.startCheck(this.state.possession); this.phaseT = 99; }   // opening check: start in place
    else this.startTip();
    this.pump();
  }

  // ------------------------------------------------------------------ helpers

  get state() { return this.game.state; }
  // The viewing side's context (UI reads these; the engine uses uc[side] directly).
  // ctrl: entity the user controls. wantTimeout: set by the pause menu, used the next time that team
  // has the ball. pendingSubs: [{ out, in }] from the pause menu, made at the next dead ball.
  get ctrl() { return this.me ? this.uc[this.me]?.ctrl ?? null : null; }
  set ctrl(v) { if (this.me && this.uc[this.me]) this.uc[this.me].ctrl = v; }
  get wantTimeout() { return this.me ? this.uc[this.me]?.wantTimeout ?? false : false; }
  set wantTimeout(v) { if (this.me && this.uc[this.me]) this.uc[this.me].wantTimeout = v; }
  get pendingSubs() { return this.me ? this.uc[this.me]?.pendingSubs ?? [] : []; }
  isHuman(side) { return this.humans.includes(side); }
  /** The controller (person) running entity e right now, or null. */
  ctlOf(e) { if (!e) return null; for (const k of this.ctls) if (this.uc[k].ctrl === e) return k; return null; }
  isCtrl(e) { return this.ctlOf(e) !== null; }
  /** Can controller k take entity e (same side, and one of its positions in 2v2)? */
  owns(k, e) { const U = this.uc[k]; return !!e && e.side === U.side && (!U.roles || U.roles.includes(e.role)); }
  /** Controller k's own players. */
  mine(k) { return this.ents[this.uc[k].side].filter((e) => this.owns(k, e)); }
  /** Hand control to the person who owns entity e (on e's side). */
  give(e) { for (const k of this.ctls) if (this.owns(k, e)) this.uc[k].ctrl = e; }
  /** Put each person on the right player when the ball goes to `be`: the ball (or the man guarding it) if it is theirs, else their player nearest the ball. */
  assignAll(be) {
    for (const k of this.ctls) {
      const U = this.uc[k];
      const want = U.side === be.side ? be : this.matchOf(be);
      U.ctrl = this.owns(k, want) ? want : this.nearestOwn(k, be);
    }
  }
  nearestOwn(k, to) {
    const list = this.mine(k);
    return list.length ? list.reduce((a, c) => (distE(a, to) <= distE(c, to) ? a : c)) : null;
  }
  p(id) { return this.data.byId[id]; }
  // StreetBall: both teams play at the same basket (the right one); the camera turns to show whose ball it is.
  dirRight(side) { return this.street ? true : (side === 'home') === (this.state.period <= this.game.rules.periods / 2); }
  hoopOf(side) { return hoopPos(this.dirRight(side)); }
  N(side, nx, ny) { return this.dirRight(side) ? { x: nx, y: ny } : { x: COURT.L - nx, y: COURT.W - ny }; }
  isFront(side, x, margin = 0) { return this.dirRight(side) ? x > 47 + margin : x < 47 - margin; }
  entOf(id) { return this.all.find((e) => e.id === id) ?? null; }
  matchOf(e) { return this.ents[other(e.side)].find((o) => o.role === e.role); }
  ballEnt() { return this.ball.holder ?? this.ball.flight?.to ?? (this.phase === 'inbound' ? this.inb.recv : null); }
  spotOf(e) { return this.N(e.side, ...AI.SPOTS[e.spot ?? AI.defaultSpot(this, e)]); }
  energy(e) { return this.state.teams[e.side].energy[e.id] ?? 1; }

  /** Keep entities in step with the engine's on-court lists (subs replace in the same slot). */
  sync() {
    for (const side of ['home', 'away']) {
      const on = this.state.teams[side].onCourt;
      for (const e of this.ents[side]) e.id = on[e.slot];
    }
    this.roles();
  }

  roles() {
    for (const side of ['home', 'away']) {
      [...this.ents[side]]
        .sort((a, b) => POS_ORDER[this.p(a.id).pos] - POS_ORDER[this.p(b.id).pos] || a.slot - b.slot)
        .forEach((e, r) => { e.role = this.street ? STREET_ROLES[r] ?? r : r; });
    }
    // 2v2: a sub can reshuffle positions; nobody keeps a player who is no longer theirs
    for (const k of this.ctls) { const U = this.uc[k]; if (U.ctrl && !this.owns(k, U.ctrl)) U.ctrl = this.nearestOwn(k, this.ball); }
  }

  nearestDef(e) {
    let best = null, d = 99;
    for (const o of this.ents[other(e.side)]) {
      const dd = distE(e, o);
      if (dd < d) { d = dd; best = o; }
    }
    return { e: best, d };
  }

  laneClear(h, hoop) {
    for (const o of this.ents[other(h.side)]) {
      if (o.stun > 0.15) continue;
      const { u, dd } = segPoint(h, hoop, o);
      if (u > 0.04 && dd < 3.4) return false;
    }
    return true;
  }

  passLaneOpen(a, b, w) {
    for (const o of this.ents[other(a.side)]) {
      const { u, dd } = segPoint(a, b, o);
      if (u > 0.1 && u < 0.95 && dd < w) return false;
    }
    return true;
  }

  /** Shot-quality adjustment from how open the shooter is (the engine's base assumes an average contest). */
  openMod(e, zone, nd) {
    if (zone.type === 'rim') {
      if (!nd.e || nd.d > 4.5) return 0.10;
      const hoop = this.hoopOf(e.side);
      const between = distE(nd.e, hoop) < distE(e, hoop) + 1.0;
      return between ? (nd.d < 2.8 ? -0.07 : -0.02) : 0.05;
    }
    if (nd.d < 2.2) return -0.08;
    if (nd.d < 4) return -0.025;
    if (nd.d < 6) return 0.02;
    return 0.055;
  }

  /**
   * How well the shot is contested, 0 (nobody near) .. 1 (smothered), from three things:
   * proximity of each defender, whether his hands are up, and overall coverage (is he between the
   * shooter and the rim, and is a second defender helping). Pure: no dice, safe to call for display.
   */
  contest(e) {
    const hoop = this.hoopOf(e.side);
    const hx = hoop.x - e.x, hy = hoop.y - e.y, hd = Math.hypot(hx, hy) || 1;
    const parts = [];
    for (const d of this.ents[other(e.side)]) {
      const dx = d.x - e.x, dy = d.y - e.y, dist = Math.hypot(dx, dy);
      if (dist > 8) continue;
      const prox = clamp((8 - dist) / 5.6, 0, 1);                       // 1 inside ~2.4 ft, 0 at 8 ft
      const front = dist < 0.01 ? 1 : (dx * hx + dy * hy) / (dist * hd); // 1 = squarely between shooter and rim
      const pos = 0.5 + 0.5 * clamp((front + 0.35) / 1.1, 0, 1);         // behind/trailing still bothers a little
      const userD = this.isCtrl(d);
      const up = d.stun <= 0 && (userD ? d.handsUp : dist < 5.5 && Math.hypot(d.vx, d.vy) < 7.5);
      const A = this.p(d.id).attrs;
      const skill = 0.88 + 0.24 * clamp(((hd < 9 ? A.interior_def : A.perimeter_def) - 40) / 50, 0, 1);
      // At the rim, size matters: tall shot-blockers bother a layup more, most of all from in front.
      let size = 1;
      if (hd < 9) {
        const sz = clamp(1 + 0.035 * (this.p(d.id).height_in - 79) + 0.004 * (A.block - 55), 0.7, 1.35);
        size = 1 + (sz - 1) * (front > 0.4 ? 1 : 0.5);
      }
      parts.push({ d, dist, up, front, v: prox * pos * (up ? 1 : 0.58) * skill * size });
    }
    parts.sort((a, b) => b.v - a.v);
    let score = 0;
    parts.forEach((q, i) => { score += q.v * (i === 0 ? 1 : i === 1 ? 0.3 : 0.12); });
    score = clamp(score, 0, 1);
    return this.contestTier(score, parts[0]?.d ?? null, !!parts[0]?.up, parts);
  }

  /** Contest object for a score (tier name and color). */
  contestTier(score, primary, handsUp, parts = null) {
    const tier = CONTEST_CUTS.findIndex((c) => score < c);
    const T = CONTEST_TIERS[tier < 0 ? CONTEST_TIERS.length - 1 : tier];
    return { score, tier: tier < 0 ? CONTEST_TIERS.length - 1 : tier, name: T[0], color: T[1], primary, handsUp, parts };
  }

  /**
   * A real contest on a drive (can draw a shooting foul): a defender in the path with his hands up,
   * two or more defenders on the shooter, or a defender who just reached in (F).
   */
  realContest(e, c) {
    let near = 0;
    for (const d of this.ents[other(e.side)]) {
      const dd = distE(d, e);
      if (dd < 4.5) near++;
      if (dd < 5 && this.isCtrl(d) && d.stealCd > 0) return true;
    }
    if (near >= 2) return true;
    const q = c.parts?.[0];
    return !!q && q.up && q.dist < 4 && q.front > 0.3;
  }

  /** Make-probability adjustment for a contest score (the engine's base assumes an average contest). */
  contestMod(zone, score) {
    return zone.type === 'rim' ? 0.15 - 0.20 * score : 0.145 - 0.17 * score;
  }

  deepPenalty(zone) { return zone.type === 'three' && zone.dist > 26 ? (zone.dist - 26) * 0.03 : 0; }

  /** Expected points if this player shot right now from where he stands. */
  shotEV(e) {
    const zone = shotZone(e.x, e.y, this.hoopOf(e.side));
    const nd = this.nearestDef(e);
    const defP = nd.e && nd.d < 6.5 ? this.p(nd.e.id) : null;
    const pr = M.shotMakeProb(this.p(e.id), zone.type, defP, this.data.league, { energy: this.energy(e) })
      + this.openMod(e, zone, nd) - this.deepPenalty(zone);
    return clamp(pr, 0.02, 0.95) * (zone.type === 'three' ? 3 : 2) + (zone.type === 'rim' ? 0.12 : zone.type === 'mid' ? 0.16 : 0);
  }

  maxSpeed(e, sprint) {
    const P = this.p(e.id);
    let v = 12 + (P.attrs.speed - 60) * 0.09;
    v *= 0.82 + 0.18 * this.energy(e);
    if (sprint) v *= 1.35;
    if (this.ball.holder === e) v *= 0.93 + (P.attrs.ball_handle - 60) * 0.001;
    if (this.humans.length && !this.isHuman(e.side) && this.state.possession !== e.side) v *= this.diff.aiDefSpeed;
    return v;
  }

  steer(e, tx, ty, sprint = false, arrive = 2.5) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.25) { e.dvx = 0; e.dvy = 0; e.sprinting = false; return; }
    const v = this.maxSpeed(e, sprint) * Math.min(1, d / arrive);
    e.dvx = dx / d * v; e.dvy = dy / d * v;
    e.sprinting = sprint && d > arrive;
  }

  hold(e) { e.dvx = 0; e.dvy = 0; e.sprinting = false; }

  say(text, dur = 1.6) { this.banner = { text, t: 0, dur }; }
  fxText(text, x, y, color = '#fff') { this.fx.push({ text, x, y, t: 0, dur: 1.3, color }); }
  name(id) { return id ? this.p(id).last ?? this.p(id).name : 'Team'; }

  /** Copy new engine events into the play-by-play feed. */
  pump() {
    const evs = this.game.events;
    const ids = { home: this.state.teams.home.id, away: this.state.teams.away.id };
    for (; this._seen < evs.length; this._seen++) {
      const ev = evs[this._seen];
      if (ev.type === 'game_start' || ev.type === 'sub') continue;
      this.feed.push({ text: describe(ev, this.data.byId, ids), period: ev.period, clock: ev.clock, team: ev.team ?? null, type: ev.type });
    }
    if (this.feed.length > 40) this.feed.splice(0, this.feed.length - 40);
  }

  // ------------------------------------------------------------------ main loop

  /**
   * One 60 Hz step. `input` is the intent of the single human side, or { home, away } intents
   * for a two-player game (a missing side counts as no input).
   */
  update(dt, input = NO_INPUT) {
    const I = { home: NO_INPUT, away: NO_INPUT };
    for (const k of this.ctls) I[k] = NO_INPUT;
    if (input && this.ctls.some((k) => input[k])) { for (const k of this.ctls) I[k] = input[k] ?? NO_INPUT; }
    else if (this.ctls.length === 1) I[this.ctls[0]] = input ?? NO_INPUT;
    this.time += dt;
    if (this.banner && (this.banner.t += dt) >= this.banner.dur) this.banner = null;
    for (const f of this.fx) f.t += dt;
    if (this.fx.length && this.fx[0].t >= this.fx[0].dur) this.fx.shift();

    switch (this.phase) {
      case 'tip': this.updateTip(dt); break;
      case 'live': this.updateLive(dt, I); break;
      case 'anim': this.updateAnim(dt, I); break;
      case 'inbound': this.updateInbound(dt); break;
      case 'break': this.updateBreak(dt); break;
      case 'check': this.updateCheck(dt); break;
      case 'clear': this.updateClear(dt); break;
      default: for (const e of this.all) this.hold(e);
    }
    for (const k of this.ctls) this.uc[k].shootHeld = !!I[k].shoot;
    this.physics(dt);
    this.ballFollow(dt);
    if (this._seen < this.game.events.length) this.pump();
  }

  physics(dt) {
    const all = this.all;
    for (const e of all) {
      if (e.stun > 0) { e.stun -= dt; e.dvx = 0; e.dvy = 0; }
      if (e.stealCd > 0) e.stealCd -= dt;
      if (e.dmove && e.dmove.t < e.dmove.dur) e.dmove.t += dt;
      const ax = e.dvx - e.vx, ay = e.dvy - e.vy;
      const a = Math.hypot(ax, ay), maxA = 55 * dt;
      if (a > maxA) { e.vx += ax / a * maxA; e.vy += ay / a * maxA; } else { e.vx = e.dvx; e.vy = e.dvy; }
      e.x += e.vx * dt; e.y += e.vy * dt;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > 1.5) { e.fx = e.vx / sp; e.fy = e.vy / sp; }
      if (e.sprinting && sp > 8) this.game.exert(e.side, e.id, M.energyDrainPerSec(this.p(e.id)) * dt);
    }
    // Bodies: opponents block each other (the defender holds his ground better), teammates brush past.
    const MIN = 2.4;
    // StreetBall reset walk: nobody blocks anybody on the way back to their places
    if (this.phase !== 'clear') for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.oob || b.oob) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= MIN || d < 1e-6) continue;
        const push = MIN - d, nx = dx / d, ny = dy / d;
        let wa = 0.5, wb = 0.5, k = 1;
        if (a.side === b.side) k = 0.4;
        else if (a.stun > 0 || b.stun > 0) k = 0.3;
        else if (this.ball.holder === a) { wa = 0.72; wb = 0.28; }
        else if (this.ball.holder === b) { wa = 0.28; wb = 0.72; }
        a.x -= nx * push * wa * k; a.y -= ny * push * wa * k;
        b.x += nx * push * wb * k; b.y += ny * push * wb * k;
      }
    }
    for (const e of all) {
      // Only a user-controlled ball handler can step out of bounds (CPU players keep their feet in).
      const m = e.oob || (e === this.ball.holder && this.isCtrl(e)) ? -3 : 0.6;
      e.x = clamp(e.x, m, COURT.L - m);
      e.y = clamp(e.y, m, COURT.W - m);
      // StreetBall: everybody stays in the half the ball is played in (only the ball handler can step over)
      if (this.street && m > 0) {
        e.x = this.dirRight(this.courtSide) ? Math.max(e.x, COURT.L / 2 + 0.6) : Math.min(e.x, COURT.L / 2 - 0.6);
      }
    }
  }

  ballFollow(dt) {
    const b = this.ball, h = b.holder;
    if (!h) return;
    const k = Math.min(1, dt * 18);
    b.x += (h.x + h.fx * 1.3 - b.x) * k;
    b.y += (h.y + h.fy * 1.3 - b.y) * k;
    const sp = Math.hypot(h.vx, h.vy);
    b.z = this.meter || this.windup || this.phase !== 'live' ? 5 : 1.2 + 1.8 * Math.abs(Math.sin(this.time * (6 + sp * 0.3)));
  }

  runClock(dt, shotClock = true) {
    this.acc += dt;
    while (this.acc >= DT_CLOCK) { this.acc -= DT_CLOCK; this.game.tick(DT_CLOCK, 1, shotClock); }
    this.dispClock = Math.max(0, this.state.clock - this.acc);
  }

  // ------------------------------------------------------------------ tip-off

  formation() {
    for (const e of this.all) {
      e.spot = null; e.cut = 0; e.screen = 0; e.roll = false;
      const off = e.side === this.state.possession;
      const t = off ? this.spotOf(e) : null;
      if (off) { e.x = t.x - (this.dirRight(e.side) ? 30 : -30); e.y = t.y; }
      e.vx = e.vy = 0; e.stun = 0; e.oob = false;
    }
    for (const e of this.all) {
      if (e.side === this.state.possession) continue;
      const m = this.matchOf(e), hoop = this.hoopOf(m.side);
      e.x = lerp(m.x, hoop.x, 0.25); e.y = lerp(m.y, hoop.y, 0.25);
      e.trkx = m.x; e.trky = m.y;
    }
  }

  startTip() {
    this.phase = 'tip'; this.phaseT = 0;
    for (const e of this.all) {
      const t = this.N(e.side, ...TIP[e.role]);
      e.x = t.x; e.y = t.y; e.vx = e.vy = 0; e.spot = null; e.oob = false;
      e.fx = this.dirRight(e.side) ? 1 : -1; e.fy = 0;
      e.trkx = e.x; e.trky = e.y;
    }
    Object.assign(this.ball, { x: 47, y: 25, z: 4, holder: null, flight: null });
    this.say('Tip-off', 1.4);
  }

  updateTip(dt) {
    this.phaseT += dt;
    for (const e of this.all) this.hold(e);
    this.ball.z = this.phaseT < 0.7 ? 4 : 4 + Math.sin(Math.min(1, (this.phaseT - 0.7) / 0.8) * Math.PI) * 9;
    if (this.phaseT >= 1.5) {
      const side = this.state.possession;
      this.goLive(this.ents[side].find((e) => e.role === 0), 'tip');
    }
  }

  // ------------------------------------------------------------------ live play

  goLive(holder, kind = 'live') {
    const b = this.ball;
    this.phase = 'live';
    b.holder = holder; b.flight = null;
    this.meter = null; this.windup = null; this.queue = []; this.ftLine = null; this.inb = null;
    this.plan = AI.newPlan(this, holder);
    const side = holder.side;
    this.crossed = this.isFront(side, holder.x, 0.5);
    this.bcT = 0; this.possT = 0;
    this.transition = (kind === 'defreb' || kind === 'steal') && !this.crossed;
    if (kind !== 'oreb') for (const e of this.ents[side]) { e.spot = null; e.cut = 0; e.screen = 0; e.roll = false; }
    for (const e of this.all) { e.oob = false; e.handsUp = false; e.pivot = false; e.dribbled = false; e.faked = 0; }
    this.double = null; this.ftMeter = null; this.rebCtx = null;
    this.assignAll(holder);
    if (this.humans.length) this.needRelease = true;
  }

  updateLive(dt, I) {
    const g = this.game, s = g.state, b = this.ball;
    this.runClock(dt);
    if (s.clock <= 0) return this.startBreak();
    const offSide = s.possession;
    if (s.shotClock <= 0) return this.engine(() => g.turnover(offSide, null, 'shot_clock'));
    this.possT += dt;

    if (b.flight && this.updateFlight(dt)) return;
    const holder = b.holder;

    this.passTarget = null;
    for (const k of this.ctls) this.updateControl(I[k], offSide, k);

    // Violations.
    if (holder && (holder.x < 0 || holder.x > COURT.L || holder.y < 0 || holder.y > COURT.W)) {
      return this.engine(() => g.turnover(offSide, holder.id, 'out_of_bounds'));
    }
    if (!this.crossed) {
      if (holder && this.isFront(offSide, holder.x, 0.5)) this.crossed = true;
      else if ((this.bcT += dt) >= g.rules.backcourtSecs) {
        return this.engine(() => g.turnover(offSide, holder?.id ?? null, 'eight_second'));
      }
    } else if (holder && !this.isFront(offSide, holder.x, -1.5)) {
      return this.engine(() => g.turnover(offSide, holder.id, this.street ? 'out_of_bounds' : 'backcourt'));
    }

    // Intents for everyone.
    this.helper = AI.pickHelper(this, holder);
    let act = null;
    for (const e of this.all) {
      const lobTo = b.flight?.lob && b.flight.to === e;
      const ck = lobTo ? null : this.ctlOf(e);
      // 2v2: a person off the ball on offense moves his man only while holding a direction (else the CPU runs his cuts)
      if (ck && (e === holder || e.side !== offSide || !this.uc[ck].roles || hasDir(I[ck]))) { this.userMove(e, I[ck]); continue; }
      if (e.side === offSide) {
        if (e === holder) {
          if (this.windup) { this.hold(e); continue; }
          const o = AI.handlerThink(this, e, dt);
          if (this.mustClear) {
            // StreetBall, after a defensive rebound: take it out past the arc first (or pass it to someone out there)
            const t = this.clearPoint(e);
            this.steer(e, t.x, t.y, false, 1.5);
            if (o.pass && this.isCleared(o.pass)) act = { k: 'pass', e, to: o.pass };
            continue;
          }
          this.steer(e, o.tx, o.ty, o.sprint);
          if (o.shoot) act = { k: 'shoot', e };
          else if (o.pass) act = { k: 'pass', e, to: o.pass };
        } else if (lobTo) this.steer(e, b.flight.pt.x, b.flight.pt.y, true, 1);
        else if (b.flight && b.flight.to === e) this.hold(e);
        else { const t = AI.offBallTarget(this, e, dt); this.steer(e, t.tx, t.ty, t.sprint); }
      } else {
        const t = AI.defendTarget(this, e, dt);
        this.steer(e, t.tx, t.ty, t.sprint, 1.5);
        if (holder && !act && e.stealCd <= 0 && distE(e, holder) < 3.9) {
          const trap = this.double && distE(this.double.e, holder) < 4.5 ? 1.8 : 1;
          const rate = 0.11 * trap * (this.p(e.id).attrs.steal / 60) * (this.isHuman(e.side) ? 1 : this.diff.aiSteal);
          if (this.rng.chance(rate * dt)) act = { k: 'steal', e };
        }
      }
    }

    if (this.mustClear && b.holder && b.holder.side === offSide && this.isCleared(b.holder)) {
      this.mustClear = false;
      this.fxText('Cleared', b.holder.x, b.holder.y - 3.5, '#8fe3ff');
    }

    // CPU shot wind-up (gives the defense a beat to contest).
    if (this.windup) {
      this.windup.t += dt;
      if (this.windup.t >= this.windup.dur) {
        const e = this.windup.e;
        this.windup = null;
        if (b.holder === e) return this.shoot(e, this.humans.length && !this.isHuman(e.side) ? this.diff.aiShotMod : 0);
      }
    }

    // User actions (each human side in turn; stop if one of them changed the phase).
    for (const k of this.ctls) if (this.userActions(dt, I[k], k, offSide, holder)) return;

    if (act) {
      if (act.k === 'shoot') {
        const zone = shotZone(act.e.x, act.e.y, this.hoopOf(act.e.side));
        // The CPU does not take shots from behind the backboard or falling out of bounds unless the clock forces it.
        if (this.toughAngle(act.e).sev > 0.35 && Math.min(s.shotClock, s.clock) > 2.5 && this.plan) {
          this.plan.mode = 'set'; this.plan.think = 0.5; this.plan.driveT = 0; this.plan.stall = 0; this.plan.setT = 0;
        } else this.windup = { e: act.e, t: 0, dur: AI.releaseTime(this, act.e, zone.type), type: zone.type };
      } else if (act.k === 'pass') {
        const to = act.to, hp = this.hoopOf(to.side);
        // A big rolling free to the rim gets a lob.
        if (this.crossed && to.cut > 0 && this.p(to.id).attrs.dunk >= 65 && distE(to, hp) < 14 && distE(act.e, hp) > 15
          && this.nearestDef(to).d > 3 && this.rng.chance(0.5)) this.lob(act.e, to);
        else this.pass(act.e, to);
      }
      else if (act.k === 'steal') this.trySteal(act.e);
    }
  }

  /** Buttons of one human side during live play. @returns true if the phase changed (stop the step). */
  userActions(dt, input, k, offSide, holder) {
    const g = this.game, s = g.state, U = this.uc[k], ctrl = U.ctrl, me = U.side;
    if (!ctrl) return false;
    if (offSide === me) {
      // 2v2, off the ball: Q switches between your own players
      if (holder !== ctrl && input.swap && U.roles) this.swapOwn(k);
      if (holder === ctrl) {
        if (input.pick && !this.meter) this.callPick(holder);
        if (!input.shoot) this.needRelease = false;
        if (input.res) {
          // online guest: its own screen timed the meter and already decided the result
          if (!this.meter) this.startMeter(holder);
          else { this.meter.t += dt; this.meterContest(holder); }
          if (input.res === RES.FAKE) { if (holder.fakeT != null && this.time - holder.fakeT < FAKE_COOLDOWN) this.meter = null; else this.pumpFake(holder); }
          else { this.releaseMeter(input.hold / 60, input.res); return true; }
        } else if (this.meter) {
          this.meter.t += dt;
          this.meterContest(holder);
          const pt = perceived(input, this.meter.t);
          // A remote player's own screen lets go of the meter (and says so); here we only wait for it.
          const cap = this.meter.dur * 1.18 + (input.net ? NET_GRACE : lagOf(input));
          // A very light tap is a pump fake; holding and letting go is the shot.
          if (!input.shoot && pt < TAP_FAKE) { if (holder.fakeT != null && this.time - holder.fakeT < FAKE_COOLDOWN) this.meter = null; else this.pumpFake(holder); }
          else if (!input.shoot || this.meter.t >= cap) { this.releaseMeter(input.shoot ? this.meter.t - (input.net ? NET_GRACE : lagOf(input)) : pt); return true; }
        } else if (input.shoot && !this.needRelease) this.startMeter(holder);
        else if ((input.move || input.spin) && this.dribbleMove(holder, input) === 'stolen') return true;
        else if (input.pass && this.passTarget) { this.pass(holder, this.passTarget); return true; }
        else if (input.swap && this.callOop(holder)) return true;
      }
    } else {
      ctrl.handsUp = !!input.shoot;
      if (input.pick) this.callDouble(k);
    }
    if (this.double && this.double.e.side === me && ((this.double.t += dt) > 7 || !holder || holder.side === me)) this.double = null;
    // T: timeout (your team must have the ball while play is live).
    if ((input.timeout || U.wantTimeout) && offSide === me && holder && !this.meter && s.teams[me].timeouts > 0) {
      this.noTimeout = true; U.wantTimeout = false;
      this.engine(() => { g.callTimeout(me); s.next = { kind: this.crossed ? 'inbound_front' : 'inbound_back' }; });
      return true;
    }
    if (offSide !== me) {
      if (input.steal && this.trySteal(ctrl)) return true;
      if (input.swap) this.swapDefender(k);
    }
    return false;
  }

  updateControl(input, offSide, k) {
    const b = this.ball, U = this.uc[k], me = U.side;
    if (offSide === me) {
      const c = b.holder ?? b.flight?.to ?? U.ctrl;
      if (c && this.owns(k, c)) U.ctrl = c;
      else if (!U.ctrl || !this.owns(k, U.ctrl)) U.ctrl = this.nearestOwn(k, c ?? b) ?? this.ents[me][0];
      if (b.holder && b.holder === U.ctrl) this.passTarget = this.pickPassTarget(U.ctrl, input);
    } else if (!U.ctrl || !this.owns(k, U.ctrl)) {
      const be = this.ballEnt();
      const m = be && be.side !== me ? this.matchOf(be) : null;
      U.ctrl = m && this.owns(k, m) ? m : this.nearestOwn(k, be ?? b) ?? this.ents[me][0];
    }
  }

  userMove(e, input) {
    const n = Math.hypot(input.mx, input.my);
    if (e.pivot && e === this.ball.holder) {
      // Picked up his dribble (pump fake): the pivot foot stays down and the body swings around it.
      if (!e.pivotAt) e.pivotAt = { x: e.x, y: e.y };
      if (n >= 0.01) {
        const ux = input.mx / n, uy = input.my / n;
        if (Math.abs(ux - e.fx) > 0.01 || Math.abs(uy - e.fy) > 0.01) e.pivotStep = this.time;
        e.fx = ux; e.fy = uy;
        const tx = e.pivotAt.x + ux * PIVOT_STEP, ty = e.pivotAt.y + uy * PIVOT_STEP;
        const dx = tx - e.x, dy = ty - e.y, dd = Math.hypot(dx, dy);
        if (dd > 0.12) { const v = Math.min(6, dd * 8); e.dvx = dx / dd * v; e.dvy = dy / dd * v; e.sprinting = false; return; }
      }
      return this.hold(e);
    }
    if (this.meter && e === this.ball.holder) {
      // A layup is finished on the move: he keeps driving at the rim while the meter fills.
      if (this.meter.rim) {
        const hp = this.hoopOf(e.side), d = distE(e, hp);
        if (d > 3) {
          const v = this.maxSpeed(e, input.sprint) * 0.8;
          e.dvx = (hp.x - e.x) / d * v; e.dvy = (hp.y - e.y) / d * v; e.sprinting = !!input.sprint;
          return;
        }
      }
      return this.hold(e);
    }
    if (e.dmove && e.dmove.t < e.dmove.dur && e === this.ball.holder) {
      // dribble move in progress: he goes where the move takes him (a blow-by is a burst)
      const m = e.dmove;
      // a spin is slow (about 40% speed) and curls around the defender; an in-and-out is a small gain
      const k = m.burst ? 1.18 : m.kind === 'spin' ? 0.4 : m.kind === 'in_and_out' ? (m.ok ? 0.6 : 0.4) : m.ok ? 0.85 : 0.5;
      const v = this.maxSpeed(e, !!m.burst || (m.kind !== 'spin' && input.sprint)) * k;
      let dx = m.dx, dy = m.dy;
      if (m.curl) {
        const a = m.curl * 0.7 * (1 - m.t / m.dur), ca = Math.cos(a), sa = Math.sin(a);
        dx = m.dx * ca - m.dy * sa; dy = m.dx * sa + m.dy * ca;
      }
      e.dvx = dx * v; e.dvy = dy * v; e.sprinting = !!(m.burst || (m.kind !== 'spin' && input.sprint));
      return;
    }
    if (n < 0.01) return this.hold(e);
    if (e === this.ball.holder) e.dribbled = true;          // moving with the ball = dribbling
    const v = this.maxSpeed(e, input.sprint);
    e.dvx = input.mx / n * v; e.dvy = input.my / n * v;
    e.sprinting = !!input.sprint;
  }

  /** E passes toward the direction you are holding (or facing). */
  pickPassTarget(h, input) {
    let dx = input.mx, dy = input.my;
    const n = Math.hypot(dx, dy);
    if (n < 0.01) { dx = h.fx; dy = h.fy; } else { dx /= n; dy /= n; }
    let best = null, bs = -Infinity;
    for (const m of this.ents[h.side]) {
      if (m === h) continue;
      const mx = m.x - h.x, my = m.y - h.y;
      const d = Math.hypot(mx, my) || 1;
      const sc = (mx * dx + my * dy) / d - d * 0.004;
      if (sc > bs) { bs = sc; best = m; }
    }
    return best;
  }

  swapDefender(k) {
    const be = this.ballEnt(), U = this.uc[k];
    if (!be) return;
    const order = this.mine(k).filter((e) => e !== U.ctrl).sort((a, b) => distE(a, be) - distE(b, be));
    if (!order.length) return;
    U.ctrl.handsUp = false;
    U.ctrl = order[0];
  }

  /** 2v2 offense off the ball: next of your own players. */
  swapOwn(k) {
    const U = this.uc[k], list = this.mine(k);
    if (list.length < 2) return;
    U.ctrl = list[(list.indexOf(U.ctrl) + 1) % list.length];
  }

  // ------------------------------------------------------------------ passing

  pass(from, to) {
    const b = this.ball;
    const d = distE(from, to);
    const f = { from, to, t: 0, dur: Math.max(0.18, d / 42), sx: from.x, sy: from.y, icpt: null, icptU: 0, oob: null };
    const P = this.p(from.id);
    for (const e of this.ents[other(from.side)]) {
      if (e.stun > 0) continue;
      const { u, dd } = segPoint(from, to, e);
      if (u < 0.15 || u > 0.92 || dd > 2.4) continue;
      let pi = 0.22 + (2.4 - dd) * 0.12 + 0.004 * (this.p(e.id).attrs.steal - P.attrs.passing);
      if (this.isHuman(from.side)) pi *= this.diff.userIcpt;
      if (this.rng.chance(clamp(pi, 0.05, 0.65)) && (!f.icpt || u < f.icptU)) { f.icpt = e; f.icptU = u; }
    }
    if (!f.icpt) {
      // A defender sitting on the receiver can still jump the pass.
      const nd = this.nearestDef(to);
      if (nd.e && nd.d < 4.5 && nd.e.stun <= 0 && this.rng.chance(0.04 * this.p(nd.e.id).attrs.steal / 60 * (5 - nd.d) / 2.5)) {
        f.icpt = nd.e; f.icptU = 0.9;
      }
    }
    if (!f.icpt && !this.isHuman(from.side)
      && this.rng.chance(0.02 * P.tendencies.tov_per36 / this.data.league.tend.tov_per36)) {
      // Errant pass sails out of bounds.
      const ux = (to.x - from.x) / (d || 1), uy = (to.y - from.y) / (d || 1);
      let k = d + 4;
      while (k < 120) {
        const x = from.x + ux * k, y = from.y + uy * k;
        if (x < -1 || x > COURT.L + 1 || y < -1 || y > COURT.W + 1) break;
        k += 2;
      }
      f.oob = { x: from.x + ux * k - uy * 3, y: from.y + uy * k + ux * 3 };
      f.dur = Math.max(0.3, k / 42);
    }
    b.holder = null; b.flight = f;
    this.meter = null; this.windup = null; this.double = null; from.pivot = false; from.dribbled = false;
    this.lastPass = { from, to, t: this.time };
    return false;
  }

  /** Q on offense: lob to the best dunker cutting to the rim. */
  callOop(h) {
    if (!this.crossed) return false;
    const hoop = this.hoopOf(h.side);
    if (distE(h, hoop) < 10) { this.fxText('Too close for a lob', h.x, h.y - 8, '#ffb347'); return false; }
    let best = null, bs = -1e9;
    for (const m of this.ents[h.side]) {
      if (m === h || m.stun > 0) continue;
      const d = distE(m, hoop), dunk = this.p(m.id).attrs.dunk;
      if (dunk < 50 || d > 24) continue;
      const sc = dunk - d * 1.5 + Math.min(6, this.nearestDef(m).d) * 3;
      if (sc > bs) { bs = sc; best = m; }
    }
    if (!best) { this.fxText('No lob target', h.x, h.y - 8, '#ffb347'); return false; }
    this.lob(h, best);
    return true;
  }

  /** Throw a lob to a point just in front of the rim; the target has to get there to finish it. */
  lob(from, to) {
    const b = this.ball, hoop = this.hoopOf(from.side);
    const ux = to.x - hoop.x, uy = to.y - hoop.y, n = Math.hypot(ux, uy) || 1;
    const pt = { x: hoop.x + ux / n * 2.6, y: hoop.y + uy / n * 2.6 };
    const f = {
      from, to, t: 0, dur: Math.max(0.7, distE(from, pt) / 30, distE(to, pt) / 14),
      sx: from.x, sy: from.y, icpt: null, icptU: 0, oob: null, lob: true, pt,
    };
    to.cut = 0; to.screen = 0; to.roll = false;
    b.holder = null; b.flight = f;
    this.meter = null; this.windup = null; this.double = null; from.pivot = false; from.dribbled = false;
    this.lastPass = { from, to, t: this.time };
    this.fxText('Alley-oop!', from.x, from.y - 8, '#f3d35a');
    if (this.isHuman(from.side)) this.stats.lobs = (this.stats.lobs ?? 0) + 1;
  }

  /** @returns true if the phase changed (turnover). */
  updateFlight(dt) {
    const b = this.ball, f = b.flight, g = this.game;
    f.t += dt;
    const u = Math.min(1, f.t / f.dur);
    const tgt = f.oob ?? f.pt ?? f.to;
    const tx = tgt.x, ty = tgt.y;
    b.x = lerp(f.sx, tx, u); b.y = lerp(f.sy, ty, u);
    b.z = f.lob ? 5 + u * 6 + Math.sin(u * Math.PI) * 7 : 4 + Math.sin(u * Math.PI) * 2.5;
    const side = f.from.side;
    if (f.icpt && u >= f.icptU) {
      this.fxText('Picked off!', b.x, b.y, '#ffd24a');
      g.turnover(side, f.from.id, 'bad_pass', f.icpt.id);
      this.resume();
      return true;
    }
    if (u >= 1) {
      if (f.oob) { this.engine(() => g.turnover(side, f.from.id, 'bad_pass_out_of_bounds')); return true; }
      if (f.lob) {
        if (distE(f.to, f.pt) > 4.2 || f.to.stun > 0) {
          this.fxText('Nobody home', b.x, b.y, '#ffb347');
          this.engine(() => g.turnover(side, f.from.id, 'bad_pass_out_of_bounds'));
          return true;
        }
        // A defender who got back to the rim can knock the lob away (the lob only works over a beaten defense).
        for (const e of this.ents[other(side)]) {
          const dd = distE(e, f.pt);
          if (e.stun > 0 || dd > 4.5) continue;
          const A = this.p(e.id).attrs;
          let pi = 0.18 + (4.5 - dd) * 0.07 + 0.003 * ((A.block + A.steal) / 2 - this.p(f.from.id).attrs.passing);
          if (this.isHuman(side)) pi *= this.diff.userIcpt;
          if (this.rng.chance(clamp(pi, 0.08, 0.6))) {
            this.fxText('Lob knocked away!', b.x, b.y, '#ffd24a');
            g.turnover(side, f.from.id, 'bad_pass', e.id);
            this.resume();
            return true;
          }
        }
        b.flight = null; b.holder = f.to;
        this.give(f.to);
        // catching and finishing in the air: a little harder than a layup, harder still if he got there late
        this.shoot(f.to, -0.04 - 0.03 * Math.max(0, distE(f.to, f.pt) - 1.5), false, { oop: true });
        return true;
      }
      b.flight = null; b.holder = f.to;
      this.plan = AI.newPlan(this, f.to, { caught: true });
      if (this.isHuman(side)) { this.give(f.to); if (this.isCtrl(f.to)) this.needRelease = true; }
    }
    return false;
  }

  // ------------------------------------------------------------------ stealing / fouls

  /** @returns true if the phase changed (steal or foul). */
  trySteal(d) {
    const h = this.ball.holder, g = this.game;
    if (!h || h.side === d.side || d.stealCd > 0 || d.stun > 0) return false;
    d.stealCd = 0.9;
    const dd = distE(d, h);
    if (dd > 4.3) { d.stun = 0.25; return false; }
    let ps = 0.11 + 0.004 * (this.p(d.id).attrs.steal - this.p(h.id).attrs.ball_handle);
    if (h.sprinting) ps += 0.03;
    ps = clamp(ps * (dd < 2.8 ? 1.2 : 0.8), 0.03, 0.3);
    const r = this.rng.next();
    if (r < ps) {
      this.fxText('Steal!', h.x, h.y, '#ffd24a');
      g.turnover(h.side, h.id, 'lost_ball', d.id);
      this.resume();
      return true;
    }
    if (!this.street && r < ps + (this.isCtrl(d) ? 0.13 : 0.07)) {
      const front = this.isFront(h.side, h.x);
      this.engine(() => g.defensiveFoul(d.id, h.id, front));
      return true;
    }
    d.stun = 0.45; // lunged and missed
    return false;
  }

  /** User call: the nearest big comes up to screen the ball handler's defender, then rolls to the rim. */
  callPick(h) {
    if (!this.crossed) return false;
    const mates = this.ents[h.side].filter((m) => m !== h);
    if (mates.some((m) => m.screen > 0)) return false;
    const bigs = mates.filter((m) => m.role >= 3);
    const s = (bigs.length ? bigs : mates).reduce((a, b) => (distE(a, h) <= distE(b, h) ? a : b));
    const hoop = this.hoopOf(h.side), d = this.matchOf(h);
    const dx = hoop.x - h.x, dy = hoop.y - h.y;
    // screen on whichever side of the defender the screener is already on
    s.screenSide = (-dy * (s.x - d.x) + dx * (s.y - d.y)) >= 0 ? 1 : -1;
    s.screen = AI.TUNE.screenTime + 1.5; s.screenSet = 0; s.screenUsed = true; s.cut = 0; s.roll = false; s.called = true;
    this.fxText('Pick and roll', h.x, h.y - 8, '#f3d35a');
    return true;
  }

  /** R on defense: the nearest free teammate leaves his man and traps the ball. R again calls it off. */
  callDouble(k) {
    const h = this.ball.holder, me = this.uc[k].side;
    if (!h || h.side === me) return false;
    if (this.double) { this.double = null; this.fxText('Double team off', h.x, h.y - 8, '#c8c8c8'); return false; }
    const onBall = this.matchOf(h);
    const pool = this.ents[me].filter((e) => !this.isCtrl(e) && e !== onBall);
    if (!pool.length) return false;
    const e = pool.reduce((a, c) => (distE(a, h) <= distE(c, h) ? a : c));
    this.double = { e, t: 0 };
    this.stats.doubles = (this.stats.doubles ?? 0) + 1;
    this.fxText('Double team', h.x, h.y - 8, '#f3d35a');
    return true;
  }

  /**
   * C: dribble move. The direction held (relative to the hoop) picks it: sideways = crossover or
   * between the legs, toward the rim = spin, backward = step back, none = hesitation. Ball handling
   * and speed against the defender's perimeter defense decide if it works. Holding Shift turns a
   * successful move into a blow-by: a burst, and the defender stays beaten longer.
   * @returns 'stolen' if the defender picked his pocket (phase changed), true if a move started.
   */
  dribbleMove(h, input) {
    if (h.pivot || this.meter || (h.dmove && this.time - h.dmove.at < 0.7)) return false;
    const hoop = this.hoopOf(h.side), d = this.matchOf(h);
    const hx = hoop.x - h.x, hy = hoop.y - h.y, hn = Math.hypot(hx, hy) || 1;
    const n = Math.hypot(input.mx, input.my);
    let ux = hx / hn, uy = hy / hn, kind;
    if (n >= 0.01) { ux = input.mx / n; uy = input.my / n; }
    if (input.spin) kind = 'spin';                       // V: spin, whichever way he is going
    else if (n < 0.01) kind = 'hesitation';
    else {
      const dot = (ux * hx + uy * hy) / hn;
      kind = dot < -0.5 ? 'step_back' : dot > 0.6 ? 'in_and_out' : SIDE_MOVES[(h.moves = (h.moves ?? 0) + 1) % SIDE_MOVES.length];
    }
    const A = this.p(h.id).attrs, dd = d ? distE(h, d) : 99;
    const D = d ? this.p(d.id).attrs : null;
    const p = !d || dd > 7 ? 1 : clamp(0.38 + 0.009 * (A.ball_handle - D.perimeter_def) + 0.004 * (A.speed - 60)
      - (d.stun > 0 ? -0.2 : 0) - (kind === 'hesitation' ? 0.05 : 0) - 0.03 * (h.movesLate ?? 0), 0.1, 0.8);
    const ok = this.rng.chance(p);
    const burst = ok && !!input.sprint && !['step_back', 'hesitation', 'spin', 'in_and_out'].includes(kind);
    // a spin curls away from the defender
    const curl = kind === 'spin' && d ? Math.sign((d.x - h.x) * uy - (d.y - h.y) * ux) || 1 : 0;
    h.movesLate = this.time - (h.dmove?.at ?? -9) < 2 ? (h.movesLate ?? 0) + 1 : 0;   // chaining moves gets harder
    h.dribbled = true;
    h.dmove = { kind, t: 0, dur: burst ? 0.55 : kind === 'step_back' ? 0.35 : kind === 'spin' ? 0.5 : 0.4, dx: ux, dy: uy, ok, burst, curl, at: this.time };
    this.stats.moves = (this.stats.moves ?? 0) + 1;
    if (d && dd <= 7) {
      if (ok) {
        d.stun = Math.max(d.stun, burst ? 0.75 : kind === 'in_and_out' ? 0.3 : 0.4); d.bitT = this.time;
        if (burst) { this.fxText('Blow-by!', h.x, h.y - 8, '#f3d35a'); this.stats.blowbys = (this.stats.blowbys ?? 0) + 1; }
      } else if (dd < 3.6 && d.stun <= 0 && this.rng.chance(0.05 + 0.002 * (D.steal - A.ball_handle))) {
        this.fxText('Stripped!', h.x, h.y, '#ffd24a');
        this.game.turnover(h.side, h.id, 'lost_ball', d.id);
        this.resume();
        return 'stolen';
      }
    }
    return true;
  }

  /** A light tap on Space: fake the shot. He has picked up his dribble, so he can only pivot, pass or shoot. */
  pumpFake(h) {
    this.meter = null;
    // Picking the ball up after dribbling ends the dribble (no double dribble): pivot, pass or shoot.
    // A fake right after the catch, before any dribble, keeps it alive.
    if (h.dribbled) { h.pivot = true; h.pivotAt = { x: h.x, y: h.y }; }
    h.fakeT = this.time;
    this.fxText('Pump fake', h.x, h.y - 3.5, '#f3d35a');
    for (const d of this.ents[other(h.side)]) {
      if (d.stun > 0 || distE(d, h) > 5) continue;
      const bite = (0.45 - 0.004 * (this.p(d.id).attrs.perimeter_def - 60)) * (h.faked ? 0.35 : 1);
      if (this.rng.chance(clamp(bite, 0.08, 0.6))) { d.stun = 0.65; d.bitT = this.time; }
    }
    h.faked += 1;
    this.stats.fakes = (this.stats.fakes ?? 0) + 1;
  }

  /**
   * How awkward the spot is, 0..1: behind the backboard (the board is in the way), or right on the
   * baseline / sideline (falling out of bounds). Corner threes with both feet in are not flagged.
   */
  toughAngle(e, hoop = this.hoopOf(e.side)) {
    const sgn = hoop.x > 47 ? 1 : -1;
    const past = (e.x - hoop.x) * sgn;              // feet past the rim toward the baseline
    const lat = Math.abs(e.y - hoop.y);
    const behind = clamp((past - 0.6 - 0.18 * lat) / 2.2, 0, 1);
    const sd = Math.min(e.y, COURT.W - e.y), bd = COURT.HOOP - past;
    const edge = 0.6 * Math.max(clamp((1.6 - sd) / 1.6, 0, 1), clamp((1.8 - bd) / 1.8, 0, 1));
    return { sev: Math.max(behind, edge), behind, edge };
  }

  // ------------------------------------------------------------------ shooting

  startMeter(h) {
    const hoop = this.hoopOf(h.side);
    const d = distE(h, hoop);
    const isRim = d <= COURT.RIM_RANGE;
    const isMid = d < COURT.THREE_R;
    this.meter = {
      t: 0,
      dur: isRim ? 0.46 : isMid ? 0.58 : 0.66,
      rim: isRim,   // a layup: he keeps driving at the rim while the meter fills
      sweet: 1.0,
      green: 0, orange: 0, greenStart: 0.95, greenEnd: 1.01, orangeStart: 0.77,
    };
    this.meterContest(h);
  }

  /**
   * Determine green and orange bar sizes dynamically factoring in:
   * 1. Player attributes (3pt, mid, finishing, dunk, stamina, overall)
   * 2. Shot type (rim/layup/dunk vs mid vs three)
   * 3. Distance from basket (rim, short mid, deep mid, corner 3, wing 3, top 3, deep 3, half court)
   * 4. Court location (corner 3 vs wing vs top of key)
   * 5. Defensive contest (wide open expands bar; heavy contest shrinks; contested half court has no green)
   */
  meterContest(h) {
    const m = this.meter;
    if (!m) return;
    const hoop = this.hoopOf(h.side);
    const d = distE(h, hoop);
    const fromBase = hoop.x > COURT.L / 2 ? COURT.L - h.x : h.x;
    const dy = Math.abs(h.y - COURT.W / 2);
    let c = this.contest(h);
    if (m.rim) {
      // A layup's coverage is set when it starts: defenders already in position count fully;
      // one who arrives later can push it to Heavy Contest at most, never Smothered.
      if (!m.c0) { m.c0 = c; m.d0 = d; }
      else {
        const score = Math.max(m.c0.score, Math.min(c.score, LATE_CAP));
        c = score === m.c0.score ? m.c0 : this.contestTier(score, c.primary, c.handsUp, c.parts);
      }
    }
    m.contest = c;
    const ta = this.toughAngle(h, hoop);
    m.tough = ta.sev;
    m.behind = ta.behind;
    m.dist = d;

    // Classify shot type and specific court location
    let type, loc;
    const d0 = m.rim ? m.d0 : d;     // a layup is judged from where it started
    if (d <= COURT.RIM_RANGE || m.rim) {
      type = 'rim';
      loc = d0 <= 4.0 ? 'rim_point_blank' : 'rim_layup';
    } else if (d >= COURT.THREE_R || (dy >= COURT.CORNER_D && fromBase <= COURT.CORNER_X)) {
      type = 'three';
      if (d > 38) loc = 'half_court';
      else if (d > 27) loc = 'deep_3';
      else if (dy >= COURT.CORNER_D && fromBase <= COURT.CORNER_X) loc = 'corner_3';
      else if (dy < 7.5) loc = 'top_3';
      else loc = 'wing_3';
    } else {
      type = 'mid';
      loc = d <= 12 ? 'mid_close' : 'mid_long';
    }
    m.type = type;
    m.loc = loc;

    // Relevant player attribute
    const P = this.p(h.id);
    const A = P.attrs;
    let attr;
    if (type === 'rim') attr = 0.65 * A.finishing + 0.35 * A.dunk;
    else if (type === 'mid') attr = A.mid_range;
    else attr = A.three_pt;
    const ovr = P.overall ?? attr;
    const effectiveRating = 0.75 * attr + 0.25 * ovr;

    // Rating multiplier (average player ~72 -> ~0.75; elite 95+ -> ~1.0; low 50 -> ~0.55)
    const ratingMult = clamp(0.55 + 0.009 * (effectiveRating - 50), 0.38, 1.35);
    const energyMult = 0.8 + 0.2 * this.energy(h);

    // Distance decay multiplier
    let distMult = 1.0;
    if (type === 'rim') {
      // started closer = bigger window; from farther out it shrinks
      distMult = d0 <= 3.5 ? 1.25 : clamp(1.05 - (d0 - 4) * 0.03, 0.8, 1.05);
    } else if (type === 'mid') {
      distMult = clamp(1.05 - (d - 7) * 0.015, 0.8, 1.05);
    } else {
      // Three-pointer
      if (loc === 'corner_3') distMult = 1.15; // Corner 3 distance & angle advantage
      else if (loc === 'wing_3') distMult = 1.0;
      else if (loc === 'top_3') distMult = 0.95; // Top of key is slightly longer (23.75 ft)
      else if (loc === 'deep_3') distMult = clamp(0.9 - (d - 27) * 0.05, 0.25, 0.9);
      else if (loc === 'half_court') distMult = clamp(0.2 - (d - 38) * 0.012, 0.02, 0.2);
    }

    // Defensive contest multiplier
    // Wide open (c.score <= 0.05) expands the bar; heavy contest shrinks it
    let contestMult;
    if (c.score <= 0.05) contestMult = 1.35;
    else if (c.score <= 0.20) contestMult = 1.05;
    else if (c.score <= 0.35) contestMult = 0.82;
    else if (c.score <= 0.50) contestMult = 0.55;
    else if (c.score <= 0.68) contestMult = 0.34;
    else if (c.score <= 0.84) contestMult = 0.18;
    else contestMult = 0.10; // Smothered

    // Angle difficulty
    const hardAngle = Math.max(0.1, 1 - 0.85 * m.tough);

    // Base green and orange window by location
    const BASE_GREEN = {
      rim_point_blank: 0.19,
      rim_layup: 0.14,
      mid_close: 0.095,
      mid_long: 0.070,
      corner_3: 0.068,
      wing_3: 0.056,
      top_3: 0.050,
      deep_3: 0.024,
      half_court: 0.010,
    };
    const BASE_ORANGE = {
      rim_point_blank: 0.24,
      rim_layup: 0.21,
      mid_close: 0.18,
      mid_long: 0.16,
      corner_3: 0.18,
      wing_3: 0.15,
      top_3: 0.14,
      deep_3: 0.09,
      half_court: 0.035,
    };

    const diffScale = this.diff.greenScale, orangeScale = this.diff.orangeScale ?? diffScale;

    // Calculate final green and orange window size
    let gSize = BASE_GREEN[loc] * ratingMult * energyMult * distMult * contestMult * hardAngle * diffScale;
    // Driving layups: a bigger green on Super Easy, Rookie and Pro (All-Star unchanged)
    if (m.rim) gSize *= this.diff.layupGreen ?? 1;
    let oSize = BASE_ORANGE[loc] * ratingMult * energyMult * distMult * contestMult * hardAngle * orangeScale;
    // Enlarge orange bar for a more forgiving window
    oSize *= 1.2;

    // Requirement: A contested half court pull up shouldn't have a green bar at all
    if (loc === 'half_court' && c.score > 0.15) {
      gSize = 0;
      oSize = c.score > 0.4 ? 0 : oSize * 0.3;
    }
    // Also deep 3 heavily contested or smothered has no green bar
    if (loc === 'deep_3' && c.score > 0.65) {
      gSize = 0;
    }

    // Super Easy: the original green window (before the 2K-style meter), same size in seconds, at the top.
    // Never smaller than Rookie's, so Super Easy is the easiest everywhere (the old window was small at the rim).
    if (this.diff.classicGreen) gSize = Math.max(gSize, this.classicGreen(h, m, c.score, type, d));

    // Clamp green window
    if (gSize > 0) {
      gSize = clamp(gSize, 0.012, m.rim ? 0.4 : 0.28);
    } else {
      gSize = 0;
    }

    // Clamp orange window
    if (oSize > 0) {
      oSize = clamp(oSize, 0.02, 0.30);
    } else {
      oSize = 0;
    }

    m.green = gSize;
    m.orange = oSize;
    m.greenStart = gSize > 0 ? 1.0 - gSize : 1.05;
    m.greenEnd = gSize > 0 ? 1.01 : -1;
    m.orangeStart = oSize > 0 ? Math.max(0.08, m.greenStart - oSize) : m.greenStart;
  }

  /**
   * The first meter's green window (v10, Pro): +-green around the sweet spot, as a share of the old
   * meter time (rim 0.5 s, mid 0.72 s, three 0.8 s). Returned as a share of this meter's time.
   */
  classicGreen(h, m, score, type, d) {
    const A = this.p(h.id).attrs;
    const attr = type === 'three' ? A.three_pt : type === 'mid' ? A.mid_range : A.finishing;
    const oldDur = type === 'rim' ? 0.5 : type === 'mid' ? 0.72 : 0.8;
    const base = clamp(0.032 + 0.0007 * (attr - 50), 0.015, 0.09);
    const deep = type === 'three' ? clamp(1 - (d - 24.5) / 8.5, 0.25, 1) : 1;
    const hard = deep * (1 - 0.75 * (m.tough ?? 0));
    const floor = Math.max(0.01, 0.6 / 60 / oldDur) * (hard < 0.95 ? 0.6 : 1);
    const half = clamp(base * GREEN_SCALE * hard * (1.4 - 1.1 * score), floor, 0.11);
    return (2 * half * oldDur) / m.dur;
  }

  calcOrangeProb(h, m) {
    const P = this.p(h.id);
    const A = P.attrs;
    const loc = m.loc ?? 'wing_3';
    const c = m.contest ?? this.contest(h);
    const d = m.dist ?? 20;

    // 1. Base open make probability by location & attribute
    let attr, pBase;
    if (m.type === 'rim') {
      attr = 0.65 * A.finishing + 0.35 * A.dunk;
      pBase = loc === 'rim_point_blank'
        ? clamp(0.72 + 0.0035 * (attr - 50), 0.58, 0.95)
        : clamp(0.62 + 0.0032 * (attr - 50), 0.46, 0.90);
    } else if (m.type === 'mid') {
      attr = A.mid_range;
      pBase = loc === 'mid_close'
        ? clamp(0.52 + 0.0030 * (attr - 50), 0.36, 0.85)
        : clamp(0.44 + 0.0028 * (attr - 50), 0.28, 0.78);
    } else {
      attr = A.three_pt;
      if (loc === 'corner_3') pBase = clamp(0.44 + 0.0032 * (attr - 50), 0.28, 0.80);
      else if (loc === 'wing_3') pBase = clamp(0.38 + 0.0030 * (attr - 50), 0.22, 0.74);
      else if (loc === 'top_3') pBase = clamp(0.34 + 0.0028 * (attr - 50), 0.18, 0.70);
      else if (loc === 'deep_3') pBase = clamp(0.20 + 0.0020 * (attr - 50) - (d - 27) * 0.015, 0.04, 0.45);
      else pBase = clamp(0.04 - (d - 38) * 0.001, 0.005, 0.05); // half-court
    }

    // 2. Stamina multiplier
    pBase *= 0.75 + 0.25 * this.energy(h);

    // 3. Contest scaling
    // Smothered (c.score >= 0.82) -> 0% in orange
    let contestFactor;
    if (m.type === 'rim') {
      contestFactor = Math.max(0, 1 - Math.pow(c.score / 0.88, 1.4));
    } else {
      contestFactor = Math.max(0, 1 - Math.pow(c.score / 0.80, 1.6));
    }

    // Half-court contested: 0% in orange
    if (loc === 'half_court' && c.score > 0.12) contestFactor = 0;
    if (loc === 'deep_3' && c.score > 0.5) contestFactor *= 0.3;

    // 4. Angle penalty
    const angleFactor = Math.max(0.1, 1 - 0.75 * (m.tough ?? 0));

    return clamp(pBase * contestFactor * angleFactor * 1.1, 0, 0.94); // slightly higher make % for orange
  }

  /** @param pt the time on the meter as the shooter saw it when letting go (seconds) */
  releaseMeter(pt, res = 0) {
    const m = this.meter, h = this.ball.holder;
    this.meter = null;
    const rel = Math.max(0, pt) / m.dur;
    let label, color, makeProb, forceMade;
    const zone = res || meterZone(m, rel);

    if (zone === RES.GREEN) {
      // 1. Green bar: at the top and smaller, guaranteed in (even if smothered)
      label = 'GREEN!';
      color = '#39e06a';
      makeProb = 1.0;
      forceMade = true;
      this.lastGreen = true;
    } else if (zone === RES.ORANGE) {
      // 2. Orange bar: dynamically dependent on coverage, location, distance, ratings
      label = 'SLIGHTLY EARLY';
      color = '#ff9a3a';
      makeProb = this.calcOrangeProb(h, m);
      forceMade = null;
    } else if (zone === RES.LATE) {
      // 3. Overshot green: guaranteed miss
      label = 'VERY LATE';
      color = '#ff4a3a';
      makeProb = 0.0;
      forceMade = false;
    } else {
      // 4. Not orange (too early): guaranteed miss
      label = 'VERY EARLY';
      color = '#ff4a3a';
      makeProb = 0.0;
      forceMade = false;
    }

    this.fxText(label, h.x, h.y - 3.5, color);
    this.stats.userShots.push({ rel, label, makeProb });
    return this.shoot(h, 0, forceMade === true, null, { makeProb, forceMade, contest: m.contest });
  }

  shoot(e, timingMod = 0, perfect = false, extra = null, shotResult = null) {
    const g = this.game, side = e.side;
    if (this.street && this.mustClear && side === this.state.possession) {
      // StreetBall: a shot before the ball was cleared does not count; the other team checks it up
      this.fxText("Didn't clear it", e.x, e.y - 3.5, '#ff6b5a');
      return this.engine(() => g.turnover(side, e.id, 'not_cleared'));
    }
    const hoop = this.hoopOf(side);
    const zone = shotZone(e.x, e.y, hoop);
    const nd = this.nearestDef(e);
    const contested = !!nd.e && nd.d <= 6.5;
    const c = shotResult?.contest ?? this.contest(e);
    const ta = this.toughAngle(e, hoop);
    const mod = timingMod + this.contestMod(zone, c.score) - this.deepPenalty(zone) - 0.24 * ta.sev;
    this.lastContest = { ...c, shooter: e.id, t: this.time };
    if (this.humans.length) {
      this.fxText(c.name, e.x, e.y - 6.5, c.color);
      if (ta.sev > 0.25) this.fxText('Tough angle', e.x, e.y - 9.5, '#ff9a3a');
    }
    e.pivot = false; e.dribbled = false;
    const dunkTry = zone.type === 'rim' && zone.dist < 6.6 && this.p(e.id).attrs.dunk >= 55;
    const makeScale = (dunkTry && c.score > DUNK_CONTEST ? DUNK_HARD : SCORE_HARD) * (1 - 0.35 * ta.behind);
    const lp = this.lastPass;
    const assist = lp && lp.to === e && lp.from.side === side && this.time - lp.t <= 5.5 && this.entOf(lp.from.id) === lp.from
      ? lp.from.id : null;
    const dh = distE(e, hoop);
    const back = this.ents[other(side)].filter((d) => distE(d, hoop) < dh + 2).length;
    const fastBreak = this.transition && this.possT < 8 && back <= 1 && zone.type === 'rim';
    const from = { x: e.x, y: e.y };
    const i0 = g.events.length;
    const makeProb = shotResult ? shotResult.makeProb : (perfect ? 1.0 : null);
    const forceMade = shotResult ? shotResult.forceMade : (perfect ? true : null);
    g.resolveShot({
      offSide: side, shooter: e.id, type: zone.type, defender: contested ? nd.e.id : null,
      exact: true, assist, fastBreak, heave: zone.dist > 42, difficultyMod: mod,
      forceFoul: contested && !this.street ? undefined : false, foulScale: this.foulScale(e, zone, c),
      makeProb, forceMade,
      makeScale: shotResult?.makeProb != null ? 1 : makeScale,
    });
    this.play(i0, { from, hoop, zone, cs: c.score, tough: ta.sev, ...extra });
  }

  /** Shooting-foul scale: the user's drives draw 10% fewer fouls, and far fewer without a real contest. */
  foulScale(e, zone, c) {
    if (!this.isHuman(e.side) || zone.type !== 'rim') return 0.8;
    return 0.8 * 0.9 * (this.realContest(e, c) ? 1 : 0.55);
  }

  // ------------------------------------------------------------------ playing out engine results

  /** Run an engine primitive, then animate whatever it logged. */
  engine(fn) {
    const i0 = this.game.events.length;
    fn();
    this.play(i0);
  }

  /** Animation steps for the engine events logged since `i0` (+ the free throws still to be shot). */
  steps(i0, ctx = null, cont = false) {
    const q = [];
    for (const ev of this.game.events.slice(i0)) {
      switch (ev.type) {
        case 'shot': if (ctx) q.push({ k: 'shot', ev, ...ctx, dur: ctx.oop ? 0.3 : 0.45 + ctx.zone.dist * 0.022 }); break;
        case 'foul': {
          const tag = ev.kind === 'shooting' ? ' (shooting)' : ev.kind === 'offensive' ? ' (offensive)' : ev.penalty ? ' (bonus)' : '';
          q.push({ k: 'wait', dur: 1.1, banner: `Foul on ${this.name(ev.player)}${tag}` });
          break;
        }
        case 'foul_out': q.push({ k: 'wait', dur: 1.3, banner: `${this.name(ev.player)} has fouled out` }); break;
        case 'rebound': q.push({ k: 'reb', ev, dur: 0.4 }); break;
        case 'turnover':
          if (!ev.steal) q.push({ k: 'wait', dur: 1.1, banner: describe(ev, this.data.byId).replace(/^.*turnover: /, '').replace(/^./, (c) => c.toUpperCase()) });
          break;
        case 'sub': q.push({ k: 'sub', ev, dur: 0.02 }); break;
        case 'timeout': q.push({ k: 'timeout', ev, dur: TIMEOUT_SECS, banner: `Timeout ${this.state.teams[ev.team].id} (${ev.left} left)` }); break;
      }
    }
    // Free throws: everybody walks to the lane first (clock stopped), then one step per attempt.
    const pd = this.state.pending;
    if (pd?.kind === 'ft') {
      if (!cont) q.push({ k: 'ftsetup', dur: 9, shooter: pd.shooter, side: pd.side });
      q.push({ k: 'ftaim', dur: 1.25, shooter: pd.shooter, side: pd.side });
    }
    for (const st of q) st.t = 0;
    return q;
  }

  play(i0, ctx = null) {
    this.queue = this.steps(i0, ctx);
    this.phase = 'anim';
    this.meter = null; this.windup = null; this.ball.flight = null; this.ftLine = null; this.passTarget = null;
    this.ftMeter = null; this.double = null;
    for (const e of this.all) { e.pivot = false; e.dribbled = false; }
    this.pump();
  }

  /** Engine safety net: anything still pending is decided on the spot (never leaves the game stuck). */
  flushPending() {
    const g = this.game, s = this.state;
    let n = 0;
    while (s.pending && n++ < 12) {
      if (s.pending.kind === 'ft') g.freeThrow(); else g.resolveRebound();
    }
  }

  /** Where everybody stands for a free throw. */
  ftSpots() {
    const { shooter, side } = this.ftLine;
    const out = [[shooter, this.N(side, 75, 25)]];
    const offs = this.ents[side].filter((e) => e !== shooter).sort((a, b) => b.role - a.role);
    offs.forEach((e, i) => out.push([e, this.N(side, ...FT_OFF[i])]));
    const defs = [...this.ents[other(side)]].sort((a, b) => b.role - a.role);
    defs.forEach((e, i) => out.push([e, this.N(side, ...FT_DEF[i])]));
    return out;
  }

  updateAnim(dt, I) {
    const st = this.queue[0];
    if (!st) return this.resume();
    const b = this.ball, s = this.state;
    if (!st.started) {
      st.started = true;
      if (st.banner) this.say(st.banner, Math.max(1.2, st.dur));
      if (st.k === 'shot') {
        b.holder = null; b.x = st.from.x; b.y = st.from.y;
        this.rebCtx = { hoop: st.hoop, side: st.ev.team, land: this.landing(st.hoop) };
      }
      if (st.k === 'sub') {
        // Apply subs in the order they happened so players referenced by later steps are on the floor.
        const e = this.ents[st.ev.team].find((x) => x.id === st.ev.out);
        if (e) { e.id = st.ev.in; this.roles(); }
      }
      if (st.k === 'ftsetup' || st.k === 'ftaim') {
        const shooter = this.entOf(st.shooter);
        if (!shooter) { this.flushPending(); this.queue = []; return this.resume(); }
        if (st.k === 'ftsetup' || !this.ftLine) this.ftLine = { shooter, side: st.side };
        b.holder = shooter;
        if (st.k === 'ftaim') {
          const spot = this.N(st.side, 75, 25);
          if (distE(shooter, spot) > 2) { shooter.x = spot.x; shooter.y = spot.y; shooter.vx = shooter.vy = 0; }
          const hoop = this.hoopOf(st.side);
          shooter.fx = Math.sign(hoop.x - shooter.x) || 1; shooter.fy = 0;
          this.give(shooter);
          if (this.isCtrl(shooter)) {
            const ftA = this.p(shooter.id).attrs.free_throw;
            const green = clamp((0.040 + 0.001 * (ftA - 50)) * this.diff.greenScale, 0.024, 0.08);
            const orange = 0.20;
            this.ftMeter = {
              t: 0, dur: 0.72, sweet: 1.0, type: 'ft', active: false, armed: false, wait: 0,
              green, greenStart: 1.0 - green, greenEnd: 1.01, orange, orangeStart: 1.0 - green - orange,
            };
          }
        }
      }
      if (st.k === 'ft') {
        const sh = this.entOf(st.ev.player) ?? this.ftLine?.shooter ?? b;
        b.holder = null;
        st.from = { x: sh.x, y: sh.y }; st.hoop = this.hoopOf(st.ev.team);
        b.x = sh.x; b.y = sh.y;
        this.rebCtx = { hoop: st.hoop, side: st.ev.team, land: this.landing(st.hoop) };
      }
      if (st.k === 'reb') {
        b.holder = null;
        this.ftLine = null;      // missed the last free throw: everybody goes after it
        st.sx = b.x; st.sy = b.y;
        st.to = st.ev.player ? this.entOf(st.ev.player) : null;
        if (st.to) st.dur = clamp(distE(st.to, b) / 24, 0.3, 0.75);
        else {
          const hx = b.x > 47 ? COURT.L + 3 : -3;
          st.out = { x: hx, y: b.y + (this.rng.chance(0.5) ? 9 : -9) };
          st.dur = 0.7;
        }
      }
    }
    st.t += dt;
    const u = Math.min(1, st.t / st.dur);
    this.dispClock = Math.max(this.state.clock, this.dispClock - dt);
    // Space as the ball comes off: the player you control goes up for the rebound.
    for (const k of this.ctls) {
      const U = this.uc[k];
      if (U.ctrl && I[k].shoot && !U.shootHeld && (st.k === 'shot' || st.k === 'ft' || st.k === 'reb')) U.ctrl.jumpT = this.time - lagOf(I[k]);
    }
    for (const k of this.ctls) {
      if (!(I[k].swap && (st.k === 'shot' || st.k === 'reb') && this.rebCtx)) continue;
      // Q while the shot is in the air: take over your player closest to the rim.
      const U = this.uc[k], mine = this.mine(k).filter((e) => e !== U.ctrl);
      if (mine.length) U.ctrl = mine.reduce((a, c) => (distE(a, this.rebCtx.hoop) <= distE(c, this.rebCtx.hoop) ? a : c));
    }

    if (st.k === 'ftsetup') {
      // Clock is stopped. Everybody jogs (or runs, from the other end) to the lane; the shot waits for them.
      const spots = this.ftSpots();
      let ready = true;
      for (const [e, p] of spots) {
        const d = distE(e, p);
        if (d > 2.2) ready = false;
        this.steer(e, p.x, p.y, d > 14, 1.2);
      }
      if ((ready && st.t > 0.9) || st.t >= st.dur) {
        if (!ready) for (const [e, p] of spots) { e.x = p.x; e.y = p.y; e.vx = e.vy = 0; }
        this.queue.shift();
      }
      return;
    }
    if (st.k === 'ftaim') { this.animTargets(st, dt, I); return this.updateFtAim(st, dt, I[this.ctlOf(this.ftLine?.shooter)] ?? NO_INPUT); }

    if (st.k === 'shot' || st.k === 'ft') {
      const blocked = st.k === 'shot' && st.ev.block;
      const uu = blocked ? Math.min(u, 0.3) : u;
      const d = distE(st.from, st.hoop);
      b.x = lerp(st.from.x, st.hoop.x, uu); b.y = lerp(st.from.y, st.hoop.y, uu);
      b.z = st.oop ? 10.5 - uu * 0.5 : lerp(7, 10, uu) + (3 + d * 0.28) * 4 * uu * (1 - uu);
      if (blocked && u >= 0.3 && !st.said) { st.said = true; this.fxText('Blocked!', b.x, b.y, '#ff6b6b'); st.t = st.dur; }
      if (u >= 1 && !st.said) {
        st.said = true;
        const ev = st.ev;
        if (ev.made) {
          const pts = st.k === 'ft' ? 1 : ev.pts;
          this.fxText(`+${pts}`, st.hoop.x, st.hoop.y - 2, '#fff');
          if (st.k === 'shot') this.say(`${this.name(ev.player)} ${st.oop ? 'finishes the alley-oop!' : ev.shot === 'three' ? (this.street ? 'from deep, for two!' : 'for three!') : ev.and1 ? 'and one!' : 'scores'}`, 1.4);
        }
      }
    } else if (st.k === 'reb') {
      const tx = st.to ? st.to.x : st.out.x, ty = st.to ? st.to.y : st.out.y;
      b.x = lerp(st.sx, tx, u); b.y = lerp(st.sy, ty, u);
      b.z = lerp(10, 6, u) + Math.sin(u * Math.PI) * 2;
    }

    this.animTargets(st, dt, I);
    if (st.t >= st.dur) {
      if (st.k === 'reb' && st.to) b.holder = st.to;
      this.queue.shift();
      // The miss comes off the rim NOW: whoever is in position gets it, and play carries straight on.
      if ((st.k === 'shot' || st.k === 'ft') && s.pending?.kind === 'rebound') {
        const i0 = this.game.events.length;
        this.game.resolveRebound(this.rebMult(), REB_NORM);
        this.queue.push(...this.steps(i0));
        this.pump();
      }
    }
  }

  /** One free throw: the CPU goes through its routine; the user times the meter (Space: hold, release in the green). */
  updateFtAim(st, dt, input) {
    const g = this.game, m = this.ftMeter, sh = this.ftLine.shooter;
    let go = false, prob = null;
    if (m) {
      const wasActive = m.active;
      if (!m.active) {
        m.wait += dt;
        if (!input.shoot) m.armed = true;
        else if (m.armed) m.active = true;
        if (m.wait > 8) go = true;                  // took too long: he shoots it himself
      }
      if (wasActive || input.res) {
        const lag = input.net ? NET_GRACE : lagOf(input);
        m.t += dt;
        if (input.res || !input.shoot || m.t >= m.dur * 1.18 + lag) {
          // online guest: its own screen timed it (input.res); otherwise judge it here
          const rel = input.res ? input.hold / 60 / m.dur : Math.max(0, input.shoot ? m.t - lag : perceived(input, m.t)) / m.dur;
          const zone = input.res && input.res !== RES.FAKE ? input.res : meterZone(m, rel, true);
          const base = M.freeThrowProb(this.p(sh.id), this.energy(sh));
          let label, color;
          if (zone === RES.GREEN) {
            prob = 1.0;
            label = 'GREEN!';
            color = '#39e06a';
            this.lastGreen = true;
          } else if (zone === RES.ORANGE) {
            prob = base;
            label = 'SLIGHTLY EARLY';
            color = '#ff9a3a';
          } else if (zone === RES.LATE) {
            prob = 0.0;
            label = 'VERY LATE';
            color = '#ff4a3a';
          } else {
            prob = 0.0;
            label = 'VERY EARLY';
            color = '#ff4a3a';
          }
          this.fxText(label, sh.x, sh.y - 3.5, color);
          (this.stats.userFts ??= []).push({ rel, label, prob });
          go = true;
        }
      }
    } else if (st.t >= st.dur) go = true;
    if (!go) return;
    this.ftMeter = null;
    const i0 = g.events.length;
    const ev = g.freeThrow({ makeProb: prob });
    this.queue.shift();
    if (!ev) return;
    this.queue = [{ k: 'ft', ev, dur: 1.1, t: 0 }, ...this.steps(i0, null, true), ...this.queue];
    this.pump();
  }

  /** Where a miss is going to come down (nobody knows until it hits the rim). */
  landing(hoop) {
    const dir = hoop.x > 47 ? -1 : 1;
    const a = this.rng.range(-1.25, 1.25), r = this.rng.range(2, 7.5);
    return { x: hoop.x + dir * Math.cos(a) * r, y: hoop.y + Math.sin(a) * r };
  }

  /** Positional rebound factors: close to where it comes down, not boxed out, and (user) jumping on time. */
  rebMult() {
    const mult = {};
    const land = this.rebCtx?.land;
    if (!land) return null;
    for (const e of this.all) {
      const d = distE(e, land);
      let m = 0.2 + 1.6 * Math.exp(-d / 6);
      for (const o of this.ents[other(e.side)]) {
        if (distE(o, e) < 3.2 && distE(o, land) < d - 0.5) { m *= 0.75; break; }
      }
      if (e.stun > 0) m *= 0.5;
      if (this.isCtrl(e) && this.time - e.jumpT < 0.7 && d < 10) m *= 1.9;
      mult[e.id] = m;
    }
    return mult;
  }

  animTargets(st, dt, I) {
    if (this.ftLine) {
      for (const [e, p] of this.ftSpots()) this.steer(e, p.x, p.y, false, 1.2);
      return;
    }
    if ((st.k === 'shot' || st.k === 'reb') && this.rebCtx) {
      // Nobody stands and watches: bigs crash the glass, defenders box out, guards get back,
      // and the user keeps control of his player the whole time.
      const { hoop, side } = this.rebCtx;
      const dir = hoop.x > 47 ? -1 : 1;
      for (const e of this.all) {
        if (st.k === 'shot' && e.id === st.ev.player && st.t < 0.35) { this.hold(e); continue; } // follow through
        if (st.k === 'reb' && e === st.to) { this.steer(e, this.ball.x, this.ball.y, true, 1); continue; }
        if (this.isCtrl(e)) { this.userMove(e, I[this.ctlOf(e)]); continue; }
        if (e.side === side) {
          if (e.role >= 3) this.steer(e, hoop.x + dir * 4.5, hoop.y + (e.role === 3 ? 4.5 : -4.5), true);
          else if (e.role === 2) this.steer(e, hoop.x + dir * 11, hoop.y + (e.y > hoop.y ? 7 : -7), false);
          else { const t = this.N(side, 56 + e.role * 6, e.role ? 13 : 31); this.steer(e, t.x, t.y, false); }
        } else {
          const m = this.matchOf(e);
          const k = e.role >= 3 ? 0.7 : 0.5;
          let tx = lerp(m.x, hoop.x, k), ty = lerp(m.y, hoop.y, k);
          const td = Math.hypot(tx - hoop.x, ty - hoop.y);
          if (td < 3.5) { tx = hoop.x + dir * 3.5; ty = hoop.y + (e.y > hoop.y ? 1.5 : -1.5); }
          this.steer(e, tx, ty, Math.hypot(tx - e.x, ty - e.y) > 8);
        }
      }
      return;
    }
    for (const e of this.all) this.hold(e);
  }

  /** After the animation: hand the ball to whoever the engine says has it. */
  resume() {
    const g = this.game, s = g.state;
    if (s.pending) this.flushPending();
    this.sync(); this.pump();
    this.ftLine = null; this.queue = []; this.ftMeter = null;
    if (this.street) {
      if (s.over) return this.finish();
      // StreetBall: an offensive rebound plays on; every other change (make, stop, steal, defensive
      // rebound, ball out) is a check ball at the top of the key, in the half of the team with the ball.
      const h = s.next.kind === 'oreb' ? this.entOf(s.next.rebounder) : null;
      if (h && h.side === s.possession) return this.goLive(h, 'oreb');
      // Every other change (make, steal, block, defensive rebound, ball out): the team that gets the ball
      // takes it back out to the top of the arc (the rebounder or stealer carries it), both teams reset,
      // and the ball is checked up there. The camera swivels while they walk.
      let carrier = null;
      if (s.next.kind === 'steal') carrier = this.entOf(s.next.stealer);
      else if (s.next.kind === 'defreb') {
        for (let i = this.game.events.length - 1; i >= 0; i--) { const ev = this.game.events[i]; if (ev.type === 'rebound') { carrier = ev.player ? this.entOf(ev.player) : null; break; } }
      }
      return this.startCheck(s.possession, carrier?.side === s.possession ? carrier : null);
    }
    if (s.clock <= 0) return this.startBreak();
    const side = s.possession, k = s.next.kind;
    let holder = null;
    if (k === 'oreb') holder = this.entOf(s.next.rebounder);
    else if (k === 'steal') holder = this.entOf(s.next.stealer);
    else if (k === 'defreb') {
      for (let i = g.events.length - 1; i >= 0; i--) {
        if (g.events[i].type === 'rebound') { holder = this.entOf(g.events[i].player); break; }
      }
    }
    if (holder && holder.side === side) return this.goLive(holder, k);
    // Dead ball: make the substitutions the user asked for in the pause menu.
    if (this.applySubs()) return this.play(g.events.length - this._subN);
    // Dead ball (or we were just scored on): a CPU coach may use a timeout before the inbound.
    if (!this.noTimeout) {
      for (const sd of [side, other(side)]) {
        if (this.isHuman(sd)) continue;
        if (sd !== side && k === 'made') continue; // only the team taking the ball out can call it after a make
        const i0 = g.events.length;
        g.maybeTimeout(sd, k);
        if (g.events.length > i0) { this.noTimeout = true; return this.play(i0); }
      }
    }
    this.noTimeout = false;
    if (k === 'inbound_front') return this.startInbound(side, 'side', false);
    if (k === 'made') return this.startInbound(side, 'base', !(s.period >= g.rules.periods && s.clock <= 120));
    return this.startInbound(side, 'base', false);
  }

  /** Queue a manual substitution for a human team (made at the next dead ball). Turns auto subs off. */
  requestSub(outId, inId, k = this.me) {
    if (this.street) return false;     // StreetBall: no subs
    const U = this.uc[k];
    if (!U || !this.ctls.includes(k)) return false;
    U.pendingSubs = U.pendingSubs.filter((w) => w.out !== outId && w.in !== inId);
    if (inId) U.pendingSubs.push({ out: outId, in: inId });
    this.game.autoSubs[U.side] = false;
    return true;
  }

  applySubs() {
    const g = this.game, i0 = g.events.length;
    let any = false;
    for (const k of this.ctls) {
      const list = this.uc[k].pendingSubs;
      if (!list.length) continue;
      any = true;
      this.uc[k].pendingSubs = [];
      for (const w of list) {
        try { g.substitute(this.uc[k].side, w.out, w.in, 'manual'); } catch { /* fouled out or already swapped: skip */ }
      }
    }
    if (!any) return false;
    this._subN = g.events.length - i0;
    return this._subN > 0;
  }

  // ------------------------------------------------------------------ inbounds

  startInbound(side, where, runClock) {
    this.phase = 'inbound'; this.phaseT = 0;
    const b = this.ball;
    b.holder = null; b.flight = null;
    const spot = where === 'side' ? this.N(side, 68, 51.3) : this.N(side, -1.3, 31);
    const rspot = where === 'side' ? this.N(side, 64, 40) : this.N(side, 10, 22);
    const recv = this.ents[side].find((e) => e.role === 0);
    const passer = this.ents[side].filter((e) => e !== recv).sort((a, c) => distE(a, spot) - distE(c, spot))[0];
    passer.oob = true;
    for (const e of this.ents[side]) { e.spot = null; e.cut = 0; e.screen = 0; e.roll = false; }
    this.inb = { side, where, runClock, spot, rspot, recv, passer, thrown: false, minT: runClock ? 0.5 : 1.1 };
    this.crossed = false;
    this.assignAll(recv);
  }

  updateInbound(dt) {
    const s = this.state, I = this.inb, b = this.ball;
    this.phaseT += dt;
    if (I.runClock) {
      this.runClock(dt, false);
      if (s.clock <= 0) { I.passer.oob = false; return this.startBreak(); }
    }
    for (const e of this.all) {
      if (e === I.passer) this.steer(e, I.spot.x, I.spot.y, true, 1.2);
      else if (e === I.recv) this.steer(e, I.rspot.x, I.rspot.y, false);
      else if (e.side === I.side) { const t = AI.offBallTarget(this, e, dt); this.steer(e, t.tx, t.ty, false); }
      else { const t = AI.defendTarget(this, e, dt); this.steer(e, t.tx, t.ty, false, 1.5); }
    }
    if (!I.thrown) {
      const d = distE(I.passer, I.spot);
      const k = Math.min(1, dt * 10);
      const tx = d < 2 ? I.passer.x : I.spot.x, ty = d < 2 ? I.passer.y : I.spot.y;
      b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; b.z = 4;
      const late = this.phaseT > 5;
      if ((d < 1.5 && this.phaseT > I.minT && distE(I.recv, I.rspot) < 6) || late) {
        if (late) { I.passer.x = I.spot.x; I.passer.y = I.spot.y; }
        I.thrown = true; I.ft = 0;
        I.sx = I.passer.x; I.sy = I.passer.y;
        I.fdur = Math.max(0.2, distE(I.passer, I.recv) / 38);
        b.x = I.sx; b.y = I.sy;
      }
    } else {
      I.ft += dt;
      const u = Math.min(1, I.ft / I.fdur);
      b.x = lerp(I.sx, I.recv.x, u); b.y = lerp(I.sy, I.recv.y, u);
      b.z = 4 + Math.sin(u * Math.PI) * 2.5;
      if (u >= 1) {
        I.passer.oob = false;
        this.lastPass = null;
        this.goLive(I.recv, 'inbound');
      }
    }
  }

  // ------------------------------------------------------------------ StreetBall check ball

  /**
   * StreetBall restart: the team with the ball sets up in its half (the guard with the ball just behind
   * the top of the arc, the others on their spots, each defender between his man and the rim), stands
   * set for a moment, and the ball is live. Players are placed, not walked: the camera cuts to this half.
   */
  startCheck(side, carrier = null) {
    const b = this.ball;
    this.phase = 'clear'; this.phaseT = 0; this.checkN += 1;
    this.courtSide = side;     // whose half the ball is played in until the next check
    this.viewSide = side;      // whose offense the camera shows (turns on every change of possession)
    this.mustClear = false;    // defensive rebound: the ball has to go past the arc before a basket counts
    this.meter = null; this.windup = null; this.queue = []; this.ftLine = null; this.inb = null; this.passTarget = null;
    this.ftMeter = null; this.double = null; this.rebCtx = null; this.lastPass = null;
    b.flight = null;
    // the ball goes to whoever got it (rebound, steal), else the team's guard; he carries it to the top
    const holder = carrier ?? this.ents[side].find((e) => e.role === 0) ?? this.ents[side][0];
    const hoop = this.hoopOf(side);
    for (const e of this.all) {
      e.spot = null; e.cut = 0; e.screen = 0; e.roll = false; e.oob = false; e.stun = 0;
      e.handsUp = false; e.pivot = false; e.dribbled = false; e.faked = 0;
    }
    // where everybody walks to: the ball at the top of the arc, his teammates on their spots,
    // each defender between his man and the rim (the one on the ball right up on him)
    const spots = new Map();
    const slots = this.ents[side].filter((e) => e !== holder);
    const used = new Set();
    for (const e of slots) {
      let k = AI.defaultSpot(this, e);
      if (k === 'top' || used.has(k)) k = ['wingA', 'wingB', 'cornerA', 'cornerB', 'lowA'].find((x) => !used.has(x));
      used.add(k); e.spot = k;
      spots.set(e, this.N(side, ...AI.SPOTS[k]));
    }
    spots.set(holder, this.N(side, 61.5, 25));
    for (const e of this.ents[other(side)]) {
      const m = this.ents[side].find((o) => o.role === e.role) ?? holder;
      const man = spots.get(m) ?? spots.get(holder);
      const k = m === holder ? 0.12 : 0.3;
      spots.set(e, { x: lerp(man.x, hoop.x, k), y: lerp(man.y, hoop.y, k) });
    }
    this.chk = { spots, holder, side };
    b.holder = holder; b.x = holder.x; b.y = holder.y; b.z = 4;
    this.assignAll(holder);
    this.say(`${this.state.teams[side].id} ball: take it back`, 1.6);
  }

  /** StreetBall: everybody walks back to their places (inputs wait); then the ball is checked up. */
  updateClear(dt) {
    this.phaseT += dt;
    const C = this.chk;
    let ready = true;
    for (const [e, p] of C.spots) {
      const d = distE(e, p);
      if (d > 1.0) ready = false;
      this.steer(e, p.x, p.y, d > 10, 1.2);
    }
    if ((ready && this.phaseT > 1.1) || this.phaseT > 5) {
      const hoop = this.hoopOf(C.side);
      for (const [e, p] of C.spots) {
        e.x = p.x; e.y = p.y; e.vx = e.vy = e.dvx = e.dvy = 0;
        const m = e.side === C.side ? hoop : C.holder;
        e.fx = Math.sign(m.x - e.x) || 1; e.fy = 0;
        e.trkx = e.x; e.trky = e.y;
      }
      this.phase = 'check'; this.phaseT = 0;
      this.say(`Check ball: ${this.state.teams[C.side].id}`, CHECK_SECS);
    }
  }

  /** StreetBall: is this player behind the arc (where a cleared ball has to get to)? */
  isCleared(e) { return shotZone(e.x, e.y, this.hoopOf(e.side)).type === 'three'; }

  /** Where a CPU ball handler dribbles to clear the ball: straight out past the arc (to a wing near the baseline). */
  clearPoint(e) {
    const h = this.hoopOf(e.side);
    if (Math.abs(e.x - h.x) < 10) return { x: h.x - 26, y: e.y < h.y ? 12 : 38 };
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    return { x: clamp(h.x + dx / d * 26.5, 48.5, 92), y: clamp(h.y + dy / d * 26.5, 4, 46) };
  }

  updateCheck(dt) {
    this.phaseT += dt;
    for (const e of this.all) this.hold(e);
    if (this.phaseT >= CHECK_SECS) {
      const holder = this.ball.holder ?? this.ents[this.state.possession][0];
      this.lastPass = null;
      this.goLive(holder, 'check');
      this.crossed = true;
    }
  }

  /** StreetBall: somebody reached the target. */
  finish() {
    this.phase = 'final'; this.phaseT = 0;
    this.meter = null; this.windup = null; this.queue = []; this.passTarget = null;
    this.ball.flight = null; this.ball.holder = null;
    const s = this.state;
    this.say(`${s.teams[s.winner].id} wins ${s.score[s.winner]}-${s.score[other(s.winner)]}`, 1e9);
    this.pump();
  }

  // ------------------------------------------------------------------ period breaks

  startBreak() {
    const s = this.state;
    this.phase = 'break'; this.phaseT = 0;
    this.meter = null; this.windup = null; this.queue = []; this.passTarget = null;
    this.ball.flight = null;
    this.dispClock = 0;
    for (const e of this.all) e.oob = false;
    this.say(`End of ${periodName(s.period, this.game.rules.periods)}`, 2.2);
  }

  updateBreak(dt) {
    const g = this.game, s = g.state;
    this.phaseT += dt;
    for (const e of this.all) this.hold(e);
    if (this.phaseT < 2.2) return;
    g.endPeriod();
    if (s.over) {
      this.phase = 'final';
      this.ball.holder = null;
      this.say('Final', 1e9);
      this.pump();
      return;
    }
    g.startPeriod();
    this.applySubs();
    this.sync();
    this.dispClock = s.clock;
    this.acc = 0;
    if (s.period > g.rules.periods) return this.startTip();
    this.formation();
    this.say(`Start of ${periodName(s.period, g.rules.periods)}`, 1.6);
    this.startInbound(s.possession, 'base', false);
  }
}
