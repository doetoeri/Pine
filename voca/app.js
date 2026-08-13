(() => {
  "use strict";

  const STORAGE_KEY = "meaningLinkWorksheet.v1";
  const THEME_KEY = "meaningLinkWorksheet.theme";
  const SCHEMA_VERSION = 1;
  const MODE_LABELS = {
    study: "학습형",
    recall: "인출형",
    test: "시험형",
    mixed: "단계혼합형"
  };
  const PAPER_SIZES = {
    A4: { portrait: [210, 297], landscape: [297, 210] },
    B5: { portrait: [176, 250], landscape: [250, 176] }
  };
  const FIELD_LABELS = {
    word: "영단어",
    meaning: "한글 뜻",
    example: "영어 예문",
    day: "Day",
    unit: "단원",
    lesson: "과",
    tags: "태그"
  };
  const HEADER_SYNONYMS = {
    word: ["word", "words", "vocabulary", "vocab", "english", "영단어", "단어", "어휘", "영어"],
    meaning: ["meaning", "definition", "korean", "뜻", "한글뜻", "의미", "한국어"],
    example: ["example", "sentence", "example sentence", "예문", "문장", "영어예문"],
    day: ["day", "데이", "일차"],
    unit: ["unit", "chapter", "단원", "챕터"],
    lesson: ["lesson", "과", "lesson no", "레슨"],
    tags: ["tag", "tags", "태그", "분류"]
  };

  const DEFAULT_SETTINGS = Object.freeze({
    mode: "mixed",
    paperSize: "A4",
    orientation: "portrait",
    columns: 1,
    wordsPerPage: 8,
    repeatCount: 2,
    fontPt: 10.5,
    slotHeightMm: 9,
    itemGapMm: 3.5,
    marginMm: 12,
    columnGapMm: 7,
    hintOpacity: 0.08,
    showMeaning: true,
    showExample: true,
    showNumbers: true,
    showGroupTitle: true,
    shuffle: false,
    shuffleSeed: 314159,
    includeAnswerKey: false,
    documentTitle: "의미연결 어휘 학습지"
  });

  const SAMPLE_ENTRIES = Object.freeze([
    { word: "conduct", meaning: "수행하다; 이끌다", example: "The students conducted a simple science experiment.", day: "1", unit: "Sample", lesson: "1", tags: "기본" },
    { word: "conducive", meaning: "도움이 되는; ~에 좋은", example: "A quiet room is conducive to focused study.", day: "1", unit: "Sample", lesson: "1", tags: "어원" },
    { word: "pursue", meaning: "추구하다; 뒤쫓다", example: "She decided to pursue her goal with patience.", day: "1", unit: "Sample", lesson: "1", tags: "동사" },
    { word: "proficient", meaning: "능숙한", example: "He became proficient in using the design software.", day: "1", unit: "Sample", lesson: "1", tags: "형용사" },
    { word: "redundant", meaning: "불필요한; 중복되는", example: "Remove any redundant details from the report.", day: "1", unit: "Sample", lesson: "2", tags: "형용사" },
    { word: "remnant", meaning: "남은 부분; 흔적", example: "A remnant of the old wall remains near the gate.", day: "1", unit: "Sample", lesson: "2", tags: "명사" },
    { word: "mundane", meaning: "일상적인; 재미없는", example: "Good design can improve even mundane tasks.", day: "2", unit: "Sample", lesson: "2", tags: "형용사" },
    { word: "compulsory", meaning: "의무적인; 필수의", example: "Safety education is compulsory for every student.", day: "2", unit: "Sample", lesson: "3", tags: "형용사" },
    { word: "reclaim", meaning: "되찾다; 재생하다", example: "The city plans to reclaim the unused land.", day: "2", unit: "Sample", lesson: "3", tags: "동사" },
    { word: "paradox", meaning: "역설; 모순되어 보이는 말", example: "The statement sounds like a paradox at first.", day: "2", unit: "Sample", lesson: "3", tags: "명사" },
    { word: "morale", meaning: "사기; 의욕", example: "The team's morale improved after the small success.", day: "2", unit: "Sample", lesson: "4", tags: "명사" },
    { word: "encompass", meaning: "포함하다; 둘러싸다", example: "The project will encompass research and presentation.", day: "2", unit: "Sample", lesson: "4", tags: "동사" }
  ]);

  const $ = (id) => document.getElementById(id);
  const dom = {};
  let state;
  let selectedIds = new Set();
  let importState = { rows: [], delimiter: "", sourceName: "", mapping: {}, detectedHeader: false };
  let saveTimer = 0;
  let renderTimer = 0;
  let toastTimer = 0;
  let previewScale = 1;
  let fitAutomatically = true;
  let deferredInstallPrompt = null;
  let lastDiagnostics = { pages: 0, worksheetPages: 0, answerPages: 0, clipped: 0, oversize: 0, printableEntries: 0 };

  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function newEntry(values = {}, isSample = false) {
    return {
      id: typeof values.id === "string" && values.id ? values.id : uid(),
      word: asString(values.word),
      meaning: asString(values.meaning),
      example: asString(values.example),
      day: asString(values.day),
      unit: asString(values.unit),
      lesson: asString(values.lesson),
      tags: asString(values.tags),
      isSample: Boolean(values.isSample ?? isSample)
    };
  }

  function asString(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function escapeHTML(value) {
    return asString(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeFilename(value) {
    return asString(value)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 70) || "의미연결-학습지";
  }

  function normalizeSettings(raw = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
    merged.mode = Object.hasOwn(MODE_LABELS, merged.mode) ? merged.mode : DEFAULT_SETTINGS.mode;
    merged.paperSize = Object.hasOwn(PAPER_SIZES, merged.paperSize) ? merged.paperSize : "A4";
    merged.orientation = merged.orientation === "landscape" ? "landscape" : "portrait";
    merged.columns = clamp(Math.round(merged.columns), 1, 2);
    merged.wordsPerPage = clamp(Math.round(merged.wordsPerPage), 1, 40);
    merged.repeatCount = clamp(Math.round(merged.repeatCount), 1, 8);
    merged.fontPt = clamp(merged.fontPt, 8, 16);
    merged.slotHeightMm = clamp(merged.slotHeightMm, 7, 16);
    merged.itemGapMm = clamp(merged.itemGapMm, 2, 8);
    merged.marginMm = clamp(Math.round(merged.marginMm), 7, 22);
    merged.columnGapMm = clamp(Math.round(merged.columnGapMm), 3, 12);
    merged.hintOpacity = clamp(merged.hintOpacity, 0, 0.22);
    merged.shuffleSeed = Number.isFinite(Number(merged.shuffleSeed)) ? Number(merged.shuffleSeed) : Date.now();
    ["showMeaning", "showExample", "showNumbers", "showGroupTitle", "shuffle", "includeAnswerKey"].forEach((key) => {
      merged[key] = Boolean(merged[key]);
    });
    merged.documentTitle = asString(merged.documentTitle).slice(0, 60) || DEFAULT_SETTINGS.documentTitle;
    return merged;
  }

  function makeInitialState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      entries: SAMPLE_ENTRIES.map((entry) => newEntry(entry, true)),
      settings: { ...DEFAULT_SETTINGS }
    };
  }

  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return makeInitialState();
      const parsed = JSON.parse(stored);
      if (!parsed || !Array.isArray(parsed.entries)) return makeInitialState();
      return {
        schemaVersion: SCHEMA_VERSION,
        entries: parsed.entries.map((entry) => newEntry(entry, Boolean(entry?.isSample))),
        settings: normalizeSettings(parsed.settings)
      };
    } catch (error) {
      console.warn("저장 데이터를 읽지 못해 샘플로 시작합니다.", error);
      return makeInitialState();
    }
  }

  function serializableState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      app: "의미연결 깜지 생성기",
      entries: state.entries,
      settings: state.settings
    };
  }

  function markSaving() {
    dom.saveStatus?.classList.add("saving");
    if (dom.saveStatus) dom.saveStatus.lastChild.textContent = " 저장 중";
  }

  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState()));
      dom.saveStatus?.classList.remove("saving");
      if (dom.saveStatus) dom.saveStatus.lastChild.textContent = " 자동 저장됨";
    } catch (error) {
      console.error("자동 저장 실패", error);
      dom.saveStatus?.classList.add("saving");
      if (dom.saveStatus) dom.saveStatus.lastChild.textContent = " 저장 공간 확인 필요";
      showToast("브라우저 저장 공간을 확인해 주세요.");
    }
  }

  function scheduleSave() {
    markSaving();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 260);
  }

  function scheduleWorksheetRender(delay = 90) {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderWorksheet, delay);
  }

  function commit({ entries = false, filters = false, settings = false, immediateRender = false } = {}) {
    if (entries || settings) scheduleSave();
    if (entries || filters) {
      refreshFilterOptions();
      renderEntryList();
    }
    if (settings) syncSettingsControls();
    scheduleWorksheetRender(immediateRender ? 0 : 90);
  }

  function showToast(message, duration = 2400) {
    if (!dom.toast) return;
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), duration);
  }

  function cacheDom() {
    [
      "saveStatus", "installBtn", "themeBtn", "headerPrintBtn", "entrySummary", "clearSamplesBtn",
      "openImportBtn", "addRowBtn", "exportJsonBtn", "jsonImportInput", "downloadSampleBtn",
      "dayFilter", "unitFilter", "searchInput", "selectVisibleInput", "selectedCount", "deleteSelectedBtn",
      "entryList", "emptyEntries", "emptyAddBtn", "settingsPane", "entriesPane", "entriesTab", "settingsTab",
      "modeGrid", "resetSettingsBtn", "goPreviewBtn", "previewPanel", "previewHealth", "previewStatusText",
      "zoomOutBtn", "fitPreviewBtn", "zoomInBtn", "previewPrintBtn", "previewNotice", "previewViewport",
      "printRoot", "measureRoot", "mobilePageCount", "importDialog", "pasteInput", "fileDrop", "dataFileInput",
      "fileNameLabel", "analyzeImportBtn", "delimiterSelect", "headerRowInput", "detectionResult", "mappingSection",
      "importPreviewBody", "confirmImportBtn", "toast", "pageStyle"
    ].forEach((id) => { dom[id] = $(id); });
  }

  function init() {
    cacheDom();
    state = loadState();
    document.body.dataset.mobileView = "edit";
    applySavedTheme();
    bindEvents();
    syncSettingsControls();
    refreshFilterOptions();
    renderEntryList();
    renderWorksheet();
    registerServiceWorker();
    exposeDebugApi();
  }

  function applySavedTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark") document.body.dataset.theme = "dark";
  }

  function bindEvents() {
    document.querySelectorAll("[data-editor-tab]").forEach((button) => {
      button.addEventListener("click", () => switchEditorTab(button.dataset.editorTab));
    });

    document.querySelectorAll(".view-switch").forEach((button) => {
      button.addEventListener("click", () => switchMobileView(button.dataset.view));
    });

    dom.themeBtn.addEventListener("click", toggleTheme);
    dom.headerPrintBtn.addEventListener("click", printWorksheet);
    dom.previewPrintBtn.addEventListener("click", printWorksheet);
    dom.openImportBtn.addEventListener("click", openImportDialog);
    dom.addRowBtn.addEventListener("click", addBlankEntry);
    dom.emptyAddBtn.addEventListener("click", addBlankEntry);
    dom.clearSamplesBtn.addEventListener("click", clearSamples);
    dom.exportJsonBtn.addEventListener("click", exportJson);
    dom.jsonImportInput.addEventListener("change", importJsonFile);
    dom.downloadSampleBtn.addEventListener("click", () => downloadExistingFile("sample-words.tsv", "의미연결-샘플단어.tsv"));

    dom.dayFilter.addEventListener("change", () => commit({ filters: true, immediateRender: true }));
    dom.unitFilter.addEventListener("change", () => commit({ filters: true, immediateRender: true }));
    dom.searchInput.addEventListener("input", () => commit({ filters: true }));
    dom.selectVisibleInput.addEventListener("change", toggleSelectVisible);
    dom.deleteSelectedBtn.addEventListener("click", deleteSelected);
    dom.entryList.addEventListener("input", handleEntryInput);
    dom.entryList.addEventListener("change", handleEntryChange);
    dom.entryList.addEventListener("click", handleEntryAction);

    document.querySelectorAll("[data-setting]").forEach((control) => {
      control.addEventListener("input", handleSettingInput);
      control.addEventListener("change", handleSettingInput);
    });
    document.querySelectorAll('input[name="mode"]').forEach((radio) => radio.addEventListener("change", handleModeChange));
    dom.resetSettingsBtn.addEventListener("click", resetSettings);
    dom.goPreviewBtn.addEventListener("click", () => switchMobileView("preview"));

    dom.zoomOutBtn.addEventListener("click", () => setManualZoom(previewScale - 0.1));
    dom.zoomInBtn.addEventListener("click", () => setManualZoom(previewScale + 0.1));
    dom.fitPreviewBtn.addEventListener("click", fitPreview);
    window.addEventListener("resize", debounce(() => { if (fitAutomatically) fitPreview(); }, 120));
    window.addEventListener("beforeprint", () => {
      saveNow();
      renderWorksheet();
    });

    dom.analyzeImportBtn.addEventListener("click", analyzePastedText);
    dom.delimiterSelect.addEventListener("change", () => {
      if (dom.pasteInput.value) analyzePastedText();
    });
    dom.headerRowInput.addEventListener("change", () => {
      populateMappingSelectors(true);
      updateImportPreview();
    });
    document.querySelectorAll("[data-map-field]").forEach((select) => select.addEventListener("change", updateImportPreview));
    dom.confirmImportBtn.addEventListener("click", confirmImport);
    dom.dataFileInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) processDataFile(file);
    });
    ["dragenter", "dragover"].forEach((type) => dom.fileDrop.addEventListener(type, (event) => {
      event.preventDefault();
      dom.fileDrop.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((type) => dom.fileDrop.addEventListener(type, (event) => {
      event.preventDefault();
      dom.fileDrop.classList.remove("dragging");
    }));
    dom.fileDrop.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) processDataFile(file);
    });
    dom.importDialog.addEventListener("close", resetImportDialogState);

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      dom.installBtn.classList.remove("hidden");
    });
    dom.installBtn.addEventListener("click", installPwa);
  }

  function debounce(callback, wait) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), wait);
    };
  }

  function toggleTheme() {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    if (next === "dark") document.body.dataset.theme = "dark";
    else delete document.body.dataset.theme;
    localStorage.setItem(THEME_KEY, next);
    dom.themeBtn.setAttribute("aria-label", next === "dark" ? "화면 라이트 모드로 전환" : "화면 다크 모드로 전환");
  }

  function switchEditorTab(tab) {
    const isEntries = tab === "entries";
    dom.entriesPane.classList.toggle("hidden", !isEntries);
    dom.settingsPane.classList.toggle("hidden", isEntries);
    dom.entriesTab.classList.toggle("active", isEntries);
    dom.settingsTab.classList.toggle("active", !isEntries);
    dom.entriesTab.setAttribute("aria-selected", String(isEntries));
    dom.settingsTab.setAttribute("aria-selected", String(!isEntries));
  }

  function switchMobileView(view) {
    const normalized = view === "preview" ? "preview" : "edit";
    document.body.dataset.mobileView = normalized;
    document.querySelectorAll(".view-switch").forEach((button) => {
      const active = button.dataset.view === normalized;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (normalized === "preview") {
      requestAnimationFrame(fitPreview);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function getVisibleEntryRecords() {
    const day = dom.dayFilter?.value || "";
    const unit = dom.unitFilter?.value || "";
    const query = (dom.searchInput?.value || "").toLocaleLowerCase("ko");
    return state.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (day && entry.day !== day) return false;
        if (unit && entry.unit !== unit) return false;
        if (!query) return true;
        return [entry.word, entry.meaning, entry.example, entry.day, entry.unit, entry.lesson, entry.tags]
          .some((value) => value.toLocaleLowerCase("ko").includes(query));
      });
  }

  function refreshFilterOptions() {
    if (!dom.dayFilter || !dom.unitFilter) return;
    updateSelectOptions(dom.dayFilter, uniqueValues(state.entries.map((entry) => entry.day)), "전체");
    updateSelectOptions(dom.unitFilter, uniqueValues(state.entries.map((entry) => entry.unit)), "전체");
  }

  function uniqueValues(values) {
    return [...new Set(values.filter((value) => value !== ""))]
      .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  }

  function updateSelectOptions(select, values, allLabel) {
    const current = select.value;
    select.replaceChildren(new Option(allLabel, ""), ...values.map((value) => new Option(value, value)));
    if (values.includes(current)) select.value = current;
  }

  function renderEntryList() {
    const records = getVisibleEntryRecords();
    const visibleIds = new Set(records.map(({ entry }) => entry.id));
    selectedIds = new Set([...selectedIds].filter((id) => state.entries.some((entry) => entry.id === id)));
    const sampleCount = state.entries.filter((entry) => entry.isSample).length;
    dom.entrySummary.textContent = `${state.entries.length}개 입력 · 현재 ${records.length}개 표시${sampleCount ? ` · 샘플 ${sampleCount}개` : ""}`;
    dom.clearSamplesBtn.classList.toggle("hidden", sampleCount === 0);
    dom.entryList.replaceChildren(...records.map(({ entry, index }, visibleIndex) => createEntryCard(entry, index, visibleIndex, records.length)));
    dom.emptyEntries.classList.toggle("hidden", records.length !== 0);
    dom.entryList.classList.toggle("hidden", records.length === 0);
    const selectedVisible = [...selectedIds].filter((id) => visibleIds.has(id)).length;
    dom.selectVisibleInput.checked = records.length > 0 && selectedVisible === records.length;
    dom.selectVisibleInput.indeterminate = selectedVisible > 0 && selectedVisible < records.length;
    dom.selectedCount.textContent = `${selectedIds.size}개 선택`;
    dom.deleteSelectedBtn.disabled = selectedIds.size === 0;
  }

  function createEntryCard(entry, absoluteIndex, visibleIndex, visibleTotal) {
    const article = document.createElement("article");
    article.className = `entry-card${selectedIds.has(entry.id) ? " is-selected" : ""}`;
    article.dataset.entryId = entry.id;
    article.innerHTML = `
      <div class="entry-card-head">
        <div class="entry-index-wrap">
          <input type="checkbox" data-select-entry aria-label="${absoluteIndex + 1}번 단어 선택" ${selectedIds.has(entry.id) ? "checked" : ""}>
          <strong>${absoluteIndex + 1}</strong>
          ${entry.isSample ? '<span class="sample-chip">샘플</span>' : ""}
        </div>
        <div class="entry-actions" aria-label="행 작업">
          <button class="entry-action" type="button" data-action="up" title="위로 이동" aria-label="위로 이동" ${visibleIndex === 0 ? "disabled" : ""}>↑</button>
          <button class="entry-action" type="button" data-action="down" title="아래로 이동" aria-label="아래로 이동" ${visibleIndex === visibleTotal - 1 ? "disabled" : ""}>↓</button>
          <button class="entry-action" type="button" data-action="duplicate" title="복제" aria-label="행 복제">⧉</button>
          <button class="entry-action danger" type="button" data-action="delete" title="삭제" aria-label="행 삭제">×</button>
        </div>
      </div>
      <div class="entry-fields">
        <label>영단어<input type="text" spellcheck="false" autocomplete="off" data-field="word" value="${escapeHTML(entry.word)}" placeholder="conduct"></label>
        <label>한글 뜻<input type="text" autocomplete="off" data-field="meaning" value="${escapeHTML(entry.meaning)}" placeholder="수행하다; 이끌다"></label>
        <label class="example-field">영어 예문<input type="text" spellcheck="false" autocomplete="off" data-field="example" value="${escapeHTML(entry.example)}" placeholder="The students conducted an experiment."></label>
        <div class="meta-fields">
          <label>Day<input type="text" data-field="day" value="${escapeHTML(entry.day)}"></label>
          <label>단원<input type="text" data-field="unit" value="${escapeHTML(entry.unit)}"></label>
          <label>과<input type="text" data-field="lesson" value="${escapeHTML(entry.lesson)}"></label>
          <label>태그<input type="text" data-field="tags" value="${escapeHTML(entry.tags)}"></label>
        </div>
      </div>`;
    return article;
  }

  function handleEntryInput(event) {
    const input = event.target.closest("[data-field]");
    if (!input) return;
    const card = input.closest("[data-entry-id]");
    const entry = state.entries.find((item) => item.id === card?.dataset.entryId);
    if (!entry || !Object.hasOwn(FIELD_LABELS, input.dataset.field)) return;
    entry[input.dataset.field] = input.value;
    entry.isSample = false;
    card.querySelector(".sample-chip")?.remove();
    scheduleSave();
    scheduleWorksheetRender();
  }

  function handleEntryChange(event) {
    const select = event.target.closest("[data-select-entry]");
    if (select) {
      const card = select.closest("[data-entry-id]");
      if (select.checked) selectedIds.add(card.dataset.entryId);
      else selectedIds.delete(card.dataset.entryId);
      renderEntryList();
      return;
    }
    if (event.target.closest("[data-field='day'], [data-field='unit']")) {
      refreshFilterOptions();
      renderEntryList();
    }
  }

  function handleEntryAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const card = button.closest("[data-entry-id]");
    const id = card?.dataset.entryId;
    const index = state.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const action = button.dataset.action;
    if (action === "delete") {
      state.entries.splice(index, 1);
      selectedIds.delete(id);
    } else if (action === "duplicate") {
      const copy = newEntry({ ...state.entries[index], id: "", isSample: false });
      state.entries.splice(index + 1, 0, copy);
    } else if (action === "up" || action === "down") {
      moveWithinVisible(id, action === "up" ? -1 : 1);
    }
    commit({ entries: true, immediateRender: true });
  }

  function moveWithinVisible(id, delta) {
    const records = getVisibleEntryRecords();
    const current = records.findIndex(({ entry }) => entry.id === id);
    const target = current + delta;
    if (current < 0 || target < 0 || target >= records.length) return;
    const a = records[current].index;
    const b = records[target].index;
    [state.entries[a], state.entries[b]] = [state.entries[b], state.entries[a]];
  }

  function addBlankEntry() {
    const entry = newEntry();
    state.entries.push(entry);
    dom.dayFilter.value = "";
    dom.unitFilter.value = "";
    dom.searchInput.value = "";
    switchEditorTab("entries");
    commit({ entries: true, immediateRender: true });
    requestAnimationFrame(() => {
      const card = [...dom.entryList.querySelectorAll("[data-entry-id]")].find((element) => element.dataset.entryId === entry.id);
      card?.querySelector("[data-field='word']")?.focus();
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function clearSamples() {
    const count = state.entries.filter((entry) => entry.isSample).length;
    if (!count) return;
    if (!window.confirm(`샘플 ${count}개만 삭제할까요? 직접 입력한 단어는 남습니다.`)) return;
    const sampleIds = new Set(state.entries.filter((entry) => entry.isSample).map((entry) => entry.id));
    state.entries = state.entries.filter((entry) => !entry.isSample);
    selectedIds = new Set([...selectedIds].filter((id) => !sampleIds.has(id)));
    commit({ entries: true, immediateRender: true });
    showToast("샘플 단어를 삭제했습니다.");
  }

  function toggleSelectVisible() {
    const ids = getVisibleEntryRecords().map(({ entry }) => entry.id);
    if (dom.selectVisibleInput.checked) ids.forEach((id) => selectedIds.add(id));
    else ids.forEach((id) => selectedIds.delete(id));
    renderEntryList();
  }

  function deleteSelected() {
    if (!selectedIds.size) return;
    if (!window.confirm(`선택한 ${selectedIds.size}개 행을 삭제할까요?`)) return;
    state.entries = state.entries.filter((entry) => !selectedIds.has(entry.id));
    selectedIds.clear();
    commit({ entries: true, immediateRender: true });
    showToast("선택한 행을 삭제했습니다.");
  }

  function syncSettingsControls() {
    document.querySelectorAll('input[name="mode"]').forEach((radio) => {
      radio.checked = radio.value === state.settings.mode;
    });
    document.querySelectorAll("[data-setting]").forEach((control) => {
      const key = control.dataset.setting;
      if (!Object.hasOwn(state.settings, key)) return;
      if (control.type === "checkbox") control.checked = Boolean(state.settings[key]);
      else control.value = state.settings[key];
    });
    updateRangeOutputs();
  }

  function updateRangeOutputs() {
    const suffixes = { marginMm: "mm", columnGapMm: "mm", fontPt: "pt", slotHeightMm: "mm", itemGapMm: "mm" };
    document.querySelectorAll("[data-output-for]").forEach((output) => {
      const key = output.dataset.outputFor;
      if (key === "hintOpacity") output.textContent = `${Math.round(state.settings[key] * 100)}%`;
      else output.textContent = `${state.settings[key]}${suffixes[key] || ""}`;
    });
  }

  function handleModeChange(event) {
    if (!event.target.checked) return;
    state.settings.mode = event.target.value;
    if (state.settings.mode === "test") {
      state.settings.includeAnswerKey = true;
      state.settings.shuffle = true;
      state.settings.shuffleSeed = Date.now();
    }
    commit({ settings: true, immediateRender: true });
  }

  function handleSettingInput(event) {
    const control = event.currentTarget;
    const key = control.dataset.setting;
    if (!key || !Object.hasOwn(DEFAULT_SETTINGS, key)) return;
    const oldValue = state.settings[key];
    if (control.type === "checkbox") state.settings[key] = control.checked;
    else if (control.type === "number" || control.type === "range") state.settings[key] = Number(control.value);
    else state.settings[key] = control.value;
    state.settings = normalizeSettings(state.settings);
    if (key === "shuffle" && state.settings.shuffle && !oldValue) state.settings.shuffleSeed = Date.now();
    scheduleSave();
    syncSettingsControls();
    scheduleWorksheetRender(35);
  }

  function resetSettings() {
    if (!window.confirm("학습지 설정을 권장 기본값으로 되돌릴까요? 단어 목록은 유지됩니다.")) return;
    state.settings = { ...DEFAULT_SETTINGS };
    commit({ settings: true, immediateRender: true });
    showToast("학습지 설정을 기본값으로 되돌렸습니다.");
  }

  function printableEntries() {
    let entries = getVisibleEntryRecords()
      .map(({ entry }) => entry)
      .filter((entry) => entry.word !== "" || entry.meaning !== "" || entry.example !== "");
    if (state.settings.shuffle) entries = seededShuffle(entries, state.settings.shuffleSeed);
    return entries;
  }

  function seededShuffle(items, seed) {
    const output = [...items];
    let value = (Math.abs(Number(seed)) || 1) >>> 0;
    const random = () => {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let index = output.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
    }
    return output;
  }

  function worksheetItem(entry, number) {
    const element = document.createElement("article");
    element.className = `worksheet-item mode-${state.settings.mode}`;
    element.dataset.sourceId = entry.id;
    const numberMarkup = state.settings.showNumbers ? `<span class="item-number">${number}.</span>` : "";
    const meaningMarkup = state.settings.showMeaning && entry.meaning !== "" ? `<div class="item-meaning">${escapeHTML(entry.meaning)}</div>` : "";
    const exampleMarkup = state.settings.showExample && entry.example !== "" ? `<div class="item-example">${escapeHTML(entry.example)}</div>` : "";
    const slotCount = state.settings.repeatCount;

    if (state.settings.mode === "study") {
      const word = entry.word || "(영단어 미입력)";
      const hintParts = [];
      if (state.settings.showMeaning && entry.meaning) hintParts.push(entry.meaning);
      if (state.settings.showExample && entry.example) hintParts.push(entry.example);
      element.innerHTML = `
        <div class="item-heading">${numberMarkup}<div class="item-word">${escapeHTML(word)}</div><span></span></div>
        ${meaningMarkup}${exampleMarkup}
        <div class="practice-slots">${practiceSlots(slotCount, hintParts.join(" · "))}</div>`;
    } else if (state.settings.mode === "recall" || state.settings.mode === "test") {
      const check = state.settings.mode === "test" ? '<span class="item-check"><span class="check-box"></span>채점</span>' : "";
      element.innerHTML = `
        <div class="item-heading">${numberMarkup}<div></div>${check}</div>
        <div class="recall-prompt">
          ${meaningMarkup || (state.settings.showMeaning ? '<div class="item-meaning missing-example">뜻 미입력</div>' : "")}
          ${state.settings.showExample ? blankExampleMarkup(entry.word, entry.example) : ""}
        </div>
        <div class="practice-slots">${practiceSlots(slotCount, "")}</div>`;
    } else {
      const word = entry.word || "(영단어 미입력)";
      const meaning = state.settings.showMeaning && entry.meaning ? escapeHTML(entry.meaning) : "뜻 힌트 없음";
      const example = state.settings.showExample ? blankExampleMarkup(entry.word, entry.example, true) : '<span class="no-hint">예문 힌트 없음</span>';
      element.innerHTML = `
        <div class="item-heading">${numberMarkup}<div></div><span></span></div>
        <div class="mixed-stages">
          <div class="mixed-stage"><div class="stage-label"><span class="stage-index">1</span>단어를 보며 쓰기</div><div class="stage-hint item-word">${escapeHTML(word)}</div>${singlePracticeSlot(entry.meaning)}</div>
          <div class="mixed-stage"><div class="stage-label"><span class="stage-index">2</span>뜻만 보고 쓰기</div><div class="stage-hint">${meaning}</div>${singlePracticeSlot("")}</div>
          <div class="mixed-stage"><div class="stage-label"><span class="stage-index">3</span>빈칸 예문으로 쓰기</div><div class="stage-hint">${example}</div>${singlePracticeSlot("")}</div>
          <div class="mixed-stage"><div class="stage-label"><span class="stage-index">4</span>힌트 없이 쓰기</div><div class="stage-hint no-hint">기억에서 꺼내세요.</div>${singlePracticeSlot("")}</div>
        </div>`;
    }
    return element;
  }

  function practiceSlots(count, hint) {
    return Array.from({ length: count }, () => singlePracticeSlot(hint)).join("");
  }

  function singlePracticeSlot(hint) {
    return `<div class="practice-slot">${hint ? `<span class="slot-guide">${escapeHTML(hint)}</span>` : ""}</div>`;
  }

  function blankExampleMarkup(word, example, compact = false) {
    if (!example) {
      return `<div class="${compact ? "" : "prompt-example "}missing-example">예문 없음 · 기억에서 단어를 꺼내 쓰세요.</div>`;
    }
    if (!word) {
      return `<div class="${compact ? "" : "prompt-example "}missing-example">${escapeHTML(example)} · <span class="blank-token">&nbsp;</span></div>`;
    }
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let regex;
    try {
      regex = new RegExp(`(^|[^A-Za-z0-9_])(${escapedWord})(?=$|[^A-Za-z0-9_])`, "i");
    } catch {
      regex = null;
    }
    const match = regex ? example.match(regex) : null;
    if (match && typeof match.index === "number") {
      const start = match.index + match[1].length;
      const before = example.slice(0, start);
      const after = example.slice(start + match[2].length);
      return `<div class="${compact ? "" : "prompt-example"}">${escapeHTML(before)}<span class="blank-token">&nbsp;</span>${escapeHTML(after)}</div>`;
    }
    return `<div class="${compact ? "" : "prompt-example"}">${escapeHTML(example)} <span class="missing-example">· 알맞은 단어:</span> <span class="blank-token">&nbsp;</span></div>`;
  }

  function answerItem(entry, number) {
    const element = document.createElement("div");
    element.className = "answer-item";
    element.innerHTML = `
      <span class="answer-number">${number}.</span>
      <div><div class="answer-word">${escapeHTML(entry.word || "(영단어 미입력)")}</div>${entry.meaning ? `<div class="answer-meaning">${escapeHTML(entry.meaning)}</div>` : ""}</div>`;
    return element;
  }

  function paperDimensions() {
    return PAPER_SIZES[state.settings.paperSize][state.settings.orientation];
  }

  function sheetStyle(columns) {
    const [width, height] = paperDimensions();
    return [
      `width:${width}mm`,
      `height:${height}mm`,
      `padding:${state.settings.marginMm}mm`,
      `--sheet-columns:${columns}`,
      `--sheet-font-size:${state.settings.fontPt}pt`,
      `--slot-height:${state.settings.slotHeightMm}mm`,
      `--item-gap:${state.settings.itemGapMm}mm`,
      `--column-gap:${state.settings.columnGapMm}mm`,
      `--hint-opacity:${state.settings.hintOpacity}`
    ].join(";");
  }

  function groupTitle(entries) {
    if (!state.settings.showGroupTitle || !entries.length) return "";
    const dayFilter = dom.dayFilter.value;
    const unitFilter = dom.unitFilter.value;
    const parts = [];
    if (dayFilter) parts.push(`Day ${dayFilter}`);
    else {
      const days = uniqueValues(entries.map((entry) => entry.day));
      if (days.length === 1) parts.push(`Day ${days[0]}`);
    }
    if (unitFilter) parts.push(unitFilter);
    else {
      const units = uniqueValues(entries.map((entry) => entry.unit));
      if (units.length === 1) parts.push(units[0]);
    }
    const lessons = uniqueValues(entries.map((entry) => entry.lesson));
    if (lessons.length === 1) parts.push(`${lessons[0]}과`);
    return parts.join(" · ");
  }

  function createSheetPage({ columns, answer = false, group = "", itemCount = 0 }) {
    const page = document.createElement("section");
    page.className = `sheet-page${answer ? " answer-page" : ""}`;
    page.style.cssText = sheetStyle(columns);
    page.dataset.kind = answer ? "answer" : "worksheet";
    page.innerHTML = `
      <header class="sheet-header">
        <div>
          <p class="sheet-kicker">${answer ? "ANSWER KEY" : escapeHTML(MODE_LABELS[state.settings.mode].toUpperCase())}</p>
          <h2 class="sheet-title">${escapeHTML(answer ? `${state.settings.documentTitle} · 정답지` : state.settings.documentTitle)}</h2>
        </div>
        <div class="sheet-meta">${escapeHTML(group)}${group && itemCount ? " · " : ""}${itemCount ? `${itemCount} words` : ""}</div>
      </header>
      <div class="sheet-body">${Array.from({ length: columns }, () => '<div class="sheet-column"></div>').join("")}</div>
      <footer class="sheet-footer">
        <span class="student-fields">이름 ____________________</span>
        <span class="page-number">1 / 1</span>
        <span class="footer-brand">의미연결 깜지 생성기</span>
      </footer>`;
    return page;
  }

  function paginate(items, { columns, maxPerPage, answer = false, group = "" }) {
    const pages = [];
    let page = null;
    let columnIndex = 0;
    let pageItemCount = 0;
    let columnCounts = [];
    let caps = [];
    let oversize = 0;

    const startPage = () => {
      page = createSheetPage({ columns, answer, group, itemCount: items.length });
      dom.measureRoot.append(page);
      pages.push(page);
      columnIndex = 0;
      pageItemCount = 0;
      columnCounts = Array(columns).fill(0);
      const base = Math.floor(maxPerPage / columns);
      const remainder = maxPerPage % columns;
      caps = Array.from({ length: columns }, (_, index) => base + (index < remainder ? 1 : 0));
    };

    const nextColumnOrPage = () => {
      columnIndex += 1;
      if (columnIndex >= columns) startPage();
    };

    startPage();
    items.forEach((item) => {
      if (pageItemCount >= maxPerPage) startPage();
      if (columnCounts[columnIndex] >= Math.max(1, caps[columnIndex])) nextColumnOrPage();

      let column = page.querySelectorAll(".sheet-column")[columnIndex];
      column.append(item);
      const fits = column.scrollHeight <= column.clientHeight + 1;
      if (!fits && columnCounts[columnIndex] > 0) {
        item.remove();
        nextColumnOrPage();
        column = page.querySelectorAll(".sheet-column")[columnIndex];
        column.append(item);
      }

      if (column.scrollHeight > column.clientHeight + 1 && columnCounts[columnIndex] === 0) {
        item.classList.add("oversize-item");
        oversize += 1;
      }
      columnCounts[columnIndex] += 1;
      pageItemCount += 1;
    });

    return { pages, oversize };
  }

  function renderWorksheet() {
    clearTimeout(renderTimer);
    dom.measureRoot.replaceChildren();
    const entries = printableEntries();
    const group = groupTitle(entries);
    const columns = state.settings.columns;
    let worksheetPages = [];
    let answerPages = [];
    let oversize = 0;

    updatePageRule();

    if (!entries.length) {
      const page = createSheetPage({ columns, group: "", itemCount: 0 });
      page.querySelector(".sheet-body").innerHTML = '<div class="empty-sheet-message" style="grid-column:1/-1"><div><strong>인쇄할 단어가 없습니다.</strong><span>단어를 입력하거나 필터를 해제하세요.</span></div></div>';
      dom.measureRoot.append(page);
      worksheetPages = [page];
    } else {
      const worksheetItems = entries.map((entry, index) => worksheetItem(entry, index + 1));
      const result = paginate(worksheetItems, {
        columns,
        maxPerPage: state.settings.wordsPerPage,
        answer: false,
        group
      });
      worksheetPages = result.pages;
      oversize += result.oversize;

      if (state.settings.includeAnswerKey) {
        const answerItems = entries.map((entry, index) => answerItem(entry, index + 1));
        const answerResult = paginate(answerItems, {
          columns: 2,
          maxPerPage: 40,
          answer: true,
          group
        });
        answerPages = answerResult.pages;
        oversize += answerResult.oversize;
      }
    }

    const pages = [...worksheetPages, ...answerPages];
    pages.forEach((page, index) => {
      page.querySelector(".page-number").textContent = `${index + 1} / ${pages.length}`;
      page.dataset.pageNumber = String(index + 1);
    });
    dom.printRoot.replaceChildren(...pages);

    requestAnimationFrame(() => {
      const clipped = detectClipping();
      lastDiagnostics = {
        pages: pages.length,
        worksheetPages: worksheetPages.length,
        answerPages: answerPages.length,
        clipped,
        oversize,
        printableEntries: entries.length
      };
      updatePreviewStatus();
      if (fitAutomatically) fitPreview();
      document.dispatchEvent(new CustomEvent("meaninglink:rendered", { detail: { ...lastDiagnostics } }));
    });
  }

  function detectClipping() {
    let clipped = 0;
    dom.printRoot.querySelectorAll(".sheet-column").forEach((column) => {
      if (column.scrollHeight > column.clientHeight + 2) clipped += 1;
    });
    dom.printRoot.querySelectorAll(".sheet-page").forEach((page) => {
      if (page.scrollHeight > page.clientHeight + 2) clipped += 1;
    });
    return clipped;
  }

  function updatePreviewStatus() {
    const { pages, worksheetPages, answerPages, clipped, oversize, printableEntries } = lastDiagnostics;
    const issues = clipped + oversize;
    dom.previewHealth.classList.toggle("warning", issues > 0);
    dom.previewHealth.classList.toggle("error", clipped > 0);
    if (!printableEntries) {
      dom.previewStatusText.textContent = `${pages}쪽 · 단어 없음`;
      dom.previewNotice.textContent = "인쇄할 단어가 없습니다. 입력 목록 또는 필터를 확인하세요.";
    } else if (issues) {
      dom.previewStatusText.textContent = `${pages}쪽 · 배치 확인 필요`;
      dom.previewNotice.textContent = `매우 긴 항목 ${oversize}개 또는 넘침 ${clipped}곳이 있습니다. 글씨·쓰기 칸을 줄이거나 1쪽 단어 수를 낮춰 주세요.`;
    } else {
      dom.previewStatusText.textContent = `${pages}쪽 · 잘림 없음`;
      dom.previewNotice.textContent = "";
    }
    const answerText = answerPages ? ` · 정답 ${answerPages}쪽` : "";
    dom.mobilePageCount.textContent = `${worksheetPages}쪽${answerText}`;
  }

  function updatePageRule() {
    const [width, height] = paperDimensions();
    dom.pageStyle.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
  }

  function fitPreview() {
    const firstPage = dom.printRoot.querySelector(".sheet-page");
    if (!firstPage || dom.previewViewport.clientWidth === 0) return;
    fitAutomatically = true;
    dom.printRoot.style.zoom = "1";
    const available = Math.max(260, dom.previewViewport.clientWidth - 34);
    const width = firstPage.getBoundingClientRect().width;
    previewScale = clamp(available / width, 0.28, 1);
    dom.printRoot.style.zoom = String(previewScale);
    dom.fitPreviewBtn.textContent = `${Math.round(previewScale * 100)}% 맞춤`;
  }

  function setManualZoom(scale) {
    fitAutomatically = false;
    previewScale = clamp(scale, 0.28, 1.4);
    dom.printRoot.style.zoom = String(previewScale);
    dom.fitPreviewBtn.textContent = `${Math.round(previewScale * 100)}%`;
  }

  function printWorksheet() {
    saveNow();
    renderWorksheet();
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  function openImportDialog() {
    if (typeof dom.importDialog.showModal === "function") dom.importDialog.showModal();
    else dom.importDialog.setAttribute("open", "");
    requestAnimationFrame(() => dom.pasteInput.focus());
  }

  function resetImportDialogState() {
    importState = { rows: [], delimiter: "", sourceName: "", mapping: {}, detectedHeader: false };
    dom.pasteInput.value = "";
    dom.dataFileInput.value = "";
    dom.fileNameLabel.textContent = "선택된 파일 없음";
    dom.detectionResult.textContent = "붙여넣거나 파일을 선택하세요.";
    dom.importPreviewBody.innerHTML = '<tr><td colspan="5">분석 결과가 여기에 표시됩니다.</td></tr>';
    dom.confirmImportBtn.disabled = true;
    dom.confirmImportBtn.textContent = "0개 가져오기";
    document.querySelectorAll("[data-map-field]").forEach((select) => select.replaceChildren(new Option("가져오지 않음", "")));
  }

  function analyzePastedText() {
    const text = dom.pasteInput.value;
    if (!text) {
      showToast("먼저 텍스트를 붙여넣어 주세요.");
      return;
    }
    const forced = dom.delimiterSelect.value;
    const result = parseDelimited(text, forced);
    setImportRows(result.rows, result.delimiter, "붙여넣은 텍스트");
  }

  function delimiterCharacter(value) {
    return { tab: "\t", pipe: "|", comma: ",", semicolon: ";" }[value] || value;
  }

  function delimiterLabel(value) {
    return { "\t": "탭", "|": "|", ",": "쉼표", ";": "세미콜론" }[value] || "단일 열";
  }

  function detectDelimiter(text) {
    const candidates = ["\t", "|", ",", ";"];
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 12);
    if (!lines.length) return "\t";
    let best = { delimiter: "\t", score: -1, consistency: -1 };
    candidates.forEach((delimiter) => {
      const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter));
      const positive = counts.filter((count) => count > 0);
      const score = positive.reduce((sum, count) => sum + count, 0);
      const consistency = positive.length ? positive.filter((count) => count === positive[0]).length / lines.length : 0;
      if (score > best.score || (score === best.score && consistency > best.consistency)) {
        best = { delimiter, score, consistency };
      }
    });
    return best.score > 0 ? best.delimiter : "\t";
  }

  function countDelimiterOutsideQuotes(line, delimiter) {
    let quoted = false;
    let count = 0;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === '"') {
        if (quoted && line[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && line[index] === delimiter) count += 1;
    }
    return count;
  }

  function parseDelimited(text, forced = "auto") {
    const source = asString(text).replace(/^\uFEFF/, "");
    const delimiter = forced === "auto" ? detectDelimiter(source) : delimiterCharacter(forced);
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && char === delimiter) {
        row.push(cell);
        cell = "";
      } else if (!quoted && (char === "\n" || char === "\r")) {
        if (char === "\r" && source[index + 1] === "\n") index += 1;
        row.push(cell);
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
    return { rows, delimiter };
  }

  function detectHeaderRow(row) {
    if (!Array.isArray(row)) return false;
    let matches = 0;
    row.forEach((value) => {
      const normalized = asString(value).trim().toLocaleLowerCase("en");
      if (Object.values(HEADER_SYNONYMS).some((synonyms) => synonyms.includes(normalized))) matches += 1;
    });
    return matches >= 1;
  }

  function suggestedMapping(rows, hasHeader) {
    const maxColumns = Math.max(0, ...rows.map((row) => row.length));
    const mapping = { word: -1, meaning: -1, example: -1, day: -1, unit: -1, lesson: -1, tags: -1 };
    if (hasHeader && rows[0]) {
      rows[0].forEach((value, index) => {
        const normalized = asString(value).trim().toLocaleLowerCase("en");
        Object.entries(HEADER_SYNONYMS).forEach(([field, synonyms]) => {
          if (mapping[field] === -1 && synonyms.includes(normalized)) mapping[field] = index;
        });
      });
    }
    if (mapping.word === -1 && maxColumns > 0) mapping.word = 0;
    if (mapping.meaning === -1 && maxColumns > 1) mapping.meaning = 1;
    if (mapping.example === -1 && maxColumns > 2) mapping.example = 2;
    if (mapping.day === -1 && maxColumns > 3) mapping.day = 3;
    if (mapping.unit === -1 && maxColumns > 4) mapping.unit = 4;
    if (mapping.lesson === -1 && maxColumns > 5) mapping.lesson = 5;
    if (mapping.tags === -1 && maxColumns > 6) mapping.tags = 6;
    return mapping;
  }

  function setImportRows(rows, delimiter, sourceName) {
    if (!Array.isArray(rows) || !rows.length) {
      importState = { rows: [], delimiter, sourceName, mapping: {}, detectedHeader: false };
      dom.detectionResult.textContent = "가져올 행을 찾지 못했습니다.";
      dom.confirmImportBtn.disabled = true;
      updateImportPreview();
      return;
    }
    const detectedHeader = detectHeaderRow(rows[0]);
    importState = { rows, delimiter, sourceName, mapping: {}, detectedHeader };
    dom.headerRowInput.checked = detectedHeader;
    populateMappingSelectors(false);
    updateImportPreview();
    const columns = Math.max(...rows.map((row) => row.length));
    dom.detectionResult.textContent = `${sourceName} · ${rows.length}행 · ${columns}열 · ${delimiterLabel(delimiter)}`;
  }

  function populateMappingSelectors(preserveSelections) {
    const hasHeader = dom.headerRowInput.checked;
    const suggested = suggestedMapping(importState.rows, hasHeader);
    const maxColumns = Math.max(0, ...importState.rows.map((row) => row.length));
    document.querySelectorAll("[data-map-field]").forEach((select) => {
      const field = select.dataset.mapField;
      const previous = preserveSelections ? Number(select.value) : suggested[field];
      const options = [new Option("가져오지 않음", "-1")];
      for (let index = 0; index < maxColumns; index += 1) {
        const header = hasHeader ? asString(importState.rows[0]?.[index]) : "";
        options.push(new Option(header || `열 ${index + 1}`, String(index)));
      }
      select.replaceChildren(...options);
      select.value = String(Number.isInteger(previous) && previous < maxColumns ? previous : -1);
    });
  }

  function mappedImportEntries() {
    if (!importState.rows.length) return [];
    const start = dom.headerRowInput.checked ? 1 : 0;
    const mapping = {};
    document.querySelectorAll("[data-map-field]").forEach((select) => {
      mapping[select.dataset.mapField] = Number(select.value);
    });
    importState.mapping = mapping;
    return importState.rows.slice(start).map((row) => {
      const values = {};
      Object.keys(FIELD_LABELS).forEach((field) => {
        const index = mapping[field];
        values[field] = index >= 0 ? asString(row[index]) : "";
      });
      return values;
    }).filter((entry) => entry.word !== "" || entry.meaning !== "" || entry.example !== "");
  }

  function updateImportPreview() {
    const entries = mappedImportEntries();
    dom.importPreviewBody.replaceChildren();
    if (!entries.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5">가져올 수 있는 행이 없습니다. 열 매핑을 확인하세요.</td>';
      dom.importPreviewBody.append(row);
    } else {
      entries.slice(0, 10).forEach((entry) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${escapeHTML(entry.word)}</td><td>${escapeHTML(entry.meaning)}</td><td>${escapeHTML(entry.example)}</td><td>${escapeHTML(entry.day)}</td><td>${escapeHTML(entry.unit)}</td>`;
        dom.importPreviewBody.append(row);
      });
      if (entries.length > 10) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="5">외 ${entries.length - 10}개 행</td>`;
        dom.importPreviewBody.append(row);
      }
    }
    dom.confirmImportBtn.disabled = entries.length === 0;
    dom.confirmImportBtn.textContent = `${entries.length}개 가져오기`;
  }

  function confirmImport() {
    const entries = mappedImportEntries();
    if (!entries.length) return;
    const mode = document.querySelector('input[name="importMode"]:checked')?.value || "append";
    const imported = entries.map((entry) => newEntry(entry, false));
    if (mode === "replace") state.entries = imported;
    else state.entries.push(...imported);
    selectedIds.clear();
    dom.dayFilter.value = "";
    dom.unitFilter.value = "";
    dom.searchInput.value = "";
    dom.importDialog.close();
    commit({ entries: true, immediateRender: true });
    showToast(`${imported.length}개 단어를 ${mode === "replace" ? "새 목록으로" : "추가로"} 가져왔습니다.`);
  }

  async function processDataFile(file) {
    const name = file.name || "가져온 파일";
    const extension = name.split(".").pop()?.toLocaleLowerCase("en");
    dom.fileNameLabel.textContent = name;
    try {
      if (extension === "xlsx" || extension === "xls") {
        if (!globalThis.XLSX) throw new Error("XLSX 읽기 모듈을 불러오지 못했습니다.");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("엑셀 파일에 시트가 없습니다.");
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: "", raw: false, blankrows: false });
        setImportRows(rows.map((row) => row.map(asString)), "XLSX", `${name} · ${firstSheetName}`);
      } else {
        const text = await file.text();
        dom.pasteInput.value = text;
        const forced = extension === "tsv" ? "tab" : extension === "csv" ? "comma" : dom.delimiterSelect.value;
        const result = parseDelimited(text, forced);
        setImportRows(result.rows, result.delimiter, name);
      }
    } catch (error) {
      console.error("파일 가져오기 실패", error);
      importState.rows = [];
      updateImportPreview();
      dom.detectionResult.textContent = error.message || "파일을 읽지 못했습니다.";
      showToast("파일을 읽지 못했습니다. 형식과 내용을 확인해 주세요.");
    }
  }

  function exportJson() {
    const payload = { ...serializableState(), exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, `${safeFilename(state.settings.documentTitle)}-백업.json`);
    showToast("전체 데이터 백업을 만들었습니다.");
  }

  async function importJsonFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const entries = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entries)) throw new Error("entries 배열이 없습니다.");
      const nextEntries = entries.map((entry) => newEntry(entry, Boolean(entry?.isSample)));
      if (!window.confirm(`JSON에서 ${nextEntries.length}개 단어를 불러오고 현재 목록을 교체할까요?`)) return;
      state.entries = nextEntries;
      if (parsed.settings && typeof parsed.settings === "object") state.settings = normalizeSettings(parsed.settings);
      selectedIds.clear();
      commit({ entries: true, settings: true, immediateRender: true });
      showToast("JSON 백업을 복원했습니다.");
    } catch (error) {
      console.error("JSON 가져오기 실패", error);
      showToast("올바른 의미연결 JSON 파일이 아닙니다.");
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadExistingFile(path, filename) {
    const anchor = document.createElement("a");
    anchor.href = path;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  async function installPwa() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    dom.installBtn.classList.add("hidden");
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("오프라인 캐시 등록 실패", error));
  }

  function exposeDebugApi() {
    globalThis.MeaningLinkApp = Object.freeze({
      version: SCHEMA_VERSION,
      storageKey: STORAGE_KEY,
      parseDelimited,
      detectDelimiter,
      detectHeaderRow,
      blankExampleMarkup,
      getState: () => JSON.parse(JSON.stringify(serializableState())),
      getDiagnostics: () => ({ ...lastDiagnostics }),
      setEntries: (entries) => {
        if (!Array.isArray(entries)) throw new TypeError("entries must be an array");
        state.entries = entries.map((entry) => newEntry(entry, false));
        selectedIds.clear();
        commit({ entries: true, immediateRender: true });
      },
      setSettings: (settings) => {
        state.settings = normalizeSettings({ ...state.settings, ...settings });
        commit({ settings: true, immediateRender: true });
      },
      render: renderWorksheet,
      save: saveNow,
      reset: () => {
        state = makeInitialState();
        selectedIds.clear();
        commit({ entries: true, settings: true, immediateRender: true });
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
