// Animation state machine. Reads the real-time game (LiveGame) and decides, for every player,
// referee and bench player, which animation frame to show and where. It never writes to the game:
// every offset here (dunk leap, defender press, huddles, walk-on subs) is cosmetic.
import { ANIMS } from './anims.js';
import { lookFor, kitFor, REF_KIT, REF_APP } from './sprites.js';
import { makeLook } from './rig.js';

const other = (s) => (s === 'home' ? 'away' : 'home');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const NOMINAL = { walk: 4.5, jog: 9.5, sprint: 15, backpedal: 7, side_shuffle: 6, d_slide: 7, d_closeout: 9, dribble_jog: 9, dribble_sprint: 14, ref_run: 10, post_up: 3, protect_ball: 4, roll_call: 12, jog_big: 9, sprint_guard: 16, dribble_low: 10, dribble_big: 8, post_backdown: 3 };
const TWO_HAND = new Set(['dunk_two_hand', 'alley_oop_catch', 'reverse', 'dunk_standing_two', 'dunk_power', 'dunk_spin', 'putback_dunk', 'dunk_double_clutch', 'dunk_behind_head']);
const idNum = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return h; };
const pick = (u, arr) => arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
const COACH_KIT = { jersey: '#22242e', trim: '#3a3d4c', number: '#22242e', shorts: '#1a1b22', shoe: '#101014' };

/** Small deterministic hash for cosmetic variety (never touches the game's RNG). */
function hash(...n) {
  let h = 2166136261;
  for (const v of n) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return ((h >>> 0) % 1000) / 1000;
}

export class Actors {
  constructor(L, bank, appearance) {
    this.L = L; this.bank = bank; this.app = appearance;
    this.kits = { home: kitFor(L.state.teams.home.id, true, L.data.teams), away: kitFor(L.state.teams.away.id, false, L.data.teams) };
    this.looks = new Map();
    this.styles = new Map();
    this.byEnt = new Map();
    for (const e of L.all) this.byEnt.set(e, this.makeActor(e));
    this.refs = [0, 1, 2].map((i) => ({ ref: true, i, x: 40 + i * 7, y: i === 2 ? 3 : 46, vx: 0, vy: 0, left: false, anim: 'idle', t: i * 0.3, one: null, look: makeLook(REF_APP, REF_KIT, '') }));
    this.ghosts = [];                 // players jogging off after a substitution
    this.bench = { home: [], away: [] };
    this.cues = [];                   // one-frame notifications for the renderer / audio
    this.fire = new Map();            // player id -> consecutive makes
    this.pts = new Map();
    this.pendingFouls = []; this.pendingTO = [];
    this.seenEv = L.game.events.length;
    this.lastStep = null; this.lastFlight = null; this.lastWindup = null; this.lastMeter = null; this.lastPhase = null; this.lastInbThrown = false;
    this.time = L.time; this.excite = 0; this.popup = null; this.foulCard = null;
    this.coach = { home: makeLook({ ...appearance.generic, height_in: 74, hair: 'short', hair_color: 'grey' }, COACH_KIT, ''), away: makeLook({ ...appearance.generic, height_in: 75, skin_tone: 4, hair: 'bald' }, COACH_KIT, '') };
    this.cheerT = { home: 0, away: 0 };
    for (const ev of L.game.events) this.tally(ev);
    this.syncBench();
  }

  look(id, side) {
    const key = `${id}|${side}`;
    let l = this.looks.get(key);
    if (!l) { l = lookFor(this.L.p(id), this.app, this.kits[side]); this.looks.set(key, l); }
    return l;
  }

  /** A player's own package: jump shot base, go-to shot, size-up, free throw routine, how he runs. */
  style(e) {
    let S = this.styles.get(e.id);
    if (!S) {
      const L = this.L, P = L.p(e.id), A = P.attrs, n = idNum(e.id), big = P.pos === 'C' || P.pos === 'PF';
      const sig = (salt, arr) => pick(hash(n, salt), arr);
      S = {
        base: sig(1, big ? ['set_shot', 'high_release', 'jumper', 'two_motion'] : ['jumper', 'one_motion', 'two_motion', 'high_release', 'quick_release']),
        goto: sig(2, big ? ['shimmy_fade', 'turnaround_jumper', 'one_leg_fade'] : ['leg_kick_jumper', 'stepback_jumper', 'shimmy_fade', 'one_leg_fade', 'side_step_jumper']),
        sizeUp: sig(3, ['size_up', 'size_up_rock', 'size_up_tween']),
        ft: sig(4, ['free_throw', 'free_throw_knees', 'free_throw_spin']),
        jog: (P.height_in ?? 78) >= 82 ? 'jog_big' : 'jog',
        sprint: !big && A.speed >= 78 ? 'sprint_guard' : 'sprint',
        drib: big ? 'dribble_big' : A.ball_handle >= 80 ? 'dribble_low' : 'dribble_jog',
        post: A.strength >= 72 ? 'post_backdown' : 'post_up',
        star: (P.tendencies?.usage_per36 ?? 0) >= L.data.league.tend.usage_per36 * 1.2,
        flashy: A.passing >= 78,
      };
      this.styles.set(e.id, S);
    }
    return S;
  }

  makeActor(e) {
    return {
      e, id: e.id, look: this.look(e.id, e.side), x: e.x, y: e.y, px: e.x, py: e.y, vvx: 0, vvy: 0, spd: 0,
      left: e.fx < 0, anim: 'idle', t: hash(e.slot, 3) * 2, one: null, cd: 0, pv: [0, 0], pvT: 0,
      ov: null, zoff: 0, post: 0, catchT: 9, nudge: 0, frame: null, lastFake: e.fakeT, lastBit: e.bitT, lastJump: e.jumpT, lastMove: e.dmove?.at, moved: true,
    };
  }

  cue(type, data = {}) { this.cues.push({ type, ...data }); }

  play(a, name, o = {}) {
    if (ANIMS[name + '~run'] && a.spd > 4.5) name += '~run';   // dribble move on the move: the legs keep stepping
    const an = ANIMS[name];
    if (!an) return;
    a.one = { name, t: (o.from ?? 0) * an.dur, rate: o.rate ?? 1, dur: o.dur ?? an.dur, loop: an.loop, cancel: o.cancel ?? false, then: o.then ?? null, age: 0, driven: o.driven ?? null, lock: o.lock ?? false };
  }

