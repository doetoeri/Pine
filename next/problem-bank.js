const DATA_URL = "./data/problem-bank.json";
const PROFILE_KEY = "pincon-profile-v2";

let bank = { schemaVersion: 1, problems: [] };
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

function sourceLabel(source) {
  if (source?.kind === "ai-generated") return "AI 생성 · 검토 후 게시";
  if (source?.kind === "teacher-approved") return "교사 승인";
  if (source?.kind === "open-license") return "공개 라이선스";
  return "직접 제작";
}

function filteredProblems() {
  const query = filters.query.trim().toLocaleLowerCase("ko-KR");
  return publishedProblems().filter((item) => {
    if (filters.subject !== "all" && item.subject !== filters.subject) return false;
    if (filters.difficulty !== "all" && item.difficulty !== filters.difficulty) return false;
    if (!query) return true;
    const haystack = [item.subject, item.unit, item.question, ...(item.tags || [])]
      .join(" ")
      .toLocaleLowerCase("ko-KR");
    return haystack.includes(query);
  });
}

function choiceMarkup(item) {
  if (item.type !== "multiple-choice" || !Array.isArray(item.choices) || !item.choices.length) return "";
  return `<ol class="problem-card__choices">${item.choices.map((choice) => `<li>${escapeHtml(choice)}</li>`).join("")}</ol>`;
}

function problemMarkup(item, index) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return `<article class="problem-card" data-problem-id="${escapeHtml(item.id)}">
    <div class="problem-card__meta">
      <span class="problem-chip">${escapeHtml(item.subject)}</span>
      <span class="problem-chip">${escapeHtml(item.unit)}</span>
      <span class="problem-chip problem-chip--difficulty">${escapeHtml(difficultyLabel(item.difficulty))}</span>
      <span class="problem-chip">${item.type === "multiple-choice" ? "객관식" : "주관식"}</span>
    </div>
    <p class="problem-card__question"><strong>${index + 1}.</strong> ${escapeHtml(item.question)}</p>
    ${choiceMarkup(item)}
    <details class="problem-card__answer">
      <summary><md-icon>visibility</md-icon>정답·해설 보기</summary>
      <div class="problem-card__answer-body">
        <p><strong>정답</strong> ${escapeHtml(item.answer)}</p>
        <p><strong>해설</strong> ${escapeHtml(item.explanation)}</p>
      </div>
    </details>
    ${tags.length ? `<div class="problem-card__tags">${tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    <div class="problem-card__source">${escapeHtml(sourceLabel(item.source))}${item.source?.note ? ` · ${escapeHtml(item.source.note)}` : ""}</div>
  </article>`;
}

function subjectOptions(items) {
  return [...new Set(items.map((item) => item.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}

function panelMarkup() {
  const all = publishedProblems();
  const visible = filteredProblems();
  const subjects = subjectOptions(all);

  if (loadError) {
    return `<article class="surface problem-bank-surface" id="problemBankPanel">
      <div class="surface__header"><h2 class="surface__title">문제은행</h2><span class="surface__meta">오류</span></div>
      <div class="empty"><md-icon>error</md-icon><strong>문제은행을 불러오지 못했습니다</strong><span>${escapeHtml(loadError)}</span></div>
    </article>`;
  }

  return `<article class="surface problem-bank-surface" id="problemBankPanel" aria-labelledby="problem-bank-title">
    <div class="surface__header">
      <div><h2 class="surface__title" id="problem-bank-title">문제은행</h2><p class="row__support">과목·단원·난이도로 골라 풀고, 정답과 해설은 필요할 때 펼칩니다.</p></div>
      <span class="surface__meta">${all.length}문제</span>
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
    <div class="problem-bank-summary"><span>현재 ${visible.length}문제 표시</span><span>게시된 문제만 학생에게 표시됩니다.</span></div>
    <div class="problem-bank-list" id="problemBankList">
      ${visible.length ? visible.map(problemMarkup).join("") : `<div class="empty"><md-icon>quiz</md-icon><strong>조건에 맞는 문제가 없습니다</strong><span>검색어나 필터를 바꿔 보세요.</span></div>`}
    </div>
  </article>`;
}

function bindPanel(panel) {
  panel.querySelector("#problemBankSearch")?.addEventListener("input", (event) => {
    filters.query = event.target.value || "";
    renderPanel();
  });
  panel.querySelector("#problemBankSubject")?.addEventListener("change", (event) => {
    filters.subject = event.target.value || "all";
    renderPanel();
  });
  panel.querySelector("#problemBankDifficulty")?.addEventListener("change", (event) => {
    filters.difficulty = event.target.value || "all";
    renderPanel();
  });
}

function renderPanel() {
  const classroom = document.querySelector('section[aria-labelledby="classroom-title"]');
  if (!classroom) return;
  const grid = classroom.querySelector(".grid");
  if (!grid) return;
  const existing = classroom.querySelector("#problemBankPanel");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = panelMarkup();
  const panel = wrapper.firstElementChild;
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
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    if (next?.schemaVersion !== 1 || !Array.isArray(next.problems)) throw new Error("문제 데이터 형식이 올바르지 않습니다.");
    bank = next;
    loadError = "";
  } catch (error) {
    loadError = error?.message || "알 수 없는 오류";
  }
  queueRender();
}

const observer = new MutationObserver(queueRender);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("hashchange", queueRender);
loadBank();
queueRender();
