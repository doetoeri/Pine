import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../..");
const read=(p)=>readFile(path.resolve(root,p),"utf8");

test("classroom layout supports vice president and officer viewing without making them seat editors",async()=>{
  const accounts=await read("integrations/pincon-ai/lib/class-accounts.mjs");
  assert.match(accounts,/CLASS_VICE_PRESIDENT/);
  assert.match(accounts,/canViewClassroomLayout/);
  assert.match(accounts,/ROLE\.DEPARTMENT_HEAD/);
  assert.match(accounts,/canSeeClassroomReporter[\s\S]*ROLE\.ADMIN/);
  assert.doesNotMatch(accounts,/isClassOperator[\s\S]{0,180}CLASS_VICE_PRESIDENT/);
});

test("reporter identity is recorded server-side and redacted for non-admin viewers",async()=>{
  const api=await read("integrations/pincon-ai/handlers/class-ops/classroom-layout.mjs");
  assert.match(api,/ADD_NOMINATION/);
  assert.match(api,/proposerUid:\s*actor\.uid/);
  assert.match(api,/proposerName:\s*safeText\(actor\.name/);
  assert.match(api,/canSeeClassroomReporter/);
  assert.match(api,/proposerUid, proposerName, proposerRole/);
  assert.match(api,/auditLayout/);
});

test("TV display control is separated from seat editing permission",async()=>{
  const api=await read("integrations/pincon-ai/handlers/class-ops/classroom-layout.mjs");
  assert.match(api,/assertDisplayController/);
  assert.match(api,/canControlDisplay:\s*canViewClassroomLayout/);
  assert.match(api,/SET_DISPLAY/);
  assert.match(api,/assertDisplayController\(actor\)/);
  assert.match(api,/assertOperator\(actor\)[\s\S]*CLASSROOM_LAYOUT_UPDATE/);
});

test("TV supports five classroom situations and keeps the previous general seating for move guidance",async()=>{
  const api=await read("integrations/pincon-ai/handlers/class-ops/classroom-layout.mjs");
  for(const key of ["morning","assessment","seat-change","history-group","special"]) assert.match(api,new RegExp(key.replace("-","\\-")));
  assert.match(api,/previousSeats/);
  assert.match(api,/leadMinutes/);
  assert.match(api,/startAt/);
  assert.match(api,/finalSeconds/);
});

test("officer classroom page provides printing, TV presets and three layout modes",async()=>{
  const [html,js,css]=await Promise.all([read("next/classroom/index.html"),read("next/classroom/classroom.js"),read("next/classroom/classroom.css")]);
  assert.match(html,/classroom\.js/);
  assert.match(js,/window\.print/);
  assert.match(js,/window\.open\("\.\/tv\.html"/);
  assert.match(js,/SET_DISPLAY/);
  assert.match(js,/아침시간/);
  assert.match(js,/수행평가 전/);
  assert.match(js,/자리 바꾸는 시간/);
  assert.match(js,/한국사 모둠 시작 전/);
  assert.match(js,/특별 상황/);
  assert.match(js,/canControlDisplay/);
  assert.match(css,/@media print/);
});

test("TV mode keeps countdown, movement, desk rotation and final layout",async()=>{
  const [tv,css]=await Promise.all([read("next/classroom/tv.js"),read("next/classroom/tv.css")]);
  assert.match(tv,/activeScene/);
  assert.match(tv,/countdownText/);
  assert.match(tv,/guideAt/);
  assert.match(tv,/previousSeats/);
  assert.match(tv,/showMove/);
  assert.match(tv,/showFinal/);
  assert.match(tv,/rotation/);
  assert.match(css,/tv-countdown/);
  assert.match(css,/@keyframes progress/);
});

test("TV is rebuilt as a minimal bright display with fast fade-only transitions",async()=>{
  const [html,tv,css]=await Promise.all([read("next/classroom/tv.html"),read("next/classroom/tv.js"),read("next/classroom/tv.css")]);
  assert.match(html,/theme-color" content="#f5f5f7"/);
  assert.match(tv,/DEFAULT_TIMING/);
  assert.match(tv,/intro:\s*2\.4/);
  assert.match(tv,/move:\s*1\.5/);
  assert.match(tv,/final:\s*4\.5/);
  assert.match(tv,/is-fading-out/);
  assert.match(tv,/is-fading-in/);
  assert.doesNotMatch(css,/translateY|scale\(|blur\(/);
  assert.match(css,/transition:opacity \.18s ease/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/--bg:#f5f5f7/);
});

test("main PinCon loads the officer classroom entry",async()=>{
  const [bootstrap,entry]=await Promise.all([read("next/app-bootstrap.js"),read("next/classroom-entry.js")]);
  assert.match(bootstrap,/classroom-entry\.js/);
  assert.match(entry,/CLASS_VICE_PRESIDENT/);
  assert.match(entry,/DEPARTMENT_HEAD/);
  assert.match(entry,/\.\/classroom\//);
});