  tally(ev) {
    if (ev.type === 'shot') {
      this.fire.set(ev.player, ev.made ? (this.fire.get(ev.player) ?? 0) + 1 : 0);
      if (ev.made) this.pts.set(ev.player, (this.pts.get(ev.player) ?? 0) + ev.pts);
    } else if (ev.type === 'ft' && ev.made) this.pts.set(ev.player, (this.pts.get(ev.player) ?? 0) + 1);
  }

  syncBench() {
    const L = this.L;
    for (const side of ['home', 'away']) {
      const t = L.state.teams[side];
      const on = new Set(L.ents[side].map((e) => e.id));
      const ids = t.roster.filter((id) => !on.has(id) && L.p(id).available !== false).slice(0, 8);
      this.bench[side] = ids.map((id, i) => ({ id, look: this.look(id, side), i }));
    }
  }

  // ------------------------------------------------------------------ per-frame update
  update() {
    const L = this.L;
    const dt = clamp(L.time - this.time, 0, 0.25);
    this.time = L.time;
    this.cues.length = 0;
    if (dt <= 0) return;
    const st = L.phase === 'anim' && L.queue[0]?.started ? L.queue[0] : null;

    // --- new log events
    const evs = L.game.events;
    for (; this.seenEv < evs.length; this.seenEv++) this.onEvent(evs[this.seenEv], this.seenEv);

    // --- substitutions: an entity changed player
    for (const a of this.byEnt.values()) {
      if (a.id !== a.e.id) {
        const side = a.e.side, home = side === 'home';
        this.ghosts.push({ look: a.look, x: a.x, y: a.y, sx: a.x, sy: a.y, toX: home ? 30 : 64, toY: -2.5, t: 0, dur: 1.7, left: false });
        a.id = a.e.id; a.look = this.look(a.id, side);
        a.ov = { kind: 'walkon', fx: home ? 43 : 51, fy: -2, t: 0, dur: 1.7 };
        a.one = null;
        this.syncBench();
        this.cue('sub');
      }
    }
    for (const g of this.ghosts) {
      if (g.tx != null) { g.x = g.tx; g.y = g.ty; }
      g.x0 = g.x; g.y0 = g.y;
      g.t += dt; const u = ease(g.t / g.dur);
      const nx = lerp(g.sx, g.toX, u); g.left = nx < g.x; g.x = nx; g.y = lerp(g.sy, g.toY, u); g.tx = g.x; g.ty = g.y;
    }
    this.ghosts = this.ghosts.filter((g) => g.t < g.dur);

    // --- phase / step / flight transitions
    if (L.phase !== this.lastPhase) this.onPhase(L.phase, this.lastPhase);
    if (st !== this.lastStep) { if (this.lastStep) this.onStepEnd(this.lastStep); if (st) this.onStepStart(st); }
    const fl = L.ball.flight;
    if (fl !== this.lastFlight) {
      if (fl) this.onPass(fl.from, fl.to, fl);
      else if (this.lastFlight && L.ball.holder === this.lastFlight.to) this.onCatch(this.lastFlight.to);
    }
    if (L.inb && L.inb.thrown && !this.lastInbThrown) this.onPass(L.inb.passer, L.inb.recv, null);
    this.lastInbThrown = !!(L.inb && L.inb.thrown);
    const w = L.windup, m = L.meter;
    if (w && w !== this.lastWindup) this.onShotStart(w.e, w.type);
    if (m && !this.lastMeter && L.ball.holder) this.onShotStart(L.ball.holder, m.type);
    if ((!w && this.lastWindup) || (!m && this.lastMeter)) {
      // wind-up ended without a shot step (stripped, whistle...) -> drop the driven pose
      const e = this.lastWindup?.e ?? this.shotEnt;
      const a = e && this.byEnt.get(e);
      if (a?.one?.driven === 'windup' && !(st && st.k === 'shot')) a.one = null;
    }
    if (L.lastGreen) { L.lastGreen = false; this.cue('green'); }
    this.lastPhase = L.phase; this.lastStep = st; this.lastFlight = fl; this.lastWindup = w; this.lastMeter = m;

    // --- everyone
    const holder = L.ball.holder;
    const offSide = L.state.possession;
    for (const a of this.byEnt.values()) this.updateActor(a, dt, st, holder, offSide);
    this.updateRefs(dt, st, offSide);
    for (const s of ['home', 'away']) this.cheerT[s] = Math.max(0, this.cheerT[s] - dt);
    this.excite = Math.max(0, this.excite - dt * 0.45);
    if (this.popup && (this.popup.t += dt) > this.popup.dur) this.popup = null;
    if (this.foulCard && (this.foulCard.t += dt) > this.foulCard.dur) this.foulCard = null;
  }

  // ------------------------------------------------------------------ event hooks
  onEvent(ev, idx) {
    const L = this.L;
    this.tally(ev);
    if (ev.type === 'foul') this.pendingFouls.push(ev);
    else if (ev.type === 'turnover') {
      if (ev.steal) {
        const v = this.byEnt.get(L.entOf(ev.player)), s = this.byEnt.get(L.entOf(ev.steal));
        if (v) this.play(v, 'hit_reaction', { cancel: true });
        if (s && ev.kind !== 'lost_ball') this.play(s, 'catch', { cancel: true });
        this.cue('steal'); this.excite = Math.max(this.excite, 0.5);
      } else this.pendingTO.push(ev);
    } else if (ev.type === 'jump_ball') this.cue('whistle');
  }

  onPhase(p, prev) {
    const L = this.L;
    if (p === 'tip') {
      for (const a of this.byEnt.values()) if (a.e.role === 4) this.play(a, 'tip', { from: 0, rate: 0.45 });
    } else if (p === 'break' || p === 'final') {
      this.cue('buzzer');
      if (p === 'final') {
        const win = L.state.score.home > L.state.score.away ? 'home' : 'away';
        for (const a of this.byEnt.values()) this.play(a, a.e.side === win ? 'celebrate' : 'dejected', { then: a.e.side === win ? 'clap' : null });
        this.cheerT[win] = 6; this.excite = 1;
      }
    }
    if (prev === 'final' || prev === null) this.syncBench();
  }

