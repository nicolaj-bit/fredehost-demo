/*
  Frede Høst – 3D-forhåndsvisning af gravering i bunden af raflebægeret.

  Hentes først, når kunden åbner graveringsmodalen (se snippets/engraver-modal.liquid).
  three.js hentes herfra med import(), så intet af det belaster produktsiden.

  Mål (cm), fra fredehost.dk: højde 15,5, diameter 9.
  Bægeret består af tolv trædele: kroppen er en tolvkantet, keglestubformet
  krop med flade sider og synlige limfuger. Foden er drejet i ét stykke.
  Træet er olieret eg med årer, der løber på langs af hver stav, og
  marvstråler. TOVE har skiftevis staver af wenge og eg. Foden er eg på
  begge. Bunden er endetræ med årringe fra to sammenlimede emner.
  Graveringen er et lasermærke: brændt mørkt, men uden fordybning, så
  træets struktur stadig anes igennem.

  Ydelse: Træets teksturer regnes ud i Web Workers, så siden ikke fryser,
  mens modalen åbner. Når kunden skriver, tegnes kun tekstfeltet i bunden om,
  ikke hele teksturen. Der renderes kun, når noget har ændret sig.
*/

const H = 15.5;          // samlet højde
const R_MAX = 4.5;       // største radius (diameter 9 cm)
const STAVES = 12;
const SEAM_Y = 7.2;      // samlingen mellem fod og krop
const FOOT_R = 3.2;      // radius på den flade bund under foden
const PITCH0 = -1.1;     // startvinkel: vippet, så bunden ses med det samme
const YAW0 = 0.24;
const PITCH_MIN = -1.75, PITCH_MAX = 0.35;
const TEX = 1024;        // bundens tekstur i pixels

// Felter i bundens tekstur (andele af siden). Kundens tekst og Frede Høsts
// mærke ligger i hver sit felt, så de kan tegnes om uafhængigt af hinanden.
const TEXT_BOX = { x: 0.12, y: 0.3, w: 0.76, h: 0.32 };
const MARK_BOX = { x: 0.26, y: 0.67, w: 0.48, h: 0.17 };
const ROUGH = 'rgb(0,140,0)';   // grøn kanal = ruhed (≈ 0,55) for olieret træ

const FONTS = {
  serif: '500 {s}px Newsreader, Georgia, "Times New Roman", serif',
  sans: '500 {s}px Inter, "Helvetica Neue", Arial, sans-serif',
};
const MARK_FONT = FONTS.sans.replace('500', '600');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ---------- teksturer ---------- */

