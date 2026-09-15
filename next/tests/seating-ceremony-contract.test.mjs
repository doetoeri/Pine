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

  for (const phase of ["idle", "intro", "countdown", "zones", "shuffle", "settle", "finale", "stable"]) {
    assert.match(ceremony, new RegExp(`"${phase}"`));
  }

  assert.doesNotMatch(ceremony, /accountRequest|SAVE_GENERAL|general\.seats\s*=|classroom-layout/);
  assert.match(ceremony, /restoreNames/);
});

test("ceremony v4 hides seating completely before reveal and adds a three-count suspense phase", async () => {
  const [ceremony, css, html] = await Promise.all([
    read("next/classroom/seating-ceremony.js"),
    read("next/classroom/seating.css"),
    read("next/classroom/seating-tv.html"),
  ]);

  assert.match(ceremony, /countdown:\s*3000/);
  assert.match(ceremony, /applyPhase\("countdown"\)/);
  assert.match(ceremony, /data-count="3"/);
  assert.match(ceremony, /data-count="2"/);
  assert.match(ceremony, /data-count="1"/);
  assert.match(ceremony, /ceremony-countdown-progress/);

  assert.match(css, /ceremony-phase-countdown/);
  assert.match(css, /visibility:hidden/);
  assert.match(css, /ceremony-blackout/);
  assert.match(css, /background:#041009/);
  assert.match(css, /background:linear-gradient\(90deg,#041009/);
  assert.match(css, /ceremony-seam-pulse/);
  assert.match(css, /ceremony-count-number/);
  assert.match(css, /ceremony-count-ring/);
  assert.match(css, /ceremony-count-progress/);
  assert.match(css, /ceremony-phase-zones \.ceremony-curtain-left\{transform:translate3d\(-102%/);
  assert.match(html, /ceremony4/);
});

test("ceremony v4 pacing keeps the countdown dramatic without overrunning seat settle", async () => {
  const [ceremony, css] = await Promise.all([
    read("next/classroom/seating-ceremony.js"),
    read("next/classroom/seating.css"),
  ]);

  assert.match(ceremony, /intro:\s*1800/);
  assert.match(ceremony, /countdown:\s*3000/);
  assert.match(ceremony, /zones:\s*2400/);
  assert.match(ceremony, /shuffle:\s*2800/);
  assert.match(ceremony, /settle:\s*1050/);
  assert.match(ceremony, /finale:\s*1800/);
  assert.match(ceremony, /SHUFFLE_DELAYS/);
  assert.match(css, /ceremony-zone-glow/);
  assert.match(css, /ceremony-shuffle-scan/);
  assert.match(css, /ceremony-lock-wave/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test("ceremony keeps fullscreen launch, wake lock, and post-ceremony controls", async () => {
  const [ceremony, css, tv] = await Promise.all([
    read("next/classroom/seating-ceremony.js"),
    read("next/classroom/seating.css"),
    read("next/classroom/seating-tv.js"),
  ]);

  assert.match(ceremony, /data-launch-fullscreen/);
  assert.match(ceremony, /전체화면으로 공개/);
  assert.match(ceremony, /document\.documentElement\.requestFullscreen/);
  assert.match(ceremony, /navigationUI:\s*"hide"/);
  assert.match(css, /:fullscreen \.tv-controls\{opacity:\.22/);
  assert.match(css, /:fullscreen \.tv-controls:hover/);
  assert.match(tv, /if \(document\.fullscreenElement\) keepAwake\(\)/);
});

test("stable TV view keeps PinCon branding and planner offers the ceremony launch link", async () => {
  const [tv, css, planner] = await Promise.all([
    read("next/classroom/seating-tv.js"),
    read("next/classroom/seating.css"),
    read("next/classroom/seating.js"),
  ]);

  assert.match(tv, /tv-brand-signature/);
  assert.match(css, /ceremony-complete/);
  assert.match(planner, /const tvURL = \(ceremony = false\)/);
  assert.match(planner, /query\.set\("ceremony", "1"\)/);
  assert.match(planner, /세레머니 공개/);
  assert.match(planner, /tvURL\(true\)/);
});
