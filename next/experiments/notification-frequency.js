const experiment = globalThis.PinConExperiment;
const context = experiment?.context;

const EXPERIMENT_ID = "notification-frequency";
const PENDING_RESPONSE_KEY = "pincon-notification-response-pending-v1";
const LAST_CONTEXT_KEY = "pincon-notification-experiment-last-context-v2";
const RESPONSE_MAX_AGE_MS = 72 * 60 * 60_000;

function json(value) {
  try { return JSON.parse(value || "null"); } catch { return null; }
}

function surveyStorageKey(ctx) {
  return `pincon-notification-survey-v2:${ctx?.experimentVersion || 0}:${ctx?.period || 0}`;
}

function responseStorageKey(notificationId) {
  return `pincon-notification-response-v1:${String(notificationId || "")}`;
}

function readPendingResponse() {
  const pending = json(sessionStorage.getItem(PENDING_RESPONSE_KEY))
    || json(localStorage.getItem(PENDING_RESPONSE_KEY));
  if (!pending || pending.experimentId !== EXPERIMENT_ID || !pending.notificationId) return null;
  const openedAtMs = Number(pending.openedAtMs || 0);
  if (openedAtMs && Date.now() - openedAtMs > RESPONSE_MAX_AGE_MS) {
    clearPendingResponse();
    return null;
  }
  if (localStorage.getItem(responseStorageKey(pending.notificationId)) === "1") {
    clearPendingResponse();
    return null;
  }
  return pending;
}

function clearPendingResponse() {
  try {
    sessionStorage.removeItem(PENDING_RESPONSE_KEY);
    localStorage.removeItem(PENDING_RESPONSE_KEY);
  } catch {}
}

function snapshotContext(ctx) {
  if (!ctx || ctx.experimentId !== EXPERIMENT_ID) return null;
  return {
    experimentId: EXPERIMENT_ID,
    experimentVersion: Number(ctx.experimentVersion || 0),
    phase: String(ctx.phase || ""),
    period: Number(ctx.period || 0),
    periodDay: Number(ctx.periodDay || 0),
    periodDays: Number(ctx.periodDays || 4),
    condition: String(ctx.condition || ""),
    seenAtMs: Date.now(),
  };
}

function readPreviousContext() {
  return json(localStorage.getItem(LAST_CONTEXT_KEY));
}

function saveCurrentContext() {
  const snapshot = snapshotContext(context);
  if (!snapshot) return;
  try { localStorage.setItem(LAST_CONTEXT_KEY, JSON.stringify(snapshot)); } catch {}
}