// Regner én tekstur ud som rå pixels. VIGTIGT: funktionen sendes som tekst
// til en Web Worker og må derfor ikke bruge noget uden for sig selv.
function generate(job) {
  const STAVES = 12;
  const OAK = [146, 100, 58];     // olieret eg: varm, gylden brun
  const WENGE = [46, 30, 22];     // olieret wenge: næsten sort brun
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // glat 1D-støj (værdistøj med cosinus-interpolation)
  function noise1(seed) {
    const r = rng(seed), n = 256, v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = r() * 2 - 1;
    return (x) => {
      const i = Math.floor(x), f = x - i;
      const a = v[((i % n) + n) % n], b = v[(((i + 1) % n) + n) % n];
      const t = (1 - Math.cos(f * Math.PI)) / 2;
      return a + (b - a) * t;
    };
  }
  // Hver stav har sin egen tone og årestruktur. Samme tal hver gang, så
  // stavenes sider og deres endetræ i toppen passer sammen.
  function staveParams(wood) {
    const r = rng(1995), staves = [];
    for (let i = 0; i < STAVES; i++) {
      const wenge = wood === 'wenge-eg' && i % 2 === 1;
      staves.push({
        wenge,
        base: wenge ? WENGE : OAK,
        tone: 0.9 + r() * 0.17,
        warm: r() * 0.08 - 0.04,
        quarter: i % 3 !== 1,          // to ud af tre er kvartersavet, resten har «katedral»-årer
        spacing: 9 + r() * 7,
        slant: (r() - 0.5) * 0.06,
        cx: 0.3 + r() * 0.4,
        arch: 0.004 + r() * 0.004,
        off: r() * 1000,
        wave: noise1(100 + i),
      });
    }
    return staves;
  }
  const image = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
  const put = (d, i4, base, shade, warm) => {
    d[i4] = clamp(base[0] * shade * (1 + warm));
    d[i4 + 1] = clamp(base[1] * shade);
    d[i4 + 2] = clamp(base[2] * shade * (1 - warm));
    d[i4 + 3] = 255;
  };

  // Tolv staver side om side med en tynd, mørk limfuge i kanten.
  if (job.kind === 'stave') {
    const W = 1536, Hh = 1024, sw = W / STAVES;
    const out = image(W, Hh), d = out.data, staves = staveParams(job.wood);
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        const si = Math.floor(x / sw), s = staves[si];
        const lx = x - si * sw;               // px inde i staven
        const edge = Math.min(lx, sw - 1 - lx);
        let g, shade;
        if (s.wenge) {
          // wenge: tætte, lige striber med lidt bølge; ingen marvstråler
          g = lx * 1.9 + s.slant * y + s.wave(y / 160 + s.off) * 4;
          const f = (g / 7 + s.off) % 1;
          shade = f < 0.42 ? 1.18 + 0.18 * Math.sin(f * 7.4) : 0.72 - 0.12 * f;
          if (hash2(Math.floor(g), Math.floor(y / 9) + si * 999) > 0.9) shade *= 0.6;   // lange porer
          shade += (hash2(x, y) - 0.5) * 0.12;
          if (edge < 1.6) shade *= 0.6;
          put(d, (y * W + x) * 4, WENGE, shade * s.tone, 0);
          continue;
        }
        if (s.quarter) {
          // lige, parallelle årer på langs, let bølgede
          g = lx + s.slant * y + s.wave(y / 140 + s.off) * 3.5 + s.wave(lx / 9 + s.off * 3) * 2.2;
        } else {
          // fladsavet: buede årer, der spidser til opad
          const dx = (lx / sw - s.cx) * sw;
          g = (dx * dx) * s.arch * 9 + (Hh - y) * 0.11 + s.wave(y / 90 + s.off) * 2;
        }
        const ring = g / s.spacing + s.off;
        const f = ring - Math.floor(ring);
        // senved mørkere, skarp overgang ved årringsgrænsen
        shade = 1.04 - 0.24 * Math.pow(f, 1.8) - (f > 0.93 ? 0.12 : 0);
        // porer i tidligveddet: korte mørke streger langs årerne
        if (f < 0.22 && hash2(Math.floor(g * 1.3), Math.floor(y / 5) + si * 999) > 0.8) shade -= 0.14;
        // marvstråler: korte lyse flager på tværs af årerne (kvartersavet eg)
        if (s.quarter && hash2(Math.floor(lx / 11) + si * 77, Math.floor(y / 3)) > 0.992) shade += 0.12;
        shade += (hash2(x, y) - 0.5) * 0.05;      // fin fiberstøj
        // let mørkere mod kanterne og en tynd limfuge
        if (edge < 1.6) shade *= 0.45;
        else if (edge < 6) shade *= 0.93 + edge * 0.012;
        put(d, (y * W + x) * 4, OAK, shade * s.tone, s.warm);
      }
    }
    return out;
  }

  // Foden er drejet: langsgående årer rundt om. Sømløs vandret.
  if (job.kind === 'foot') {
    const W = 1024, Hh = 512, out = image(W, Hh), d = out.data, wave = noise1(7);
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        const a = (x / W) * Math.PI * 2;
        const g = Math.sin(a * 3) * 40 + x * 0.9 + wave(y / 60 + x / 300) * 6;
        const f = g / 13 - Math.floor(g / 13);
        let shade = 1.02 - 0.15 * Math.pow(f, 2.2) - (f > 0.94 ? 0.08 : 0);
        if (f < 0.2 && hash2(Math.floor(g * 1.2), Math.floor(y / 4)) > 0.82) shade -= 0.12;
        shade += (hash2(x, y) - 0.5) * 0.05;
        put(d, (y * W + x) * 4, OAK, shade, 0);
      }
    }
    return out;
  }

  // Toppen: yderst stavenes endetræ i tolv felter, inderst en drejet skive.
  if (job.kind === 'top') {
    const S = 768, out = image(S, S), d = out.data, staves = staveParams(job.wood);
    const inner = 0.74, tau = Math.PI * 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const px = (x / S) * 2 - 1, py = 1 - (y / S) * 2;
        const rho = Math.hypot(px, py);
        let a = Math.atan2(-py, px) - job.angleOffset;    // samme vinkelretning som stavene
        a = ((a % tau) + tau) % tau;
        const sec = a / (tau / STAVES);
        const si = Math.floor(sec) % STAVES, fs = sec - Math.floor(sec);
        let shade, base = OAK;
        if (rho > inner) {
          const s = staves[si];
          base = s.base;
          const ring = (rho * 60 + fs * 4) + s.off;
          shade = (0.86 - 0.12 * (ring - Math.floor(ring))) * s.tone * (s.wenge ? 1.2 : 1);
          if (hash2(x, y) > 0.86) shade -= 0.1;          // endetræets porer
          const edgePx = Math.min(fs, 1 - fs) * rho * S * Math.PI / STAVES;
          if (edgePx < 1.3) shade *= 0.45;               // limfuge mellem stavene
        } else {
          // drejet skive med lige årer
          const g = (px * 0.94 + py * 0.34) * 260;
          const f = g / 7 - Math.floor(g / 7);
          shade = 1.0 - 0.14 * Math.pow(f, 2.2);
          if (hash2(Math.floor(g * 1.5), Math.floor(y / 4)) > 0.85 && f < 0.25) shade -= 0.12;
        }
        if (Math.abs(rho - inner) < 0.006) shade *= 0.5;   // fugen rundt om skiven
        shade += (hash2(x + 7, y) - 0.5) * 0.05;
        put(d, (y * S + x) * 4, base, shade, 0);
      }
    }
    return out;
  }

  // Bunden af foden: endetræ fra to sammenlimede emner (som på det rigtige
  // bæger). Årringe, porer i tidligveddet og lyse marvstråler på tværs.
  // Endetræ er lidt mørkere og rødere end langtræ.
  const S = job.size, out = image(S, S), d = out.data, END = [156, 104, 62];
  const blocks = [
    { cx: S * 0.32, cy: -S * 1.35, sp: 19, wob: noise1(31), off: 0.3 },
    { cx: S * 0.66, cy: S * 2.25, sp: 23, wob: noise1(57), off: 0.7 },
  ];
  const glue = S * 0.53;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const b = blocks[y < glue ? 0 : 1];
      const dx = x - b.cx, dy = y - b.cy;
      const ang = Math.atan2(dy, dx);
      const rr = Math.hypot(dx, dy) + b.wob(ang * 40) * 9;
      const ring = rr / b.sp + b.off, f = ring - Math.floor(ring);
      let shade = 0.9 - 0.2 * Math.pow(f, 1.4) - (f > 0.95 ? 0.08 : 0);
      // porøs ring: mørke prikker i starten af hver årring
      if (f < 0.16 && hash2(Math.floor(ang * 2600), Math.floor(rr / 2.2)) > 0.55) shade -= 0.2;
      // marvstråler: tynde lyse linjer, der går ud fra marven
      const ray = ang * 900 + b.wob(rr / 200) * 0.6;
      if (hash2(Math.floor(ray), 3) > 0.9 && ray - Math.floor(ray) < 0.4) shade += 0.1;
      shade += (hash2(x, y) - 0.5) * 0.06;
      if (Math.abs(y - glue) < 1.2) shade *= 0.55;      // limfuge mellem de to emner
      put(d, (y * S + x) * 4, END, shade, 0);
    }
  }
  return out;
}

