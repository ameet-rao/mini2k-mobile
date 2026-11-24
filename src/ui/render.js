// Canvas 2D renderer for the real-time game. Reads state from a LiveGame, never mutates it.
// Placeholder art only: colored circles with jersey numbers (portraits/court art come in M6).

import { COURT } from '../engine/court.js';
import { fmtClock, periodName } from '../engine/pbp.js';

export const VIEW = { W: 1200, H: 804, S: 12, OX: 36, OY: 108, HUD: 72, FOOT: 60 };
const { S, OX, OY } = VIEW;
const X = (ft) => OX + ft * S;
const Y = (ft) => OY + ft * S;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Jersey palettes: home wears its primary color, away wears white with its primary as trim. */
export function kits(live) {
  const t = live.state.teams;
  const hc = t.home.colors, ac = t.away.colors;
  const homeText = lum(hc[0]) > 0.6 ? '#111' : '#fff';
  return {
    home: { fill: hc[0], text: homeText, trim: lum(hc[1]) > 0.9 || hc[1] === hc[0] ? '#ffffff' : hc[1] },
    away: { fill: '#f5f5f2', text: lum(ac[0]) > 0.75 ? ac[1] : ac[0], trim: lum(ac[0]) > 0.75 ? ac[1] : ac[0] },
  };
}

let courtCache = null, courtKey = '';

