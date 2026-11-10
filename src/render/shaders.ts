/**
 * Procedural shader polish for the world's shared materials.
 *
 * Everything here is GLSL injected into three.js's stock Lambert shaders via
 * `onBeforeCompile` — no external assets, and no program rebuilds while the
 * game runs: the animated parts (time, sun position, haze colour, and the
 * world's POINT LIGHTS) live on one ShaderKit whose uniforms are moved every
 * frame from the loop (the chunk manager's tick is the hook, same as the
 * water-sheet drift).
 *
 * - `patchWaterSurface` — the water channel gets small analytic waves that
 *   displace the sheet a hair and bend its normals (the derivative is the same
 *   function, so the light wobbles exactly where the sheet moves), a fresnel
 *   lift that picks up the sky's haze colour at grazing angles, a sun glint
 *   that tracks the real sun, and shore FOAM that whitens where the
 *   corner-averaged sheet sits low (the mesher's `aFill` channel).
 * - `patchTerrainFinish` — a warm rim where faces graze the view at low sun,
 *   a gentle saturation lift, and the torch-light decode on chunk materials.
 * - `patchDynamicLights` — the same torch-light decode alone, for the avatars,
 *   animals and fish: the stuff that walks around inside a pool of firelight.
 * - `patchStarTwinkle` — the sky's star field breathes.
 *
 * Point lights are SCALAR uniforms (position, colour×flicker, radius — per
 * light uL0P/uL0C/uL0R …) filled per frame by render/lights.ts: the programs
 * NEVER rebuild when a torch is placed or the Grown-Ups switch flips, only
 * uniform values move, and the flicker folds into the colour on the CPU.
 * Scalars and a boot-time compile max, not arrays and a loop, because
 * software rasterisers flatten every branch and run the whole decode even
 * while the count is zero — on CI's renderer that was half the world's
 * framerate for eight lights that did not exist. See ShaderKit.lightCompileMax.
 *
 * Distance haze itself is ordinary scene fog — see the FogExp2 in sky.ts.
 */

import * as THREE from 'three';

/** The sun (or moon) as far as the shaders care. */
export interface SunState {
  /** unit vector from the world toward the light */
  dir: THREE.Vector3;
  /** how far up that light stands, 0..1 (already dimmed by rain) */
  up: number;
  /** golden-hour strength, 0..1: strongest at low sun, ~0 at noon, muted at moon */
  low: number;
  /** the light's own colour */
  tint: THREE.Color;
}

/** Hard cap on world point lights — the ceiling; software GL compiles less. */
export const MAX_WORLD_LIGHTS = 8;

/** One live world light, as the kit receives it per frame (see lights.ts). */
export interface WorldLight {
  x: number; y: number; z: number;
  /** colour × intensity, plain linear values */
  r: number; g: number; b: number;
  /** reach in blocks — the falloff is (1 − d²/r²)², so nothing beyond it */
  radius: number;
  /** stable 0..1 phase for the CPU-side flicker (folded in by setLights) */
  seed: number;
}

/**
 * The kit's uniforms are shared by reference with every patched material, so
 * `tick` moves the whole world's shaders without touching their programs.
 */
export class ShaderKit {
  private readonly uTime = { value: 0 };
  private readonly uSunDir = { value: new THREE.Vector3(0.4, 0.9, 0.5) };
  private readonly uSunUp = { value: 0.9 };
  private readonly uLowSun = { value: 0 };
  private readonly uSunTint = { value: new THREE.Color(1, 0.96, 0.88) };
  private readonly uHaze = { value: new THREE.Color(0.75, 0.88, 0.96) };
  /**
   * The point lights — one SET of SCALAR uniforms each (uL0P/uL0C/uL0R …),
   * mutated IN PLACE by `setLights` every frame. The programs see the SAME
   * uniforms forever; a torch going out is just `uLightCount` shrinking.
   * Scalars, not arrays, because SwiftShader (CI's renderer) spills a whole
   * program out of the constant banks the moment it declares a dynamically
   * indexed uniform array — every pixel of the world got ~2x slower while
   * the light loop sat empty. The colour slots also carry the FLICKER,
   * folded on the CPU: the fragment decode stays a pure FMA chain.
   */
  /**
   * How many lights the PROGRAMS decode. Set once at boot (before the first
   * frame compiles anything) — software renderers flatten every branch and
   * run the whole decode even when the count is zero, so there the program
   * itself is built smaller. 8 on real GPUs, less on a CPU rasteriser.
   */
  lightCompileMax = MAX_WORLD_LIGHTS;
  private readonly uLights = Array.from({ length: MAX_WORLD_LIGHTS }, () => ({
    pos: { value: new THREE.Vector3() },
    color: { value: new THREE.Color() },
    range: { value: 1 },
  }));
  private readonly uLightCount = { value: 0 };

