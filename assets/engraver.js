/*
  Frede Høst – 3D-forhåndsvisning af gravering i bunden af raflebægeret.

  Hentes først, når kunden åbner graveringsmodalen (se snippets/engraver-modal.liquid).
  three.js hentes herfra med import(), så intet af det belaster produktsiden.

  Mål (cm), fra fredehost.dk: højde 15,5, diameter 9.
  Bægeret består af tolv trædele, limet sammen og drejet rundt: kroppen er en
  glat keglestub uden kanter, hvor stavene ses som striber i træet. Foden er
  drejet i ét stykke. Omridset er målt på Frede Høsts egne studiefotos.

  Træet er olieret eg: TOVE har skiftevis stave af wenge og eg, foden er eg på
  begge. Det regnes ud som massivt træ (årringe, porer og marvstråler), så hver
  flade viser det snit, den skærer: årer på langs af stavene, levende årer rundt
  om den drejede fod og endetræ i bunden. Farver og lys er afstemt efter Frede
  Høsts studiefoto af TOVE.
  Graveringen er et lasermærke: brændt mørkt, men uden fordybning, så
  træets struktur stadig anes igennem.

  Ydelse: Træets teksturer regnes ud i Web Workers, så siden ikke fryser,
  mens modalen åbner. Når kunden skriver, tegnes kun tekstfeltet i bunden om,
  ikke hele teksturen. Der renderes kun, når noget har ændret sig.
*/

const H = 15.5;          // samlet højde
const R_MAX = 4.5;       // største radius (diameter 9 cm)
const R_TOP = 3.03;      // radius på den flade top
const STAVES = 12;
const ANGLE0 = Math.PI / STAVES;   // drejning, så en stav vender lige mod beskueren
const SEGMENTS = 144;    // led rundt om bægeret: nok til, at omridset er helt rundt
const SEAM_Y = 7.1;      // samlingen mellem bundstykke og bæger
const SEAM_GAP = 0.03;   // samlingen ses som en tynd, mørk linje
const FOOT_R = 3.05;     // radius på den flade bund under foden
const CONE_K = 0.1337;   // så meget smalner bægeret ind pr. cm opad
const CONE_Y0 = 5.38;    // højden, hvor bægeret er bredest
const PITCH0 = -1.1;     // startvinkel: vippet, så bunden ses med det samme
const YAW0 = 0.24;
const PITCH_MIN = -1.75, PITCH_MAX = 0.35;
const TEX = 1024;        // bundens tekstur i pixels

// Felter i bundens tekstur (andele af siden). Kundens tekst og Frede Høsts
// mærke ligger i hver sit felt, så de kan tegnes om uafhængigt af hinanden.
const TEXT_BOX = { x: 0.12, y: 0.3, w: 0.76, h: 0.32 };
const MARK_BOX = { x: 0.26, y: 0.67, w: 0.48, h: 0.17 };
const WOOD_ROUGHNESS = 0.68;    // olieret træ: mat, med et blødt genskin
// Lyset er sat som på Frede Høsts studiefoto: en stor, blød lampe skråt forfra
// til højre, lyst loft, et hvidt bord, der kaster lys op nedefra, og mørkere til
// venstre. Styrkerne er afstemt, så farverne lander som målt på fotoet.
const LIGHT = { key: 1.9, keyPos: [9, 5, 6.5], sky: 0.5, ground: 0.8, env: 0.25 };
const ROUGH = `rgb(0,${Math.round(WOOD_ROUGHNESS * 255)},0)`;   // grøn kanal = ruhed i bundens kort

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

