/**
 * Render the intro's fallback video from the real-time scene: drives the dev hook
 * window.__opsLaunch.seek(t) frame by frame in headless Chromium and encodes with ffmpeg.
 *
 *   node scripts/render-intro.cjs [--url http://localhost:3000] [--fps 24] [--out public/intro/intro-fallback.mp4]
 *
 * Needs a running dev server (development build exposes the hook) and ffmpeg on PATH.
 * With software GL (no GPU) a 17 s clip takes several minutes; on a GPU box it is quick.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'http://localhost:3000');
const FPS = Number(arg('fps', '24'));
const OUT = path.resolve(arg('out', 'public/intro/intro-fallback.mp4'));
const DUR = Number(arg('duration', '18'));
const W = Number(arg('width', '1280'));
const H = Number(arg('height', '720'));
const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'intro-frames-'));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  ctx.setDefaultTimeout(180000);
  const page = await ctx.newPage();
  await page.goto(`${URL}/?intro=standard`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__opsLaunch, null, { timeout: 180000 });
  await page.waitForTimeout(6000);
  // Hide the HTML controls; the title, captions and fade stay (they are part of the film).
  await page.addStyleTag({ content: '.launch-overlay button, .launch-overlay label, nextjs-portal { display: none !important; }' });
  const n = Math.round(DUR * FPS);
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    await page.evaluate((t) => window.__opsLaunch.seek(t), t);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`), timeout: 180000 });
    if (i % FPS === 0) console.log(`rendered ${t.toFixed(0)} s`);
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart ${OUT}`);
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/f%04d.png -c:v libvpx-vp9 -b:v 0 -crf 34 ${OUT.replace(/\.mp4$/, '.webm')}`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