  /** advance the animation — once per frame from the game loop */
  tick(dt: number, sun: SunState, haze: THREE.Color): void {
    // wrapped so a long afternoon of building can't float the sines apart
    this.uTime.value = (this.uTime.value + dt) % 3600;
    this.uSunDir.value.copy(sun.dir);
    this.uSunUp.value = sun.up;
    this.uLowSun.value = sun.low;
    this.uSunTint.value.copy(sun.tint);
    this.uHaze.value.copy(haze);
  }

  /** the shared animation clock the shaders read (wrapped seconds) */
  get time(): number {
    return this.uTime.value;
  }

  /**
   * Publish this frame's lights (nearest-first order is the caller's job —
   * see render/lights.ts). Passing nothing switches every pool off without
   * touching a single program.
   */
  setLights(lights: readonly WorldLight[]): void {
    const n = Math.min(this.lightCompileMax, lights.length);
    const t = this.uTime.value;
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      const slot = this.uLights[i];
      slot.pos.value.set(l.x, l.y, l.z);
      // the flicker: two detuned sines on a stable per-light phase. Here it
      // costs ~16 transcendental calls a frame; in the fragment shader it
      // was hundreds of millions a second on a software rasteriser.
      const ph = l.seed * 37.13;
      const fl = 0.88 + 0.08 * Math.sin(t * 9.3 + ph) + 0.04 * Math.sin(t * 23.7 + ph * 2.7);
      slot.color.value.setRGB(l.r * fl, l.g * fl, l.b * fl);
      slot.range.value = l.radius;
    }
    this.uLightCount.value = n;
  }

  /** e2e lens: what the shaders were told last frame */
  lightsDebug(): { count: number; max: number; lights: { x: number; y: number; z: number; radius: number }[] } {
    const lights = [];
    for (let i = 0; i < this.uLightCount.value; i++) {
      const p = this.uLights[i].pos.value;
      lights.push({ x: p.x, y: p.y, z: p.z, radius: this.uLights[i].range.value });
    }
    return { count: this.uLightCount.value, max: MAX_WORLD_LIGHTS, lights };
  }

  /** hand the shared uniform objects to a patched program */
  attach(shader: { uniforms: Record<string, THREE.IUniform> }): void {
    shader.uniforms.uTime = this.uTime;
    shader.uniforms.uSunDir = this.uSunDir;
    shader.uniforms.uSunUp = this.uSunUp;
    shader.uniforms.uLowSun = this.uLowSun;
    shader.uniforms.uSunTint = this.uSunTint;
    shader.uniforms.uHaze = this.uHaze;
    shader.uniforms.uLightCount = this.uLightCount;
    for (let i = 0; i < this.uLights.length; i++) {
      const slot = this.uLights[i];
      shader.uniforms[`uL${i}P`] = slot.pos;
      shader.uniforms[`uL${i}C`] = slot.color;
      shader.uniforms[`uL${i}R`] = slot.range;
    }
  }
}

/**
 * The point-light decode, shared by the terrain, water and dynamic-material
 * patches. Squared-distance falloff — (1 − d²/r²)², exactly zero past the
 * radius, so the cost past a torch's reach is one dot product per light,
 * half-lambert so walls and floors both catch the pool.
 *
 * SCALAR uniforms, hand-unrolled — deliberately no arrays, no loops: a
 * dynamically indexed uniform array spills the whole program out of a
 * software rasteriser's constant banks (measured: every pixel ~2x slower
 * even while uLightCount is 0). uL*N already carries the flicker (setLights).
 */
