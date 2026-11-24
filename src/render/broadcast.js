// The broadcast view: 640x360 pixel canvas, side-on camera, y-sorted animated sprites.
// Reads LiveGame state only; nothing here feeds back into the game.
import { SW, SH, FAR_Y, ZPX, Camera } from './view.js';
import { Arena } from './arena.js';
import { StreetArena } from './street.js';
import { SpriteBank, kitFor } from './sprites.js';
import { Actors } from './actors.js';
import { Hud } from './hud.js';
import { ANIMS } from './anims.js';
import { drawBall, drawShadow } from './ball.js';
import { text } from './font.js';

const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const BENCH_Y = FAR_Y - 15;
const SPIN_SECS = 1.0;               // StreetBall camera swivel on a change of possession          // screen row where bench players' feet sit

export class Broadcast {
  constructor(canvas, appearance, settings, sound) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    // the world is drawn at 640x360 here, then zoomed onto the real canvas; the HUD goes on top unzoomed
    this.scene = document.createElement('canvas'); this.scene.width = SW; this.scene.height = SH;
    this.sctx = this.scene.getContext('2d', { alpha: false });
    this.appearance = appearance; this.settings = settings; this.sound = sound;
    this.bank = new SpriteBank();
    this.cam = new Camera();
    this.L = null; this.net = { left: 0, right: 0 }; this.shake = { left: 0, right: 0 };
    this.drop = null; this.introT = 0; this.shown = 0; this.dust = [];
  }

  attach(L) {
    this.L = L;
    const th = L.state.teams.home, ta = L.state.teams.away;
    const kh = kitFor(th.id, true, L.data.teams), ka = kitFor(ta.id, false, L.data.teams);
    const teamRec = (t) => ({ ...L.data.teams[t.id], id: t.id });
    this.arena = new (L.street ? StreetArena : Arena)(teamRec(th), teamRec(ta), kh.jersey, kh.trim);
    this.viewSide = L.viewSide; this.spin = null;
    this.cam.rot = L.street && L.viewSide === 'away' ? Math.PI : 0;
    this.actors = new Actors(L, this.bank, this.appearance);
    this.actors.viewFlip = Math.cos(this.cam.rot) < 0;
    // away wears white: use its trim colour for HUD accents
    this.colors = { home: kh.jersey, away: ka.trim };
    this.hud = new Hud(L, this.actors, this.bank, this.colors);
    this.cam.zoom = 1; this.cam.view = this.zoom();
    this.cam.view = this.zoom();
    this.cam.snap(L.street ? this.camTarget() : 47);
    this.net = { left: 0, right: 0 }; this.shake = { left: 0, right: 0 }; this.drop = null; this.dust = [];
    this.realT = 0; this.hideBall = 0;
  }

  /** Queue the frames a game is sure to need; warmStep() bakes a few per frame so nothing hitches. */
  prewarm() {
    const names = ['idle', 'jog', 'dribble_jog', 'dribble_stand', 'd_stance', 'd_slide', 'sprint', 'walk', 'dribble_sprint', 'backpedal', 'jumper', 'pull_up',
      'side_shuffle', 'd_hands_up', 'd_closeout', 'catch', 'chest_pass', 'idle_ball', 'layup_right', 'layup_left', 'rebound_jump', 'protect_ball', 'crossover', 'box_out'];
    this.warm = [];
    for (const n of names) for (const a of this.actors.byEnt.values()) {
      const c = Math.max(2, Math.round(ANIMS[n].dur * 14));
      for (let i = 0; i < c; i++) this.warm.push([a.look, n, i, false], [a.look, n, i, true]);
    }
    this.warm.reverse();
    this.warmStep(40);
  }

  warmStep(ms = 2.5) {
    if (!this.warm || !this.warm.length) return;
    const t0 = performance.now();
    while (this.warm.length && performance.now() - t0 < ms) { const w = this.warm.pop(); this.bank.frameIdx(w[0], w[1], w[2], w[3]); }
  }

  // ------------------------------------------------------------------ camera
  camTarget() {
    const L = this.L, b = L.ball;
    if (L.street) {
      // StreetBall: a close half-court frame on the basket being played. The basket of the half the
      // ball is in (during a shot, the one it was shot at); leans a little toward the ball.
      const st = L.phase === 'anim' && L.queue[0]?.started ? L.queue[0] : null;
      const hoop = st?.hoop ?? L.rebCtx?.hoop ?? L.hoopOf(L.courtSide ?? L.state.possession), s = hoop.x > 47 ? 1 : -1;
      const base = hoop.x - s * 13.5, bx = this.ballWorld?.x ?? b.x;
      return this.cam.rw(Math.abs(bx - hoop.x) < 50 ? lerp(base, bx, 0.2) : base, 25)[0];   // in the turned view
    }
    if (L.phase === 'tip' || L.phase === 'break' || L.phase === 'final') return 47;
    const st = L.phase === 'anim' && L.queue[0]?.started ? L.queue[0] : null;
    if (L.ftLine) { const h = L.hoopOf(L.ftLine.side); return h.x + (h.x > 47 ? -20 : 20); }
    if (st?.k === 'timeout') return 47;
    if (st?.k === 'shot' || st?.k === 'ft') return lerp(st.from.x, st.hoop.x, 0.6) + (st.hoop.x > 47 ? -8 : 8);
    const side = L.state.possession, hoop = L.hoopOf(side), s = hoop.x > 47 ? 1 : -1;
    const bx = this.ballWorld?.x ?? b.x;
    if (L.isFront(side, bx, 4)) return lerp(bx, hoop.x - s * 16, 0.45);
    return bx + s * 7;                                   // lead the play in transition
  }

  // ------------------------------------------------------------------ ball
  /** Where to draw the ball: screen position, the floor point for its shadow, and a sort depth. */
  ballView() {
    const L = this.L, b = L.ball, cam = this.cam, A = this.actors;
    const st = L.phase === 'anim' && L.queue[0]?.started ? L.queue[0] : null;
    let carrier = null;
    if (b.holder) carrier = A.byEnt.get(b.holder);
    else if (st?.k === 'shot' && st._dunk && st.t < st.dur) carrier = st._dunk;
    else if (L.inb && !L.inb.thrown && Math.hypot(L.inb.passer.x - b.x, L.inb.passer.y - b.y) < 2.6) carrier = A.byEnt.get(L.inb.passer);
    else if (st?.k === 'ft' && L.ftLine) { const a = A.byEnt.get(L.ftLine.shooter); if (a?.ftHold && a.frame?.ball) carrier = a; }
    if (carrier && carrier.frame) {
      const a = carrier, f = a.frame;
      const [fx, fy] = this.actorScreen(a);
      const which = f.ball ?? '2';
      const path = ANIMS[a.cur]?.bp;
      let x, y, behind = false;
      if (path && carrier !== this.actors.byEnt.get(L.ftLine?.shooter)) {
        // dribble move: the ball follows the move's path (hand to floor to the other hand, through the legs...)
        const u = Math.max(0, Math.min(1, a.curT / ANIMS[a.cur].dur));
        let i = 0;
        while (i < path.length - 2 && path[i + 1][0] <= u) i++;
        const p0 = path[i], p1 = path[Math.min(i + 1, path.length - 1)];
        const span = p1[0] - p0[0], s0 = span > 0 ? Math.max(0, Math.min(1, (u - p0[0]) / span)) : 1;
        const s = p1[1] === 'fl' ? s0 * s0 : p0[1] === 'fl' ? 1 - (1 - s0) * (1 - s0) : s0;   // falls, then rises
        const at = (p) => {
          if (p[1] === 'fl') return [fx + (p[2] ?? 4) * f.dir, fy - 3];
          if (p[1] === 'hp') return [fx + f.hip[0] + (p[2] ?? 0) * f.dir, fy + f.hip[1] + 2];
          const anc = this.bank.anchor(f, p[1]);
          return [fx + anc[0] + (p[1] === '2' ? 0 : f.dir), fy + anc[1] - (p[1] === '2' ? 0 : 1)];
        };
        const q0 = at(p0), q1 = at(p1);
        x = q0[0] + (q1[0] - q0[0]) * s; y = q0[1] + (q1[1] - q0[1]) * s;
        behind = !!(p0[3] || (p1[3] && s0 > 0.5));   // only once the ball has gone round the hip
      } else if (which === 'drib') {
        const an = ANIMS[a.cur], anc = f.handF;
        const per = a.cur === 'free_throw' ? 0.34 : an.dur;
        const k = Math.abs(Math.cos(Math.PI * (a.curT / per)));
        x = fx + anc[0] + f.dir * 2; y = lerp(fy - 3, fy + anc[1] + 3, k);
      } else {
        const anc = this.bank.anchor(f, which);
        x = fx + anc[0] + (which === '2' ? 0 : f.dir); y = fy + anc[1] - (which === '2' ? 0 : 1);
      }
      this.b1 = null;
      this.ballWorld = { x: a.x, y: a.y };
      return { x, y, fx: x, fy: cam.fy(a.x, a.y) + 1, depth: cam.rw(a.x, a.y)[1] + (behind ? -0.03 : 0.02), spin: Math.floor(a.curT * 9) };
    }
    // free ball
    let x = b.x, y = b.y, z = b.z;
    if (st?.k === 'ft' && st.from) {
      // cosmetic: the free throw gets there a little sooner so the shooter can set up the next one
      const u = Math.min(1, (st.t / st.dur) / 0.62), d = Math.hypot(st.hoop.x - st.from.x, st.hoop.y - st.from.y);
      x = lerp(st.from.x, st.hoop.x, u); y = lerp(st.from.y, st.hoop.y, u);
      z = lerp(7.4, 10, u) + (1.6 + d * 0.1) * 4 * u * (1 - u);
      if (u >= 1) { const v = (st.t / st.dur - 0.62) / 0.2; if (v > 1) return null; z = st.ev.made ? 10 - v * 5 : 10 + Math.sin(v * Math.PI) * 1.5; if (!st.ev.made) x += (st.hoop.x > 47 ? -1 : 1) * v * 3; }
    } else if (b.flight && A.passKind === 'bounce_pass') {
      const u = Math.min(1, b.flight.t / b.flight.dur); z = 0.5 + 3.6 * Math.abs(Math.cos(Math.PI * u));
    } else if (L.phase === 'inbound' && L.inb && !L.inb.thrown) z = 0.6 + Math.abs(Math.sin(this.realT * 9)) * 1.2;
    if (this.hideBall > 0 && L.phase !== 'live') return null;
    if (L.time !== this.ballT) { this.b0 = this.b1 ?? { x, y, z }; this.b1 = { x, y, z }; this.ballT = L.time; }
    if (this.b0 && Math.abs(this.b1.x - this.b0.x) + Math.abs(this.b1.y - this.b0.y) < 5) {
      const u = this.alpha ?? 1;
      x = this.b0.x + (this.b1.x - this.b0.x) * u; y = this.b0.y + (this.b1.y - this.b0.y) * u; z = this.b0.z + (this.b1.z - this.b0.z) * u;
    }
    if (st?.k === 'shot' && z > 10) z = 10 + (z - 10) * 0.5;      // flatter arc reads better from the side
    const [sx, sy] = cam.project(x, y, z);
    this.ballWorld = { x, y };
    return { x: sx, y: sy, fx: cam.sx(x, y), fy: cam.fy(x, y), depth: cam.rw(x, y)[1], spin: Math.floor(this.realT * 14), high: z };
  }

  actorScreen(a) {
    const [sx, sy] = this.cam.project(a.x, a.y, 0);
    return [Math.round(sx + (a.nudge ?? 0)), Math.round(sy - (a.zoff ?? 0))];
  }

  zoom() { if (this.L?.street) return 1.5; const z = Number(this.settings.gameZoom); return z >= 1 && z <= 1.5 ? z : 1.15; }

  /** Blit the zoomed scene to the real canvas and return its context, scaled so the HUD can draw in 640x360 units. */
  present() {
    const m = this.ctx, z = this.zoom(), k = this.canvas.width / SW;
    const w = SW / z, h = SH / z;
    // keep the near sideline just above the score bug; the crop comes out of the crowd at the top
    const cy = clamp(Math.round(322 - (h - 27 / z)), 0, SH - h);
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.imageSmoothingEnabled = false;
    m.drawImage(this.scene, (SW - w) / 2, cy, w, h, 0, 0, this.canvas.width, this.canvas.height);
    m.setTransform(k, 0, 0, k, 0, 0);
    return m;
  }

  // ------------------------------------------------------------------ frame
  frame(realDt, { intro = 0, alpha = 1, fps = 0 } = {}) {
    const L = this.L, cam = this.cam, A = this.actors;
    let c = this.sctx;
    if (!L) return;
    this.realT += realDt;
    c.imageSmoothingEnabled = false;
    const simDt = clamp(L.time - A.time, 0, 0.25);
    A.update();
    this.warmStep();
    // draw between the last two simulation steps so motion stays smooth at any refresh rate
    this.alpha = alpha;
    const mixp = (o) => {
      if (o.tx == null) return;
      const far = Math.abs(o.tx - o.x0) + Math.abs(o.ty - o.y0) > 3;
      o.x = far ? o.tx : o.x0 + (o.tx - o.x0) * alpha; o.y = far ? o.ty : o.y0 + (o.ty - o.y0) * alpha;
      if (o.tz != null) o.zoff = far ? o.tz : o.z0 + (o.tz - o.z0) * alpha;
    };
    for (const a of A.byEnt.values()) mixp(a);
    // online guest: its own player goes where its own buttons take him, every refresh (see Session.predict)
    if (L.pred) { const a = A.byEnt.get(L.pred.e); if (a && !a.ov) { a.x = L.pred.x; a.y = L.pred.y; } }
    for (const r of A.refs) mixp(r);
    for (const g of A.ghosts) mixp(g);

    // cues -> net, rim, sound, crowd
    for (const q of A.cues) {
      const k = q.right ? 'right' : 'left';
      if (q.type === 'swish' || q.type === 'dunk') {
        this.net[k] = 0.001; this.hideBall = 0.32;
        const h = q.right ? 88.75 : 5.25;
        this.drop = { x: h, y: 25, t: 0, dur: 0.3 };
        if (q.type === 'dunk') this.shake[k] = 0.35;
        if (q.type === 'dunk' || q.three) this.sound.play('cheer');
      } else if (q.type === 'rim' && q.shake) this.shake[k] = 0.25;
      this.sound.play(q.type);
    }
    for (const k of ['left', 'right']) {
      if (this.net[k] > 0) { this.net[k] += simDt / 0.5; if (this.net[k] >= 1) this.net[k] = 0; }
      this.shake[k] = Math.max(0, this.shake[k] - simDt);
    }
    this.hideBall = Math.max(0, this.hideBall - simDt);
    if (this.drop && (this.drop.t += simDt) > this.drop.dur) this.drop = null;
    this.sound.crowd(A.excite, L.phase !== 'final' || A.excite > 0);

    // defender "pressing" nudge: up to 6 px toward the ball handler, never into his body
    const holder = L.ball.holder;
    for (const a of A.byEnt.values()) {
      let want = 0;
      if (holder && L.phase === 'live' && a.e.side !== holder.side) {
        const man = L.matchOf(a.e);
        if (man === holder || Math.hypot(holder.x - a.e.x, holder.y - a.e.y) < 6) {
          const ha = A.byEnt.get(holder);
          const gap = cam.sx(ha.x, ha.y) - cam.sx(a.x, a.y);
          if (Math.abs(holder.y - a.e.y) < 5 && Math.abs(gap) > 15) want = Math.sign(gap) * Math.min(6, Math.abs(gap) - 15);
        }
      }
      a.nudge = (a.nudge ?? 0) + (want - (a.nudge ?? 0)) * Math.min(1, realDt * 8);
      if (Math.abs(a.nudge) < 0.4 && want === 0) a.nudge = 0;
    }

    cam.zoom = 1; cam.view = this.zoom();
    // StreetBall: when the ball changes hands the camera swivels 180 degrees round the half court, so
    // the team with the ball always attacks the same way on screen (home: basket on the right).
    if (L.street) {
      const want = L.viewSide === 'away' ? Math.PI : 0;
      if (this.viewSide !== L.viewSide) { this.viewSide = L.viewSide; this.spin = { from: cam.rot, to: cam.rot + Math.PI, t: 0 }; }
      if (this.spin) {
        const sp = this.spin; sp.t = Math.min(1, sp.t + realDt / SPIN_SECS);
        const u = sp.t < 0.5 ? 2 * sp.t * sp.t : 1 - 2 * (1 - sp.t) * (1 - sp.t);     // ease in and out
        cam.rot = sp.from + (sp.to - sp.from) * u;
        if (sp.t >= 1) { this.spin = null; cam.rot = want; }
        cam.snap(this.camTarget());
      } else cam.rot = want;
      A.viewFlip = Math.cos(cam.rot) < 0;
    }
    cam.follow(this.camTarget(), realDt, L.ftLine ? 2.2 : 3.4);
    const drawCam = Object.create(cam); drawCam.x = Math.round(cam.x * 8.52) / 8.52;   // snap to whole pixels: no shimmer

    // ---- far side: crowd, boards, benches
    const crowdFrame = this.settings.crowd !== false && A.excite > 0.3 && Math.floor(this.realT * 7) % 2 === 1;
    this.arena.drawBackdrop(c, drawCam, crowdFrame);
    if (!L.street) this.drawBenches(c, drawCam);
    const refs = L.street ? [] : A.refs;      // StreetBall: no referees
    this.arena.drawCourt(c, drawCam);
    this.cam2 = drawCam; const camSave = this.cam; this.cam = drawCam;

    // StreetBall: after a defensive rebound the arc lights up until the ball is cleared past it
    if (L.street && L.mustClear && L.phase === 'live') this.clearArc(c, drawCam);

    // ---- shadows, floor markers
    const ball = this.ballView();
    const ctrl = L.user && L.ctrl ? A.byEnt.get(L.ctrl) : null;
    for (const a of A.byEnt.values()) { const [sx, sy] = drawCam.project(a.x, a.y, 0); drawShadow(c, sx + (a.nudge ?? 0), sy, a.zoff > 4 ? 13 : 17); }
    for (const r of refs) { const [sx, sy] = drawCam.project(r.x, r.y, 0); drawShadow(c, sx, sy, 15); }
    for (const g of A.ghosts) { const [sx, sy] = drawCam.project(g.x, g.y, 0); drawShadow(c, sx, sy, 15); }
    if (ball) drawShadow(c, ball.fx, ball.fy, ball.high > 6 ? 5 : 7);
    if (ctrl) {
      const [sx, sy] = this.actorScreen(ctrl), y0 = Math.round(drawCam.fy(ctrl.x, ctrl.y));
      c.fillStyle = '#ffe14a';
      c.fillRect(sx - 9, y0 - 3, 18, 1); c.fillRect(sx - 9, y0 + 3, 18, 1); c.fillRect(sx - 12, y0 - 2, 3, 1); c.fillRect(sx + 9, y0 - 2, 3, 1);
      c.fillRect(sx - 12, y0 + 2, 3, 1); c.fillRect(sx + 9, y0 + 2, 3, 1); c.fillRect(sx - 13, y0 - 1, 1, 3); c.fillRect(sx + 12, y0 - 1, 1, 3);
    }
    // 2v2: your teammate's player gets a smaller blue marker
    for (const k of L.ctls ?? []) {
      const U = L.uc[k];
      if (k === L.me || !U?.roles || U.side !== L.user || !U.ctrl) continue;
      const a = A.byEnt.get(U.ctrl);
      if (!a) continue;
      const [sx] = this.actorScreen(a), y0 = Math.round(drawCam.fy(a.x, a.y));
      c.fillStyle = '#5ac8ff';
      c.fillRect(sx - 7, y0 - 3, 14, 1); c.fillRect(sx - 7, y0 + 3, 14, 1); c.fillRect(sx - 9, y0 - 2, 2, 5); c.fillRect(sx + 7, y0 - 2, 2, 5);
    }
    if (L.passTarget) {
      const a = A.byEnt.get(L.passTarget), [sx] = this.actorScreen(a), y0 = Math.round(drawCam.fy(a.x, a.y));
      c.fillStyle = '#ffffff'; c.fillRect(sx - 7, y0 + 3, 14, 1); c.fillRect(sx - 9, y0 + 2, 2, 1); c.fillRect(sx + 7, y0 + 2, 2, 1);
    }
    // sprint dust
    for (const a of A.byEnt.values()) if (a.cur === 'sprint' || a.cur === 'dribble_sprint') { if (Math.random() < simDt * 9) this.dust.push({ x: a.x - (a.left ? -1 : 1) * 1.2, y: a.y, t: 0 }); }
    this.dust = this.dust.filter((d) => (d.t += simDt) < 0.35);
    for (const d of this.dust) { const [sx, sy] = drawCam.project(d.x, d.y, 0.2 + d.t * 2); c.fillStyle = `rgba(245,235,215,${0.5 - d.t})`; c.fillRect(Math.round(sx), Math.round(sy), 2, 1); }

    // faint reflections on the polished floor
    c.globalAlpha = 0.12;
    if (!L.street) for (const a of A.byEnt.values()) {
      if (!a.frame || a.y < 0.5 || a.y > 49.5) continue;
      const [sx, sy] = this.actorScreen(a), fy = Math.round(drawCam.fy(a.x, a.y));
      c.save(); c.translate(0, fy + 1 + (fy - sy) * 0.45); c.scale(1, -0.45); this.bank.draw(c, a.frame, sx, 0); c.restore();
    }
    c.globalAlpha = 1;

    // ---- y-sorted scene
    const items = [];
    for (const a of A.byEnt.values()) if (a.frame) items.push({ d: drawCam.rw(a.x, a.y)[1], a });
    for (const r of refs) if (r.frame) items.push({ d: r.y, a: r });
    for (const g of A.ghosts) items.push({ d: g.y, g });
    const sc = L.phase === 'live' || L.phase === 'inbound' ? String(Math.max(0, Math.ceil(L.state.shotClock))) : '';
    for (const right of L.street ? [true] : [false, true]) {      // StreetBall: one basket
      const k = right ? 'right' : 'left', o = { net: this.net[k], shake: this.shake[k] > 0 ? (Math.floor(this.realT * 30) % 2 ? 1 : -1) : 0, clock: sc };
      const hd = L.street ? drawCam.rw(88.75, 25)[1] : 25;
      items.push({ d: hd - 0.05, hoop: right, part: 'back', o }, { d: hd + 0.05, hoop: right, part: 'front', o });
    }
    if (ball) items.push({ d: ball.depth, ball });
    if (this.drop) items.push({ d: L.street ? drawCam.rw(this.drop.x, 25)[1] : 25, drop: this.drop });
    items.sort((p, q) => p.d - q.d);
    for (const it of items) {
      if (it.hoop !== undefined) this.arena.drawHoop(c, drawCam, it.hoop, { ...it.o, part: it.part });
      else if (it.ball) drawBall(c, it.ball.x, it.ball.y, it.ball.spin);
      else if (it.drop) { const [sx, sy] = drawCam.project(it.drop.x, it.drop.y, 9.4 - (it.drop.t / it.drop.dur) * 6); drawBall(c, sx, sy, 0); }
      else if (it.g) {
        const g = it.g, f = this.bank.frame(g.look, 'jog', g.t, g.left), [sx, sy] = drawCam.project(g.x, g.y, 0);
        this.bank.draw(c, f, sx, sy);
      } else {
        const a = it.a, [sx, sy] = this.actorScreen(a);
        this.bank.draw(c, a.frame, sx, sy);
        if (!a.ref && (A.fire.get(a.id) ?? 0) >= 3) this.hud.flame(c, sx + a.frame.head[0], sy + a.frame.head[1] - 7, this.realT);
      }
    }

    // ---- tags above players
    if (ctrl) {
      const [sx, sy] = this.actorScreen(ctrl);
      let top = this.hud.tag(c, ctrl, sx, sy, { ctrl: true });
      const VM = 'viewMeter' in L ? L.viewMeter : L.meter;   // online guest: its own clock
      if (VM && holder === L.ctrl) {
        const ct = VM.contest ?? L.contest(L.ctrl);
        this.hud.meter(c, sx, sy, ctrl, ct.color, VM);
        text(c, ct.name, sx, top - 5, { font: 'tiny', align: 'center', color: ct.color, shadow: '#000' });
        if ((VM.tough ?? 0) > 0.25) text(c, 'TOUGH ANGLE', sx, top - 12, { font: 'tiny', align: 'center', color: '#ff9a3a', shadow: '#000' });
        else if ((VM.deep ?? 1) < 0.8) text(c, 'DEEP', sx, top - 12, { font: 'tiny', align: 'center', color: '#ff9a3a', shadow: '#000' });
      } else if (holder === L.ctrl && ctrl.e.pivot && L.phase === 'live') {
        text(c, 'NO DRIBBLE: PASS OR SHOOT', sx, top - 5, { font: 'tiny', align: 'center', color: '#f3d35a', shadow: '#000' });
      }
    }
    // StreetBall: tell the ball handler to clear it
    if (L.street && L.mustClear && L.phase === 'live' && holder && holder.side === L.user) {
      const a = A.byEnt.get(holder), [sx, sy] = this.actorScreen(a);
      text(c, 'CLEAR IT PAST THE ARC', sx, sy + (a.frame ? a.frame.oy : -60) - 26, { font: 'tiny', align: 'center', color: '#5ac8ff', shadow: '#000' });
    }
    // free throw meter (user's team at the line)
    const FM = 'viewFtMeter' in L ? L.viewFtMeter : L.ftMeter;
    if (FM && L.ftLine) {
      const a = A.byEnt.get(L.ftLine.shooter), [sx, sy] = this.actorScreen(a);
      this.hud.meter(c, sx, sy, a, '#ffffff', FM);
      text(c, FM.active ? 'LET GO IN THE GREEN' : 'FREE THROW: HOLD SPACE', sx, sy + (a.frame ? a.frame.oy : -60) - 27, { font: 'tiny', align: 'center', color: '#f3d35a', shadow: '#000' });
    }
    // double team call: mark the trapping defender
    if (L.double) {
      const a = A.byEnt.get(L.double.e), [sx, sy] = this.actorScreen(a);
      text(c, 'DOUBLE', sx, sy + (a.frame ? a.frame.oy : -60) - 8, { font: 'tiny', align: 'center', color: '#f3d35a', shadow: '#000' });
    }
    // defending: show how well the CPU shooter is covered while he winds up
    if (L.user && L.windup && L.windup.e.side !== L.user) {
      const a = A.byEnt.get(L.windup.e), [sx, sy] = this.actorScreen(a), ct = L.contest(L.windup.e);
      text(c, ct.name, sx, sy + (a.frame ? a.frame.oy : -60) - 18, { font: 'tiny', align: 'center', color: ct.color, shadow: '#000' });
    }
    if (holder && (!ctrl || ctrl.e !== holder)) { const a = A.byEnt.get(holder), [sx, sy] = this.actorScreen(a); this.hud.tag(c, a, sx, sy); }
    // floating texts from the game (+2, Perfect, Steal! ...)
    for (const f of L.fx) {
      const [sx, sy] = drawCam.project(f.x, f.y, 7.5);
      const y = sy - Math.round(f.t * 16);
      text(c, f.text, clamp(sx, 30 + SW * (1 - 1 / cam.view) / 2, SW - 30 - SW * (1 - 1 / cam.view) / 2), clamp(y, 40, SH - 60), { align: 'center', color: f.color, shadow: '#000' });
    }
    this.cam = camSave;

    // ---- foreground + HUD
    this.arena.drawForeground(c, drawCam);
    c = this.present();
    if (!intro) this.hud.scoreBug(c);
    this.hud.banner(c);
    this.hud.popup(c);
    const st = L.phase === 'anim' && L.queue[0]?.started ? L.queue[0] : null;
    if (st?.k === 'timeout' && st.t > 0.5 && st.t < st.dur - 0.4) this.hud.statsCard(c, 'TIMEOUT');
    else if (L.phase === 'break' && L.phaseT > 0.3) this.hud.statsCard(c, L.state.period === 2 ? 'HALFTIME' : `END OF ${L.banner?.text?.replace(/^End of /, '') ?? 'PERIOD'}`.toUpperCase());
    if (this.settings.hints !== false && !intro && L.phase !== 'final') this.hud.controls(c);
    if (intro > 0) this.hud.intro(c, intro);
    if (this.settings.fps && fps) text(c, `${Math.round(fps)} FPS`, 4, 4, { font: 'tiny', color: fps > 55 ? '#4ade80' : fps > 40 ? '#f3d35a' : '#ff5a4a', shadow: '#000' });
  }

  /** The three-point line, highlighted and pulsing (where the ball has to go). */
  clearArc(c, cam) {
    const on = 0.55 + 0.45 * Math.sin(this.realT * 8);
    c.fillStyle = `rgba(90,200,255,${on.toFixed(2)})`;
    const dot = (x, y) => { const [sx, sy] = cam.project(x, y, 0); c.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1); };
    const hx = 88.75, a0 = Math.asin(22 / 23.75);
    for (let i = 0; i <= 160; i++) { const t = -a0 + 2 * a0 * (i / 160); dot(hx - Math.cos(t) * 23.75, 25 + Math.sin(t) * 23.75); }
    for (let x = 80; x <= 94; x += 0.35) { dot(x, 3); dot(x, 47); }
  }

  drawBenches(c, cam) {
    const L = this.L, A = this.actors, ar = this.arena;
    for (const side of ['home', 'away']) {
      const home = side === 'home', cheer = A.cheerT[side] > 0;
      for (const b of A.bench[side]) {
        const x = ar.backX(cam, home ? 8.6 + b.i * 3.03 : 85.4 - b.i * 3.03);
        if (x < -30 || x > SW + 30) continue;
        const up = cheer && (b.i * 7 + 3) % 5 < 3;
        const f = this.bank.frame(b.look, up ? 'stand_cheer' : 'sit', this.realT + b.i * 0.37, !home);
        this.bank.draw(c, f, x, BENCH_Y + (up ? 3 : 0));
      }
      const cx = ar.backX(cam, home ? 34.5 : 59.5);
      if (cx > -30 && cx < SW + 30) this.bank.draw(c, this.bank.frame(A.coach[side], cheer ? 'clap' : 'idle', this.realT, !home), cx, BENCH_Y + 6);
    }
  }
}
