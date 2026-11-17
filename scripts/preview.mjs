// Lokal forhåndsvisning af temaet uden Shopify.
// Renderer forsiden og ANNY-siden til dist/ med en simpel efterligning af
// Shopifys Liquid. Bruges til skærmbilleder og ydelsesmåling, ikke til drift.
//
//   npm install && npm run preview            → dist/
//   npm run preview -- --no-engraver          → dist/ uden gravering/3D (til sammenligning)
import { Liquid, Tag } from 'liquidjs';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dist');
const noEngraver = process.argv.includes('--no-engraver');
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const mood = arg('--mood');          // fx --mood lounge
const indexTpl = arg('--index') || 'index';   // fx --index index.lounge

const engine = new Liquid({ root: [path.join(root, 'snippets')], extname: '.liquid', strictFilters: false });

// Shopify-filtre, der bruges i temaet
engine.registerFilter('asset_url', (n) => `/assets/${n}`);
engine.registerFilter('stylesheet_tag', (u) => `<link rel="stylesheet" href="${u}">`);
engine.registerFilter('image_url', (img, opts) => (img && img.src) || '');
engine.registerFilter('money_without_trailing_zeros', (c) => {
  const kr = c / 100;
  return (Number.isInteger(kr) ? kr.toLocaleString('da-DK') : kr.toLocaleString('da-DK', { minimumFractionDigits: 2 })) + ' kr.';
});
engine.registerFilter('default_errors', () => '');

const readSchema = (src) => {
  const m = src.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  return m ? JSON.parse(m[1]) : {};
};
const defaults = (list = []) => Object.fromEntries(list.filter((s) => 'id' in s).map((s) => [s.id, s.default ?? '']));
const settingsSchema = JSON.parse(fs.readFileSync(path.join(root, 'config/settings_schema.json'), 'utf8'));
const globalSettings = Object.assign({}, ...settingsSchema.map((g) => defaults(g.settings)));
if (mood) globalSettings.mood = mood;

async function renderSection(type, data, ctx) {
  const file = path.join(root, 'sections', type + '.liquid');
  let src = fs.readFileSync(file, 'utf8');
  if (noEngraver) src = src.replace(/{%-?\s*render 'engraver-modal'[^%]*-?%}/, '');
  const schema = readSchema(src);
  const settings = { ...defaults(schema.settings), ...(data.settings || {}) };
  const blocks = (data.block_order || []).map((id) => {
    const b = data.blocks[id];
    const bs = (schema.blocks || []).find((x) => x.type === b.type) || {};
    return { id, type: b.type, settings: { ...defaults(bs.settings), ...b.settings }, shopify_attributes: '' };
  });
  const html = await engine.parseAndRender(src, { ...ctx, section: { id: type, settings, blocks } });
  return `<div id="shopify-section-${type}" class="shopify-section">${html}</div>`;
}

class SchemaTag extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    while (remain.length) { const t = remain.shift(); if (t.name === 'endschema') return; }
  }
  * render() { return ''; }
}
engine.registerTag('schema', SchemaTag);
engine.registerTag('section', class extends Tag {
  constructor(token, remain, liquid) { super(token, remain, liquid); this.name = token.args.trim().replace(/['"]/g, ''); }
  * render(ctx) { return yield renderSection(this.name, {}, ctx.getAll()); }
});

const product = {
  title: 'TOVE Raflebæger',
  handle: 'tove',
  price: 99900,
  available: true,
  media: [],
  metafields: {},
  description: '<p>Tove var indbegrebet af en solstråle, der trodsede livets udfordringer med et smil. Hun kunne lyse ethvert rum op, men var også en bestemt dame med klare holdninger, som aldrig var bange for at stå ved sine meninger.</p>',
};

async function page(template, outFile, extra) {
  const tpl = JSON.parse(fs.readFileSync(path.join(root, 'templates', template + '.json'), 'utf8'));
  const ctx = { settings: globalSettings, routes: { root_url: '/' }, template: { name: template }, ...extra };
  let body = '';
  for (const id of tpl.order) body += await renderSection(tpl.sections[id].type, tpl.sections[id], ctx);
  const layout = fs.readFileSync(path.join(root, 'layout/theme.liquid'), 'utf8');
  const html = await engine.parseAndRender(layout, { ...ctx, content_for_layout: body, content_for_header: '', page_title: extra.page_title });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'assets'))) fs.copyFileSync(path.join(root, 'assets', f), path.join(out, 'assets', f));
await page(indexTpl, path.join(out, 'index.html'), { page_title: 'Frede Høst | Raflebægeret siden 1995' });
await page('product', path.join(out, 'products/tove/index.html'), { product, page_title: 'TOVE Raflebæger i olieret wenge og eg' });
console.log('Skrevet til', out, noEngraver ? '(uden gravering)' : '');