function lightsGlslBody(max: number): string {
  const decl: string[] = [];
  const calls: string[] = [];
  for (let i = 0; i < max; i++) {
    decl.push(`uniform vec3 uL${i}P; uniform vec3 uL${i}C; uniform float uL${i}R;`);
    calls.push(
      i === 0
        ? 'vec3 elSum = elOne( uL0P, uL0C, uL0R, nrm );'
        : `if ( uLightCount > ${i} ) elSum += elOne( uL${i}P, uL${i}C, uL${i}R, nrm );`,
    );
  }
  return `
#define EL_MAX_LIGHTS ${max}
${decl.join('\n')}
uniform int uLightCount;

vec3 elOne( vec3 elP, vec3 elC, float elR, vec3 elN ) {
  vec3 elD = elP - vWorldPos;
  float elR2 = elR * elR;
  float elD2 = dot( elD, elD );
  if ( elD2 > elR2 ) return vec3( 0.0 );
  float elAtt = 1.0 - elD2 / elR2;
  elAtt *= elAtt;
  vec3 elL = elD * inversesqrt( max( elD2, 1e-4 ) );
  return elC * ( elAtt * ( dot( elN, elL ) * 0.5 + 0.5 ) );
}

vec3 elPointLights( vec3 nrm ) {
  if ( uLightCount < 1 ) return vec3( 0.0 );
${calls.join('\n')}
  return elSum;
}
`;
}

const HEAD_BASE = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uSunUp;
uniform float uLowSun;
uniform vec3 uSunTint;
uniform vec3 uHaze;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
`;

/** HEAD + the light decode sized to the kit's boot-time compile max */
function headGlsl(kit: ShaderKit): string {
  return HEAD_BASE + lightsGlslBody(kit.lightCompileMax);
}

/**
 * Three short crossing wave trains, and the analytic derivative of the same
 * function — vertex displacement and normal perturbation can never drift
 * apart, which is what makes the wobble read as water and not as boiling.
 * Amplitudes stay under ~0.05 blocks: enough to catch the light, never
 * enough to poke through a block sitting above the sheet.
 */
const WAVES = /* glsl */ `
float elWave( vec2 p, float t ) {
  return 0.028 * sin( p.x * 0.9 + t * 1.35 ) * cos( p.y * 0.7 - t * 1.05 )
       + 0.022 * sin( p.x * 2.1 - p.y * 1.6 + t * 2.1 )
       + 0.014 * sin( ( p.x + p.y ) * 3.4 - t * 2.9 );
}

vec3 elWaveNormal( vec2 p, float t ) {
  float dx =  0.028 * 0.9 * cos( p.x * 0.9 + t * 1.35 ) * cos( p.y * 0.7 - t * 1.05 )
           + 0.022 * 2.1 * cos( p.x * 2.1 - p.y * 1.6 + t * 2.1 )
           + 0.014 * 3.4 * cos( ( p.x + p.y ) * 3.4 - t * 2.9 );
  float dz = -0.028 * 0.7 * sin( p.x * 0.9 + t * 1.35 ) * sin( p.y * 0.7 - t * 1.05 )
           - 0.022 * 1.6 * cos( p.x * 2.1 - p.y * 1.6 + t * 2.1 )
           + 0.014 * 3.4 * cos( ( p.x + p.y ) * 3.4 - t * 2.9 );
  return normalize( vec3( -dx, 1.0, -dz ) );
}
`;

/** world-space varyings, filled from the vertex stage */
const VERTEX_TRAIL = /* glsl */ `
vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const NORMAL_TRAIL = /* glsl */ `
vWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
`;

/** gentle saturation lift — runs after fog, over the encoded colour */
const LIFT = /* glsl */ `
float elLuma = dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
gl_FragColor.rgb = mix( vec3( elLuma ), gl_FragColor.rgb, 1.06 );
`;

/**
 * Replace one three.js shader chunk, loudly. If three ever renames a chunk we
 * patch, this throws on the first compile — every e2e boot fails at once,
 * which beats water that silently stopped shimmering (same spirit as the
 * atlas "cell added but never drawn" throw).
 */
