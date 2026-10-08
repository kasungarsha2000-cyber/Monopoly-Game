/**
 * AudioManager: all sounds are synthesized with the Web Audio API, so there
 * are no audio assets to download or license. Music is a soft generative pad.
 */
import { settings } from './settings';

export type Sfx = 'click' | 'dice' | 'step' | 'coin' | 'pay' | 'buy' | 'build' | 'jail' | 'card' | 'turn' | 'win' | 'error' | 'bankrupt' | 'auction';

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private unlocked = false;

  /** Create the audio graph on the first user gesture (browser autoplay rules). */
  unlock(): void {
    if (this.unlocked) {
      void this.ctx?.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.unlocked = true;
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    settings.subscribe(() => this.applyVolumes());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.ctx?.suspend();
      else void this.ctx?.resume();
    });
    this.startMusic();
  }

  applyVolumes(): void {
    const s = settings.get();
    if (!this.master || !this.sfxGain || !this.musicGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05);
    this.sfxGain.gain.setTargetAtTime(s.effectsVolume, t, 0.05);
    this.musicGain.gain.setTargetAtTime(s.musicVolume * 0.35, t, 0.2);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, endFreq?: number, dest?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest ?? (this.sfxGain as GainNode));
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private noiseBurst(start: number, dur: number, vol: number, freq = 2000): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain as GainNode);
    src.start(start, Math.random() * 0.3);
    src.stop(start + dur + 0.02);
  }

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'click':
        this.tone(660, t, 0.05, 'sine', 0.15);
        break;
      case 'step':
        this.tone(900, t, 0.06, 'triangle', 0.12, 700);
        break;
      case 'dice':
        for (let i = 0; i < 6; i++) this.noiseBurst(t + i * 0.09 + Math.random() * 0.03, 0.05, 0.35, 2500 + Math.random() * 1500);
        break;
      case 'coin':
        this.tone(988, t, 0.09, 'triangle', 0.22);
        this.tone(1319, t + 0.08, 0.16, 'triangle', 0.22);
        break;
      case 'pay':
        this.tone(660, t, 0.1, 'triangle', 0.18);
        this.tone(440, t + 0.09, 0.16, 'triangle', 0.18);
        break;
      case 'buy':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.07, 0.18, 'triangle', 0.2));
        break;
      case 'build':
        this.tone(140, t, 0.18, 'sine', 0.35, 90);
        this.noiseBurst(t, 0.08, 0.25, 800);
        this.tone(784, t + 0.1, 0.12, 'triangle', 0.15);
        break;
      case 'jail':
        this.tone(330, t, 0.25, 'square', 0.08, 165);
        this.tone(220, t + 0.22, 0.35, 'square', 0.08, 110);
        break;
      case 'card':
        this.noiseBurst(t, 0.18, 0.25, 4000);
        this.tone(1175, t + 0.12, 0.2, 'sine', 0.12);
        break;
      case 'turn':
        this.tone(784, t, 0.18, 'sine', 0.2);
        this.tone(1047, t + 0.12, 0.3, 'sine', 0.2);
        break;
      case 'auction':
        this.tone(587, t, 0.12, 'triangle', 0.2);
        this.tone(587, t + 0.15, 0.12, 'triangle', 0.2);
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.12, 0.3, 'triangle', 0.22));
        break;
      case 'bankrupt':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, t + i * 0.16, 0.3, 'sawtooth', 0.07));
        break;
      case 'error':
        this.tone(220, t, 0.1, 'square', 0.08);
        this.tone(196, t + 0.12, 0.12, 'square', 0.08);
        break;
    }
  }

  /** Very quiet generative chord pad (I-vi-IV-V) with sparse arpeggio notes. */
  private startMusic(): void {
    const chords = [
      [261.63, 329.63, 392.0],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66]
    ];
    const tick = () => {
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running' && settings.get().musicVolume > 0 && settings.get().masterVolume > 0) {
        const t = ctx.currentTime + 0.05;
        const chord = chords[Math.floor(this.musicStep / 2) % chords.length] as number[];
        if (this.musicStep % 2 === 0) {
          for (const f of chord) this.pad(f / 2, t, 4.2);
        }
        const note = chord[Math.floor(Math.random() * chord.length)] as number;
        if (Math.random() < 0.7) this.tone(note * 2, t + Math.random() * 1.2, 0.9, 'sine', 0.05, undefined, this.musicGain as GainNode);
      }
      this.musicStep++;
      this.musicTimer = window.setTimeout(tick, 2000);
    };
    if (this.musicTimer === null) tick();
  }

  private pad(freq: number, start: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.06, start + 1.2);
    g.gain.linearRampToValueAtTime(0.0001, start + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    osc.start(start);
    osc.stop(start + dur + 0.1);
  }
}

export const audio = new AudioManager();
