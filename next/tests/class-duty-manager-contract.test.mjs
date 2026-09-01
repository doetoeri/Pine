import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("bulk account UI submits the whole roster through one BULK_CREATE request", async () => {
  const bulk = await source("../admin/bulk-account-create.js");
  const bootstrap = await source("../admin/bootstrap.js");
  const server = await source("../../integrations/pincon-ai/handlers/accounts/manage.mjs");

  assert.match(bulk, /action:\s*"BULK_CREATE"/);
  assert.match(bulk, /accounts:\s*parsed\.rows/);
  assert.match(bulk, /stopImmediatePropagation\(\)/);
  assert.match(bootstrap, /bulk-account-create\.js/);
  assert.match(server, /BULK_ACCOUNT_LIMIT\s*=\s*60/);
  assert.match(server, /BULK_CREATE_CONCURRENCY\s*=\s*4/);
  assert.match(server, /action === "BULK_CREATE"/);
  assert.match(server, /bulkCreateAccounts\(actor, body\)/);
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
