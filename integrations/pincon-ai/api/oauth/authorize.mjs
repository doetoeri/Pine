import {
  FIREBASE_WEB_CONFIG,
  MCP_RESOURCE,
  normalizeScope,
} from "../../lib/oauth-config.mjs";
import { getOAuthClient, validateOAuthRequest } from "../../lib/oauth-store.mjs";
import { sendHtml } from "../../lib/request.mjs";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function errorPage(message) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PinCon 연결 오류</title><style>body{font-family:system-ui,sans-serif;max-width:620px;margin:64px auto;padding:24px;line-height:1.6}main{border:1px solid #ddd;border-radius:24px;padding:28px}h1{font-size:24px}</style><main><h1>PinCon을 연결할 수 없습니다.</h1><p>${escapeHtml(message)}</p></main></html>`;
}

function options() {
  let html = "";
  for (let grade = 1; grade <= 3; grade += 1) {
    for (let room = 1; room <= 10; room += 1) {
      const value = `${grade}-${room}`;
      html += `<option value="${value}">${grade}학년 ${room}반</option>`;
    }
  }
  return html;
}

function denyRedirect(redirectUri, state) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", "The user cancelled PinCon authorization.");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export default async function oauthAuthorize(req, res) {
  if (req.method !== "GET") return sendHtml(res, 405, errorPage("GET 요청만 지원합니다."));

  try {
    const url = new URL(req.url || "/", "https://pincon.invalid");
    const request = {
      response_type: url.searchParams.get("response_type") || "",
      client_id: url.searchParams.get("client_id") || "",
      redirect_uri: url.searchParams.get("redirect_uri") || "",
      scope: url.searchParams.get("scope") || "pincon:read",
      state: url.searchParams.get("state") || "",
      code_challenge: url.searchParams.get("code_challenge") || "",
      code_challenge_method: url.searchParams.get("code_challenge_method") || "",
      resource: url.searchParams.get("resource") || "",
    };

    if (request.response_type !== "code") throw new Error("Only response_type=code is supported.");
    if (request.resource !== MCP_RESOURCE) throw new Error("The OAuth resource does not match the PinCon MCP server.");
    normalizeScope(request.scope);

    const client = await getOAuthClient(request.client_id);
    validateOAuthRequest({
      client,
      redirectUri: request.redirect_uri,
      resource: request.resource,
      codeChallenge: request.code_challenge,
      codeChallengeMethod: request.code_challenge_method,
    });

    const clientName = escapeHtml(client.clientName || "AI platform");
    const requestJson = jsonForScript(request);
    const firebaseJson = jsonForScript(FIREBASE_WEB_CONFIG);
    const cancelUrl = jsonForScript(denyRedirect(request.redirect_uri, request.state));

    return sendHtml(res, 200, `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>PinCon 연결</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a1b1f;background:#f7f7fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(100%,560px);background:white;border:1px solid #e2e3e9;border-radius:28px;padding:28px;box-shadow:0 16px 50px rgba(20,22,30,.08)}.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}.mark{width:44px;height:44px;border-radius:14px;background:#315fef;color:white;display:grid;place-items:center;font-weight:800}.eyebrow{font-size:13px;color:#646772}.title{font-size:26px;font-weight:760;letter-spacing:-.03em;margin:0}.desc{color:#555966;line-height:1.65}.box{background:#f5f6fa;border-radius:18px;padding:16px;margin:18px 0}.box strong{display:block;margin-bottom:6px}.row{display:flex;gap:10px;flex-wrap:wrap}.button{border:0;border-radius:999px;padding:13px 18px;font:inherit;font-weight:700;cursor:pointer}.primary{background:#315fef;color:white}.secondary{background:#eceef5;color:#24262d}.button:disabled{opacity:.5;cursor:not-allowed}select{width:100%;padding:12px 14px;border-radius:14px;border:1px solid #d5d7df;background:white;font:inherit;margin-top:8px}.account{font-weight:650;word-break:break-all}.status{min-height:24px;color:#a23b36;font-size:14px;margin:10px 0}.fine{font-size:12px;color:#767984;line-height:1.55;margin-top:16px}
</style>
</head>
<body>
<main class="card">
  <div class="brand"><div class="mark">P</div><div><div class="eyebrow">${clientName}에서 사용</div><h1 class="title">PinCon 연결</h1></div></div>
  <p class="desc">PinCon의 시간표, 급식, 과제, 공지와 학교 일정을 AI 플랫폼에서 읽을 수 있도록 연결합니다.</p>
  <div class="box"><strong>요청 권한</strong><div>학교생활 정보 읽기 <code>pincon:read</code></div></div>
  <section id="signedOut">
    <p class="desc">먼저 PinCon에서 사용하는 Google 계정으로 로그인하세요.</p>
    <button id="login" class="button primary">Google로 로그인</button>
  </section>
  <section id="signedIn" hidden>
    <div class="box"><strong>로그인 계정</strong><div id="account" class="account"></div></div>
    <label for="classKey"><strong>내 학년·반</strong></label>
    <select id="classKey"><option value="" selected disabled>학년·반 선택</option>${options()}</select>
    <div class="status" id="status"></div>
    <div class="row">
      <button id="allow" class="button primary">PinCon 연결 허용</button>
      <button id="logout" class="button secondary">다른 계정</button>
    </div>
  </section>
  <div class="row" style="margin-top:18px"><button id="cancel" class="button secondary">취소</button></div>
  <p class="fine">연결 시 선택한 반은 이 OAuth 연결에 저장되며, AI 플랫폼은 해당 반의 읽기 전용 도구만 사용할 수 있습니다. 비밀번호는 PinCon 서버에 전달되지 않습니다.</p>
</main>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseConfig = ${firebaseJson};
const oauthRequest = ${requestJson};
const cancelUrl = ${cancelUrl};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.useDeviceLanguage();
const login = document.querySelector("#login");
const allow = document.querySelector("#allow");
const logout = document.querySelector("#logout");
const cancel = document.querySelector("#cancel");
const signedOut = document.querySelector("#signedOut");
const signedIn = document.querySelector("#signedIn");
const account = document.querySelector("#account");
const classKey = document.querySelector("#classKey");
const status = document.querySelector("#status");

function setBusy(value) {
  login.disabled = value;
  allow.disabled = value;
  logout.disabled = value;
}

login.addEventListener("click", async () => {
  setBusy(true);
  status.textContent = "";
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithRedirect(auth, provider);
  } catch (error) {
    status.textContent = error?.message || "Google 로그인을 시작하지 못했습니다.";
    setBusy(false);
  }
});

logout.addEventListener("click", async () => {
  await signOut(auth);
});

cancel.addEventListener("click", () => location.assign(cancelUrl));

allow.addEventListener("click", async () => {
  status.textContent = "";
  if (!auth.currentUser) return;
  if (!classKey.value) {
    status.textContent = "학년과 반을 선택해 주세요.";
    return;
  }
  setBusy(true);
  try {
    const idToken = await auth.currentUser.getIdToken(true);
    const response = await fetch("/oauth/authorize/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...oauthRequest, idToken, classKey: classKey.value }),
    });
    const data = await response.json();
    if (!response.ok || !data.redirect) throw new Error(data.error_description || "PinCon 연결 승인에 실패했습니다.");
    location.assign(data.redirect);
  } catch (error) {
    status.textContent = error?.message || "PinCon 연결 승인에 실패했습니다.";
    setBusy(false);
  }
});

onAuthStateChanged(auth, (user) => {
  signedOut.hidden = Boolean(user);
  signedIn.hidden = !user;
  account.textContent = user?.email || user?.displayName || "Google 사용자";
  setBusy(false);
});

getRedirectResult(auth).catch((error) => {
  status.textContent = error?.message || "Google 로그인 결과를 확인하지 못했습니다.";
});
</script>
</body>
</html>`);
  } catch (error) {
    return sendHtml(res, 400, errorPage(error?.message || "OAuth 요청이 올바르지 않습니다."));
  }
}