function drawCourtBase(ctx, live) {
  const home = live.state.teams.home;
  const c0 = home.colors[0];
  // arena floor / apron
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, VIEW.W, VIEW.H);
  ctx.fillStyle = shade(c0, 0.55);
  ctx.fillRect(0, VIEW.HUD, VIEW.W, VIEW.H - VIEW.HUD - VIEW.FOOT);
  // hardwood
  const g = ctx.createLinearGradient(0, Y(0), 0, Y(50));
  g.addColorStop(0, '#d9ad72'); g.addColorStop(0.5, '#cfa066'); g.addColorStop(1, '#c8975c');
  ctx.fillStyle = g;
  ctx.fillRect(X(0), Y(0), 94 * S, 50 * S);
  ctx.strokeStyle = 'rgba(90,55,20,0.10)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= 50; y += 1.25) { ctx.beginPath(); ctx.moveTo(X(0), Y(y) + 0.5); ctx.lineTo(X(94), Y(y) + 0.5); ctx.stroke(); }
  for (let x = 0, i = 0; x <= 94; x += 4, i++) {
    ctx.beginPath(); ctx.moveTo(X(x) + 0.5, Y(0)); ctx.lineTo(X(x) + 0.5, Y(50)); ctx.strokeStyle = 'rgba(90,55,20,0.05)'; ctx.stroke();
  }

  // painted areas
  ctx.fillStyle = c0; ctx.globalAlpha = 0.85;
  ctx.fillRect(X(0), Y(17), 19 * S, 16 * S);
  ctx.fillRect(X(75), Y(17), 19 * S, 16 * S);
  ctx.globalAlpha = 1;

  // center logo
  ctx.save();
  ctx.beginPath(); ctx.arc(X(47), Y(25), 6 * S, 0, Math.PI * 2); ctx.fillStyle = shade(c0, 0.95); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = lum(c0) > 0.6 ? '#111' : '#fff';
  ctx.font = `800 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(home.id, X(47), Y(25) + 2);
  ctx.restore();

  // lines
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.strokeRect(X(0), Y(0), 94 * S, 50 * S);
  ctx.beginPath(); ctx.moveTo(X(47), Y(0)); ctx.lineTo(X(47), Y(50)); ctx.stroke();
  ctx.beginPath(); ctx.arc(X(47), Y(25), 6 * S, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(X(47), Y(25), 2 * S, 0, Math.PI * 2); ctx.stroke();
  for (const right of [false, true]) {
    const sx = (ft) => X(right ? 94 - ft : ft);
    const hx = sx(COURT.HOOP);
    // paint + free-throw circle
    ctx.strokeRect(Math.min(sx(0), sx(19)), Y(17), 19 * S, 16 * S);
    ctx.beginPath(); ctx.arc(sx(19), Y(25), 6 * S, 0, Math.PI * 2); ctx.stroke();
    // lane hash marks
    for (const ft of [7, 8, 11, 14]) for (const y of [17, 33]) {
      ctx.beginPath(); ctx.moveTo(sx(ft), Y(y)); ctx.lineTo(sx(ft), Y(y + (y === 17 ? -0.7 : 0.7))); ctx.stroke();
    }
    // three-point line: corners + arc
    const a = Math.atan2(22, COURT.CORNER_X - COURT.HOOP);
    ctx.beginPath();
    ctx.moveTo(sx(0), Y(3)); ctx.lineTo(sx(COURT.CORNER_X), Y(3));
    if (right) ctx.arc(hx, Y(25), COURT.THREE_R * S, Math.PI + a, Math.PI - a, true);
    else ctx.arc(hx, Y(25), COURT.THREE_R * S, -a, a, false);
    ctx.lineTo(sx(0), Y(47));
    ctx.stroke();
    // restricted area
    ctx.beginPath();
    if (right) ctx.arc(hx, Y(25), 4 * S, Math.PI / 2, Math.PI * 1.5, false);
    else ctx.arc(hx, Y(25), 4 * S, -Math.PI / 2, Math.PI / 2, false);
    ctx.stroke();
    // backboard + rim
    ctx.save();
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx(4), Y(22)); ctx.lineTo(sx(4), Y(28)); ctx.stroke();
    ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(hx, Y(25), 0.85 * S, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function courtLayer(live) {
  const key = `${live.state.teams.home.id}`;
  if (!courtCache || courtKey !== key) {
    courtCache = document.createElement('canvas');
    courtCache.width = VIEW.W; courtCache.height = VIEW.H;
    drawCourtBase(courtCache.getContext('2d'), live);
    courtKey = key;
  }
  return courtCache;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawPlayer(ctx, live, e, kit, opts) {
  const p = live.p(e.id);
  const pr = live.pred?.e === e ? live.pred : e;   // online guest: its own player where it predicts him
  const x = X(pr.x), y = Y(pr.y), r = 15;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 5, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  // facing nub
  ctx.fillStyle = kit.trim;
  ctx.beginPath(); ctx.arc(x + e.fx * r * 0.85, y + e.fy * r * 0.85, 4.5, 0, Math.PI * 2); ctx.fill();
  // body
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = kit.fill; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = kit.trim; ctx.stroke();
  if (e.stun > 0) { ctx.strokeStyle = 'rgba(255,80,80,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
  if (e.handsUp) { ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 5, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke(); }
  // number
  const num = p.number ?? '';
  ctx.fillStyle = kit.text;
  ctx.font = `800 ${String(num).length > 1 ? 14 : 16}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(num), x, y + 1);

  if (opts.ctrl) {
    const pulse = 2 + Math.sin(live.time * 6) * 1.2;
    ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r + 4 + pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath(); ctx.moveTo(x, y - r - 9); ctx.lineTo(x - 7, y - r - 20); ctx.lineTo(x + 7, y - r - 20); ctx.closePath(); ctx.fill();
  }
  if (opts.passTarget) {
    ctx.save();
    ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    label(ctx, 'E', x + r + 6, y - r - 4, '#111', '#fff');
  }
  if (opts.name) {
    const last = p.last ?? p.name;
    ctx.font = `600 12px ${FONT}`;
    const w = ctx.measureText(last).width + 10;
    ctx.fillStyle = 'rgba(10,12,16,0.72)';
    roundRect(ctx, x - w / 2, y + r + 5, w, 17, 4); ctx.fill();
    ctx.fillStyle = opts.ctrl ? '#ffe14a' : '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(last, x, y + r + 14);
    if (opts.ctrl) {
      // stamina
      const en = live.energy(e);
      ctx.fillStyle = 'rgba(10,12,16,0.72)'; ctx.fillRect(x - 18, y + r + 24, 36, 4);
      ctx.fillStyle = en > 0.5 ? '#39e06a' : en > 0.25 ? '#ffb347' : '#ff5a5a';
      ctx.fillRect(x - 18, y + r + 24, 36 * en, 4);
    }
  }
}

