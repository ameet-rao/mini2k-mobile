// Headless game engine: clock, possessions, shots, rebounds, fouls, free throws,
// substitutions, timeouts, overtime. Pure JS, no DOM. Everything that happens is
// appended to `game.events`; the box score is derived from that log (see boxscore.js).
//
// v1 is possession resolution: each call to step() plays one "segment" of a possession
// (until a shot, turnover, foul or period end). The real-time layer (M3) will drive the
// same primitives (tick, resolveShot, commitFoul, freeThrows, rebound, turnover).

import { Rng } from './rng.js';
import { buildIndex, posGroup, POS_ORDER } from './data.js';
import * as R from './rules.js';
import * as M from './model.js';
import { planSubs, minuteTargets } from './subs.js';

const { MODEL } = M;
const other = (side) => (side === 'home' ? 'away' : 'home');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r1 = (x) => Math.round(x * 10) / 10;

export const SIDES = ['home', 'away'];

export function createGame(data, opts) {
  return new Game(data, opts);
}

export class Game {
  /**
   * @param data  buildIndex(...) result, or {players, teams} parsed JSON
   * @param opts  { home:'PHI', away:'BOS', seed, rules:{quarterMinutes,...}, autoSubs:{home,away} }
   */
  constructor(data, { home, away, seed = 1, rules = {}, autoSubs = { home: true, away: true }, lineups = null } = {}) {
    this.data = data.byId ? data : buildIndex(data.players, data.teams);
    this.rules = R.makeRules(rules);
    this.rng = new Rng(seed);
    this.seed = seed;
    this.autoSubs = autoSubs;
    this.events = [];
    this.state = {
      period: 0,
      clock: 0,
      shotClock: this.rules.shotClock,
      score: { home: 0, away: 0 },
      possession: null,
      tipWinner: null,
      over: false,
      winner: null,
      elapsed: 0,
      next: { kind: 'period' },
      streak: {},
      run: { home: 0, away: 0 },
      teams: { home: this.makeTeam('home', home, lineups?.home), away: this.makeTeam('away', away, lineups?.away) },
    };
    this.emit({ type: 'game_start', home, away, seed, rules: { ...this.rules } });
  }

  // ------------------------------------------------------------------ setup

  makeTeam(side, teamId, lineup = null) {
    const T = this.data.teams[teamId];
    if (!T) throw new Error(`Unknown team ${teamId}`);
    const byId = this.data.byId;
    // StreetBall: the three players picked from anyone in the league (the team gives the jerseys)
    const own = this.rules.street && Array.isArray(lineup) && lineup.length === 3 && lineup.every((id) => byId[id]?.available) && new Set(lineup).size === 3;
    const roster = own ? [...lineup] : T.depth_order.filter((id) => byId[id]);
    const team = {
      side, id: teamId, name: T.name, colors: T.colors, roster,
      starters: [], onCourt: [], pf: {}, played: {}, energy: {},
      teamFouls: 0, foulsLast2: 0, timeouts: this.rules.timeouts,
    };
    for (const id of roster) { team.pf[id] = 0; team.played[id] = 0; team.energy[id] = 1; }
    const { targets, rotation } = minuteTargets(team, byId);
    team.targets = targets;
    team.rotation = rotation;

    // Starters: defaults, replacing anyone unavailable with the next healthy player of the same group.
    const starters = [];
    if (own) { team.starters = [...lineup]; team.onCourt = [...lineup]; return team; }
    for (const id of T.default_starters) {
      if (byId[id]?.available) { starters.push(id); continue; }
      const g = byId[id] ? posGroup(byId[id]) : 'W';
      const sub = roster.find((x) => byId[x].available && !starters.includes(x) && !T.default_starters.includes(x) && posGroup(byId[x]) === g)
        ?? roster.find((x) => byId[x].available && !starters.includes(x) && !T.default_starters.includes(x));
      starters.push(sub);
    }
    team.starters = this.rules.street ? streetThree(starters, byId) : starters;
    team.onCourt = [...team.starters];
    return team;
  }

  p(id) { return this.data.byId[id]; }

  // ------------------------------------------------------------------ event log

  emit(ev) {
    const s = this.state;
    const e = { seq: this.events.length, period: s?.period ?? 0, clock: r1(s?.clock ?? 0), ...ev };
    if (s) e.score = { home: s.score.home, away: s.score.away };
    this.events.push(e);
    return e;
  }

