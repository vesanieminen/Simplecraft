/**
 * Owns the DOM layers: one pane container per split-screen viewport
 * (HUD + player overlays line up exactly with the GL viewports), plus
 * global bits (welcome screen, toasts, freeze banner).
 */

import { ViewportRect } from '../render/viewportManager';
import { Overlay } from './overlays';
import { Hud } from './hud';

export class UiManager {
  root: HTMLElement;
  private panes: HTMLElement[] = [];
  private hudEls: (Hud | null)[] = [];
  private overlayEls: HTMLElement[][] = [];
  get paneCount(): number {
    return this.panes.length;
  }
  private welcomeEl: HTMLElement;
  private pauseEl: HTMLElement;
  private toastEl: HTMLElement | null = null;
  private toastTimer: number | undefined;

  constructor() {
    this.root = document.getElementById('ui-root')!;
    this.welcomeEl = document.createElement('div');
    this.welcomeEl.className = 'global-layer';
    this.welcomeEl.innerHTML = `
      <div class="welcome">
        <h1>🧱 Little Block World</h1>
        <div class="press">Press any button on a controller to join!</div>
        <div class="sub" style="color:#fff;margin-top:10px">Pick a world first: Y / △ (F)</div>
        <div class="sub" style="color:#fff;margin-top:4px">Keyboard: press Enter to join, F for worlds</div>
      </div>`;
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'pause-banner';
    this.pauseEl.textContent = '⏸ Game Frozen';
    this.pauseEl.style.display = 'none';
  }

  mount(): void {
    this.root.append(this.welcomeEl, this.pauseEl);
  }

  ensurePanes(n: number): void {
    while (this.panes.length < n) {
      const p = document.createElement('div');
      p.className = 'pane';
      this.root.appendChild(p);
      this.panes.push(p);
      this.hudEls.push(null);
      this.overlayEls.push([]);
    }
  }

  setPaneRect(i: number, r: ViewportRect): void {
    const p = this.panes[i];
    if (!p) return;
    p.style.left = `${r.x}px`;
    p.style.top = `${r.y}px`;
    p.style.width = `${r.w}px`;
    p.style.height = `${r.h}px`;
    // UI scales down a bit for quarter panes, stays comfy for halves
    const scale = Math.min(1.1, Math.max(0.62, Math.sqrt((r.w * r.h) / (1280 * 720)) * 1.05));
    p.style.setProperty('--ui-scale', String(scale.toFixed(3)));
  }

  attachHud(pane: number, hud: Hud): void {
    this.panes[pane]?.appendChild(hud.root);
    this.hudEls[pane] = hud;
  }

  getHud(pane: number): Hud | null {
    return this.hudEls[pane] ?? null;
  }

  detachHud(pane: number): void {
    this.hudEls[pane]?.root.remove();
    this.hudEls[pane] = null;
  }

  addOverlay(pane: number, o: Overlay): void {
    this.panes[pane]?.appendChild(o.el);
    this.overlayEls[pane]?.push(o.el);
  }

  clearOverlays(pane: number): void {
    for (const el of this.overlayEls[pane] ?? []) el.remove();
    if (this.overlayEls[pane]) this.overlayEls[pane].length = 0;
  }

  showWelcome(show: boolean): void {
    this.welcomeEl.style.display = show ? 'flex' : 'none';
  }

  showFreeze(show: boolean): void {
    this.pauseEl.style.display = show ? 'block' : 'none';
  }

  toast(msg: string, ms = 2600): void {
    this.toastEl?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    this.root.appendChild(t);
    this.toastEl = t;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.remove(), ms);
  }

  /** screen punch when something big goes off */
  flash(strength = 0.35): void {
    const el = document.createElement('div');
    el.className = 'blast-flash';
    el.style.opacity = String(Math.max(0.12, Math.min(0.75, strength)));
    this.root.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
    window.setTimeout(() => el.remove(), 460);
  }
}
