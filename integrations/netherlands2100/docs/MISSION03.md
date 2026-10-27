# Mission 03: Climate visibility and independent policy comparison

Runtime: `/climate/`. Existing PinCon root, `/next/`, authentication, databases and root service workers are outside this change.

## What changed

- One shared climate pathway, time and camera. `left` and `right` each own their policy array, name, total budget and annual budget. Results are derived by two independently memoized deterministic engine runs; there is no single shared policy array.
- Independent create/edit/delete/location/start/completion/capital-cost controls, local browser persistence, copy in both directions, exchange and reset.
- Policy edits/preset loading do not reset the year, camera or other plan. Policy completion can be explicitly scheduled; before completion effects are zero. Existing service-life assumptions remain in force and the editor displays expiry.
- The former `noadapt` enum is retained internally for compatibility, but is now the **KNMI low-emissions climate pathway** (2100 median 0.44m), not a policy switch. `knmi` uses the high-emissions pathway (0.82m); `extreme` remains the explicitly assumed +2.50m defence-failure demo. Policies apply independently in all pathways.
- Conditional terrain exposure (translucent teal/hatching), model permanent inundation (blue), optional temporary storm inundation (amber) and optional A/B differences (orange/purple) are distinct layers.
- Both maps retain their A/B policy name, count and key results. The common results table contains area, affected population, economic activity exposure, temporary-flood damage proxy, cumulative policy investment, power shortfall and A-minus-B differences.
- Korean `만 명` and `억 유로` notation. Economic activity exposure is not labelled as GDP loss. Temporary-flood damage does not purport to estimate all permanent-inundation damage.
- Grid layout reserves separate space for controls, map headers, results and the single active drawer. Policy/source/event drawers cannot stack over each other or cover the results table.
- Larger speed controls and labelled scrollable event markers with visible hover/focus tooltips. Continue clears the event-selected region; SVG drag no longer selects a municipality.
- Shared Canvas overlay on the MapLibre and SVG backgrounds. Existing periodic water bitmap is no longer used; a broad continuous water tint avoids tiling stripes. Subpixel display feathering reduces hard cell seams. Geography and area calculations are unchanged.

## Risk definitions and limits

For an analysis cell `c`, mean head is the assumed NAP baseline plus the climate sea-level anchor/interpolation. A cell belongs to the **conditional potential terrain exposure** set only if `c.z <= meanHead` AND `c.spill <= meanHead`. Its actual analysis-cell area is summed. This deliberately ignores functioning defences and is not flooded land, an annual probability or a claim of inevitable failure.

Assumed regional defence margin = `region.defenceNAP + active protection boost - meanHead`. The national margin is area weighted. This is not surveyed dike crest freeboard.

For eligible cells, relative pressure = `depth / (depth + 2m + max(margin, 0))`, where `depth = max(0, meanHead - c.z)`. The displayed index is the area-weighted mean times 100 over all analyzed land. This dimensionless explanatory index is **not a probability**. A policy can change pressure even when both plans still show zero modeled inundation.

The difference overlay compares permanent masks first and relative-pressure differences otherwise. Small differences are visually amplified, never added to metric totals. Orange means higher local exposure/pressure on this side; purple means lower. Identical policies produce no difference.

Risk and HUD values are linearly interpolated between deterministic annual calculations for animation. Rendering does not invent additional flood cells. The underlying first-wet ledger, terrain elevations, boundaries, population input and official anchors remain unchanged.

Unresolved scientific limits inherited from the dataset: approximate 2km analysis; no observed NAP/reference-period tie; assumed defence gates, policy effectiveness/cost/lifetime, uniform population allocation, economic proxies and assumed-capacity adjacency power network. This remains an exploratory model, not a calibrated flood or economic-loss forecast.

## 10-minute presentation

Use **10분 발표 시작**. This enables potential risk, A/B comparison and difference emphasis, disables event pauses, starts at the national view, and enables repeat. It never changes either policy list.

| Wall-clock time | Chapter |
| --- | --- |
| 0–180s | KNMI high, 2026–2100 |
| 180–360s | KNMI low, 2026–2100 |
| 360–540s | Defence-failure demo, 2026–2100 |
| 540–600s | Hold 2100, compare results |
| 600s | Repeat from chapter 1 if automatic repeat is enabled |

The presentation uses a wall-clock epoch so chapter changes do not accumulate interpolation drift. Space pauses/resumes. Manual seeking, pathway changes or policy editing exits the automatic sequence. Standard playback can also repeat through **발표 설정 → 끝나면 자동 반복**.

## Reproduce verification

```sh
cd integrations/netherlands2100
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e -- --grep-invert 'real ten-minute'
RUN_LONG_PRESENTATION=1 PW_REPORT_FILE=docs/mission03-endurance-results.json npm run test:e2e -- --grep 'real ten-minute'
```

If a browser is already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable. `TEST_PORT` chooses the local static-server port; `TEST_BASE_URL` targets an already running server. Tests serve the built `/climate/` output alongside the unchanged PinCon root.

See `MISSION03_TEST_REPORT.md`, JSON reports and `mission03-screenshots/` for current-run evidence. Physical TV viewing distance, panel-specific colour/overscan, production GPU frame rate and signed-in PinCon workflows require separate device/user-session testing.
