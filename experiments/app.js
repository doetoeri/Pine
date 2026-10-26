import { NextDataGateway, readClassProfile, saveClassProfile } from "../next/core/data-gateway.js";
import { getExperimentPlatform } from "../next/experiment/experiment-service.js";
import { isCareerStudy, studyDefaults, validateStudyConfig } from "../next/experiment/notification-study.js";
import { analyzeStudy, anonymousStudyExport, studyCsv, studyReport } from "../next/experiment/study-analysis.js";
import { accountMarkup, adminMarkup, esc, loginMarkup, participantMarkup, planMarkup } from "./view.js";
import { surveyMarkup } from "./survey.js";

const root = document.querySelector("#study-app"), status = document.querySelector("#study-status");
if (!readClassProfile()) saveClassProfile(1, 8);
const gateway = new NextDataGateway();
let platform, bundle = {}, roster = [], admin = false, enabled = true, surveys = [], busy = false, draft = null, newRun = false, notesDirty = false;
let access = {}, loadError = "";
let authSubscribed = false, observedUid = "", authReload = false;
const validTabs = ["design", "members", "delivery", "results", "report"];
let tab = validTabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : "design";
let toastTimer;
const timeout = (promise, ms = 20_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("연결이 지연되고 있어요. 잠시 뒤 다시 확인해 주세요.")), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
function toast(message) {
  clearTimeout(toastTimer); status.textContent = message; status.hidden = false;
  toastTimer = setTimeout(() => { status.hidden = true; }, 9000);
}
function render() {
  if (!platform?.user || platform.user.isAnonymous) root.innerHTML = loginMarkup();
  else if (loadError) root.innerHTML = accountMarkup(platform.user, access) + `<section class="card"><h2>연구 화면을 불러오지 못했어요.</h2><p role="alert">${esc(loadError)}</p><button type="button" data-action="retry">다시 확인</button></section>`;
  else if (admin) root.innerHTML = adminMarkup({ bundle, roster, tab, draft, newRun, busy });
  else root.innerHTML = participantMarkup({ context: platform.notificationContext || {}, enabled, surveys,
    permission: globalThis.Notification?.permission || "unsupported" });
  if (platform?.user && !platform.user.isAnonymous && !loadError) root.insertAdjacentHTML("afterbegin", accountMarkup(platform.user, access));
  root.setAttribute("aria-busy", String(busy));
}
function snapshotDraft() {
  const form = root.querySelector("#study-design");
  if (!form || form.querySelector("fieldset")?.disabled) return draft || bundle.config;
  const fd = new FormData(form);
  return { ...studyDefaults(gateway.snapshot().profile?.classKey || "1-8"), studyKind: fd.get("studyKind"),
    startDate: fd.get("startDate"), baselineDays: Number(fd.get("baselineDays")), periodDays: Number(fd.get("periodDays")),
    targetClassKeys: [...new Set(String(fd.get("targetClassKeys") || "").split(",").map((v) => v.trim()).filter(Boolean))],
    excludedDates: [...new Set(String(fd.get("excludedDates") || "").split(",").map((v) => v.trim()).filter(Boolean))],
    schoolDaysOnly: fd.get("schoolDaysOnly") === "on" };
}
function noteValues() {
  const form = root.querySelector("#study-notes");
  return form ? Object.fromEntries(new FormData(form)) : (bundle.notes || {});
}
const designKey = (value = {}) => JSON.stringify([value.studyKind, value.startDate, value.baselineDays, value.periodDays,
  value.targetClassKeys, value.excludedDates, value.schoolDaysOnly]);
