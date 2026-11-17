# Frede Høst – demo

Salgsoplæg til Frede Høst Denmark: et Shopify-tema med forside og én
produktside (ANNY, raflebæger i olieret eg) med 3D-visning af gravering i
bunden. Bygges i en Shopify dev store med kodeord. **fredehost.dk røres ikke.**

Der arbejdes kun på branchen `dev`. Temaet publiceres ikke uden Nicolajs ok.

## Omfang

Med: forside, `/products/anny`, graveringsmodal med 3D.
Ikke med: kurv, checkout, de øvrige fire bægre, øvrige sider, og
Shopify-integrationen af graveringen (linjeegenskaber, upload af
forhåndsvisning, produktionsdata på ordren). «Gem og læg i kurv» gemmer kun
graveringen på siden.

## Ikke til søgemaskiner

- Kodeord på butikken.
- `<meta name="robots" content="noindex, nofollow …">` på alle sider
  (`snippets/head-common.liquid`, bruges af både `theme` og `password`).
- `templates/robots.txt.liquid` afviser al crawling.
- Intet canonical-link.

Siderne indeholder Frede Høsts egne tekster og må ikke konkurrere med
fredehost.dk i Google.

## 3D-visningen

`assets/engraver.js` + `assets/three.module.min.js` (three r160). Begge
hentes med `import()` først, når modalen åbnes. Produktsiden får kun markup og
et lille `type="module" async`-script, der ikke venter på stylesheets.

Modellen: 15,5 cm høj, 9 cm i diameter. Kroppen er tolv flade staver med
synlige limfuger, foden er drejet. Olieret eg med årer på langs af hver stav;
bunden er endetræ med årringe. Graveringen er brændt, ikke præget: mørk farve og
mere mat overflade, men ingen fordybning, og træets struktur anes igennem.

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
