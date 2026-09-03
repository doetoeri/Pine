import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("student auth uses Firebase email/password without storing PIN locally", async () => {
  const auth = await source("../core/student-auth.js");
  assert.match(auth, /signInWithEmailAndPassword\(authApi\.auth, studentEmail\(number\), secret\)/);
  assert.match(auth, /browserLocalPersistence/);
  assert.match(auth, /browserSessionPersistence/);
  assert.match(auth, /@students\\\.pincon\\\.invalid/);
  assert.doesNotMatch(auth, /localStorage\.(?:setItem|getItem)\([^\n]*(?:pin|password|secret)/i);
});

test("authorized API requests reuse a valid token and only force-refresh after a 401", async () => {
  const auth = await source("../core/student-auth.js");
  assert.match(auth, /const request = async \(forceRefresh = false\)/);
  assert.match(auth, /user\.getIdToken\(forceRefresh\)/);
  assert.match(auth, /let response = await request\(false\)/);
  assert.match(auth, /if \(response\.status === 401\) response = await request\(true\)/);
  assert.doesNotMatch(auth, /const idToken = await user\.getIdToken\(true\)/);
});

test("account API can use the verified Identity v2 alias while main is missing routes", async () => {
  const auth = await source("../core/student-auth.js");
  const config = await source("../../firebase-config.js");
  const studentEntry = await source("../index.html");
  const adminEntry = await source("../admin/index.html");
  const identityV2Alias = /https:\/\/pincon-ai-git-feat-pincon-identity-v2-doeyoungkims-projects\.vercel\.app/;
  const mainAlias = /https:\/\/pincon-ai-git-main-doeyoungkims-projects\.vercel\.app/;

  assert.match(config, identityV2Alias);
  assert.match(config, mainAlias);
  assert.match(config, /PINCON_ACCOUNT_API_FALLBACKS/);
  assert.match(auth, /PINCON_ACCOUNT_API_FALLBACKS/);
  assert.match(auth, /DEFAULT_API_BASE = "https:\/\/pincon-ai-git-main-doeyoungkims-projects\.vercel\.app"/);
  assert.match(auth, /response\.status === 404 && hasFallback/);
  assert.match(auth, /index < API_BASES\.length - 1/);
  assert.doesNotMatch(auth, /response\.status === 5\d\d && hasFallback/);
  assert.match(studentEntry, /firebase-config\.js\?v=20260903-account-fallback1/);
  assert.match(adminEntry, /firebase-config\.js\?v=20260903-account-fallback1/);
  assert.doesNotMatch(auth, /https:\/\/pincon-ai\.vercel\.app/);
  assert.doesNotMatch(auth, /https:\/\/pincon-ai-doeyoungkims-projects\.vercel\.app/);
  assert.doesNotMatch(config, /https:\/\/pincon-ai-doeyoungkims-projects\.vercel\.app/);
  assert.match(auth, /pinconNetworkRetries = 1/);
  assert.match(auth, /attempt <= networkRetries/);
  assert.match(auth, /attempt < networkRetries/);
  assert.match(auth, /await wait\(350\)/);
  assert.match(auth, /networkRetries = 1/);
  assert.match(auth, /account-api-unreachable/);
});

test("PinCon PWA revalidates code assets after a deployment", async () => {
  const worker = await source("../../sw.js");
  const registration = await source("../../registerSW.js");
  assert.match(worker, /PINCON_SW_VERSION = "20260902-account-api2"/);
  assert.match(worker, /new Request\(request, \{ cache: "reload" \}\)/);
  assert.match(worker, /mustRevalidate = \/\\\.\(\?:js\|css\|html\|webmanifest\|json\)\$\/i/);
  assert.match(worker, /networkFirst\(request, "\.\/index\.html", \{ forceReload: true \}\)/);
  assert.match(registration, /\.\/sw\.js\?v=20260902-account-api2/);
  assert.match(registration, /updateViaCache: "none"/);
});

test("account entry keeps login failures generic and validates locally", async () => {
  const gate = await source("../account-gate.js");
  assert.match(gate, /학번 또는 PIN이 맞지 않습니다/);
  assert.match(gate, /\^\\d\{5\}\$/);
  assert.match(gate, /\^\\d\{6,12\}\$/);
  assert.doesNotMatch(gate, /존재하지 않는 학번|PIN이 틀|비밀번호가 틀/);
});

test("first login forces a PIN change without an old PIN lookup path", async () => {
  const gate = await source("../account-gate.js");
  const auth = await source("../core/student-auth.js");
  assert.match(gate, /account\.mustChangePin/);
  assert.match(gate, /보안 설정/);
  assert.match(gate, /changeStudentPin/);
  assert.match(auth, /changeStudentPin/);
  assert.doesNotMatch(`${gate}\n${auth}`, /기존 PIN 확인|currentPin|oldPin/i);
});

test("PIN change reauthenticates after Firebase invalidates the previous credential", async () => {
  const auth = await source("../core/student-auth.js");
  const changeStart = auth.indexOf("export async function changeStudentPin");
  const changeEnd = auth.indexOf("export async function signOutStudent", changeStart);
  const changePin = auth.slice(changeStart, changeEnd);

  assert.match(changePin, /await authorizedFetch\("\/api\/accounts\/change-pin"/);
  assert.match(changePin, /pinSaved = true/);
  assert.match(changePin, /await authApi\.signOut\(authApi\.auth\)/);
  assert.match(changePin, /signInWithEmailAndPassword\(authApi\.auth, email, pin\)/);
  assert.match(changePin, /await authorizedFetch\("\/api\/accounts\/session", \{ method: "GET" \}\)/);
  assert.match(changePin, /PIN은 저장됐지만 로그인 갱신에 실패했습니다/);
  assert.doesNotMatch(changePin, /return studentSession\(\)/);
});

test("first login claims a staged identity with a one-time activation code", async () => {
  const gate = await source("../account-gate.js");
  const auth = await source("../core/student-auth.js");
  const claim = await source("../../integrations/pincon-ai/handlers/accounts/claim.mjs");
  const create = await source("../../integrations/pincon-ai/handlers/accounts/create.mjs");
  assert.match(gate, /첫 로그인 · 활성화 코드 사용/);
  assert.match(gate, /pinconClaimStudentNumber/);
  assert.match(gate, /pinconClaimActivationCode/);
  assert.match(gate, /claimStudentAccount/);
  assert.match(auth, /\/api\/accounts\/claim/);
  assert.match(auth, /activationCode/);
  assert.match(auth, /signInWithCustomToken/);
  assert.match(auth, /mustChangePin !== true/);
  assert.match(create, /activationDigest/);
  assert.doesNotMatch(create, /temporaryPin/);
  assert.match(claim, /verifyActivationCode/);
  assert.match(claim, /activationDigest: ""/);
  assert.doesNotMatch(auth, /localStorage[^\n]*(?:customToken|pin|password|activationCode)/i);
});

test("legacy Google administrators retain a migration login path", async () => {
  const gate = await source("../account-gate.js");
  assert.match(gate, /관리자 Google 계정으로 계속/);
  assert.match(gate, /PINCON_GUEST_AUTH/);
  assert.match(gate, /mode: "legacy"/);
});

test("student account center owns profile security and logout", async () => {
  const center = await source("../account-center.js");
  const bootstrap = await source("../app-bootstrap.js");
  assert.match(center, /PinConAccountCenter/);
  assert.match(center, /changeStudentPin/);
  assert.match(center, /signOutStudent/);
  assert.match(center, /stopImmediatePropagation/);
  assert.match(bootstrap, /account-center\.js/);
  assert.doesNotMatch(center, /localStorage|sessionStorage/);
});

test("application modules boot only after the account gate resolves", async () => {
  const bootstrap = await source("../app-bootstrap.js");
  const html = await source("../index.html");
  const accountReadyIndex = bootstrap.indexOf("await accountReady");
  const routeRecoveryIndex = bootstrap.indexOf('await import("./route-focus-stability.js?v=20260903-route2")');
  const appIndex = bootstrap.indexOf('await import("./app.js?v=20260830-interaction1")');

  assert.ok(accountReadyIndex >= 0);
  assert.ok(routeRecoveryIndex > accountReadyIndex, "route recovery must arm after authentication resolves");
  assert.ok(appIndex > routeRecoveryIndex, "route recovery must arm before the app can render clickable navigation");
  assert.match(bootstrap, /account-gate\.js\?v=20260903-identity2/);
  assert.match(html, /src="\.\/app-bootstrap\.js\?v=20260903-route2"/);
  assert.match(html, /account-center\.css/);
  assert.doesNotMatch(html, /src="\.\/app\.js"/);
});

test("test-only authentication bypass is restricted to localhost", async () => {
  const gate = await source("../account-gate.js");
  assert.match(gate, /\["127\.0\.0\.1", "localhost"\]\.includes\(location\.hostname\)/);
  assert.match(gate, /get\("auth"\) !== "1"/);
});