async function load() {
  loadError = "";
  await timeout(gateway.start());
  platform = await timeout(getExperimentPlatform());
  await timeout(platform.start());
  if (!authSubscribed) {
    authSubscribed = true; observedUid = platform.user?.uid || "";
    platform.api.onAuthStateChanged(platform.api.auth, (user) => {
      const uid = user?.uid || "";
      if (uid === observedUid) return;
      observedUid = uid; bundle = {}; roster = []; draft = null; newRun = false; notesDirty = false;
      admin = false; access = {}; loadError = ""; platform.user = user; platform.notificationContext = null;
      if (busy) authReload = true;
      else perform(load);
      render();
    });
  }
  access = await timeout(platform.notificationStudyAccess());
  admin = access.canManage;
  if (platform.user && !platform.user.isAnonymous) {
    if (admin) {
      [bundle, roster] = await timeout(Promise.all([platform.adminReadNotificationStudy(access), platform.adminStudyRoster()]), 45_000);
      bundle.canPauseUi = access.schoolAdmin;
      if (!draft && !isCareerStudy(bundle.config)) draft = studyDefaults(gateway.snapshot().profile?.classKey || "1-8");
    } else {
      [enabled, surveys] = await timeout(Promise.all([platform.notificationExperimentEnabled(), platform.ownNotificationSurveys()]));
    }
  }
  render();
}
async function perform(work) {
  if (busy) return;
  busy = true; root.setAttribute("aria-busy", "true");
  root.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try { await work(); }
  catch (error) { const message = error?.code === "permission-denied" ? "서버에서 연구 관리 권한을 확인하지 못했어요. ‘권한 다시 확인’을 누르거나 관리자 계정으로 변경해 주세요." : error?.message || "요청을 완료하지 못했어요."; if (work === load) loadError = message; toast(message); }
  finally { busy = false; render(); if (authReload) { authReload = false; perform(load); } }
}
function saveFile(name, type, value) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportFile(kind) {
  const exportBundle = { ...bundle, notes: noteValues() }, stem = `PinCon-study-v${bundle.config?.version || 0}`;
  if (kind === "csv") saveFile(`${stem}.csv`, "text/csv;charset=utf-8", studyCsv(analyzeStudy(exportBundle)));
  if (kind === "json") saveFile(`${stem}.json`, "application/json", JSON.stringify(anonymousStudyExport(exportBundle), null, 2));
  if (kind === "report") saveFile(`${stem}-report.md`, "text/markdown;charset=utf-8", studyReport(exportBundle));
}
async function run(action) {
  if (["refresh", "retry"].includes(action)) { if (notesDirty) throw new Error("작성한 탐구 메모를 먼저 저장해 주세요."); await load().catch((error) => { loadError = error.message; throw error; }); return; }
  if (action === "sign-out") {
    if (notesDirty) throw new Error("작성한 탐구 메모를 먼저 저장해 주세요.");
    const { signOutStudent } = await import("../next/core/student-auth.js");
    await signOutStudent(); bundle = {}; roster = []; draft = null; newRun = false; admin = false;
    await gateway.retry(); await load(); return;
  }
  if (action === "google-login") {
    await import("../pincon-guest-auth.js");
    if (notesDirty) throw new Error("작성한 탐구 메모를 먼저 저장해 주세요.");
    await globalThis.PINCON_GUEST_AUTH.signInWithGoogle();
    bundle = {}; roster = []; draft = null; newRun = false;
    await gateway.retry(); await load(); return;
  }
  if (action === "enable-push") {
    if (!globalThis.Notification) throw new Error("이 브라우저에서 알림을 지원하는지 확인해 주세요.");
    await gateway.repository.enableNotifications({ ...gateway.repository.notificationPreferences(), notificationExperiment: true });
    await platform.setNotificationExperimentEnabled(true); enabled = true;
    toast("이 기기의 푸시를 등록했어요. 서버 점검 뒤 관리자 화면에도 반영돼요."); return;
  }
  if (action === "device-test") {
    if (globalThis.Notification?.permission !== "granted") throw new Error("먼저 이 기기의 푸시를 등록하고 알림을 허용해 주세요.");
    const registration = await timeout(navigator.serviceWorker.ready, 5000);
    await registration.showNotification("PinCon · 이 기기 표시 테스트", {
      body: "알림 표시를 확인했어요. 실험 발송 횟수와 결과에는 포함되지 않아요.", tag: "pincon-study-device-test" });
    toast("이 기기에 테스트 알림을 표시했어요. 서버 푸시 수신 확인과는 별도예요."); return;
  }
  if (action === "toggle") { const result = await platform.setNotificationExperimentEnabled(!enabled); enabled = result.enabled; await platform.start(); toast(enabled ? "연구 알림 수신을 다시 허용했어요." : "모든 기기에서 연구 알림 수신을 중지했어요."); return; }
  if (!admin) throw new Error("연구 운영은 대상 학급 관리자 또는 학교 관리자 계정에서 할 수 있어요.");
  if (action === "new-run") { newRun = true; draft = studyDefaults(gateway.snapshot().profile?.classKey || "1-8"); toast("새 설계를 작성해 주세요. 저장하면 새 버전으로 보관돼요."); return; }
  if (action === "pause-ui") { await platform.adminSetExperiment("pincon-next-ui", { status: "PAUSED", publicBetaEnabled: false }); await load(); toast("이전 UI 실험을 일시정지했어요."); return; }
  if (action === "prepare") {
    draft = validateStudyConfig(snapshotDraft());
    if (!isCareerStudy(bundle.config) && bundle.config?.status === "ACTIVE") {
      await platform.adminSetExperiment("notification-frequency", { status: "PAUSED" });
      await platform.adminSetFlag("notification_experiment", { enabled: false, rolloutPercent: 0 });
    }
    const config = await platform.adminPrepareNotificationStudy(draft, roster, bundle.config?.version || 0);
    draft = null; newRun = false; await load(); tab = "members";
    toast(`버전 ${config.version}의 설계와 ${config.participantCount}명 배정을 저장했어요. ‘설계’에서 실험을 시작하세요.`); return;
  }
  if (action === "start") {
    if (draft && designKey(draft) !== designKey(bundle.config)) throw new Error("수정한 설계를 먼저 저장해 주세요.");
    const healthAge = Date.now() - Number(bundle.runtime?.checkedAtMs || 0);
    if (bundle.runtime?.status !== "ok" || healthAge > 75 * 60_000) throw new Error("자동 발송 서버의 최근 정상 점검이 필요해요. ‘발송·반응’에서 새로고침한 뒤 확인해 주세요.");
    await platform.adminSetNotificationStudyState("ACTIVE", bundle.config.version);
    await load(); tab = "delivery"; toast("실험을 시작했어요. 설정된 기간과 시간대에 자동 발송하며 기준선에는 행동 기록만 수집해요."); return;
  }
  if (action === "pause" || action === "complete") {
    if (action === "complete" && !confirm("실험을 종료할까요? 수집한 결과와 메모는 유지돼요.")) return;
    await platform.adminSetNotificationStudyState(action === "pause" ? "PAUSED" : "COMPLETED", bundle.config.version);
    await load(); toast(action === "pause" ? "실험 알림을 일시정지했어요. 재개 시 중단에 걸친 날짜는 제외해요." : "실험을 종료했어요. 결과와 보고서에서 정리할 수 있어요.");
  }
}
root.addEventListener("click", (event) => {
  if (busy) return;
  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    if (tab === "design") draft = snapshotDraft();
    if (tab === "report" && notesDirty) bundle.notes = noteValues();
    tab = tabButton.dataset.tab; history.replaceState(null, "", `#${tab}`); render();
    root.querySelector(`[data-tab="${tab}"]`)?.focus({ preventScroll: true }); return;
  }
  const survey = event.target.closest("[data-survey]");
  if (survey) { const period = Number(survey.dataset.survey); root.querySelector("#survey-form-host").innerHTML = surveyMarkup(period); root.querySelector("#period-survey")?.scrollIntoView({ block: "nearest" }); return; }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (["csv", "json", "report"].includes(action)) { if (admin) exportFile(action); return; }
  if (action === "print") { window.print(); return; }
  perform(() => run(action));
});
root.addEventListener("input", (event) => {
  if (event.target.id === "member-search") {
    const value = event.target.value.toLocaleLowerCase();
    root.querySelectorAll("[data-member]").forEach((row) => { row.hidden = !row.dataset.member.toLocaleLowerCase().includes(value); });
  }
  if (event.target.closest("#study-design")) {
    draft = snapshotDraft();
    try { root.querySelector("#study-plan").innerHTML = planMarkup(validateStudyConfig(draft)); } catch {}
  }
  if (event.target.closest("#study-notes")) { notesDirty = true; bundle.notes = noteValues(); }
});
root.addEventListener("submit", (event) => {
  event.preventDefault(); if (busy) return;
  const form = event.target;
  if (!form.reportValidity()) return;
  if (form.id === "study-login") {
    const fd = new FormData(form); const pin = fd.get("pin"); form.elements.pin.value = "";
    perform(async () => {
      const { signInStudent, signOutStudent } = await import("../next/core/student-auth.js");
      const session = await signInStudent({ studentNumber: fd.get("studentNumber"), pin });
      if (session.account.mustChangePin) { await signOutStudent(); throw new Error("PinCon 계정 화면에서 첫 PIN 설정을 완료해 주세요."); }
      saveClassProfile(session.account.grade, session.account.classNumber); await gateway.retry(); await load();
    });
  } else if (form.id === "study-notes") {
    const values = noteValues();
    perform(async () => { bundle.notes = await platform.adminSaveStudyNotes(values, bundle.config.version); notesDirty = false; toast("이번 버전의 탐구 메모를 저장했어요."); });
  } else if (form.id === "period-survey") {
    const values = Object.fromEntries(new FormData(form)), period = Number(form.dataset.period);
    perform(async () => { await platform.saveNotificationSurvey({ ...values, period,
      condition: platform.notificationContext.sequence[period - 1], experimentVersion: platform.notificationContext.experimentVersion });
      surveys = await platform.ownNotificationSurveys(); toast("기간 설문을 저장했어요."); });
  }
});
window.addEventListener("hashchange", () => { if (validTabs.includes(location.hash.slice(1))) { tab = location.hash.slice(1); render(); } });
window.addEventListener("beforeunload", (event) => { if (notesDirty) { event.preventDefault(); event.returnValue = ""; } });
// Refresh only a read-only monitoring tab; never replace an unsaved form.
setInterval(() => { if (!document.hidden && !busy && admin && ["delivery", "results", "members"].includes(tab) && !notesDirty) perform(load); }, 60_000);
perform(load);
