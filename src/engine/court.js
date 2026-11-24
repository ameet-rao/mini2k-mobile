// Court geometry in feet (pure). Origin = top-left corner, x along the length (0..94), y across (0..50).

export const COURT = {
  L: 94, W: 50,
  HOOP: 5.25,        // hoop center from the baseline
  THREE_R: 23.75,
  CORNER_D: 22,      // corner three: distance from the hoop line (y = 25 +- 22)
  CORNER_X: 14,      // corner three line runs this far from the baseline
  PAINT_W: 16, PAINT_L: 19,
  FT_R: 6, RA_R: 4, CENTER_R: 6,
  RIM_RANGE: 7,      // inside this = layup/dunk
};

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const distE = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function hoopPos(right) {
  return { x: right ? COURT.L - COURT.HOOP : COURT.HOOP, y: COURT.W / 2 };
}

/** Shot type from where the shooter stands. */
export function shotZone(x, y, hoop) {
  const d = Math.hypot(x - hoop.x, y - hoop.y);
  const fromBase = hoop.x > COURT.L / 2 ? COURT.L - x : x;
  const dy = Math.abs(y - COURT.W / 2);
  let type;
  if (d <= COURT.RIM_RANGE) type = 'rim';
  else if (d >= COURT.THREE_R || (dy >= COURT.CORNER_D && fromBase <= COURT.CORNER_X)) type = 'three';
  else type = 'mid';
  return { type, dist: d };
}

/** Closest point of p to segment a->b: u in [0,1] along the segment, dd = distance. */
export function segPoint(a, b, p) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let u = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  u = Math.max(0, Math.min(1, u));
  return { u, dd: Math.hypot(a.x + vx * u - p.x, a.y + vy * u - p.y) };
}
