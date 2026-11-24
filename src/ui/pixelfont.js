// Turns the game's bitmap fonts (src/render/font.js) into real web fonts at load time, so the HTML
// menus use the exact same pixel letters as the canvas HUD. No font files and no dependencies: we
// write a tiny TrueType file in memory (one square outline per run of lit pixels) and hand it to
// the FontFace API. Two families:
//   "Mini2K Pixel" (the 5x7 "big" font) and "Mini2K Tiny" (the 3x5 "tiny" font).
// Each font pixel is 1/10 em, so font-size 20px draws 2x2 screen pixels per font pixel. Use font
// sizes that are multiples of 10px to keep the pixels crisp.
import { GLYPHS } from '../render/font.js';

// Characters the canvas fonts never needed but the menus use.
const EXTRA_BIG = {
  '&': '01100,10010,10100,01000,10101,10010,01101', '=': '000,000,111,000,111,000,000', '"': '101,101,000,000,000,000,000',
  _: '00000,00000,00000,00000,00000,00000,11111', '[': '11,10,10,10,10,10,11', ']': '11,01,01,01,01,01,11',
  '*': '00000,10101,01110,11111,01110,10101,00000', '|': '1,1,1,1,1,1,1', ';': '00,00,01,00,00,01,10',
  '—': '00000,00000,00000,11111,00000,00000,00000', '–': '0000,0000,0000,1111,0000,0000,0000', '×': '000,000,101,010,101,000,000',
  '$': '00100,01111,10100,01110,00101,11110,00100', '@': '01110,10001,10111,10101,10111,10000,01111',
};
const EXTRA_TINY = {
  '&': '010,101,010,101,011', '=': '000,111,000,111,000', '"': '101,101,000,000,000', _: '000,000,000,000,111',
  '[': '11,10,10,10,11', ']': '11,01,01,01,11', '*': '101,010,101,000,000', '|': '1,1,1,1,1', ';': '0,1,0,1,1',
  '—': '000,000,111,000,000', '–': '000,000,111,000,000', '×': '000,101,010,101,000', '$': '011,110,010,011,110', '@': '111,101,111,100,111',
};

const P = 100;                       // font units per font pixel
const EM = 10 * P;

