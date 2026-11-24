// Procedural pixel-art character generator.
// A pose (joint angles) is rasterized into a 96x96 cell as capsules of "materials", then
// palette-mapped, 2-tone shaded (light from the top-left) and given a 1px dark outline.
// Everything is drawn facing right; the renderer mirrors the baked frame to face left.
//
// Angles are degrees: 0 = pointing down, +90 = pointing forward (right), 180 = up, -90 = back.

export const CELL = 96, AX = 48, AY = 84;      // sprite cell, feet anchor
export const PX_PER_IN = 0.71;

// materials
const M = { skin: 1, skinB: 2, jersey: 3, trim: 4, shorts: 5, shortsTrim: 6, shoe: 7, sock: 8, hair: 9, band: 10, num: 11, beard: 12, eye: 13, wrist: 14, guard: 15, jerseyB: 16, shortsB: 17, shoeB: 18, stubble: 19, stripe: 20, sole: 21 };
// parts (for inner lines)
const PT = { armB: 1, legB: 2, legF: 3, torso: 4, head: 5, armF: 6 };

const SKIN = [null, ['#f3c9a5', '#d9a57e'], ['#e3b088', '#c48d64'], ['#c98d5e', '#a86f44'], ['#a8713f', '#87552b'], ['#82532c', '#643d1e'], ['#5e3a20', '#462a16']];
const HAIR = { black: '#17131a', darkbrown: '#3a2618', brown: '#6b4526', blond: '#c9a35a', grey: '#8d8d93' };
const BUILD = {
  lean: { torso: 5.0, arm: 1.5, thigh: 2.3, shin: 1.6 },
  avg: { torso: 5.5, arm: 1.7, thigh: 2.6, shin: 1.75 },
  strong: { torso: 6.2, arm: 2.0, thigh: 2.9, shin: 1.95 },
  heavy: { torso: 6.9, arm: 2.1, thigh: 3.2, shin: 2.1 },
};
const OUTLINE = [26, 20, 34, 255];

export const BASE_POSE = {
  lean: 4, head: 0, aF: [-3, 12], aB: [-8, 12], lF: [8, 6], lB: [-6, 6],
  lift: 0, dx: 0, rootY: null, flip: false, ball: null, ikB: null,
};

const rad = (d) => d * Math.PI / 180;
const dir = (a) => [Math.sin(rad(a)), Math.cos(rad(a))];
const DIGITS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
};

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const dark = (c, k = 0.72) => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];

/** Resolve a look (appearance entry + kit + number) into a palette and proportions. */
export function makeLook(app, kit, number) {
  const H = (app.height_in ?? 78) * PX_PER_IN;
  const b = BUILD[app.build] ?? BUILD.avg;
  const skin = SKIN[app.skin_tone ?? 3];
  const jersey = hexRgb(kit.jersey), shorts = hexRgb(kit.shorts ?? kit.jersey), trim = hexRgb(kit.trim), num = hexRgb(kit.number);
  const s0 = hexRgb(skin[0]), s1 = hexRgb(skin[1]);
  const hair = hexRgb(HAIR[app.hair_color] ?? HAIR.black);
  const shoe = hexRgb(kit.shoe ?? app.shoe_color ?? '#f2f2f2');
  const pal = [];
  const lite = (c) => [Math.min(255, Math.round(c[0] * 1.12 + 10)), Math.min(255, Math.round(c[1] * 1.12 + 10)), Math.min(255, Math.round(c[2] * 1.12 + 10))];
  const set = (m, base, shade) => { pal[m] = [base, shade ?? dark(base), lite(base)]; };
  set(M.skin, s0, s1); set(M.skinB, s1, dark(s1, 0.82));
  set(M.jersey, jersey); set(M.jerseyB, dark(jersey, 0.8)); set(M.trim, trim);
  set(M.shorts, shorts); set(M.shortsB, dark(shorts, 0.8)); set(M.shortsTrim, trim);
  set(M.shoe, shoe); set(M.shoeB, dark(shoe, 0.8)); set(M.sock, [240, 240, 240]);
  set(M.hair, hair, dark(hair, 0.8)); set(M.beard, hair, dark(hair, 0.8));
  set(M.stubble, [Math.round((s1[0] + hair[0]) / 2), Math.round((s1[1] + hair[1]) / 2), Math.round((s1[2] + hair[2]) / 2)]);
  set(M.band, [245, 245, 245]); set(M.wrist, kit.stripes ? [30, 30, 34] : [245, 245, 245]);
  set(M.num, num, num); set(M.eye, [24, 18, 26], [24, 18, 26]); set(M.guard, [120, 200, 255], [120, 200, 255]);
  set(M.stripe, [28, 28, 32]); set(M.sole, [52, 48, 58], [36, 32, 42]);
  return {
    key: `${app.height_in}|${app.build}|${app.skin_tone}|${app.hair}|${app.hair_color}|${app.facial_hair}|${+!!app.headband}${+!!app.wristbands}${+!!app.mouthguard}|${kit.jersey}${kit.trim}${kit.number}${kit.shorts}${+!!kit.stripes}|${number}`,
    H, b, pal, app, number: number == null ? '' : String(number), stripes: !!kit.stripes,
    seg: { head: H * 0.082, neck: H * 0.012, torso: H * 0.27, thigh: H * 0.235, shin: H * 0.23, upper: H * 0.16, fore: H * 0.145 },
  };
}

