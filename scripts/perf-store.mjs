// Måler ANNY-siden i dev store'en med og uden graveringsmodulet (mobil, 4G),
// og tjekker at three.js og engraver.js først hentes ved klik.
//   FH_PASSWORD=… FH_THEME=210941542732 node scripts/perf-store.mjs
// Uden 3D bruger skabelonen product.uden-3d (samme side, show_engraver = false).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // forudinstalleret globalt

const BASE = 'https://frede-host-demo.myshopify.com';
const THEME = process.env.FH_THEME;
const RUNS = Number(process.env.RUNS || 7);
const VARIANTS = { 'Med 3D-gravering': '', 'Uden 3D-gravering': '&view=uden-3d' };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function session() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/password', { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=password]', process.env.FH_PASSWORD);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.press('input[type=password]', 'Enter')]);
  return { ctx, page };
}

async function measure(query, clickModal) {
  const { ctx, page } = await session();
  const url = `${BASE}/products/anny?preview_theme_id=${THEME}${query}`;
  await page.goto(url, { waitUntil: 'load' });              // varmer preview-cookie op
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  const reqs = [], bytes = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.push({ id: e.requestId, url: e.request.url }));
  cdp.on('Network.loadingFinished', (e) => bytes.set(e.requestId, e.encodedDataLength));
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, lcp: window.__lcp, html: n.encodedBodySize, hasModal: !!document.querySelector('[data-engraver]') };
  });
  const heavy = reqs.filter((r) => /three\.module|engraver\.js/.test(r.url)).length;
  const r = { ...t, requests: reqs.length, bytes: [...bytes.values()].reduce((a, b) => a + b, 0), heavy };
  if (clickModal) {
    const before = reqs.length;
    await page.click('[data-engrave-open]');
    await page.waitForSelector('.engraver.is-ready', { timeout: 120000 });
    r.after = reqs.slice(before).filter((x) => /three|engraver/.test(x.url)).map((x) => x.url.split('/').pop().split('?')[0] + ' ' + Math.round((bytes.get(x.id) || 0) / 1024) + ' kB');
  }
  await ctx.close();
  return r;
}

for (const [name, q] of Object.entries(VARIANTS)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(q, false));
  console.log(`\n${name} (median af ${RUNS}, mobil, 4G) – modal i HTML: ${runs[0].hasModal}`);
  for (const k of ['ttfb', 'dcl', 'lcp', 'load']) console.log(`  ${k.toUpperCase().padEnd(5)} ${Math.round(median(runs.map((x) => x[k])))} ms`);
  console.log(`  HTML  ${(median(runs.map((x) => x.html)) / 1024).toFixed(1)} kB (komprimeret)`);
  console.log(`  I alt ${(median(runs.map((x) => x.bytes)) / 1024).toFixed(0)} kB i ${median(runs.map((x) => x.requests))} forespørgsler`);
  console.log(`  three.js/engraver.js hentet før klik: ${Math.max(...runs.map((x) => x.heavy))}`);
}
const c = await measure('', true);
console.log('\nHentet først efter klik på «Tilføj gravering»:\n  ' + c.after.join('\n  '));
await browser.close();