  onShotStart(e, type) {
    const L = this.L, a = this.byEnt.get(e);
    if (!a) return;
    this.shotEnt = e;
    const hoop = L.hoopOf(e.side), d = Math.hypot(hoop.x - e.x, hoop.y - e.y);
    const role = e.role, h = hash(L.game.events.length, e.slot, Math.floor(e.x * 3));
    const away = (e.vx * (hoop.x - e.x) + e.vy * (hoop.y - e.y)) < -6;        // moving away from the hoop
    const lp = L.lastPass, caught = lp && lp.to === e && L.time - lp.t < 1.4;
    let name;
    const h3 = hash(L.game.events.length, e.slot, 57);
    const toward = (e.vx * (hoop.x - e.x) + e.vy * (hoop.y - e.y)) > 5 * d;      // moving at the hoop
    const tight = L.contest(e).score > 0.57;
    const baseline = Math.abs(hoop.x - e.x) < 3.5 && Math.abs(e.y - hoop.y) > 3;
    const S = this.style(e);
    const sideways = Math.abs(e.vy) > 6 && Math.abs(e.vy) > Math.abs(e.vx) * 1.2;
    const corner = Math.abs(e.y - hoop.y) > 19 && Math.abs(hoop.x - e.x) < 9;
    if (type === 'rim') {
      if (a.post > 0.3) name = pick(h, ['up_and_under', 'layup_right', 'post_hop_hook']);
      else if (d > 5 && role <= 1 && a.spd > 4) name = pick(h, ['floater', 'runner', 'tear_drop']);
      else if (tight && h < 0.55) name = h < 0.3 ? 'contact_layup' : 'double_clutch_layup';
      else if (baseline && h < 0.7) name = 'reverse_layup';
      else if (role >= 3 && a.spd < 3) name = 'power_layup';
      else if (h < 0.55) name = pick(h / 0.55, ['finger_roll', 'scoop_layup', 'hop_step_layup', 'spin_layup', 'swoop_layup']);
      else name = (e.y < hoop.y) === (hoop.x > 47) ? 'layup_right' : 'layup_left';
    } else if (type === 'mid') {
      if (role >= 3 && d < 13) name = a.post > 0.3 ? pick(h, ['hook', 'turnaround_jumper', 'post_fade', 'post_hop_hook', 'post_shake']) : a.spd > 4 ? 'running_hook' : pick(h, ['hook', 'turnaround_jumper', 'fadeaway']);
      else if (role <= 1 && d < 11 && a.spd > 5) name = pick(h, ['floater', 'runner', 'tear_drop']);
      else if (baseline && !caught) name = 'baseline_fade';
      else if (away) name = pick(h, ['fadeaway', 'one_leg_fade', 'stepback_jumper']);
      else if (toward && a.spd > 5) name = 'leaner';
      else if (caught) name = h3 < 0.3 ? 'hop_jumper' : S.base;
      else if (S.star && tight && h3 < 0.6) name = S.goto;
      else if (sideways) name = 'side_step_jumper';
      else name = pick(h3, ['pull_up', 'pullup_cross', 'pullup_hesi', 'one_leg_fade', 'pull_up', 'spin_jumper']);
    } else if (d > 27) name = 'deep_three';
    else if (away) name = h < 0.5 ? 'stepback_jumper' : 'fadeaway';
    else if (caught) name = corner ? 'corner_set' : h3 < 0.25 ? 'hop_jumper' : h3 < 0.45 ? 'quick_release' : S.base;
    else if (sideways) name = 'moving_three';
    else if (S.star && tight && h3 < 0.5) name = S.goto;
    else name = pick(h, ['pull_up', 'pullup_cross', 'pullup_hesi', S.base]);
    a.left = hoop.x < e.x;
    this.play(a, name, { driven: 'windup', lock: true });
    a.shotName = name;
  }

