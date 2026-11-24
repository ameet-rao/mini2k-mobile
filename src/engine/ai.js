// AI for the real-time layer (pure): ball-handler decisions, off-ball movement, man defense.
// Difficulty is tuned HERE (and in rules.js), never by changing player ratings.

import { distE, shotZone, segPoint } from './court.js';
import { chooseShotType } from './model.js';

export const DIFFICULTY = {
  //            CPU shot +/-   CPU defender reaction (s)  CPU def speed   CPU steal rate   user green / orange window   user passes picked off
  // Rookie and Pro greens are 10% bigger than before (AR, 2026-11-19); All-Star unchanged.
  // Super Easy: the original (pre-2K) green window size, `classicGreen`, with Rookie's CPU.
  easy:    { aiShotMod: -0.05, aiReact: 0.30, aiDefSpeed: 0.90, aiSteal: 0.6, greenScale: 1.65, orangeScale: 1.5, userIcpt: 0.7, classicGreen: true, layupGreen: 1.5 },
  rookie:  { aiShotMod: -0.05, aiReact: 0.30, aiDefSpeed: 0.90, aiSteal: 0.6, greenScale: 1.65, orangeScale: 1.5, userIcpt: 0.7, layupGreen: 1.5 },
  pro:     { aiShotMod: 0.00, aiReact: 0.20, aiDefSpeed: 0.96, aiSteal: 1.0, greenScale: 1.1, orangeScale: 1.0, userIcpt: 1.0, layupGreen: 1.5 },
  allstar: { aiShotMod: 0.02, aiReact: 0.13, aiDefSpeed: 1.00, aiSteal: 1.25, greenScale: 0.8, orangeScale: 0.8, userIcpt: 1.2 },
};

// Offensive spots, normalized so the offense attacks the RIGHT hoop (88.75, 25).
export const SPOTS = {
  top: [63, 25], wingA: [70.5, 8], wingB: [70.5, 42], cornerA: [88.5, 2.8], cornerB: [88.5, 47.2],
  slotA: [66, 14], slotB: [66, 36], high: [74, 25], elbowA: [75.5, 18], elbowB: [75.5, 32],
  lowA: [83.5, 17], lowB: [83.5, 33], dunkA: [87, 19.5], dunkB: [87, 30.5],
};
const PERIM = ['top', 'wingA', 'wingB', 'cornerA', 'cornerB', 'slotA', 'slotB'];
const BIG = ['lowA', 'lowB', 'high', 'elbowA', 'elbowB', 'dunkA', 'dunkB'];

const isStretch = (L, e) => L.p(e.id).tendencies.three_rate >= 0.3;

export function defaultSpot(L, e) {
  switch (e.role) {
    case 0: return 'top';
    case 1: return 'wingA';
    case 2: return 'wingB';
    case 3: return isStretch(L, e) ? 'cornerB' : 'elbowB';
    default: return isStretch(L, e) && L.rng.chance(0.3) ? 'cornerA' : 'lowA';
  }
}

export function pickSpot(L, e) {
  const rng = L.rng;
  const big = e.role >= 3 && !isStretch(L, e);
  const names = big ? BIG : e.role >= 3 ? [...PERIM, 'high', 'elbowA', 'elbowB'] : PERIM;
  const mates = L.ents[e.side].filter((m) => m !== e);
  const holder = L.ball.holder;
  const free = names.filter((n) => {
    const [x, y] = SPOTS[n];
    if (mates.some((m) => m.spot && Math.hypot(SPOTS[m.spot][0] - x, SPOTS[m.spot][1] - y) < 9)) return false;
    if (holder && holder.side === e.side && holder !== e) {
      const h = L.N(e.side, x, y);
      if (Math.hypot(h.x - holder.x, h.y - holder.y) < 8) return false;
    }
    return true;
  });
  e.spot = free.length ? rng.pick(free) : e.spot ?? defaultSpot(L, e);
  e.spotT = rng.range(3.5, 7.5);
  if (!big && L.crossed && rng.chance(0.15)) e.cut = 1.3;
  // Pick and roll: a big comes up to screen the ball handler's defender, then rolls to the rim.
  if (e.role >= 3 && !L.isHuman(e.side) && L.crossed && holder && holder.side === e.side && holder !== e && holder.role <= 2
    && L.plan && L.plan.mode !== 'drive' && !mates.some((m) => m.screen > 0 || m.roll)) {
    const hd = distE(holder, L.hoopOf(e.side));
    if (hd > 17 && hd < 33 && rng.chance(TUNE.pickRoll)) {
      e.screen = TUNE.screenTime; e.screenSide = rng.chance(0.5) ? 1 : -1; e.screenSet = 0; e.screenUsed = false;
    }
  }
}

