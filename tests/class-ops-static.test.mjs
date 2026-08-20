import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(root, name), "utf8");

test("학급 운영 화면의 모든 정적 작업 버튼에 실행 핸들러가 있다", async () => {
  const source = await read("pincon-class-ops.js");
  const actions = new Set([...source.matchAll(/data-action="([a-z][a-z-]+)"/g)].map((match) => match[1]));
  const handlers = new Set([...source.matchAll(/action === "([a-z][a-z-]+)"/g)].map((match) => match[1]));
  const missing = [...actions].filter((action) => !handlers.has(action));
  assert.deepEqual(missing, []);
});

test("HTML, 매니페스트, 서비스 워커가 학급 운영 모듈을 포함한다", async () => {
  const [html, manifestText, serviceWorker] = await Promise.all([
    read("index.html"),
    read("manifest.webmanifest"),
    read("sw.js"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(html, /pincon-class-ops\.css/);
  assert.match(html, /pincon-class-ops\.js/);
  assert.match(serviceWorker, /pincon-class-ops-core\.js/);
  assert.match(serviceWorker, /pincon-class-ops-data\.js/);
  assert.ok(manifest.shortcuts.some((item) => String(item.url).includes("class-ops=1")));
});

test("서비스 워커의 로컬 프리캐시 파일이 모두 존재한다", async () => {
  const serviceWorker = await read("sw.js");
  const urls = [...serviceWorker.matchAll(/\{url:"([^"]+)"/g)].map((match) => match[1]);
  await Promise.all(urls.map((url) => access(path.join(root, url))));
  assert.ok(urls.length > 30);
});

test("회장 쓰기 권한과 업로드 제한이 서버 규칙에 있다", async () => {
  const [firestoreRules, storageRules] = await Promise.all([read("firestore.rules"), read("storage.rules")]);
  assert.match(firestoreRules, /function classOperator\(/);
  assert.match(firestoreRules, /match \/schools\/\{schoolId\}\/changeLogs/);
  assert.match(firestoreRules, /match \/schools\/\{schoolId\}\/eventResponses/);
  assert.match(firestoreRules, /allow delete: if false;/);
  assert.match(storageRules, /10 \* 1024 \* 1024/);
  assert.match(storageRules, /class-resources/);
  assert.match(storageRules, /class-lost-items/);
});

test("모든 학급 운영 관리 쓰기는 서버의 회장 역할 검사에 연결된다", async () => {
  const [firestoreRules, repository] = await Promise.all([read("firestore.rules"), read("pincon-class-ops-data.js")]);
  const block = (collection) => {
    const start = firestoreRules.indexOf(`match /schools/{schoolId}/${collection}`);
    assert.ok(start >= 0, `${collection} 규칙이 없습니다.`);
    const next = firestoreRules.indexOf("\n    match /schools/", start + 1);
    return firestoreRules.slice(start, next < 0 ? undefined : next);
  };
  for (const collection of [
    "announcements", "classAssignments", "events", "feedback", "supplies",
    "supplyLoans", "lostItems", "resources", "patchNotes", "patchNoteDrafts",
    "classSettings", "changeLogs",
  ]) {
    assert.match(block(collection), /classOperator\(/, `${collection}에 회장 권한 검사가 없습니다.`);
  }
  assert.match(block("polls"), /officialPoll\(\)[\s\S]*classOperator\(/);
  assert.match(repository, /adminWrite\([\s\S]*?this\.requirePresident\(\)/);
});

test("익명 건의와 행사 응답 문서에는 사용자 식별 필드가 없다", async () => {
  const rules = await read("firestore.rules");
  const block = (collection) => {
    const start = rules.indexOf(`match /schools/{schoolId}/${collection}`);
    const next = rules.indexOf("\n    match /schools/", start + 1);
    return rules.slice(start, next < 0 ? undefined : next);
  };
  for (const collection of ["feedback", "eventResponses"]) {
    const source = block(collection);
    assert.doesNotMatch(source, /authorUid|userUid|reporterUid|email/);
  }
  assert.match(block("eventResponses"), /responseId\.matches\('\^\[0-9a-f\]\{40\}\$'\)/);
});