  onStepStart(st) {
    const L = this.L;
    if (st.k === 'shot') {
      const ev = st.ev, e = L.entOf(ev.player), a = e && this.byEnt.get(e);
      const hoop = st.hoop, right = hoop.x > 47;
      if (a) {
        a.left = hoop.x < e.x;
        let name = a.one?.driven === 'windup' ? a.one.name : (a.shotName ?? 'jumper');
        if (!ANIMS[name] || ANIMS[name].rel == null) name = 'jumper';
        const P = L.p(ev.player).attrs;
        const h = hash(L.game.events.length, e.slot, 17), dunkScore = P.dunk * 0.6 + P.athleticism * 0.4;
        const lp = L.lastPass;
        const oop = !!st.oop;
        const canDunk = ev.shot === 'rim' && ev.made && st.zone.dist < 6.6
          && (oop ? P.dunk >= 50 : P.dunk >= 55 && h < clamp((P.dunk - 45) / 40, 0.1, 0.9) * ((st.cs ?? 0) > 0.31 ? 0.8 : 1));
        if (oop && !canDunk) name = 'alley_oop_layup';
        if (canDunk) {
          const h2 = hash(L.game.events.length, e.slot, 91);
          const evs = L.game.events, ei = evs.lastIndexOf(ev);
          const contact = (st.cs ?? 0) > 0.44, standing = a.spd < 3.5;
          if (oop) name = h2 < 0.55 ? 'alley_oop_catch' : 'alley_oop_one_hand';
          else if (ev.assist && lp && lp.to === e && L.time - lp.t < 1.3) name = 'alley_oop_catch';
          else if (ei > 0 && evs[ei - 1].type === 'rebound' && evs[ei - 1].player === ev.player) name = 'putback_dunk';
          else if (contact && dunkScore >= 60) name = h2 < 0.5 ? 'dunk_contact' : 'dunk_poster';           // through the defender
          else if (standing) name = h2 < 0.5 ? 'dunk_standing_two' : 'dunk_standing_one';                  // no run-up
          else if (dunkScore >= 69) name = pick(h2, ['windmill', 'tomahawk', 'reverse', 'dunk_one_hand', 'dunk_double_clutch', 'dunk_behind_head', 'dunk_cradle', 'dunk_side_clutch', 'dunk_spin', 'dunk_glide']);
          else if (dunkScore >= 62) name = pick(h2, ['tomahawk', 'dunk_one_hand', 'dunk_two_hand', 'dunk_cradle', 'dunk_glide', 'dunk_power']);
          else name = pick(h2, ['dunk_two_hand', 'dunk_one_hand', 'dunk_power']);
          const an = ANIMS[name];
          this.play(a, name, { from: 0.3, driven: 'dunk', lock: true });
          a.one.t0 = 0.3 * an.dur; a.one.t1 = an.rel * an.dur;
          // how much extra lift the sprite needs for the hand to reach the rim
          const f = this.bank.frameIdx(a.look, name, Math.round(an.rel * (Math.max(2, Math.round(an.dur * 14)) - 1)), a.left !== !!this.viewFlip);
          const reach = -(TWO_HAND.has(name) ? (f.handF[1] + f.handB[1]) / 2 : f.handF[1]);
          a.ov = { kind: 'dunk', tx: hoop.x + (right ? -1.5 : 1.5), ty: 25.3, w: 0, extra: Math.max(0, 87 - reach), hang: (name === 'dunk_two_hand' || name === 'alley_oop_catch' || name === 'dunk_power' || name === 'dunk_standing_two') && h2 > 0.35 ? 0.45 : 0 };
          a.dunk = name; st._dunk = a;
        } else {
          a.dunk = null;
          this.play(a, name, { from: ANIMS[name].rel, lock: true });
        }
        this.cue('release');
      }
      // contest / block / box out
      if (e) {
        let best = null, bd = 7;
        for (const o of L.ents[other(e.side)]) { const d = Math.hypot(o.x - e.x, o.y - e.y); if (d < bd) { bd = d; best = o; } }
        const blocker = ev.block ? L.entOf(ev.block) ?? best : null;
        for (const o of L.ents[other(e.side)]) {
          const b = this.byEnt.get(o);
          if (o === blocker) { b.left = e.x < o.x; this.play(b, 'd_block', { lock: true }); continue; }
          if (o === best && !st._dunk) { b.left = e.x < o.x; const hc = hash(o.slot, L.game.events.length); this.play(b, hc < 0.35 ? 'd_block' : hc < 0.7 ? 'd_contest_jump' : 'd_hands_up', { dur: 0.6, cancel: true }); continue; }
          if (o.role >= 2 && Math.hypot(o.x - hoop.x, o.y - hoop.y) < 13 && ev.shot !== 'rim') { b.left = !right; this.play(b, 'box_out', { dur: st.dur + 0.2, cancel: true }); }
        }
      }
    } else if (st.k === 'reb') {
      const e = st.ev.player ? L.entOf(st.ev.player) : null, a = e && this.byEnt.get(e);
      if (a) this.play(a, 'rebound_jump', { rate: 0.6 / Math.max(0.3, st.dur + 0.1), then: 'rebound_grab', lock: true });
      // somebody else goes up for it too
      let o2 = null, bd = 9;
      for (const o of L.all) { if (o === e) continue; const d = Math.hypot(o.x - L.ball.x, o.y - L.ball.y); if (d < bd) { bd = d; o2 = o; } }
      if (o2 && hash(L.game.events.length, o2.slot) < 0.7) this.play(this.byEnt.get(o2), 'tip', { cancel: true });
      this.cue('rim');
    } else if (st.k === 'ftsetup') {
      this.cue('whistle');
    } else if (st.k === 'ft') {
      const e = L.entOf(st.ev.player), a = e && this.byEnt.get(e);
      if (a) { const nm = this.style(e).ft; a.left = st.hoop.x < e.x; this.play(a, nm, { from: ANIMS[nm].rel, lock: true }); }
      this.cue('release');
    } else if (st.k === 'timeout') {
      this.cue('whistle');
      const ref = this.refs[0]; this.play(ref, 'ref_whistle', { then: 'ref_out_of_bounds' });
      this.huddle = { t: 0, dur: st.dur };
      this.cheerT.home = this.cheerT.away = 0;
    } else if (st.k === 'wait' && st.banner) {
      if (/^Foul on/.test(st.banner) && this.pendingFouls.length) this.onFoul(this.pendingFouls.shift());
      else if (/fouled out/.test(st.banner)) { /* handled with the foul */ }
      else if (this.pendingTO.length) this.onDeadTurnover(this.pendingTO.shift());
    }
  }

  onStepEnd(st) {
    const L = this.L;
    if (st.k === 'shot') {
      const ev = st.ev, right = st.hoop.x > 47;
      const e = L.entOf(ev.player), a = e && this.byEnt.get(e);
      if (ev.made) {
        const dunk = !!st._dunk;
        this.cue(dunk ? 'dunk' : 'swish', { right, three: ev.shot === 'three' });
        this.excite = Math.max(this.excite, dunk || ev.shot === 'three' ? 1 : 0.55);
        if (dunk || ev.shot === 'three' || ev.and1) this.cheerT[ev.team] = 1.8;
        const P = L.p(ev.player);
        this.popup = { text: `${P.name.split(' ').slice(-1)[0]} ${this.pts.get(ev.player) ?? ev.pts} PTS`, side: ev.team, t: 0, dur: 2.4, fire: (this.fire.get(ev.player) ?? 0) >= 3 };
        const h = hash(L.game.events.length, e ? e.slot : 0, 5);
        if (a && !dunk) {
          if (ev.assist && h < 0.45) this.queueAfter(a, 'point_to_passer');
          else if (ev.shot === 'three' || ev.and1) { if (h < 0.75) this.queueAfter(a, 'celebrate'); }
        } else if (a && dunk) a.afterDunk = h < 0.5 ? 'taunt' : 'celebrate';
        // the beaten defender
        if (e) {
          const d = L.matchOf(e), b = d && this.byEnt.get(d);
          if (b && (dunk || ev.shot === 'three') && hash(L.game.events.length, d.slot, 8) < 0.5) this.play(b, 'dejected', { cancel: true });
        }
        const ref = this.refs[1]; this.play(ref, 'ref_count', { dur: 0.9, cancel: true });
      } else if (!ev.block) {
        this.cue('rim', { right, shake: true });
        if (a && hash(L.game.events.length, 3) < 0.15 && ev.shot !== 'rim') this.queueAfter(a, 'dejected');
      } else { this.cue('block'); this.excite = Math.max(this.excite, 0.6); }
    } else if (st.k === 'ft') {
      const right = st.hoop.x > 47;
      if (st.ev.made) {
        this.cue('swish', { right, soft: true });
        const mates = L.ents[st.ev.team].filter((x) => x.id !== st.ev.player);
        const m = mates[Math.floor(hash(L.game.events.length, st.ev.n) * mates.length)];
        if (m) this.play(this.byEnt.get(m), 'clap', { dur: 0.9, cancel: true });
      } else this.cue('rim', { right, shake: true });
    } else if (st.k === 'timeout') this.huddle = null;
  }

