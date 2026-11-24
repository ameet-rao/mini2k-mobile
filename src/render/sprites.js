// Looks (who wears what) and the baked-frame cache.
// A frame is rasterized once per (look, animation, frame index), cropped to its bounding box and
// kept as a small canvas; drawing is then a single integer-positioned blit (mirrored for facing left).
import { CELL, AX, AY, makeLook, rasterize } from './rig.js';
import { ANIMS, samplePose, frameCount, frameAt } from './anims.js';

// Original kit designs: home wears the team colour, away wears white.
export const KITS = {
  PHI: { home: { jersey: '#1565c0', trim: '#e8344e', number: '#ffffff', shorts: '#1565c0' }, away: { jersey: '#f4f4f0', trim: '#1565c0', number: '#e8344e', shorts: '#f4f4f0' } },
  BOS: { home: { jersey: '#0b8a43', trim: '#f4f4f0', number: '#ffffff', shorts: '#0b8a43' }, away: { jersey: '#f4f4f0', trim: '#0b8a43', number: '#0b8a43', shorts: '#f4f4f0' } },
  LAL: { home: { jersey: '#f6b62a', trim: '#5b2a8c', number: '#5b2a8c', shorts: '#f6b62a' }, away: { jersey: '#f4f4f0', trim: '#5b2a8c', number: '#5b2a8c', shorts: '#f4f4f0' } },
  GSW: { home: { jersey: '#23479a', trim: '#f9c532', number: '#f9c532', shorts: '#23479a' }, away: { jersey: '#f4f4f0', trim: '#23479a', number: '#23479a', shorts: '#f4f4f0' } },
};
export const REF_KIT = { jersey: '#e9e9e9', trim: '#202024', number: '#202024', shorts: '#26262c', shoe: '#18181c', stripes: true };
export const REF_APP = { height_in: 74, build: 'avg', skin_tone: 3, hair: 'short', hair_color: 'grey', facial_hair: 'none' };

export function kitFor(teamId, home, teams) {
  const k = KITS[teamId];
  if (k) return k[home ? 'home' : 'away'];
  const c = teams?.[teamId]?.colors ?? ['#555555', '#ffffff'];
  return home ? { jersey: c[0], trim: c[1], number: '#ffffff', shorts: c[0] } : { jersey: '#f4f4f0', trim: c[0], number: c[0], shorts: '#f4f4f0' };
}