function glyphRuns(rows) {
  // One rectangle per horizontal run of lit pixels, clockwise, y up from the baseline.
  const h = rows.length, runs = [];
  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let k = 0; k < row.length;) {
      if (row[k] !== '1') { k++; continue; }
      let e = k; while (e < row.length && row[e] === '1') e++;
      const y0 = (h - 1 - r) * P, y1 = y0 + P, x0 = k * P, x1 = e * P;
      runs.push([[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
      k = e;
    }
  }
  return runs;
}

function glyf(runs) {
  if (!runs.length) return new Uint8Array(0);
  const pts = runs.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const n = pts.length;
  const out = new DataView(new ArrayBuffer(10 + runs.length * 2 + 2 + n + n * 4 + 3));
  let o = 0;
  const i16 = (v) => { out.setInt16(o, v); o += 2; };
  i16(runs.length); i16(Math.min(...xs)); i16(Math.min(...ys)); i16(Math.max(...xs)); i16(Math.max(...ys));
  runs.forEach((_, i) => i16(i * 4 + 3));
  i16(0);                                            // no instructions
  for (let i = 0; i < n; i++) out.setUint8(o++, 0x01); // on-curve, 16-bit deltas
  let px = 0; for (const [x] of pts) { i16(x - px); px = x; }
  let py = 0; for (const [, y] of pts) { i16(y - py); py = y; }
  const len = (o + 3) & ~3;
  return new Uint8Array(out.buffer, 0, len);
}

class W {
  constructor(n) { this.v = new DataView(new ArrayBuffer(n)); this.o = 0; }
  u8(x) { this.v.setUint8(this.o, x); this.o += 1; return this; }
  u16(x) { this.v.setUint16(this.o, x); this.o += 2; return this; }
  i16(x) { this.v.setInt16(this.o, x); this.o += 2; return this; }
  u32(x) { this.v.setUint32(this.o, x >>> 0); this.o += 4; return this; }
  bytes() { return new Uint8Array(this.v.buffer); }
}

function buildTTF(family, set, extra) {
  const map = { ...Object.fromEntries(Object.entries(set)), ...extra };
  const chars = Object.keys(map).filter((c) => c.length === 1);
  const rowsOf = (c) => map[c].split(',');
  const height = rowsOf('A').length;
  // glyph 0 = .notdef (a hollow box), then one glyph per character
  const box = Array.from({ length: height }, (_, r) => (r === 0 || r === height - 1 ? '111' : '101'));
  const glyphs = [{ rows: box }, ...chars.map((c) => ({ c, rows: rowsOf(c) }))];
  const data = glyphs.map((g) => glyf(glyphRuns(g.rows)));
  const adv = glyphs.map((g) => (g.rows[0].length + 1) * P);
  const lsb = glyphs.map((g) => { const r = glyphRuns(g.rows); return r.length ? Math.min(...r.flat().map((p) => p[0])) : 0; });

  // cmap: each char, plus lower-case and accented letters mapped to their capital
  const cmap = new Map();
  chars.forEach((c, i) => cmap.set(c.codePointAt(0), i + 1));
  for (let cp = 0x20; cp < 0x250; cp++) {
    if (cmap.has(cp)) continue;
    const base = String.fromCodePoint(cp).normalize('NFD')[0].toUpperCase();
    const gid = chars.indexOf(base);
    if (gid >= 0) cmap.set(cp, gid + 1);
  }
  cmap.set(0xa0, chars.indexOf(' ') + 1);            // nbsp
  const codes = [...cmap.keys()].filter((c) => c < 0xffff).sort((a, b) => a - b);

  const segs = codes.length + 1;
  const sr = 2 ** Math.floor(Math.log2(segs)) * 2;
  const cm = new W(12 + 16 + segs * 8);
  cm.u16(0).u16(1).u16(3).u16(1).u32(12);           // one subtable: Windows Unicode BMP
  cm.u16(4).u16(16 + segs * 8).u16(0).u16(segs * 2).u16(sr).u16(Math.log2(sr / 2)).u16(segs * 2 - sr);
  for (const c of codes) cm.u16(c); cm.u16(0xffff);
  cm.u16(0);
  for (const c of codes) cm.u16(c); cm.u16(0xffff);
  for (const c of codes) cm.u16((cmap.get(c) - c) & 0xffff); cm.u16(1);
  for (let i = 0; i < segs; i++) cm.u16(0);

  const glyfLen = data.reduce((s, d) => s + d.length, 0);
  const glyfT = new Uint8Array(glyfLen); const loca = new W((glyphs.length + 1) * 4);
  let off = 0; data.forEach((d) => { loca.u32(off); glyfT.set(d, off); off += d.length; }); loca.u32(off);

  const allPts = glyphs.map((g) => glyphRuns(g.rows));
  const maxPts = Math.max(...allPts.map((r) => r.length * 4)), maxCont = Math.max(...allPts.map((r) => r.length));
  const ascent = (height + 2) * P, descent = 2 * P, maxW = Math.max(...adv);

  const head = new W(54);
  head.u32(0x10000).u32(0x10000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(EM).u32(0).u32(0).u32(0).u32(0)
    .i16(0).i16(0).i16(maxW).i16(height * P).u16(0).u16(6).i16(2).i16(1).i16(0);
  const hhea = new W(36);
  hhea.u32(0x10000).i16(ascent).i16(-descent).i16(0).u16(maxW).i16(0).i16(0).i16(maxW).i16(1).i16(0).i16(0)
    .i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length);
  const maxp = new W(32);
  maxp.u32(0x10000).u16(glyphs.length).u16(maxPts).u16(maxCont).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  const hmtx = new W(glyphs.length * 4);
  glyphs.forEach((_, i) => hmtx.u16(adv[i]).i16(lsb[i]));
  const os2 = new W(96);
  os2.u16(4).i16(Math.round(adv.reduce((a, b) => a + b, 0) / adv.length)).u16(400).u16(5).u16(0)
    .i16(EM / 2).i16(EM / 2).i16(0).i16(P).i16(EM / 2).i16(EM / 2).i16(0).i16(4 * P).i16(P).i16(3 * P).i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  os2.u32(3).u32(0).u32(0).u32(0).u8(77).u8(50).u8(75).u8(32).u16(0x40).u16(codes[0]).u16(codes[codes.length - 1])
    .i16(ascent).i16(-descent).i16(0).u16(ascent).u16(descent).u32(1).u32(0).i16(height * P).i16(height * P).u16(0).u16(32).u16(1);
  const names = [[1, family], [2, 'Regular'], [3, `${family} Regular`], [4, family], [6, family.replace(/\s/g, '')]];
  const strLen = names.reduce((s, [, t]) => s + t.length * 2, 0);
  const name = new W(6 + names.length * 12 + strLen);
  name.u16(0).u16(names.length).u16(6 + names.length * 12);
  let so = 0;
  for (const [id, t] of names) { name.u16(3).u16(1).u16(0x409).u16(id).u16(t.length * 2).u16(so); so += t.length * 2; }
  for (const [, t] of names) for (const ch of t) name.u16(ch.charCodeAt(0));
  const post = new W(32);
  post.u32(0x30000).u32(0).i16(-P).i16(P).u32(0).u32(0).u32(0).u32(0).u32(0);

  const tables = { 'OS/2': os2.bytes(), cmap: cm.bytes(), glyf: glyfT, head: head.bytes(), hhea: hhea.bytes(), hmtx: hmtx.bytes(), loca: loca.bytes(), maxp: maxp.bytes(), name: name.bytes(), post: post.bytes() };
  const tags = Object.keys(tables).sort();
  const pad = (n) => (n + 3) & ~3;
  const total = 12 + tags.length * 16 + tags.reduce((s, t) => s + pad(tables[t].length), 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  const es = Math.floor(Math.log2(tags.length)), srt = 2 ** es * 16;
  dv.setUint32(0, 0x10000); dv.setUint16(4, tags.length); dv.setUint16(6, srt); dv.setUint16(8, es); dv.setUint16(10, tags.length * 16 - srt);
  const sum = (bytes) => { let s = 0; const d = new DataView(bytes.buffer, bytes.byteOffset); for (let i = 0; i < pad(bytes.length); i += 4) s = (s + (i + 4 <= bytes.length ? d.getUint32(i) : [0, 1, 2, 3].reduce((a, k) => (a << 8) | (bytes[i + k] ?? 0), 0) >>> 0)) >>> 0; return s; };
  let at = 12 + tags.length * 16, headAt = 0;
  tags.forEach((t, i) => {
    const b = tables[t], r = 12 + i * 16;
    for (let k = 0; k < 4; k++) dv.setUint8(r + k, t.charCodeAt(k));
    dv.setUint32(r + 4, sum(b)); dv.setUint32(r + 8, at); dv.setUint32(r + 12, b.length);
    out.set(b, at); if (t === 'head') headAt = at;
    at += pad(b.length);
  });
  dv.setUint32(headAt + 8, (0xb1b0afba - sum(out)) >>> 0);
  return out.buffer;
}

/** Register both pixel fonts with the page. Resolves when they are ready (or failed: CSS falls back). */
export async function loadPixelFonts() {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
  try {
    const faces = [new FontFace('Mini2K Pixel', buildTTF('Mini2K Pixel', GLYPHS.big, EXTRA_BIG)),
      new FontFace('Mini2K Tiny', buildTTF('Mini2K Tiny', GLYPHS.tiny, EXTRA_TINY))];
    for (const f of faces) { await f.load(); document.fonts.add(f); }
    document.documentElement.classList.add('px-ready');
    return true;
  } catch (e) {
    console.warn('pixel font failed, using fallback', e);
    document.documentElement.classList.add('px-ready');
    return false;
  }
}

export { buildTTF };