// Regner alle fire teksturer ud samtidig i hver sin Web Worker. Kan workers
// ikke bruges (fx på grund af sidens sikkerhedsregler), regnes de ud her på
// siden, med en pause imellem, så siden kan nå at tegne.
function textures(wood) {
  const jobs = {
    stave: { kind: 'stave', wood },
    foot: { kind: 'foot' },
    top: { kind: 'top', wood, angleOffset: Math.PI / STAVES },
    bottom: { kind: 'bottom', size: TEX },
  };
  let url = null;
  try {
    const src = `const generate=${generate};onmessage=(e)=>{const r=generate(e.data);postMessage(r,[r.data.buffer]);};`;
    url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  } catch (e) { /* ingen Blob-adresser: brug siden selv */ }
  const onPage = (job) => new Promise((resolve) => setTimeout(() => resolve(generate(job)), 0));
  const inWorker = (job) => new Promise((resolve, reject) => {
    const w = new Worker(url);
    w.onmessage = (e) => { w.terminate(); resolve(e.data); };
    w.onerror = (e) => { w.terminate(); reject(e); };
    w.postMessage(job);
  });
  const keys = Object.keys(jobs);
  return Promise.all(keys.map((k) => (url ? inWorker(jobs[k]).catch(() => onPage(jobs[k])) : onPage(jobs[k]))))
    .then((list) => {
      if (url) URL.revokeObjectURL(url);
      return Object.fromEntries(keys.map((k, i) => [k, list[i]]));
    });
}