  // ------------------------------------------------------------------ loop

  simToEnd(maxSteps = 100000) {
    let n = 0;
    while (!this.state.over && n++ < maxSteps) this.step();
    if (!this.state.over) throw new Error('simToEnd: game did not finish');
    return this;
  }

  step() {
    const s = this.state;
    if (s.over) return;
    if (s.clock <= 0) {
      if (s.period > 0) this.endPeriod();
      if (!s.over) this.startPeriod();
      return;
    }
    this.playSegment();
  }

  startPeriod() {
    const s = this.state;
    s.period += 1;
    s.clock = R.periodLength(s.period, this.rules);
    s.shotClock = this.rules.shotClock;
    for (const side of SIDES) {
      const t = s.teams[side];
      t.teamFouls = 0;
      t.foulsLast2 = 0;
      if (s.period > 1) {
        const rec = s.period === 3 ? MODEL.halftimeRecover : MODEL.quarterBreakRecover;
        for (const id of t.roster) t.energy[id] = Math.min(1, t.energy[id] + rec);
      }
    }
    if (s.period > 1) this.subWindow('period');
    this.emit({ type: 'period_start', lineups: { home: [...s.teams.home.onCourt], away: [...s.teams.away.onCourt] } });

    if (this.rules.street) {
      // StreetBall: no tip-off, a coin flip decides who checks the ball first
      s.possession = this.rng.chance(0.5) ? 'home' : 'away';
      s.tipWinner = s.possession;
      this.emit({ type: 'coin_flip', team: s.possession });
      s.next = { kind: 'period' };
      return;
    }
    const poss = R.periodStartPossession(s.period, s.tipWinner, this.rules);
    if (poss) {
      s.possession = poss;
    } else {
      s.possession = this.jumpBall();
      if (s.period === 1) s.tipWinner = s.possession;
    }
    s.next = { kind: 'period' };
  }

  jumpBall() {
    const s = this.state;
    const jumper = (side) => s.teams[side].onCourt
      .map((id) => this.p(id))
      .sort((a, b) => jumpScore(b) - jumpScore(a))[0];
    const h = jumper('home'), a = jumper('away');
    const pHome = 1 / (1 + Math.exp(-(jumpScore(h) - jumpScore(a)) / 8));
    const winner = this.rng.chance(pHome) ? 'home' : 'away';
    this.emit({ type: 'jump_ball', team: winner, home: h.id, away: a.id });
    return winner;
  }

  endPeriod() {
    const s = this.state;
    this.emit({ type: 'period_end' });
    if (R.gameIsOver(s.period, s.score.home, s.score.away, this.rules)) {
      s.over = true;
      s.winner = s.score.home > s.score.away ? 'home' : 'away';
      this.emit({ type: 'game_end', winner: s.winner, home: s.score.home, away: s.score.away });
    }
  }

  // ------------------------------------------------------------------ clock

  /** Run the game clock (live ball). Drains energy on court, recovers on the bench. */
  tick(dt, sprint = 1, runShotClock = true) {
    const s = this.state;
    dt = r1(clamp(dt, 0, s.clock));
    if (dt <= 0) return 0;
    s.clock = r1(s.clock - dt);
    if (runShotClock) s.shotClock = r1(s.shotClock - dt);
    s.elapsed += dt;
    for (const side of SIDES) {
      const t = s.teams[side];
      for (const id of t.roster) {
        if (t.onCourt.includes(id)) {
          t.played[id] += dt;
          t.energy[id] = Math.max(0, t.energy[id] - M.energyDrainPerSec(this.p(id), sprint) * dt);
        } else {
          t.energy[id] = Math.min(1, t.energy[id] + MODEL.recoverPerSec * dt);
        }
      }
    }
    return dt;
  }

  /** Extra energy cost (sprinting in the real-time layer). */
  exert(side, id, amount) {
    const t = this.state.teams[side];
    t.energy[id] = Math.max(0, t.energy[id] - amount);
  }

  // ------------------------------------------------------------------ possession