  queueAfter(a, name) {
    if (a.one && !a.one.then) a.one.then = name; else if (!a.one) this.play(a, name, { cancel: true });
  }

  onFoul(ev) {
    const L = this.L;
    const f = L.entOf(ev.player), v = ev.drawn ? L.entOf(ev.drawn) : null;
    const af = f && this.byEnt.get(f), av = v && this.byEnt.get(v);
    if (af) { if (v) af.left = v.x < f.x; this.play(af, 'foul_shove', { then: ev.personal >= 4 ? 'dejected' : null, lock: true }); }
    if (av) {
      if (f) av.left = f.x < v.x;
      const h = hash(L.game.events.length, v.slot, 23);
      if (ev.kind === 'shooting' && h < 0.4) this.play(av, 'fall', { then: 'get_up', lock: true });
      else this.play(av, 'hit_reaction', { then: h > 0.6 ? 'hold_arm' : null, lock: true });
    }
    // nearest referee blows it and signals
    let r = this.refs[0], bd = 1e9;
    for (const x of this.refs) { const d = f ? Math.hypot(x.x - f.x, x.y - f.y) : 0; if (d < bd) { bd = d; r = x; } }
    if (f) r.left = f.x < r.x;
    this.play(r, 'ref_whistle', { then: 'ref_foul_signal' });
    this.cue('whistle'); this.cue('contact');
    const P = L.p(ev.player);
    this.foulCard = { text: `FOUL  #${P.number} ${P.name.split(' ').slice(-1)[0]}`, sub: `PF ${ev.personal}  TEAM FOULS ${ev.teamFouls}${ev.penalty ? '  BONUS' : ''}`, side: ev.team, t: 0, dur: 2.6 };
  }

  onDeadTurnover(ev) {
    const L = this.L;
    this.cue('whistle');
    const oob = /out_of_bounds/.test(ev.kind);
    const r = this.refs[oob ? 2 : 0];
    this.play(r, 'ref_whistle', { then: oob ? 'ref_out_of_bounds' : 'ref_count' });
    const e = ev.player ? L.entOf(ev.player) : null, a = e && this.byEnt.get(e);
    if (oob) {
      // a team-mate dives after the loose ball
      let m = null, bd = 16;
      for (const o of L.ents[ev.team]) { if (o === e) continue; const d = Math.hypot(o.x - L.ball.x, o.y - L.ball.y); if (d < bd) { bd = d; m = o; } }
      if (m) { const b = this.byEnt.get(m); b.left = L.ball.x < m.x; this.play(b, 'loose_ball_dive', { then: 'get_up', lock: true }); }
    }
    if (a) this.play(a, 'dejected', { cancel: true });
  }

  onPass(from, to, fl) {
    const L = this.L, a = this.byEnt.get(from);
    if (!a) return;
    const d = Math.hypot(to.x - from.x, to.y - from.y), h = hash(L.game.events.length, from.slot, Math.floor(L.time * 10));
    const S = this.style(from), mv = Math.hypot(from.vx, from.vy), h2 = hash(L.game.events.length, from.slot, 77, Math.floor(L.time * 10));
    let name;
    if (fl?.lob) name = 'pass_lob';
    else if (L.phase === 'inbound') name = 'overhead_pass';
    else if (d > 40) name = 'pass_baseball';
    else if (d > 26) name = 'overhead_pass';
    else if (S.flashy && h2 < 0.12) name = 'pass_behind_back';
    else if (S.flashy && h2 < 0.3) name = 'pass_no_look';
    else if (mv > 7 && h2 > 0.55) name = 'pass_whip';
    else name = h < 0.3 ? 'bounce_pass' : 'chest_pass';
    if (Math.abs(to.x - from.x) > 1) a.left = to.x < from.x;
    this.play(a, name, { from: ANIMS[name].rel * 0.75, cancel: true });
    this.passKind = name;
    this.cue('pass');
  }

  onCatch(e) {
    const a = this.byEnt.get(e);
    if (!a || a.one?.lock) return;
    this.play(a, 'catch', { from: 0.35, cancel: true });
    a.catchT = 0; a.moved = false;
    this.cue('catch');
  }