function toCanvas(px) {
  const c = canvas(px.w, px.h);
  c.getContext('2d').putImageData(new ImageData(px.data, px.w, px.h), 0, 0);
  return c;
}

/* ---------- gravering ---------- */

// Frede Høsts mærke, som på det rigtige bæger, under midten.
function drawMark(ctx, S) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = MARK_FONT.replace('{s}', Math.round(S * 0.046));
  ctx.fillText('FREDE HØST', S / 2, S * 0.735);
  ctx.font = MARK_FONT.replace('{s}', Math.round(S * 0.026));
  ctx.fillText('MADE IN DENMARK', S / 2, S * 0.775);
  ctx.fillText('COPYRIGHT', S / 2, S * 0.808);
}

// Kundens tekst: centreret over mærket, krympes så den holder sig inden for bunden.
function drawText(ctx, S, state) {
  const lines = [state.line1, state.line2].filter(Boolean);
  if (!lines.length) return;
  const fam = FONTS[state.font] || FONTS.serif;
  const maxW = S * 0.66, min = Math.round(S * 0.04);
  let size = Math.round(S * (lines.length === 1 ? 0.105 : 0.088));
  const fits = () => {
    ctx.font = fam.replace('{s}', size);
    return lines.every((l) => ctx.measureText(l).width <= maxW);
  };
  while (!fits() && size > min) size -= 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lh = size * 1.18;
  const y0 = S * 0.45 - ((lines.length - 1) * lh) / 2 + size * 0.34;
  lines.forEach((l, i) => ctx.fillText(l, S / 2, y0 + i * lh));
}

// Lægger brændingen oven på træet inden for ét felt. Det brændte bliver
// mørkt, men træets lyse og mørke partier skinner stadig svagt igennem. En
// svag, varm rand omkring bogstaverne (varmepåvirket træ). Ingen fordybning.
function burn(out, wood, S, r, mask, halo) {
  for (let y = 0; y < r.h; y++) {
    // laserens rasterlinjer giver en meget svag vandret struktur
    const scan = 0.94 + 0.06 * (((r.y + y) & 1) ? 1 : 0.4);
    let i = y * r.w * 4, o = ((r.y + y) * S + r.x) * 4;
    for (let x = 0; x < r.w; x++, i += 4, o += 4) {
      const k = 1 - 0.22 * (halo[i] / 255);          // varmepåvirket rand: let karamelliseret
      let R = wood[o] * k, G = wood[o + 1] * k * 0.96, B = wood[o + 2] * k * 0.9;
      const m = mask[i];
      if (m > 0) {
        const f = (0.7 + 0.55 * (wood[o] + wood[o + 1] + wood[o + 2]) / 420) * scan;   // træet anes igennem
        const t = (m / 255) * 0.93;
        R += (46 * f - R) * t; G += (27 * f - G) * t; B += (16 * f - B) * t;
      }
      out[o] = R; out[o + 1] = G; out[o + 2] = B;
    }
  }
}

