// Tester 3D-graveringen i dev store'en: begge temaer, på computer og mobil.
//   FH_PASSWORD=… node scripts/test-engraver.mjs
// Valgfrit:
//   THREE_FILE=sti/til/three.module.min.js   hvis jsDelivr er blokeret i testmiljøet (samme fil, r160)
//   FH_THEMES=id,id                          andre temaer end de to demo-temaer
//   FH_DEVICES=computer eller mobil          kun den ene skærmstørrelse
// Tiderne er vejledende (processoren er gjort 4 gange langsommere, og der er
// intet rigtigt grafikkort). De øvrige tjek skal alle være «ok»; ellers
// afslutter scriptet med fejlkode.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
const { chromium, devices } = createRequire(import.meta.url)('playwright');   // forudinstalleret globalt

const BASE = 'https://frede-host-demo.myshopify.com';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.min.js';
const THEMES = (process.env.FH_THEMES || '210973819212,210941542732').split(',');
// Mobil testes i enkelt opløsning: uden grafikkort tager hvert billede ellers flere sekunder.
// Mobilen er en skærm på iPhone-størrelse med berøring, men uden iPhones browserkennung:
// Shopify sender iPhone-browsere en tur omkring shop.app («Log ind med Shop»), og den
// adresse kan et lukket testmiljø ikke nå. En rigtig telefon mærker ikke omvejen.
const phone = devices['iPhone 13'];
const DEVICES = [['computer', { viewport: { width: 1440, height: 900 } }], ['mobil', { viewport: phone.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }]]
  .filter(([name]) => !process.env.FH_DEVICES || process.env.FH_DEVICES.split(',').includes(name));
