import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../pincon-class-ops-data.js", import.meta.url), "utf8");

test("local webdriver E2E never connects to the live Firestore project by default", () => {
  assert.match(source, /navigator\?\.webdriver === true/);
  assert.match(source, /\["127\.0\.0\.1", "localhost"\]\.includes\(hostname\)/);
  assert.match(source, /get\("liveFirebase"\) !== "1"/);
  const guard = source.indexOf("if (localAutomationMode())");
  const firebase = source.indexOf("this.api = await firebaseApi()", guard);
  assert.ok(guard >= 0 && firebase > guard, "E2E guard must return before firebaseApi is called");
  assert.match(source, /collectionStatus\[name\] === "idle"\) this\.state\.collectionStatus\[name\] = "error"/);
  assert.match(source, /테스트 환경에서는 운영 Firestore 연결을 사용하지 않습니다/);
  assert.doesNotMatch(source.slice(guard, firebase), /collectionStatus\[name\].*= "success"/);
});