function mustReplace(src: string, include: string, code: string, where: string): string {
  const out = src.replace(include, `${include}\n${code}`);
  if (out === src) throw new Error(`shaders: could not patch ${include} (${where})`);
  return out;
}

/**
 * The water channel: waves, fresnel haze pickup, a sun glint and shore foam
 * on the mesher's existing geometry. Lighting (hemi/directional/fog and the
 * point lights) still flows through three's Lambert chain — the glint and the
 * foam ride in as indirect diffuse.
 */
export function patchWaterSurface(mat: THREE.MeshLambertMaterial, kit: ShaderKit): void {
  mat.onBeforeCompile = (shader) => {
    kit.attach(shader);
    shader.vertexShader = headGlsl(kit) + WAVES + 'attribute float aFill;\nvarying float vFill;\n' + shader.vertexShader;
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <begin_vertex>',
      'transformed.y += elWave( ( modelMatrix * vec4( transformed, 1.0 ) ).xz, uTime );\nvFill = aFill;',
      'water wave displacement');
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <beginnormal_vertex>', NORMAL_TRAIL, 'water world normal');

    shader.fragmentShader = headGlsl(kit) + WAVES + 'varying float vFill;\n' + shader.fragmentShader;
    // top faces take the analytic wave normal (in view space, where three's
    // lighting lives); sides keep the blocky box normal untouched
    shader.fragmentShader = mustReplace(shader.fragmentShader, '#include <normal_fragment_begin>', `
float elTop = abs( vWorldNormal.y );
vec3 elWN = elWaveNormal( vWorldPos.xz, uTime );
vec3 elN = normalize( mix( vWorldNormal, elWN, elTop ) );
vec3 elNView = ( viewMatrix * vec4( elN, 0.0 ) ).xyz;
normal = normalize( mix( normal, elNView * sign( dot( normal, elNView ) + 1e-5 ), elTop ) );`,
    'water wave normal');
    // glint + fresnel + torch light + foam in world space, sharing the wave
    // normal. The foam reads the mesher's aFill: where the corner-averaged
    // sheet sits low — a spread soak, the thin seventh cell of a reach — the
    // shore froths; a brimming pool stays mirror-clean.
    shader.fragmentShader = mustReplace(shader.fragmentShader, '#include <lights_fragment_end>', `
vec3 elVN = normalize( mix( vWorldNormal, elWaveNormal( vWorldPos.xz, uTime ), abs( vWorldNormal.y ) ) );
vec3 elVV = normalize( cameraPosition - vWorldPos );
vec3 elVL = normalize( uSunDir );
float elFres = pow( 1.0 - clamp( dot( elVN, elVV ), 0.0, 1.0 ), 3.0 );
float elHD = max( dot( elVN, normalize( elVL + elVV ) ), 0.0 );
float elGlint = pow( elHD, 150.0 );
float elSheen = pow( elHD, 16.0 ) * 0.12;
reflectedLight.indirectDiffuse += uHaze * elFres * ( 0.05 + 0.20 * uSunUp )
                               + uSunTint * ( elGlint * 1.8 + elSheen ) * uSunUp
                               + elPointLights( elVN ) * 0.8;
float elCrest = clamp( elWave( vWorldPos.xz, uTime ) * 16.0, 0.0, 1.0 );
float elShallow = smoothstep( 0.8, 0.3, vFill );
float elLap = 0.55 + 0.45 * sin( uTime * 2.6 + ( vWorldPos.x + vWorldPos.z ) * 4.1 )
                        * sin( uTime * 1.7 + vWorldPos.x * 5.3 - vWorldPos.z * 3.7 );
reflectedLight.indirectDiffuse += vec3( 0.92, 0.97, 1.0 )
  * ( elShallow * elLap * ( 0.30 + 0.55 * uSunUp ) + elCrest * 0.08 * uSunUp );`,
    'water glint + fresnel + lights + foam');
    shader.fragmentShader = mustReplace(
      shader.fragmentShader, '#include <fog_fragment>', LIFT, 'water saturation lift');
  };
  mat.customProgramCacheKey = () => 'elocraft-water';
}

/**
 * The chunk terrain channels: a warm low-sun rim, the saturation lift and
 * the point-light decode. Kept deliberately faint — the blocks' own painted
 * art carries the look; the torchlight is what paints the night.
 */
