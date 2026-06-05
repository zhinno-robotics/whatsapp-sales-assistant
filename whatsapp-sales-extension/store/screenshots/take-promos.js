/**
 * take-promos.js — Captures 3 Chrome Web Store promo tiles using Puppeteer.
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SRC = path.resolve(__dirname, 'promo-tiles.html');
const OUT = __dirname;

const tiles = [
  { name: 'promo-small',  cls: 'small',  w: 440,  h: 280 },
  { name: 'promo-large',  cls: 'large',  w: 920,  h: 680 },
  { name: 'promo-marquee',cls: 'marquee',w: 1400, h: 560 },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox'],
  });
  const rawHtml = fs.readFileSync(SRC, 'utf-8');
  const cssMatch = rawHtml.match(/<style>([\s\S]*?)<\/style>/);
  const css = cssMatch ? cssMatch[1] : '';

  for (const t of tiles) {
    const re = new RegExp(
      `<div class="tile ${t.cls}">([\\s\\S]*?)<\\/div>\\s*(?=<!--|<\\/body>)`
    );
    const m = rawHtml.match(re);
    if (!m) { console.error(`NOT FOUND: ${t.cls}`); continue; }

    const inner = m[1];
    const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html,body{width:${t.w}px;height:${t.h}px;overflow:hidden;background:#0f172a}
${css}
</style></head>
<body>
<div class="tile ${t.cls}">${inner}</div>
</body></html>`;

    const tmpPath = path.join(OUT, `_${t.cls}.html`);
    fs.writeFileSync(tmpPath, pageHtml, 'utf-8');

    const page = await browser.newPage();
    await page.setViewport({ width: t.w, height: t.h, deviceScaleFactor: 1 });
    await page.goto(`file:///${tmpPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

    const pngPath = path.join(OUT, `${t.name}.png`);
    await page.screenshot({ path: pngPath, fullPage: false });
    const size = fs.statSync(pngPath).size;

    console.log(`  -> ${t.name}.png  ${t.w}x${t.h}  ${(size / 1024).toFixed(1)} KB`);
    await page.close();
    fs.unlinkSync(tmpPath);
  }

  await browser.close();
  console.log('\nDone!');
})();
