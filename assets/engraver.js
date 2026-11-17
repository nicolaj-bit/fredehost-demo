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
*/

const H = 15.5;          // samlet højde
const R_MAX = 4.5;       // største radius (diameter 9 cm)
const STAVES = 12;
const SEAM_Y = 7.2;      // samlingen mellem fod og krop
const FOOT_R = 3.2;      // radius på den flade bund under foden
const PITCH0 = -1.1;    // startvinkel: vippet, så bunden ses med det samme
const YAW0 = 0.24;

const FONTS = {
  serif: '500 {s}px Newsreader, Georgia, "Times New Roman", serif',
  sans: '500 {s}px Inter, "Helvetica Neue", Arial, sans-serif',
};

/* ---------- små hjælpere ---------- */

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
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Olieret eg: varm, gylden brun. Lysere tidligved, mørkere senved.
const OAK = [146, 100, 58];
// Olieret wenge: næsten sort brun med lysere, smalle striber på langs.
const WENGE = [46, 30, 22];

/* ---------- teksturer ---------- */

// Tolv staver side om side. Hver stav har sin egen tone og årestruktur, og
// limfugen tegnes som en tynd mørk linje i kanten, så samlingerne ses.
function staveTexture(wood) {
  const W = 1536, Hh = 1024, sw = W / STAVES;
  const c = canvas(W, Hh), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, Hh), d = img.data;
  const r = rng(1995);
  const staves = [];
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
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const si = Math.floor(x / sw), s = staves[si];
      const lx = x - si * sw;               // px inde i staven
      const u = lx / sw;
      let g;
      if (s.wenge) {
        // wenge: tætte, lige striber med lidt bølge; ingen marvstråler
        g = lx * 1.9 + s.slant * y + s.wave(y / 160 + s.off) * 4;
        const f = (g / 7 + s.off) % 1;
        let shade = f < 0.42 ? 1.18 + 0.18 * Math.sin(f * 7.4) : 0.72 - 0.12 * f;
        if (hash2(Math.floor(g), Math.floor(y / 9) + si * 999) > 0.9) shade *= 0.6;   // lange porer
        shade += (hash2(x, y) - 0.5) * 0.12;
        const edge = Math.min(lx, sw - 1 - lx);
        if (edge < 1.6) shade *= 0.6;
        shade *= s.tone;
        const i4 = (y * W + x) * 4;
        d[i4] = clamp(WENGE[0] * shade, 0, 255);
        d[i4 + 1] = clamp(WENGE[1] * shade, 0, 255);
        d[i4 + 2] = clamp(WENGE[2] * shade, 0, 255);
        d[i4 + 3] = 255;
        continue;
      }
      if (s.quarter) {
        // lige, parallelle årer på langs, let bølgede
        g = lx + s.slant * y + s.wave(y / 140 + s.off) * 3.5 + s.wave(lx / 9 + s.off * 3) * 2.2;
      } else {
        // fladsavet: buede årer, der spidser til opad
        const dx = (u - s.cx) * sw;
        g = (dx * dx) * s.arch * 9 + (Hh - y) * 0.11 + s.wave(y / 90 + s.off) * 2;
      }
      const ring = g / s.spacing + s.off;
      const f = ring - Math.floor(ring);
      // senved mørkere, skarp overgang ved årringsgrænsen
      let shade = 1.04 - 0.24 * Math.pow(f, 1.8) - (f > 0.93 ? 0.12 : 0);
      // porer i tidligveddet: korte mørke streger langs årerne
      if (f < 0.22 && hash2(Math.floor(g * 1.3), Math.floor(y / 5) + si * 999) > 0.8) shade -= 0.14;
      // marvstråler: korte lyse flager på tværs af årerne (kvartersavet eg)
      if (s.quarter && hash2(Math.floor(lx / 11) + si * 77, Math.floor(y / 3)) > 0.992) shade += 0.12;
      // fin fiberstøj
      shade += (hash2(x, y) - 0.5) * 0.05;
      // let mørkere mod kanterne og en tynd limfuge
      const edge = Math.min(lx, sw - 1 - lx);
      if (edge < 1.6) shade *= 0.45;
      else if (edge < 6) shade *= 0.93 + edge * 0.012;
      shade *= s.tone;
      const i4 = (y * W + x) * 4;
      d[i4] = clamp(OAK[0] * shade * (1 + s.warm), 0, 255);
      d[i4 + 1] = clamp(OAK[1] * shade, 0, 255);
      d[i4 + 2] = clamp(OAK[2] * shade * (1 - s.warm), 0, 255);
      d[i4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, staves };
}