const three = process.env.THREE_FILE ? fs.readFileSync(process.env.THREE_FILE) : null;
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEJL'} ${name}${extra ? ' – ' + extra : ''}`);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(opts, theme, { blockThree = false } = {}) {
  const ctx = await browser.newContext(opts);
  if (blockThree) await ctx.route(THREE_URL, (r) => r.abort());
  else if (three) await ctx.route(THREE_URL, (r) => r.fulfill({ status: 200, body: three, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' } }));
  await ctx.addInitScript(() => {
    // tæl de Web Workers, 3D-koden selv starter (de har en blob:-adresse)
    window.__w = { made: 0, errors: 0 };
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(u, o) {
        super(u, o);
        if (String(u).startsWith('blob:')) { window.__w.made++; this.addEventListener('error', () => window.__w.errors++); }
      }
    };
    window.__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  });
  const page = await ctx.newPage();
  // Kun fejl fra produktsiden tæller: kodeordssiden og siden lige efter login
  // vises af butikkens live tema, ikke af demo-temaet.
  const errors = [];
  page.on('pageerror', (e) => { if (page.url().includes('/products/')) errors.push(e.message.slice(0, 140)); });
  for (let attempt = 1; ; attempt++) {
    // Butikken svarer af og til med en anden side lige efter mange forespørgsler,
    // og forbindelsen kan falde ud et øjeblik: prøv op til tre gange.
    let problem = '';
    try {
      await page.goto(BASE + '/password', { waitUntil: 'domcontentloaded' });
      if (await page.locator('input[type=password]').count()) {
        await page.fill('input[type=password]', process.env.FH_PASSWORD);
        await Promise.all([page.waitForNavigation().catch(() => {}), page.press('input[type=password]', 'Enter')]);
      }
      await page.goto(`${BASE}/products/tove?preview_theme_id=${theme}`, { waitUntil: 'networkidle' });
      if (await page.locator('[data-engraver]').count()) break;
      problem = `${page.url()} – «${await page.title()}»`;
    } catch (e) {
      problem = e.message.split('\n')[0];
    }
    if (attempt === 3) throw new Error(`Produktsiden blev ikke vist (${problem})`);
    await page.waitForTimeout(4000);
  }
  return { ctx, page, errors };
}

for (const theme of THEMES) {
  for (const [device, opts] of DEVICES) {
    const { ctx, page, errors } = await open(opts, theme);
    const info = await page.evaluate(() => ({
      mood: document.documentElement.dataset.mood,
      robots: document.querySelector('meta[name=robots]')?.content || '',
      wood: document.querySelector('[data-engraver]').dataset.wood,
    }));
    console.log(`\n== tema ${theme} (${info.mood}) · ${device} ==`);
    check('noindex på siden', info.robots.includes('noindex'));
    check('træ i 3D er wenge og eg', info.wood === 'wenge-eg', info.wood);

    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => window.__lt.splice(0));
    const t0 = Date.now();
    await page.click('[data-engrave-open]');
    await page.waitForSelector('.engraver.is-ready', { timeout: 120000 });
    const openMs = Date.now() - t0;
    await page.waitForTimeout(900);
    const openTasks = await page.evaluate(() => window.__lt.splice(0));
    const workers = await page.evaluate(() => window.__w);
    await page.type('#eng-line1', 'Familien Høst', { delay: 90 });
    await page.waitForTimeout(900);
    const keyTasks = await page.evaluate(() => window.__lt.splice(0));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log(`  tid  åbn → klar: ${openMs} ms · længste frysning ved åbning: ${Math.max(0, ...openTasks)} ms · ved tastetryk: ${Math.max(0, ...keyTasks)} ms`);
    check('træet regnes ud i Web Workers uden fejl', workers.made >= 2 && workers.made <= 6 && workers.errors === 0, JSON.stringify(workers));
    check('3D vises (ikke nødvisning)', (await page.locator('.engraver__flat').count()) === 0);
    check('teksten står i ordreoversigten', (await page.textContent('[data-order=text]')) === '«Familien Høst»');

    const canvas = page.locator('[data-canvas]');
    // Vent, til billedet står stille, og giv så dets fingeraftryk. Fokus fjernes
    // først, så tastaturets fokusramme og hjælpetekst ikke tæller med: det er
    // bægerets stilling, der sammenlignes.
    const settle = async () => {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      let prev = '', cur = md5(await canvas.screenshot());
      for (let i = 0; i < 40 && cur !== prev; i++) { await page.waitForTimeout(250); prev = cur; cur = md5(await canvas.screenshot()); }
      return cur;
    };
    const start = await settle();
    await canvas.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    check('tastaturfokus viser, at piletasterne kan bruges', (await page.evaluate(() => getComputedStyle(document.querySelector('.engraver__hint'), '::after').content)).includes('piletasterne'));
    const turned = await settle();
    check('piletaster drejer bægeret', turned !== start);
    await canvas.focus();
    await page.keyboard.press('Home');
    check('Home viser bunden i startstillingen', (await settle()) === start);
    const box = await canvas.boundingBox();
    const drag = async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 50, { steps: 6 });
      await page.mouse.up();
    };
    await drag();
    check('træk drejer bægeret', (await settle()) !== start);
    await page.click('[data-reset]');
    check('«Vis bunden» ender i startstillingen', (await settle()) === start);
    await page.click('[data-close]');
    await page.waitForTimeout(300);
    await page.click('[data-engrave-open]');
    await page.waitForTimeout(500);
    await drag();
    check('kan drejes efter luk og åbn igen', (await settle()) !== start);
    await page.click('[data-save]');
    await page.waitForTimeout(300);
    check('«Gem og læg i kurv» gemmer graveringen på siden', (await page.textContent('[data-engrave-summary]')).includes('«Familien Høst»'));
    check('ingen fejl på siden', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/engraver-${theme}-${device}.png` }).catch(() => {});
    await ctx.close();
  }
}

// Nødvisning: three.js kan ikke hentes
{
  const { ctx, page } = await open(DEVICES[0][1], THEMES[0], { blockThree: true });
  console.log('\n== nødvisning: three.js kan ikke hentes ==');
  await page.click('[data-engrave-open]');
  await page.fill('#eng-line1', 'Uden 3D');
  await page.waitForSelector('.engraver.is-ready', { timeout: 60000 });
  await page.waitForTimeout(900);
  check('bunden vises fladt med graveringen', (await page.locator('.engraver__flat').count()) === 1);
  check('ingen fejlbesked', !(await page.locator('[data-loading]').isVisible()));
  check('dreje-tekst og «Vis bunden» er skjult', !(await page.locator('.engraver__hint').isVisible()) && !(await page.locator('[data-reset]').isVisible()));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} tjek fejlede` : '\nAlle tjek er ok');
process.exit(failed ? 1 : 0);
