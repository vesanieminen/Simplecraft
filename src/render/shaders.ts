/**
 * Procedural shader polish for the world's shared materials.
 *
 * Everything here is GLSL injected into three.js's stock Lambert shaders via
 * `onBeforeCompile` — no external assets, and no program rebuilds while the
 * game runs: the animated parts (time, sun position, haze colour) live on one
 * ShaderKit whose uniforms are swapped every frame from the loop (the chunk
 * manager's tick is the hook, same as the water-sheet drift).
 *
 * - `patchWaterSurface` — the water channel gets small analytic waves that
 *   displace the sheet a hair and bend its normals (the derivative is the same
 *   function, so the light wobbles exactly where the sheet moves), a fresnel
 *   lift that picks up the sky's haze colour at grazing angles, and a sun
 *   glint that tracks the real sun. Corner-averaged heights, the tiling wave
 *   sheet and the material's depth-write semantics are all untouched — this
 *   only dresses the geometry the mesher already built.
 * - `patchTerrainFinish` — a warm rim where faces graze the view at low sun
 *   (golden-hour edges on cliffs), plus a gentle saturation lift after fog so
 *   the meadow reads candy-bright instead of dusty.
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

  /** hand the shared uniform objects to a patched program */
  attach(shader: { uniforms: Record<string, THREE.IUniform> }): void {
    shader.uniforms.uTime = this.uTime;
    shader.uniforms.uSunDir = this.uSunDir;
    shader.uniforms.uSunUp = this.uSunUp;
    shader.uniforms.uLowSun = this.uLowSun;
    shader.uniforms.uSunTint = this.uSunTint;
    shader.uniforms.uHaze = this.uHaze;
  }
}

const HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uSunUp;
uniform float uLowSun;
uniform vec3 uSunTint;
uniform vec3 uHaze;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
`;

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
 * The water channel: waves, fresnel haze pickup and a sun glint on the
 * mesher's existing geometry. Lighting (hemi/directional/fog) still flows
 * through three's Lambert chain — the glint rides in as indirect diffuse.
 */
export function patchWaterSurface(mat: THREE.MeshLambertMaterial, kit: ShaderKit): void {
  mat.onBeforeCompile = (shader) => {
    kit.attach(shader);
    shader.vertexShader = HEAD + WAVES + shader.vertexShader;
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <begin_vertex>',
      'transformed.y += elWave( ( modelMatrix * vec4( transformed, 1.0 ) ).xz, uTime );',
      'water wave displacement');
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <beginnormal_vertex>', NORMAL_TRAIL, 'water world normal');

    shader.fragmentShader = HEAD + WAVES + shader.fragmentShader;
    // top faces take the analytic wave normal (in view space, where three's
    // lighting lives); sides keep the blocky box normal untouched
    shader.fragmentShader = mustReplace(shader.fragmentShader, '#include <normal_fragment_begin>', `
float elTop = abs( vWorldNormal.y );
vec3 elWN = elWaveNormal( vWorldPos.xz, uTime );
vec3 elN = normalize( mix( vWorldNormal, elWN, elTop ) );
vec3 elNView = ( viewMatrix * vec4( elN, 0.0 ) ).xyz;
normal = normalize( mix( normal, elNView * sign( dot( normal, elNView ) + 1e-5 ), elTop ) );`,
    'water wave normal');
    // glint + fresnel in world space, sharing the same wave normal
    shader.fragmentShader = mustReplace(shader.fragmentShader, '#include <lights_fragment_end>', `
vec3 elVN = normalize( mix( vWorldNormal, elWaveNormal( vWorldPos.xz, uTime ), abs( vWorldNormal.y ) ) );
vec3 elVV = normalize( cameraPosition - vWorldPos );
vec3 elVL = normalize( uSunDir );
float elFres = pow( 1.0 - clamp( dot( elVN, elVV ), 0.0, 1.0 ), 3.0 );
float elHD = max( dot( elVN, normalize( elVL + elVV ) ), 0.0 );
float elGlint = pow( elHD, 150.0 );
float elSheen = pow( elHD, 16.0 ) * 0.12;
reflectedLight.indirectDiffuse += uHaze * elFres * ( 0.05 + 0.20 * uSunUp )
                               + uSunTint * ( elGlint * 1.8 + elSheen ) * uSunUp;`,
    'water glint + fresnel');
    shader.fragmentShader = mustReplace(
      shader.fragmentShader, '#include <fog_fragment>', LIFT, 'water saturation lift');
  };
  mat.customProgramCacheKey = () => 'elocraft-water';
}

/**
 * The chunk terrain channels: a warm low-sun rim and the saturation lift.
 * Kept deliberately faint — the blocks' own painted art carries the look.
 */
export function patchTerrainFinish(mat: THREE.MeshLambertMaterial, kit: ShaderKit): void {
  mat.onBeforeCompile = (shader) => {
    kit.attach(shader);
    shader.vertexShader = HEAD + shader.vertexShader;
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <begin_vertex>', VERTEX_TRAIL, 'terrain world pos');
    shader.vertexShader = mustReplace(
      shader.vertexShader, '#include <beginnormal_vertex>', NORMAL_TRAIL, 'terrain world normal');

    shader.fragmentShader = HEAD + shader.fragmentShader;
    shader.fragmentShader = mustReplace(shader.fragmentShader, '#include <lights_fragment_end>', `
vec3 elTN = normalize( vWorldNormal );
vec3 elTV = normalize( cameraPosition - vWorldPos );
float elRim = pow( 1.0 - clamp( dot( elTN, elTV ), 0.0, 1.0 ), 3.0 )
            * clamp( dot( elTN, normalize( uSunDir ) ) * 0.7 + 0.3, 0.0, 1.0 );
reflectedLight.indirectDiffuse += uSunTint * elRim * uLowSun * 0.20;`,
    'terrain low-sun rim');
    shader.fragmentShader = mustReplace(
      shader.fragmentShader, '#include <fog_fragment>', LIFT, 'terrain saturation lift');
  };
  mat.customProgramCacheKey = () => 'elocraft-terrain';
}
