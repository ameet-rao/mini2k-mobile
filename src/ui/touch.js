// Phone controls: a floating joystick on the left half of the screen and buttons on the right.
// TouchPad.snapshot() returns the same intent object as the Keyboard (src/ui/input.js), so the
// engine cannot tell them apart. Every keyboard action has a button:
//   offense: SHOOT (hold, let go to shoot; quick tap = pump fake) PASS (E) MOVE (C) SPIN (V) LOB (Q) PICK (R) SPRINT (Shift)
//   defense: BLOCK (hold = hands up / rebound) STEAL (F) SWITCH (Q) DOUBLE (R) SPRINT (Shift)
//   game:    PAUSE (P) TIMEOUT (T)
// Buttons keep the action they had when the finger went down, even if possession changes mid-press.

const DEAD = 0.18;        // joystick dead zone, as a fraction of the stick radius
const EDGES = ['pass', 'swap', 'steal', 'timeout', 'pick', 'move', 'spin'];

// slot -> [offense action, defense action]; null = hidden on that side of the ball
const SLOTS = {
  shoot: [{ hold: 'shoot', label: 'SHOOT' }, { hold: 'shoot', label: 'BLOCK' }],
  pass: [{ edge: 'pass', label: 'PASS' }, { edge: 'steal', label: 'STEAL' }],
  q: [{ edge: 'swap', label: 'LOB' }, { edge: 'swap', label: 'SWITCH' }],
  r: [{ edge: 'pick', label: 'PICK' }, { edge: 'pick', label: 'DOUBLE' }],
  move: [{ edge: 'move', label: 'MOVE' }, null],
  spin: [{ edge: 'spin', label: 'SPIN' }, null],
  sprint: [{ hold: 'sprint', label: 'SPRINT' }, { hold: 'sprint', label: 'SPRINT' }],
};

