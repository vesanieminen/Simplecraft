/**
 * The weather clock: pure game logic that decides when it rains or snows,
 * with no rendering or sound. The renderer draws it (render/sky.ts's
 * Precipitation), the audio kit hisses for it (core/audio.ts), and Game keeps
 * one instance so a grown-up can take the wheel from the menu.
 *
 * Phases come from a tiny state machine. In 'auto' mode dry spells last a few
 * minutes and weather spells a bit under a minute — good weather, then a
 * short rain, then good weather — so the family mostly plays in bright sun
 * with the occasional patter. In the forced modes the weather holds until the
 * grown-up changes it. The clock runs on game time (like the day cycle and
 * the saplings), so it freezes with the pause menu and keeps running while a
 * world loads.
 *
 * This is deliberately a *pure* module — the e2e suite pokes
 * `game.weatherClock.force('rain')` and waits on `weatherClock.isActive`
 * instead of burning CI minutes waiting for a random drizzle.
 */

export type WeatherKind = 'rain' | 'snow';
export type WeatherMode = 'auto' | 'off' | WeatherKind;

/** Dry spells roll the dice every so often; storms last just under a minute. */
const DRY_CHECK_SECONDS = 30;
const STORM_MIN_SECONDS = 25;
const STORM_MAX_SECONDS = 55;
/** 'auto' weather is a guest: it visits now and then, not every few minutes */
const AUTO_DRIZZLE_CHANCE = 0.25;

export class WeatherClock {
  mode: WeatherMode = 'auto';
  /** the kind currently falling (null while dry) */
  kind: WeatherKind | null = null;
  /** how hard it falls, 0..1 — the renderer and audio read this every frame */
  intensity = 0;

  private sinceCheck = DRY_CHECK_SECONDS - 6; // a quick first roll, for demo joy
  private remaining = 0;

  /** seconds left of the current spell (0 while dry) */
  get secondsLeft(): number {
    return this.kind ? this.remaining : 0;
  }

  get isActive(): boolean {
    return this.kind !== null && this.intensity > 0.02;
  }

  /**
   * Start weather right away (a grown-up picked it, or a test is impatient).
   * Returns the chosen intensity so callers can log/seed their own visuals.
   */
  force(kind: WeatherKind | null, seconds = 45, intensity?: number): number {
    this.kind = kind;
    this.remaining = seconds;
    this.intensity = kind === null ? 0 : intensity ?? 0.35 + Math.random() * 0.6;
    this.sinceCheck = 0;
    return this.intensity;
  }

  update(dt: number): void {
    if (this.kind) {
      this.remaining -= dt;
      if (this.remaining <= 0) this.force(null);
      return;
    }
    if (this.mode !== 'auto') return;
    this.sinceCheck += dt;
    if (this.sinceCheck < DRY_CHECK_SECONDS) return;
    this.sinceCheck = 0;
    if (Math.random() > AUTO_DRIZZLE_CHANCE) return;
    const kind: WeatherKind = Math.random() < 0.75 ? 'rain' : 'snow';
    const seconds = STORM_MIN_SECONDS + Math.random() * (STORM_MAX_SECONDS - STORM_MIN_SECONDS);
    this.force(kind, seconds);
  }

  /** Apply a menu mode right away: weather appears/vanishes with the toggle. */
  setMode(mode: WeatherMode): void {
    this.mode = mode;
    if (mode === 'off') this.force(null);
    else if (mode === 'rain' || mode === 'snow') this.force(mode, 1e9);
    // 'auto': keep whatever is falling; the scheduler will wrap it up in time
  }
}