export function patchTerrainFinish(mat: THREE.MeshLambertMaterial, kit: ShaderKit): void {
  mat.onBeforeCompile = (shader) => {
    kit.attach(shader);
    shader.vertexShader = headGlsl(kit) + shader.vertexShader;
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <begin_vertex>', VERTEX_TRAIL, 'terrain world pos');
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <beginnormal_vertex>', NORMAL_TRAIL, 'terrain world normal');

    shader.fragmentShader = headGlsl(kit) + shader.fragmentShader;
    shader.fragmentShader = mustReplace(shader.fragmentShader, '#include <lights_fragment_end>', `
vec3 elTN = normalize( vWorldNormal );
vec3 elTV = normalize( cameraPosition - vWorldPos );
float elRim = pow( 1.0 - clamp( dot( elTN, elTV ), 0.0, 1.0 ), 3.0 )
            * clamp( dot( elTN, normalize( uSunDir ) ) * 0.7 + 0.3, 0.0, 1.0 );
reflectedLight.indirectDiffuse += uSunTint * elRim * uLowSun * 0.20
                               + elPointLights( elTN );`,
    'terrain low-sun rim + point lights');
    shader.fragmentShader = mustReplace(
      shader.fragmentShader, '#include <fog_fragment>', LIFT, 'terrain saturation lift');
  };
  mat.customProgramCacheKey = () => 'elocraft-terrain';
}

/**
 * Avatars, animals, fish — everything that walks around inside a pool of
 * firelight. The same point-light decode, nothing else: no rim, no lift, no
 * saturation opinions — just lights. render/lights.ts sweeps the scene for
 * Lambert materials that have never been patched and gives them this.
 */
export function patchDynamicLights(mat: THREE.MeshLambertMaterial, kit: ShaderKit): void {
  mat.onBeforeCompile = (shader) => {
    kit.attach(shader);
    shader.vertexShader = headGlsl(kit) + shader.vertexShader;
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <begin_vertex>', VERTEX_TRAIL, 'dynamic world pos');
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <beginnormal_vertex>', NORMAL_TRAIL, 'dynamic world normal');

    shader.fragmentShader = headGlsl(kit) + shader.fragmentShader;
    shader.fragmentShader = mustReplace(
      shader.fragmentShader, '#include <lights_fragment_end>',
      'reflectedLight.indirectDiffuse += elPointLights( normalize( vWorldNormal ) );',
      'dynamic point lights');
  };
  mat.customProgramCacheKey = () => 'elocraft-dynamic';
}

/**
 * The star field: each star breathes — size and brightness wobbling on two
 * detuned sines of the kit's time, with a per-star seed (the geometry's
 * `aStarSeed` attribute, see sky.ts) so the sky never pulses as one lamp.
 * The only patched PointsMaterial in the game, so its cache key is small
 * print nobody collides with.
 */
export function patchStarTwinkle(mat: THREE.PointsMaterial, kit: ShaderKit): void {
  mat.onBeforeCompile = (shader) => {
    kit.attach(shader);
    shader.vertexShader = `
attribute float aStarSeed;
varying float vStarSeed;
uniform float uTime;
` + shader.vertexShader;
    shader.vertexShader = mustReplace(
      shader.vertexShader, 'gl_PointSize = size;',
      `gl_PointSize = size;
vStarSeed = aStarSeed;
gl_PointSize *= 0.72 + 0.5 * sin( uTime * ( 1.9 + fract( aStarSeed * 7.31 ) * 4.4 ) + aStarSeed * 91.7 );`,
      'star size twinkle');
    shader.fragmentShader = `
varying float vStarSeed;
uniform float uTime;
` + shader.fragmentShader;
    shader.fragmentShader = mustReplace(
      shader.fragmentShader, '#include <fog_fragment>', `
float elTwb = 0.62 + 0.38 * sin( uTime * ( 1.9 + fract( vStarSeed * 7.31 ) * 4.4 ) + vStarSeed * 91.7 );
gl_FragColor.rgb *= elTwb;`,
      'star brightness twinkle');
  };
  mat.customProgramCacheKey = () => 'elocraft-stars';
}