function injectStyles() {
  if (document.querySelector("#pincon-notification-experiment-style")) return;
  const style = document.createElement("style");
  style.id = "pincon-notification-experiment-style";
  style.textContent = `
    .pincon-exp-dialog{border:0;padding:0;background:transparent;max-width:min(520px,calc(100% - 24px));width:100%;color:var(--pc-text,#182014)}
    .pincon-exp-dialog::backdrop{background:rgb(14 22 12/.42);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
    .pincon-exp-card{margin:0;padding:24px;border:1px solid color-mix(in srgb,var(--pc-line,#d8e1d3) 88%,transparent);border-radius:24px;background:var(--pc-surface,#fff);box-shadow:0 24px 70px rgb(12 20 10/.18);font:14px/1.55 "Noto Sans KR",system-ui,sans-serif}
    .pincon-exp-kicker{margin:0 0 6px;color:var(--pc-primary-ink,#236f0e);font-size:12px;font-weight:700;letter-spacing:.02em}
    .pincon-exp-title{margin:0;font-size:23px;line-height:1.25;letter-spacing:-.035em}
    .pincon-exp-copy{margin:8px 0 0;color:var(--pc-muted,#586452);font-size:13px}
    .pincon-exp-options{display:grid;gap:8px;margin-top:20px}
    .pincon-exp-choice{width:100%;min-height:48px;padding:10px 14px;border:1px solid var(--pc-line,#d8e1d3);border-radius:15px;background:color-mix(in srgb,var(--pc-surface,#fff) 92%,var(--pc-bg,#f2f5ef));color:inherit;font:600 14px/1.3 inherit;text-align:left;cursor:pointer}
    .pincon-exp-choice:hover,.pincon-exp-choice:focus-visible{border-color:color-mix(in srgb,var(--pc-primary,#2daa00) 48%,var(--pc-line,#d8e1d3));outline:2px solid color-mix(in srgb,var(--pc-primary,#2daa00) 16%,transparent);outline-offset:2px}
    .pincon-exp-choice:disabled{opacity:.58;cursor:wait}
    .pincon-exp-question{display:grid;gap:9px;margin:18px 0 0;padding:0;border:0}
    .pincon-exp-question legend{padding:0;font-weight:650;line-height:1.45}
    .pincon-exp-scale{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
    .pincon-exp-scale label{display:grid;place-items:center;gap:5px;min-width:0;padding:8px 2px;border:1px solid var(--pc-line,#d8e1d3);border-radius:12px;background:color-mix(in srgb,var(--pc-surface,#fff) 94%,var(--pc-bg,#f2f5ef));font-size:11px;cursor:pointer}
    .pincon-exp-scale input{margin:0;accent-color:var(--pc-primary,#2daa00)}
    .pincon-exp-select{width:100%;min-height:46px;margin-top:8px;padding:0 12px;border:1px solid var(--pc-line,#d8e1d3);border-radius:13px;background:var(--pc-surface,#fff);color:inherit;font:inherit}
    .pincon-exp-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:22px}
    .pincon-exp-submit{min-height:46px;padding:0 17px;border:0;border-radius:14px;background:var(--pc-primary,#2daa00);color:#fff;font:700 14px/1 inherit;cursor:pointer}
    .pincon-exp-submit:disabled{opacity:.58;cursor:wait}
    .pincon-exp-status{min-height:20px;margin:10px 0 0;color:var(--pc-muted,#586452);font-size:12px}
    @media(max-width:420px){.pincon-exp-card{padding:20px 16px;border-radius:21px}.pincon-exp-title{font-size:21px}.pincon-exp-scale{gap:4px}.pincon-exp-scale label{font-size:10px}}
  `;
  document.head.appendChild(style);
}

