// Broadcast HUD: score bug, banners, stat pop-ups, shot meter, player tags, cards, portraits.
import { SW, SH } from './view.js';
import { text, textWidth } from './font.js';
import { AX, AY } from './rig.js';
import { deriveBoxScore } from '../engine/boxscore.js';
import { periodName, fmtClock } from '../engine/pbp.js';

const box = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const panel = (c, x, y, w, h, col = '#11131b', edge = '#2c3040') => { box(c, x, y, w, h, edge); box(c, x + 1, y + 1, w - 2, h - 2, col); };
const lastName = (p) => { const parts = p.name.split(' '); const l = parts[parts.length - 1]; return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(l) && parts.length > 2 ? parts[parts.length - 2] : l; };

/** Head-and-shoulders portrait cut from the idle sprite, scaled by an integer. */
export function drawPortrait(ctx, bank, look, x, y, scale = 2, bg = '#1b1e2a') {
  const f = bank.frameIdx(look, 'idle', 0, false);
  const w = 18, h = 18;
  const sx = AX + f.head[0] - 9 - (AX + f.ox), sy = AY + f.head[1] - 8 - (AY + f.oy);
  box(ctx, x - 1, y - 1, w * scale + 2, h * scale + 2, '#0b0c12'); box(ctx, x, y, w * scale, h * scale, bg);
  ctx.drawImage(f.img, sx, sy, w, h, x, y, w * scale, h * scale);
}

export class Hud {
  constructor(L, actors, bank, colors) {
    this.L = L; this.actors = actors; this.bank = bank; this.colors = colors;   // colors: { home, away } css
    this.card = null; this.cardKey = null;
  }

  teamStats() {
    const L = this.L, b = deriveBoxScore(L.game.events), out = {};
    for (const side of ['away', 'home']) {
      const t = b[side].totals;
      const top = [...b[side].order].sort((x, y) => b[side].players[y].pts - b[side].players[x].pts)[0];
      out[side] = { fg: `${t.fgm}/${t.fga}`, tp: `${t.tpm}/${t.tpa}`, reb: t.reb, ast: t.ast, tov: t.tov, top: top ? `${lastName(L.p(top))} ${b[side].players[top].pts}` : '' };
    }
    return out;
  }

  // ------------------------------------------------------------------ score bug
  scoreBug(c) {
    const L = this.L, s = L.state, y = SH - 27, x0 = 118, h = 24;
    panel(c, x0, y, 404, h, '#0e1017', '#05060a');
    const team = (side, x) => {
      const t = s.teams[side], w = 146;
      box(c, x, y + 1, w, h - 2, '#171a25');
      box(c, x, y + 1, 5, h - 2, this.colors[side]);
      text(c, t.id, x + 9, y + 4, { color: '#fff' });
      // timeouts as pips, fouls / bonus
      for (let i = 0; i < Math.min(7, t.timeouts); i++) box(c, x + 9 + i * 4, y + 14, 3, 2, '#f3d35a');
      const bonus = t.teamFouls >= 5;
      text(c, bonus ? 'BONUS' : `FOULS ${t.teamFouls}`, x + 9, y + 18, { font: 'tiny', color: bonus ? '#ff6b5a' : '#8f96a8' });
      text(c, String(s.score[side]), x + w - 6, y + 5, { scale: 2, align: 'right', color: '#fff' });
      if (s.possession === side && L.phase !== 'final') { box(c, x + 34, y + 6, 3, 3, '#f3d35a'); box(c, x + 37, y + 7, 1, 1, '#f3d35a'); }
    };
    if (L.street) return this.streetBug(c, x0, y, h);
    team('away', x0 + 2); team('home', x0 + 150);
    // period + clock
    const cx = x0 + 298;
    box(c, cx, y + 1, 70, h - 2, '#1d2130');
    text(c, periodName(s.period, L.game.rules.periods).replace('Quarter', 'QTR').replace(/(\d)(st|nd|rd|th)/, '$1$2'), cx + 35, y + 3, { font: 'tiny', color: '#9aa3b5', align: 'center' });
    const clk = L.dispClock ?? s.clock;
    const ct = clk < 60 ? clk.toFixed(1) : fmtClock(clk);
    text(c, ct, cx + 35, y + 11, { align: 'center', color: clk < 24 ? '#ff8a7a' : '#fff' });
    // shot clock
    const sc = Math.max(0, Math.ceil(s.shotClock));
    const showSc = L.phase === 'live' || L.phase === 'inbound';
    box(c, cx + 72, y + 1, 32, h - 2, '#140d0d');
    text(c, showSc && s.clock > s.shotClock ? String(sc) : '--', cx + 88, y + 5, { scale: 2, align: 'center', color: sc <= 5 ? '#ff4a3a' : '#f3a33a' });
  }

