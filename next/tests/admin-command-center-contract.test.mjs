import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("admin command center exposes operations navigation, inbox, search and health surfaces", async () => {
  const source = await read("next/admin/admin.js");
  for (const contract of [
    "adminOverview",
    "adminOperationsInbox",
    "adminAuditExplorer",
    "adminSystemHealth",
    "openAdminSearch",
    "adminGlobalSearch",
    "data-admin-action=\"add-user\"",
    "data-admin-action=\"new-announcement\"",
    "/api/class-ops/admin-overview",
  ]) assert.ok(source.includes(contract), `missing admin contract: ${contract}`);
});

test("user manager supports filters, bulk provisioning, export and reactivation without persisting PINs", async () => {
  const source = await read("next/admin/user-manager.js");
  for (const contract of [
    "pinconUserStatusFilter",
    "pinconUserRoleFilter",
    "pinconBulkUsers",
    "pinconExportUsers",
    "pinconEnableUser",
    "parseBulkRows",
    "pinconDownloadPins",
  ]) assert.ok(source.includes(contract), `missing user-management contract: ${contract}`);
  assert.equal(/localStorage[^\n]*(pin|password|temporary)/i.test(source), false, "PIN/password material must not be stored in localStorage");
});

test("admin overview stays behind the existing router function and enforces operator auth", async () => {
  const [router, handler, vercel, bootstrap] = await Promise.all([
    read("integrations/pincon-ai/api/class-ops-router.mjs"),
    read("integrations/pincon-ai/handlers/class-ops/admin-overview.mjs"),
    read("integrations/pincon-ai/vercel.json"),
    read("next/admin/bootstrap.js"),
  ]);
  assert.match(router, /"admin-overview"\s*:\s*adminOverview/);
  assert.match(vercel, /\/api\/class-ops\/admin-overview/);
  assert.match(handler, /requireProfileOrLegacy/);
  assert.match(handler, /isClassOperator/);
  assert.doesNotMatch(handler, /temporaryPin|password\s*:/i);
  assert.match(bootstrap, /admin-shortcuts\.js/);
});