function modalBase({ kicker, title, copy }) {
  const dialog = document.createElement("dialog");
  dialog.className = "pincon-exp-dialog";
  dialog.setAttribute("aria-labelledby", "pincon-exp-title");
  dialog.innerHTML = `<section class="pincon-exp-card">
    <p class="pincon-exp-kicker">${kicker}</p>
    <h2 class="pincon-exp-title" id="pincon-exp-title">${title}</h2>
    <p class="pincon-exp-copy">${copy}</p>
    <div data-exp-body></div>
  </section>`;
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

function requireNotificationResponse() {
  const pending = readPendingResponse();
  if (!pending || !context || context.experimentId !== EXPERIMENT_ID) return Promise.resolve();

  return new Promise((resolve) => {
    const dialog = modalBase({
      kicker: `알림 실험 · ${pending.condition || context.condition || ""}`,
      title: "방금 알림은 어땠나요?",
      copy: "알림을 연 경우에는 한 번의 Response가 필요합니다. 응답은 실험용 익명 ID와 함께 기록됩니다.",
    });
    const body = dialog.querySelector("[data-exp-body]");
    body.innerHTML = `<div class="pincon-exp-options" role="group" aria-label="알림 반응">
      <button class="pincon-exp-choice" type="button" data-response="useful">필요했어요 · 이 알림이 도움이 됐어요</button>
      <button class="pincon-exp-choice" type="button" data-response="neutral">보통이에요 · 있어도 없어도 괜찮아요</button>
      <button class="pincon-exp-choice" type="button" data-response="unnecessary">불필요했어요 · 알림이 없어도 됐어요</button>
    </div>
    <p class="pincon-exp-status" data-exp-status aria-live="polite"></p>`;

    body.querySelectorAll("[data-response]").forEach((button) => {
      button.addEventListener("click", async () => {
        const value = String(button.dataset.response || "neutral");
        const status = body.querySelector("[data-exp-status]");
        body.querySelectorAll("button").forEach((item) => { item.disabled = true; });
        status.textContent = "Response 저장 중…";
        try {
          experiment.log("notification_click", {
            notificationId: pending.notificationId,
            condition: pending.condition || context.condition || "",
            period: Number(pending.period || context.period || 0),
            category: pending.category || "",
            route: pending.targetRoute || "",
            value: `response:${value}`,
            source: "required_response",
          });
          await experiment.flush();
          localStorage.setItem(responseStorageKey(pending.notificationId), "1");
          clearPendingResponse();
          dialog.close();
          dialog.remove();
          resolve();
        } catch {
          status.textContent = "저장하지 못했습니다. 연결을 확인하고 다시 선택해 주세요.";
          body.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        }
      });
    });
  });
}

function dueSurveyContext() {
  if (!context || context.experimentId !== EXPERIMENT_ID) return null;
  const previous = readPreviousContext();
  const current = snapshotContext(context);

  if (previous?.experimentId === EXPERIMENT_ID
    && previous.phase === "EXPERIMENT"
    && previous.period >= 1 && previous.period <= 3
    && localStorage.getItem(surveyStorageKey(previous)) !== "1"
    && (current?.phase !== "EXPERIMENT" || current?.period !== previous.period)) {
    return previous;
  }

  if (current?.phase === "EXPERIMENT"
    && current.period >= 1 && current.period <= 3
    && current.periodDay >= current.periodDays
    && localStorage.getItem(surveyStorageKey(current)) !== "1") {
    return current;
  }

  return null;
}

function likert(name, label) {
  return `<fieldset class="pincon-exp-question" required>
    <legend>${label}</legend>
    <div class="pincon-exp-scale">
      ${[1,2,3,4,5].map((value) => `<label><input type="radio" name="${name}" value="${value}" required><span>${value}</span></label>`).join("")}
    </div>
  </fieldset>`;
}

function requirePeriodSurvey(surveyContext) {
  if (!surveyContext) return Promise.resolve();

  return new Promise((resolve) => {
    const dialog = modalBase({
      kicker: `Period ${surveyContext.period} · ${surveyContext.condition}`,
      title: "이번 알림 기간을 평가해 주세요",
      copy: "탐구 계획의 비교를 위해 4개 문항과 적정 알림 수에 모두 Response해야 다음 단계로 넘어갑니다. 1은 ‘전혀 아니다’, 5는 ‘매우 그렇다’입니다.",
    });
    const body = dialog.querySelector("[data-exp-body]");
    body.innerHTML = `<form data-exp-survey>
      ${likert("usefulnessScore", "1. 알림이 유용했다.")}
      ${likert("annoyanceScore", "2. 알림이 너무 많다고 느꼈다.")}
      ${likert("increasedUseScore", "3. 알림 때문에 PinCon을 더 자주 확인했다.")}
      ${likert("continueScore", "4. 이 정도의 알림을 계속 받고 싶다.")}
      <label class="pincon-exp-question">적절하다고 생각하는 하루 PinCon 알림 수
        <select class="pincon-exp-select" name="preferredDailyCount" required>
          <option value="" selected disabled>선택해 주세요</option>
          <option value="0">0개</option><option value="1">1개</option><option value="2">2개</option>
          <option value="3">3개</option><option value="4">4개</option><option value="5+">5개 이상</option>
        </select>
      </label>
      <div class="pincon-exp-actions"><button class="pincon-exp-submit" type="submit">Response 제출</button></div>
      <p class="pincon-exp-status" data-exp-status aria-live="polite"></p>
    </form>`;

    const form = body.querySelector("[data-exp-survey]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const status = form.querySelector("[data-exp-status]");
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      status.textContent = "Response 저장 중…";
      const fd = new FormData(form);
      try {
        await experiment.saveNotificationSurvey({
          period: surveyContext.period,
          condition: surveyContext.condition,
          usefulnessScore: Number(fd.get("usefulnessScore")),
          annoyanceScore: Number(fd.get("annoyanceScore")),
          increasedUseScore: Number(fd.get("increasedUseScore")),
          continueScore: Number(fd.get("continueScore")),
          preferredDailyCount: String(fd.get("preferredDailyCount")),
        });
        localStorage.setItem(surveyStorageKey(surveyContext), "1");
        dialog.close();
        dialog.remove();
        resolve();
      } catch {
        status.textContent = "저장하지 못했습니다. 연결을 확인하고 다시 제출해 주세요.";
        submit.disabled = false;
      }
    });
  });
}

async function mountExperimentResponses() {
  if (!experiment || !context || context.experimentId !== EXPERIMENT_ID) return;
  injectStyles();
  const surveyContext = dueSurveyContext();
  await requireNotificationResponse();
  await requirePeriodSurvey(surveyContext);
  saveCurrentContext();
}

mountExperimentResponses();