/**
 * Chance the screener pops out for a three instead of rolling: from his three-point rating and how
 * often he shoots threes (his tendency). Non-shooting bigs almost always roll; stretch bigs pop about a
 * third of the time. Rolled again on every pick, so it changes from play to play.
 */
export function popChance(L, e) {
  const P = L.p(e.id), t3 = P.attrs.three_pt, rate = P.tendencies?.three_rate ?? 0;
  return Math.max(0.02, Math.min(0.6, 0.02 + 0.9 * rate * Math.max(0, Math.min(1.2, (t3 - 50) / 40))));
}

/** Where a screener stands: beside the on-ball defender, square to the handler's path to the hoop. */
function screenPoint(L, e, holder) {
  const d = L.matchOf(holder), hoop = L.hoopOf(e.side);
  let dx = hoop.x - holder.x, dy = hoop.y - holder.y;
  const n = Math.hypot(dx, dy) || 1;
  dx /= n; dy /= n;
  return { x: d.x - dy * 3.1 * e.screenSide - dx * 0.6, y: d.y + dx * 3.1 * e.screenSide - dy * 0.6 };
}

/** Where an off-ball offensive player wants to be. */
export function offBallTarget(L, e, dt) {
  e.spotT -= dt;
  if (!e.spot) { e.spot = defaultSpot(L, e); e.spotT = L.rng.range(3, 7); }
  const holder = L.ball.holder;
  if (e.spotT <= 0) pickSpot(L, e);
  else if (holder && holder.side === e.side && holder !== e) {
    // Make room if the ball handler dribbles into my spot.
    const t = L.N(e.side, ...SPOTS[e.spot]);
    if (Math.hypot(t.x - holder.x, t.y - holder.y) < 6.5 && e.spotT < 100) pickSpot(L, e);
  }
  if (e.screen > 0) {
    if (!holder || holder.side !== e.side || holder === e || (L.plan?.mode === 'drive' && e.screenSet > 0.5 && !e.called)) e.screen = 0.001;
    e.screen -= dt;
    if (e.screen <= 0) {
      e.screen = 0; e.called = false;
      if (L.rng.chance(popChance(L, e))) {
        // pick and pop: a big who can shoot flares out to the nearest spot behind the arc
        let best = null, bd = 1e9;
        for (const k of ['wingA', 'wingB', 'top', 'slotA', 'slotB']) {
          const t = L.N(e.side, ...SPOTS[k]), d = Math.hypot(t.x - e.x, t.y - e.y);
          if (d < bd) { bd = d; best = k; }
        }
        e.spot = best; e.spotT = 4; e.roll = false; e.cut = 0; e.popT = L.time;
      } else { e.cut = 1.7; e.roll = true; e.spotT = Math.max(e.spotT, 2.5); }
    }
    else {
      const t = screenPoint(L, e, holder);
      const dd = Math.hypot(t.x - e.x, t.y - e.y);
      if (dd < 2.2) e.screenSet += dt;
      return { tx: t.x, ty: t.y, sprint: dd > 9 };
    }
  }
  if (e.cut > 0) {
    e.cut -= dt;
    if (e.cut <= 0) e.roll = false;
    const t = L.N(e.side, 85, 25 + (e.role % 2 ? 4 : -4));
    return { tx: t.x, ty: t.y, sprint: true };
  }
  const t = L.N(e.side, ...SPOTS[e.spot]);
  return { tx: t.x, ty: t.y, sprint: Math.hypot(t.x - e.x, t.y - e.y) > 22 };
}

