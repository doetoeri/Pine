const experiment = globalThis.PinConExperiment;
const context = experiment?.context;

function storageKey(ctx) {
  return `pincon-notification-survey-v1:${ctx?.experimentVersion || 0}:${ctx?.period || 0}`;
}

function mountSurveyButton() {
  if (!context
    || context.experimentId !== "notification-frequency"
    || context.phase !== "EXPERIMENT"
    || Number(context.periodDay || 0) < Number(context.periodDays || 4)
    || localStorage.getItem(storageKey(context)) === "1"
    || document.body.dataset.pinconVariant === "next"
  ) return;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:max(96px,calc(env(safe-area-inset-bottom) + 86px));z-index:120";
  host.innerHTML = '<button type="button" style="border:1px solid #c8d5bd;border-radius:999px;background:#f8faf2;color:#355d3a;padding:10px 14px;font:600 12px system-ui;box-shadow:0 8px 24px #31452a1a">알림 피드백 1분</button>';
  document.body.appendChild(host);
  host.querySelector("button")?.addEventListener("click", () => openSurvey(host));
}

function openSurvey(host) {
  const dialog = document.createElement("dialog");
  dialog.style.cssText = "border:0;border-radius:20px;padding:0;max-width:min(520px,92vw);box-shadow:0 20px 70px #0003";
  dialog.innerHTML = `<form method="dialog" style="padding:22px;font:14px system-ui;color:#243326">
    <h2 style="margin:0 0 6px">이번 알림 기간 피드백</h2>
    <p style="margin:0 0 18px;color:#6d7d69">${context.condition} 조건 · Period ${context.period}</p>
    ${[
      ["usefulnessScore","알림이 유용했다."],
      ["annoyanceScore","알림이 너무 많다고 느꼈다."],
      ["increasedUseScore","알림 때문에 PinCon을 더 자주 확인했다."],
      ["continueScore","이 정도의 알림을 계속 받고 싶다."],
    ].map(([name,label])=>`<label style="display:grid;gap:7px;margin:15px 0"><span>${label}</span><input name="${name}" type="range" min="1" max="5" value="3"><small style="color:#7a8875">1 · 전혀 아니다　　5 · 매우 그렇다</small></label>`).join("")}
    <label style="display:grid;gap:7px;margin-top:18px">적절하다고 생각하는 하루 PinCon 알림 수
      <select name="preferredDailyCount" style="padding:9px;border:1px solid #cbd6c2;border-radius:10px;background:white">
        <option>0</option><option>1</option><option selected>2</option><option>3</option><option>4</option><option>5+</option>
      </select>
    </label>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px"><button value="cancel">나중에</button><button value="save">저장</button></div>
  </form>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener("close", async () => {
    if (dialog.returnValue === "save") {
      const fd = new FormData(dialog.querySelector("form"));
      try {
        await experiment.saveNotificationSurvey({
          period: context.period,
          condition: context.condition,
          usefulnessScore: Number(fd.get("usefulnessScore")),
          annoyanceScore: Number(fd.get("annoyanceScore")),
          increasedUseScore: Number(fd.get("increasedUseScore")),
          continueScore: Number(fd.get("continueScore")),
          preferredDailyCount: String(fd.get("preferredDailyCount")),
        });
        localStorage.setItem(storageKey(context), "1");
        host.remove();
      } catch {}
    }
    dialog.remove();
  }, { once: true });
}

mountSurveyButton();