// Extra kits for the other ten teams (original designs in the team colours).
Object.assign(KITS, {
  SAS: { home: { jersey: '#2b2b2f', trim: '#c4ced4', number: '#f4f4f0', shorts: '#2b2b2f' }, away: { jersey: '#f4f4f0', trim: '#2b2b2f', number: '#2b2b2f', shorts: '#f4f4f0' } },
  OKC: { home: { jersey: '#0a7ec2', trim: '#ef3b24', number: '#ffffff', shorts: '#0a7ec2' }, away: { jersey: '#f4f4f0', trim: '#0a7ec2', number: '#ef3b24', shorts: '#f4f4f0' } },
  NYK: { home: { jersey: '#1d5fb4', trim: '#f58426', number: '#f58426', shorts: '#1d5fb4' }, away: { jersey: '#f4f4f0', trim: '#1d5fb4', number: '#f58426', shorts: '#f4f4f0' } },
  HOU: { home: { jersey: '#c8102e', trim: '#c4ced4', number: '#ffffff', shorts: '#c8102e' }, away: { jersey: '#f4f4f0', trim: '#c8102e', number: '#c8102e', shorts: '#f4f4f0' } },
  WAS: { home: { jersey: '#12305e', trim: '#e31837', number: '#ffffff', shorts: '#12305e' }, away: { jersey: '#f4f4f0', trim: '#e31837', number: '#12305e', shorts: '#f4f4f0' } },
  CHI: { home: { jersey: '#ce1141', trim: '#17131a', number: '#17131a', shorts: '#ce1141' }, away: { jersey: '#f4f4f0', trim: '#ce1141', number: '#ce1141', shorts: '#f4f4f0' } },
  TOR: { home: { jersey: '#5b2d8e', trim: '#ce1141', number: '#ffffff', shorts: '#5b2d8e' }, away: { jersey: '#f4f4f0', trim: '#ce1141', number: '#5b2d8e', shorts: '#f4f4f0' } },
  CLE: { home: { jersey: '#7a0f3a', trim: '#fdbb30', number: '#fdbb30', shorts: '#7a0f3a' }, away: { jersey: '#f4f4f0', trim: '#7a0f3a', number: '#7a0f3a', shorts: '#f4f4f0' } },
  DEN: { home: { jersey: '#14315c', trim: '#fec524', number: '#fec524', shorts: '#14315c' }, away: { jersey: '#f4f4f0', trim: '#14315c', number: '#14315c', shorts: '#f4f4f0' } },
  MIA: { home: { jersey: '#1b1b1f', trim: '#c8102e', number: '#f9a01b', shorts: '#1b1b1f' }, away: { jersey: '#f4f4f0', trim: '#98002e', number: '#98002e', shorts: '#f4f4f0' } },
  POR: { home: { jersey: '#1b1b1f', trim: '#e03a3e', number: '#f4f4f0', shorts: '#1b1b1f' }, away: { jersey: '#f4f4f0', trim: '#e03a3e', number: '#1b1b1f', shorts: '#f4f4f0' } },
  LAC: { home: { jersey: '#c8102e', trim: '#1d428a', number: '#ffffff', shorts: '#c8102e' }, away: { jersey: '#f4f4f0', trim: '#1d428a', number: '#c8102e', shorts: '#f4f4f0' } },
  CHA: { home: { jersey: '#00788c', trim: '#1d1160', number: '#ffffff', shorts: '#00788c' }, away: { jersey: '#f4f4f0', trim: '#00788c', number: '#1d1160', shorts: '#f4f4f0' } },
  MIL: { home: { jersey: '#00471b', trim: '#eee1c6', number: '#eee1c6', shorts: '#00471b' }, away: { jersey: '#eee1c6', trim: '#00471b', number: '#00471b', shorts: '#eee1c6' } },
  DET: { home: { jersey: '#1d42ba', trim: '#c8102e', number: '#ffffff', shorts: '#1d42ba' }, away: { jersey: '#f4f4f0', trim: '#c8102e', number: '#1d42ba', shorts: '#f4f4f0' } },
  MIN: { home: { jersey: '#0c2340', trim: '#78be20', number: '#ffffff', shorts: '#0c2340' }, away: { jersey: '#f4f4f0', trim: '#236192', number: '#0c2340', shorts: '#f4f4f0' } },
  ATL: { home: { jersey: '#c8102e', trim: '#c1d32f', number: '#ffffff', shorts: '#c8102e' }, away: { jersey: '#f4f4f0', trim: '#c8102e', number: '#c8102e', shorts: '#f4f4f0' } },
  BKN: { home: { jersey: '#1b1b1f', trim: '#f4f4f0', number: '#f4f4f0', shorts: '#1b1b1f' }, away: { jersey: '#f4f4f0', trim: '#1b1b1f', number: '#1b1b1f', shorts: '#f4f4f0' } },
  DAL: { home: { jersey: '#00538c', trim: '#b8c4ca', number: '#ffffff', shorts: '#00538c' }, away: { jersey: '#f4f4f0', trim: '#b8c4ca', number: '#00538c', shorts: '#f4f4f0' } },
  IND: { home: { jersey: '#002d62', trim: '#fdbb30', number: '#fdbb30', shorts: '#002d62' }, away: { jersey: '#f4f4f0', trim: '#fdbb30', number: '#002d62', shorts: '#f4f4f0' } },
  MEM: { home: { jersey: '#12173f', trim: '#5d76a9', number: '#ffffff', shorts: '#12173f' }, away: { jersey: '#f4f4f0', trim: '#5d76a9', number: '#12173f', shorts: '#f4f4f0' } },
  NOP: { home: { jersey: '#0c2340', trim: '#c8102e', number: '#ffffff', shorts: '#0c2340' }, away: { jersey: '#f4f4f0', trim: '#c8102e', number: '#0c2340', shorts: '#f4f4f0' } },
  ORL: { home: { jersey: '#0077c0', trim: '#c4ced4', number: '#ffffff', shorts: '#0077c0' }, away: { jersey: '#f4f4f0', trim: '#0077c0', number: '#0077c0', shorts: '#f4f4f0' } },
  PHX: { home: { jersey: '#1d1160', trim: '#e56020', number: '#e56020', shorts: '#1d1160' }, away: { jersey: '#f4f4f0', trim: '#e56020', number: '#1d1160', shorts: '#f4f4f0' } },
  SAC: { home: { jersey: '#5a2d81', trim: '#63727a', number: '#ffffff', shorts: '#5a2d81' }, away: { jersey: '#f4f4f0', trim: '#5a2d81', number: '#5a2d81', shorts: '#f4f4f0' } },
  UTA: { home: { jersey: '#002b5c', trim: '#f9a01b', number: '#ffffff', shorts: '#002b5c' }, away: { jersey: '#f4f4f0', trim: '#002b5c', number: '#002b5c', shorts: '#f4f4f0' } },
});