  /** StreetBall score bug: no fouls, timeouts or game clock; the target score and the shot clock. */
  streetBug(c, x0, y, h) {
    const L = this.L, s = L.state, R = L.game.rules;
    const team = (side, x) => {
      const t = s.teams[side], w = 146;
      box(c, x, y + 1, w, h - 2, '#171a25');
      box(c, x, y + 1, 5, h - 2, this.colors[side]);
      text(c, t.id, x + 9, y + 4, { color: '#fff' });
      const need = Math.max(0, R.target - s.score[side]);
      text(c, need ? `${need} TO GO` : 'WIN BY 2', x + 9, y + 15, { font: 'tiny', color: '#8f96a8' });
      text(c, String(s.score[side]), x + w - 6, y + 5, { scale: 2, align: 'right', color: '#fff' });
      if (s.possession === side && L.phase !== 'final') { box(c, x + 34, y + 6, 3, 3, '#f3d35a'); box(c, x + 37, y + 7, 1, 1, '#f3d35a'); }
    };
    team('away', x0 + 2); team('home', x0 + 150);
    const cx = x0 + 298;
    box(c, cx, y + 1, 70, h - 2, '#1d2130');
    text(c, 'STREETBALL', cx + 35, y + 3, { font: 'tiny', color: '#9aa3b5', align: 'center' });
    text(c, `TO ${R.target}`, cx + 35, y + 11, { align: 'center', color: '#f3d35a' });
    const sc = Math.max(0, Math.ceil(s.shotClock));
    const showSc = L.phase === 'live' || L.phase === 'check';
    box(c, cx + 72, y + 1, 32, h - 2, '#140d0d');
    text(c, showSc ? String(sc) : '--', cx + 88, y + 5, { scale: 2, align: 'center', color: sc <= 5 ? '#ff4a3a' : '#f3a33a' });
  }

  banner(c) {
    const b = this.L.banner;
    if (!b) return;
    const u = Math.min(1, b.t / 0.18, (b.dur - b.t) / 0.18);
    const w = Math.max(120, textWidth(b.text, 'big') + 26), x = (SW - w) >> 1, y = Math.round(-22 + 28 * Math.max(0, u));
    panel(c, x, y, w, 17, '#0e1017ee', '#f3d35a');
    text(c, b.text, SW / 2, y + 5, { align: 'center', color: '#fff' });
  }

  popup(c) {
    const p = this.actors.popup;
    if (p) {
      const u = Math.min(1, p.t / 0.2, (p.dur - p.t) / 0.2);
      const w = textWidth(p.text, 'big') + 20 + (p.fire ? 10 : 0), x = Math.round(SW - (w + 6) * Math.max(0, u)), y = 30;
      panel(c, x, y, w, 15, '#0e1017ee', this.colors[p.side]);
      box(c, x + 1, y + 1, 4, 13, this.colors[p.side]);
      text(c, p.text, x + 9, y + 4, { color: '#fff' });
      if (p.fire) this.flame(c, x + w - 8, y + 11, this.L.time);
    }
    const f = this.actors.foulCard;
    if (f) {
      const u = Math.min(1, f.t / 0.2, (f.dur - f.t) / 0.2);
      const w = Math.max(textWidth(f.text, 'big'), textWidth(f.sub, 'tiny')) + 18, x = Math.round(-w + (w + 6) * Math.max(0, u)), y = 30;
      panel(c, x, y, w, 23, '#0e1017ee', this.colors[f.side]);
      box(c, x + 1, y + 1, 4, 21, this.colors[f.side]);
      text(c, f.text, x + 9, y + 4, { color: '#fff' });
      text(c, f.sub, x + 9, y + 14, { font: 'tiny', color: '#f3d35a' });
    }
  }

  flame(c, x, y, t) {
    const k = Math.floor(t * 10) % 3;
    box(c, x - 2, y - 3, 5, 3, '#ff5a1f'); box(c, x - 1, y - 5 - (k === 1 ? 1 : 0), 3, 3, '#ff9a2a'); box(c, x + (k - 1), y - 7 - (k === 2 ? 1 : 0), 1, 2, '#ffe14a'); box(c, x, y - 3, 1, 2, '#ffe14a');
  }

  /** Tag above a player's head: number + name (+ stamina for the controlled player). */
  tag(c, a, sx, sy, { ctrl = false, label = null } = {}) {
    const L = this.L, P = L.p(a.id);
    const top = sy + (a.frame ? a.frame.oy : -60) - 4;
    const t = label ?? `${P.number} ${lastName(P)}`;
    const w = textWidth(t, 'tiny');
    const col = ctrl ? '#ffe14a' : '#ffffff';
    text(c, t, sx, top - 6, { font: 'tiny', color: col, align: 'center', shadow: '#000' });
    if (ctrl) {
      const e = L.energy(a.e), bw = Math.max(16, w);
      box(c, sx - (bw >> 1) - 1, top + 1, bw + 2, 3, '#000');
      box(c, sx - (bw >> 1), top + 2, Math.round(bw * e), 1, e > 0.5 ? '#4ade80' : e > 0.3 ? '#f3d35a' : '#ff5a4a');
    }
    return top - 8;
  }

