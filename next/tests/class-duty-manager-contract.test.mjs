import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("rebuilt account creator owns single and roster creation end to end", async () => {
  const [ui, service, bootstrap, html, auth, server] = await Promise.all([
    source("../admin/account-create.js"),
    source("../admin/account-create-service.js"),
    source("../admin/bootstrap.js"),
    source("../admin/index.html"),
    source("../core/student-auth.js"),
    source("../../integrations/pincon-ai/handlers/accounts/manage.mjs"),
  ]);

  assert.match(ui, /pinconAccountCreateDialog/);
  assert.match(ui, /pinconAddUser/);
  assert.match(ui, /pinconBulkUsers/);
  assert.match(ui, /stopImmediatePropagation\(\)/);
  assert.match(ui, /createOneAccount/);
  assert.match(ui, /createRosterAccounts/);
  assert.match(ui, /임시 PIN CSV 저장/);
  assert.match(service, /studentNumberFromParts/);
  assert.match(service, /partsFromStudentNumber/);
  assert.match(service, /parseRoster/);
  assert.match(service, /action:\s*"CREATE"/);
  assert.match(service, /action:\s*"BULK_CREATE"/);
  assert.match(service, /networkRetries:\s*0/);
  assert.match(service, /ACCOUNT_CREATE_LIMIT\s*=\s*60/);
  assert.match(bootstrap, /account-create\.js/);
  assert.doesNotMatch(bootstrap, /bulk-account-create\.js/);
  assert.match(html, /account-create\.css/);
  assert.match(auth, /networkRetries\s*=\s*1/);
  assert.match(auth, /pinconNetworkRetries/);
  assert.match(server, /BULK_ACCOUNT_LIMIT\s*=\s*60/);
  assert.match(server, /BULK_CREATE_CONCURRENCY\s*=\s*4/);
  assert.match(server, /action === "BULK_CREATE"/);
  assert.match(server, /duplicate-student-number-in-request/);
  assert.match(server, /ACCOUNT_BULK_CREATE/);
});

test("class duty console connects role assignment, department membership, and cleaning operations", async () => {
  const ui = await source("../admin/class-duty-manager.js");
  const bootstrap = await source("../admin/bootstrap.js");
  const html = await source("../admin/index.html");

  assert.match(ui, /\/api\/class-ops\/duties/);
  assert.match(ui, /ASSIGN_ONE_PERSON_ROLE/);
  assert.match(ui, /SET_DEPARTMENT_MEMBERS/);
  assert.match(ui, /CLEANING_RECOMMEND/);
  assert.match(ui, /CLEANING_AUTO_ASSIGN/);
  assert.match(ui, /CLEANING_ASSIGN/);
  assert.match(ui, /CLEANING_COMPLETE/);
  assert.match(ui, /CLEANING_CLEAR/);
  assert.match(ui, /이번 달 배정 횟수/);
  assert.match(bootstrap, /class-duty-manager\.js/);
  assert.match(html, /class-duty-manager\.css/);
});

test("class duty API is class-scoped and reuses the existing fairness algorithm", async () => {
  const duties = await source("../../integrations/pincon-ai/handlers/class-ops/duties.mjs");
  const router = await source("../../integrations/pincon-ai/api/class-ops-router.mjs");
  const vercel = await source("../../integrations/pincon-ai/vercel.json");

  assert.match(duties, /requireProfileOrLegacy/);
  assert.match(duties, /isClassOperator/);
  assert.match(duties, /targetClassKey/);
  assert.match(duties, /recommendCleaningCandidate/);
  assert.match(duties, /SET_DEPARTMENT_MEMBERS/);
  assert.match(duties, /ASSIGN_ONE_PERSON_ROLE/);
  assert.match(duties, /CLEANING_AUTO_ASSIGN/);
  assert.match(duties, /appendOpsAudit/);
  assert.match(router, /import duties from "\.\.\/handlers\/class-ops\/duties\.mjs"/);
  assert.match(router, /\bduties\b/);
  assert.match(vercel, /"source": "\/api\/class-ops\/duties"/);
  assert.match(vercel, /route=duties/);
});
