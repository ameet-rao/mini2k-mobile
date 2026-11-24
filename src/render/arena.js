// Arena art, all procedural: hardwood court texture (drawn flat, then projected row by row),
// the backdrop behind the far sideline (crowd, LED boards, scorer's table, bench chairs),
// the foreground strip, and the hoops.
import { SW, SH, FAR_Y, PXFT, ROW, ZPX, depthK } from './view.js';
import { text, textWidth } from './font.js';

export const X0 = -14, X1 = 108, Y0 = -5, Y1 = 56;
const TW = Math.round((X1 - X0) * PXFT), TH = Math.round((Y1 - Y0) * ROW);
const BASE_ROW = Math.round(FAR_Y + Y0 * ROW);      // first screen row of the court texture
export const BACK_K = 0.93;                          // parallax scale of the backdrop
const BW = Math.round((X1 - X0) * PXFT * BACK_K), BH = BASE_ROW;

const mk = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const css = (c, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function rand(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Arena {
  /** @param home team record { id, name, colors } @param kitColor css colour of the home kit */
  constructor(home, away, homeColor, trimColor) {
    this.home = home; this.away = away;
    this.c1 = rgb(homeColor); this.c2 = rgb(trimColor);
    this.court = this.buildCourt();
    // Pre-warp every row to its perspective width once, so a frame is a few unscaled blits.
    this.rowK = []; this.warpW = Math.ceil(TW * depthK(Y1)) + 2;
    this.warp = mk(this.warpW, TH);
    const wc = this.warp.getContext('2d'); wc.imageSmoothingEnabled = false;
    for (let r = 0; r < TH; r++) {
      const k = depthK(Y0 + (r + 0.5) / ROW); this.rowK.push(k);
      wc.drawImage(this.court, 0, r, TW, 1, 0, r, Math.round(TW * k), 1);
    }
    this.back = [this.buildBackdrop(0), this.buildBackdrop(1)];
    this.fore = this.buildForeground();
  }

  // ------------------------------------------------------------------ court texture
  buildCourt() {
    const cv = mk(TW, TH), c = cv.getContext('2d');
    const px = (x) => Math.round((x - X0) * PXFT), py = (y) => Math.round((y - Y0) * ROW);
    const R = rand(11);
    const wood = [203, 150, 92], woodD = [188, 134, 78], apron = mix(this.c1, [16, 16, 24], 0.6);
    // apron
    c.fillStyle = css(apron); c.fillRect(0, 0, TW, TH);
    c.fillStyle = css(apron, 0.86);
    for (let r = 0; r < TH; r += 2) c.fillRect(0, r, TW, 1);
    // hardwood: one tone per row band, with staggered plank seams
    const yA = py(0), yB = py(50), xA = px(0), xB = px(94);
    for (let r = yA; r < yB; r++) {
      const band = Math.floor((r - yA) / 2);
      const u = ((band * 7919) % 13) / 13;
      c.fillStyle = css(mix(wood, woodD, u * 0.55));
      c.fillRect(xA, r, xB - xA, 1);
      if ((r - yA) % 2 === 0) {
        c.fillStyle = 'rgba(120,78,40,.35)';
        let x = xA + Math.floor(R() * 60);
        while (x < xB) { c.fillRect(x, r, 1, 2); x += 34 + Math.floor(R() * 50); }
      }
    }
    // arena lighting: brighter down the middle, a touch darker toward the sidelines, plus wood grain
    for (let r = yA; r < yB; r++) {
      const v = (r - yA) / (yB - yA), edge = Math.abs(v - 0.5) * 2;
      c.fillStyle = edge > 0.75 ? 'rgba(40,22,8,.10)' : edge > 0.5 ? 'rgba(40,22,8,.05)' : edge < 0.2 ? 'rgba(255,238,205,.07)' : 'rgba(0,0,0,0)';
      c.fillRect(xA, r, xB - xA, 1);
      let x = xA + Math.floor(R() * 40);
      while (x < xB) { c.fillStyle = R() < 0.5 ? 'rgba(255,230,190,.10)' : 'rgba(110,70,35,.10)'; c.fillRect(x, r, 6 + Math.floor(R() * 22), 1); x += 30 + Math.floor(R() * 90); }
    }
    const line = '#f4efe6';
    const plot = (x, y, col = line, w = 2) => { c.fillStyle = col; c.fillRect(px(x) - (w >> 1), py(y), w, 1); };
    const arc = (cx, cy, r, a0, a1, col = line, w = 2) => {
      const n = Math.ceil(Math.abs(a1 - a0) * r * 6);
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); plot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, col, w); }
    };
    const hline = (xa, xb, y, col = line) => { c.fillStyle = col; c.fillRect(px(xa), py(y), px(xb) - px(xa), 1); };
    const vline = (x, ya, yb, col = line, w = 2) => { c.fillStyle = col; c.fillRect(px(x) - (w >> 1), py(ya), w, py(yb) - py(ya) + 1); };
    const fillEllipse = (cx, cy, r, col) => {
      c.fillStyle = col;
      for (let y = py(cy - r); y <= py(cy + r); y++) {
        const yy = (y + 0.5) / ROW + Y0 - cy, h = r * r - yy * yy;
        if (h <= 0) continue;
        const w = Math.sqrt(h);
        c.fillRect(px(cx - w), y, px(cx + w) - px(cx - w), 1);
      }
    };
    // centre logo
    fillEllipse(47, 25, 6, css(this.c1));
    fillEllipse(47, 25, 4.6, css(mix(this.c1, [255, 255, 255], 0.12)));
    {
      const t = this.home.id, w = textWidth(t, 'big', 2);
      text(c, t, px(47) - (w >> 1) + 1, py(25) - 6, { scale: 2, color: css(this.c2), shadow: 'rgba(0,0,0,.35)' });
    }
    arc(47, 25, 6, 0, Math.PI * 2);
    vline(47, 0, 50);
    for (const right of [false, true]) {
      const X = (d) => (right ? 94 - d : d);        // distance from the baseline -> x
      const s = right ? -1 : 1;
      // paint
      c.fillStyle = css(this.c1);
      const a = px(Math.min(X(0), X(19))), b = px(Math.max(X(0), X(19)));
      c.fillRect(a, py(17), b - a, py(33) - py(17));
      c.fillStyle = css(this.c1, 0.9);
      for (let r = py(17); r < py(33); r += 2) c.fillRect(a, r, b - a, 1);
      hline(Math.min(X(0), X(19)), Math.max(X(0), X(19)), 17); hline(Math.min(X(0), X(19)), Math.max(X(0), X(19)), 33);
      vline(X(19), 17, 33);
      // lane hash marks
      for (const d of [7, 8, 11, 14]) { c.fillStyle = line; c.fillRect(px(X(d)) - 1, py(17) - 2, 2, 2); c.fillRect(px(X(d)) - 1, py(33) + 1, 2, 2); }
      // free-throw circle, restricted area
      arc(X(19), 25, 6, -Math.PI / 2, Math.PI / 2, line);
      for (let i = 0; i < 8; i++) if (i % 2 === 0) arc(X(19), 25, 6, Math.PI / 2 + (i / 8) * Math.PI, Math.PI / 2 + ((i + 1) / 8) * Math.PI);
      if (right) { /* mirror handled by X() for straight lines; arcs below use s */ }
      // three-point line: corners + arc
      const hx = X(5.25);
      hline(Math.min(X(0), X(14)), Math.max(X(0), X(14)), 3); hline(Math.min(X(0), X(14)), Math.max(X(0), X(14)), 47);
      const a0 = Math.asin(22 / 23.75);
      for (let i = 0; i <= 400; i++) { const t = -a0 + (2 * a0) * (i / 400); plot(hx + s * Math.cos(t) * 23.75, 25 + Math.sin(t) * 23.75); }
      for (let i = 0; i <= 60; i++) { const t = -Math.PI / 2 + Math.PI * (i / 60); plot(hx + s * Math.cos(t) * 4, 25 + Math.sin(t) * 4, line, 1); }
    }
    // the free-throw arcs above were drawn facing right for both ends: redraw the solid halves correctly
    for (const right of [false, true]) {
      const cx = right ? 75 : 19, s = right ? -1 : 1;
      for (let i = 0; i <= 120; i++) { const t = -Math.PI / 2 + Math.PI * (i / 120); plot(cx + s * Math.cos(t) * 6, 25 + Math.sin(t) * 6); }
    }
    // boundary
    c.fillStyle = line;
    c.fillRect(px(0) - 1, py(0) - 1, px(94) - px(0) + 2, 2); c.fillRect(px(0) - 1, py(50), px(94) - px(0) + 2, 2);
    vline(0, 0, 50); vline(94, 0, 50);
    // baseline lettering on the aprons
    for (const [x, t] of [[-7.5, this.home.id], [101.5, this.home.id]]) {
      const w = textWidth(t, 'big', 2);
      text(c, t, px(x) - (w >> 1), py(25) - 7, { scale: 2, color: css(this.c2), shadow: 'rgba(0,0,0,.4)' });
    }
    {
      const t = (this.home.nickname ?? this.home.name).toUpperCase(), w = textWidth(t, 'big', 1);
      text(c, t, px(47) - (w >> 1), py(53.2) - 3, { color: css(this.c2) });
    }
    return cv;
  }

  // ------------------------------------------------------------------ backdrop (2 crowd frames)
  buildBackdrop(frame) {
    const cv = mk(BW, BH), c = cv.getContext('2d');
    const R = rand(77);
    const bx = (x) => Math.round((x - X0) * PXFT * BACK_K);
    // rafters
    c.fillStyle = '#0c0d14'; c.fillRect(0, 0, BW, BH);
    for (let i = 0; i < 9; i++) { c.fillStyle = 'rgba(255,244,214,.05)'; c.fillRect(i * 120 + 20, 0, 60, 14); }
    // crowd: rows of seated people, darker toward the top
    const shirts = [css(this.c1), css(this.c1, 0.8), css(this.c2), '#d8d8d8', '#3b3f4d', '#6a4a3a', '#8a2f3a', '#2f5a8a', '#c9a23c', '#4c7a4a', '#222630'];
    const skins = ['#e8c09a', '#c98d5e', '#8a5a34', '#5e3a20', '#f0d0b0'];
    const top = 10, bottom = 112, rowH = 9;
    for (let ry = top, row = 0; ry < bottom; ry += rowH, row++) {
      const shade = 0.42 + 0.58 * (row / ((bottom - top) / rowH));
      c.fillStyle = `rgb(${Math.round(26 * shade)},${Math.round(28 * shade)},${Math.round(38 * shade)})`;
      c.fillRect(0, ry + 4, BW, rowH);
      for (let x = (row % 2) * 4 - 2; x < BW; x += 8) {
        const r1 = R(), r2 = R(), r3 = R(), r4 = R();
        if (r1 < 0.07) continue;                       // empty seat
        const up = frame === 1 && r4 < 0.4 ? 1 : 0;
        const shirt = r2 < 0.42 ? shirts[Math.floor(r2 / 0.42 * 3)] : shirts[3 + Math.floor(r3 * (shirts.length - 3))];
        c.globalAlpha = shade;
        c.fillStyle = shirt; c.fillRect(x, ry + 4 - up, 6, 5);
        c.fillStyle = skins[Math.floor(r3 * skins.length)]; c.fillRect(x + 2, ry + 1 - up, 3, 3);
        if (r1 > 0.6) { c.fillStyle = '#1a1418'; c.fillRect(x + 2, ry + 1 - up, 3, 1); }
        if (up && r1 > 0.3) { c.fillStyle = skins[Math.floor(r3 * skins.length)]; c.fillRect(x, ry + 1, 1, 3); c.fillRect(x + 6, ry + 1, 1, 3); }
        c.globalAlpha = 1;
      }
    }
    // railing + LED boards
    c.fillStyle = '#2a2d3a'; c.fillRect(0, bottom + 4, BW, 3);
    const ledY = bottom + 7, ledH = 15;
    c.fillStyle = '#10121a'; c.fillRect(0, ledY, BW, ledH);
    const ads = ['MINI2K', (this.home.nickname ?? this.home.id).toUpperCase(), 'QUICK GAME', `${this.home.id} VS ${this.away.id}`, 'PIXEL HOOPS'];
    let ax = 6, ai = 0;
    while (ax < BW) {
      const t = ads[ai % ads.length], w = textWidth(t, 'big', 1) + 22;
      c.fillStyle = ai % 2 ? css(this.c1, 0.9) : '#181b26'; c.fillRect(ax, ledY + 1, w, ledH - 2);
      text(c, t, ax + 11, ledY + 4, { color: ai % 2 ? css(this.c2) : '#f3d35a' });
      ax += w + 3; ai++;
    }
    // lower wall
    c.fillStyle = '#1b1e2a'; c.fillRect(0, ledY + ledH, BW, BH - ledY - ledH);
    c.fillStyle = '#242838'; c.fillRect(0, ledY + ledH, BW, 2);
    // scorer's table
    const tx0 = bx(38), tx1 = bx(56), ty = BH - 22;
    c.fillStyle = '#0d0f16'; c.fillRect(tx0 - 1, ty - 1, tx1 - tx0 + 2, 23);
    c.fillStyle = css(this.c1, 0.75); c.fillRect(tx0, ty, tx1 - tx0, 21);
    c.fillStyle = '#12141c'; c.fillRect(tx0 + 2, ty + 5, tx1 - tx0 - 4, 11);
    { const t = 'MINI2K SCORER', w = textWidth(t, 'big', 1); text(c, t, ((tx0 + tx1) >> 1) - (w >> 1), ty + 7, { color: '#f3d35a' }); }
    for (let x = tx0 + 8; x < tx1 - 6; x += 22) {        // officials at the table
      c.fillStyle = skins[(x >> 3) % skins.length]; c.fillRect(x, ty - 9, 5, 5);
      c.fillStyle = '#1a1418'; c.fillRect(x, ty - 10, 5, 2);
      c.fillStyle = '#d8d8d8'; c.fillRect(x - 2, ty - 4, 9, 4);
    }
    // bench chairs
    for (const [a, b] of [[7, 35], [59, 87]]) {
      for (let x = bx(a); x < bx(b); x += 12) {
        c.fillStyle = '#0d0f16'; c.fillRect(x - 1, BH - 20, 11, 20);
        c.fillStyle = css(this.c1, 0.55); c.fillRect(x, BH - 19, 9, 12);
        c.fillStyle = '#2b2f3d'; c.fillRect(x, BH - 7, 9, 7);
      }
    }
    return cv;
  }

  buildForeground() {
    // courtside row seen from behind, at the very bottom of the screen
    const w = SW + 240, h = 24;
    const cv = mk(w, h), c = cv.getContext('2d');
    const R = rand(5);
    for (let x = -4; x < w; x += 13) {
      const r = R(), hh = 9 + Math.floor(R() * 6);
      c.fillStyle = '#0a0b10'; c.fillRect(x, h - hh, 11, hh);
      c.fillStyle = '#0a0b10'; c.fillRect(x + 3, h - hh - 5, 6, 6);
      c.fillStyle = r > 0.5 ? '#161925' : '#11131b'; c.fillRect(x + 1, h - hh + 1, 9, hh);
    }
    return cv;
  }

  // ------------------------------------------------------------------ per-frame drawing
  drawBackdrop(ctx, cam, frame) {
    const sx = Math.round((cam.x - X0) * PXFT * BACK_K * cam.zoom - SW / 2);
    ctx.drawImage(this.back[frame ? 1 : 0], sx, 0, SW, BH, 0, 0, SW, BH);
  }

  drawCourt(ctx, cam) {
    if (cam.zoom === 1) {
      const base = (cam.x - X0) * PXFT;
      let r0 = 0, s0 = Math.round(base * this.rowK[0] - SW / 2);
      const max = Math.min(TH, SH - BASE_ROW);
      for (let r = 1; r <= max; r++) {
        const sx = r < max ? Math.round(base * this.rowK[r] - SW / 2) : NaN;
        if (sx !== s0) { ctx.drawImage(this.warp, s0, r0, SW, r - r0, 0, BASE_ROW + r0, SW, r - r0); r0 = r; s0 = sx; }
      }
      return;
    }
    const tex = this.court;
    for (let r = 0; r < TH; r++) {
      const sy = BASE_ROW + r;
      if (sy >= SH) break;
      const y = Y0 + (r + 0.5) / ROW;
      const k = depthK(y) * cam.zoom;
      const sw = SW / k, sx = (cam.x - X0) * PXFT - sw / 2;
      ctx.drawImage(tex, sx, r, sw, 1, 0, sy, SW, 1);
    }
  }

  drawForeground(ctx, cam) {
    const off = Math.round(((cam.x * PXFT * 1.08) % 13 + 13) % 13);
    ctx.drawImage(this.fore, off + 60, 0, SW, 24, 0, SH - 24, SW, 24);
  }

  /** Screen x of a world x on the backdrop plane (benches, table). */
  backX(cam, x) { return Math.round((x - cam.x) * PXFT * BACK_K * cam.zoom + SW / 2); }

  /**
   * One basket. `net` = 0..1 swish animation phase (0 = rest), `shake` = rim rattle px,
   * `clock` = shot clock text shown above the board.
   */
  drawHoop(ctx, cam, right, { net = 0, shake = 0, clock = '', part = 'all' } = {}) {
    const s = right ? -1 : 1;                             // direction from the baseline into the court
    const [fx, fy] = cam.project(right ? 88.75 : 5.25, 25, 0);
    const cx = Math.round(fx), cy = Math.round(fy - 10 * ZPX) + shake;
    const bx = cx - s * 11;                               // backboard plane
    const R = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(w < 0 ? x + w : x, y, Math.abs(w), h); };
    if (part === 'all' || part === 'back') {
      // stanchion
      const [px0, py0] = cam.project(right ? 99 : -5, 25, 0);
      const pxr = Math.round(px0), pyr = Math.round(py0);
      R(pxr - 5, pyr - 4, 10, 6, '#15161d');
      R(pxr - 3, pyr - 62, 6, 60, '#23262f'); R(pxr - 3, pyr - 62, 2, 60, '#343846');
      R(pxr - 4, pyr - 40, 8, 26, `rgb(${this.c1.map((v) => Math.round(v * 0.8)).join(',')})`);
      // arm up to the board
      const n = Math.abs(bx - s * 4 - pxr);
      for (let i = 0; i <= n; i++) {
        const u = i / (n || 1), x = Math.round(pxr + (bx - s * 4 - pxr) * u), y = Math.round(pyr - 62 + (cy - 14 - (pyr - 62)) * u);
        R(x, y, 2, 4, '#23262f'); R(x, y, 2, 1, '#343846');
      }
      // backboard (seen at an angle: a slanted slab)
      for (let i = 0; i < 6; i++) {
        const x = bx - s * i, top = cy - 32 + i;
        R(x, top - 1, 1, 34, '#1b1c22');
        if (i > 0 && i < 5) { R(x, top, 1, 32, i < 3 ? '#e9f1f7' : '#cfdbe6'); }
      }
      R(bx - s * 2, cy - 14, 1, 9, '#d8452e'); R(bx - s * 1, cy - 15, 1, 9, '#d8452e');
      // shot clock above the board
      R(bx - s * 2 - 8, cy - 46, 17, 11, '#0c0d12'); R(bx - s * 2 - 7, cy - 45, 15, 9, '#1a0d0d');
      if (clock !== '') text(ctx, clock, bx - s * 2 + 1, cy - 43, { font: 'tiny', color: '#ff4a3a', align: 'center' });
      // bracket + back half of the rim
      R(bx + s * 1, cy - 1, s * 4, 2, '#b8421f');
      R(cx - 6, cy - 2, 13, 1, '#b8421f');
      R(cx - 7, cy - 1, 1, 2, '#e8622a'); R(cx + 7, cy - 1, 1, 2, '#e8622a');
    }
    if (part === 'all' || part === 'front') {
      // net: tapers, stretches and sways on a make
      const st = net > 0 ? Math.sin(net * Math.PI) : 0;
      const len = 10 + Math.round(st * 4), sway = Math.round(Math.sin(net * Math.PI * 3) * st * 2);
      for (let j = 0; j < len; j++) {
        const u = j / (len - 1), half = Math.round(6 - 3 * u - st * (u > 0.5 ? 1 : 0)), ox = Math.round(sway * u);
        for (let x = -half; x <= half; x++) {
          if ((x + j + 100) % 2 === 0 || Math.abs(x) === half) { ctx.fillStyle = (x + j) % 4 === 0 ? '#c9ced8' : '#f2f4f8'; ctx.fillRect(cx + x + ox, cy + 1 + j, 1, 1); }
        }
      }
      // front half of the rim
      R(cx - 6, cy + 1, 13, 1, '#ff7a33'); R(cx - 7, cy, 1, 1, '#ff7a33'); R(cx + 7, cy, 1, 1, '#ff7a33');
      R(cx - 5, cy + 2, 11, 1, '#b8421f');
    }
    return { cx, cy };
  }
}
