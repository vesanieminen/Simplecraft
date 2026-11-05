/**
 * Procedural WebAudio sound kit — all sounds are synthesized here,
 * no external assets, all original. The kit layers tones and filtered
 * noise so blocks knock, thud, clack and rustle like their material.
 */

// type-only, so there is no import cycle with core/animals.ts (which uses AudioKit)
import type { AnimalKind } from './animals';
import type { SoundFamily } from './blocks';

export class AudioKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.6;
  muted = false;
  private lastNoteAt = new Map<string, number>();
  /** ring of recent sound names (material-aware) — lets tests check the wiring headlessly */
  readonly recent: string[] = [];

  /** must be called from a user gesture (first button press) */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      // honour a muted state restored from the settings before the first gesture
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, f0), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(
    dur: number, vol: number, filterFreq: number, delay = 0,
    type: BiquadFilterType = 'lowpass',
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true; // the buffer is short; longer sounds just ride around it
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private log(name: string): void {
    this.recent.push(name);
    if (this.recent.length > 30) this.recent.shift();
  }

  /**
   * Setting a block down: one knock per material. Wood knocks, stone
   * clacks, dirt and sand thud, glass pings, plants rustle.
   */
  place(family: SoundFamily = 'wood'): void {
    this.log(`place:${family}`);
    switch (family) {
      case 'stone':
        this.tone('triangle', 180, 110, 0.08, 0.2);
        this.noise(0.05, 0.13, 2400, 0, 'highpass');
        this.noise(0.09, 0.09, 700, 0.02);
        break;
      case 'soft':
        this.noise(0.11, 0.2, 480);
        this.tone('sine', 120, 80, 0.08, 0.09);
        break;
      case 'glass':
        this.tone('sine', 1350, 1250, 0.16, 0.11);
        this.tone('sine', 1900, 1750, 0.1, 0.05, 0.02);
        this.noise(0.04, 0.05, 5200, 0, 'highpass');
        break;
      case 'plant':
        this.noise(0.09, 0.13, 2600, 0, 'bandpass');
        this.tone('sine', 420, 300, 0.07, 0.05);
        break;
      default: // wood
        this.tone('triangle', 300, 180, 0.09, 0.24);
        this.noise(0.05, 0.12, 800);
    }
  }

  /** breaking a block: the material's knock, roughened, with falling debris */
  remove(family: SoundFamily = 'wood'): void {
    this.log(`remove:${family}`);
    switch (family) {
      case 'stone':
        this.tone('square', 160, 90, 0.1, 0.16);
        this.noise(0.16, 0.22, 1800, 0, 'bandpass');
        this.noise(0.1, 0.1, 900, 0.08);
        break;
      case 'soft':
        this.noise(0.16, 0.22, 620);
        this.noise(0.1, 0.08, 1400, 0.07);
        break;
      case 'glass':
        this.tone('sine', 2100, 1500, 0.1, 0.1);
        this.noise(0.14, 0.2, 4200, 0, 'highpass'); // tinkle of shards
        this.noise(0.1, 0.07, 6500, 0.05, 'highpass');
        break;
      case 'plant':
        this.noise(0.13, 0.16, 3000, 0, 'bandpass'); // crunch/rustle
        this.tone('sine', 350, 240, 0.08, 0.05);
        break;
      default: // wood
        this.tone('triangle', 220, 120, 0.1, 0.22);
        this.noise(0.12, 0.16, 1200);
    }
  }

  /** the block under a landing or a footfall decides that sound too */
  land(family: SoundFamily = 'soft'): void {
    this.log(`land:${family}`);
    switch (family) {
      case 'stone': this.noise(0.07, 0.16, 900); this.tone('sine', 140, 90, 0.08, 0.1); break;
      case 'wood': this.noise(0.06, 0.12, 700); this.tone('triangle', 160, 110, 0.07, 0.08); break;
      case 'glass': this.tone('sine', 1500, 1400, 0.08, 0.05); this.noise(0.04, 0.06, 4000, 0, 'highpass'); break;
      case 'plant': this.noise(0.08, 0.1, 2400, 0, 'bandpass'); break;
      default: this.noise(0.09, 0.13, 500); // soft earth
    }
  }

  footstep(family: SoundFamily = 'soft', alt = false): void {
    this.log(`step:${family}`);
    const t = alt ? 1.13 : 1; // alternate the pitch a hair, like real shoes
    switch (family) {
      case 'stone': this.noise(0.05, 0.07 * t, 1600, 0, 'bandpass'); break;
      case 'wood': this.tone('triangle', 190 * t, 150, 0.05, 0.05); break;
      case 'glass': this.tone('sine', 2000 * t, 1900, 0.04, 0.03); break;
      case 'plant': this.noise(0.05, 0.05, 3000, 0, 'bandpass'); break;
      default: this.noise(0.06, 0.07, 620); // soft earth, quietest
    }
  }

  /** hitting the water: a slap, a blop, droplets — the works */
  splash(): void {
    this.log('splash');
    this.noise(0.05, 0.3, 1500, 0, 'highpass');  // the slap on the surface
    this.noise(0.22, 0.24, 620, 0.03);           // the body going in
    this.tone('sine', 320, 720, 0.16, 0.1, 0.02); // the rising blop
    this.tone('sine', 900, 520, 0.1, 0.05, 0.2);  // a droplet off the splash
    this.noise(0.12, 0.07, 900, 0.26);           // waves settling
  }

  /** a treasure chest's lid: wooden creak, then a surprise chime */
  chestOpen(): void {
    this.log('chestOpen');
    this.tone('sawtooth', 160, 215, 0.3, 0.07);
    this.noise(0.1, 0.05, 1200, 0.05);
    [784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.12, 0.12 + i * 0.07));
  }

  jump(): void {
    this.log('jump');
    this.tone('sine', 250, 430, 0.13, 0.16);
    this.noise(0.04, 0.05, 800); // little shove-off scuff
  }

  collect(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.2, i * 0.06));
  }

  bounce(): void {
    this.tone('sine', 140, 620, 0.2, 0.3);
    this.tone('sine', 210, 830, 0.16, 0.12, 0.02);
  }

  sparkle(): void {
    this.tone('sine', 1800, 1400, 0.25, 0.08);
  }

  // ------------------------------------------------------------- doors

  /** a door swinging open: a short wooden creak */
  doorOpen(): void {
    this.tone('sawtooth', 170, 250, 0.2, 0.09);
    this.noise(0.1, 0.06, 1100, 0.04);
  }

  /** a door swinging shut: creak, then a soft thud */
  doorClose(): void {
    this.tone('sawtooth', 240, 170, 0.16, 0.08);
    this.tone('triangle', 200, 110, 0.1, 0.16, 0.16);
    this.noise(0.08, 0.12, 650, 0.17);
  }

  /** falling sand settling: a soft sandy thud */
  sandThud(): void {
    this.noise(0.14, 0.14, 700);
    this.tone('sine', 120, 60, 0.12, 0.08, 0.01);
  }

  // ------------------------------------------------------------- dynamite

  /** a swim stroke underwater: a muffled pull of water, both arms through */
  swimStroke(): void {
    this.noise(0.18, 0.09, 620);
    this.tone('sine', 190, 240, 0.14, 0.045);
  }

  /** the fuse catching: paper thud, then a long hiss */
  dynamiteLight(): void {
    this.tone('triangle', 250, 170, 0.09, 0.18);
    this.noise(0.55, 0.16, 6200, 0.03, 'bandpass');
  }

  /** the fuse spitting — short high ticks, faster and louder as it burns down */
  fuseTick(strength = 1): void {
    this.noise(0.05, 0.05 * strength, 5200, 0, 'highpass');
    this.tone('square', 1800 + Math.random() * 1200, 1100, 0.035, 0.025 * strength);
  }

  /** last half second: a rising panic so kids know to run */
  fuseRush(): void {
    this.tone('square', 620, 1150, 0.09, 0.08);
    this.tone('square', 880, 1500, 0.09, 0.06, 0.11);
  }

  /** hitting dynamite with the break button: clank, then it hisses */
  dynamiteStrike(): void {
    this.tone('square', 540, 300, 0.07, 0.13);
    this.noise(0.14, 0.15, 2600, 0, 'bandpass');
  }

  /** the big one: low thump, bright crack, rolling rumble */
  boom(power = 1): void {
    this.tone('sine', 175, 34, 0.5, 0.55 * power);
    this.tone('sawtooth', 96, 30, 0.34, 0.22 * power, 0.01);
    this.noise(0.42, 0.45 * power, 900);
    this.noise(0.09, 0.38 * power, 9000, 0, 'highpass');
    this.noise(0.95, 0.13 * power, 420, 0.05);
  }

  uiMove(): void {
    this.tone('square', 440, 440, 0.045, 0.06);
  }

  uiSelect(): void {
    this.tone('triangle', 560, 720, 0.09, 0.16);
  }

  uiBack(): void {
    this.tone('triangle', 480, 330, 0.09, 0.12);
  }

  join(): void {
    [440, 554, 659].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.18, i * 0.08));
  }

  animal(kind: AnimalKind): void {
    switch (kind) {
      case 'sheep':
        this.tone('sawtooth', 300, 220, 0.28, 0.08);
        break;
      case 'bunny':
        this.tone('sine', 700, 900, 0.07, 0.1);
        break;
      case 'chicken':
        this.tone('square', 900, 700, 0.05, 0.05);
        this.tone('square', 800, 1000, 0.05, 0.05, 0.09);
        break;
      case 'cow':
        this.tone('sawtooth', 150, 115, 0.5, 0.09);
        break;
      case 'pig':
        // two oinks: short grunt, then the happy upward squeal
        this.tone('sawtooth', 210, 170, 0.1, 0.09);
        this.tone('sawtooth', 240, 330, 0.16, 0.08, 0.12);
        break;
      case 'horse':
        // whinny: a loud neigh that slides down, then snorts
        this.tone('sawtooth', 520, 340, 0.3, 0.1);
        this.tone('sawtooth', 380, 260, 0.22, 0.07, 0.26);
        this.noise(0.12, 0.05, 900, 0.5);
        break;
      case 'cat':
        // meow: bright, rising-then-falling
        this.tone('sine', 620, 780, 0.14, 0.1);
        this.tone('sine', 760, 540, 0.22, 0.09, 0.14);
        break;
      case 'fox':
        // the fox's two-syllable yip
        this.tone('square', 660, 880, 0.08, 0.07);
        this.tone('square', 820, 600, 0.12, 0.06, 0.11);
        break;
    }
  }

  /** music block: pentatonic pluck, deduplicated per block to avoid machine-gunning */
  note(i: number, key: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const last = this.lastNoteAt.get(key) ?? -1;
    if (now - last < 0.25) return;
    this.lastNoteAt.set(key, now);
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    const semi = scale[((i % 8) + 8) % 8];
    const f = 330 * Math.pow(2, semi / 12);
    this.tone('triangle', f, f, 0.5, 0.22);
    this.tone('sine', f * 2, f * 2, 0.3, 0.06);
  }
}