  playSegment() {
    const s = this.state, rng = this.rng;
    const offSide = s.possession, defSide = other(offSide);
    const off = s.teams[offSide], def = s.teams[defSide];
    const start = s.next.kind;
    const fromBackcourt = ['made', 'period', 'inbound_back', 'defreb', 'steal'].includes(start);

    if (start === 'made' || start === 'inbound_back' || start === 'inbound_front') this.maybeTimeout(offSide, start);

    let t, fastBreak = false, putback = false, early = false;
    if (start === 'steal' && rng.chance(MODEL.fastBreakAfterSteal)) {
      fastBreak = true;
      t = rng.range(2.5, 6.5);
    } else if (start === 'oreb') {
      if (rng.chance(MODEL.putbackRate) && off.onCourt.includes(s.next.rebounder)) {
        putback = true;
        t = rng.range(0.6, 2.8);
      } else {
        t = clamp(rng.normal(MODEL.orebResetMean, MODEL.orebResetSd), 1.5, 22);
      }
    } else {
      // Inbound / backcourt violations (clock does not run on a 5-second inbound call).
      if (start !== 'defreb' && start !== 'steal' && start !== 'period' && rng.chance(MODEL.fiveSecPerInbound)) {
        return this.turnover(offSide, null, 'five_second_inbound');
      }
      if (start !== 'inbound_front' && rng.chance(MODEL.eightSecPerPoss) && s.clock > this.rules.backcourtSecs) {
        this.tick(this.rules.backcourtSecs);
        return this.turnover(offSide, this.ballHandler(off), 'eight_second');
      }
      let bc;
      if (start === 'inbound_front') bc = rng.range(1, 2);
      else if (start === 'defreb' || start === 'steal') bc = rng.range(...MODEL.backcourtAfterDefReb);
      else bc = rng.range(...MODEL.backcourtAfterMake);
      if (start === 'defreb' && rng.chance(MODEL.earlyOffenseAfterDefReb)) {
        early = true;
        t = bc + rng.range(1.5, 4.5);
      } else {
        t = bc + clamp(rng.normal(MODEL.halfcourtMean, MODEL.halfcourtSd), 1, 30);
      }
    }

    // End of period: hold for the last shot, or heave from distance.
    let lastShot = false, heave = false;
    if (t >= s.clock) {
      if (s.clock < 0.3) { this.tick(s.clock); return; }
      if (s.clock <= 3 && fromBackcourt && !fastBreak) {
        heave = true;
        t = Math.max(0, s.clock - rng.range(0, 0.4));
      } else {
        lastShot = true;
        t = Math.max(0, s.clock - rng.range(0, Math.min(1.5, s.clock * 0.3)));
      }
    }

    // Shot clock.
    let lateClock = false;
    if (R.shotClockActive(s.clock, s.shotClock) && t >= s.shotClock) {
      if (rng.chance(MODEL.lateClockBailout)) {
        lateClock = true;
        t = Math.max(0.2, s.shotClock - rng.range(0.1, 1.2));
      } else {
        this.tick(s.shotClock);
        return this.turnover(offSide, null, 'shot_clock');
      }
    }

    // Turnover before a shot.
    if (!heave && rng.chance(this.turnoverProb(off, def, { fastBreak, putback }))) {
      this.tick(t * rng.range(0.15, 1));
      const handler = rng.weighted(off.onCourt, (id) => this.p(id).tendencies.tov_per36 * (0.5 + 0.5 * this.p(id).attrs.usage / 60));
      const u = rng.next();
      if (u < MODEL.tovStealShare) {
        const stealer = rng.weighted(def.onCourt, (id) => Math.pow(this.p(id).attrs.steal, 2.5));
        return this.turnover(offSide, handler, rng.chance(0.55) ? 'bad_pass' : 'lost_ball', stealer);
      }
      if (u < MODEL.tovStealShare + MODEL.offFoulShare) {
        const drawnBy = rng.weighted(def.onCourt, (id) => this.p(id).attrs.strength + this.p(id).attrs.perimeter_def);
        this.commitFoul(offSide, handler, defSide, drawnBy, 'offensive', { noSubWindow: true });
        return this.turnover(offSide, handler, 'offensive_foul');
      }
      const kinds = ['bad_pass_out_of_bounds', 'traveling', 'out_of_bounds', 'out_of_bounds', 'bad_pass_out_of_bounds'];
      if (this.rules.threeInKey) kinds.push('three_seconds');
      return this.turnover(offSide, handler, rng.pick(kinds));
    }

    // Non-shooting defensive foul (reach-in, holding, illegal screen defense, ...).
    if (!heave && !putback && !lastShot && rng.chance(this.nonShootingFoulProb(off, def))) {
      this.tick(t * rng.range(0.1, 0.9));
      const fouler = rng.weighted(def.onCourt, (id) => this.p(id).tendencies.pf_per36);
      const drawnBy = rng.weighted(off.onCourt, (id) => this.p(id).attrs.draw_foul * this.p(id).tendencies.usage_per36);
      return this.defensiveFoul(fouler, drawnBy, true);
    }

    // Shot.
    this.tick(t);
    let shooter;
    if (putback) shooter = s.next.rebounder;
    else if (fastBreak) {
      const st = s.next.stealer;
      shooter = rng.weighted(off.onCourt, (id) => (id === st ? 3 : 1) * this.p(id).attrs.speed);
    } else shooter = rng.weighted(off.onCourt, (id) => M.usageWeight(this.p(id), off.energy[id]));

    const defender = this.matchup(shooter, offSide);
    let type;
    if (heave) type = 'three';
    else if (fastBreak || putback) type = 'rim';
    else type = M.chooseShotType(this.p(shooter), rng, { defender: this.p(defender), league: this.data.league });

    this.resolveShot({ offSide, shooter, type, defender, fastBreak, putback, early, lateClock, lastShot, heave });
  }

