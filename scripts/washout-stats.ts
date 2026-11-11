/**
 * Zone colour stats for saved screenshots — HSV saturation (the honest
 * "vivid" measure: chroma/max; HSL S lies about pastels), luminance, chroma,
 * blown-highlight %. Usage: npx tsx scripts/probe-stats.ts <png>...
 */
import { chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) { console.error('give me PNGs'); process.exit(1); }

// kept as a raw string: esbuild's __name wrapper breaks nested arrows when
// playwright injects a real function into the page
const FN = `(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const stat = (x0, x1, y0, y1) => {
    let s = 0, l = 0, c = 0, n = 0, blown = 0;
    for (let y = Math.floor(y0 * img.height); y < y1 * img.height; y++) {
      for (let x = Math.floor(x0 * img.width); x < x1 * img.width; x++) {
        const p = (y * img.width + x) * 4;
        const r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        s += mx < 1e-4 ? 0 : (mx - mn) / mx;
        c += mx - mn;
        l += lum;
        if (lum > 0.96) blown++;
        n++;
      }
    }
    return {
      hsvSat: +(s / n).toFixed(4), lum: +(l / n).toFixed(4),
      chroma: +(c / n).toFixed(4), blownPct: +(100 * blown / n).toFixed(2),
    };
  };
  return {
    ground: stat(0, 1, 0.55, 1),
    forest: stat(0, 0.2, 0.15, 0.5),
    sky: stat(0.3, 0.7, 0.0, 0.1),
    full: stat(0, 1, 0, 1),
  };
})`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

for (const f of files) {
  const b64 = fs.readFileSync(f).toString('base64');
  const zones = await page.evaluate(`${FN}(${JSON.stringify(b64)})`);
  console.log(path.basename(f), JSON.stringify(zones));
}
await browser.close();
