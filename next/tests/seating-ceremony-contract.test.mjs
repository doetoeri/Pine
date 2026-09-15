import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = p => readFile(path.resolve(root, p), "utf8");

test("seating TV exposes a query-controlled PinCon ceremony without changing seating data", async () => {
  const [tv, ceremony] = await Promise.all([
    read("next/classroom/seating-tv.js"),
    read("next/classroom/seating-ceremony.js"),
  ]);

  assert.match(tv, /createSeatingCeremony/);
  assert.match(tv, /isCeremonyRequested/);
  assert.match(tv, /data-seat-index/);
  assert.match(ceremony, /ceremony === "1"/);
  assert.match(ceremony, /params\.get\("reveal"\) === "ceremony"/);

  for (const phase of ["idle", "intro", "zones", "shuffle", "settle", "finale", "stable"]) {
    assert.match(ceremony, new RegExp(`"${phase}"`));
  }

  assert.doesNotMatch(ceremony, /accountRequest|SAVE_GENERAL|general\.seats\s*=|classroom-layout/);
  assert.match(ceremony, /restoreNames/);
});

test("ceremony v2 keeps the reveal crisp, paced and reduced-motion safe", async () => {
  const [ceremony, css, html] = await Promise.all([
    read("next/classroom/seating-ceremony.js"),
    read("next/classroom/seating.css"),
    read("next/classroom/seating-tv.html"),
  ]);

  assert.match(ceremony, /\.\.\/assets\/pincon-icon\.svg/);
  assert.match(ceremony, /CEREMONY_TIMING/);
  assert.match(ceremony, /intro:\s*2100/);
  assert.match(ceremony, /zones:\s*2100/);
  assert.match(ceremony, /shuffle:\s*2600/);
  assert.match(ceremony, /settle:\s*900/);
  assert.match(ceremony, /finale:\s*1500/);
  assert.match(ceremony, /SHUFFLE_DELAYS/);
  assert.match(ceremony, /ceremony-complete/);
  assert.match(ceremony, /prefers-reduced-motion:\s*reduce/);

  assert.match(css, /PinCon Seating Ceremony TV/);
  assert.match(css, /ceremony-phase-intro/);
  assert.match(css, /ceremony-phase-zones/);
  assert.match(css, /ceremony-phase-shuffle/);
  assert.match(css, /ceremony-phase-settle/);
  assert.match(css, /ceremony-phase-finale/);
  assert.match(css, /ceremony-zone-rhythm/);
  assert.match(css, /ceremony-complete/);
  assert.match(css, /:fullscreen \.tv-controls/);
  assert.doesNotMatch(css, /ceremony-phase-zones \.ceremony-layer::before\{opacity:\.72\}/);
  assert.match(css, /linear-gradient\(90deg,transparent,#2daa00/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /ceremony2/);
});

test("stable TV view keeps a restrained PinCon signature", async () => {
  const [tv, css] = await Promise.all([
    read("next/classroom/seating-tv.js"),
    read("next/classroom/seating.css"),
  ]);
  assert.match(tv, /tv-brand-signature/);
  assert.match(tv, /pincon-icon\.svg/);
  assert.match(css, /tv-brand-signature/);
});

test("seat planner offers separate normal and ceremony TV launch links", async () => {
  const planner = await read("next/classroom/seating.js");
  assert.match(planner, /const tvURL = \(ceremony = false\)/);
  assert.match(planner, /query\.set\("ceremony", "1"\)/);
  assert.match(planner, /세레머니 공개/);
  assert.match(planner, /tvURL\(true\)/);
});