  turnoverProb(off, def, { fastBreak, putback }) {
    const L = this.data.league;
    const avg = (team, f) => team.onCourt.reduce((sum, id) => sum + f(this.p(id)), 0) / team.onCourt.length;
    const care = avg(off, (p) => p.tendencies.tov_per36) / L.tend.tov_per36;
    const handle = avg(off, (p) => p.attrs.ball_handle) - L.attrs.ball_handle;
    const pressure = avg(def, (p) => p.attrs.steal) - L.attrs.steal;
    let pr = MODEL.tovBase * Math.pow(care, 0.6) * (1 - 0.006 * handle) * (1 + 0.008 * pressure);
    if (fastBreak) pr *= 0.5;
    if (putback) pr *= 0.25;
    return clamp(pr, 0.03, 0.3);
  }

  nonShootingFoulProb(off, def) {
    const L = this.data.league;
    const avg = (team, f) => team.onCourt.reduce((sum, id) => sum + f(this.p(id)), 0) / team.onCourt.length;
    const hack = avg(def, (p) => p.tendencies.pf_per36) / L.tend.pf_per36;
    const draw = avg(off, (p) => p.attrs.draw_foul) / L.attrs.draw_foul;
    return MODEL.nonShootFoulBase * hack * draw;
  }

  ballHandler(team) {
    return this.rng.weighted(team.onCourt, (id) => this.p(id).attrs.ball_handle ** 2 * this.p(id).tendencies.usage_per36);
  }

  /** Primary defender: same position slot on the other team. */
  matchup(offId, offSide) {
    const s = this.state;
    const byPos = (ids) => [...ids].sort((a, b) => POS_ORDER[this.p(a).pos] - POS_ORDER[this.p(b).pos]);
    const o = byPos(s.teams[offSide].onCourt);
    const d = byPos(s.teams[other(offSide)].onCourt);
    return d[o.indexOf(offId)] ?? d[0];
  }

  // ------------------------------------------------------------------ primitives

  /** Non-shooting foul by the defense: bonus -> 2 FTs, otherwise side-out (14s rule in the frontcourt). */
  defensiveFoul(fouler, drawnBy, frontcourt = true) {
    const s = this.state;
    const offSide = s.possession, defSide = other(offSide);
    const { penalty } = this.commitFoul(defSide, fouler, offSide, drawnBy, 'personal', { protect: [drawnBy] });
    if (penalty) return this.freeThrows(offSide, drawnBy, 2);
    if (frontcourt) {
      s.shotClock = R.shotClockAfter('foul_frontcourt', s.shotClock, this.rules);
      s.next = { kind: 'inbound_front' };
    } else {
      s.shotClock = this.rules.shotClock;
      s.next = { kind: 'inbound_back' };
    }
  }