// Foden er drejet: langsgående årer rundt om. Sømløs vandret.
function footTexture() {
  const W = 1024, Hh = 512;
  const c = canvas(W, Hh), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, Hh), d = img.data;
  const wave = noise1(7);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const a = (x / W) * Math.PI * 2;
      const g = Math.sin(a * 3) * 40 + x * 0.9 + wave(y / 60 + x / 300) * 6;
      const ring = g / 13;
      const f = ring - Math.floor(ring);
      let shade = 1.02 - 0.15 * Math.pow(f, 2.2) - (f > 0.94 ? 0.08 : 0);
      if (f < 0.2 && hash2(Math.floor(g * 1.2), Math.floor(y / 4)) > 0.82) shade -= 0.12;
      shade += (hash2(x, y) - 0.5) * 0.05;
      const i4 = (y * W + x) * 4;
      d[i4] = clamp(OAK[0] * shade, 0, 255);
      d[i4 + 1] = clamp(OAK[1] * shade, 0, 255);
      d[i4 + 2] = clamp(OAK[2] * shade, 0, 255);
      d[i4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Toppen: yderst stavenes endetræ i tolv felter, inderst en drejet skive.
function topTexture(staves, angleOffset) {
  const S = 768, c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  const inner = 0.74;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = (x / S) * 2 - 1, py = 1 - (y / S) * 2;
      const rho = Math.hypot(px, py);
      let a = Math.atan2(-py, px) - angleOffset;    // samme vinkelretning som stavene
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const sec = a / (Math.PI * 2 / STAVES);
      const si = Math.floor(sec) % STAVES, fs = sec - Math.floor(sec);
      let shade;
      let base = OAK;
      if (rho > inner) {
        const s = staves[si];
        base = s.base;
        const ring = (rho * 60 + fs * 4) + s.off;
        const f = ring - Math.floor(ring);
        shade = (0.86 - 0.12 * f) * s.tone * (s.wenge ? 1.2 : 1);
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
      const i4 = (y * S + x) * 4;
      d[i4] = clamp(base[0] * shade, 0, 255);
      d[i4 + 1] = clamp(base[1] * shade, 0, 255);
      d[i4 + 2] = clamp(base[2] * shade, 0, 255);
      d[i4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Bunden af foden: endetræ fra to sammenlimede emner (som på det rigtige
// bæger). Årringe, porer i tidligveddet og lyse marvstråler på tværs.
function bottomWood(S) {
  const out = new Uint8ClampedArray(S * S * 4);
  const blocks = [
    { cx: S * 0.32, cy: -S * 1.35, sp: 19, wob: noise1(31), off: 0.3 },
    { cx: S * 0.66, cy: S * 2.25, sp: 23, wob: noise1(57), off: 0.7 },
  ];
  const glue = S * 0.53;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const b = blocks[y < glue ? 0 : 1];
      const dx = x - b.cx, dy = y - b.cy;
      const dist = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const rr = dist + b.wob(ang * 40) * 9;
      const ring = rr / b.sp + b.off, f = ring - Math.floor(ring);
      let shade = 0.9 - 0.2 * Math.pow(f, 1.4) - (f > 0.95 ? 0.08 : 0);
      // porøs ring: mørke prikker i starten af hver årring
      if (f < 0.16 && hash2(Math.floor(ang * 2600), Math.floor(rr / 2.2)) > 0.55) shade -= 0.2;
      // marvstråler: tynde lyse linjer, der går ud fra marven
      const ray = ang * 900 + b.wob(rr / 200) * 0.6;
      if (hash2(Math.floor(ray), 3) > 0.9 && ray - Math.floor(ray) < 0.4) shade += 0.1;
      shade += (hash2(x, y) - 0.5) * 0.06;
      if (Math.abs(y - glue) < 1.2) shade *= 0.55;      // limfuge mellem de to emner
      const i4 = (y * S + x) * 4;
      // endetræ er lidt mørkere og rødere end langtræ
      out[i4] = clamp(156 * shade, 0, 255);
      out[i4 + 1] = clamp(104 * shade, 0, 255);
      out[i4 + 2] = clamp(62 * shade, 0, 255);
      out[i4 + 3] = 255;
    }
  }
  return out;
}

/* ---------- gravering ---------- */

function fitFont(ctx, text, family, maxW, start, min) {
  let s = start;
  ctx.font = family.replace('{s}', s);
  while (s > min && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = family.replace('{s}', s);
  }
  return s;
}

// Tegner masken (hvid = brændt) for kundens tekst og Frede Høsts eget mærke.
function drawMask(ctx, S, state) {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Frede Høsts mærke, som på det rigtige bæger, under midten
  const mark = FONTS.sans.replace('500', '600');
  ctx.font = mark.replace('{s}', Math.round(S * 0.046));
  ctx.fillText('FREDE HØST', S / 2, S * 0.735);
  ctx.font = mark.replace('{s}', Math.round(S * 0.026));
  ctx.fillText('MADE IN DENMARK', S / 2, S * 0.775);
  ctx.fillText('COPYRIGHT', S / 2, S * 0.808);

  // Kundens tekst: centreret over mærket, krympes så den holder sig inden for bunden
  const fam = FONTS[state.font] || FONTS.serif;
  const lines = [state.line1, state.line2].filter(Boolean);
  if (!lines.length) return;
  const maxW = S * 0.66;
  const start = Math.round(S * (lines.length === 1 ? 0.105 : 0.088));
  const size = Math.min(...lines.map((l) => fitFont(ctx, l, fam, maxW, start, Math.round(S * 0.04))));
  ctx.font = fam.replace('{s}', size);
  const lh = size * 1.18;
  const mid = S * 0.45;
  const y0 = mid - ((lines.length - 1) * lh) / 2 + size * 0.34;
  lines.forEach((l, i) => ctx.fillText(l, S / 2, y0 + i * lh));
}

// Lægger brændingen oven på træet. Det brændte bliver mørkt, men træets
// lyse og mørke partier skinner stadig svagt igennem. En svag, varm rand
// omkring bogstaverne (varmepåvirket træ). Ingen fordybning.
function composite(wood, mask, halo, out, S) {
  for (let i = 0, n = S * S; i < n; i++) {
    const i4 = i * 4;
    const m = mask[i4] / 255;
    const h = halo[i4] / 255;
    let r = wood[i4], g = wood[i4 + 1], b = wood[i4 + 2];
    // varmepåvirket rand: let karamelliseret
    const k = 1 - 0.22 * h;
    r *= k; g *= k * 0.96; b *= k * 0.9;
    if (m > 0) {
      // laserens rasterlinjer giver en meget svag vandret struktur
      const y = (i / S) | 0;
      const scan = 0.94 + 0.06 * ((y & 1) ? 1 : 0.4);
      const lum = (wood[i4] + wood[i4 + 1] + wood[i4 + 2]) / 3 / 140;   // ~1 for gennemsnitstræ
      const bur = [46, 27, 16].map((c) => c * (0.7 + 0.55 * lum) * scan);
      const t = m * 0.93;
      r = r * (1 - t) + bur[0] * t;
      g = g * (1 - t) + bur[1] * t;
      b = b * (1 - t) + bur[2] * t;
    }
    out[i4] = r; out[i4 + 1] = g; out[i4 + 2] = b; out[i4 + 3] = 255;
  }
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
  const THREE = await import(threeSrc);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    return fallback2D(canvasEl);
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

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (src, wrap) => {
    const t = new THREE.CanvasTexture(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    if (wrap) t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  const oiled = (map, extra = {}) => new THREE.MeshPhysicalMaterial({
    map, bumpMap: map, bumpScale: 0.35,
    roughness: 0.5, clearcoat: 0.22, clearcoatRoughness: 0.55,
    sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.9, 0.75, 0.55),
    ...extra,
  });

  const angleOffset = Math.PI / STAVES;   // en flade lige mod beskueren
  const { canvas: staveCanvas, staves } = staveTexture(opts.wood || 'eg');
  const model = new THREE.Group();
  model.add(new THREE.Mesh(staveGeometry(THREE, angleOffset), oiled(tex(staveCanvas))));
  model.add(new THREE.Mesh(topGeometry(THREE, angleOffset), oiled(tex(topTexture(staves, angleOffset)))));
  model.add(new THREE.Mesh(footGeometry(THREE), oiled(tex(footTexture(), true))));

  // Bunden med gravering
  const S = 1024;
  const wood = bottomWood(S);
  const bottomCanvas = canvas(S, S);
  const bctx = bottomCanvas.getContext('2d');
  const bottomImg = bctx.createImageData(S, S);
  const maskCanvas = canvas(S, S), mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const haloCanvas = canvas(S, S), hctx = haloCanvas.getContext('2d', { willReadFrequently: true });
  // ruhed: det brændte er mere mat end det olierede træ
  const roughCanvas = canvas(256, 256), rctx = roughCanvas.getContext('2d');
  const bottomTex = tex(bottomCanvas);
  const roughTex = new THREE.CanvasTexture(roughCanvas);
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

  let pitch = PITCH0, yaw = YAW0, vx = 0, vy = 0;
  let target = null, dirty = true, running = true, raf = 0;

  function drawBottom(state) {
    drawMask(mctx, S, state);
    hctx.filter = 'blur(5px)';
    hctx.clearRect(0, 0, S, S);
    hctx.drawImage(maskCanvas, 0, 0);
    hctx.filter = 'none';
    const m = mctx.getImageData(0, 0, S, S).data;
    const h = hctx.getImageData(0, 0, S, S).data;
    composite(wood, m, h, bottomImg.data, S);
    bctx.putImageData(bottomImg, 0, 0);
    rctx.fillStyle = 'rgb(0,140,0)';                   // grøn kanal = ruhed (≈ 0,55)
    rctx.fillRect(0, 0, 256, 256);
    rctx.globalCompositeOperation = 'lighter';
    rctx.globalAlpha = 0.35;
    rctx.drawImage(maskCanvas, 0, 0, 256, 256);
    rctx.globalAlpha = 1;
    rctx.globalCompositeOperation = 'source-over';
    bottomTex.needsUpdate = true;
    roughTex.needsUpdate = true;
    dirty = true;
  }

  let current = { line1: '', line2: '', font: 'serif' };
  let pending = false;
  function setText(state) {
    current = state;
    if (pending) return;
    pending = true;
    const fam = (FONTS[state.font] || FONTS.serif).replace('{s}', 80);
    Promise.all([document.fonts.load(fam, state.line1 + state.line2 || 'A'), document.fonts.load(FONTS.sans.replace('500', '600').replace('{s}', 40))])
      .catch(() => {})
      .then(() => requestAnimationFrame(() => { pending = false; drawBottom(current); }));
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
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvasEl);

  // træk for at dreje
  let drag = null;
  canvasEl.style.touchAction = 'none';
  canvasEl.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvasEl.setPointerCapture(e.pointerId);
    target = null; vx = vy = 0;
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    vx = dx * 0.009; vy = dy * 0.009;
    yaw += vx; pitch = clamp(pitch + vy, -1.75, 0.35);
    dirty = true;
  });
  const end = () => { drag = null; };
  canvasEl.addEventListener('pointerup', end);
  canvasEl.addEventListener('pointercancel', end);

  function frame() {
    raf = 0;
    if (!running) return;
    if (!drag && (Math.abs(vx) > 1e-4 || Math.abs(vy) > 1e-4)) {
      yaw += vx; pitch = clamp(pitch + vy, -1.75, 0.35);
      vx *= 0.92; vy *= 0.92; dirty = true;
    }
    if (target) {
      yaw += (target.yaw - yaw) * 0.12;
      pitch += (target.pitch - pitch) * 0.12;
      if (Math.abs(target.yaw - yaw) < 1e-3 && Math.abs(target.pitch - pitch) < 1e-3) target = null;
      dirty = true;
    }
    if (dirty) {
      pivot.rotation.x = pitch;
      pivot.rotation.y = yaw;
      renderer.render(scene, camera);
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }

  resize();
  drawBottom(current);
  raf = requestAnimationFrame(frame);

  return {
    setText,
    reset() {
      // drej den korteste vej tilbage til bunden
      const tau = Math.PI * 2;
      yaw = ((yaw - YAW0 + Math.PI) % tau + tau) % tau - Math.PI + YAW0;
      target = { yaw: YAW0, pitch: PITCH0 }; vx = vy = 0;
    },
    pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    resume() { if (!running) { running = true; dirty = true; raf = requestAnimationFrame(frame); } },
    // til test: aktuel visning
    get debug() { return { yaw, pitch, renderer }; },
  };
}

// Hvis WebGL ikke er tilgængeligt: vis bunden som et fladt billede.
function fallback2D(canvasEl) {
  const S = 768;
  const wood = bottomWood(S);
  const c2 = document.createElement('canvas');
  c2.width = c2.height = S;
  c2.className = canvasEl.className + ' engraver__flat';
  canvasEl.replaceWith(c2);
  const ctx = c2.getContext('2d');
  const m = canvas(S, S), mctx = m.getContext('2d', { willReadFrequently: true });
  const h = canvas(S, S), hctx = h.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(S, S);
  function setText(state) {
    drawMask(mctx, S, state);
    hctx.filter = 'blur(4px)'; hctx.clearRect(0, 0, S, S); hctx.drawImage(m, 0, 0); hctx.filter = 'none';
    composite(wood, mctx.getImageData(0, 0, S, S).data, hctx.getImageData(0, 0, S, S).data, img.data, S);
    ctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  setText({ line1: '', line2: '', font: 'serif' });
  return { setText, reset() {}, pause() {}, resume() {} };
}