  // ------------------------------------------------------------------ one player
  updateActor(a, dt, st, holder, offSide) {
    const L = this.L, e = a.e;
    // --- visual position (sim position + cosmetic overrides; an online guest's own player is drawn where it predicts him)
    const pr = L.pred?.e === e ? L.pred : e;
    let x = pr.x, y = pr.y, zoff = 0;
    if (a.ov) {
      const o = a.ov;
      if (o.kind === 'walkon') {
        o.t += dt; const u = ease(o.t / o.dur);
        x = lerp(o.fx, e.x, u); y = lerp(o.fy, e.y, u);
        if (o.t >= o.dur) a.ov = null;
      } else if (o.kind === 'dunk') {
        const active = st && st._dunk === a;
        if (active) o.w = ease(st.t / st.dur);
        else if (o.hang > 0) { o.hang -= dt; if (a.one?.name !== 'rim_hang') this.play(a, 'rim_hang', { dur: o.hang + 0.05, lock: true }); }
        else { o.w -= dt / 0.38; if (a.one?.name === 'rim_hang') a.one = null; }
        if (o.w <= 0) { a.ov = null; if (a.afterDunk) { this.play(a, a.afterDunk, { cancel: true }); a.afterDunk = null; } }
        else { x = lerp(e.x, o.tx, ease(o.w)); y = lerp(e.y, o.ty, ease(o.w)); zoff = o.extra * o.w + (a.one?.name === 'rim_hang' ? 0 : 0); }
      }
    }
    if (this.huddle && st && st.k === 'timeout') {
      const hd = this.huddle; hd.t = st.t;
      const w = ease(Math.min(hd.t / 1.2, (hd.dur - hd.t) / 1.2));
      const home = e.side === 'home', ang = (e.role / 5) * Math.PI * 2;
      x = lerp(x, (home ? 24 : 70) + Math.cos(ang) * 3.2, w); y = lerp(y, 3.2 + Math.sin(ang) * 1.6, w);
    }
    a.vvx = (x - a.px) / dt; a.vvy = (y - a.py) / dt;
    a.px = x; a.py = y;
    a.x0 = a.tx ?? x; a.y0 = a.ty ?? y; a.z0 = a.tz ?? zoff; a.tx = x; a.ty = y; a.tz = zoff;   // renderer interpolates x0 -> tx
    a.x = x; a.y = y; a.zoff = zoff;
    const spd = Math.hypot(a.vvx, a.vvy);
    a.spd = spd;
    a.cd = Math.max(0, a.cd - dt); a.catchT += dt;

    const isHolder = holder === e && L.phase !== 'final';
    const off = e.side === offSide;
    const hoop = L.hoopOf(e.side);
    const ball = L.ball;
    const live = L.phase === 'live';

    // --- steal lunge (the game sets a cooldown when a defender reaches)
    if (e.stealCd > (a.lastSteal ?? 0) + 0.3 && !a.one?.lock) { if (holder) a.left = holder.x < e.x; this.play(a, hash(Math.floor(L.time * 5), e.slot, 5) < 0.4 ? 'd_poke' : 'd_steal_swipe', {}); this.cue('squeak'); }
    a.lastSteal = e.stealCd;

    // --- pump fake (user), the defender who bit on it, the user's rebound jump
    if (e.dmove && e.dmove.at !== a.lastMove) {
      // dribble move called with C: play it now (a blow-by finishes with the burst)
      a.lastMove = e.dmove.at;
      if (L.time - e.dmove.at < 0.25) {
        const dm = e.dmove, name = ANIMS[dm.kind] ? dm.kind : 'hesitation';
        a.left = dm.dx < 0;
        this.play(a, name, { cancel: false, then: dm.burst ? 'drive_burst' : null }); a.cd = 0.85; this.cue('squeak');
      }
    }
    if (e.fakeT !== a.lastFake) { a.lastFake = e.fakeT; if (L.time - e.fakeT < 0.25) this.play(a, 'pump_fake', { lock: true }); }
    if (e.bitT !== a.lastBit) { a.lastBit = e.bitT; if (L.time - e.bitT < 0.25) { if (holder) a.left = holder.x < e.x; this.play(a, 'd_bite', { lock: true }); } }
    if (e.jumpT !== a.lastJump) { a.lastJump = e.jumpT; if (L.time - e.jumpT < 0.25 && !a.one?.lock) this.play(a, 'rebound_jump', {}); }
    if (isHolder && spd > 2) a.moved = true;

    // --- alley-oop: the target times his jump to the lob
    const lobFl = ball.flight?.lob && ball.flight.to === e ? ball.flight : null;
    if (lobFl) {
      const u = lobFl.t / lobFl.dur;
      if (u > 0.5) {
        if (a.one?.driven !== 'lob') { a.left = hoop.x < e.x; this.play(a, L.p(e.id).attrs.dunk >= 50 ? 'alley_oop_catch' : 'alley_oop_layup', { driven: 'lob', lock: true }); }
        a.one.t = ANIMS[a.one.name].dur * 0.3 * clamp((u - 0.5) / 0.5, 0, 0.999);
      }
    } else if (a.one?.driven === 'lob' && !(st && st.k === 'shot')) a.one = null;

    // --- driven shot wind-up
    const one = a.one;
    if (one?.driven === 'windup') {
      const an = ANIMS[one.name];
      const w = L.windup && L.windup.e === e ? L.windup.t / L.windup.dur : L.meter && isHolder ? Math.min(1, L.meter.t / (L.meter.dur * L.meter.sweet)) : null;
      if (w != null) one.t = an.rel * an.dur * clamp(w, 0, 1) * 0.999;
    } else if (one?.driven === 'dunk') {
      if (st && st._dunk === a) one.t = lerp(one.t0, one.t1, st.t / st.dur);
      else { one.driven = null; }
    } else if (one?.driven === 'lob') {
      /* timed by the lob above */
    } else if (one) {
      one.t += dt * one.rate; one.age += dt;
      if (one.cancel && one.age > 0.3 && spd > 6) a.one = null;
      else if (one.t >= one.dur) {
        if (one.then) this.play(a, one.then, { cancel: one.then !== 'get_up' && one.then !== 'rebound_grab', lock: one.then === 'get_up' });
        else a.one = null;
      }
    }

    // --- free-throw routine (dead ball): walk to the line, bounce it, set, rise
    if (L.ftLine && L.ftLine.shooter === e && st && (st.k === 'ftsetup' || st.k === 'ftaim') && !a.one) {
      const nm = this.style(e).ft, an = ANIMS[nm];
      a.left = hoop.x < e.x;
      if (st.k === 'ftaim') {
        const m = L.ftMeter;
        let f;
        if (m && !m.active) f = 0.3 * ((m.wait * 0.8) % 1);                               // bouncing it until Space is pressed
        else if (m) f = 0.42 + (an.rel - 0.42) * clamp(m.t / (m.dur * m.sweet), 0, 1);     // rises with the meter
        else f = an.rel * clamp(st.t / st.dur, 0, 1);                                      // CPU: the whole routine
        a.anim = nm; a.t = an.dur * Math.min(f, an.rel * 0.999); a.ftHold = true;
      } else {
        a.ftHold = false;
        const nm2 = spd > 9 ? 'dribble_sprint' : spd > 1.5 ? 'dribble_jog' : 'idle_ball';
        if (nm2 !== a.anim) { a.anim = nm2; a.t = 0; }
        a.t += dt * (NOMINAL[nm2] ? clamp(spd / NOMINAL[nm2], 0.55, 1.6) : 1);
      }
      this.finish(a);
      return;
    }
    a.ftHold = false;

    // --- facing
    if (!a.one?.lock) {
      let face = null;
      if (isHolder && e.pivot) {
        // picked up his dribble: he turns on his pivot foot the way the user points
        face = Math.abs(e.fx) > 0.3 ? e.fx < 0 : a.left;
        if ((face !== a.left || (e.pivotStep != null && L.time - e.pivotStep < 0.05)) && !a.one) this.play(a, hash(Math.floor(L.time * 9), e.slot, 71) < 0.5 ? 'pivot_front' : 'pivot_reverse', {});
      } else if (isHolder) {
        if (Math.abs(a.vvx) > 2.2) face = a.vvx < 0; else if (Math.abs(hoop.x - x) > 1) face = hoop.x < x;
      } else if (off || !live) {
        if (Math.abs(a.vvx) > 3) face = a.vvx < 0; else if (Math.abs(ball.x - x) > 2) face = ball.x < x;
      } else {
        const man = L.matchOf(e), tgt = holder && (man === holder || Math.hypot(holder.x - x, holder.y - y) < 9) ? holder : (holder ?? ball);
        if (spd > 13.5 && Math.abs(a.vvx) > 6) face = a.vvx < 0; else if (Math.abs(tgt.x - x) > 1.2) face = tgt.x < x;
      }
      if (face != null) a.left = face;
    }

    // --- dribble moves on sharp direction changes
    if (isHolder && live && !a.one && a.cd <= 0 && !L.windup && !L.meter) {
      a.pvT += dt;
      const ps = Math.hypot(a.pv[0], a.pv[1]);
      if (ps > 5 && spd > 4.5) {
        const cos = (a.pv[0] * a.vvx + a.pv[1] * a.vvy) / (ps * spd), ang = Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;
        const nd = L.nearestDef(e), dh = Math.hypot(hoop.x - x, hoop.y - y);
        const toHoopNow = (a.vvx * (hoop.x - x) + a.vvy * (hoop.y - y)) / (spd * (dh || 1));
        const toHoopPrev = (a.pv[0] * (hoop.x - x) + a.pv[1] * (hoop.y - y)) / (ps * (dh || 1));
        const h = hash(Math.floor(L.time * 7), e.slot, 41);
        let mv = null;
        if (nd.d < 10) {
          if (toHoopNow < -0.45 && toHoopPrev > 0.2 && nd.d < 6.5) mv = pick(h, ['step_back', 'snatch_back', 'stepback_cross', 'escape_retreat']);
          else if (ang > 115) mv = pick(h, ['spin', 'half_spin', 'behind_back', 'spin_reverse', 'wrap_behind']);
          else if (ang > 38 && dh < 15 && toHoopNow > 0.4) mv = 'euro_step';
          else if (ang > 48) mv = pick(h, ['crossover', 'between_legs', 'behind_back', 'in_and_out', 'double_cross', 'push_cross', 'combo_cross_tween', 'combo_btb_cross', 'drag_cross']);
        }
        if (mv) { this.play(a, mv, {}); a.cd = 0.85; this.cue('squeak'); }
      } else if (ps > 9.5 && spd < 3.5 && L.nearestDef(e).d < 9) {
        const dh = Math.hypot(hoop.x - x, hoop.y - y), h = hash(Math.floor(L.time * 7), e.slot, 43);
        this.play(a, dh < 12 ? 'jump_stop' : pick(h, ['hesitation', 'stutter_step', 'hang_hesi', 'shift']), {}); a.cd = 0.9; this.cue('squeak');
      } else if (ps < 5.5 && spd > 10.5 && (a.vvx * (hoop.x - x) + a.vvy * (hoop.y - y)) > 0 && Math.hypot(hoop.x - x, hoop.y - y) < 32) {
        this.play(a, 'drive_burst', {}); a.cd = 0.7; this.cue('squeak');   // first step of a drive
      } else if (spd < 0.8 && a.catchT > 0.3 && a.catchT < 0.5 && !a.jab && L.nearestDef(e).d < 6.5) {
        a.jab = true;
        const h = hash(Math.floor(L.time * 3), e.slot, 47);
        if (h < 0.6) { this.play(a, pick(h / 0.6, ['jab_step', 'pump_fake', 'rip_through', 'pass_fake']), { cancel: true }); a.cd = 0.6; }
      }
      if (a.pvT > 0.14) { a.pv = [a.vvx, a.vvy]; a.pvT = 0; }
    } else if (!isHolder) { a.pv = [0, 0]; a.jab = false; }

    // --- pick and roll: the screener opens up and rolls when the screen ends
    if (a.wasScreen && !(e.screen > 0) && e.roll && !a.one) this.play(a, 'screen_roll', { cancel: true });
    a.wasScreen = e.screen > 0;

    // --- post-up detection (a big with his back to the basket and a defender on him)
    const dh = Math.hypot(hoop.x - x, hoop.y - y);
    const posting = isHolder && live && e.role >= 3 && dh > 3.5 && dh < 15 && spd < 5.5 && L.nearestDef(e).d < 4.2 && !L.windup && !L.meter;
    const wasPost = a.post > 0.3;
    a.post = clamp(a.post + (posting ? dt * 3 : -dt * 4), 0, 1);
    if (wasPost && a.post <= 0.3 && isHolder && !a.one && spd > 4 && (a.vvx * (hoop.x - x) + a.vvy * (hoop.y - y)) > 0) { a.left = hoop.x >= x; this.play(a, hash(Math.floor(L.time * 5), e.slot, 73) < 0.5 ? 'drop_step' : 'post_spin', {}); }
    if (a.post > 0.6 && isHolder && !a.one && a.cd <= 0 && spd < 1 && hash(Math.floor(L.time / 1.3), e.slot, 79) < 0.3) { a.left = hoop.x >= x; this.play(a, 'post_fake', {}); a.cd = 1.6; }

    // --- base (looping) animation
    let name, rate = 1;
    const lateral = Math.abs(a.vvy) > Math.abs(a.vvx) * 1.4;
    const backward = Math.abs(a.vvx) > 2.5 && (a.vvx < 0) !== a.left;
    const S = this.style(e);
    if (isHolder) {
      if (L.phase === 'inbound' || (L.phase === 'anim' && spd < 1.5)) name = 'idle_ball';
      else if (e.pivot) name = 'triple_threat';
      else if (a.post > 0.3) { name = spd < 0.5 && a.catchT < 1.2 ? 'post_hold' : S.post; a.left = hoop.x >= x; }
      else if (spd < 1.3) name = a.catchT < 0.4 || !live ? 'idle_ball' : !a.moved && a.catchT < 2.2 ? 'triple_threat' : L.nearestDef(e).d < 7 && hash(Math.floor(L.time / 2.7), e.slot, 61) < 0.5 ? S.sizeUp : 'dribble_stand';
      else if (spd < 5.5 && L.nearestDef(e).d < 3.4 && !backward) name = 'protect_ball';
      else name = spd > 11.5 || (e.sprinting && spd > 9) ? 'dribble_sprint' : S.drib;
    } else if (!off && live && holder) {
      const man = L.matchOf(e), onBall = man === holder;
      const dm = man ? Math.hypot(man.x - x, man.y - y) : 99, dhd = Math.hypot(holder.x - x, holder.y - y);
      const shooting = L.windup || L.meter;
      const scr = onBall && !shooting ? L.ents[holder.side].find((m) => m.screen > 0 && Math.hypot(m.x - x, m.y - y) < 3.3) : null;
      if (e.handsUp || (shooting && (onBall || dhd < 6.5) && spd < 4)) name = 'd_hands_up';
      else if (L.double && L.double.e === e && dhd < 6 && spd < 4) name = 'd_trap';
      else if (scr && spd > 0.8) name = 'screen_fight';
      else if (shooting && dhd < 14 && spd >= 4 && (a.vvx * (holder.x - x) + a.vvy * (holder.y - y)) > 0) name = 'd_closeout';
      else if (spd < 1.2) name = onBall || dhd < 8 ? 'd_stance' : dm < 9 && Math.hypot(man.x - holder.x, man.y - holder.y) < 24 ? 'deny' : dm < 12 ? 'd_stance' : 'idle';
      else if (spd > 12) name = S.sprint;
      else if (onBall || dhd < 9) name = spd < 10.5 ? 'd_slide' : S.jog;
      else if (backward) name = 'backpedal';
      else if (lateral && spd < 8) name = 'side_shuffle';
      else name = spd < 4 ? 'walk' : S.jog;
    } else {
      const lobWait = ball.flight?.lob && ball.flight.to === e;
      const onLane = L.ftLine && st && (st.k === 'ftaim' || st.k === 'ft') && e !== L.ftLine.shooter && dh < 13;
      if (off && live && e.screen > 0 && spd < 2.2 && (e.screenSet ?? 0) > 0) name = 'screen_set';
      else if (off && live && (e.roll || lobWait) && spd > 3) name = 'roll_call';
      else if (onLane && spd < 1.2) name = 'ft_lane';
      else if (spd < 1.2) name = L.energy(e) < 0.38 && !live ? 'idle_tired'
        : off && live && holder && holder !== e && dh < 30 && L.nearestDef(e).d > 9 && hash(Math.floor(L.time / 2.3), e.slot, 83) < 0.4 ? 'call_for_ball' : 'idle';
      else if (backward && spd < 11) name = 'backpedal';
      else name = spd > 12 || (e.sprinting && spd > 9.5) ? S.sprint : spd < 4.2 ? 'walk' : S.jog;
    }
    if (this.huddle && st?.k === 'timeout' && spd < 1) name = hash(e.slot, 9) < 0.4 ? 'clap' : L.energy(e) < 0.6 ? 'idle_tired' : 'idle';
    if (NOMINAL[name]) rate = clamp(spd / NOMINAL[name], 0.55, 1.6);
    if (name !== a.anim) {
      const prev = a.anim; a.anim = name;
      // keep the stride phase when switching between gaits, restart otherwise
      if (!(NOMINAL[prev] && NOMINAL[name])) a.t = 0; else a.t = (a.t / ANIMS[prev].dur) * ANIMS[name].dur;
    }
    const before = a.t;
    a.t += dt * rate;
    // dribble thump once per cycle, footstep squeaks now and then
    const an = ANIMS[name];
    if (an.ball === 'drib' && !a.one && Math.floor(before / an.dur + 0.5) !== Math.floor(a.t / an.dur + 0.5)) this.cue('bounce');
    if ((name === 'd_slide' || name === 'sprint' || name === 'sprint_guard') && Math.floor(before / an.dur) !== Math.floor(a.t / an.dur) && hash(Math.floor(L.time * 9), e.slot) < 0.12) this.cue('squeak');
    this.finish(a);
  }