// Bundens overflade: træ med mærke og kundens tekst brændt ind, plus et
// kort over ruhed (det brændte er mere mat end det olierede træ).
function bottomSurface(px) {
  const S = px.w, wood = px.data;
  const face = canvas(S, S), fctx = face.getContext('2d');
  const img = new ImageData(new Uint8ClampedArray(wood), S, S);
  fctx.putImageData(img, 0, 0);
  const rough = canvas(256, 256), rctx = rough.getContext('2d');
  rctx.fillStyle = ROUGH;
  rctx.fillRect(0, 0, 256, 256);

  const layer = (box) => {
    const r = { x: Math.floor(box.x * S), y: Math.floor(box.y * S), w: Math.ceil(box.w * S), h: Math.ceil(box.h * S) };
    const ctx = () => canvas(r.w, r.h).getContext('2d', { willReadFrequently: true });
    return { r, mask: ctx(), halo: ctx() };
  };
  const text = layer(TEXT_BOX), mark = layer(MARK_BOX);

  function apply(L, draw) {
    const r = L.r;
    // Masken er teksten selv; randen er teksten med en blød skygge omkring.
    // (shadowBlur virker i alle browsere; ctx.filter gør ikke i Safari.)
    for (const [c, glow] of [[L.mask, 0], [L.halo, S * 0.01]]) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.fillStyle = '#000';
      c.fillRect(0, 0, r.w, r.h);
      c.translate(-r.x, -r.y);
      c.fillStyle = '#fff';
      if (glow) { c.shadowColor = '#fff'; c.shadowBlur = glow; }
      draw(c);
    }
    burn(img.data, wood, S, r, L.mask.getImageData(0, 0, r.w, r.h).data, L.halo.getImageData(0, 0, r.w, r.h).data);
    fctx.putImageData(img, 0, 0, r.x, r.y, r.w, r.h);
    const k = 256 / S;
    rctx.globalCompositeOperation = 'source-over';
    rctx.globalAlpha = 1;
    rctx.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
    rctx.globalCompositeOperation = 'lighter';
    rctx.globalAlpha = 0.35;
    rctx.drawImage(L.mask.canvas, r.x * k, r.y * k, r.w * k, r.h * k);
  }

  let marked = false;
  return {
    face, rough,
    draw(state) {
      if (!marked) { apply(mark, (c) => drawMark(c, S)); marked = true; }
      apply(text, (c) => drawText(c, S, state));
    },
  };
}

// Venter på, at skrifterne er hentet, og tegner så. Flere ændringer inden
// for samme billede slås sammen til én tegning.
function textUpdater(surface, after) {
  let current = { line1: '', line2: '', font: 'serif' }, pending = false;
  return (state) => {
    current = state;
    if (pending) return;
    pending = true;
    const fam = (FONTS[state.font] || FONTS.serif).replace('{s}', 80);
    Promise.all([document.fonts.load(fam, state.line1 + state.line2 || 'A'), document.fonts.load(MARK_FONT.replace('{s}', 40))])
      .catch(() => {})
      .then(() => requestAnimationFrame(() => { pending = false; surface.draw(current); after(); }));
  };
}

/* ---------- geometri ---------- */

