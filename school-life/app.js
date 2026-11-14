import { NextDataGateway, readClassProfile, saveClassProfile } from "../next/core/data-gateway.js";
import { patchPage } from "../next/core/region-renderer.js";
import { coverListEnabled, mountCoverflow, paperCoverflowMarkup } from "../next/assessments/coverflow.js?v=20261115-accessibility";
import { closeDialog, openDialog, prepareDialog } from "../next/assessments/dialog-motion.js?v=20261115-accessibility";
import { mountAccessibilitySettings } from "../accessibility/settings.js?v=20261115-accessibility";
import { calendarDate } from "../new/calendar.js?v=20261013-grid1";
import { kstDate } from "../pincon-class-ops-core.js";
import { schoolWeek } from "./model.js?v=20261114-school-life";
import { heading, pages, schoolPapers, updateStageDate, weekNav } from "./covers.js?v=20261115-coverflow";

const main = document.querySelector("#main");
const classButton = document.querySelector("#class-select");
const classDialog = document.querySelector("#class-dialog");
const classForm = document.querySelector("#class-form");
const detailDialog = document.querySelector("#school-detail");
const detailTitle = detailDialog.querySelector("h2");
const detailBody = detailDialog.querySelector(".dialog-body");
const maxReadAge = 5 * 60 * 1000;

if (!readClassProfile()) saveClassProfile(1, 8);
const gateway = new NextDataGateway();
const weekReads = new Map();
let current, collection;
let changingClass = false;
let pendingRetry = false;
let syncingSelection = false;
let detail = null;
let detailMarkup = "";

prepareDialog(classDialog);
prepareDialog(detailDialog);
mountAccessibilitySettings();

function pageFromUrl() {
  const [name, date, item] = location.hash.slice(1).split("/");
  const page = Object.hasOwn(pages, name) ? name : "home";
  const weekly = ["meals", "timetable", "schedule"].includes(page);
  return { page, weekly, date: weekly && calendarDate(date) || kstDate(), undated: page === "schedule" && item === "undated" };
}

function weekQuery(snapshot, page, date, today) {
  const key = snapshot.profile?.classKey;
  if (!key || page === "notices") return null;
  const names = {
    home: ["meals", "neisTimetables"], meals: ["meals"], timetable: ["neisTimetables"], schedule: ["academicSchedules"],
  }[page];
  const days = page === "home" ? [today] : schoolWeek(date);
  return { key, names, from: days[0], through: days.at(-1), id: `${key}/${days[0]}/${days.at(-1)}/${names.join("+")}` };
}

function getWeek(snapshot, query) {
  if (!query || !gateway.repository?.api || !snapshot.ready || !snapshot.online || changingClass) return {};
  return Object.fromEntries(query.names.map(name => {
    const id = `${query.id}/${name}`;
    const existing = weekReads.get(id);
    if (existing && (existing.status === "loading" || Date.now() - existing.time < maxReadAge)) return [name, existing];
    const result = { status: "loading", time: Date.now(), rows: [] };
    weekReads.set(id, result);
    if (weekReads.size > 20) weekReads.delete(weekReads.keys().next().value);
    let timeout;
    const timed = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("학교 정보 연결이 지연됐어요.")), 8_000);
    });
    Promise.race([gateway.repository.readSchoolDates(name, query), timed])
      .then(rows => { result.rows = rows; result.status = "success"; })
      .catch(() => { result.status = "error"; })
      .finally(() => { clearTimeout(timeout); result.time = Date.now(); render(); });
    return [name, result];
  }));
}

function updatedData(snapshot, query, results) {
  const data = { ...snapshot.data };
  for (const [name, result] of Object.entries(results)) {
    if (result.status !== "success") continue;
    const newer = snapshot.collectionStatus?.[name] === "success" ? (data[name] || []) : [];
    const byId = new Map(result.rows.map(row => [row.id, row]));
    // The shared listener may have a record that changed after the week was read.
    for (const row of newer) {
      if (row.date >= query.from && row.date <= query.through) byId.set(row.id, row);
    }
    data[name] = [...byId.values()];
  }
  return data;
}


function openPaperContent(paper, trigger, kind = "cover") {
  if (!paper || detailDialog.open && detailDialog.dataset.dialogMotion !== "closing") return;
  detail = { id: paper.id, kind, trigger };
  updateDetail(paper);
  openDialog(detailDialog, trigger);
  detailTitle.focus({ preventScroll: true });
}

