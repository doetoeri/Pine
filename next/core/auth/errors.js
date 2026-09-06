export function loginError(error, { activation = false, online = globalThis.navigator?.onLine !== false } = {}) {
  const code = String(error?.code || error?.message || "").toLowerCase();
  let kind = "firebase";
  if (!online || /network-request-failed|network-error|networkerror/.test(code)) kind = "network";
  else if (/timeout|aborterror|timed-out/.test(code) || error?.name === "AbortError") kind = "timeout";
  else if (error?.status === 429 || /too-many|rate-limit|rate_limit/.test(code)) kind = "rate-limit";
  else if (/disabled|inactive|suspended/.test(code)) kind = "disabled";
  else if (/user-not-found|account-not-found|account_not_found/.test(code)) kind = "missing";
  else if (error?.status >= 500 || /account-api|request-failed|failed to fetch|failed to load|importing a module/.test(code)) kind = "server";
  else if (/activation|claim|invalid-code/.test(code) || (activation && error?.status === 401)) kind = "activation";
  else if (error?.status === 401 || /invalid-credential|wrong-password|invalid-login|invalid-account|invalid.*pin/.test(code)) kind = "credentials";
  const messages = {
    credentials: "학번 또는 PIN이 맞지 않습니다.", activation: "활성화 코드가 맞지 않거나 만료되었습니다. 새 코드를 확인해주세요.",
    missing: "등록된 계정이 없습니다. 관리자에게 계정 등록을 요청해주세요.", disabled: "사용이 중지된 계정입니다. 관리자에게 문의해주세요.",
    network: "인터넷 연결을 확인해주세요.", firebase: "로그인 연결에 문제가 생겼습니다. 잠시 후 다시 시도해주세요.",
    server: "계정 서버에 연결할 수 없습니다. 학교 정보는 임시 모드로 확인할 수 있습니다.",
    "rate-limit": "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.", timeout: "서버 응답이 늦어지고 있습니다. 학교 정보는 임시 모드로 확인할 수 있습니다.",
  };
  return { kind, message: messages[kind], unavailable: ["network", "firebase", "server", "timeout"].includes(kind) };
}
export function withTimeout(promise, ms = 8000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("server-timeout"), { code: "server-timeout" })), ms);
  })]).finally(() => clearTimeout(timer));
}
