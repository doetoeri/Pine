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

test("ceremony v3 offers a user-gesture fullscreen launch gate", async () => {
  const [ceremony, css, tv] = await Promise.all([
    read("next/classroom/seating-ceremony.js"),
    read("next/classroom/seating.css"),
    read("next/classroom/seating-tv.js"),
  ]);

  assert.match(ceremony, /data-launch-fullscreen/);
  assert.match(ceremony, /전체화면으로 공개/);
  assert.match(ceremony, /document\.documentElement\.requestFullscreen/);
  assert.match(ceremony, /navigationUI:\s*"hide"/);
  assert.match(ceremony, /data-launch-window/);
  assert.match(css, /ceremony-launch-layer/);
  assert.match(css, /:fullscreen \.tv-controls\{opacity:\.22/);
  assert.match(tv, /if \(document\.fullscreenElement\) keepAwake\(\)/);
});

test("ceremony v3 is cinematic but keeps seating readable and motion-safe", async () => {
  const [ceremony, css, html] = await Promise.all([
    read("next/classroom/seating-ceremony.js"),
    read("next/classroom/seating.css"),
    read("next/classroom/seating-tv.html"),
  ]);

  assert.match(ceremony, /\.\.\/assets\/pincon-icon\.svg/);
  assert.match(ceremony, /CEREMONY_TIMING/);
  assert.match(ceremony, /intro:\s*2300/);
  assert.match(ceremony, /zones:\s*2300/);
  assert.match(ceremony, /shuffle:\s*2800/);
  assert.match(ceremony, /settle:\s*1100/);
  assert.match(ceremony, /finale:\s*1700/);
  assert.match(ceremony, /SHUFFLE_DELAYS/);
  assert.match(ceremony, /ceremony-curtain/);
  assert.match(ceremony, /ceremony-zone-glow/);
  assert.match(ceremony, /ceremony-shuffle-scan/);
  assert.match(ceremony, /ceremony-lock-wave/);
  assert.match(ceremony, /prefers-reduced-motion:\s*reduce/);

  assert.match(css, /ceremony-phase-intro/);
  assert.match(css, /ceremony-phase-zones/);
  assert.match(css, /ceremony-phase-shuffle/);
  assert.match(css, /ceremony-phase-settle/);
  assert.match(css, /ceremony-phase-finale/);
  assert.match(css, /ceremony-zone-rhythm/);
  assert.match(css, /ceremony-complete/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /ceremony3/);
});

test("stable TV view keeps PinCon branding and leaves fullscreen controls usable", async () => {
  const [tv, css] = await Promise.all([
    read("next/classroom/seating-tv.js"),
    read("next/classroom/seating.css"),
  ]);
  assert.match(tv, /tv-brand-signature/);
  assert.match(tv, /pincon-icon\.svg/);
  assert.match(css, /tv-brand-signature/);
  assert.match(css, /:fullscreen \.tv-controls:hover/);
  assert.doesNotMatch(css, /:fullscreen \.tv-controls\{opacity:0;pointer-events:none\}/);
});

test("seat planner offers separate normal and ceremony TV launch links", async () => {
  const planner = await read("next/classroom/seating.js");
  assert.match(planner, /const tvURL = \(ceremony = false\)/);
  assert.match(planner, /query\.set\("ceremony", "1"\)/);
  assert.match(planner, /세레머니 공개/);
  assert.match(planner, /tvURL\(true\)/);
});
