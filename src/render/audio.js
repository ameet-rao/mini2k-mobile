// Procedural sound (WebAudio, no files): dribble, squeaks, swish, rim, whistle, buzzer and a crowd
// bed that swells with the action. Created lazily on the first key press / click (browser policy).
export class Sound {
  constructor(settings) {
    this.settings = settings; this.ctx = null; this.crowdGain = null; this.last = {};
    const arm = () => this.init();
    window.addEventListener('keydown', arm, { once: true });
    window.addEventListener('pointerdown', arm, { once: true });
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.connect(c.destination);
      // 2 s of noise, reused by everything noisy
      const buf = this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.985 * b0 + 0.15 * w; d[i] = b0 * 2.2 + w * 0.08; }
      // crowd bed
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.5;
      this.crowdGain = c.createGain(); this.crowdGain.gain.value = 0;
      src.connect(bp); bp.connect(this.crowdGain); this.crowdGain.connect(this.master); src.start();
      this.apply();
    } catch { this.ctx = null; }
  }

  apply() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.audio ? this.settings.volume : 0;
  }

  /** Crowd level 0..1 (called every frame). */
  crowd(level, active) {
    if (!this.ctx) return;
    const g = active && this.settings.crowd ? 0.05 + 0.3 * level : 0;
    this.crowdGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.25);
  }

  tone(type, f0, f1, dur, gain, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  burst(filter, freq, q, dur, gain, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  play(type) {
    if (!this.ctx || !this.settings.audio) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime, min = { bounce: 0.09, squeak: 0.12, whistle: 0.4, rim: 0.1 }[type] ?? 0.03;
    if (now - (this.last[type] ?? -9) < min) return;
    this.last[type] = now;
    switch (type) {
      case 'bounce': this.tone('sine', 110, 48, 0.09, 0.5); this.burst('lowpass', 300, 0.7, 0.05, 0.25); break;
      case 'squeak': this.tone('sawtooth', 2400 + Math.random() * 700, 3300, 0.06, 0.05); break;
      case 'pass': case 'release': this.burst('bandpass', 1400, 0.8, 0.07, 0.12); break;
      case 'catch': this.tone('sine', 180, 90, 0.05, 0.25); break;
      case 'swish': this.burst('highpass', 3200, 0.7, 0.3, 0.42); break;
      case 'rim': this.tone('triangle', 520, 470, 0.22, 0.3); this.tone('square', 783, 760, 0.12, 0.07); break;
      case 'block': case 'contact': this.burst('lowpass', 500, 0.8, 0.12, 0.5); break;
      case 'dunk': this.burst('lowpass', 260, 0.9, 0.3, 0.9); this.tone('triangle', 300, 120, 0.3, 0.4); this.burst('highpass', 3000, 0.7, 0.25, 0.3, 0.05); break;
      case 'steal': this.burst('bandpass', 900, 1, 0.08, 0.3); break;
      case 'whistle': this.tone('square', 2350, 2300, 0.32, 0.09); this.tone('square', 2110, 2080, 0.32, 0.07); break;
      case 'buzzer': this.tone('sawtooth', 196, 196, 1.1, 0.3); this.tone('square', 98, 98, 1.1, 0.2); break;
      case 'cheer': this.burst('bandpass', 1100, 0.4, 1.4, 0.5); break;
      case 'sub': this.tone('sine', 660, 880, 0.12, 0.12); break;
      case 'green': this.tone('sine', 880, 1760, 0.12, 0.35); this.tone('triangle', 1320, 2640, 0.08, 0.2, 0.03); break;
    }
  }
}
