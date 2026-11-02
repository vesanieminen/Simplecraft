/**
 * Split-screen rendering: ONE renderer + ONE scene, N cameras drawn
 * with viewport + scissor. Also computes the matching CSS rects so the
 * DOM HUD lines up with each player's half of the screen.
 */

import * as THREE from 'three';

export type SplitLayout = 'auto' | 'horizontal' | 'vertical' | 'grid2x2';

export interface ViewportRect {
  x: number; // css px
  y: number;
  w: number;
  h: number;
}

export class ViewportManager {
  width = 0;
  height = 0;
  rects: ViewportRect[] = [];

  resize(w: number, h: number, playerCount: number, layout: SplitLayout): void {
    this.width = w;
    this.height = h;
    this.rects = computeRects(w, h, playerCount, layout);
    for (const cam of []) void cam;
  }

  /** render every local player's camera into its own pane */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cameras: THREE.Camera[]): void {
    const n = cameras.length;
    if (n === 0) return;
    renderer.autoClear = false;
    for (let i = 0; i < n; i++) {
      const r = this.rects[Math.min(i, this.rects.length - 1)];
      const cam = cameras[i];
      cam.viewport = new THREE.Vector4(r.x, this.height - r.y - r.h, r.w, r.h);
      // widen fov a touch for narrow side-by-side panes
      if (cam instanceof THREE.PerspectiveCamera) {
        cam.aspect = r.w / Math.max(1, r.h);
        cam.fov = r.w < r.h ? 74 : 70;
        cam.updateProjectionMatrix();
      }
      renderer.setViewport(r.x, this.height - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, this.height - r.y - r.h, r.w, r.h);
      renderer.setScissorTest(true);
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
    }
    renderer.setScissorTest(false);
    renderer.autoClear = true;
  }

  /** which pane contains this CSS point? */
  paneAt(x: number, y: number): number {
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return 0;
  }
}

export function computeRects(w: number, h: number, n: number, layout: SplitLayout): ViewportRect[] {
  if (n <= 1) return [{ x: 0, y: 0, w, h }];
  if (n === 2) {
    const sideBySide = layout === 'horizontal' || (layout === 'auto' && w >= h);
    if (sideBySide) {
      const half = Math.floor(w / 2);
      return [
        { x: 0, y: 0, w: half, h },
        { x: half, y: 0, w: w - half, h },
      ];
    }
    const half = Math.floor(h / 2);
    return [
      { x: 0, y: 0, w, h: half },
      { x: 0, y: half, w, h: h - half },
    ];
  }
  // 3-4 players: 2x2 grid
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  const rects: ViewportRect[] = [];
  const spots: [number, number][] = [[0, 0], [hw, 0], [0, hh], [hw, hh]];
  for (let i = 0; i < Math.min(4, n); i++) {
    rects.push({ x: spots[i][0], y: spots[i][1], w: w - spots[i][0] > hw ? w - hw : hw, h: h - spots[i][1] > hh ? h - hh : hh });
  }
  return rects;
}
