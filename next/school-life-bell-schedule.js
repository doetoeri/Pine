import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";
import { cleanText, validClock } from "./core/school-life.js";

const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high" };
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();

function profile() {
  return snapshot.profile || readClassProfile();
}

function classSettings() {
  const key = profile()?.classKey || "";
  return (snapshot.data?.classSettings || []).find((item) => item?.id === key || item?.classKey === key) || {};
}

function canManage() {
  const key = profile()?.classKey || "";
  const role = snapshot.role;
  if (!key || !role?.enabled) return false;
  if (role.level === "school") return true;
  return ["class", "grade", "president"].includes(role.level)
    && Array.isArray(role.classKeys)
    && role.classKeys.includes(key);
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "school-life__toast";
  node.textContent = cleanText(message, 160);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

function mount() {
  const host = document.querySelector('#schoolLifeAssistant[data-school-life-route="more"] .school-life__surface');
  if (!host) return;
  let node = document.getElementById("schoolLifeBellSchedule");
  if (!node) {
    node = document.createElement("section");
    node.id = "schoolLifeBellSchedule";
    node.className = "school-life__lesson";
    host.appendChild(node);
  }
  const configured = Object.values(classSettings().periodTimes || {}).filter((item) => validClock(item?.startTime) && validClock(item?.endTime)).length;
  node.innerHTML = `<div class="school-life__lesson-head"><div class="school-life__lesson-title"><div class="school-life__eyebrow">수업 시간</div><strong>교시 시작·종료 시각</strong><div class="school-life__meta">${configured ? `${configured}개 교시 설정됨` : "이동수업 알림 계산에 실제 시작 시각이 필요합니다."}</div></div>${canManage() ? '<button type="button" class="school-life__button" data-bell-edit>설정</button>' : ""}</div>`;
}

function openDialog() {
  if (!canManage()) return;
  document.getElementById("schoolLifeBellDialog")?.remove();
  const times = classSettings().periodTimes || {};
  const rows = Array.from({ length: 10 }, (_, index) => {
    const period = index + 1;
    const item = times[String(period)] || {};
    return `<div class="school-life__setting-row"><label>${period}교시</label><div class="school-life__setting-controls"><input type="time" name="start-${period}" value="${validClock(item.startTime) ? item.startTime : ""}" aria-label="${period}교시 시작"><span>–</span><input type="time" name="end-${period}" value="${validClock(item.endTime) ? item.endTime : ""}" aria-label="${period}교시 종료"></div></div>`;
  }).join("");
  const dialog = document.createElement("dialog");
  dialog.id = "schoolLifeBellDialog";
  dialog.className = "school-life__dialog";
  dialog.innerHTML = `<form class="school-life__dialog-form"><div><p class="school-life__eyebrow">기본 시간표</p><h2>교시 시간 설정</h2><p class="school-life__meta">단축수업은 해당 날짜의 수업 설정에서 별도로 바꿉니다.</p></div><div class="school-life__settings">${rows}</div><div class="school-life__dialog-actions"><button type="button" class="school-life__button" data-bell-cancel>취소</button><button type="submit" class="school-life__button school-life__button--primary">저장</button></div></form>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-bell-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveSchedule(new FormData(event.currentTarget));
      dialog.close();
      toast("교시 시간을 저장했습니다.");
    } catch (error) {
      toast(error?.message || "교시 시간을 저장하지 못했습니다.");
    }
  });
  dialog.showModal();
}

async function saveSchedule(form) {
  if (!canManage()) throw new Error("교시 시간을 수정할 권한이 없습니다.");
  if (!gateway.repository?.api) await gateway.start();
  const api = gateway.repository?.api;
  const user = snapshot.user;
  const p = profile();
  if (!api || !user?.uid || !p?.classKey) throw new Error("데이터 연결을 확인해 주세요.");
  const periodTimes = {};
  let previousEnd = -1;
  for (let period = 1; period <= 10; period += 1) {
    const startTime = cleanText(form.get(`start-${period}`), 5);
    const endTime = cleanText(form.get(`end-${period}`), 5);
    if (!startTime && !endTime) continue;
    if (!validClock(startTime) || !validClock(endTime)) throw new Error(`${period}교시 시각을 모두 입력해 주세요.`);
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end <= start || (previousEnd >= 0 && start < previousEnd)) throw new Error(`${period}교시 시각이 앞 교시와 겹치거나 순서가 잘못됐습니다.`);
    previousEnd = end;
    periodTimes[String(period)] = { startTime, endTime };
  }
  if (!Object.keys(periodTimes).length) throw new Error("최소 한 교시를 설정해 주세요.");
  const current = classSettings();
  const now = Date.now();
  const settingsRef = api.doc(api.db, "schools", SCHOOL.id, "classSettings", p.classKey);
  const logRef = api.doc(api.collection(api.db, "schools", SCHOOL.id, "changeLogs"));
  const batch = api.writeBatch(api.db);
  batch.set(settingsRef, { ...current, classKey: p.classKey, periodTimes, deleted: false, createdAtMs: Number(current.createdAtMs || now), updatedAtMs: now, createdAt: current.createdAt || api.serverTimestamp(), updatedAt: api.serverTimestamp() }, { merge: false });
  batch.set(logRef, { classKey: p.classKey, collection: "classSettings", documentId: p.classKey, action: current.periodTimes ? "update" : "create", label: "교시 시작·종료 시각", before: { periodTimes: current.periodTimes || {} }, after: { periodTimes }, actorUid: user.uid, actorName: cleanText(user.displayName || "학급 운영자", 40), createdAtMs: now, createdAt: api.serverTimestamp() });
  await batch.commit();
}

document.addEventListener("click", (event) => {
  if (event.target.closest?.("[data-bell-edit]")) openDialog();
});

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  requestAnimationFrame(mount);
});
await gateway.start().catch(() => null);
snapshot = gateway.snapshot();
new MutationObserver(() => requestAnimationFrame(mount)).observe(document.documentElement, { childList: true, subtree: true });
mount();
