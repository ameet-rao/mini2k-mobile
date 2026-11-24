// Broadcast camera and the single world -> screen projection.
// World: feet, x along the court (0..94), y across (0 = far sideline, 50 = near sideline), z up.
// Screen: 640x360. The court is a mild trapezoid: the far sideline is drawn at 94% of the near width.

export const SW = 640, SH = 360;
export const FAR_Y = 182, NEAR_Y = 318;      // screen rows of the far and near sidelines
export const PXFT = 8.52;                     // horizontal pixels per foot at the near sideline (= sprite scale)
export const ZPX = 8.52;                      // vertical pixels per foot of height
export const ROW = (NEAR_Y - FAR_Y) / 50;     // screen rows per foot of court depth
export const K_FAR = 0.94;

export const depthK = (y) => K_FAR + (1 - K_FAR) * (y / 50);

export class Camera {
  constructor() { this.x = 47; this.tx = 47; this.zoom = 1; this.view = 1; this.vx = 0; this.rot = 0; this.rcx = 70.5; this.rcy = 25; }

  /**
   * StreetBall swivel: the camera turns `rot` radians around the middle of the half court (rcx, rcy).
   * Turning the camera = turning the world the other way, so world feet are rotated before projecting.
   * rot 0 (every other mode) leaves every point exactly as it was.
   */
  rw(x, y) {
    if (!this.rot) return [x, y];
    const c = Math.cos(this.rot), s = Math.sin(this.rot), dx = x - this.rcx, dy = y - this.rcy;
    return [this.rcx + c * dx - s * dy, this.rcy + s * dx + c * dy];
  }

  /** Screen row of a floor point. */
  fy(x, y) { return this.project(x, y, 0)[1]; }

  /** World feet visible on each side of the centre at the near sideline. */
  get half() { return SW / 2 / (PXFT * this.zoom * this.view); }   // view = whole-picture zoom (see Broadcast.present)

  clampX(x) { const m = this.half - 9; return Math.max(m, Math.min(94 - m, x)); }

  /** Follow a target (feet) with smoothing; the stored position stays fractional, draws are rounded. */
  follow(tx, dt, rate = 3.2) {
    this.tx = this.clampX(tx);
    const k = 1 - Math.exp(-rate * dt);
    this.x += (this.tx - this.x) * k;
  }

  snap(tx) { this.tx = this.x = this.clampX(tx); }

  /** Feet -> screen pixels (fractional; callers round). */
  project(x, y, z = 0) {
    if (this.rot) [x, y] = this.rw(x, y);
    const k = depthK(y) * PXFT * this.zoom;
    return [SW / 2 + (x - this.x) * k, FAR_Y + y * ROW - z * ZPX];
  }

  sx(x, y) { if (this.rot) [x, y] = this.rw(x, y); return SW / 2 + (x - this.x) * depthK(y) * PXFT * this.zoom; }
  sy(y, z = 0) { return FAR_Y + y * ROW - z * ZPX; }
}