// Træet regnes ud som MASSIVT træ: hvert bræt har årringe omkring en marv,
// porer, der løber langs årerne, og marvstråler ud fra marven. Hver flade viser
// så det snit, den faktisk skærer gennem træet. Derfor får stavene flammede
// eller lige årer alt efter, hvordan brættet er skåret, den drejede fod får
// levende årer hele vejen rundt, og bundens endetræ passer til fodens sider.
// Farverne er målt på Frede Høsts studiefoto af TOVE.
//
// VIGTIGT: funktionen sendes som tekst til en Web Worker og må derfor ikke
// bruge noget uden for sig selv. Mål fra modellen kommer med i job.geo.
function generate(job) {
  const G = job.geo, STAVES = G.STAVES, TAU = Math.PI * 2;
  const PX = job.px;                                     // en pixels størrelse på fladen, i cm
  const OIL = job.oil;                                   // hvor meget olie endetræet har suget på denne flade
  const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
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
  // En fast, blandet tabel giver samme træ hver gang.
  const perm = new Uint8Array(512);
  {
    const r = rng(1995), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  // Et fast tilfældigt tal (0..1) for en celle
  const hash = (i, j, k) => perm[perm[perm[i & 255] + (j & 255)] + (k & 255)] / 255;
  // Blød støj (0..1) i to og tre retninger
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const A = perm[xi & 255] + (yi & 255), B = perm[(xi + 1) & 255] + (yi & 255);
    const a = perm[A], b = perm[B], c = perm[A + 1], d = perm[B + 1];
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) / 255;
  }
  function n3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const A = perm[X] + Y, B = perm[X + 1] + Y;
    const AA = perm[A] + Z, AB = perm[A + 1] + Z, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    const x00 = perm[AA] + (perm[BA] - perm[AA]) * u, x10 = perm[AB] + (perm[BB] - perm[AB]) * u;
    const x01 = perm[AA + 1] + (perm[BA + 1] - perm[AA + 1]) * u, x11 = perm[AB + 1] + (perm[BB + 1] - perm[AB + 1]) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return (y0 + (y1 - y0) * w) / 255;
  }

  // Et bræt: o er et punkt i brættet, a årernes retning, b og c to retninger på
  // tværs. Marven ligger (p1, p2) fra o på tværs og «skrider» (t1, t2) pr. cm på
  // langs: det er den skævhed, der giver flammede årer i fladskårne brædder.
  function board(seed, o, a, b, c, p1, p2, t1, t2, ring, tone, wenge, warm) {
    const R0 = Math.hypot(p1, p2), r = rng(seed * 7919 + 13);
    return {
      seed, ox: o[0], oy: o[1], oz: o[2], ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2],
      p1, p2, t1, t2, ring, tone, wenge, R0, e1: -p1 / R0, e2: -p2 / R0,
      wob: 1.2 + 2.2 * r(),            // hvor meget årringene bugter sig (i ringbredder)
      kth: R0 / (2.5 + 2.5 * r()),     // bugternes længde rundt langs ringen
      poreF: 3.4 + 2 * r(),            // hvor korte porernes streger er
      figure: 0.45 + 0.55 * r(),       // wenge: hvor tydelige de lyse bånd er
      warm: (warm || 0) + (r() - 0.5) * 0.06,   // lidt forskel i farven fra bræt til bræt
    };
  }

  // Farven i et punkt (x, y, z) i brættet B, set på en flade med normalen n.
  // Resultatet lægges i cr, cg, cb (0..255).
  let cr = 0, cg = 0, cb = 0;
  function sample(B, x, y, z, nx, ny, nz) {
    const dx = x - B.ox, dy = y - B.oy, dz = z - B.oz;
    const s = dx * B.ax + dy * B.ay + dz * B.az;                               // på langs af årerne
    const q1 = dx * B.bx + dy * B.by + dz * B.bz - B.p1 - B.t1 * s;
    const q2 = dx * B.cx + dy * B.cy + dz * B.cz - B.p2 - B.t2 * s;
    const R = Math.sqrt(q1 * q1 + q2 * q2);                                    // afstand fra marven
    const th = Math.atan2(q2 * B.e1 - q1 * B.e2, q1 * B.e1 + q2 * B.e2);        // vinkel rundt om marven
    const arc = th * B.R0;                                                     // langs årringen, i cm
    const end = Math.abs(nx * B.ax + ny * B.ay + nz * B.az);                   // 1 = rent endetræ
    // 1 = fladen ligger i marvstrålernes plan («spejl» i egetræ)
    const face = Math.abs(nx * (q1 * B.cx - q2 * B.bx) + ny * (q1 * B.cy - q2 * B.by) + nz * (q1 * B.cz - q2 * B.bz)) / R;
    const e = end * end;
    const calm = n3(x * 0.22 + B.seed, y * 0.13 + 4, z * 0.22) - 0.5;          // rolige skift i tonen
    const fibre = (n3(arc * 55 + 3, R * 45, s * 1.3) - 0.5) * 0.6 + (n3(arc * 6.5, R * 5.5 + 9, s * 0.22) - 0.5);

    if (B.wenge) {
      // Wenge: tætte, tynde bånd af lysere ved i det næsten sorte, brudt af porer.
      const t = R / B.ring + B.wob * 3 * (n3(th * B.kth + B.seed, s * 0.07, R * 0.2) - 0.5) + 0.5 * (n3(arc * 2.3, s * 0.5, R * 1.7 + B.seed) - 0.5);
      const f = t - Math.floor(t);
      const line = smooth(0, 0.3, f) * (1 - smooth(0.42, 0.75, f));
      const seen = smooth(0.25, 0.75, n3(arc * 1.4 + B.seed, s * 0.16, R * 1.2)) * B.figure;
      const k = line * seen * smooth(0.2, 0.55, n3(arc * 9, R * 9 + B.seed, s * 0.9));
      const L = B.tone * (1 + fibre * 0.14 + calm * 0.3);
      cr = (39 + 40 * k) * L; cg = (29 + 25 * k) * L; cb = (25 + 16 * k) * L;
      const pv = n3(arc * 38 + B.seed, R * 34, s * 3.2);
      const pale = 0.3 * smooth(0.84, 0.9, pv), dark = 0.55 * smooth(0.2, 0.13, pv);     // porer med og uden lyst fyld
      cr += (104 - cr) * pale - cr * dark; cg += (80 - cg) * pale - cg * dark; cb += (62 - cb) * pale - cb * dark;
      cr *= 1 - 0.3 * e * OIL; cg *= 1 - 0.34 * e * OIL; cb *= 1 - 0.34 * e * OIL;
      return;
    }

    // Eg. Årringene er ikke helt runde og ikke lige brede.
    const t = R / B.ring + B.wob * (n3(th * B.kth + B.seed, s * 0.13, R * 0.12) - 0.5)
      + 0.9 * (n3(arc * 1.1 + 7, s * 0.3, R * 0.9 + B.seed) - 0.5) + n2(R * 1.1 + B.seed * 3.7, 0.5);
    const ri = Math.floor(t), f = t - ri, h = hash(ri, B.seed, 3), h2 = hash(ri, B.seed, 11);
    const ew = 0.2 + 0.2 * h;                                                   // vårveddets andel af ringen
    // Veddet mellem porerne har næsten samme farve gennem hele ringen: høstveddet
    // er kun en anelse mørkere. Det er porerne, der tegner årerne i eg.
    const late = smooth(ew, 0.95, f) * (1 - 0.6 * smooth(0.9, 1, f));
    const streak = smooth(0.5, 0.82, n3(arc * 2.1 + 5, R * 1.9 + B.seed, s * 0.11));   // brede strøg af mørkere, brunere ved
    let L = B.tone * (1 - (0.07 + 0.06 * h) * late + (h2 - 0.5) * 0.07 - 0.09 * streak)
      * (1 + fibre * 0.11 + calm * 0.2 + (n3(x * 0.8 + 9, y * 0.45, z * 0.8 + B.seed) - 0.5) * 0.13);
    L *= 1 - 0.16 * e * (1 - smooth(ew * 0.6, ew * 1.6, f)) * smooth(0, 0.05, f);   // vårveddet suger mest olie i endetræet

    // Store porer i vårveddet: rækker af rør langs årerne. På en flade langs
    // årerne ses de som korte, mørke streger, i endetræet som prikker.
    let pore = 0, rim = 0;
    const al = th * (ri + 0.5) * B.ring, wr = f * B.ring, soft = PX * 0.6, dens = 0.55 + 0.45 * h2;
    for (let k = 0; k < 3 && wr < 0.13; k++) {                                 // porerne ligger kun først i ringen
      const row = wr - (0.016 + k * 0.03);
      if (row > 0.055 || row < -0.055) continue;
      const off = h * 9 + k * 0.37, ci = Math.floor(al / 0.038 + off), hc = hash(ci, ri, B.seed + k * 31);
      if (hash(ci, ri + 7, B.seed + k) > dens * (1 - k * 0.25)) continue;       // ikke alle pladser har en pore
      const rad = (0.0115 - k * 0.0027) * (0.7 + 0.6 * hc);
      const da = al - (ci + 0.25 + 0.5 * hash(ci, ri + 57, B.seed + k) - off) * 0.038;
      const dr = row - 0.02 * (hc - 0.5);
      const d = Math.sqrt(da * da + dr * dr);
      if (d < rad * 2.3 + soft) {
        const along = n2(s * B.poreF + hc * 61.7, ci * 0.731 + ri * 0.37 + k * 5);   // røret bugter lidt ind og ud af fladen
        const seen = smooth(0.3 - 0.26 * e, 0.46 - 0.26 * e, along);
        const m = (1 - smooth(rad - soft, rad + soft, d)) * seen, g = (1 - d / (rad * 2.3 + soft)) * seen;
        if (m > pore) pore = m;
        if (g > rim) rim = g;
      }
    }
    L *= 1 + 0.07 * rim * (1 - pore);                                           // porens kant fanger lyset
    // fint, kornet præg mellem de store porer
    const small = 0.3 * smooth(0.74, 0.84, n3(al * 62 + B.seed, R * 52, s * B.poreF * 1.3 + 11)) * (0.4 + 0.6 * late);
    if (small > pore) pore = small;

    // Marvstråler: tynde plader ud fra marven, linseformede på langs. Mange
    // små (k = 0), som giver egens fine streger, og få store (k = 1).
    let ray = 0;
    for (let k = 0; k < 2; k++) {
      const RC = k ? 0.52 : 0.065, LEN = k ? 3.2 : 0.9;
      const rc = Math.floor(arc / RC), hr = hash(rc, 17 + k, B.seed);
      const sc = s / LEN + hr * 13, si = Math.floor(sc), hs = hash(si, rc, B.seed + 3 + k);
      const u = (sc - si - 0.36 - 0.28 * hs) / (0.12 + 0.24 * hash(si, rc + 50, B.seed + k));
      if (u > -1 && u < 1 && (k === 0 || hs < 0.7)) {
        const half = (k ? 0.008 + 0.009 * hr : 0.0025 + 0.004 * hr) * Math.sqrt(1 - u * u) * smooth(0.3, 0.55, n2(R * 0.45 + hs * 31, rc * 1.7 + si * 0.61 + k * 9));
        const dt = Math.abs(arc - (rc + 0.3 + 0.4 * hr) * RC) * R / B.R0;
        const m = sat((half - dt) / (2 * soft) + 0.5) * sat(half / soft) * (k ? 1 : 0.55);   // tynde stråler toner ud i stedet for at flimre
        if (m > ray) ray = m;
      }
    }

    const warm = B.warm + (n3(x * 0.35 + 40, y * 0.2, z * 0.35 + B.seed) - 0.5) * 0.07 + 0.07 * streak;
    cr = 200 * L; cg = (152 - 8 * late) * (1 - warm * 0.5) * L; cb = (98 - 11 * late) * (1 - warm) * L;
    const pk = pore * 0.88;
    cr += (104 - cr) * pk; cg += (66 - cg) * pk; cb += (38 - cb) * pk;
    // Endetræ suger mere olie: mørkere og rødere, mest hvor fladen skærer helt på tværs.
    const oil = e * e * OIL;
    cr *= 1 - 0.28 * oil; cg *= 1 - 0.42 * oil; cb *= 1 - 0.48 * oil;
    // Strålerne er lyse, hvor fladen ligger langs dem («spejl») eller skærer på
    // tværs af årerne, og ellers tynde, mørke streger.
    const pale = smooth(0.55, 0.9, face > end ? face : end), rk = ray * (0.5 + 0.2 * pale);
    cr += ((128 + 96 * pale - 22 * oil) - cr) * rk; cg += ((86 + 110 * pale - 36 * oil) - cg) * rk; cb += ((52 + 98 * pale - 40 * oil) - cb) * rk;
  }

  // De tolv stave: hvert sit bræt med egen marv, så årerne falder forskelligt.
  // Egen er skåret fladt til skråt (flammede og skrå årer), wengen på spejl (lige, tætte linjer).
  function staveBoards(wood) {
    const r = rng(1995), list = [], step = TAU / STAVES, n = Math.hypot(1, G.coneK);
    const ym = (G.SEAM_Y + G.H) / 2, rm = G.R_MAX - G.coneK * (ym - G.coneY0);
    for (let i = 0; i < STAVES; i++) {
      const ac = G.ANGLE0 + (i + 0.5) * step, ox = Math.cos(ac), oz = Math.sin(ac);
      const wenge = wood === 'wenge-eg' && i % 2 === 1;
      const side = r() < 0.5 ? -1 : 1, heart = r() < 0.3 ? Math.PI : 0;
      const psi = wenge ? side * (1.25 + r() * 0.5) : heart + side * (0.25 + r() * 0.8);
      const D = wenge ? 9 + r() * 10 : 4.5 + r() * 9;
      const lean = () => (wenge ? (r() - 0.5) * 0.05 : (r() < 0.5 ? -1 : 1) * (0.04 + 0.15 * r()));
      list.push(board(
        17 + i * 13, [rm * ox, ym, rm * oz],
        [-G.coneK * ox / n, 1 / n, -G.coneK * oz / n],     // årerne følger staven, som hælder lidt
        [-oz, 0, ox], [ox / n, G.coneK / n, oz / n],
        D * Math.sin(psi), -D * Math.cos(psi), lean(), lean(),
        wenge ? 0.045 + r() * 0.02 : 0.14 + r() * 0.12, wenge ? 0.94 + r() * 0.14 : 0.95 + r() * 0.1, wenge,
      ));
    }
    return list;
  }
  // Bundstykket er drejet af to sammenlimede klodser med årerne lodret. I den
  // forreste klods ligger marven ude til venstre, så forsiden viser lige, tætte
  // årer som på studiefotoet, og siderne får flammede årer.
  const baseA = board(5, [0, 0, 0], [0.02, 1, 0.01], [1, 0, 0], [0, 0, 1], -6.6, -2.4, 0.03, 0.04, 0.2, 0.98, false, 0.09);
  const baseB = board(9, [0, 0, 0], [-0.015, 1, 0.02], [1, 0, 0], [0, 0, 1], 7.5, -11, -0.03, 0.025, 0.18, 0.99, false, 0.08);
  const GLUE_Z = -0.18;
  const image = (w, h) => ({ w, h, x0: job.x0 || 0, data: new Uint8ClampedArray(w * h * 4) });

  // Stavene, side om side rundt om bægeret. Regnes i lodrette strimler (x0..x1).
  if (job.kind === 'stave') {
    const W = job.w, Hh = job.h, x0 = job.x0, x1 = job.x1, w = x1 - x0;
    const out = image(w, Hh), d = out.data, boards = staveBoards(job.wood), n = Math.hypot(1, G.coneK);
    for (let xx = x0; xx < x1; xx++) {
      const u = (xx + 0.5) / W, B = boards[Math.min(STAVES - 1, Math.floor(u * STAVES))];
      const ang = G.ANGLE0 + u * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
      for (let yy = 0; yy < Hh; yy++) {
        const y = G.H - ((yy + 0.5) / Hh) * (G.H - G.SEAM_Y), r = G.R_MAX - G.coneK * (y - G.coneY0);
        sample(B, r * ca, y, r * sa, ca / n, G.coneK / n, sa / n);
        const i4 = (yy * w + xx - x0) * 4;
        d[i4] = cr; d[i4 + 1] = cg; d[i4 + 2] = cb; d[i4 + 3] = 255;
      }
    }
    return out;
  }

  // Bundstykket: v følger omridsets længde, så træet ikke strækkes.
  if (job.kind === 'base') {
    const W = job.w, Hh = job.h, x0 = job.x0, x1 = job.x1, w = x1 - x0, P = job.profile;
    const out = image(w, Hh), d = out.data, len = [0];
    for (let j = 1; j < P.length; j++) len.push(len[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]));
    // Fladens normal i hvert punkt på omridset (gennemsnit af de to stykker, der mødes),
    // så den drejer jævnt og tonen ikke springer ved hvert knæk.
    const nrm = P.map((_, j) => {
      let a = 0, b = 0;
      for (const i of [j, j + 1]) {
        if (i < 1 || i >= P.length) continue;
        const dr = P[i][0] - P[i - 1][0], dy = P[i][1] - P[i - 1][1], m = Math.hypot(dr, dy);
        a += dy / m; b -= dr / m;
      }
      const m = Math.hypot(a, b);
      return [a / m, b / m];
    });
    // Skålen og foden skygger for hinanden i hulkehlen: [højde, hvor meget lys der når ind]
    const AO = job.ao, shade = new Float32Array(Hh);
    const row = new Float32Array(Hh * 4);      // radius, højde og fladens normal for hver række
    for (let yy = 0, j = P.length - 1; yy < Hh; yy++) {
      const l = (1 - (yy + 0.5) / Hh) * len[P.length - 1];
      while (j > 1 && len[j - 1] > l) j--;
      const k = (l - len[j - 1]) / (len[j] - len[j - 1]);
      const a = nrm[j - 1][0] + (nrm[j][0] - nrm[j - 1][0]) * k, b = nrm[j - 1][1] + (nrm[j][1] - nrm[j - 1][1]) * k, m = Math.hypot(a, b);
      row[yy * 4] = P[j - 1][0] + (P[j][0] - P[j - 1][0]) * k; row[yy * 4 + 1] = P[j - 1][1] + (P[j][1] - P[j - 1][1]) * k;
      row[yy * 4 + 2] = a / m; row[yy * 4 + 3] = b / m;
      let i = 1;
      while (i < AO.length - 1 && AO[i][0] < row[yy * 4 + 1]) i++;
      shade[yy] = AO[i - 1][1] + (AO[i][1] - AO[i - 1][1]) * sat((row[yy * 4 + 1] - AO[i - 1][0]) / (AO[i][0] - AO[i - 1][0]));
    }
    for (let xx = x0; xx < x1; xx++) {
      const phi = job.phi0 + ((xx + 0.5) / W) * TAU, sp = Math.sin(phi), cp = Math.cos(phi);
      for (let yy = 0; yy < Hh; yy++) {
        const r = row[yy * 4], nr = row[yy * 4 + 2], z = r * cp;
        sample(z >= GLUE_Z ? baseA : baseB, r * sp, row[yy * 4 + 1], z, nr * sp, row[yy * 4 + 3], nr * cp);
        // limfugen mellem de to klodser, og skyggen i hulkehlen
        const g = (1 - 0.22 * (1 - smooth(0.004, 0.004 + PX, Math.abs(z - GLUE_Z)))) * shade[yy];
        const i4 = (yy * w + xx - x0) * 4;
        d[i4] = cr * g; d[i4 + 1] = cg * g; d[i4 + 2] = cb * g; d[i4 + 3] = 255;
      }
    }
    return out;
  }

  // Toppen: låget (et bræt med årerne vandret, skåret så marvstrålerne ses som
  // lyse stænk) og stavenes endetræ som en smal ring udenom.
  if (job.kind === 'top') {
    const S = job.size, out = image(S, S), d = out.data, boards = staveBoards(job.wood), R = G.R_TOP, inner = 0.915;
    const lid = board(31, [0, G.H, 0], [0.42, 0, -0.91], [0.91, 0, 0.42], [0, 1, 0], -19.7, -3.1, 0.03, 0.07, 0.19, 1.0, false, 0.03);
    for (let yy = 0; yy < S; yy++) {
      for (let xx = 0; xx < S; xx++) {
        const px = ((xx + 0.5) / S) * 2 - 1, py = 1 - ((yy + 0.5) / S) * 2, rho = Math.hypot(px, py);
        const X = px * R, Z = -py * R;
        const g = 1 - 0.45 * (1 - smooth(0.003, 0.003 + PX / R, Math.abs(rho - inner)));   // fugen rundt om låget
        if (rho > inner) {
          let a = Math.atan2(Z, X) - G.ANGLE0;
          a = ((a % TAU) + TAU) % TAU;
          sample(boards[Math.floor(a / (TAU / STAVES)) % STAVES], X, G.H, Z, 0, 1, 0);
        } else sample(lid, X, G.H, Z, 0, 1, 0);
        const i4 = (yy * S + xx) * 4;
        d[i4] = cr * g; d[i4 + 1] = cg * g; d[i4 + 2] = cb * g; d[i4 + 3] = 255;
      }
    }
    return out;
  }

  // Bunden af foden: endetræet af de to klodser, set nedefra.
  const S = job.size, out = image(S, S), d = out.data;
  for (let yy = 0; yy < S; yy++) {
    for (let xx = 0; xx < S; xx++) {
      const X = (((xx + 0.5) / S) * 2 - 1) * G.FOOT_R, Z = (1 - ((yy + 0.5) / S) * 2) * G.FOOT_R;
      sample(Z >= GLUE_Z ? baseA : baseB, X, 0, Z, 0, -1, 0);
      const g = 1 - 0.22 * (1 - smooth(0.004, 0.004 + PX, Math.abs(Z - GLUE_Z)));
      const i4 = (yy * S + xx) * 4;
      d[i4] = cr * g; d[i4 + 1] = cg * g; d[i4 + 2] = cb * g; d[i4 + 3] = 255;
    }
  }
  return out;
}

