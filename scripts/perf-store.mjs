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
  // Valgfrit: lever three.js lokalt, hvis jsDelivr er blokeret i testmiljøet (samme fil, r160).
  if (process.env.THREE_FILE) {
    const body = (await import('node:fs')).readFileSync(process.env.THREE_FILE);
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.min.js', (r) =>
      r.fulfill({ status: 200, body, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' } }));
  }
  const url = `${BASE}/products/tove?preview_theme_id=${THEME}${query}`;
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
    return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, lcp: window.__lcp, html: n.encodedBodySize, hasModal: !!document.querySelector('[data-engraver]'), wood: document.querySelector('[data-engraver]')?.dataset.wood };
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

// Varianterne måles på skift, så svingninger i Shopifys svartid rammer begge ens.
const all = Object.fromEntries(Object.keys(VARIANTS).map((k) => [k, []]));
for (let i = 0; i < RUNS; i++) for (const [name, q] of Object.entries(VARIANTS)) all[name].push(await measure(q, false));
for (const name of Object.keys(VARIANTS)) {
  const runs = all[name];
  console.log(`\n${name} (median af ${RUNS}, mobil, 4G) – modal i HTML: ${runs[0].hasModal}, træ i 3D: ${runs[0].wood ?? '–'}`);
  for (const k of ['ttfb', 'dcl', 'lcp', 'load']) console.log(`  ${k.toUpperCase().padEnd(5)} ${Math.round(median(runs.map((x) => x[k])))} ms`);
  console.log(`  LCP efter svar fra server ${Math.round(median(runs.map((x) => x.lcp - x.ttfb)))} ms`);
  const q = (arr, f) => { const s = [...arr].sort((x, y) => x - y); return Math.round(s[Math.floor((s.length - 1) * f)]); };
  const l = runs.map((x) => x.lcp);
  console.log(`  LCP spredning: hurtigste ${q(l, 0)} · 25 % ${q(l, 0.25)} · 75 % ${q(l, 0.75)} · langsomste ${q(l, 1)} ms`);
  console.log(`  HTML  ${(median(runs.map((x) => x.html)) / 1024).toFixed(1)} kB (komprimeret)`);
  console.log(`  I alt ${(median(runs.map((x) => x.bytes)) / 1024).toFixed(0)} kB i ${median(runs.map((x) => x.requests))} forespørgsler`);
  console.log(`  three.js/engraver.js hentet før klik: ${Math.max(...runs.map((x) => x.heavy))}`);
}
const c = await measure('', true);
console.log('\nHentet først efter klik på «Tilføj gravering»:\n  ' + c.after.join('\n  '));
await browser.close();