/** Man-to-man: stay between your man and the hoop; sag and shade to the ball when off it. */
export function defendTarget(L, d, dt) {
  const man = L.matchOf(d);
  const hoop = L.hoopOf(man.side);
  const ballEnt = L.ballEnt();
  const react = L.isHuman(d.side) || !L.humans.length ? 0.2 : L.diff.aiReact;
  const k = 1 - Math.exp(-dt / react);
  d.trkx += (man.x - d.trkx) * k;
  d.trky += (man.y - d.trky) * k;
  let mx = d.trkx, my = d.trky;
  if (man !== ballEnt && Math.hypot(hoop.x - mx, hoop.y - my) > 31) {
    // My man is still coming up the floor: get back and wait where he is headed.
    const sp = L.spotOf(man);
    mx = sp.x; my = sp.y;
  }
  let hx = hoop.x - mx, hy = hoop.y - my;
  const hd = Math.hypot(hx, hy) || 1;
  hx /= hd; hy /= hd;
  let tx, ty;
  if (L.double && L.double.e === d && ballEnt && ballEnt.side !== d.side) {
    // Double team (user call): leave my man and trap the ball.
    const ux = d.x - ballEnt.x, uy = d.y - ballEnt.y, n = Math.hypot(ux, uy) || 1;
    return { tx: ballEnt.x + ux / n * 2.5, ty: ballEnt.y + uy / n * 2.5, sprint: n > 5 };
  }
  if (L.helper === d && ballEnt) {
    const ux = ballEnt.x - hoop.x, uy = ballEnt.y - hoop.y;
    const n = Math.hypot(ux, uy) || 1;
    tx = hoop.x + ux / n * 4; ty = hoop.y + uy / n * 4;
  } else if (man === ballEnt) {
    const gap = hd < 10 ? 2.4 : 3.4;
    tx = mx + hx * gap; ty = my + hy * gap;
  } else {
    const sag = Math.min(hd * 0.3, 7);
    tx = mx + hx * sag; ty = my + hy * sag;
    if (ballEnt) { tx += (ballEnt.x - tx) * 0.12; ty += (ballEnt.y - ty) * 0.12; }
  }
  // Don't chase past the pick-up point: wait around the three-point line.
  const td = Math.hypot(tx - hoop.x, ty - hoop.y);
  if (td > 28) { tx = hoop.x + (tx - hoop.x) / td * 28; ty = hoop.y + (ty - hoop.y) / td * 28; }
  return { tx, ty, sprint: Math.hypot(tx - d.x, ty - d.y) > 9 };
}