/** Joint positions for a pose, in cell pixels. */
export function solve(look, pose) {
  const S = look.seg;
  const [tx, ty] = dir(pose.lF[0]), [sx, sy] = dir(pose.lF[0] - pose.lF[1]);
  const [ux, uy] = dir(pose.lB[0]), [vx, vy] = dir(pose.lB[0] - pose.lB[1]);
  // feet relative to the hips
  const fF = [tx * S.thigh + sx * S.shin, ty * S.thigh + sy * S.shin];
  const fB = [ux * S.thigh + vx * S.shin, uy * S.thigh + vy * S.shin];
  // Ground the lower foot unless the animation pins the root height.
  const ik = pose.ikB != null && pose.rootY == null;
  const reach = pose.rootY != null ? pose.rootY : (ik ? fF[1] : Math.max(fF[1], fB[1])) + 2;
  const hip = [AX + pose.dx, AY - reach - pose.lift];
  const kF = [hip[0] + 1 + tx * S.thigh, hip[1] + ty * S.thigh], ftF = [hip[0] + 1 + fF[0], hip[1] + fF[1]];
  let kB = [hip[0] - 1 + ux * S.thigh, hip[1] + uy * S.thigh], ftB = [hip[0] - 1 + fB[0], hip[1] + fB[1]];
  let footDirB = pose.lB[0] - pose.lB[1];
  if (ik) {
    // Planted back leg: put the foot on the floor `ikB` thigh-lengths behind the hips and bend the knee forward.
    const t = S.thigh, s = S.shin, max = t + s - 0.4, gy = Math.min(fF[1], max - 0.5);
    let gx = -pose.ikB * t;
    if (Math.hypot(gx, gy) > max) gx = -Math.sqrt(max * max - gy * gy);
    const d = Math.hypot(gx, gy), a = Math.atan2(gx, gy);
    const A = Math.acos(Math.max(-1, Math.min(1, (t * t + d * d - s * s) / (2 * t * d))));
    kB = [hip[0] - 1 + Math.sin(a + A) * t, hip[1] + Math.cos(a + A) * t];
    ftB = [hip[0] - 1 + gx, hip[1] + gy];
    footDirB = Math.atan2(ftB[0] - kB[0], ftB[1] - kB[1]) * 180 / Math.PI;
  }
  const [lx, ly] = dir(180 - pose.lean); // up, leaning forward
  const neck = [hip[0] + lx * S.torso, hip[1] + ly * S.torso];
  const [hx, hy] = dir(180 - pose.lean - pose.head);
  const head = [neck[0] + hx * (S.neck + S.head) + 0.6, neck[1] + hy * (S.neck + S.head)];
  const tw = look.b.torso;
  const shF = [neck[0] - tw * 0.8 - lx * 2, neck[1] - ly * 2 + 0.5], shB = [neck[0] + tw * 0.6 - lx * 2, neck[1] - ly * 2];
  const arm = (sh, a) => {
    const [ax, ay] = dir(a[0]), [bx, by] = dir(a[0] + a[1]);
    const el = [sh[0] + ax * S.upper, sh[1] + ay * S.upper];
    return [el, [el[0] + bx * S.fore, el[1] + by * S.fore]];
  };
  const [eF, hF] = arm(shF, pose.aF), [eB, hB] = arm(shB, pose.aB);
  return { hip, kF, ftF, kB, ftB, neck, head, shF, shB, eF, hF, eB, hB, footDirF: pose.lF[0] - pose.lF[1], footDirB };
}

