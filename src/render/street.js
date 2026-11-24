// StreetBall 3on3 arena: an outdoor blacktop court (worn asphalt, painted lines, cracks), a city
// skyline and a chain-link fence with a few people watching behind it, and park hoops with chain
// nets and no shot clock. Same geometry and drawing path as the arena (it only swaps the art), so
// the camera, sprites and sorting work exactly as in the other modes. All procedural.
import { SW, SH, PXFT, ROW, ZPX, FAR_Y, depthK } from './view.js';
import { Arena, X0, X1, Y0, Y1, BACK_K } from './arena.js';
import { text, textWidth } from './font.js';

const TW = Math.round((X1 - X0) * PXFT), TH = Math.round((Y1 - Y0) * ROW);
const BASE_ROW = Math.round(FAR_Y + Y0 * ROW);
const BW = Math.round((X1 - X0) * PXFT * BACK_K), BH = BASE_ROW;

const mk = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const css = (c, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function rand(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class StreetArena extends Arena {
  constructor(...args) {
    super(...args);
    // the court seen from the other side (camera turned 180 degrees), pre-warped like the normal one
    this.warp0 = this.warp;
    this.courtPi = this.turned(Math.PI);
    this.warpPi = mk(this.warpW, TH);
    const wc = this.warpPi.getContext('2d'); wc.imageSmoothingEnabled = false;
    for (let r = 0; r < TH; r++) wc.drawImage(this.courtPi, 0, r, TW, 1, 0, r, Math.round(TW * this.rowK[r]), 1);
    this.spinTex = null;
  }

  /** The flat court texture turned by `rot` round the middle of the half court (same turn as Camera.rw). */
  turned(rot, out = null) {
    const cv = out ?? mk(TW, TH), c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#6b6a66'; c.fillRect(0, 0, TW, TH);
    // texture pixels -> feet -> turn -> feet -> texture pixels (feet are not square in texture pixels)
    c.scale(PXFT, ROW); c.translate(-X0, -Y0);
    c.translate(70.5, 25); c.rotate(rot); c.translate(-70.5, -25);
    c.translate(X0, Y0); c.scale(1 / PXFT, 1 / ROW);
    c.drawImage(this.court, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return cv;
  }

  drawCourt(ctx, cam) {
    const rot = cam.rot ?? 0, sn = Math.sin(rot), cs = Math.cos(rot);
    if (Math.abs(sn) < 1e-4) {
      // resting (basket on the right, or turned round): the fast pre-warped path
      this.warp = cs > 0 ? this.warp0 : this.warpPi;
      return super.drawCourt(ctx, { x: cam.x, zoom: 1 });
    }
    // mid-swivel: turn the texture this frame, then draw it row by row in perspective
    this.spinTex = this.turned(rot, this.spinTex);
    for (let r = 0; r < TH; r++) {
      const sy = BASE_ROW + r;
      if (sy >= SH) break;
      const k = depthK(Y0 + (r + 0.5) / ROW);
      const sw = SW / k, sx = (cam.x - X0) * PXFT - sw / 2;
      ctx.drawImage(this.spinTex, sx, r, sw, 1, 0, sy, SW, 1);
    }
  }

  /** The skyline slides past as the camera swivels (tiled, so it never runs out). */
  drawBackdrop(ctx, cam, frame) {
    const img = this.back[frame ? 1 : 0];
    let sx = Math.round((cam.x - X0) * PXFT * BACK_K * cam.zoom - SW / 2 + ((cam.rot ?? 0) / Math.PI) * BW * 0.55);
    sx = ((sx % BW) + BW) % BW;
    const w1 = Math.min(SW, BW - sx);
    ctx.drawImage(img, sx, 0, w1, BH, 0, 0, w1, BH);
    if (w1 < SW) ctx.drawImage(img, 0, 0, SW - w1, BH, w1, 0, SW - w1, BH);
  }

  // ------------------------------------------------------------------ blacktop
  buildCourt() {
    const cv = mk(TW, TH), c = cv.getContext('2d');
    const px = (x) => Math.round((x - X0) * PXFT), py = (y) => Math.round((y - Y0) * ROW);
    const R = rand(23);
    // concrete around the court, asphalt on it
    c.fillStyle = '#6b6a66'; c.fillRect(0, 0, TW, TH);
    for (let i = 0; i < TW * TH / 10; i++) { c.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.08)'; c.fillRect(Math.floor(R() * TW), Math.floor(R() * TH), 1, 1); }
    for (let x = px(-12); x < TW; x += 64) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x, 0, 1, TH); }   // slab joints
    const xA = px(-2), xB = px(96), yA = py(-2), yB = py(52);
    c.fillStyle = '#34373c'; c.fillRect(xA, yA, xB - xA, yB - yA);
    // asphalt grain: speckles of stone, darker patches, a few faded tar seams
    for (let i = 0; i < (xB - xA) * (yB - yA) / 3; i++) {
      const v = R();
      c.fillStyle = v < 0.35 ? 'rgba(255,255,255,.07)' : v < 0.7 ? 'rgba(0,0,0,.12)' : v < 0.74 ? 'rgba(200,190,170,.16)' : 'rgba(0,0,0,0)';
      c.fillRect(xA + Math.floor(R() * (xB - xA)), yA + Math.floor(R() * (yB - yA)), 1, 1);
    }
    for (let i = 0; i < 14; i++) {
      const cx = xA + R() * (xB - xA), cy = yA + R() * (yB - yA), rw = 20 + R() * 60, rh = 4 + R() * 10;
      c.fillStyle = R() < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.03)';
      for (let y = -rh; y <= rh; y++) { const w = rw * Math.sqrt(1 - (y / rh) ** 2); c.fillRect(Math.round(cx - w), Math.round(cy + y), Math.round(w * 2), 1); }
    }
    // sun from the far side: a touch brighter far, darker near
    for (let r = yA; r < yB; r++) { const v = (r - yA) / (yB - yA); c.fillStyle = `rgba(${v < 0.5 ? '255,220,170' : '0,0,0'},${v < 0.5 ? (0.5 - v) * 0.08 : (v - 0.5) * 0.12})`; c.fillRect(xA, r, xB - xA, 1); }

    const line = '#e9e6dc';
    // worn paint: a few pixels missing here and there
    const plot = (x, y, col = line, w = 2) => { if (R() < 0.06) return; c.fillStyle = col; c.fillRect(px(x) - (w >> 1), py(y), w, 1); };
    const hline = (xa, xb, y, col = line) => { for (let x = px(xa); x < px(xb); x++) if (R() > 0.05) { c.fillStyle = col; c.fillRect(x, py(y), 1, 1); } };
    const vline = (x, ya, yb, col = line, w = 2) => { for (let y = py(ya); y <= py(yb); y++) if (R() > 0.05) { c.fillStyle = col; c.fillRect(px(x) - (w >> 1), y, w, 1); } };
    const key = mix([52, 55, 60], this.c1, 0.55);
    // centre circle with a stencil
    // no lettering on the ground: the camera turns round, and it would read upside down
    for (let i = 0; i <= 300; i++) { const a = (i / 300) * Math.PI * 2; plot(47 + Math.cos(a) * 6, 25 + Math.sin(a) * 6); }
    vline(47, 0, 50);
    for (const right of [false, true]) {
      const X = (d) => (right ? 94 - d : d), s = right ? -1 : 1;
      const a = px(Math.min(X(0), X(19))), b = px(Math.max(X(0), X(19)));
      c.fillStyle = css(key); c.fillRect(a, py(17), b - a, py(33) - py(17));
      for (let i = 0; i < (b - a) * (py(33) - py(17)) / 4; i++) { c.fillStyle = R() < 0.5 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.05)'; c.fillRect(a + Math.floor(R() * (b - a)), py(17) + Math.floor(R() * (py(33) - py(17))), 1, 1); }
      hline(Math.min(X(0), X(19)), Math.max(X(0), X(19)), 17); hline(Math.min(X(0), X(19)), Math.max(X(0), X(19)), 33);
      vline(X(19), 17, 33);
      for (let i = 0; i <= 120; i++) { const t = -Math.PI / 2 + Math.PI * (i / 120); plot(X(19) + s * Math.cos(t) * 6, 25 + Math.sin(t) * 6); }
      const hx = X(5.25);
      hline(Math.min(X(0), X(14)), Math.max(X(0), X(14)), 3); hline(Math.min(X(0), X(14)), Math.max(X(0), X(14)), 47);
      const a0 = Math.asin(22 / 23.75);
      for (let i = 0; i <= 400; i++) { const t = -a0 + (2 * a0) * (i / 400); plot(hx + s * Math.cos(t) * 23.75, 25 + Math.sin(t) * 23.75); }
    }
    c.fillStyle = line;
    c.fillRect(px(0) - 1, py(0) - 1, px(94) - px(0) + 2, 2); c.fillRect(px(0) - 1, py(50), px(94) - px(0) + 2, 2);
    vline(0, 0, 50); vline(94, 0, 50);
    // cracks
    for (let i = 0; i < 16; i++) {
      let x = xA + R() * (xB - xA), y = yA + R() * (yB - yA);
      const n = 10 + Math.floor(R() * 30);
      let dx = R() < 0.5 ? 1 : -1;
      for (let j = 0; j < n; j++) {
        c.fillStyle = 'rgba(12,12,14,.55)'; c.fillRect(Math.round(x), Math.round(y), 1, 1);
        x += dx * (0.6 + R()); y += R() < 0.5 ? (R() < 0.5 ? 1 : -1) : 0;
        if (R() < 0.08) dx = -dx;
      }
    }
    return cv;
  }

  // ------------------------------------------------------------------ city, fence, people watching
  buildBackdrop(frame) {
    const cv = mk(BW, BH), c = cv.getContext('2d');
    const R = rand(91);
    // evening sky
    const sky = [[48, 70, 120], [118, 102, 150], [236, 150, 98], [250, 196, 120]];
    for (let r = 0; r < BH; r++) {
      const u = Math.min(1, r / 130) * (sky.length - 1), i = Math.min(sky.length - 2, Math.floor(u));
      c.fillStyle = css(mix(sky[i], sky[i + 1], u - i)); c.fillRect(0, r, BW, 1);
    }
    // two rows of buildings, far (hazy) then near (dark), with lit windows
    for (const [base, k, haze] of [[126, 0.5, 0.45], [146, 1, 0]]) {
      let x = -10;
      while (x < BW) {
        const w = 26 + Math.floor(R() * 46), h = (k < 1 ? 40 : 30) + Math.floor(R() * (k < 1 ? 50 : 44));
        const col = mix([28, 26, 40], sky[2], haze);
        c.fillStyle = css(col); c.fillRect(x, base - h, w, h + 30);
        if (R() < 0.3) { c.fillStyle = css(col, 0.85); c.fillRect(x + 4, base - h - 6, 6, 6); }       // roof box
        for (let wy = base - h + 5; wy < base - 2; wy += 6) for (let wx = x + 3; wx < x + w - 3; wx += 5) {
          if (R() < 0.38) { c.fillStyle = R() < 0.7 ? `rgba(255,214,120,${k < 1 ? 0.35 : 0.75})` : `rgba(160,200,255,${k < 1 ? 0.3 : 0.6})`; c.fillRect(wx, wy, 2, 3); }
        }
        x += w + Math.floor(R() * 6);
      }
    }
    // brick wall with a mural, behind the fence on part of the lot
    const wallTop = 128;
    for (const [a, b] of [[60, 330], [620, 900]]) {
      c.fillStyle = '#6e3a2c'; c.fillRect(a, wallTop, b - a, BH - wallTop);
      for (let y = wallTop; y < BH; y += 4) {
        c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(a, y, b - a, 1);
        for (let x = a + ((y / 4) % 2 ? 4 : 0); x < b; x += 8) c.fillRect(x, y, 1, 4);
      }
      const t = a < 400 ? 'MINI2K' : 'HOOPS', w = textWidth(t, 'big', 2);
      text(c, t, ((a + b) >> 1) - (w >> 1), wallTop + 8, { scale: 2, color: a < 400 ? '#f3d35a' : '#5ac8ff', shadow: '#1a0d0a' });
    }
    // people watching (two frames: some throw their arms up)
    const skins = ['#e8c09a', '#c98d5e', '#8a5a34', '#5e3a20', '#f0d0b0'];
    const shirts = [css(this.c1), css(this.c2), '#d8d8d8', '#2f5a8a', '#8a2f3a', '#c9a23c', '#3b3f4d', '#4c7a4a', '#e06a2a'];
    for (let x = 8; x < BW; x += 9 + Math.floor(R() * 16)) {
      if (R() < 0.35) { x += 30; continue; }
      const h = 15 + Math.floor(R() * 5), y = BH - 6 - h, up = frame === 1 && R() < 0.5, sk = skins[Math.floor(R() * skins.length)];
      c.fillStyle = '#1c1d24'; c.fillRect(x + 1, y + 10, 2, h - 10); c.fillRect(x + 4, y + 10, 2, h - 10);   // legs
      c.fillStyle = shirts[Math.floor(R() * shirts.length)]; c.fillRect(x, y + 3, 7, 8);
      c.fillStyle = sk; c.fillRect(x + 2, y - 1, 3, 4);
      if (R() < 0.5) { c.fillStyle = '#16141a'; c.fillRect(x + 2, y - 2, 3, 1); }
      c.fillStyle = sk;
      if (up) { c.fillRect(x - 1, y - 3, 1, 6); c.fillRect(x + 7, y - 3, 1, 6); } else { c.fillRect(x - 1, y + 4, 1, 5); c.fillRect(x + 7, y + 4, 1, 5); }
    }
    // sidewalk
    c.fillStyle = '#8a8780'; c.fillRect(0, BH - 6, BW, 6);
    c.fillStyle = '#9c9990'; c.fillRect(0, BH - 6, BW, 1);
    // chain-link fence: posts, rails, diamond mesh
    const fTop = 108;
    c.fillStyle = 'rgba(190,196,204,.30)';
    for (let x = -BH; x < BW + BH; x += 6) {
      for (let y = fTop; y < BH - 4; y++) { const d = y - fTop; c.fillRect(x + d, y, 1, 1); c.fillRect(x - d, y, 1, 1); }
    }
    c.fillStyle = '#7d838c'; c.fillRect(0, fTop - 1, BW, 2);
    c.fillStyle = '#a7adb6'; c.fillRect(0, fTop - 1, BW, 1);
    for (let x = 20; x < BW; x += 96) { c.fillStyle = '#5e646d'; c.fillRect(x, fTop - 4, 3, BH - fTop + 2); c.fillStyle = '#9aa0a9'; c.fillRect(x, fTop - 4, 1, BH - fTop + 2); }
    // streetlights
    for (const x of [180, 560, 940]) {
      c.fillStyle = '#2b2d33'; c.fillRect(x, 70, 2, fTop - 70);
      c.fillRect(x, 70, 10, 2); c.fillStyle = '#ffe9a8'; c.fillRect(x + 7, 72, 4, 2);
      c.fillStyle = 'rgba(255,233,168,.08)'; c.fillRect(x - 6, 74, 26, 30);
    }
    return cv;
  }

  buildForeground() {
    // the near curb of the lot
    const w = SW + 240, h = 24, cv = mk(w, h), c = cv.getContext('2d');
    c.fillStyle = '#5d5c58'; c.fillRect(0, h - 10, w, 10);
    c.fillStyle = '#7a7872'; c.fillRect(0, h - 10, w, 1);
    for (let x = 0; x < w; x += 26) { c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x, h - 9, 1, 9); }
    return cv;
  }

  /** A park hoop: metal pole, painted steel backboard, chain net, no shot clock. */
  drawHoop(ctx, cam, right, { net = 0, shake = 0, part = 'all' } = {}) {
    // which way the board faces on screen (the camera may be turned round)
    const vis = Math.cos(cam.rot ?? 0) < 0 ? !right : right, s = vis ? -1 : 1;
    const [fx, fy] = cam.project(right ? 88.75 : 5.25, 25, 0);
    const cx = Math.round(fx), cy = Math.round(fy - 10 * ZPX) + shake;
    const bx = cx - s * 11;
    const R = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(w < 0 ? x + w : x, y, Math.abs(w), h); };
    if (part === 'all' || part === 'back') {
      const [px0, py0] = cam.project(right ? 96.5 : -2.5, 25, 0);
      const pxr = Math.round(px0), pyr = Math.round(py0);
      R(pxr - 4, pyr - 2, 8, 3, '#3a3b40');
      R(pxr - 2, pyr - 66, 4, 64, '#4a5058'); R(pxr - 2, pyr - 66, 1, 64, '#7d858f');
      const n = Math.abs(bx - s * 3 - pxr);
      for (let i = 0; i <= n; i++) {
        const u = i / (n || 1), x = Math.round(pxr + (bx - s * 3 - pxr) * u), y = Math.round(pyr - 66 + (cy - 12 - (pyr - 66)) * u);
        R(x, y, 2, 3, '#4a5058');
      }
      for (let i = 0; i < 6; i++) {
        const x = bx - s * i, top = cy - 30 + i;
        R(x, top - 1, 1, 30, '#2a2c30');
        if (i > 0 && i < 5) R(x, top, 1, 28, i < 3 ? '#e6e3da' : '#c9c5ba');
      }
      R(bx - s * 2, cy - 13, 1, 8, '#d8452e'); R(bx - s * 1, cy - 14, 1, 8, '#d8452e');
      R(bx + s * 1, cy - 1, s * 4, 2, '#b8421f');
      R(cx - 6, cy - 2, 13, 1, '#b8421f');
      R(cx - 7, cy - 1, 1, 2, '#e8622a'); R(cx + 7, cy - 1, 1, 2, '#e8622a');
    }
    if (part === 'all' || part === 'front') {
      // chain net: stiff, shorter, rattles on a make
      const st = net > 0 ? Math.sin(net * Math.PI) : 0;
      const len = 8 + Math.round(st * 2), sway = Math.round(Math.sin(net * Math.PI * 4) * st * 2);
      for (let j = 0; j < len; j++) {
        const u = j / (len - 1), half = Math.round(6 - 2 * u), ox = Math.round(sway * u);
        for (let x = -half; x <= half; x += 2) { ctx.fillStyle = (j % 2) ? '#9aa1ab' : '#d4d9e0'; ctx.fillRect(cx + x + ox + (j % 2), cy + 1 + j, 1, 1); }
      }
      R(cx - 6, cy + 1, 13, 1, '#ff7a33'); R(cx - 7, cy, 1, 1, '#ff7a33'); R(cx + 7, cy, 1, 1, '#ff7a33');
      R(cx - 5, cy + 2, 11, 1, '#b8421f');
    }
    return { cx, cy };
  }
}