  /** Resolve the frame to draw for an actor. */
  finish(a) {
    const o = a.one;
    if (o) {
      const an = ANIMS[o.name];
      // viewFlip (StreetBall camera turned round): what faces left in the world faces right on screen
      a.frame = this.bank.frame(a.look, o.name, an.loop ? o.t : Math.min(o.t, an.dur * 0.9999), a.left !== !!this.viewFlip);
      a.cur = o.name; a.curT = o.t;
    } else {
      a.frame = this.bank.frame(a.look, a.anim, a.t, a.left !== !!this.viewFlip);
      a.cur = a.anim; a.curT = a.t;
    }
  }

  // ------------------------------------------------------------------ referees
  updateRefs(dt, st, offSide) {
    const L = this.L, b = L.ball;
    const right = L.dirRight(offSide);
    const s = right ? 1 : -1;
    const bx = clamp(b.x, 4, 90);
    const tg = [
      [clamp(bx - s * 15, 6, 88), 45.5],                    // trail
      [right ? 91.5 : 2.5, 39],                              // lead, on the baseline
      [clamp(bx - s * 5, 8, 86), 2.2],                       // slot, far sideline
    ];
    if (L.ftLine) { const h = L.hoopOf(L.ftLine.side); tg[1] = [h.x + (h.x > 47 ? 3 : -3), 36]; tg[0] = [h.x + (h.x > 47 ? -24 : 24), 44]; }
    for (const r of this.refs) {
      if (r.tx != null) { r.x = r.tx; r.y = r.ty; }
      r.x0 = r.x; r.y0 = r.y;
      const [tx, ty] = tg[r.i];
      const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
      const v = Math.min(15, d * 2.2);
      const busy = r.one && !r.one.cancel;
      if (d > 0.6 && !busy) { r.x += dx / d * v * dt; r.y += dy / d * v * dt; }
      r.tx = r.x; r.ty = r.y;
      const spd = d > 0.6 && !busy ? v : 0;
      if (r.one) {
        r.one.t += dt * r.one.rate; r.one.age += dt;
        if (r.one.t >= r.one.dur) { if (r.one.then) this.play(r, r.one.then, { dur: 1.1 }); else r.one = null; }
      }
      if (!r.one) {
        if (spd > 1.5) { r.left = dx < 0; } else if (Math.abs(b.x - r.x) > 2) r.left = b.x < r.x;
        const name = spd > 1.5 ? 'ref_run' : 'idle';
        if (name !== r.anim) { r.anim = name; r.t = 0; }
        r.t += dt * (name === 'ref_run' ? clamp(spd / NOMINAL.ref_run, 0.5, 1.5) : 1);
        r.frame = this.bank.frame(r.look, r.anim, r.t, r.left);
      } else {
        const an = ANIMS[r.one.name];
        r.frame = this.bank.frame(r.look, r.one.name, an.loop ? r.one.t : Math.min(r.one.t, an.dur * 0.9999), r.left);
      }
    }
  }
}
