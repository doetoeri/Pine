import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("SideDesk v3 entrypoint uses participant build", async () => {
  const html = await read("../index.html");
  assert.match(html, /app-v3\.js/);
  assert.match(html, /style-v3\.css/);
  assert.doesNotMatch(html, /src="\.\/app\.js"/);
});

test("participant model replaces the two-seat runtime", async () => {
  const js = await read("../app-v3.js");
  assert.match(js, /participants/);
  assert.match(js, /assignments/);
  assert.match(js, /collection\(db,'sidedeskRooms',roomId,'participants'\)/);
  assert.match(js, /i%2\?'gold':'green'/);
  assert.doesNotMatch(js, /guest:null/);
});

test("timer is timestamp based and protects abnormal records", async () => {
  const js = await read("../app-v3.js");
  assert.match(js, /startedAtMs/);
  assert.match(js, /accumulatedMs/);
  assert.match(js, /breakAccumulatedMs/);
  assert.match(js, /gradingAccumulatedMs/);
  assert.match(js, /REVIEW_ACTIVE_MS=12\*60\*60\*1000/);
  assert.match(js, /MAX_ACTIVE_MS=24\*60\*60\*1000/);
  assert.match(js, /invalidLegacy/);
  assert.doesNotMatch(js, /studySeconds\+\+/);
});

test("study flow uses problem count, grading, break, knock and post-it", async () => {
  const js = await read("../app-v3.js");
  assert.match(js, /data-add="1"/);
  assert.match(js, /data-add="5"/);
  assert.match(js, /data-add="10"/);
  assert.match(js, /toggleGrading/);
  assert.match(js, /toggleBreak/);
  assert.match(js, /sendEvent\('knock'/);
  assert.match(js, /sendEvent\('note'/);
  assert.doesNotMatch(js, />✓ 정답</);
  assert.doesNotMatch(js, />× 오답</);
});

test("Firestore rules isolate participant writes", async () => {
  const rules = await read("../../firestore.rules");
  assert.match(rules, /match \/participants\/\{participantId\}/);
  assert.match(rules, /participantId == request\.auth\.uid/);
  assert.match(rules, /match \/assignments\/\{participantId\}/);
  assert.match(rules, /request\.resource\.data\.team in \['green', 'gold'\]/);
  assert.match(rules, /resource\.data\.version == 3/);
});

test("service worker caches the v3 shell", async () => {
  const sw = await read("../sw.js");
  assert.match(sw, /sidedesk-shell-v7-participants/);
  assert.match(sw, /app-v3\.js/);
  assert.match(sw, /style-v3\.css/);
});