// Skygge bagt ind i bundstykkets træ: [højde i cm, andel af lyset, der når ind].
// Skålen og foden skygger for hinanden i hulkehlen, som på fotoet.
const BASE_SHADE = [[0, 0.97], [0.9, 0.97], [1.3, 0.94], [2, 0.87], [2.8, 0.83], [3.6, 0.87], [4.4, 0.95], [5, 1], [8, 1]];

// Teksturernes størrelse og de mål, træet regnes ud fra.
const STAVE_TEX = [2048, 1024], BASE_TEX = [2048, 768], TOP_TEX = 768;
const GEO = { STAVES, ANGLE0, H, R_MAX, R_TOP, SEAM_Y, FOOT_R, coneK: CONE_K, coneY0: CONE_Y0 };

// De fire flader som opgaver til generate(). De store flader deles i strimler,
// der kan regnes samtidig. px er en pixels størrelse på fladen i cm. På små
// skærme (detail < 1) regnes der færre pixels: flere kan alligevel ikke ses.
function textureJobs(wood, detail = 1) {
  const size = (v) => Math.round((v * detail) / 2) * 2;
  const strips = (job, w, parts) => Array.from({ length: parts }, (_, i) => ({
    ...job, geo: GEO, w, x0: Math.round((w * i) / parts), x1: Math.round((w * (i + 1)) / parts),
  }));
  const around = 2 * Math.PI * R_MAX, sw = size(STAVE_TEX[0]), bw = size(BASE_TEX[0]), top = size(TOP_TEX);
  return {
    stave: strips({ kind: 'stave', wood, h: size(STAVE_TEX[1]), px: around / sw, oil: 1 }, sw, 4),
    // de drejede flader er slebet glatte og suger mindre olie end den savede bund
    base: strips({ kind: 'base', h: size(BASE_TEX[1]), px: around / bw, oil: 0.6, profile: baseProfile(), phi0: Math.PI / 2 - ANGLE0, ao: BASE_SHADE }, bw, 3),
    top: [{ kind: 'top', wood, size: top, px: (2 * R_TOP) / top, oil: 0.85, geo: GEO }],
    bottom: [{ kind: 'bottom', size: TEX, px: (2 * FOOT_R) / TEX, oil: 1, geo: GEO }],
  };
}