/**
 * Rasterize one pose. Returns { data: Uint8ClampedArray(96*96*4), handF, handB, head } where the
 * anchors are offsets from the feet anchor (x right, y down) for a right-facing sprite.
 */
export function rasterize(look, poseIn, mirrorNum = false) {
  const pose = { ...BASE_POSE, ...poseIn };
  const J = solve(look, pose);
  const mat = new Uint8Array(CELL * CELL), part = new Uint8Array(CELL * CELL);
  const b = look.b, S = look.seg;

  const put = (x, y, m, p) => {
    if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
    const i = y * CELL + x; mat[i] = m; part[i] = p;
  };
  // tapered capsule; flat = square ends
  const seg = (p0, p1, r0, r1, m, p, flat = false, t0 = 0, t1 = 1) => {
    const x0 = p0[0], y0 = p0[1], vx = p1[0] - x0, vy = p1[1] - y0;
    const len2 = vx * vx + vy * vy || 1e-6;
    const R = Math.max(r0, r1) + 1;
    const minX = Math.floor(Math.min(x0, p1[0]) - R), maxX = Math.ceil(Math.max(x0, p1[0]) + R);
    const minY = Math.floor(Math.min(y0, p1[1]) - R), maxY = Math.ceil(Math.max(y0, p1[1]) + R);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0;
      let t = (px * vx + py * vy) / len2;
      if (flat && (t < t0 || t > t1)) continue;
      const tc = Math.max(t0, Math.min(t1, t));
      const dx = px - vx * tc, dy = py - vy * tc;
      const r = r0 + (r1 - r0) * tc;
      if (dx * dx + dy * dy <= r * r) put(x, y, m, p);
    }
  };
  const disc = (c, r, m, p) => seg(c, c, r, r, m, p);

  const leg = (hipOff, k, ft, footDir, back) => {
    const hip = [J.hip[0] + hipOff, J.hip[1]];
    const p = back ? PT.legB : PT.legF;
    const skin = back ? M.skinB : M.skin;
    seg(k, ft, b.shin + 0.25, b.shin - 0.15, skin, p);                    // shin
    seg(k, ft, b.shin + 0.3, b.shin, M.sock, p, true, 0.72, 1);          // sock
    seg(hip, k, b.thigh, b.thigh - 0.45, skin, p);                      // thigh
    seg(hip, k, b.thigh + 1.0, b.thigh + 0.75, back ? M.shortsB : M.shorts, p, true, -0.2, 0.68); // shorts leg
    seg(hip, k, b.thigh + 1.0, b.thigh + 0.75, M.shortsTrim, p, true, 0.6, 0.68);
    if (!back) seg([hip[0] - 0.6, hip[1]], [k[0] - 0.6, k[1]], 0.75, 0.75, M.shortsTrim, p, true, 0.0, 0.6);   // side stripe
    // shoe: points where the shin is not (forward), flattened on the ground
    const [fx] = dir(footDir + 90);
    const toe = [ft[0] + Math.max(0.4, fx) * 4.2, ft[1] + 0.6 + Math.max(0, -Math.cos(rad(footDir))) * 2.5];
    seg([ft[0] - 0.8, ft[1] + 0.4], toe, 1.75, 1.5, back ? M.shoeB : M.shoe, p);
    seg([ft[0] - 0.8, ft[1] + 1.9], [toe[0], toe[1] + 1.4], 0.55, 0.55, M.sole, p);                 // outsole
    seg([ft[0] + 0.4, ft[1] + 0.2], [ft[0] + 1.6, ft[1] + 0.5], 0.6, 0.6, M.trim, p);                   // colour pop on the shoe
  };
  const armDraw = (sh, el, h, back) => {
    const p = back ? PT.armB : PT.armF, skin = back ? M.skinB : M.skin;
    seg(sh, el, b.arm + 0.2, b.arm, skin, p);
    seg(el, h, b.arm, b.arm - 0.25, skin, p);
    if (look.app.wristbands) seg(el, h, b.arm + 0.1, b.arm, M.wrist, p, true, 0.62, 0.82);
    if (look.app.sleeve && !back) seg(sh, h, b.arm + 0.2, b.arm, M.stripe, p, true, 0.1, 0.5);
    disc(h, b.arm + 0.15, skin, p);
  };

  // --- back layers
  armDraw(J.shB, J.eB, J.hB, true);
  leg(-1, J.kB, J.ftB, J.footDirB, true);
  leg(1, J.kF, J.ftF, J.footDirF, false);

  // --- torso + hips
  const tw = b.torso;
  seg([J.hip[0], J.hip[1] + 1.5], J.hip, tw * 0.95, tw * 0.95, M.shorts, PT.torso, true, -1, 1); // waistband block
  seg(J.hip, J.neck, tw * 0.9, tw * 1.08, M.jersey, PT.torso, true, 0, 0.98);
  seg(J.hip, J.neck, tw * 0.75, tw * 0.5, M.jersey, PT.torso, false, 0.95, 1.0);
  // trim: collar + armhole
  const shoulderT = 0.9;
  seg(J.hip, J.neck, tw * 1.08, tw * 1.08, M.trim, PT.torso, true, shoulderT, 0.98);
  seg(J.hip, J.neck, tw * 0.9, tw * 0.9, M.shortsTrim, PT.torso, true, -0.02, 0.06); // waistband
  if (look.stripes) {
    // referee: vertical stripes
    for (let i = 0; i < mat.length; i++) if (mat[i] === M.jersey && (i % CELL) % 3 === 0) mat[i] = M.stripe;
  }
  // chest number (skipped when the torso is close to horizontal)
  if (look.number && Math.abs(pose.lean) < 50) {
    const s = look.number;
    const w = s.length * 3 + (s.length - 1);
    const lx = Math.sin(rad(180 - pose.lean)), ly = Math.cos(rad(180 - pose.lean));
    const cx = J.hip[0] + lx * S.torso * 0.6 + 0.9, cy = J.hip[1] + ly * S.torso * 0.6;
    const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - 2.5);
    for (let d = 0; d < s.length; d++) {
      const g = DIGITS[s[mirrorNum ? s.length - 1 - d : d]]; if (!g) continue;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r * 3 + (mirrorNum ? 2 - c : c)] !== '1') continue;
        const x = x0 + d * 4 + c, y = y0 + r;
        if (x >= 0 && y >= 0 && x < CELL && y < CELL && mat[y * CELL + x] === M.jersey) mat[y * CELL + x] = M.num;
      }
    }
  }

  // --- head
  const hr = S.head + 0.35, hc = J.head;
  const app = look.app;
  const headPix = (fn) => {
    const R = hr + 4;
    for (let y = Math.floor(hc[1] - R); y <= Math.ceil(hc[1] + R); y++) for (let x = Math.floor(hc[0] - R); x <= Math.ceil(hc[0] + R); x++) {
      const u = (x + 0.5 - hc[0]) / hr, v = (y + 0.5 - hc[1]) / (hr * 1.08);
      const m = fn(u, v, u * u + v * v);
      if (m) put(x, y, m, PT.head);
    }
  };
  seg(J.neck, hc, b.arm + 0.5, b.arm + 0.5, M.skin, PT.head);            // neck
  headPix((u, v, d) => (d <= 1 ? M.skin : 0));
  const hair = app.hair ?? 'short';
  headPix((u, v, d) => {
    switch (hair) {
      case 'bald': return 0;
      case 'buzz': return d <= 1 && (v < -0.5 || (u < -0.6 && v < 0.1)) ? M.hair : 0;
      case 'fade': return d <= 1 && v < -0.4 - Math.max(0, -u) * 0.0 && !(u < -0.55 && v > -0.75) ? M.hair : (d <= 1 && u < -0.55 && v < -0.1 ? M.stubble : 0);
      case 'receding': return d <= 1 && (v < -0.62 - u * 0.25 || (u < -0.45 && v < 0.05)) ? M.hair : 0;
      case 'curly': return (d <= 1.45 && v < -0.25 && (Math.floor((u + 3) * 2.1) + Math.floor((v + 3) * 2.1)) % 2 === 0) || (d <= 1 && (v < -0.3 || (u < -0.5 && v < 0.3))) ? M.hair : 0;
      case 'afro': return (d <= 2.1 && v < 0.15 && u < 0.95) ? (d <= 1 && v > -0.3 && u > -0.45 ? 0 : M.hair) : 0;
      case 'long': return (d <= 1.25 && (v < -0.3 || u < -0.45) && v < 1.05 && !(u > -0.45 && v > -0.3)) ? M.hair : 0;
      case 'bun': return (d <= 1 && (v < -0.3 || (u < -0.5 && v < 0.3))) || ((u + 0.85) ** 2 + (v + 0.95) ** 2 < 0.2) ? M.hair : 0;
      default: return d <= 1 && (v < -0.32 || (u < -0.5 && v < 0.3)) ? M.hair : 0; // short
    }
  });
  const fh = app.facial_hair ?? 'none';
  if (fh !== 'none') headPix((u, v, d) => {
    if (d > 1.02) return 0;
    if (fh === 'stubble') return v > 0.38 && u > -0.55 ? M.stubble : 0;
    if (fh === 'goatee') return v > 0.5 && u > 0.05 ? M.beard : 0;
    return v > 0.28 && u > -0.7 && !(u > 0.15 && v < 0.5 && v > 0.28 && false) ? M.beard : 0; // full
  });
  if (app.headband) headPix((u, v, d) => (d <= 1.12 && v > -0.52 && v < -0.2 ? M.band : 0));
  // face: eye + (optional) mouthguard, on the facing side
  put(Math.round(hc[0] + hr * 0.42), Math.round(hc[1] - hr * 0.12), M.eye, PT.head);
  if (app.mouthguard) put(Math.round(hc[0] + hr * 0.62), Math.round(hc[1] + hr * 0.5), M.guard, PT.head);

  // --- front arm on top
  armDraw(J.shF, J.eF, J.hF, false);

  // --- palette, shading, inner lines, outline
  const out = new Uint8ClampedArray(CELL * CELL * 4);
  const pal = look.pal;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const i = y * CELL + x, m = mat[i], o = i * 4;
    if (m) {
      const r = x + 1 < CELL ? i + 1 : i, d = y + 1 < CELL ? i + CELL : i;
      const edge = !mat[r] || !mat[d];
      const inner = (part[r] && part[r] !== part[i] && part[i] !== PT.head && part[r] !== PT.head) || (part[d] && part[d] !== part[i] && part[d] > part[i] && part[i] !== PT.head);
      // light from the top-left: rim-light pixels that face it, shade the ones that face away
      const lit = !edge && !inner && m !== M.num && m !== M.eye && ((x > 0 && !mat[i - 1]) || (y > 0 && !mat[i - CELL]) || (y > 0 && part[i - CELL] && part[i - CELL] < part[i] && part[i] !== PT.head));
      const c = pal[m][edge || inner ? 1 : lit ? 2 : 0];
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    } else if ((x > 0 && mat[i - 1]) || (x + 1 < CELL && mat[i + 1]) || (y > 0 && mat[i - CELL]) || (y + 1 < CELL && mat[i + CELL])) {
      out[o] = OUTLINE[0]; out[o + 1] = OUTLINE[1]; out[o + 2] = OUTLINE[2]; out[o + 3] = 255;
    }
  }
  const rel = (p) => [p[0] - AX, p[1] - AY];
  return { data: out, handF: rel(J.hF), handB: rel(J.hB), head: rel(J.head), hip: rel(J.hip), flip: !!pose.flip };
}