  meter(c, sx, sy, a, edge = '#05060a', m = this.L.meter) {
    if (!m) return;
    const H = 34, x = sx + (a.left ? -19 : 15), y = sy - 58;
    box(c, x - 2, y - 2, 9, H + 4, '#05060a'); box(c, x - 1, y - 1, 7, H + 2, edge); box(c, x, y, 5, H, '#161a24');
    
    const hasGreen = (m.green ?? 0) > 0;
    const hasOrange = (m.orange ?? 0) > 0;
    const g0 = hasGreen ? m.greenStart : 1.05;
    const o0 = hasOrange ? m.orangeStart : g0;

    // Orange bar (below green, height dynamically reflects m.orange)
    if (hasOrange && g0 > o0) {
      const yO = y + H - Math.round(Math.min(1.0, g0) * H);
      const hO = Math.max(1, Math.round((Math.min(1.0, g0) - o0) * H));
      box(c, x, yO, 5, hO, '#d97706'); box(c, x + 1, yO, 3, hO, '#ff9a3a');
    }

    // Green bar (at the top, height dynamically reflects m.green)
    if (hasGreen) {
      const hG = Math.max(2, Math.round(m.green * H));
      box(c, x, y, 5, hG, '#15803d'); box(c, x + 1, y, 3, hG, '#22c55e');
      box(c, x - 1, y, 7, 1, '#ffffff'); // release tick at very top
    } else {
      // No green bar (e.g. contested half court)
      box(c, x - 1, y, 7, 1, '#64748b');
    }

    // Rising fill
    const u = m.t / m.dur;
    if (u > (hasGreen ? (m.greenEnd ?? 1.01) : 1.0)) {
      // Overshot: red flash
      box(c, x - 1, y - 3, 7, 3, '#ff4a3a');
      box(c, x + 1, y, 3, H, '#ff4a3a');
    } else {
      const fh = Math.min(H, Math.round(u * H));
      const col = (hasGreen && u >= g0) ? '#ffffff' : (hasOrange && u >= o0) ? '#ffd54f' : '#e2e8f0';
      box(c, x + 1, y + H - fh, 3, fh, col);
      box(c, x - 1, y + H - fh, 7, 2, (hasGreen && u >= g0) ? '#ffffff' : (hasOrange && u >= o0) ? '#ffffff' : '#ffd84a');
    }
  }

  /** Timeout / end-of-period stats card. */
  statsCard(c, title) {
    const L = this.L, key = `${title}|${L.game.events.length}`;
    if (this.cardKey !== key) { this.card = this.teamStats(); this.cardKey = key; }
    const st = this.card, s = L.state, w = 250, x = (SW - w) >> 1, y = 44;
    panel(c, x, y, w, 78, '#0e1017f2', '#f3d35a');
    text(c, title, SW / 2, y + 5, { align: 'center', color: '#f3d35a' });
    const rows = [['FG', 'fg'], ['3PT', 'tp'], ['REB', 'reb'], ['AST', 'ast'], ['TO', 'tov'], ['TOP', 'top']];
    for (const [i, side] of ['away', 'home'].entries()) {
      const cx = x + (i ? w - 62 : 62);
      box(c, cx - 50, y + 16, 100, 12, this.colors[side]);
      text(c, `${s.teams[side].id}  ${s.score[side]}`, cx, y + 19, { align: 'center', color: '#fff', shadow: 'rgba(0,0,0,.6)' });
      rows.forEach(([, k], r) => text(c, String(st[side][k]), cx, y + 33 + r * 7, { font: 'tiny', align: 'center', color: '#e8ecf1' }));
    }
    rows.forEach(([lab], r) => text(c, lab, SW / 2, y + 33 + r * 7, { font: 'tiny', align: 'center', color: '#8f96a8' }));
  }