// Regner teksturerne ud i Web Workers, så siden ikke fryser. Et lille hold
// workers deler opgaverne mellem sig. Kan workers ikke bruges (fx på grund af
// sidens sikkerhedsregler), regnes opgaverne her på siden, én ad gangen med en
// pause imellem, så siden kan nå at tegne.
function textures(wood, detail) {
  const groups = textureJobs(wood, detail), keys = Object.keys(groups);
  const tasks = keys.flatMap((k) => groups[k].map((job, i) => ({ k, i, job })));
  const parts = Object.fromEntries(keys.map((k) => [k, []]));
  return new Promise((resolve) => {
    let next = 0, left = tasks.length, alive = 0, url = null, chain = Promise.resolve();
    const done = (t, r) => {
      parts[t.k][t.i] = r;
      if (--left) return;
      if (url) URL.revokeObjectURL(url);
      resolve({ stave: toCanvas(parts.stave), base: toCanvas(parts.base), top: toCanvas(parts.top), bottom: parts.bottom[0] });
    };
    const onPage = (t) => { chain = chain.then(() => new Promise((ok) => setTimeout(() => { done(t, generate(t.job)); ok(); }, 0))); };
    const rest = () => { while (!alive && next < tasks.length) onPage(tasks[next++]); };   // ingen workers tilbage
    const feed = (w) => {
      const t = tasks[next++];
      if (!t) { w.terminate(); return; }
      w.onmessage = (e) => { done(t, e.data); feed(w); };
      w.onerror = () => { w.terminate(); alive--; onPage(t); rest(); };
      w.postMessage(t.job);
    };
    try {
      const src = `const generate=${generate};onmessage=(e)=>{const r=generate(e.data);postMessage(r,[r.data.buffer]);};`;
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const count = Math.min(tasks.length, Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
      for (let i = 0; i < count; i++) { const w = new Worker(url); alive++; feed(w); }
    } catch (e) { /* ingen Blob-adresser eller workers */ }
    rest();
  });
}

// Samler strimlerne til ét billede.
function toCanvas(parts) {
  const c = canvas(parts.reduce((w, p) => w + p.w, 0), parts[0].h), ctx = c.getContext('2d');
  for (const p of parts) ctx.putImageData(new ImageData(p.data, p.w, p.h), p.x0, 0);
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
        R += (40 * f - R) * t; G += (23 * f - G) * t; B += (14 * f - B) * t;
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

// Omridset er målt på Frede Høsts studiefotos og skaleret til 15,5 × 9 cm.
// Alle dele er drejet rundt om bægerets akse: der er ingen flader og kanter.
const coneR = (y) => R_MAX - CONE_K * (y - CONE_Y0);   // keglens radius i højden y

// Drejer et omrids af punkter [radius, højde] rundt. Lige stræk har et ekstra
// punkt tæt på hver ende, så lyset ikke «bøjer» hen over dem.
function lathe(THREE, profile) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), SEGMENTS, Math.PI / 2 - ANGLE0);
}

