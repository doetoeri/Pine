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

test("account directory supports identity v2 provisioning, security reset and export", async () => {
  const [directory, creator, security] = await Promise.all([
    read("next/admin/user-manager.js"),
    read("next/admin/account-create-v2.js"),
    read("next/admin/account-security-v2.js"),
  ]);
  for (const contract of [
    "pinconUserStatusFilter",
    "pinconUserRoleFilter",
    "pinconAttentionFilter",
    "pinconExportUsers",
    "openAccountDialog",
    "DISABLE",
    "status: \"ACTIVE\"",
  ]) assert.ok(directory.includes(contract), `missing account-directory contract: ${contract}`);
  for (const contract of [
    "pinconAddUser",
    "pinconBulkUsers",
    "activationCode",
    "활성화 코드 CSV 저장",
  ]) assert.ok(creator.includes(contract), `missing identity-v2 creator contract: ${contract}`);
  for (const contract of [
    "accountResetPin",
    "pinconDeleteNonAdmins",
    "/api/accounts/reset",
    "RESET_NON_ADMIN_ACCOUNTS",
    "활성화 코드 재발급",
    "학생 로그인 초기화",
  ]) assert.ok(security.includes(contract), `missing identity-v2 security contract: ${contract}`);
  assert.equal(/localStorage[^\n]*(pin|password|temporary|activation)/i.test(`${directory}\n${creator}\n${security}`), false, "credential material must not be stored in localStorage");
});

test("identity v2 reset preserves student data and requires one-time reactivation", async () => {
  const [reset, claim, activation, security, router, vercel] = await Promise.all([
    read("integrations/pincon-ai/handlers/accounts/reset.mjs"),
    read("integrations/pincon-ai/handlers/accounts/claim.mjs"),
    read("integrations/pincon-ai/lib/account-activation.mjs"),
    read("next/admin/account-security-v2.js"),
    read("integrations/pincon-ai/api/class-ops-router.mjs"),
    read("integrations/pincon-ai/vercel.json"),
  ]);
  assert.match(reset, /PRIVILEGED_ROLES/);
  assert.match(reset, /ROLE\.ADMIN, ROLE\.TEACHER, ROLE\.CLASS_PRESIDENT/);
  assert.match(reset, /profile\.uid !== actor\.uid/);
  assert.match(reset, /where\("classKey", "==", actor\.classKey\)/);
  assert.match(reset, /body\.confirmation !== RESET_CONFIRMATION/);
  assert.match(reset, /firebaseAuth\(\)\.updateUser\(before\.uid, \{ disabled: true \}\)/);
  assert.match(reset, /revokeRefreshTokens\(before\.uid\)/);
  assert.match(reset, /existingUid: before\.uid/);
  assert.match(reset, /activationDigest: activation\.digest/);
  assert.match(reset, /claimStatus: "READY"/);
  assert.doesNotMatch(reset, /deleteUser|temporaryPin|generateTemporaryPin/);
  assert.match(activation, /scryptSync/);
  assert.match(activation, /timingSafeEqual/);
  assert.match(claim, /verifyActivationCode/);
  assert.match(claim, /claimStatus: "CLAIMED"/);
  assert.match(claim, /activationDigest: ""/);
  assert.match(claim, /createCustomToken/);
  assert.match(claim, /mustChangePin: true/);
  assert.match(security, /학생 데이터는 유지됐고 기존 로그인 정보만 무효화되었습니다/);
  assert.match(router, /"account-reset": accountReset/);
  assert.match(vercel, /\/api\/accounts\/reset/);
  assert.doesNotMatch(claim, /requireProfile|temporaryPin/);
});

test("user and access management are one canonical RBAC surface", async () => {
  const [bootstrap, navFix, index, users] = await Promise.all([
    read("next/admin/bootstrap.js"),
    read("next/admin/admin-user-access-v2.js"),
    read("next/admin/index.html"),
    read("next/admin/user-manager.js"),
  ]);
  assert.doesNotMatch(bootstrap, /import\("\.\/role-manager\.js"\)/, "legacy UID role manager must not boot");
  assert.match(bootstrap, /admin-user-access-v2\.js/);
  assert.match(bootstrap, /account-create-v2\.js/);
  assert.match(bootstrap, /account-security-v2\.js/);
  assert.doesNotMatch(index, /role-manager\.css/, "legacy role-manager stylesheet must not load");
  assert.match(navFix, /data-admin-target=\"access\"/);
  assert.match(navFix, /사용자·권한/);
  assert.match(navFix, /observe\(root, \{ childList: true \}\)/);
  assert.doesNotMatch(navFix, /subtree\s*:\s*true/);
  for (const role of ["DEPARTMENT_HEAD", "SUBJECT_MANAGER", "CLASS_PRESIDENT", "TEACHER", "ADMIN"]) {
    assert.ok(users.includes(role), `canonical account directory must retain role ${role}`);
  }
});

test("account directory models identity, affiliation, permissions and security separately", async () => {
  const [users, styles] = await Promise.all([
    read("next/admin/user-manager.js"),
    read("next/admin/user-manager.css"),
  ]);
  for (const contract of ["신원과 소속", "권한", "로그인과 보안", "계정 일괄 등록", "첫 로그인 대기"]) {
    assert.ok(users.includes(contract), `missing account information architecture: ${contract}`);
  }
  assert.match(styles, /pincon-account-directory__hero/);
  assert.match(styles, /pincon-account-editor__section/);
  assert.match(styles, /@media \(max-width: 640px\)/);
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

test("admin operations mounting cannot create a subtree mutation rerender loop", async () => {
  const [bootstrap, settings, extras, users] = await Promise.all([
    read("next/admin/bootstrap.js"),
    read("next/admin/class-ops-settings-v2.js"),
    read("next/admin/admin-extras.css"),
    read("next/admin/user-manager.js"),
  ]);
  assert.match(bootstrap, /class-ops-settings-v2\.js/);
  assert.doesNotMatch(bootstrap, /import\("\.\/class-ops-settings\.js"\)/);
  assert.match(settings, /observe\(root, \{ childList: true \}\)/);
  assert.doesNotMatch(settings, /subtree\s*:\s*true/);
  assert.match(users, /observe\(root, \{ childList: true \}\)/);
  assert.doesNotMatch(users, /subtree\s*:\s*true/);
  assert.match(extras, /backdrop-filter:\s*none\s*!important/);
});

test("live admin refreshes preserve the management module DOM", async () => {
  const [bootstrap, stableRender] = await Promise.all([
    read("next/admin/bootstrap.js"),
    read("next/admin/admin-stable-render.js"),
  ]);
  const stableIndex = bootstrap.indexOf('import("./admin-stable-render.js")');
  const adminIndex = bootstrap.indexOf('import("./admin.js")');
  assert.ok(stableIndex >= 0 && adminIndex > stableIndex, "stable render guard must load before admin.js");
  assert.match(stableRender, /#adminModuleGrid/);
  assert.match(stableRender, /Object\.defineProperty\(root, "innerHTML"/);
  assert.match(stableRender, /if \(patchDashboardMarkup\(value\)\) return/);
  assert.doesNotMatch(stableRender, /moduleGrid\.(?:remove|replaceWith)|currentMain\.replaceWith|root\.replaceChildren/);
});