  /** Pre-game lineup card with pixel portraits. `u` 0..1 = progress of the intro. */
  intro(c, u) {
    const L = this.L, s = L.state;
    box(c, 0, 0, SW, SH, 'rgba(6,7,11,.80)');
    text(c, L.street ? `STREETBALL 3ON3 · FIRST TO ${L.game.rules.target}${L.game.rules.makeItTakeIt ? ' · MAKE IT TAKE IT' : ''}` : 'STARTING LINEUPS', SW / 2, 16, { align: 'center', scale: 2, color: '#f3d35a', shadow: '#000' });
    for (const [i, side] of ['away', 'home'].entries()) {
      const t = s.teams[side], x = i ? 334 : 26, w = 280;
      panel(c, x, 44, w, 262, '#11131bf0', this.colors[side]);
      box(c, x + 1, 45, w - 2, 20, this.colors[side]);
      text(c, `${t.name}`, x + w / 2, 51, { align: 'center', color: '#fff', shadow: 'rgba(0,0,0,.6)' });
      const ents = [...L.ents[side]].sort((a, b) => a.role - b.role);
      ents.forEach((e, r) => {
        const show = u * 7 > r + i * 0.5;
        if (!show) return;
        const P = L.p(e.id), y = 72 + r * 46;
        drawPortrait(c, this.bank, this.actors.look(e.id, side), x + 10, y, 2, '#232737');
        text(c, `#${P.number}`, x + 56, y + 3, { color: '#f3d35a' });
        text(c, P.name, x + 56 + textWidth(`#${P.number} `, 'big'), y + 3, { color: '#fff' });
        text(c, `${P.pos}   OVR ${P.overall}`, x + 56, y + 16, { font: 'tiny', color: '#9aa3b5' });
        const A = P.attrs, best = Object.entries({ '3PT': A.three_pt, MID: A.mid_range, FIN: A.finishing, PASS: A.passing, HANDLE: A.ball_handle, DEF: Math.max(A.perimeter_def, A.interior_def), REB: A.def_rebound, ATH: A.athleticism }).sort((p, q) => q[1] - p[1]).slice(0, 3);
        text(c, best.map(([k, v]) => `${k} ${v}`).join('  '), x + 56, y + 25, { font: 'tiny', color: '#cfd6e2' });
      });
    }
    if (Math.floor(u * 40) % 2 === 0 || u > 0.5) text(c, L.street ? 'PRESS SPACE TO CHECK BALL' : 'PRESS SPACE TO TIP OFF', SW / 2, SH - 38, { align: 'center', color: '#fff', shadow: '#000' });
  }

  /** Side panel listing the controls; the half that applies right now (offense / defense) is lit. */
  controls(c) {
    const L = this.L;
    if (!L.user) { text(c, 'CPU VS CPU · P PAUSE', SW - 4, 4, { font: 'tiny', align: 'right', color: '#e8ecf1', shadow: '#000' }); return; }
    const off = L.state.possession === L.user;
    const secs = [
      ['OFFENSE', off, [['WASD', 'MOVE'], ['SHIFT', 'SPRINT (+C: BLOW-BY)'], ['SPACE', 'HOLD, LET GO TO SHOOT'], ['SPACE', 'QUICK TAP: PUMP FAKE'], ['E', 'PASS'], ['C', 'DRIBBLE MOVE'], ['V', 'SPIN MOVE'], ['Q', 'ALLEY-OOP LOB'], ['R', 'CALL PICK AND ROLL'], ['T', 'TIMEOUT']]],
      ['DEFENSE', !off, [['WASD', 'MOVE'], ['SHIFT', 'SPRINT'], ['SPACE', 'HANDS UP, REBOUND'], ['F', 'STEAL'], ['Q', 'SWITCH PLAYER'], ['R', 'DOUBLE TEAM']]],
      L.street ? ['GAME', true, [['P', 'PAUSE'], ['M', 'FULLSCREEN'], ['H', 'HIDE THIS']]] : ['COACH', true, [['P', 'PAUSE: SUBS, TIMEOUT'], ['M', 'FULLSCREEN'], ['H', 'HIDE THIS']]],
    ];
    if (L.street) secs[0][2] = secs[0][2].filter(([k]) => k !== 'T');     // StreetBall: no timeouts
    const w = 122, x = SW - w - 3, y0 = 3;
    const rows = secs.reduce((n, s) => n + s[2].length + 1, 0);
    c.globalAlpha = 0.72; panel(c, x, y0, w, rows * 7 + 8, '#0e1017', '#05060a'); c.globalAlpha = 1;
    let y = y0 + 4;
    for (const [title, on, list] of secs) {
      box(c, x + 3, y - 1, w - 6, 7, on ? (title === 'COACH' ? '#2a2f40' : this.colors[L.user]) : '#1a1d28');
      text(c, title, x + 6, y, { font: 'tiny', color: on ? '#fff' : '#8a90a2' });
      y += 8;
      for (const [key, what] of list) {
        text(c, key, x + 6, y, { font: 'tiny', color: on ? '#f3d35a' : '#77705a' });
        text(c, what, x + 32, y, { font: 'tiny', color: on ? '#e8ecf1' : '#7d8394' });
        y += 7;
      }
    }
  }
}