function updateDetail(paper) {
  detailTitle.textContent = paper.title;
  const next = paper.body + (paper.retry ? '<button class="chip" type="button" data-retry>다시 시도</button>' : "");
  if (next === detailMarkup) return;
  const focused = detailBody.contains(document.activeElement);
  detailMarkup = next;
  detailBody.innerHTML = next;
  if (focused) (detailBody.querySelector("[data-retry]") || detailTitle).focus({ preventScroll: true });
}

function openCover(id, trigger) {
  if (current.page === "home" && id !== "today") {
    if (id === "assessment") window.location.assign("./new/");
    else navigate("#" + id);
    return;
  }
  selectDate(id);
  openPaperContent(collection.covers.find(paper => paper.id === id), trigger);
}

function selectDate(id) {
  if (syncingSelection || !current.weekly) return;
  const selectedDate = calendarDate(id);
  const date = selectedDate || current.date;
  const path = `${current.page}/${date}${selectedDate ? "" : "/undated"}`;
  if (current.date !== date || current.undated !== !selectedDate) history.replaceState(history.state, "", `#${path}`);
  current = { ...current, date, undated: !selectedDate };
  updateStageDate(main, date, current.undated);
  for (const item of main.querySelectorAll(".pc-list-flow .pc-cover")) {
    if (selectedDate && item.dataset.coverId === selectedDate) item.setAttribute("aria-current", "date");
    else item.removeAttribute("aria-current");
  }
}

function activeWeekControls(page, overview) {
  if (!overview) return "";
  return `<footer class="flow-tools" data-render-key="flow-tools">
    <button class="chip" type="button" data-overview>${overview.title}</button>
    ${page === "schedule" && gateway.snapshot().canArchiveContent && !changingClass
      ? '<a class="paper-link" href="./next/admin/?content=events#content-center">학급 일정 관리</a>' : ""}
  </footer>`;
}