export class TouchPad {
  constructor(root, { turned } = {}) {
    this.root = root;
    this.turned = turned;
    this.on = false;
    this.offense = true;
    this.edges = Object.fromEntries(EDGES.map((k) => [k, false]));
    this.held = { shoot: 0, sprint: 0 };
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, mx: 0, my: 0 };
    this.onPause = null;
    this.onTap = null;        // tap on the court (skips the lineup card)
    this.btns = {};
    if (!root) return;
    root.innerHTML = `
      <div class="t-zone" data-zone></div>
      <div class="t-stick" hidden><i></i></div>
      <div class="t-top"><button class="t-btn t-small" data-act="pause">II</button><button class="t-btn t-small" data-act="timeout">TO</button></div>
      <div class="t-pad">
        ${Object.keys(SLOTS).map((k) => `<button class="t-btn t-${k}" data-slot="${k}"><span></span></button>`).join('')}
      </div>`;
    for (const b of root.querySelectorAll('[data-slot]')) this.btns[b.dataset.slot] = b;
    this.top = { pause: root.querySelector('[data-act=pause]'), timeout: root.querySelector('[data-act=timeout]') };
    this.zone = root.querySelector('[data-zone]');
    this.stickEl = root.querySelector('.t-stick');
    this.knob = this.stickEl.querySelector('i');
    this._wire();
    this.relabel(true);
  }

  _wire() {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    // ---- joystick: wherever the left thumb lands becomes the centre ----
    this.zone.addEventListener('pointerdown', (e) => {
      stop(e);
      if (this.stick.id !== null) return;
      this.zone.setPointerCapture?.(e.pointerId);
      Object.assign(this.stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, mx: 0, my: 0, fast: false });
      this.onTap?.();
      this._drawStick();
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      stop(e);
      this.stick.x = e.clientX; this.stick.y = e.clientY;
      this._readStick();
    });
    const end = (e) => {
      if (e.pointerId !== this.stick.id) return;
      Object.assign(this.stick, { id: null, mx: 0, my: 0, fast: false });
      this.stickEl.hidden = true; this.stickEl.classList.remove('fast');
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.zone.addEventListener('lostpointercapture', end);

    // ---- buttons ----
    for (const [slot, b] of Object.entries(this.btns)) {
      b.addEventListener('pointerdown', (e) => {
        stop(e);
        const act = SLOTS[slot][this.offense ? 0 : 1];
        if (!act) return;
        b.setPointerCapture?.(e.pointerId);
        b._act = act; b._pid = e.pointerId;
        b.classList.add('down');
        if (act.hold) this.held[act.hold]++;
        if (act.edge) this.edges[act.edge] = true;
        navigator.vibrate?.(8);
      });
      const up = (e) => {
        if (b._pid !== e.pointerId) return;
        b._pid = null;
        b.classList.remove('down');
        if (b._act?.hold) this.held[b._act.hold] = Math.max(0, this.held[b._act.hold] - 1);
        b._act = null;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.top.pause.addEventListener('pointerdown', (e) => { stop(e); this.onPause?.(); });
    this.top.timeout.addEventListener('pointerdown', (e) => { stop(e); this.edges.timeout = true; navigator.vibrate?.(8); });
  }

  _readStick() {
    const s = this.stick, R = this.radius();
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const d = Math.hypot(dx, dy);
    // the base follows the thumb if it slides far away, so the stick never "runs out"
    if (d > R * 1.4) { s.ox = s.x - dx / d * R * 1.4; s.oy = s.y - dy / d * R * 1.4; dx = s.x - s.ox; dy = s.y - s.oy; }
    const n = Math.hypot(dx, dy);
    if (n < R * DEAD) { s.mx = 0; s.my = 0; } else { s.mx = dx / n; s.my = dy / n; }
    // thumb pushed past the ring = sprint (the knob turns yellow); the SPRINT button works too
    s.fast = n > R * 1.15;
    this.stickEl.classList.toggle('fast', s.fast);
    this._drawStick();
  }

  radius() { return Math.max(34, Math.min(70, Math.min(innerWidth, innerHeight) * 0.13)); }

  _drawStick() {
    const s = this.stick, R = this.radius();
    this.stickEl.hidden = false;
    this.stickEl.style.width = this.stickEl.style.height = `${R * 2}px`;
    this.stickEl.style.left = `${s.ox - R}px`; this.stickEl.style.top = `${s.oy - R}px`;
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** Show / hide the pad (only during a game). */
  setGame(on) {
    this.on = on;
    if (!this.root) return;
    this.root.hidden = !on;
    document.documentElement.classList.toggle('ingame', on);
    if (!on) this.reset();
  }

  reset() {
    for (const k of EDGES) this.edges[k] = false;
    this.held.shoot = this.held.sprint = 0;
    Object.assign(this.stick, { id: null, mx: 0, my: 0, fast: false });
    if (this.stickEl) this.stickEl.hidden = true;
    for (const b of Object.values(this.btns)) { b._pid = null; b._act = null; b.classList.remove('down'); }
  }

  /** Called every frame with the running game: labels follow who has the ball. */
  update(L) {
    if (!this.root || !this.on) return;
    const cpu = !L?.user;
    this.root.classList.toggle('cpu', cpu);
    if (cpu) return;
    this.relabel(L.state.possession === L.user);
    const noTo = !!L.street;
    if (this.top.timeout.hidden !== noTo) this.top.timeout.hidden = noTo;
  }

  relabel(offense) {
    if (offense === this.offense && this._labelled) return;
    this.offense = offense; this._labelled = true;
    this.root.classList.toggle('def', !offense);
    for (const [slot, b] of Object.entries(this.btns)) {
      const act = SLOTS[slot][offense ? 0 : 1];
      b.classList.toggle('off', !act);
      b.firstElementChild.textContent = act ? act.label : '';
    }
  }

  snapshot() {
    let mx = this.stick.mx, my = this.stick.my;
    if (this.turned?.()) { mx = -mx; my = -my; }
    return {
      mx, my, sprint: this.held.sprint > 0 || !!this.stick.fast, shoot: this.held.shoot > 0,
      ...Object.fromEntries(EDGES.map((k) => [k, this.edges[k]])),
    };
  }

  clearEdges() { for (const k of EDGES) this.edges[k] = false; }
}

/** Keyboard + touch as one input: either one can move, any button from either counts. */
export function mergeInput(keys, touch) {
  return {
    snapshot() {
      const a = keys.snapshot(), b = touch.snapshot();
      const out = { ...a };
      if (b.mx || b.my) { out.mx = b.mx; out.my = b.my; }
      for (const k of ['sprint', 'shoot', ...EDGES]) out[k] = !!(a[k] || b[k]);
      return out;
    },
    clearEdges() { keys.clearEdges(); touch.clearEdges(); },
  };
}