/** Help defender: when the ball handler has beaten his man near the paint, the closest other defender steps up. */
export function pickHelper(L, holder) {
  if (!holder) return null;
  const hoop = L.hoopOf(holder.side);
  const hd = distE(holder, hoop);
  if (hd > 15) return null;
  const onBall = L.matchOf(holder);
  if (distE(onBall, hoop) < hd - 0.5 && distE(onBall, holder) < 5) return null; // still in front
  let best = null, bd = 1e9;
  for (const d of L.ents[onBall.side]) {
    if (d === onBall || L.isCtrl(d)) continue;
    const dd = distE(d, hoop);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

export function newPlan(L, h, { caught = false } = {}) {
  const rng = L.rng;
  return {
    t: 0, setT: 0, mode: 'set', goal: 'rim', caught, think: rng.range(0.15, 0.45),
    patience: caught ? rng.range(0.3, 1.6) : rng.range(TUNE.patience[0], TUNE.patience[1]),
    driveT: 0, stall: 0, side: rng.chance(0.5) ? 1 : -1, passCd: caught ? 0.7 : 0.3,
  };
}

// CPU offense knobs (pace and shot mix of the real-time game).
export const TUNE = {
  patience: [3.5, 9.5],   // seconds a ball handler probes before forcing the action
  actRate: 0.24,          // chance per read (every 0.3s) that an average-usage player goes for his shot
  passRate: 0.36,         // chance per read that he swings the ball instead
  catchShoot: 0.75,       // open catch-and-shoot three, scaled by the shooter's three_rate
  // Wide-open rule: a player left alone in his range for `openRead` seconds lets it fly.
  // Real catch-to-release is about 0.7-0.9s: a read/set beat, then a 0.4s (elite guard) to
  // 0.6s (average) release. Guards read fastest, bigs slowest.
  openDist: 6.0,          // feet to the nearest defender to count as wide open
  closingSpeed: 7.0,      // ft/s: a defender flying at him within 10 ft means he is NOT wide open yet
  openRead: { G: 0.35, W: 0.45, B: 0.6 },
  release: { base: 0.60, perAttr: 0.004, min: 0.40, max: 0.68, big: 0.04, rim: 0.28 },
  contestedThree: 0.25,
  pickRoll: 0.13,         // chance a big comes up to screen when he picks his next spot
  screenTime: 3.0,        // seconds he holds the screen before rolling   // takes the three anyway with a hand in his face
};

export function bestPass(L, h) {
  let best = null;
  const hoop = L.hoopOf(h.side);
  for (const m of L.ents[h.side]) {
    if (m === h) continue;
    if (L.crossed && !L.isFront(h.side, m.x, 1)) continue;
    const d = distE(h, m);
    if (d < 6 || d > 45) continue;
    if (!L.passLaneOpen(h, m, 2.8)) continue;
    const open = Math.min(8, L.nearestDef(m).d);
    const P = L.p(m.id);
    let sc = open / 8 + 0.55 * P.tendencies.usage_per36 / L.data.league.tend.usage_per36 + L.rng.range(0, 0.45);
    if (distE(m, hoop) < 8 && open > 3) sc += 0.6;
    if (!best || sc > best.sc) best = { e: m, sc };
  }
  return best;
}

const GROUP = { PG: 'G', SG: 'G', SF: 'W', PF: 'B', C: 'B' };

/** Nobody within openDist, and nobody sprinting at him from just outside it. */
export function wideOpen(L, h, nd = L.nearestDef(h)) {
  if (!nd.e) return true;
  if (nd.d < TUNE.openDist) return false;
  if (nd.d < 10) {
    const ux = (h.x - nd.e.x) / nd.d, uy = (h.y - nd.e.y) / nd.d;
    if (nd.e.vx * ux + nd.e.vy * uy > TUNE.closingSpeed) return false;
  }
  return true;
}

/** Seconds a wide-open player takes to read it before starting his shot. */
export function openRead(L, h) {
  const P = L.p(h.id);
  const base = TUNE.openRead[GROUP[P.pos] ?? 'W'];
  return base * (1.15 - 0.3 * Math.min(1, P.tendencies.three_rate / 0.6));
}

/** Seconds from starting the shot to the ball leaving the hand. */
export function releaseTime(L, h, type) {
  const R = TUNE.release, P = L.p(h.id);
  if (type === 'rim') return R.rim;
  const attr = type === 'three' ? P.attrs.three_pt : P.attrs.mid_range;
  let t = R.base - R.perAttr * (attr - 50);
  if (GROUP[P.pos] === 'B') t += R.big;
  return Math.max(R.min, Math.min(R.max, t));
}

function startDrive(plan, goal, rng) {
  plan.mode = 'drive'; plan.goal = goal; plan.driveT = 0; plan.stall = 0;
  plan.side = rng.chance(0.5) ? 1 : -1;
}

/**
 * CPU ball handler. Returns { tx, ty, sprint, shoot, pass }.
 * Probes for `patience` seconds, then goes for the kind of shot his ratings say he takes
 * (three / drive to the rim / mid-range pull-up, same tendency model as the headless sim),
 * or swings the ball. The shot clock forces the issue.
 */
export function handlerThink(L, h, dt) {
  const s = L.game.state, rng = L.rng, P = L.p(h.id);
  const plan = L.plan;
  plan.t += dt; plan.passCd -= dt;
  const hoop = L.hoopOf(h.side);
  const dHoop = distE(h, hoop);
  const sc = Math.min(s.shotClock, s.clock);
  const zone = shotZone(h.x, h.y, hoop);
  const nd = L.nearestDef(h);
  const out = { tx: h.x, ty: h.y, sprint: false, shoot: false, pass: null };
  const inFront = dHoop < 36;
  if (inFront) plan.setT += dt;

  if (sc < 1.5) { out.shoot = true; return out; } // beat the buzzer with anything

  // Trapped by a double team: find the open man before they take it away.
  if (L.double && nd.d < 5.5 && distE(L.double.e, h) < 5.5) {
    plan.dblT = (plan.dblT ?? 0) + dt;
    if (plan.dblT > 0.45 && plan.passCd <= 0) {
      const k = bestPass(L, h);
      if (k) { out.pass = k.e; return out; }
    }
  }

  // Open floor in transition, or a clear lane once the defense has been moved: attack.
  if (plan.mode !== 'drive' && dHoop > 7 && dHoop < 50
    && ((L.transition && L.possT < 7) || plan.setT > plan.patience) && L.laneClear(h, hoop)) {
    startDrive(plan, 'rim', rng);
  }

  if (plan.mode === 'drive') {
    plan.driveT += dt;
    if (dHoop < 5.5 || (dHoop < 7 && nd.d > 3)) { out.shoot = true; return out; }
    if (plan.goal === 'mid' && dHoop < 17 && dHoop > 8 && (plan.driveT > 0.35 || zone.type === 'mid')) { out.shoot = true; return out; }
    const ax = hoop.x + (hoop.x > 47 ? -1.5 : 1.5);
    let dx = ax - h.x, dy = hoop.y - h.y;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
    if (nd.e && nd.d < 4.5 && (nd.e.x - h.x) * dx + (nd.e.y - h.y) * dy > 0) {
      // Defender in front: slide past on the chosen side.
      const px = -dy * plan.side, py = dx * plan.side;
      dx = dx * 0.55 + px * 0.85; dy = dy * 0.55 + py * 0.85;
    }
    out.tx = h.x + dx * 10; out.ty = h.y + dy * 10; out.sprint = true;
    const sp = Math.hypot(h.vx, h.vy);
    plan.stall = plan.driveT > 0.5 && sp < 5 ? plan.stall + dt : Math.max(0, plan.stall - dt);
    if (plan.stall > 0.4 || plan.driveT > 3.2 || sc < 3) {
      // Walled off: floater / pull-up, kick it out, or pull it back out.
      const r = rng.next();
      if (sc < 3 && zone.dist < 30) { out.shoot = true; return out; }
      if (dHoop < 10 && r < 0.5) { out.shoot = true; return out; }
      if (dHoop >= 10 && dHoop < 18 && r < 0.3) { out.shoot = true; return out; }
      const kick = plan.passCd <= 0 ? bestPass(L, h) : null;
      if (kick) { out.pass = kick.e; return out; }
      if (sc >= 3) { plan.mode = 'set'; plan.think = 0.4; plan.driveT = 0; plan.stall = 0; }
    }
    return out;
  }

  // Pick and roll: once the screen is set, come off it on the screener's side.
  const scr = L.ents[h.side].find((m) => m.screen > 0 && m.screenSet > 0.35);
  if (scr && inFront && sc > 4 && !scr.screenUsed) {
    scr.screenUsed = true;
    if (plan.setT < plan.patience * 0.6 || !rng.chance(0.7)) return out;
    const want = rng.chance(P.attrs.mid_range > P.attrs.finishing ? 0.5 : 0.25) ? 'mid' : 'rim';
    startDrive(plan, want, rng);
    const dx = hoop.x - h.x, dy = hoop.y - h.y;
    plan.side = (-dy * (scr.x - h.x) + dx * (scr.y - h.y)) >= 0 ? 1 : -1;
    plan.pnr = true;
    return out;
  }

  // Set offense: walk it up to my spot, then read the floor.
  const spot = L.spotOf(h);
  out.tx = spot.x; out.ty = spot.y;
  if (!inFront) return out;

  if (plan.caught && !plan.csDone) {
    plan.csDone = true;
    if (zone.type === 'rim') { out.shoot = true; return out; }
    // Decide once per catch whether this is a shot he wants if he stays open.
    plan.wantsOpen = rng.chance(Math.min(0.92, TUNE.catchShoot * P.tendencies.three_rate / 0.4));
  }
  // Wide open in his range for long enough -> shoot. No snap pull-ups: the clock restarts whenever
  // a defender is near or closing hard, so he has to be genuinely left alone.
  const inRange = (zone.type === 'three' && zone.dist < 27 && P.attrs.three_pt >= 55)
    || (zone.type === 'mid' && P.attrs.mid_range >= 62);
  if (inRange && wideOpen(L, h, nd)) plan.openT = (plan.openT ?? 0) + dt; else plan.openT = 0;
  if (plan.openT >= openRead(L, h) && (plan.wantsOpen || plan.setT > plan.patience || sc < 8)) { out.shoot = true; return out; }
  plan.think -= dt;
  if (plan.think > 0) return out;
  plan.think = 0.3;
  const pressure = sc < 6;
  if (!pressure && plan.setT < plan.patience) return out;

  const usage = P.tendencies.usage_per36 / L.data.league.tend.usage_per36;
  const pAct = pressure ? 1 : Math.max(0.08, Math.min(0.5, TUNE.actRate * Math.pow(usage, 0.75)));
  const r = rng.next();
  if (r < pAct) {
    const want = chooseShotType(P, rng, { defender: nd.e ? L.p(nd.e.id) : null, league: L.data.league });
    if (want === 'three') {
      if (zone.type === 'three' && zone.dist < 28) {
        if (nd.d > 2.6 || sc < 4 || rng.chance(TUNE.contestedThree)) { out.shoot = true; return out; }
        startDrive(plan, 'rim', rng);
      } else if (zone.type !== 'three' && zone.dist < 17) { out.shoot = true; return out; } // inside the arc: take what's there
      else startDrive(plan, 'mid', rng);
    } else if (want === 'mid') {
      if (zone.type === 'mid' && zone.dist < 18) { out.shoot = true; return out; }
      startDrive(plan, 'mid', rng);
    } else startDrive(plan, 'rim', rng);
    return out;
  }
  if (r < pAct + TUNE.passRate && plan.passCd <= 0) {
    const k = bestPass(L, h);
    if (k) { out.pass = k.e; return out; }
  }
  return out;
}

export { segPoint };
