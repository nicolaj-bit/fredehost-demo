// Måler ANNY-siden med og uden graveringsmodulet, med neddroslet net (4G),
// og tjekker at three.js og engraver.js først hentes, når modalen åbnes.
//   npm run preview && npm run preview -- --no-engraver --out dist-base
//   python3 -m http.server 8765 --directory dist & python3 -m http.server 8766 --directory dist-base &
//   node scripts/perf.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // forudinstalleret globalt

const RUNS = 7;
const URLS = { 'Med 3D-gravering': 'http://localhost:8765/products/tove/', 'Uden 3D-gravering': 'http://localhost:8766/products/tove/' };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function measure(url, clickModal) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  // «Fast 4G»: 9 Mbit/s ned, 1,5 Mbit/s op, 60 ms latens
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  const reqs = [];
  const bytes = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.push({ id: e.requestId, url: e.request.url }));
  cdp.on('Network.loadingFinished', (e) => bytes.set(e.requestId, e.encodedDataLength));
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, lcp: window.__lcp, html: n.encodedBodySize };
  });
  const heavy = reqs.filter((r) => /three\.module|engraver\.js/.test(r.url)).length;
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  const result = { ...t, requests: reqs.length, bytes: total, heavyBeforeClick: heavy };
  if (clickModal) {
    const before = reqs.length;
    await page.click('[data-engrave-open]');
    await page.waitForSelector('.engraver.is-ready', { timeout: 120000 });
    const after = reqs.slice(before);
    result.afterClick = after.map((r) => r.url.split('/').pop() + ' ' + Math.round((bytes.get(r.id) || 0) / 1024) + ' kB');
  }
  await ctx.close();
  return result;
}

for (const [name, url] of Object.entries(URLS)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(url, false));
  console.log(`\n${name} (median af ${RUNS}, mobil, 4G):`);
  for (const k of ['dcl', 'lcp', 'load']) console.log(`  ${k.toUpperCase().padEnd(5)} ${Math.round(median(runs.map((r) => r[k])))} ms`);
  console.log(`  HTML  ${(median(runs.map((r) => r.html)) / 1024).toFixed(1)} kB`);
  console.log(`  I alt ${(median(runs.map((r) => r.bytes)) / 1024).toFixed(0)} kB i ${median(runs.map((r) => r.requests))} forespørgsler`);
  console.log(`  three.js/engraver.js hentet før klik: ${Math.max(...runs.map((r) => r.heavyBeforeClick))}`);
}
const c = await measure(URLS['Med 3D-gravering'], true);
console.log('\nHentet først efter klik på «Tilføj gravering»:\n  ' + c.afterClick.join('\n  '));
await browser.close();