function render() {
  const route = pageFromUrl();
  const { page, date, weekly, undated } = route;
  const now = Date.now(), today = kstDate(now);
  const base = gateway.snapshot();
  const snapshot = changingClass ? { ...base, data: {}, ready: false, error: "", collectionStatus: {}, canArchiveContent: false } : base;
  const query = weekQuery(snapshot, page, date, today);
  const reads = getWeek(snapshot, query);
  const data = updatedData(snapshot, query, reads);
  collection = schoolPapers(page, date, today, now, snapshot, data, reads);
  const selectedId = weekly ? undated ? "undated" : date : undefined;
  const flowKey = [page, snapshot.profile?.classKey, weekly ? schoolWeek(date)[0] : ""].filter(Boolean).join("/");
  const title = page === "home" ? "오늘의 학교생활" : pages[page];

  classButton.textContent = snapshot.profile ? `${snapshot.profile.grade}학년 ${snapshot.profile.classNumber}반` : "학급 선택";
  classButton.setAttribute("aria-label", `학급 선택 · ${classButton.textContent}`);
  for (const link of document.querySelectorAll("[data-page]")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = `PinCon · ${pages[page]}`;
  const focus = main.contains(document.activeElement) ? document.activeElement : null;
  const samePage = current?.page === page;
  const changedDate = current?.date !== date || current?.undated !== undated;
  current = route;
  const openHint = page === "home" ? "해당 화면이나 상세 내용을 엽니다." : undefined;
  const markup = heading(title, date, weekly, undated) + (weekly ? weekNav(page, date, today, undated) : "")
    + paperCoverflowMarkup(collection.covers, pages[page], flowKey, openHint, undated ? undefined : selectedId) + activeWeekControls(page, collection.overview);
  patchPage(main, `<div class="view-enter">${markup}</div>`, samePage);

  syncingSelection = true;
  try {
    const flow = mountCoverflow(main, openCover, {
      initialId: selectedId, defaultId: collection.defaultId || date,
      onSelect: selectDate, horizontalWheel: true,
    });
    if (selectedId && changedDate) flow?.select?.(selectedId);
    if (undated && !collection.covers.some(paper => paper.id === selectedId)) {
      syncingSelection = false;
      flow?.select?.(date);
      if (current.undated) selectDate(date);
    }
  } finally {
    syncingSelection = false;
  }
  if (samePage && focus && !focus.isConnected) restoreStageFocus(focus);
  if (detail && detailDialog.open && detailDialog.dataset.dialogMotion !== "closing") {
    const paper = detail.kind === "overview" ? collection.overview : collection.covers.find(item => item.id === detail.id);
    if (paper) updateDetail(paper);
    else closeDialog(detailDialog);
  }
}

function restoreStageFocus(control, fallback = ".pc-cover[aria-pressed=true], .pc-list-flow .pc-cover") {
  const { day, week, flowStep, coverId } = control?.dataset || {};
  const selector = day ? `[data-day="${CSS.escape(day)}"]`
    : week ? `[data-week="${CSS.escape(week)}"]`
    : flowStep ? `[data-flow-step="${CSS.escape(flowStep)}"]`
    : coverId ? `[data-cover-id="${CSS.escape(coverId)}"]:is([aria-pressed="true"], :not([aria-pressed]))`
    : control?.hasAttribute("data-overview") ? "[data-overview]"
    : control?.matches(".pc-scene") ? ".pc-scene" : fallback;
  (main.querySelector(selector) || main.querySelector(fallback) || main.querySelector("h1"))?.focus({ preventScroll: true });
}

function resetDetail() {
  detail = null;
  if (detailDialog.open) detailDialog.close();
}

function navigate(hash, source) {
  resetDetail();
  if (hash !== location.hash) history.pushState(null, "", location.pathname + location.search + hash);
  render();
  if (coverListEnabled() && (source?.dataset.day || source?.dataset.week === "today")) {
    const id = CSS.escape(current.date);
    main.querySelector(`.pc-list-flow [data-cover-id="${id}"]`)?.focus();
  } else if (source?.dataset.week || source?.dataset.day) restoreStageFocus(source, "h1");
  else main.querySelector("h1").focus();
}

detailDialog.querySelector("[data-close]").addEventListener("click", () => closeDialog(detailDialog));
detailDialog.addEventListener("close", () => {
  if (detailDialog.open || !detail) return;
  const { trigger } = detail;
  detail = null;
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  else restoreStageFocus(trigger);
});

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const link = event.target.closest("a");
  if (!link) return;
  if (link.id === "skip-content") {
    event.preventDefault();
    main.querySelector("h1").focus();
    return;
  }
  const homeLink = link.classList.contains("brand") || link.dataset.page === "home";
  const hash = link.getAttribute("href");
  if (!homeLink && !/^#(?:meals|timetable|schedule|notices)(?:\/|$)/.test(hash || "")) return;
  event.preventDefault();
  navigate(homeLink ? "" : hash, link);
});
window.addEventListener("popstate", () => {
  resetDetail();
  render();
  main.querySelector("h1").focus();
});
window.addEventListener("hashchange", render);

main.addEventListener("click", event => {
  const button = event.target.closest("[data-overview]");
  if (button) openPaperContent(collection.overview, button, "overview");
});

detailDialog.addEventListener("click", async event => {
  const button = event.target.closest("[data-retry]");
  if (!button || pendingRetry || changingClass) return;
  pendingRetry = true;
  const { page, date } = pageFromUrl();
  const query = weekQuery(gateway.snapshot(), page, date, kstDate());
  for (const name of query?.names || []) weekReads.delete(`${query.id}/${name}`);
  try { await gateway.retry(); }
  finally { pendingRetry = false; render(); }
});

classForm.elements.classNumber.innerHTML = Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}반</option>`).join("");
classButton.addEventListener("click", () => {
  if (changingClass) return;
  const profile = readClassProfile();
  classForm.elements.grade.value = profile.grade;
  classForm.elements.classNumber.value = profile.classNumber;
  openDialog(classDialog);
});
classForm.querySelector("[data-close]").addEventListener("click", () => closeDialog(classDialog));
classForm.addEventListener("submit", async event => {
  event.preventDefault();
  const oldClass = readClassProfile().classKey;
  const profile = saveClassProfile(classForm.elements.grade.value, classForm.elements.classNumber.value);
  closeDialog(classDialog);
  if (oldClass === profile.classKey) return;
  changingClass = true;
  try { await gateway.retry(); }
  finally { changingClass = false; render(); }
});

gateway.addEventListener("change", render);
document.addEventListener("pincon-layout-change", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
setInterval(() => { if (!document.hidden) render(); }, 30_000);
render();
gateway.start();
