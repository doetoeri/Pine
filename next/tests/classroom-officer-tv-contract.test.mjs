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

test("TV supports five classroom situations and keeps previous seating and schedule settings",async()=>{
  const [api,tv]=await Promise.all([read("integrations/pincon-ai/handlers/class-ops/classroom-layout.mjs"),read("next/classroom/tv.js")]);
  for(const key of ["morning","assessment","seat-change","history-group","special"]) {
    assert.match(api,new RegExp(key.replace("-","\\-")));
    assert.match(tv,new RegExp(key.replace("-","\\-")));
  }
  assert.match(api,/previousSeats/);
  assert.match(tv,/previousSeats/);
  assert.match(api,/leadMinutes/);
  assert.match(tv,/guideAt/);
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

test("TV renderer has explicit states and independent render functions",async()=>{
  const tv=await read("next/classroom/tv.js");
  for(const state of ["waiting","intro","movement","final","messageOnly","error"]) assert.match(tv,new RegExp(`"${state}"`));
  assert.match(tv,/function renderWaiting/);
  assert.match(tv,/function renderIntro/);
  assert.match(tv,/function renderMovement/);
  assert.match(tv,/function renderFinal/);
  assert.match(tv,/function renderMessage/);
  assert.match(tv,/function renderError/);
  assert.match(tv,/function transitionTo/);
});

test("TV keeps movement, assessment lines and group desk rotation contracts",async()=>{
  const tv=await read("next/classroom/tv.js");
  assert.match(tv,/movementItems/);
  assert.match(tv,/activeSceneKey\(\) === "seat-change" \? generalPositions\(true\)/);
  assert.match(tv,/assessment\.lines/);
  assert.match(tv,/rotationArrow/);
  assert.match(tv,/책상 방향/);
  assert.match(tv,/번 책상/);
});

test("TV uses short defaults and migrates only the complete legacy default timing tuple",async()=>{
  const tv=await read("next/classroom/tv.js");
  assert.match(tv,/DEFAULT_TIMING/);
  assert.match(tv,/intro:\s*2\.4/);
  assert.match(tv,/move:\s*1\.5/);
  assert.match(tv,/final:\s*4\.5/);
  assert.match(tv,/idle === 12 && move === 5 && final === 8/);
  assert.match(tv,/POLL_INTERVAL_MS = 15000/);
});

test("TV transitions are fade-only and reduced-motion safe",async()=>{
  const [html,tv,css]=await Promise.all([read("next/classroom/tv.html"),read("next/classroom/tv.js"),read("next/classroom/tv.css")]);
  assert.match(html,/theme-color" content="#f5f5f7"/);
  assert.match(tv,/FADE_OUT_MS = 180/);
  assert.match(tv,/FADE_IN_MS = 200/);
  assert.match(tv,/is-fading-out/);
  assert.match(tv,/is-fading-in/);
  assert.match(css,/transition-property:opacity/);
  assert.doesNotMatch(css,/translate(?:X|Y)?\(|scale(?:X|Y)?\(|blur\(|rotate\(/);
  assert.doesNotMatch(css,/@keyframes/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/--bg:#f5f5f7/);
  assert.doesNotMatch(css,/linear-gradient|radial-gradient|box-shadow/);
});

test("countdown updates in place and polling restarts only for relevant TV changes",async()=>{
  const tv=await read("next/classroom/tv.js");
  assert.match(tv,/querySelector\("\[data-countdown\]"\)/);
  assert.match(tv,/countdown\.textContent = countdownText/);
  assert.match(tv,/function tvSignature/);
  assert.match(tv,/nextSignature !== lastFlowSignature/);
  assert.doesNotMatch(tv,/updatedAtMs\s*!==/);
});

test("main PinCon loads the officer classroom entry",async()=>{
  const [bootstrap,entry]=await Promise.all([read("next/app-bootstrap.js"),read("next/classroom-entry.js")]);
  assert.match(bootstrap,/classroom-entry\.js/);
  assert.match(entry,/CLASS_VICE_PRESIDENT/);
  assert.match(entry,/DEPARTMENT_HEAD/);
  assert.match(entry,/\.\/classroom\//);
});