function staveGeometry(THREE, angleOffset) {
  // ringe fra samlingen og op: [højde, radius til hjørnerne, v]
  const levels = [
    [SEAM_Y, 4.3, 0],
    [SEAM_Y + 0.08, 4.38, 0.01],
    [H - 0.17, 3.44, 0.985],
    [H, 3.3, 1],
  ];
  const pos = [], uv = [];
  const step = (Math.PI * 2) / STAVES;
  for (let i = 0; i < STAVES; i++) {
    const a0 = angleOffset + i * step, a1 = a0 + step;
    const u0 = i / STAVES + 0.0004, u1 = (i + 1) / STAVES - 0.0004;
    for (let l = 0; l < levels.length - 1; l++) {
      const [y0, r0, v0] = levels[l], [y1, r1, v1] = levels[l + 1];
      const b0 = [r0 * Math.cos(a0), y0, r0 * Math.sin(a0)];
      const b1 = [r0 * Math.cos(a1), y0, r0 * Math.sin(a1)];
      const t0 = [r1 * Math.cos(a0), y1, r1 * Math.sin(a0)];
      const t1 = [r1 * Math.cos(a1), y1, r1 * Math.sin(a1)];
      pos.push(...b0, ...t0, ...b1, ...b1, ...t0, ...t1);
      uv.push(u0, v0, u0, v1, u1, v0, u1, v0, u0, v1, u1, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();   // ikke-delte hjørner giver flade facetter
  return g;
}

function topGeometry(THREE, angleOffset) {
  const R = 3.3, pos = [], uv = [];
  const step = (Math.PI * 2) / STAVES;
  for (let i = 0; i < STAVES; i++) {
    const a0 = angleOffset + i * step, a1 = a0 + step;
    const v0 = [R * Math.cos(a0), H, R * Math.sin(a0)];
    const v1 = [R * Math.cos(a1), H, R * Math.sin(a1)];
    pos.push(0, H, 0, ...v1, ...v0);
    const m = (p) => [p[0] / R / 2 + 0.5, -p[2] / R / 2 + 0.5];
    uv.push(0.5, 0.5, ...m(v1), ...m(v0));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function footGeometry(THREE) {
  // profil [radius, højde] fra bunden og op til samlingen; drejet rundt
  const p = [
    [FOOT_R, 0], [3.33, 0.08], [3.38, 0.25], [3.38, 1.0], [3.3, 1.22],
    [2.95, 1.42], [2.45, 1.72], [2.08, 2.12], [1.88, 2.65], [1.83, 3.15],
    [1.9, 3.65], [2.15, 4.15], [2.6, 4.58], [3.3, 4.95], [4.0, 5.2],
    [4.4, 5.36], [R_MAX, 5.5], [4.48, 6.0], [4.31, 7.12], [4.24, SEAM_Y], [3.9, SEAM_Y],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(p, 128);
}

// Et lille «rum» med bløde lyskasser, så den olierede overflade får
// realistiske refleksioner uden at hente et HDR-billede.
function studioEnvironment(THREE, renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 20, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.3, 0.28), side: THREE.BackSide }),
  );
  scene.add(room);
  const panel = (w, h, x, y, z, k, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.97, k * 0.92) }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  panel(14, 8, 0, 9.5, 0, 3.2, Math.PI / 2);          // loft
  panel(10, 12, -14.5, 1, 2, 2.2, 0, Math.PI / 2);     // venstre softbox
  panel(6, 10, 14.5, 2, -4, 1.2, 0, -Math.PI / 2);     // svag højre
  panel(12, 6, 0, 2, 14.5, 1.6, 0, Math.PI);           // forfra
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  return env;
}

/* ---------- montering ---------- */

export async function mount(canvasEl, threeSrc, opts = {}) {
  const pixels = textures(opts.wood || 'eg');   // regnes ud i baggrunden, mens three.js hentes

  // Kan three.js ikke hentes, eller findes WebGL ikke, vises bunden fladt.
  let THREE, renderer;
  try {
    THREE = await import(threeSrc);
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.warn('3D ikke tilgængeligt, viser bunden fladt', e);
    return flatView(canvasEl, await pixels);
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(THREE, renderer);

  const key = new THREE.DirectionalLight(0xffe9d2, 1.15);
  key.position.set(-6, 10, 12);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(8, 4, -10);
  scene.add(rim);

  const px = await pixels;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (src, wrap) => {
    const t = new THREE.CanvasTexture(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    if (wrap) t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  // Olieret træ: en tynd, mat hinde over træet. Ingen «sheen»: den lagde et
  // lyst slør over de mørke wenge-stave, når bægeret blev set skråt.
  const oiled = (map) => new THREE.MeshPhysicalMaterial({
    map, bumpMap: map, bumpScale: 0.35,
    roughness: 0.55, clearcoat: 0.16, clearcoatRoughness: 0.6,
  });

  const angleOffset = Math.PI / STAVES;   // en flade lige mod beskueren
  const model = new THREE.Group();
  model.add(new THREE.Mesh(staveGeometry(THREE, angleOffset), oiled(tex(toCanvas(px.stave)))));
  model.add(new THREE.Mesh(topGeometry(THREE, angleOffset), oiled(tex(toCanvas(px.top)))));
  model.add(new THREE.Mesh(footGeometry(THREE), oiled(tex(toCanvas(px.foot), true))));

  // Bunden med gravering
  const surface = bottomSurface(px.bottom);
  const bottomTex = tex(surface.face);
  const roughTex = new THREE.CanvasTexture(surface.rough);
  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(FOOT_R, 96),
    new THREE.MeshPhysicalMaterial({ map: bottomTex, roughnessMap: roughTex, roughness: 1, clearcoat: 0.12, clearcoatRoughness: 0.6 }),
  );
  bottom.rotation.x = Math.PI / 2;     // vender nedad
  bottom.position.y = 0.0005;
  model.add(bottom);

  model.position.y = -H / 2;
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  pivot.add(model);
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(28, 1, 1, 200);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let pitch = PITCH0, yaw = YAW0, vx = 0, vy = 0;
  let target = null, drag = null, running = true, lost = false, raf = 0;

  // Der renderes kun, når noget har ændret sig. invalidate() beder om ét billede.
  function invalidate() {
    if (!raf && running && !lost) raf = requestAnimationFrame(frame);
  }
  function turn(dx, dy) {
    yaw += dx;
    pitch = clamp(pitch + dy, PITCH_MIN, PITCH_MAX);
  }
  function frame() {
    raf = 0;
    let moving = false;
    if (!drag && (Math.abs(vx) > 1e-4 || Math.abs(vy) > 1e-4)) {
      turn(vx, vy);
      vx *= 0.92; vy *= 0.92;
      moving = true;
    }
    if (target) {
      yaw += (target.yaw - yaw) * 0.12;
      pitch += (target.pitch - pitch) * 0.12;
      if (Math.abs(target.yaw - yaw) < 1e-3 && Math.abs(target.pitch - pitch) < 1e-3) {
        // land præcist, så «Vis bunden» altid ender i samme stilling
        yaw = target.yaw; pitch = target.pitch;
        target = null;
      }
      moving = true;
    }
    pivot.rotation.x = pitch;
    pivot.rotation.y = yaw;
    renderer.render(scene, camera);
    if (moving) invalidate();
  }

  function resize() {
    const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // hele bægeret skal kunne ses, også på en smal, høj skærm
    const fit = 9.6 / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, 0, camera.aspect < 1 ? fit / Math.max(camera.aspect, 0.55) : fit);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(resize).observe(canvasEl);

  function reset() {
    // drej den korteste vej tilbage til bunden
    const tau = Math.PI * 2;
    yaw = ((yaw - YAW0 + Math.PI) % tau + tau) % tau - Math.PI + YAW0;
    vx = vy = 0;
    if (calm) { yaw = YAW0; pitch = PITCH0; } else target = { yaw: YAW0, pitch: PITCH0 };
    invalidate();
  }

  // træk for at dreje
  canvasEl.style.touchAction = 'none';
  canvasEl.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvasEl.setPointerCapture(e.pointerId);
    target = null; vx = vy = 0;
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    vx = (e.clientX - drag.x) * 0.009; vy = (e.clientY - drag.y) * 0.009;
    drag.x = e.clientX; drag.y = e.clientY;
    turn(vx, vy);
    invalidate();
  });
  const end = () => {
    drag = null;
    if (calm) vx = vy = 0;
    invalidate();   // lad bægeret glide lidt videre
  };
  canvasEl.addEventListener('pointerup', end);
  canvasEl.addEventListener('pointercancel', end);

  // piletaster drejer også, så visningen kan bruges uden mus
  canvasEl.tabIndex = 0;
  canvasEl.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key];
    if (!step && e.key !== 'Home') return;
    e.preventDefault();
    target = null; vx = vy = 0;
    if (step) { turn(step[0], step[1]); invalidate(); } else reset();
  });

  // Mister browseren grafikkonteksten (fx når telefonen sparer hukommelse), bygges lyset op igen.
  canvasEl.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  canvasEl.addEventListener('webglcontextrestored', () => {
    lost = false;
    scene.environment = studioEnvironment(THREE, renderer);
    invalidate();
  });

  const setText = textUpdater(surface, () => {
    bottomTex.needsUpdate = true;
    roughTex.needsUpdate = true;
    invalidate();
  });

  resize();
  // Lad grafikkortet bygge sine programmer i baggrunden, hvor det kan, så
  // siden ikke står stille imens.
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* bygges ved første billede i stedet */ }
  setText({ line1: '', line2: '', font: 'serif' });
  invalidate();

  return {
    setText,
    reset,
    pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    resume() { running = true; invalidate(); },
  };
}

// Uden 3D: vis bunden som et fladt, rundt billede med samme gravering.
function flatView(canvasEl, px) {
  const S = px.bottom.w, surface = bottomSurface(px.bottom);
  const flat = canvas(S, S);
  flat.className = canvasEl.className + ' engraver__flat';
  flat.setAttribute('role', 'img');
  flat.setAttribute('aria-label', 'Bunden af bægeret med graveringen');
  canvasEl.replaceWith(flat);
  const ctx = flat.getContext('2d');
  const setText = textUpdater(surface, () => {
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(surface.face, 0, 0);
    ctx.restore();
  });
  setText({ line1: '', line2: '', font: 'serif' });
  // flat: true fortæller modalen, at der ikke er noget at dreje
  return { flat: true, setText, reset() {}, pause() {}, resume() {} };
}
