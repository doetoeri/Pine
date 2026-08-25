const DATA_URL = "./data/problem-bank.json";
const PROFILE_KEY = "pincon-profile-v2";

let bank = { schemaVersion: 1, problems: [] };
let loading = true;
let loadError = "";
let renderQueued = false;
let filters = { query: "", subject: "all", difficulty: "all" };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function profile() {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    const grade = Number(value?.grade);
    const classNumber = Number(value?.classNumber);
    if (!Number.isInteger(grade) || !Number.isInteger(classNumber)) return null;
    return { grade, classNumber, classKey: `${grade}-${classNumber}` };
  } catch {
    return null;
  }
}

function publishedProblems() {
  const classKey = profile()?.classKey || "";
  return (bank.problems || []).filter((item) => item?.status === "published" && item.classKey === classKey);
}

function difficultyLabel(value) {
  return value === "easy" ? "기초" : value === "hard" ? "도전" : "보통";
}

function sourceLabel(item) {
  const note = String(item?.source?.note || "");
  if (item?.example === true || /예시|sample/i.test(note)) return "예시 문제";
  return "실제 학급 자료";
}

function filteredProblems() {
  const query = filters.query.trim().toLocaleLowerCase("ko-KR");
  return publishedProblems().filter((item) => {
    if (filters.subject !== "all" && item.subject !== filters.subject) return false;
    if (filters.difficulty !== "all" && item.difficulty !== filters.difficulty) return false;
    if (!query) return true;
    const haystack = [
      item.subject,
      item.unit,
      item.question,
      sourceLabel(item),
      ...(item.tags || []),
    ].join(" ").toLocaleLowerCase("ko-KR");
    return haystack.includes(query);
  });
}

function detailKey(item) {
  const api = globalThis.PinConNext;
  return api?.registerDetail?.("problem", item, {
    collection: "problemBank",
    route: "classroom",
  }) || api?.detailKeyForReference?.("problem", "problemBank", item.id) || "";
}