const strHash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const HAIRS = ['short', 'fade', 'buzz', 'curly', 'short', 'fade', 'bald', 'afro', 'fade', 'short'];
const FACES = ['none', 'stubble', 'goatee', 'stubble', 'none', 'full'];
const LIGHT_HAIR = ['brown', 'darkbrown', 'blond', 'brown', 'black'];

/**
 * Appearance for a player. Height is his real listed height (to scale: a 7-4 center towers over a
 * 6-0 guard), skin tone comes from the per-player `tones` table, build from his strength rating,
 * and hair from his `stars` / `looks` entry or a fixed hash of his id.
 */
export function appearanceFor(player, appearance) {
  const g = appearance.generic;
  const own = appearance.stars?.[player.id] ?? appearance.looks?.[player.id] ?? null;
  const h = strHash(player.id);
  const tone = appearance.tones?.[player.id] ?? own?.skin_tone ?? g.skin_tone;
  const str = player.attrs?.strength ?? 60;
  const base = {
    ...g,
    build: str >= 90 && (player.pos === 'C' || player.pos === 'PF') ? 'heavy' : str >= 74 ? 'strong' : str <= 44 ? 'lean' : 'avg',
    hair: HAIRS[h % HAIRS.length], facial_hair: FACES[(h >>> 5) % FACES.length],
    hair_color: tone <= 2 ? LIGHT_HAIR[(h >>> 9) % LIGHT_HAIR.length] : 'black',
    headband: (h >>> 13) % 9 === 0, wristbands: (h >>> 17) % 4 === 0,
  };
  return {
    ...base, ...own, skin_tone: tone,
    height_in: player.height_in ?? own?.height_in ?? g.height_by_pos?.[player.pos] ?? 78,
  };
}

export function lookFor(player, appearance, kit) {
  return makeLook(appearanceFor(player, appearance), kit, player.number);
}

const mkCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

export class SpriteBank {
  constructor() { this.cache = new Map(); this.baked = 0; }

  /** Baked frame `idx` of `animName` for `look`, facing right or (`left`) left. */
  frameIdx(look, animName, idx, left = false) {
    const key = `${look.key}|${animName}|${idx}|${left ? 1 : 0}`;
    let f = this.cache.get(key);
    if (f) return f;
    const anim = ANIMS[animName] ?? ANIMS.idle;
    const n = frameCount(anim);
    const t = anim.loop ? (idx / n) * anim.dur : (idx / (n - 1)) * anim.dur;
    const pose = samplePose(anim, t);
    const mir = left !== !!pose.flip;
    const r = rasterize(look, pose, mir);   // numbers are pre-mirrored so they read correctly
    let x0 = CELL, y0 = CELL, x1 = -1, y1 = -1;
    const d = r.data;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (d[(y * CELL + x) * 4 + 3]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const cv = mkCanvas(w, h), cx = cv.getContext('2d');
    const img = cx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = mir ? x1 - x : x0 + x, so = ((y + y0) * CELL + sx) * 4, o = (y * w + x) * 4;
      img.data[o] = d[so]; img.data[o + 1] = d[so + 1]; img.data[o + 2] = d[so + 2]; img.data[o + 3] = d[so + 3];
    }
    cx.putImageData(img, 0, 0);
    const m = (p) => [mir ? -p[0] : p[0], p[1]];
    f = { img: cv, w, h, ox: mir ? AX - x1 - 1 : x0 - AX, oy: y0 - AY, handF: m(r.handF), handB: m(r.handB), head: m(r.head), hip: m(r.hip), ball: pose.ball, lift: pose.lift, dir: mir ? -1 : 1 };
    this.cache.set(key, f); this.baked++;
    return f;
  }

  frame(look, animName, t, left = false) {
    const anim = ANIMS[animName] ?? ANIMS.idle;
    return this.frameIdx(look, anim.name, frameAt(anim, t), left);
  }

  /** Blit a frame with its feet at integer (x, y). */
  draw(ctx, f, x, y) {
    ctx.drawImage(f.img, Math.round(x) + f.ox, Math.round(y) + f.oy);
  }

  /** Hand/ball anchor as a screen offset from the feet (already mirrored). */
  anchor(f, which) {
    if (which === '2') return [(f.handF[0] + f.handB[0]) / 2 + f.dir, (f.handF[1] + f.handB[1]) / 2];
    return which === 'B' ? f.handB : which === 'head' ? f.head : f.handF;
  }
}