  /**
   * Resolve a field-goal attempt. Context flags: fastBreak, putback, early, lateClock, lastShot, heave.
   * `forceMade` / `forceFoul` let the real-time layer or tests pin the outcome.
   * `exact` (real-time layer): use exactly the given defender (may be null = wide open) and
   * `assist` (id or null) instead of rolling for help defense / assists.
   * `makeProb` (real-time layer): pin the make probability (a perfectly timed release); such a shot is not blocked.
   */
  resolveShot({ offSide, shooter, type, defender, fastBreak, putback, early, lateClock, lastShot, heave, forceMade, forceFoul, difficultyMod, exact, assist: assistIn, foulScale = 1, makeProb = null, makeScale = 1 }) {
    const s = this.state, rng = this.rng, L = this.data.league;
    const defSide = other(offSide);
    const off = s.teams[offSide], def = s.teams[defSide];
    const sp = this.p(shooter);

    // Contest: at the rim the best interior defender often helps.
    let contest = defender;
    if (!exact && type === 'rim' && !fastBreak && rng.chance(0.5)) {
      contest = rng.weighted(def.onCourt, (id) => Math.pow(this.p(id).attrs.interior_def, 3));
    }

    let assist = null;
    if (exact) assist = assistIn ?? null;
    else if (!heave) {
      const rate = putback ? MODEL.putbackAssist : fastBreak ? 0.5 : MODEL.assistRate[type];
      if (rng.chance(rate)) {
        const mates = off.onCourt.filter((id) => id !== shooter);
        assist = rng.weighted(mates, (id) => Math.pow(this.p(id).tendencies.ast_per36, 1.3) * this.p(id).attrs.passing / 60);
      }
    }

    const cp = contest ? this.p(contest) : null;
    let fouled = this.rules.street ? false : forceFoul ?? (!heave && !!contest && rng.chance(M.shootingFoulProb(sp, type, cp, L) * (fastBreak ? 1.3 : 1) * foulScale));
    let pMake = M.shotMakeProb(sp, type, cp, L, {
      assisted: !!assist, fastBreak, putback, early, lateClock, lastShot, heave,
      energy: off.energy[shooter], streak: s.streak[shooter] ?? 0, difficultyMod,
    });
    if (fouled) pMake *= MODEL.andOneFactor;
    pMake *= makeScale;
    if (makeProb != null) pMake = makeProb;
    const made = forceMade ?? rng.chance(pMake);
    const pts = (this.rules.street ? R.STREET_POINTS : R.SHOT_POINTS)[type];
    s.streak[shooter] = made ? Math.max(0, s.streak[shooter] ?? 0) + 1 : Math.min(0, s.streak[shooter] ?? 0) - 1;

    if (fouled) {
      const fouler = rng.chance(0.75) ? contest : rng.weighted(def.onCourt, (id) => this.p(id).tendencies.pf_per36);
      if (made) {
        this.addPoints(offSide, pts);
        this.emit({ type: 'shot', team: offSide, player: shooter, shot: type, made: true, pts, assist, and1: true, fastBreak: !!fastBreak, putback: !!putback });
      }
      this.commitFoul(defSide, fouler, offSide, shooter, 'shooting', { protect: [shooter], shot: type, made });
      return this.freeThrows(offSide, shooter, R.shootingFoulFTs(type, made));
    }

    if (made) {
      this.addPoints(offSide, pts);
      this.emit({ type: 'shot', team: offSide, player: shooter, shot: type, made: true, pts, assist, fastBreak: !!fastBreak, putback: !!putback, heave: !!heave });
      // StreetBall make-it take-it (an option): the team that scores keeps the ball
      if (this.rules.street && this.rules.makeItTakeIt) return this.setPossession(offSide, 'made');
      return this.changePossession('made');
    }

    let block = null;
    if (!heave && contest && makeProb == null) {
      const blocker = type === 'rim' && !exact ? rng.weighted(def.onCourt, (id) => Math.pow(this.p(id).attrs.block, 3)) : contest;
      if (rng.chance(M.blockProb(type, this.p(blocker), L) * (exact ? 0.55 : 1))) block = blocker;
    }
    this.emit({ type: 'shot', team: offSide, player: shooter, shot: type, made: false, pts: 0, block, fastBreak: !!fastBreak, putback: !!putback, heave: !!heave });
    return this.rebound(offSide, { blocked: !!block });
  }