function label(ctx, text, x, y, fg, bg) {
  ctx.font = `800 11px ${FONT}`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = bg; roundRect(ctx, x - w / 2, y - 8, w, 16, 4); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

function drawBall(ctx, live) {
  const b = live.ball;
  const x = X(b.x), y = Y(b.y);
  const r = 6 + b.z * 0.3;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + b.z * 0.5, y + 4, 6, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  const by = y - b.z * 2.1;
  ctx.beginPath(); ctx.arc(x, by, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e8721c'; ctx.fill();
  ctx.strokeStyle = '#5a2a08'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - r, by); ctx.lineTo(x + r, by); ctx.stroke();
}

function drawMeter(ctx, live) {
  const m = live.meter, h = live.ball.holder;
  if (!m || !h) return;
  // Draw the meter on the side away from the hoop so it does not cover the defender.
  const x = X(h.x) + (live.dirRight(h.side) ? -40 : 28), y = Y(h.y) - 34, w = 12, hgt = 68;
  const hasGreen = (m.green ?? 0) > 0;
  const hasOrange = (m.orange ?? 0) > 0;
  const g0 = hasGreen ? m.greenStart : 1.05;
  const o0 = hasOrange ? m.orangeStart : g0;
  const yOf = (rel) => y + hgt - clamp(rel, 0, 1.0) * hgt;

  // Background
  ctx.fillStyle = 'rgba(10,12,16,0.9)'; roundRect(ctx, x - 3, y - 3, w + 6, hgt + 6, 5); ctx.fill();
  ctx.fillStyle = '#161b26'; ctx.fillRect(x, y, w, hgt);

  // Orange bar (height directly reflects m.orange)
  if (hasOrange && g0 > o0) {
    const yTop = yOf(Math.min(1.0, g0));
    const yBot = yOf(o0);
    ctx.fillStyle = '#ff9a3a';
    ctx.fillRect(x, yTop, w, Math.max(2, yBot - yTop));
  }

  // Green bar at the top (height directly reflects m.green)
  if (hasGreen) {
    const hG = Math.max(3, Math.round(m.green * hgt));
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x, y, w, hG);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 2, y, w + 4, 2);
  } else {
    // Grayed out line when no green bar
    ctx.fillStyle = '#64748b';
    ctx.fillRect(x - 2, y, w + 4, 2);
  }

  // Current fill
  const rel = m.t / m.dur;
  if (rel > (hasGreen ? (m.greenEnd ?? 1.01) : 1.0)) {
    // Overshot: red flash
    ctx.fillStyle = '#ff4a3a';
    ctx.fillRect(x, y, w, hgt);
    ctx.fillRect(x - 3, y - 4, w + 6, 4);
  } else {
    const yRel = yOf(rel);
    const fillCol = (hasGreen && rel >= g0) ? '#4ade80' : (hasOrange && rel >= o0) ? '#ffd54f' : '#e2e8f0';
    ctx.fillStyle = fillCol;
    ctx.fillRect(x + 3, yRel, w - 6, y + hgt - yRel);
    ctx.fillStyle = (hasGreen && rel >= g0) ? '#ffffff' : (hasOrange && rel >= o0) ? '#ffffff' : '#ffd84a';
    ctx.fillRect(x - 3, yRel - 2, w + 6, 4);
  }
}

function drawHud(ctx, live) {
  const s = live.state, t = s.teams, rules = live.game.rules;
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, VIEW.W, VIEW.HUD);
  const limit = s.period > rules.periods ? rules.bonusAtOT : rules.bonusAt;
  const block = (side, x, align) => {
    const tm = t[side];
    const w = 330;
    const x0 = align === 'left' ? x : x - w;
    ctx.fillStyle = tm.colors[0]; roundRect(ctx, x0, 10, w, 52, 8); ctx.fill();
    ctx.fillStyle = lum(tm.colors[0]) > 0.6 ? '#111' : '#fff';
    ctx.font = `800 26px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.textAlign = align === 'left' ? 'left' : 'right';
    ctx.fillText(tm.id, align === 'left' ? x0 + 16 : x0 + w - 16, 30);
    ctx.font = `600 11px ${FONT}`;
    const you = live.user === side ? 'YOU  ·  ' : '';
    const bonus = t[side === 'home' ? 'away' : 'home'].teamFouls >= limit ? '  ·  BONUS' : '';
    ctx.globalAlpha = 0.85;
    ctx.fillText(`${you}FOULS ${tm.teamFouls}${bonus}`, align === 'left' ? x0 + 16 : x0 + w - 16, 51);
    ctx.globalAlpha = 1;
    ctx.font = `800 40px ${FONT}`;
    ctx.textAlign = align === 'left' ? 'right' : 'left';
    ctx.fillText(String(s.score[side]), align === 'left' ? x0 + w - 18 : x0 + 18, 38);
    if (s.possession === side && live.phase !== 'final') {
      ctx.fillStyle = '#ffe14a';
      const px = align === 'left' ? x0 + w + 12 : x0 - 12;
      ctx.beginPath(); ctx.arc(px, 36, 5, 0, Math.PI * 2); ctx.fill();
    }
  };
  block('away', 36, 'left');
  block('home', VIEW.W - 36, 'right');

  // clock
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 14px ${FONT}`;
  ctx.fillStyle = '#9aa4b2';
  ctx.fillText(live.phase === 'final' ? 'FINAL' : periodName(Math.max(1, s.period), rules.periods), VIEW.W / 2 - 62, 26);
  ctx.fillStyle = '#fff'; ctx.font = `800 30px ${FONT}`;
  ctx.fillText(fmtClock(live.dispClock ?? s.clock), VIEW.W / 2 - 62, 49);
  const scOn = s.shotClock < s.clock && live.phase !== 'final';
  const sc = Math.max(0, Math.ceil(s.shotClock - (live.phase === 'live' ? live.acc : 0) - 1e-6));
  ctx.fillStyle = '#1b222c'; roundRect(ctx, VIEW.W / 2 + 22, 14, 62, 46, 8); ctx.fill();
  ctx.fillStyle = !scOn ? '#4a5563' : sc <= 5 ? '#ff5a5a' : '#ffb347';
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(scOn ? String(sc) : '--', VIEW.W / 2 + 53, 39);
}

