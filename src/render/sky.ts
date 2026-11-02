/**
 * Sky, lights, clouds — the cheerful outdoor environment.
 */

import * as THREE from 'three';
import { WORLD_SX, WORLD_SZ } from '../core/world';

export interface SkyEnv {
  update(dt: number): void;
}

export const SKY_RADIUS = 320;
/** matches the fog, so the renderer can clear to it: nothing in this game should
 *  ever be able to show the raw canvas, and a black gap frightens kids */
export const SKY_CLEAR = 0xbfe0f5;
/** Camera far plane. The dome is centred on the MIDDLE of the world, so the most
 *  a camera can be from its centre is the half-diagonal (~91) plus the build
 *  ceiling (~44) — stay well clear of dome + that, or three clips a hole in the
 *  sky and the black canvas shows through it. */
export const SKY_FAR = SKY_RADIUS + 200;

export function createSky(scene: THREE.Scene): SkyEnv {
  // The sky hangs around the middle of the world, not the coordinate origin: on a
  // 128-block map the origin is a CORNER, and a dome centred there reaches 450
  // blocks from a camera near spawn — past the far plane, which used to punch a
  // black hole in the sky once the welcome camera had drifted around a little.
  const sky = new THREE.Group();
  sky.position.set(WORLD_SX / 2, 0, WORLD_SZ / 2);
  scene.add(sky);

  // gradient dome
  const domeGeo = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const colors: number[] = [];
  const pos = domeGeo.attributes.position as THREE.BufferAttribute;
  const top = new THREE.Color(0.45, 0.68, 0.98);
  const mid = new THREE.Color(0.65, 0.83, 1.0);
  const horizon = new THREE.Color(0.88, 0.95, 1.0);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / SKY_RADIUS; // -1..1
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
    else c.copy(horizon).lerp(mid, Math.max(0, (y + 0.15) / 0.4));
    colors.push(c.r, c.g, c.b);
  }
  domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    domeGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }),
  );
  sky.add(dome);

  // sun (offset from the world centre, roughly where the key light comes from)
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(9, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff2a8, fog: false }),
  );
  sun.position.set(56, 170, -154);
  sky.add(sun);

  scene.fog = new THREE.Fog(0xbfe0f5, 60, 240);

  // lights
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8b6a, 1.05);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff6e0, 1.6);
  dir.position.set(60, 90, -30);
  scene.add(dir);
  const amb = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(amb);

  // clouds: soft boxes drifting overhead
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xdfe9f2, transparent: true, opacity: 0.92 });
  const clouds: THREE.Group[] = [];
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group();
    const puffs = 3 + Math.floor(rnd() * 3);
    for (let p = 0; p < puffs; p++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cloudMat);
      m.scale.set(5 + rnd() * 7, 2.2 + rnd() * 1.6, 5 + rnd() * 6);
      m.position.set((p - puffs / 2) * 5.5 + rnd() * 2, rnd() * 1.5, (rnd() - 0.5) * 4);
      g.add(m);
    }
    g.position.set(rnd() * WORLD_SX * 2 - WORLD_SX * 0.5, 46 + rnd() * 10, rnd() * WORLD_SZ * 1.5 - WORLD_SZ * 0.25);
    const sc = 0.8 + rnd() * 0.9;
    g.scale.setScalar(sc);
    clouds.push(g);
    scene.add(g);
  }

  const drift = 1.1;
  const spanX = WORLD_SX * 2.4;
  return {
    update(dt: number) {
      for (const g of clouds) {
        g.position.x += drift * dt;
        if (g.position.x > WORLD_SX * 1.2) g.position.x -= spanX;
      }
    },
  };
}
