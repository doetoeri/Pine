# Mission 03 verification

## Automated checks

- TypeScript + Vite production build passed.
- Vitest: 21 passed (13 inherited model invariants + 8 new policy/risk/sequence/format tests).
- Playwright core suite: **13 passed**, 0 failed, 0 skipped, including native 1920×1080 and 3840×2160 cases. Final result: `mission03-playwright-results.json`.
- Real wall-clock unattended presentation: **1 passed**, 612.213 seconds, 61 checkpoints, all three climate modes and automatic return to cycle 2 confirmed. Started 2026-10-27T14:41:04.142Z (UTC). Evidence: `mission03-endurance-results.json` and `mission03-screenshots/endurance-610s.json`. The accelerated 600-second test also passed all four chapters and repeat.

| Requested check | Evidence |
| --- | --- |
| 1. A dike leaves B unchanged | E2E 01; separate policy arrays, B empty |
| 2. B relocation leaves A unchanged | E2E 02; destination housing prerequisite is created first |
| 3. Independent recomputation | Different dike/relocation plans change land and population outputs independently |
| 4. Identical policies, identical results | A→B copy compares exact area, people, risk and investment attributes; unit frame equality |
| 5. Preserve year after policy changes | Create/edit/preset loading at 2080; camera also retained |
| 6. Visible risk change in general climate | Pressure/potential terrain increase by 2100 while actual modeled permanent area remains 0 |
| 7. Distinct risk/flood layers | Separate controls, legend, overlay semantics, no-risk toggle cannot change flood total |
| 8. 1920×1080 and 3840×2160 | True Playwright viewport settings; screenshots at native sizes; section and panel bounds, table clipping/overflow assertions |
| 9. 10-minute presentation | Accelerated 600s chapters/repeat plus dedicated 610s wall-clock run |
| 10. PinCon unaffected | No changes outside climate source/output; unchanged `/` and `/next/` return HTTP 200; climate resource URLs remain under `/climate/` |

Additional checks: policy names/budgets/lists survive reload independently; explicit completion/cost and validation; camera zoom/pan synchronization; exact automatic 2038 event stop and clean Continue; fullscreen and shortcuts; WebGL-disabled fallback; real German/Belgian inland borders.

## Issues found during implementation and resolved

- Table delta row was clipped: reserved results grid height increased and a bottom-bound assertion added.
- Dike expiration affected endpoint assumptions: retained inherited 60-year service life, displayed effect dates, and compare an in-service policy instead of assuming an expired one still protects.
- Camera test read a moving zoom value in separate round trips: now checks both camera values atomically, and tests actual drag as well.
- Presentation elapsed accounting changed to a wall-clock epoch; all four virtual-clock chapters and loop verified.
- Continue no longer sets or retains the event municipality panel. SVG drag suppresses the ensuing selection click.
- City labels were separated and scaled at 4K. National framing fits the full Netherlands in the reserved map viewport.

## Boundaries

Playwright browser viewports are not measurements on a physical television. Source/engine tests do not establish physical flood-model calibration. Root/next HTTP and change-isolation checks do not test every signed-in PinCon/Firebase workflow. No root application, database, permissions or root cache code was modified.
