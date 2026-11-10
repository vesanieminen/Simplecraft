const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto('http://localhost:3152/');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 120000 });
await page.evaluate(() => window.__lbw.setDayMode('night'));
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const g = window.__lbw.game;
    let glare = null; let dir = 9;
    g.scene.traverse((o) => { if (o.isSprite && o.scale.x > 100) glare = { s: +o.scale.x.toFixed(0), op: +o.material.opacity.toFixed(3), vis: o.visible }; });
    g.scene.traverse((o) => { if (o.isDirectionalLight) dir = o.intensity; });
    return { phase: +window.__lbw.dayPhase().toFixed(3), dir: +dir.toFixed(2), glare };
  });
  console.log(JSON.stringify(r));
}
await browser.close();
