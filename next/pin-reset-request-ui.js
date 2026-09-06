const configured = String(globalThis.PINCON_ACCOUNT_API_BASE || "").replace(/\/$/, "");
const fallbacks = Array.isArray(globalThis.PINCON_ACCOUNT_API_FALLBACKS)
  ? globalThis.PINCON_ACCOUNT_API_FALLBACKS.map((value) => String(value || "").replace(/\/$/, "")).filter(Boolean)
  : [];
const API_BASES = [...new Set([configured, ...fallbacks].filter(Boolean))];

function enrollmentClientId() {
  const key = "pincon-enrollment-client-v1";
  try {
    let value = localStorage.getItem(key);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return `${navigator.userAgent.slice(0, 40)}-${screen.width}x${screen.height}`;
  }
}

async function requestReset(studentNumber) {
  let lastError = null;
  for (let index = 0; index < API_BASES.length; index += 1) {
    const base = API_BASES[index];
    try {
      const response = await fetch(`${base}/api/accounts/pin-reset-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "request", studentNumber, clientId: enrollmentClientId() }),
      });
      let data = {};
      try { data = await response.json(); } catch {}
      if (response.status === 404 && index < API_BASES.length - 1) continue;
      if (!response.ok) {
        const error = new Error(data?.error || "pin-reset-request-failed");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.status) throw error;
      lastError = error;
    }
  }
  const error = new Error("network-unavailable");
  error.cause = lastError;
  throw error;
}

function statusBox(root) {
  return root?.querySelector?.("[data-account-error]") || null;
}

function show(root, message, isError = false) {
  const box = statusBox(root);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  box.dataset.resetStatus = isError ? "error" : "success";
}

async function handleForgot(event) {
  const trigger = event.composedPath?.().find((node) => node instanceof HTMLElement && node.id === "pinconSimpleForgot");
  if (!trigger) return;
  const gate = trigger.closest(".pincon-account-gate") || document.querySelector(".pincon-account-gate");
  const field = gate?.querySelector("#pinconSimpleStudentNumber");
  const studentNumber = String(field?.value || "").trim();

  event.preventDefault();
  event.stopImmediatePropagation();
  if (!/^\d{5}$/.test(studentNumber)) {
    show(gate, "먼저 내 학번 5자리를 입력해주세요.", true);
    field?.focus?.();
    return;
  }

  trigger.disabled = true;
  show(gate, "PIN 초기화 요청을 전달하는 중…");
  try {
    await requestReset(studentNumber);
    show(gate, "PIN 초기화 요청을 관리자에게 전달했습니다. 승인되면 관리자에게 새 개통 링크를 받아 PIN을 다시 설정할 수 있습니다.");
  } catch (error) {
    const message = error?.message === "too-many-attempts"
      ? "요청이 너무 많습니다. 잠시 뒤 다시 시도해주세요."
      : "인터넷 연결을 확인한 뒤 다시 시도해주세요.";
    show(gate, message, true);
  } finally {
    trigger.disabled = false;
  }
}

document.addEventListener("click", handleForgot, true);
