// Every sound in the game is synthesised with Web Audio, so there are no
// files to load. A shared reverb gives the table a little room. Music is a
// slow generative tune that stays out of the way.

export type Sfx =
  | 'dice' | 'build' | 'road' | 'city' | 'gain' | 'robber' | 'steal' | 'card' | 'trade'
  | 'turn' | 'win' | 'lose' | 'error' | 'click' | 'seven' | 'award' | 'discard';

interface Settings { sfx: number; music: number }
const KEY = 'catan_sound';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  private musicTimer: number | null = null;
  private settings: Settings;
  private listeners = new Set<() => void>();

  constructor() {
    let s: Settings = { sfx: 0.8, music: 0 };
    try { s = { ...s, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { /* defaults */ }
    this.settings = s;
  }

  get sfxVolume() { return this.settings.sfx; }
  get musicVolume() { return this.settings.music; }

  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  setVolumes(v: Partial<Settings>) {
    this.settings = { ...this.settings, ...v };
    localStorage.setItem(KEY, JSON.stringify(this.settings));
    if (this.sfxBus) this.sfxBus.gain.value = this.settings.sfx;
    if (this.musicBus) this.musicBus.gain.value = this.settings.music * 0.5;
    if (this.settings.music > 0) this.startMusic(); else this.stopMusic();
    this.listeners.forEach((f) => f());
  }

  // Browsers only allow audio after a user gesture; call this from a click.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.settings.sfx;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.settings.music * 0.5;
      this.musicBus.connect(this.master);
      this.verb = this.ctx.createConvolver();
      this.verb.buffer = this.impulse(2.2, 2.5);
      const wet = this.ctx.createGain();
      wet.gain.value = 0.22;
      this.verb.connect(wet).connect(this.master);
      if (this.settings.music > 0) this.startMusic();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  private noiseBuf: AudioBuffer | null = null;
  private noise(): AudioBuffer {
    if (!this.noiseBuf) {
      const ctx = this.ctx!;
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  // ── building blocks ───────────────────────────────────────────────────────

  private out(wet = 0.3): AudioNode {
    const g = this.ctx!.createGain();
    g.connect(this.sfxBus!);
    if (wet > 0) {
      const send = this.ctx!.createGain();
      send.gain.value = wet;
      g.connect(send).connect(this.verb!);
    }
    return g;
  }

  private tone(freq: number, t: number, dur: number, opts: { type?: OscillatorType; vol?: number; attack?: number; to?: number; wet?: number; bus?: AudioNode } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const v = opts.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.bus ?? this.out(opts.wet ?? 0.3));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(t: number, dur: number, opts: { freq?: number; q?: number; vol?: number; type?: BiquadFilterType; sweepTo?: number; wet?: number } = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 2000, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const v = opts.vol ?? 0.4;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(opts.wet ?? 0.15));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // A hollow wooden knock: a pitched thump plus a short click.
  private knock(t: number, pitch = 220, vol = 0.5) {
    this.tone(pitch, t, 0.14, { type: 'triangle', vol, to: pitch * 0.6, wet: 0.2 });
    this.tone(pitch * 2.7, t, 0.05, { type: 'sine', vol: vol * 0.3, wet: 0.1 });
    this.burst(t, 0.03, { freq: 3500, q: 2, vol: vol * 0.5 });
  }

  // ── the sounds ────────────────────────────────────────────────────────────

  play(name: Sfx, opts: { count?: number } = {}) {
    if (!this.ctx || this.settings.sfx <= 0) return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'dice': {
        // Dice rattling in a cupped hand, then tumbling onto wood.
        for (let i = 0; i < 9; i++) this.burst(t + i * 0.035 + Math.random() * 0.02, 0.04, { freq: 2500 + Math.random() * 2500, q: 3, vol: 0.25 });
        let at = t + 0.38;
        let gap = 0.13;
        for (let i = 0; i < 6; i++) {
          this.knock(at, 300 + Math.random() * 180, 0.42 * (1 - i * 0.13));
          at += gap;
          gap *= 0.72;
        }
        break;
      }
      case 'build':
        this.knock(t, 190, 0.6);
        this.knock(t + 0.09, 240, 0.35);
        break;
      case 'road':
        this.knock(t, 260, 0.45);
        this.burst(t + 0.02, 0.12, { freq: 1200, sweepTo: 600, q: 0.8, vol: 0.15 });
        break;
      case 'city':
        this.knock(t, 150, 0.7);
        this.knock(t + 0.08, 190, 0.5);
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + 0.15 + i * 0.07, 0.6, { type: 'triangle', vol: 0.12, wet: 0.5 }));
        break;
      case 'gain': {
        // Soft plucks rising through a pentatonic scale, one per card.
        const scale = [523, 587, 659, 784, 880, 1047, 1175, 1319];
        const n = Math.min(opts.count ?? 1, 8);
        for (let i = 0; i < n; i++) this.tone(scale[i], t + i * 0.06, 0.35, { type: 'triangle', vol: 0.14, wet: 0.4 });
        break;
      }
      case 'card':
        this.burst(t, 0.12, { freq: 1500, sweepTo: 5000, q: 0.7, vol: 0.3, type: 'bandpass' });
        this.burst(t + 0.08, 0.06, { freq: 4000, q: 1, vol: 0.15 });
        break;
      case 'discard':
        for (let i = 0; i < 3; i++) this.burst(t + i * 0.06, 0.08, { freq: 3000, sweepTo: 1200, q: 0.8, vol: 0.2 });
        break;
      case 'trade':
        // Coins changing hands.
        [2637, 3136, 2349].forEach((f, i) => {
          this.tone(f, t + i * 0.07, 0.25, { type: 'sine', vol: 0.09, wet: 0.3 });
          this.tone(f * 1.5, t + i * 0.07, 0.12, { type: 'sine', vol: 0.04 });
        });
        break;
      case 'robber':
        [110, 131, 156].forEach((f) => this.tone(f, t, 1.2, { type: 'sawtooth', vol: 0.05, attack: 0.2, wet: 0.6 }));
        this.tone(55, t, 1, { type: 'sine', vol: 0.3, attack: 0.05 });
        break;
      case 'seven':
        this.tone(220, t, 0.5, { type: 'square', vol: 0.06, to: 110, wet: 0.5 });
        this.tone(233, t + 0.05, 0.5, { type: 'square', vol: 0.05, to: 116, wet: 0.5 });
        break;
      case 'steal':
        this.burst(t, 0.25, { freq: 800, sweepTo: 4000, q: 2, vol: 0.3, type: 'bandpass' });
        this.tone(880, t + 0.18, 0.15, { type: 'triangle', vol: 0.1, to: 1320 });
        break;
      case 'turn':
        this.tone(784, t, 0.9, { type: 'sine', vol: 0.16, wet: 0.6 });
        this.tone(1175, t + 0.1, 0.9, { type: 'sine', vol: 0.1, wet: 0.6 });
        break;
      case 'award':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.09, 0.45, { type: 'triangle', vol: 0.13, wet: 0.5 }));
        break;
      case 'win': {
        const notes = [523, 659, 784, 1047, 784, 1047, 1319];
        const times = [0, 0.15, 0.3, 0.45, 0.7, 0.85, 1.0];
        notes.forEach((f, i) => {
          this.tone(f, t + times[i], i === notes.length - 1 ? 1.6 : 0.4, { type: 'triangle', vol: 0.16, wet: 0.5 });
          this.tone(f / 2, t + times[i], 0.4, { type: 'sine', vol: 0.08 });
        });
        break;
      }
      case 'lose':
        [392, 370, 349, 330].forEach((f, i) => this.tone(f, t + i * 0.28, 0.5, { type: 'triangle', vol: 0.12, wet: 0.5 }));
        break;
      case 'error':
        this.tone(160, t, 0.15, { type: 'square', vol: 0.05, wet: 0 });
        this.tone(150, t + 0.12, 0.18, { type: 'square', vol: 0.05, wet: 0 });
        break;
      case 'click':
        this.burst(t, 0.02, { freq: 4000, q: 3, vol: 0.2, wet: 0 });
        break;
    }
  }

  // ── music ─────────────────────────────────────────────────────────────────

  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    // D dorian, played as a lazy plucked tune over a drone. A new phrase every
    // few bars, chosen at random so it never quite repeats.
    const scale = [294, 330, 349, 392, 440, 494, 523, 587, 659];
    let next = this.ctx.currentTime + 0.2;
    let bar = 0;
    const pluck = (f: number, t: number, v: number) => {
      this.tone(f, t, 1.6, { type: 'triangle', vol: v, wet: 0.7, bus: this.musicOut() });
      this.tone(f * 2, t, 0.5, { type: 'sine', vol: v * 0.25, bus: this.musicOut() });
    };
    const schedule = () => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 1.5) {
        const beat = 0.55;
        // drone every two bars
        if (bar % 2 === 0) {
          const root = [147, 131, 165, 147][Math.floor(bar / 2) % 4];
          this.tone(root, next, beat * 8, { type: 'sine', vol: 0.07, attack: 0.8, wet: 0.8, bus: this.musicOut() });
          this.tone(root * 1.5, next, beat * 8, { type: 'sine', vol: 0.035, attack: 1, wet: 0.8, bus: this.musicOut() });
        }
        let idx = 2 + Math.floor(Math.random() * 4);
        for (let b = 0; b < 4; b++) {
          if (Math.random() < 0.72) {
            pluck(scale[idx], next + b * beat, 0.08 + Math.random() * 0.04);
            if (Math.random() < 0.3) pluck(scale[Math.max(0, idx - 2)], next + b * beat + beat / 2, 0.05);
          }
          idx = Math.max(0, Math.min(scale.length - 1, idx + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
        }
        next += beat * 4;
        bar++;
      }
    };
    schedule();
    this.musicTimer = window.setInterval(schedule, 400);
  }

  private musicOut(): AudioNode {
    const g = this.ctx!.createGain();
    g.connect(this.musicBus!);
    const send = this.ctx!.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(this.verb!);
    return g;
  }

  private stopMusic() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}

export const sound = new SoundEngine();
