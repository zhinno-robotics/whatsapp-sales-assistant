/**
 * take-screenshots.js
 * Splits screenshots.html into 5 individual pages and captures each
 * via Edge headless mode at 1280x800.
 *
 * Usage: node store/screenshots/take-screenshots.js
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SOURCE = path.resolve(__dirname, '..', 'screenshots.html');
const OUT = __dirname;

// ── Read & Parse ──
const html = fs.readFileSync(SOURCE, 'utf-8');
const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const allCss = cssMatch ? cssMatch[1] : '';

// Remove :hover pseudo-classes (cause problems in headless screenshots)
const css = allCss.replace(/\.chat-item:hover\s*\{[^}]*\}/g, '')
                  .replace(/\.frame::after\s*\{[^}]*\}/g, '.frame::after { display:none }');

// Find frame blocks: each is <div class="frame frameN">...</div>
const frameRegex = /<!-- Frame (\d+): (.+?) -->\s*<div class="frame frame\d+">\s*([\s\S]*?)\s*<\/div>\s*(?=<!-- Frame |<\/body>)/g;

const frames = [];
let m;
while ((m = frameRegex.exec(html)) !== null) {
  frames.push({ num: m[1], label: m[2], inner: m[3].trim() });
}

console.log(`Found ${frames.length} frames`);

// ── Create per-frame HTML & screenshot ──
for (const f of frames) {
  const frameHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:800px;overflow:hidden}
${css}
.frame{width:1280px;height:800px;position:relative;overflow:hidden}
</style>
</head>
<body>
<div class="frame frame${f.num}">
  <div class="frame-label">Screenshot ${f.num}: ${f.label}</div>
  ${f.inner}
</div>
</body>
</html>`;

  const framePath = path.join(OUT, `_frame${f.num}.html`);
  const pngPath = path.join(OUT, `screenshot-${f.num}.png`);
  fs.writeFileSync(framePath, frameHtml, 'utf-8');

  // Convert to file:// URL
  const fileUrl = `file:///${framePath.replace(/\\/g, '/')}`;

  console.log(`[${f.num}/5] Capturing: ${f.label}`);
  try {
    execFileSync(EDGE, [
      '--headless=new',
      `--screenshot=${pngPath}`,
      '--window-size=1280,800',
      '--hide-scrollbars',
      '--disable-features=TranslateUI',
      `--virtual-time-budget=2000`,
      fileUrl,
    ], { timeout: 15000, stdio: 'pipe' });

    const size = fs.statSync(pngPath).size;
    console.log(`  -> screenshot-${f.num}.png  ${(size / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.error(`  -> FAILED: ${e.message}`);
  }

  // Clean up temp HTML
  fs.unlinkSync(framePath);
}

console.log('\nDone! Screenshots saved to store/screenshots/');