// Bægeret: en glat keglestub fra samlingen og op, med en lille afrunding øverst.
function bodyGeometry(THREE) {
  const y0 = SEAM_Y, y1 = H - 0.12;
  const round = [30, 60, 90].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [R_TOP + (coneR(y1) - R_TOP) * Math.cos(a), y1 + (H - y1) * Math.sin(a)];
  });
  const profile = [
    [coneR(y0) - 0.02, y0], [coneR(y0 + 0.03), y0 + 0.03], [coneR(y0 + 0.25), y0 + 0.25],
    [coneR(y1 - 0.25), y1 - 0.25], [coneR(y1), y1], ...round,
  ];
  const g = lathe(THREE, profile);
  // Stavenes tekstur: u løber rundt om bægeret, så hver stav fylder en tolvtedel
  // hele vejen op; v går fra samlingen (0) til toppen (1).
  const n = profile.length;
  for (let i = 0; i <= SEGMENTS; i++) {
    for (let j = 0; j < n; j++) g.attributes.uv.setXY(i * n + j, 1 - i / SEGMENTS, (profile[j][1] - y0) / (H - y0));
  }
  return g;
}

// Den flade top. Teksturen vender, så stavenes endetræ flugter med stavene.
function topGeometry(THREE) {
  return new THREE.CircleGeometry(R_TOP, SEGMENTS).rotateX(-Math.PI / 2).translate(0, H, 0);
}