function problemMarkup(item, index) {
  const key = detailKey(item);
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3) : [];
  const source = sourceLabel(item);
  return `<md-list-item type="button" class="problem-card interactive-item" data-problem-id="${escapeHtml(item.id)}" ${key ? `data-detail-key="${escapeHtml(key)}"` : "disabled"} data-detail-route="classroom" aria-label="${escapeHtml(`${item.question}, ${item.subject}, ${difficultyLabel(item.difficulty)}, 문제 풀기`)}">
    <span slot="start" class="problem-card__number">${index + 1}</span>
    <div slot="headline" class="problem-card__question">${escapeHtml(item.question)}</div>
    <div slot="supporting-text" class="problem-card__support">${escapeHtml([
      item.subject,
      item.unit,
      difficultyLabel(item.difficulty),
      item.type === "multiple-choice" ? "객관식" : "주관식",
      ...tags.map((tag) => `#${tag}`),
    ].filter(Boolean).join(" · "))}</div>
    <span slot="end" class="problem-card__end"><span class="problem-source problem-source--${source === "예시 문제" ? "example" : "class"}">${escapeHtml(source)}</span><md-icon aria-hidden="true">chevron_right</md-icon></span>
  </md-list-item>`;
}

function subjectOptions(items) {
  return [...new Set(items.map((item) => item.subject).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ko-KR"));
}

function resultsMarkup() {
  const visible = filteredProblems();
  if (visible.length) {
    return `<md-list class="problem-bank-list interactive-list" aria-label="문제 검색 결과">${visible.map(problemMarkup).join("")}</md-list>`;
  }
  return `<div class="empty" role="status"><md-icon>search_off</md-icon><strong>조건에 맞는 문제가 없습니다</strong><span>검색어, 과목 또는 난이도 필터를 바꿔 보세요.</span></div>`;
}

function loadingMarkup() {
  return `<div class="skeleton-list" role="status" aria-label="문제은행 불러오는 중">
    ${Array.from({ length: 3 }, () => '<div class="skeleton-row"><span></span><span></span></div>').join("")}
  </div>`;
}

function panelMarkup() {
  const all = publishedProblems();
  const visible = filteredProblems();
  const subjects = subjectOptions(all);

  if (loading) {
    return `<article class="surface problem-bank-surface" id="problemBankPanel" aria-labelledby="problem-bank-title">
      <div class="surface__header"><h2 class="surface__title" id="problem-bank-title">문제은행</h2><span class="surface__meta">불러오는 중</span></div>
      ${loadingMarkup()}
    </article>`;
  }

  if (loadError) {
    return `<article class="surface problem-bank-surface" id="problemBankPanel" aria-labelledby="problem-bank-title">
      <div class="surface__header"><h2 class="surface__title" id="problem-bank-title">문제은행</h2><span class="surface__meta">연결 오류</span></div>
      <div class="data-error" role="alert"><md-icon>cloud_off</md-icon><div><strong>문제은행을 불러오지 못했습니다</strong><span>${escapeHtml(loadError)}</span></div><md-filled-tonal-button data-problem-bank-retry>다시 시도</md-filled-tonal-button></div>
    </article>`;
  }

  return `<article class="surface problem-bank-surface" id="problemBankPanel" aria-labelledby="problem-bank-title">
    <div class="surface__header">
      <div><h2 class="surface__title" id="problem-bank-title">문제은행</h2><p class="row__support">문제를 선택해 답을 제출하고 정답·해설을 확인할 수 있습니다.</p></div>
      <span class="surface__meta">${all.length ? `${all.length}문제` : ""}</span>
    </div>
    <div class="problem-bank-toolbar">
      <md-outlined-text-field id="problemBankSearch" type="search" label="문제·단원 검색" value="${escapeHtml(filters.query)}"></md-outlined-text-field>
      <md-outlined-select id="problemBankSubject" label="과목" value="${escapeHtml(filters.subject)}">
        <md-select-option value="all" ${filters.subject === "all" ? "selected" : ""}><div slot="headline">전체 과목</div></md-select-option>
        ${subjects.map((subject) => `<md-select-option value="${escapeHtml(subject)}" ${filters.subject === subject ? "selected" : ""}><div slot="headline">${escapeHtml(subject)}</div></md-select-option>`).join("")}
      </md-outlined-select>
      <md-outlined-select id="problemBankDifficulty" label="난이도" value="${escapeHtml(filters.difficulty)}">
        <md-select-option value="all" ${filters.difficulty === "all" ? "selected" : ""}><div slot="headline">전체 난이도</div></md-select-option>
        <md-select-option value="easy" ${filters.difficulty === "easy" ? "selected" : ""}><div slot="headline">기초</div></md-select-option>
        <md-select-option value="medium" ${filters.difficulty === "medium" ? "selected" : ""}><div slot="headline">보통</div></md-select-option>
        <md-select-option value="hard" ${filters.difficulty === "hard" ? "selected" : ""}><div slot="headline">도전</div></md-select-option>
      </md-outlined-select>
    </div>
    <div class="problem-bank-summary" role="status" aria-live="polite"><span id="problemBankVisibleCount">검색 결과 ${visible.length}문제</span><span>예시 문제와 실제 학급 자료를 구분합니다.</span></div>
    <div id="problemBankList">${all.length ? resultsMarkup() : '<div class="empty"><md-icon>quiz</md-icon><strong>아직 등록된 문제가 없습니다</strong><span>게시된 학급 자료가 생기면 이곳에 표시됩니다.</span></div>'}</div>
  </article>`;
}

function updateResults(panel) {
  if (!panel || loading || loadError) return;
  const visible = filteredProblems();
  const count = panel.querySelector("#problemBankVisibleCount");
  const list = panel.querySelector("#problemBankList");
  if (count) count.textContent = `검색 결과 ${visible.length}문제`;
  if (list) list.innerHTML = resultsMarkup();
}

function bindPanel(panel) {
  panel.querySelector("#problemBankSearch")?.addEventListener("input", (event) => {
    filters.query = event.target.value || "";
    updateResults(panel);
  });
  panel.querySelector("#problemBankSubject")?.addEventListener("change", (event) => {
    filters.subject = event.target.value || "all";
    updateResults(panel);
  });
  panel.querySelector("#problemBankDifficulty")?.addEventListener("change", (event) => {
    filters.difficulty = event.target.value || "all";
    updateResults(panel);
  });
  panel.querySelector("[data-problem-bank-retry]")?.addEventListener("click", () => loadBank());
}

function renderPanel({ replace = false } = {}) {
  const classroom = document.querySelector('section[aria-labelledby="classroom-title"]');
  if (!classroom) return;
  const grid = classroom.querySelector(".grid");
  if (!grid) return;
  const existing = classroom.querySelector("#problemBankPanel");
  if (existing && !replace) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = panelMarkup();
  const panel = wrapper.firstElementChild;
  if (!panel) return;
  if (existing) existing.replaceWith(panel);
  else grid.appendChild(panel);
  bindPanel(panel);
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPanel();
  });
}

async function loadBank() {
  loading = true;
  loadError = "";
  renderPanel({ replace: true });
  try {
    const response = await fetch(DATA_URL, { cache: "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    if (next?.schemaVersion !== 1 || !Array.isArray(next.problems)) {
      throw new Error("문제 데이터 형식이 올바르지 않습니다.");
    }
    bank = next;
  } catch (error) {
    loadError = error?.message || "알 수 없는 오류";
  } finally {
    loading = false;
    renderPanel({ replace: true });
  }
}

const observer = new MutationObserver(queueRender);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("hashchange", queueRender);
loadBank();
queueRender();
