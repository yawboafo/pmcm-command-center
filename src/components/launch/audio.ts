"use client";

/**
 * Original score and sound design for the launch, synthesised in the browser with the Web
 * Audio API (no audio files, nothing sampled): a sub drone, a slow detuned pad, filtered
 * air, zone pulses as the camera passes, a riser into the title, the title hit and the
 * unlock chord. Everything is scheduled against the AudioContext clock so it stays in sync
 * with the intro timeline, and it only starts after a user gesture.
 */
export class LaunchAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private running = false;
  private muted = false;
  private nodes: AudioNode[] = [];

  get started() {
    return this.running;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.08);
  }

  /** Start the score at intro time `t0` (seconds). Must be called from a user gesture. */
  async start(t0 = 0) {
    if (this.running) return;
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return;
    const ctx = (this.ctx ??= new Ctor());
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    this.running = true;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.setTargetAtTime(this.muted ? 0 : 0.8, ctx.currentTime, 0.4);
    this.master = master;
    const now = ctx.currentTime;
    const at = (introSec: number) => now + Math.max(0, introSec - t0);

    // Sub drone: two detuned saws through a slow low-pass sweep.
    const drone = ctx.createGain();
    drone.gain.setValueAtTime(0, now);
    drone.gain.linearRampToValueAtTime(0.22, at(3));
    drone.gain.setValueAtTime(0.22, at(15));
    drone.gain.linearRampToValueAtTime(0.1, at(19));
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(120, now);
    lp.frequency.exponentialRampToValueAtTime(900, at(14));
    lp.Q.value = 0.8;
    for (const [freq, detune] of [[36.7, -6], [36.7, 6], [73.4, 0]] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(lp);
      o.start(now);
      this.nodes.push(o);
    }
    lp.connect(drone);
    drone.connect(master);

    // Pad: a slow D minor add9 voicing on triangles with gentle vibrato, swelling into the sweep.
    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0, now);
    pad.gain.linearRampToValueAtTime(0.1, at(5));
    pad.gain.linearRampToValueAtTime(0.16, at(12));
    pad.gain.linearRampToValueAtTime(0.05, at(19));
    const padLp = ctx.createBiquadFilter();
    padLp.type = "lowpass";
    padLp.frequency.value = 1400;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3;
    lfo.connect(lfoGain);
    lfo.start(now);
    this.nodes.push(lfo);
    for (const f of [146.8, 174.6, 220, 329.6, 293.7]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      lfoGain.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = 0.35;
      o.connect(g);
      g.connect(padLp);
      o.start(now + Math.random() * 0.4);
      this.nodes.push(o);
    }
    padLp.connect(pad);
    pad.connect(master);

    // Air: band-passed noise that opens up with the camera.
    const noise = ctx.createBufferSource();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(400, now);
    bp.frequency.exponentialRampToValueAtTime(2400, at(16));
    bp.Q.value = 0.9;
    const air = ctx.createGain();
    air.gain.setValueAtTime(0, now);
    air.gain.linearRampToValueAtTime(0.035, at(6));
    air.gain.linearRampToValueAtTime(0.05, at(14));
    air.gain.linearRampToValueAtTime(0.012, at(19));
    noise.connect(bp);
    bp.connect(air);
    air.connect(master);
    noise.start(now);
    this.nodes.push(noise);

    // Zone pulses as the camera passes each zone, then the riser and the title hit.
    for (const s of [4.2, 7.2, 10.2, 12.7]) this.pulse(at(s), 55 + Math.random() * 20);
    this.riser(at(13.2), at(16));
    this.hit(at(16.1));
  }

  private pulse(when: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 1.6, when);
    o.frequency.exponentialRampToValueAtTime(freq, when + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.35, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
    o.connect(g);
    g.connect(this.master!);
    o.start(when);
    o.stop(when + 1.2);
    // A soft tick on top.
    const tick = ctx.createOscillator();
    tick.type = "triangle";
    tick.frequency.setValueAtTime(1800, when);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, when);
    tg.gain.exponentialRampToValueAtTime(0.06, when + 0.005);
    tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
    tick.connect(tg);
    tg.connect(this.master!);
    tick.start(when);
    tick.stop(when + 0.15);
  }

  private riser(from: number, to: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    const len = Math.ceil(ctx.sampleRate * (to - from + 0.2));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(200, from);
    f.frequency.exponentialRampToValueAtTime(5000, to);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, from);
    g.gain.exponentialRampToValueAtTime(0.12, to - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, to + 0.15);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(from);
    src.stop(to + 0.2);
  }

  private hit(when: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, when);
    o.frequency.exponentialRampToValueAtTime(38, when + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.9, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
    o.connect(g);
    g.connect(this.master!);
    o.start(when);
    o.stop(when + 2.8);
    // Shimmer: a high fifth that rings out.
    for (const f of [587.3, 880]) {
      const s = ctx.createOscillator();
      s.type = "sine";
      s.frequency.value = f;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, when + 0.05);
      sg.gain.exponentialRampToValueAtTime(0.05, when + 0.3);
      sg.gain.exponentialRampToValueAtTime(0.0001, when + 3.2);
      s.connect(sg);
      sg.connect(this.master!);
      s.start(when);
      s.stop(when + 3.3);
    }
  }

  /** Unlock: a rising major triad and a soft confirmation. */
  unlock() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [[293.7, 0], [370, 0.09], [440, 0.18], [587.3, 0.3]].forEach(([f, dt]) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + dt);
      g.gain.exponentialRampToValueAtTime(0.14, now + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dt + 1.6);
      o.connect(g);
      g.connect(this.master!);
      o.start(now + dt);
      o.stop(now + dt + 1.7);
    });
  }

  /** Wrong key: a short, low, muted thud. */
  deny() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(70, now + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    o.connect(g);
    g.connect(this.master);
    o.start(now);
    o.stop(now + 0.3);
  }

  /** Fade everything out and release the graph. */
  stop(fadeSec = 1.2) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, fadeSec / 3);
    const nodes = this.nodes;
    this.nodes = [];
    setTimeout(() => {
      for (const n of nodes) {
        try {
          (n as AudioScheduledSourceNode).stop();
        } catch {
          /* already stopped */
        }
        n.disconnect();
      }
    }, fadeSec * 1000 + 100);
    this.running = false;
  }
}

let shared: LaunchAudio | null = null;
export function launchAudio() {
  return (shared ??= new LaunchAudio());
}
