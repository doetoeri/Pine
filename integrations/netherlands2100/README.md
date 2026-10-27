# NETHERLANDS 2100 — PinCon climate integration

Production path: https://pincon.app/climate/ · source: `integrations/netherlands2100` · static output: `climate`.

## Run and build

```sh
cd integrations/netherlands2100
npm ci
npm run dev -- --host 0.0.0.0
npm run build
```

Vite uses `/climate/` as its base and writes only to the repository's `climate/` directory. GitHub Pages publishes the existing main branch; no PinCon authentication, Firebase, routing, root service worker, or other service files are changed. The narrow climate service worker has no fetch handler.

## Presentation

Choose scenario 3 and press Play. Permanent inundation accumulates deterministically from 2026–2100; temporary flood events are a separate optional layer. Space toggles playback; arrows change year; Shift+arrows navigate events; F enters fullscreen. Important model thresholds pause playback until the presenter continues. Compare uses identical climate inputs for the two policy plans.

The bright aerial map shows actual Netherlands land, the inland borders with Germany and Belgium, and geographically anchored periodic water texture. A 2D fallback supports devices without WebGL.

## Scientific status

This is an exploratory educational simulator, not a validated hydraulic forecast. The default scenario is explicitly labelled **defence-failure DEMO, not an official projection**. Actual AHN elevation samples, CBS municipal geometry and population, OSM infrastructure samples, PDOK 2025 aerial imagery and Natural Earth borders are retained. Elevations are not altered to enlarge flooding. Mean sea-level projection reference periods and NAP elevations are separate concepts.

KNMI scenarios use published scenario anchors relative to 1995–2014 and an assumed NAP tie. Existing defence capacity is a model assumption, not a surveyed national crest database. The DEMO assumes failed protection and gradual filling of low basins; regional connectivity is simplified and does not resolve canals, pumps, breach flow or time-varying hydraulics. About 31,235 km² of clipped land samples are analysed. Population exposure assumes uniform municipal density; the economic indicator is an activity proxy, not measured GDP damage. Power topology, capacities and outage thresholds include assumptions.

DEMO permanent area checkpoints (km²): 2026: 0; 2040: 429; 2060: 4,549; 2080: 11,624; 2100: 15,068. These are illustrative model outputs, not official inundation forecasts. Policy recovery is a separate overlay and does not erase the permanent ledger. Saved v0.1 optimisation is re-evaluated, not claimed optimal for the new flooding engine.

## Sources and licences

AHN / PDOK: open elevation data, EPSG:28992, heights in metres NAP; browser geometry is EPSG:4326. CBS municipal boundaries and population: 2024. Consult `docs/DATA_MANIFEST.json`, `docs/SOURCES.md` and `public/data/sources.json` for inherited source records and limitations. PDOK / Samenwerkingsverband Beeldmateriaal 2025 aerial imagery: CC BY 4.0, served by licensed WMS/WMTS; NASA GIBS Blue Marble context; Natural Earth Admin-0 1:10m borders: public domain; water texture: project-generated periodic Fourier field, MIT, a visual effect rather than observed water depth. Font licence is bundled in `public/fonts/OFL.txt`.

The bundled GIS data is sufficient to reproduce the browser results. `scripts/prepare_v2.py` is an optional preprocessing stage and expects licensed source exports in a supplied directory; it does not download or redistribute a tile pyramid.

## Verification record and limitations

The production build completed. Before the user requested immediate publication, 13 model tests and 74 existing PinCon regression/contract tests passed. The new Playwright suite was written but could not launch because its Chromium executable was missing; its 14 cases have **not** passed. Further testing was stopped at the user's request. Earlier reports in `docs` belong to the inherited v0.1 application and do not certify this version. WebGL shader quality on a physical 4K presentation device remains to be checked.

## Rollback

Revert the climate integration merge commit on main, then let the existing GitHub Pages workflow publish. Baseline before integration: `24a279b6d19ed38b9cab6fd2dab9697148c1c12f`. Reverting this additive change removes only `climate/` and `integrations/netherlands2100/`; do not reset or delete other PinCon services.