function drawFooter(ctx, live) {
  const y0 = VIEW.H - VIEW.FOOT;
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, y0, VIEW.W, VIEW.FOOT);
  const feed = live.feed.slice(-2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  feed.forEach((f, i) => {
    const latest = i === feed.length - 1;
    ctx.font = `${latest ? 600 : 400} 14px ${FONT}`;
    ctx.fillStyle = latest ? '#fff' : '#7d8794';
    ctx.fillText(`${fmtClock(f.clock)}  ${f.text}`, 36, y0 + 20 + i * 21);
  });
  let hint = '';
  if (live.user && live.phase === 'live') {
    hint = live.state.possession === live.user
      ? 'WASD move  ·  Shift sprint  ·  hold Space, release in the green to shoot  ·  E pass'
      : 'WASD move  ·  Shift sprint  ·  Q switch player  ·  F steal  ·  hold Space hands up';
  } else if (!live.user) hint = 'CPU vs CPU demo';
  ctx.textAlign = 'right'; ctx.font = `500 13px ${FONT}`; ctx.fillStyle = '#9aa4b2';
  ctx.fillText(hint, VIEW.W - 36, y0 + 20);
  ctx.fillStyle = '#5b6573';
  ctx.fillText('P pause', VIEW.W - 36, y0 + 41);
}

export function render(ctx, live) {
  ctx.drawImage(courtLayer(live), 0, 0);
  const k = kits(live);
  const b = live.ball;
  const be = live.ballEnt();
  const ents = [...live.all].sort((a, c) => a.y - c.y);
  for (const e of ents) {
    const ctrl = !!live.user && e === live.ctrl && (live.phase === 'live' || live.phase === 'inbound');
    drawPlayer(ctx, live, e, k[e.side], {
      ctrl,
      passTarget: e === live.passTarget && live.phase === 'live',
      name: ctrl || e === b.holder || (live.ftLine && e === live.ftLine.shooter) || (!b.holder && e === be),
    });
  }
  // CPU shot wind-up cue
  if (live.windup) {
    const e = live.windup.e;
    const u = Math.min(1, live.windup.t / live.windup.dur);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * u); ctx.stroke();
  }
  drawBall(ctx, live);
  drawMeter(ctx, live);

  for (const f of live.fx) {
    const u = f.t / f.dur;
    ctx.globalAlpha = Math.max(0, 1 - u * u);
    ctx.font = `800 20px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const fx = X(f.x), fy = Y(f.y) - 30 - u * 26;
    ctx.strokeText(f.text, fx, fy);
    ctx.fillStyle = f.color; ctx.fillText(f.text, fx, fy);
    ctx.globalAlpha = 1;
  }

  if (live.banner) {
    const text = live.banner.text;
    ctx.font = `800 26px ${FONT}`;
    const w = ctx.measureText(text).width + 48;
    const a = Math.min(1, live.banner.t * 6, (live.banner.dur - live.banner.t) * 4);
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(10,12,16,0.86)';
    roundRect(ctx, VIEW.W / 2 - w / 2, VIEW.HUD + 22, w, 48, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, VIEW.W / 2, VIEW.HUD + 47);
    ctx.globalAlpha = 1;
  }
  drawHud(ctx, live);
  drawFooter(ctx, live);
}