  /**
   * Free throws. Headless: all of them are shot right away. With `deferred` set (real-time layer)
   * they are left pending in `state.pending` and shot one at a time with freeThrow().
   */
  freeThrows(side, shooter, n) {
    const s = this.state;
    s.pending = { kind: 'ft', side, shooter, n, i: 0 };
    if (this.deferred) { s.next = { kind: 'ft' }; return; }
    while (s.pending?.kind === 'ft') this.freeThrow();
  }

  /** Shoot the next pending free throw. `makeProb` pins the odds (the user's free throw meter). */
  freeThrow({ makeProb = null } = {}) {
    const s = this.state, pd = s.pending;
    if (!pd || pd.kind !== 'ft') return null;
    const team = s.teams[pd.side];
    pd.i += 1;
    const made = this.rng.chance(makeProb ?? M.freeThrowProb(this.p(pd.shooter), team.energy[pd.shooter]));
    if (made) this.addPoints(pd.side, 1);
    const ev = { type: 'ft', team: pd.side, player: pd.shooter, made, n: pd.i, of: pd.n };
    this.emit(ev);
    if (pd.i >= pd.n) {
      s.pending = null;
      s.possession = pd.side;
      if (made) this.changePossession('made');
      else this.rebound(pd.side, { ft: true });
    }
    return ev;
  }

  /** A missed shot. Headless: resolved right away. Real-time layer: left pending until the ball comes off the rim. */
  rebound(shootSide, { ft = false, blocked = false } = {}) {
    const s = this.state;
    s.pending = { kind: 'rebound', shootSide, ft, blocked };
    if (this.deferred) { s.next = { kind: 'rebound' }; return; }
    this.resolveRebound();
  }

  /**
   * Decide the pending rebound. `mult` (real-time layer) maps player id -> positional factor
   * (who is near the ball, who jumped); `norm` is the usual offense/defense ratio of those factors,
   * so that average positioning leaves the offensive-rebound rate where the model has it.
   */
  resolveRebound(mult = null, norm = 1) {
    const s = this.state, rng = this.rng, L = this.data.league;
    const pd = s.pending;
    if (!pd || pd.kind !== 'rebound') return;
    s.pending = null;
    const { shootSide, ft, blocked } = pd;
    const defSide = other(shootSide);
    const off = s.teams[shootSide], def = s.teams[defSide];
    this.tick(rng.range(0.4, 1.6));

    const offPlayers = off.onCourt.map((id) => this.p(id));
    const defPlayers = def.onCourt.map((id) => this.p(id));
    let pOff = M.offRebProb(offPlayers, defPlayers, L, ft);
    const mu = (id) => (mult ? mult[id] ?? 1 : 1);
    if (mult) {
      const avg = (ids) => ids.reduce((a, id) => a + mu(id), 0) / ids.length;
      const ratio = Math.pow(avg(off.onCourt) / Math.max(0.05, avg(def.onCourt)) / norm, 0.9);
      const o = pOff * ratio;
      pOff = clamp(o / (o + 1 - pOff), 0.03, 0.75);
    }
    const offWins = rng.chance(pOff);
    const winSide = offWins ? shootSide : defSide;
    const winTeam = s.teams[winSide];

    // Team rebound: the ball went out of bounds. A miss that goes out is the defense's ball; a block
    // knocked out of bounds by the defender stays with the offense.
    if (rng.chance(MODEL.teamReboundShare * (blocked ? 2.5 : 1))) {
      const offKeeps = !!blocked;
      this.emit({ type: 'rebound', team: offKeeps ? shootSide : defSide, player: null, off: offKeeps });
      this.subWindow('out_of_bounds');
      if (offKeeps) {
        s.shotClock = R.shotClockAfter('oreb', s.shotClock, this.rules);
        s.next = { kind: 'inbound_front' };
      } else {
        this.setPossession(defSide, 'inbound_back');
      }
      return;
    }

    const rebounder = rng.weighted(winTeam.onCourt, (id) => M.reboundWeight(this.p(id), offWins) * mu(id));
    this.emit({ type: 'rebound', team: winSide, player: rebounder, off: offWins });

    // Loose-ball foul by the team that lost the battle.
    if (!this.rules.street && rng.chance(MODEL.looseBallFoulOnMiss)) {
      const loseSide = other(winSide);
      const fouler = rng.weighted(s.teams[loseSide].onCourt, (id) => this.p(id).tendencies.pf_per36 * this.p(id).attrs.strength);
      const { penalty } = this.commitFoul(loseSide, fouler, winSide, rebounder, 'loose_ball', { protect: [rebounder] });
      s.possession = winSide;
      if (penalty) return this.freeThrows(winSide, rebounder, 2);
      if (offWins) {
        s.shotClock = R.shotClockAfter('foul_frontcourt', this.rules.shotClockReset, this.rules);
        s.next = { kind: 'inbound_front' };
      } else {
        s.shotClock = this.rules.shotClock;
        s.next = { kind: 'inbound_back' };
      }
      return;
    }

    if (offWins) {
      s.shotClock = R.shotClockAfter('oreb', s.shotClock, this.rules);
      s.next = { kind: 'oreb', rebounder };
    } else {
      this.setPossession(defSide, 'defreb');
    }
  }