// Bundstykkets omrids: fod, slank talje, skål og den brede ring op til samlingen.
function baseProfile() {
  const top = SEAM_Y - SEAM_GAP;
  return [
    [FOOT_R, 0], [3.19, 0.05], [3.245, 0.18], [3.245, 0.3], [3.245, 0.85], [3.24, 0.93],
    [3.22, 1.0], [3.13, 1.1], [2.99, 1.2], [2.85, 1.3], [2.58, 1.45], [2.3, 1.6], [1.98, 1.8],
    [1.79, 2.0], [1.64, 2.2], [1.53, 2.4], [1.47, 2.6], [1.44, 2.8], [1.44, 3.0], [1.48, 3.2],
    [1.53, 3.4], [1.65, 3.6], [1.79, 3.8], [2.01, 4.0], [2.4, 4.2], [2.88, 4.4], [3.46, 4.6],
    [4.0, 4.8], [4.19, 4.9], [4.36, 5.0], [4.46, 5.1], [4.5, 5.22], [R_MAX, CONE_Y0],
    [coneR(5.6), 5.6], [coneR(top - 0.25), top - 0.25], [coneR(top - 0.03), top - 0.03], [coneR(top) - 0.02, top],
  ];
}

// Bundstykket. Teksturen følger omridsets længde (v), så træet ikke strækkes,
// hvor formen svinger ud og ind. generate() regner med samme inddeling.
function baseGeometry(THREE) {
  const profile = baseProfile(), g = lathe(THREE, profile), n = profile.length, len = [0];
  for (let j = 1; j < n; j++) len.push(len[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  for (let i = 0; i <= SEGMENTS; i++) {
    for (let j = 0; j < n; j++) g.attributes.uv.setXY(i * n + j, i / SEGMENTS, len[j] / len[n - 1]);
  }
  return g;
}

// Samlingen mellem bundstykke og bæger: en tynd, mørk linje hele vejen rundt.
function seamGeometry(THREE) {
  const r = coneR(SEAM_Y) - 0.03;
  return new THREE.CylinderGeometry(r, r, SEAM_GAP + 0.04, SEGMENTS, 1, true).translate(0, SEAM_Y - SEAM_GAP / 2, 0);
}

// Et lille «fotostudie» til genskinnet i den olierede overflade: en stor, blød
// lampe til højre, lyst loft og et hvidt bord forneden. Sparer et HDR-billede.
function studioEnvironment(THREE, renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(40, 30, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.1, 0.1, 0.1), side: THREE.BackSide }),
  ));
  const panel = (w, h, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(k, k, k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(14, 14, 13, 5, 9, 2.4);        // den store lampe skråt forfra til højre
  panel(22, 22, 0, 13, 0, 1.0);        // loftet
  panel(30, 30, 0, -13, 0, 0.6);       // bordet
  panel(8, 12, -15, 2, 6, 0.3);        // lidt lys fra venstre
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  return env;
}

/* ---------- montering ---------- */

export async function mount(canvasEl, threeSrc, opts = {}) {
  // Træet regnes ud i baggrunden, mens three.js hentes. En lille skærm kan
  // ikke vise de fineste detaljer, så dér regnes der færre pixels.
  const shown = canvasEl.clientHeight * Math.min(window.devicePixelRatio || 1, 2);
  const pixels = textures(opts.wood || 'eg', shown && shown < 1000 ? 0.75 : 1);

  // Kan three.js ikke hentes, eller findes WebGL ikke, vises bunden fladt.
  let THREE, renderer;
  try {
    THREE = await import(threeSrc);
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.warn('3D ikke tilgængeligt, viser bunden fladt', e);
    return flatView(canvasEl, await pixels);
  }
  // Ingen «filmisk» tonekurve: den gør træet mere mættet og orange, end det er.
  // Farverne skal lande, som de er målt på fotoet.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(THREE, renderer);

  // Lampen er en anelse varm, og lyset fra rummet en anelse køligt, som på fotoet.
  const grey = (v, warm) => new THREE.Color().setRGB(v * (1 + warm), v, v * (1 - 2 * warm));
  const key = new THREE.DirectionalLight(grey(1, 0.05), LIGHT.key);
  key.position.set(...LIGHT.keyPos);
  scene.add(key);
  // lys fra loftet og genskin fra bordet, uden blankt genskin i træet
  scene.add(new THREE.HemisphereLight(grey(LIGHT.sky, -0.07), grey(LIGHT.ground, -0.07), Math.PI));

  const px = await pixels;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (src, wrap) => {
    const t = new THREE.CanvasTexture(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    if (wrap) t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  // Olieret træ er mat: lyset spredes i træet og giver kun et blødt genskin.
  // Der er bevidst ingen relief-effekt ud fra farven (den gav «riller», som
  // rigtigt, slebet træ ikke har) og ingen blank lak-hinde.
  const oiled = (map) => new THREE.MeshStandardMaterial({ map, roughness: WOOD_ROUGHNESS, envMapIntensity: LIGHT.env });

  const model = new THREE.Group();
  model.add(new THREE.Mesh(bodyGeometry(THREE), oiled(tex(px.stave, true))));
  model.add(new THREE.Mesh(topGeometry(THREE), oiled(tex(px.top))));
  model.add(new THREE.Mesh(baseGeometry(THREE), oiled(tex(px.base, true))));
  model.add(new THREE.Mesh(seamGeometry(THREE), new THREE.MeshBasicMaterial({ color: 0x24170e })));

  // Bunden med gravering
  const surface = bottomSurface(px.bottom);
  const bottomTex = tex(surface.face);
  const roughTex = new THREE.CanvasTexture(surface.rough);
  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(FOOT_R, 96),
    new THREE.MeshStandardMaterial({ map: bottomTex, roughnessMap: roughTex, roughness: 1, envMapIntensity: LIGHT.env }),
  );
  bottom.rotation.x = Math.PI / 2;     // vender nedad
  bottom.position.y = 0.0005;
  model.add(bottom);

  model.position.y = -H / 2;
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  pivot.add(model);
  scene.add(pivot);

  // En lang brændvidde, som på et produktfoto, så formen ikke fortegnes.
  const camera = new THREE.PerspectiveCamera(20, 1, 1, 300);
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
