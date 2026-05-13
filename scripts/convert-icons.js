/**
 * Convert SVG icons to PNG using Puppeteer (already installed for WhatsApp Web)
 * Usage: node scripts/convert-icons.js
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ICONS_DIR = path.join(__dirname, '..', 'extension', 'icons');
const SIZES = [16, 48, 128];

async function convert() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  
  for (const size of SIZES) {
    const svgPath = path.join(ICONS_DIR, `icon-${size}.svg`);
    const pngPath = path.join(ICONS_DIR, `icon-${size}.png`);
    
    if (!fs.existsSync(svgPath)) {
      console.log(`  [skip] No SVG for ${size}px`);
      continue;
    }
    
    const svg = fs.readFileSync(svgPath, 'utf-8');
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 2 });
    await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;">${svg}</body></html>`);
    
    const el = await page.$('svg');
    if (!el) { console.log(`  [fail] No SVG element for ${size}px`); await page.close(); continue; }
    
    await el.screenshot({ path: pngPath, omitBackground: false });
    await page.close();
    console.log(`  [ok] icon-${size}.png (${size}x${size} @2x)`);
  }
  
  await browser.close();
  console.log('Done.');
}

convert().catch(err => { console.error(err); process.exit(1); });