  turnover(side, player, kind, steal = null) {
    this.emit({ type: 'turnover', team: side, player, kind, steal });
    if (steal) {
      this.setPossession(other(side), 'steal');
      this.state.next.stealer = steal;
    } else {
      this.subWindow('violation');
      this.setPossession(other(side), 'inbound_back');
    }
  }

  /**
   * Personal foul. Updates player/team fouls, emits foul (+ foul_out), opens a sub window.
   * @returns {{penalty:boolean, fouledOut:boolean}}
   */
  commitFoul(foulSide, fouler, drawnSide, drawnBy, kind, opts = {}) {
    const s = this.state;
    const t = s.teams[foulSide];
    t.pf[fouler] = (t.pf[fouler] ?? 0) + 1;
    const teamFoul = kind !== 'offensive';
    if (teamFoul) {
      t.teamFouls += 1;
      if (s.clock <= 120) t.foulsLast2 += 1;
    }
    const penalty = (kind === 'personal' || kind === 'loose_ball')
      && R.isPenaltyFoul(t.teamFouls, t.foulsLast2, s.clock, s.period, this.rules);
    this.emit({ type: 'foul', team: foulSide, player: fouler, kind, drawn: drawnBy, teamFouls: t.teamFouls, penalty, personal: t.pf[fouler] });
    const fouledOut = R.isFouledOut(t.pf[fouler], this.rules);
    if (fouledOut) this.emit({ type: 'foul_out', team: foulSide, player: fouler });
    if (!opts.noSubWindow) this.subWindow('foul', { protect: opts.protect ?? [] });
    else if (fouledOut) this.subWindow('foul', { protect: [] });
    return { penalty, fouledOut };
  }

  addPoints(side, pts) {
    const s = this.state;
    s.score[side] += pts;
    s.run[side] += pts;
    s.run[other(side)] = 0;
    // StreetBall: the game ends the moment a team reaches the target with a big enough lead
    if (this.rules.street && !s.over) {
      const w = R.streetWinner(s.score, this.rules);
      if (w) {
        s.over = true; s.winner = w;
        this.emit({ type: 'game_end', winner: w, home: s.score.home, away: s.score.away });
      }
    }
  }

  changePossession(reason) {
    const s = this.state;
    if (reason === 'made') this.subWindow('made');
    this.setPossession(other(s.possession), reason);
  }

  setPossession(side, kind) {
    const s = this.state;
    s.possession = side;
    s.shotClock = R.shotClockAfter(kind === 'inbound_back' ? 'turnover' : kind, s.shotClock, this.rules);
    s.next = { kind };
  }

  // ------------------------------------------------------------------ coaching

  /**
   * CPU coach. Like most basketball games' CPU: stop an opponent run, rest a gassed lineup, and
   * late in a close game take one after being scored on to set up. Two are saved for the stretch.
   */
  maybeTimeout(side, start = null) {
    const s = this.state, rng = this.rng;
    const team = s.teams[side];
    if (team.timeouts <= 0 || !this.autoSubs[side]) return;
    const margin = s.score[side] - s.score[other(side)];
    if (s.period >= this.rules.periods && Math.abs(margin) >= 20) return; // garbage time: let it run
    const late = s.period >= this.rules.periods && s.clock <= R.scaledClock(150, this.rules);
    const reserve = late ? 0 : 2;
    if (team.timeouts <= reserve) return;
    const oppRun = s.run[other(side)];
    const tired = team.onCourt.reduce((a, id) => a + team.energy[id], 0) / 5 < 0.45;
    const setUp = late && start === 'made' && margin < 0 && margin >= -6 && s.clock <= R.scaledClock(60, this.rules);
    if ((oppRun >= 8 && rng.chance(0.75)) || (tired && rng.chance(0.3)) || (setUp && rng.chance(0.6))) this.callTimeout(side);
  }

