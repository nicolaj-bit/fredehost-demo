# Frede Høst – demo

Salgsoplæg til Frede Høst Denmark: et Shopify-tema med forside og én
produktside (TOVE, raflebæger i olieret wenge og eg, 999 kr.) med
3D-visning af gravering i bunden. Siden var først ANNY i olieret eg, men alle
fotos viser TOVE, så produktsiden blev skiftet. 3D-modellen kan begge:
indstillingen «Træ i 3D-visningen» på produktsektionen (eg / wenge og eg). Bygges i en Shopify dev store med kodeord. **fredehost.dk røres ikke.**

Der arbejdes kun på branchen `dev`. Temaet publiceres ikke uden Nicolajs ok.

## Omfang

Med: forside, `/products/tove`, graveringsmodal med 3D.
Ikke med: kurv, checkout, de øvrige fire bægre, øvrige sider, og
Shopify-integrationen af graveringen (linjeegenskaber, upload af
forhåndsvisning, produktionsdata på ordren). «Gem og læg i kurv» gemmer kun
graveringen på siden.

## Lounge-udtryk

Indstillingen «Udtryk» (lys / lounge) i temaets indstillinger skifter hele
temaet til et mørkt, varmt udtryk: cognac, valnød og messing. Lounge-forsiden
ligger i `templates/index.lounge.json` og bruger Frede Høsts egne fotos fra
fredehost.dk (`assets/fh-lounge-*.webp`).

```bash
npm run preview -- --mood lounge --index index.lounge --out dist-lounge
```

I dev store'en ligger lounge som sit eget upublicerede tema, «Frede Høst –
Lounge (dev)» (`?preview_theme_id=210973819212`). Det er samme kode; forskellen
er `settings_data.json` (`"mood": "lounge"`) og at `templates/index.json` dér
har indholdet fra `index.lounge.json`. Fotoene ligger i butikkens Filer som
`fh-lounge-*.jpg` og er hentet fra fredehost.dk. Lounge-stilarterne ligger i
`assets/lounge.css` og hentes kun, når udtrykket er lounge.

## Ikke til søgemaskiner

- Kodeord på butikken.
- `<meta name="robots" content="noindex, nofollow …">` på alle sider
  (`snippets/head-common.liquid`, bruges af både `theme` og `password`).
- `templates/robots.txt.liquid` afviser al crawling.
- Intet canonical-link.

Siderne indeholder Frede Høsts egne tekster og må ikke konkurrere med
fredehost.dk i Google.

## 3D-visningen

`assets/engraver.js` + three r160 fra jsDelivr. Begge hentes med `import()`
først, når modalen åbnes. three.js ligger ikke i `assets/`, fordi Shopifys
API ikke vil hente filen fra en URL i dev store'en, og den er for stor til at
sende som tekst. Den kan flyttes ind med Shopify CLI senere. Produktsiden får kun markup og
et lille `type="module" async`-script, der ikke venter på stylesheets.

Modellen: 15,5 cm høj, 9 cm i diameter. Kroppen er tolv flade staver med
synlige limfuger, foden er drejet. Olieret eg med årer på langs af hver stav;
bunden er endetræ med årringe. Graveringen er brændt, ikke præget: mørk farve og
mere mat overflade, men ingen fordybning, og træets struktur anes igennem.

Træets teksturer regnes ud i Web Workers, og ved tastetryk tegnes kun
tekstfeltet i bunden om, så siden ikke fryser. Kan three.js ikke hentes, eller
findes WebGL ikke, vises bunden fladt med samme gravering.

## Lokalt

```bash
npm install
npm run preview                                   # dist/
npm run preview -- --no-engraver --out dist-base  # samme side uden 3D
python3 -m http.server 8765 --directory dist &
python3 -m http.server 8766 --directory dist-base &
npm run perf
```

`scripts/preview.mjs` efterligner kun den del af Shopifys Liquid, temaet
bruger. Det er til skærmbilleder og måling, ikke til drift.

## Dev store

Temaet ligger som det **upublicerede** tema «Frede Høst demo (dev)» i
`frede-host-demo.myshopify.com`. Det live tema er stadig Horizon.
Forhåndsvis med `?preview_theme_id=210941542732`.

`templates/product.uden-3d.json` er samme produktside uden graveringsmodulet
og bruges kun til at sammenligne ydelse:

```bash
FH_PASSWORD=… FH_THEME=210941542732 node scripts/perf-store.mjs
```

3D-graveringen testes i begge temaer, på computer og mobil, med:

```bash
FH_PASSWORD=… node scripts/test-engraver.mjs
```

Kodeordet står ikke i repoet.

Horizons filer ligger stadig i temaet (API'et må ikke slette temafiler). De
bruges ikke. Horizons skabeloner og sektionsgrupper er overskrevet, så de ikke
kolliderer.
