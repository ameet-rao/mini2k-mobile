// Keyboard input -> the engine's input intent object.
//   move: WASD / arrows   sprint: Shift   shoot / hands up: Space (hold, release to shoot)
//   pass: E   switch defender: Q   steal: F   dribble move: C   spin: V   pause: P or Esc

const MOVE = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const EDGE = { KeyE: 'pass', KeyQ: 'swap', KeyF: 'steal', KeyT: 'timeout', KeyR: 'pick', KeyC: 'move', KeyV: 'spin' };
const BLOCK = new Set([...Object.keys(MOVE), ...Object.keys(EDGE), 'Space', 'ShiftLeft', 'ShiftRight']);

export class Keyboard {
  constructor(target = window) {
    this.down = new Set();
    this.edges = { pass: false, swap: false, steal: false, timeout: false, pick: false, move: false, spin: false };
    this.onPause = null;
    this.turned = null;        // () => true while the StreetBall camera is turned round (directions follow the screen)
    this._kd = (e) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (BLOCK.has(e.code)) e.preventDefault();
      if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) { this.onPause?.(); return; }
      if (e.repeat) return;
      this.down.add(e.code);
      if (EDGE[e.code]) this.edges[EDGE[e.code]] = true;
    };
    this._ku = (e) => { this.down.delete(e.code); };
    this._blur = () => { this.down.clear(); };
    target.addEventListener('keydown', this._kd);
    target.addEventListener('keyup', this._ku);
    target.addEventListener('blur', this._blur);
  }

  /** Current intent. Edge buttons (pass/swap/steal) stay set until clearEdges(). */
  snapshot() {
    let mx = 0, my = 0;
    for (const code of this.down) {
      const m = MOVE[code];
      if (m) { mx += m[0]; my += m[1]; }
    }
    if (this.turned?.()) { mx = -mx; my = -my; }
    return {
      mx: Math.sign(mx) || 0, my: Math.sign(my) || 0,
      sprint: this.down.has('ShiftLeft') || this.down.has('ShiftRight'),
      shoot: this.down.has('Space'),
      pass: this.edges.pass, swap: this.edges.swap, steal: this.edges.steal, timeout: this.edges.timeout, pick: this.edges.pick, move: this.edges.move, spin: this.edges.spin,
    };
  }

  clearEdges() { this.edges.pass = this.edges.swap = this.edges.steal = this.edges.timeout = this.edges.pick = this.edges.move = this.edges.spin = false; }
}