  callTimeout(side) {
    const s = this.state;
    const team = s.teams[side];
    if (team.timeouts <= 0) return false;
    team.timeouts -= 1;
    for (const sd of SIDES) for (const id of s.teams[sd].onCourt) {
      s.teams[sd].energy[id] = Math.min(1, s.teams[sd].energy[id] + MODEL.timeoutRecover);
    }
    s.run.home = 0; s.run.away = 0;
    this.emit({ type: 'timeout', team: side, left: team.timeouts });
    this.subWindow('timeout');
    return true;
  }

  /** Apply auto-subs for both teams if the rules allow subbing on this dead ball. */
  subWindow(reason, { protect = [] } = {}) {
    if (this.rules.street) return;     // StreetBall: the three who start, finish
    const s = this.state;
    const allowed = R.canSubstitute(reason, s.period, s.clock, this.rules);
    for (const side of SIDES) {
      const team = s.teams[side];
      const forced = new Set(team.onCourt.filter((id) => R.isFouledOut(team.pf[id], this.rules)));
      if (!allowed && forced.size === 0) continue;
      if (!this.autoSubs[side] && forced.size === 0) continue;
      let swaps = planSubs({
        team, byId: this.data.byId, period: s.period, clock: s.clock, rules: this.rules,
        elapsed: s.elapsed, margin: s.score[side] - s.score[other(side)], forced,
      });
      if (!allowed || !this.autoSubs[side]) swaps = swaps.filter((w) => forced.has(w.out));
      for (const w of swaps) {
        if (protect.includes(w.out) && !forced.has(w.out)) continue;
        this.substitute(side, w.out, w.in, w.reason);
      }
    }
  }

  substitute(side, outId, inId, reason = 'manual') {
    const team = this.state.teams[side];
    const i = team.onCourt.indexOf(outId);
    if (i < 0) throw new Error(`${outId} is not on the court`);
    if (team.onCourt.includes(inId)) throw new Error(`${inId} is already on the court`);
    if (!this.p(inId).available) throw new Error(`${inId} is not available`);
    if (R.isFouledOut(team.pf[inId], this.rules)) throw new Error(`${inId} has fouled out`);
    team.onCourt[i] = inId;
    this.emit({ type: 'sub', team: side, out: outId, in: inId, reason });
  }
}

/** StreetBall: a team's usual three (for menus): its healthy starters, topped up from the depth chart. */
export function teamStreetThree(data, teamId) {
  const T = data.teams[teamId], byId = data.byId;
  const ok = (id) => byId[id]?.available;
  const five = T.default_starters.filter(ok);
  for (const id of T.depth_order) if (five.length < 5 && ok(id) && !five.includes(id)) five.push(id);
  return streetThree(five, byId);
}

/** StreetBall lineup: three of the five starters (best guard, best big, best of the rest), in starter order. */
function streetThree(starters, byId) {
  const ovr = (id) => byId[id]?.overall ?? 0;
  const best = (ids) => [...ids].sort((a, b) => ovr(b) - ovr(a))[0];
  const pick = [];
  const g = best(starters.filter((id) => posGroup(byId[id]) === 'G'));
  if (g) pick.push(g);
  const b = best(starters.filter((id) => posGroup(byId[id]) === 'B' && !pick.includes(id)));
  if (b) pick.push(b);
  while (pick.length < 3) pick.push(best(starters.filter((id) => !pick.includes(id))));
  return starters.filter((id) => pick.includes(id));
}

function jumpScore(p) {
  const h = p.height_in ?? { PG: 75, SG: 77, SF: 79, PF: 81, C: 83 }[p.pos] ?? 79;
  return 2 * (h - 78) + 0.4 * p.attrs.athleticism;
}
