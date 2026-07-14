(() => {
  "use strict";

  const CONFIG = window.PINE_CONFIG || {};
  const STORAGE_KEY = "pine:notices:v1";
  const SAVED_KEY = "pine:saved:v1";
  const CHANNEL_NAME = "pine-notices";
  const SUPABASE_MODULE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
  const CATEGORIES = ["학사", "행사", "동아리", "대회", "진로", "봉사", "기타"];
  const CATEGORY_COLORS = {
    학사: "#b9d7ff",
    행사: "#ffdb55",
    동아리: "#f0b9ff",
    대회: "#ffad8f",
    진로: "#9ed9ff",
    봉사: "#a9e7c9",
    기타: "#deded8",
  };
  const POSTER_PALETTES = [
    ["#00b968", "#111312", "#ffffff"],
    ["#ffdb55", "#111312", "#ffffff"],
    ["#b9d7ff", "#111312", "#00b968"],
    ["#f0b9ff", "#111312", "#ffffff"],
    ["#111312", "#ffffff", "#00b968"],
    ["#ffad8f", "#111312", "#fff5cf"],
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = startOfDay(new Date());
  const savedIds = new Set(readJSON(SAVED_KEY, []));
  const state = {
    notices: [],
    category: "전체",
    query: "",
    sort: "latest",
    view: "grid",
    savedOnly: false,
    repository: null,
    selectedId: null,
    uploadBlob: null,
    uploadPreviewUrl: "",
  };

  const refs = {
    list: $("#notice-list"),
    empty: $("#empty-state"),
    resultCount: $("#result-count"),
    search: $("#search-input"),
    sort: $("#sort-select"),
    reset: $("#reset-filter"),
    sync: $("#sync-state"),
    addModal: $("#add-modal"),
    detailModal: $("#detail-modal"),
    detailContent: $("#detail-content"),
    form: $("#notice-form"),
    submit: $("#submit-button"),
    imageInput: $("#image-input"),
    imagePreview: $("#image-preview"),
    uploadPlaceholder: $("#upload-placeholder"),
    uploadArea: $("#poster-upload"),
    toastRegion: $("#toast-region"),
  };

  init();

  async function init() {
    bindEvents();
    setDefaultFormDate();
    renderSkeletons();

    try {
      state.repository = await createRepository();
      updateSyncState(state.repository.mode, state.repository.mode === "remote" ? "실시간 동기화" : "이 기기 데모");
      await refreshNotices();
      state.repository.subscribe?.(refreshNotices);
    } catch (error) {
      console.error(error);
      state.repository = createLocalRepository();
      updateSyncState("error", "연결 오류");
      await refreshNotices();
      toast("클라우드 연결에 실패해 로컬 모드로 열었어요.", "error");
    }
  }

  function bindEvents() {
    $$(".add-trigger").forEach((button) => button.addEventListener("click", openAddModal));
    $$(".modal-close").forEach((button) => button.addEventListener("click", closeAddModal));
    $(".detail-close").addEventListener("click", () => refs.detailModal.close());

    refs.addModal.addEventListener("click", closeOnBackdrop);
    refs.detailModal.addEventListener("click", closeOnBackdrop);
    refs.form.addEventListener("submit", submitNotice);
    refs.form.elements.title.addEventListener("input", (event) => {
      $("#title-length").textContent = String(event.target.value.length);
    });

    refs.search.addEventListener("input", debounce((event) => {
      state.query = event.target.value.trim().toLocaleLowerCase("ko");
      state.savedOnly = false;
      render();
    }, 120));
    refs.sort.addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });
    $("#category-list").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-category]");
      if (!chip) return;
      state.category = chip.dataset.category;
      state.savedOnly = false;
      $$(".category-chip").forEach((button) => button.classList.toggle("is-active", button === chip));
      render();
    });
    refs.reset.addEventListener("click", resetFilters);
    $("#grid-view").addEventListener("click", () => setView("grid"));
    $("#list-view").addEventListener("click", () => setView("list"));
    $("#browse-trigger").addEventListener("click", () => $("#notices").scrollIntoView({ behavior: "smooth" }));
    $("#mobile-search").addEventListener("click", focusMobileSearch);
    $("#mobile-saved").addEventListener("click", showSaved);
    $("#mobile-info").addEventListener("click", () => toast("Pine은 누구나 소식을 공유하는 학교 게시판이에요."));

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (event.key === "/" && !typing && !refs.addModal.open && !refs.detailModal.open) {
        event.preventDefault();
        refs.search.focus();
      }
    });

    refs.imageInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await prepareImage(file);
    });
    ["dragenter", "dragover"].forEach((type) => refs.uploadArea.addEventListener(type, (event) => {
      event.preventDefault();
      refs.uploadArea.classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach((type) => refs.uploadArea.addEventListener(type, (event) => {
      event.preventDefault();
      refs.uploadArea.classList.remove("is-dragging");
    }));
    refs.uploadArea.addEventListener("drop", async (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) await prepareImage(file);
    });
  }

  async function createRepository() {
    const configured = /^https:\/\/.+\.supabase\.co\/?$/i.test(CONFIG.supabaseUrl || "") && (CONFIG.supabaseAnonKey || "").length > 40;
    if (!configured) return createLocalRepository();

    const { createClient } = await import(SUPABASE_MODULE);
    const client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let listener = null;

    return {
      mode: "remote",
      async load() {
        const { data, error } = await client.from("notices").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []).map(fromDatabase);
      },
      async add(notice, imageBlob) {
        let imageUrl = null;
        if (imageBlob) {
          const extension = imageBlob.type === "image/webp" ? "webp" : imageBlob.type === "image/png" ? "png" : "jpg";
          const path = `${new Date().toISOString().slice(0, 10)}/${uniqueId()}.${extension}`;
          const { error: uploadError } = await client.storage.from("flyers").upload(path, imageBlob, {
            cacheControl: "31536000",
            contentType: imageBlob.type,
            upsert: false,
          });
          if (uploadError) throw uploadError;
          imageUrl = client.storage.from("flyers").getPublicUrl(path).data.publicUrl;
        }
        const payload = toDatabase({ ...notice, imageUrl });
        const { data, error } = await client.from("notices").insert(payload).select().single();
        if (error) throw error;
        return fromDatabase(data);
      },
      subscribe(callback) {
        listener = callback;
        client.channel("pine-public-notices")
          .on("postgres_changes", { event: "*", schema: "public", table: "notices" }, () => listener?.())
          .subscribe();
      },
    };
  }

  function createLocalRepository() {
    const broadcast = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
    let listener = null;
    broadcast?.addEventListener("message", () => listener?.());
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) listener?.();
    });
    return {
      mode: "local",
      async load() { return readJSON(STORAGE_KEY, []); },
      async add(notice, imageBlob) {
        const items = readJSON(STORAGE_KEY, []);
        const imageUrl = imageBlob ? await blobToDataUrl(imageBlob) : null;
        const item = { ...notice, id: uniqueId(), imageUrl, createdAt: new Date().toISOString(), popularity: 0 };
        items.unshift(item);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        } catch (error) {
          if (error?.name === "QuotaExceededError") {
            item.imageUrl = null;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
            toast("브라우저 저장 공간이 부족해 이미지는 자동 포스터로 바꿨어요.", "error");
          } else {
            throw error;
          }
        }
        broadcast?.postMessage({ type: "changed" });
        return item;
      },
      subscribe(callback) { listener = callback; },
    };
  }

  async function refreshNotices() {
    const loaded = await state.repository.load();
    const demos = CONFIG.showDemoContent === false ? [] : createDemoNotices();
    state.notices = [...loaded, ...demos];
    render();
  }

  function render() {
    let items = [...state.notices];
    if (state.category !== "전체") items = items.filter((item) => item.category === state.category);
    if (state.query) {
      items = items.filter((item) => [item.title, item.summary, item.organization, item.location, ...(item.tags || [])]
        .join(" ").toLocaleLowerCase("ko").includes(state.query));
    }
    if (state.savedOnly) items = items.filter((item) => savedIds.has(item.id));

    items.sort((a, b) => {
      if (state.sort === "deadline") return dateValue(a.eventDate) - dateValue(b.eventDate);
      if (state.sort === "popular") return (b.popularity || 0) - (a.popularity || 0);
      return dateValue(b.createdAt) - dateValue(a.createdAt);
    });

    refs.list.classList.toggle("is-list", state.view === "list");
    refs.list.innerHTML = items.map(noticeCardHTML).join("");
    refs.list.setAttribute("aria-busy", "false");
    refs.resultCount.textContent = String(items.length);
    refs.empty.hidden = items.length !== 0;
    refs.list.hidden = items.length === 0;
    refs.reset.hidden = state.category === "전체" && !state.query && !state.savedOnly;
    $("#today-count").textContent = String(state.notices.filter((item) => isToday(item.createdAt)).length);

    $$(".notice-card", refs.list).forEach((card) => {
      card.addEventListener("click", () => openDetail(card.dataset.id));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail(card.dataset.id);
        }
      });
    });
    $$(".notice-save", refs.list).forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSaved(button.dataset.id);
    }));
  }

  function noticeCardHTML(item) {
    const saved = savedIds.has(item.id);
    const urgency = deadlineLabel(item.eventDate);
    const imageUrl = safeImageUrl(item.imageUrl) || makePosterDataUrl(item);
    const tags = (item.tags || []).slice(0, 2).map((tag) => `<span class="notice-tag">#${escapeHTML(tag)}</span>`).join("");
    return `
      <article class="notice-card" tabindex="0" role="button" data-id="${escapeHTML(item.id)}" aria-label="${escapeHTML(item.title)} 상세 보기">
        <div class="notice-thumb">
          <img src="${escapeHTML(imageUrl)}" alt="${escapeHTML(item.title)} 전단지" loading="lazy" />
          <span class="notice-badge" style="--badge:${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.기타}">${escapeHTML(item.category)}</span>
          <button class="notice-save${saved ? " is-saved" : ""}" type="button" data-id="${escapeHTML(item.id)}" aria-label="${saved ? "관심 공고에서 삭제" : "관심 공고로 저장"}" aria-pressed="${saved}">
            <svg viewBox="0 0 24 24"><use href="#icon-bookmark"></use></svg>
          </button>
        </div>
        <div class="notice-body">
          <p class="notice-org">${escapeHTML(item.organization || "학교 구성원")}</p>
          <h3 class="notice-title">${escapeHTML(item.title)}</h3>
          <p class="notice-summary">${escapeHTML(item.summary || "자세한 내용은 공고를 열어 확인해주세요.")}</p>
          ${tags ? `<div class="notice-tag-row">${tags}</div>` : ""}
          <div class="notice-meta">
            <svg viewBox="0 0 24 24"><use href="#icon-clock"></use></svg>
            <span class="${urgency.urgent ? "is-urgent" : ""}">${escapeHTML(urgency.text)}</span>
          </div>
        </div>
      </article>`;
  }

  function openDetail(id) {
    const item = state.notices.find((notice) => notice.id === id);
    if (!item) return;
    state.selectedId = id;
    const saved = savedIds.has(id);
    const imageUrl = safeImageUrl(item.imageUrl) || makePosterDataUrl(item);
    const externalUrl = safeExternalUrl(item.externalUrl);
    refs.detailContent.innerHTML = `
      <div class="detail-layout">
        <div class="detail-image"><img src="${escapeHTML(imageUrl)}" alt="${escapeHTML(item.title)} 전단지" /></div>
        <div class="detail-copy">
          <span class="detail-category" style="background:${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.기타}">${escapeHTML(item.category)}</span>
          <h2 id="detail-title">${escapeHTML(item.title)}</h2>
          <p class="detail-org">${escapeHTML(item.organization || "학교 구성원")}</p>
          <p class="detail-description">${escapeHTML(item.summary || "등록된 상세 설명이 없습니다.")}</p>
          <div class="detail-info">
            <p><strong>일정</strong><span>${escapeHTML(formatDate(item.eventDate))}</span></p>
            <p><strong>장소</strong><span>${escapeHTML(item.location || "공고에서 확인")}</span></p>
            <p><strong>등록</strong><span>${escapeHTML(formatDate(item.createdAt, true))}</span></p>
          </div>
          <div class="detail-actions">
            ${externalUrl ? `<a class="button button-primary" href="${escapeHTML(externalUrl)}" target="_blank" rel="noopener noreferrer">자세히 보기 <svg viewBox="0 0 24 24"><use href="#icon-external"></use></svg></a>` : ""}
            <button class="button button-secondary detail-save${saved ? " is-saved" : ""}" type="button" data-id="${escapeHTML(id)}">${saved ? "관심 공고 저장됨" : "관심 공고 저장"}</button>
            <button class="icon-button detail-share" type="button" aria-label="공유하기"><svg viewBox="0 0 24 24"><use href="#icon-share"></use></svg></button>
          </div>
        </div>
      </div>`;
    $(".detail-save", refs.detailContent)?.addEventListener("click", () => {
      toggleSaved(id);
      openDetail(id);
    });
    $(".detail-share", refs.detailContent)?.addEventListener("click", () => shareNotice(item));
    if (!refs.detailModal.open) refs.detailModal.showModal();
  }

  async function submitNotice(event) {
    event.preventDefault();
    if (!refs.form.reportValidity()) return;
    const data = new FormData(refs.form);
    const title = String(data.get("title") || "").trim();
    const category = String(data.get("category") || "");
    if (!CATEGORIES.includes(category)) {
      toast("카테고리를 다시 선택해주세요.", "error");
      return;
    }

    const notice = {
      title,
      category,
      eventDate: String(data.get("eventDate") || ""),
      organization: String(data.get("organization") || "").trim(),
      location: String(data.get("location") || "").trim(),
      summary: String(data.get("summary") || "").trim(),
      externalUrl: safeExternalUrl(String(data.get("externalUrl") || "")),
      tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean).slice(0, 6),
      createdAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      await state.repository.add(notice, state.uploadBlob);
      await refreshNotices();
      closeAddModal();
      toast(state.repository.mode === "remote" ? "공고가 등록되어 모든 기기에 동기화됐어요." : "공고가 이 기기에 등록됐어요.");
      $("#notices").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      console.error(error);
      toast(readableError(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  function openAddModal() {
    if (!refs.addModal.open) refs.addModal.showModal();
    requestAnimationFrame(() => refs.form.elements.title.focus());
  }

  function closeAddModal() {
    if (refs.addModal.open) refs.addModal.close();
    refs.form.reset();
    resetUpload();
    setDefaultFormDate();
    $("#title-length").textContent = "0";
  }

  function closeOnBackdrop(event) {
    if (event.target === event.currentTarget) event.currentTarget.close();
  }

  function resetFilters() {
    state.category = "전체";
    state.query = "";
    state.savedOnly = false;
    refs.search.value = "";
    $$(".category-chip").forEach((button) => button.classList.toggle("is-active", button.dataset.category === "전체"));
    render();
  }

  function setView(view) {
    state.view = view;
    ["grid", "list"].forEach((name) => {
      const button = $(`#${name}-view`);
      button.classList.toggle("is-active", name === view);
      button.setAttribute("aria-pressed", String(name === view));
    });
    render();
  }

  function focusMobileSearch() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    refs.search.focus({ preventScroll: true });
    toast("상단 검색창에 찾고 싶은 소식을 입력해보세요.");
  }

  function showSaved() {
    state.savedOnly = !state.savedOnly;
    $("#mobile-saved").classList.toggle("is-active", state.savedOnly);
    render();
    $("#notices").scrollIntoView({ behavior: "smooth" });
    if (state.savedOnly && savedIds.size === 0) toast("관심 공고로 저장한 소식이 아직 없어요.");
  }

  function toggleSaved(id) {
    if (savedIds.has(id)) {
      savedIds.delete(id);
      toast("관심 공고에서 뺐어요.");
    } else {
      savedIds.add(id);
      toast("관심 공고로 저장했어요.");
    }
    localStorage.setItem(SAVED_KEY, JSON.stringify([...savedIds]));
    render();
  }

  async function shareNotice(item) {
    const shareData = { title: item.title, text: `${item.title} · ${item.organization || "Pine"}`, url: location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
        toast("공유 링크를 복사했어요.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") toast("공유하지 못했어요. 다시 시도해주세요.", "error");
    }
  }

  async function prepareImage(file) {
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      toast("JPG, PNG, WEBP 이미지만 올릴 수 있어요.", "error");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast("이미지는 8MB 이하로 선택해주세요.", "error");
      return;
    }
    try {
      state.uploadBlob = await compressImage(file);
      if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
      state.uploadPreviewUrl = URL.createObjectURL(state.uploadBlob);
      refs.imagePreview.src = state.uploadPreviewUrl;
      refs.imagePreview.hidden = false;
      refs.uploadPlaceholder.hidden = true;
    } catch (error) {
      console.error(error);
      toast("이미지를 읽지 못했어요. 다른 파일을 선택해주세요.", "error");
    }
  }

  async function compressImage(file) {
    let source;
    let width;
    let height;
    let cleanup = () => {};
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
      cleanup = () => bitmap.close?.();
    } else {
      const objectUrl = URL.createObjectURL(file);
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = objectUrl;
      });
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
      cleanup = () => URL.revokeObjectURL(objectUrl);
    }
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    cleanup();
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image conversion failed")), "image/webp", .84));
  }

  function resetUpload() {
    state.uploadBlob = null;
    if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
    state.uploadPreviewUrl = "";
    refs.imagePreview.src = "";
    refs.imagePreview.hidden = true;
    refs.uploadPlaceholder.hidden = false;
  }

  function renderSkeletons() {
    refs.list.innerHTML = Array.from({ length: 8 }, () => `
      <div class="notice-card skeleton-card" aria-hidden="true">
        <div class="notice-thumb"></div><div class="notice-body"><div class="skeleton-line short"></div><div class="skeleton-line"></div><div class="skeleton-line medium"></div></div>
      </div>`).join("");
  }

  function updateSyncState(mode, label) {
    refs.sync.dataset.mode = mode;
    $(".sync-label", refs.sync).textContent = label;
    refs.sync.title = mode === "remote" ? "새 공고가 모든 기기에 실시간으로 반영됩니다." : "config.js에 Supabase 정보를 넣으면 모든 기기에서 동기화됩니다.";
  }

  function setSubmitting(isSubmitting) {
    refs.submit.disabled = isSubmitting;
    $("span", refs.submit).textContent = isSubmitting ? "등록하는 중…" : "공고 등록하기";
  }

  function setDefaultFormDate() {
    const dateInput = refs.form.elements.eventDate;
    dateInput.min = toDateInput(new Date());
    dateInput.value = toDateInput(addDays(today, 7));
  }

  function toast(message, tone = "success") {
    const element = document.createElement("div");
    element.className = `toast${tone === "error" ? " is-error" : ""}`;
    element.textContent = message;
    refs.toastRegion.append(element);
    window.setTimeout(() => element.remove(), 4200);
  }

  function createDemoNotices() {
    const demos = [
      { id: "demo-festival", category: "행사", title: "2026 여름제: 별빛 아래 우리의 장면", organization: "제24대 학생회 파도", location: "중앙광장", summary: "공연, 푸드트럭, 동아리 부스가 한자리에 모입니다. 가장 빛나는 여름밤을 함께 만들어요.", tags: ["여름제", "공연"], eventDate: toDateInput(addDays(today, 10)), popularity: 91, createdAgo: 0 },
      { id: "demo-photo", category: "동아리", title: "사진부 FRAME 신입 부원 모집", organization: "사진부 FRAME", location: "예술관 304호", summary: "카메라가 없어도, 처음이어도 괜찮아요. 학교의 순간을 함께 기록할 신입 부원을 기다립니다.", tags: ["신입모집", "사진"], eventDate: toDateInput(addDays(today, 4)), popularity: 76, createdAgo: 0 },
      { id: "demo-contest", category: "대회", title: "교내 창업 아이디어 피칭 데이", organization: "진로교육부", location: "창의융합실", summary: "일상의 문제를 바꾸는 여러분의 아이디어를 3분 동안 들려주세요. 우수팀에게 멘토링이 제공됩니다.", tags: ["창업", "아이디어"], eventDate: toDateInput(addDays(today, 3)), popularity: 84, createdAgo: 1 },
      { id: "demo-academic", category: "학사", title: "2학기 선택과목 수강 신청 안내", organization: "교무기획부", location: "온라인 신청", summary: "학년별 신청 시간과 과목별 유의사항을 확인한 뒤 기간 내 수강 신청을 완료해주세요.", tags: ["수강신청"], eventDate: toDateInput(addDays(today, 6)), popularity: 63, createdAgo: 0 },
      { id: "demo-career", category: "진로", title: "선배에게 듣는 대학 전공 토크", organization: "진로상담실", location: "본관 2층 시청각실", summary: "공학, 디자인, 경영 분야 선배들이 전공 선택 과정과 캠퍼스 생활을 솔직하게 들려드립니다.", tags: ["전공", "선배"], eventDate: toDateInput(addDays(today, 8)), popularity: 58, createdAgo: 1 },
      { id: "demo-volunteer", category: "봉사", title: "주말 유기동물 보호소 봉사자 모집", organization: "봉사동아리 다정", location: "늘봄 동물보호소", summary: "보호소 청소와 산책 봉사에 함께할 학생을 모집합니다. 교내 봉사시간 4시간이 인정됩니다.", tags: ["봉사시간", "동물"], eventDate: toDateInput(addDays(today, 12)), popularity: 71, createdAgo: 2 },
      { id: "demo-library", category: "기타", title: "여름방학 도서관 운영시간 변경", organization: "학교 도서관", location: "지혜관", summary: "방학 중 평일 운영시간은 오전 9시부터 오후 4시까지입니다. 토요일과 공휴일은 휴관합니다.", tags: ["도서관", "방학"], eventDate: toDateInput(addDays(today, 18)), popularity: 32, createdAgo: 2 },
      { id: "demo-band", category: "동아리", title: "밴드부 정기공연 오픈 리허설", organization: "밴드부 파장", location: "강당", summary: "정기공연 전 마지막 리허설을 공개합니다. 누구나 자유롭게 들어와 함께 즐길 수 있어요.", tags: ["밴드", "공연"], eventDate: toDateInput(addDays(today, 2)), popularity: 88, createdAgo: 0 },
    ];
    return demos.map((item, index) => ({
      ...item,
      createdAt: addDays(today, -item.createdAgo).toISOString(),
      externalUrl: "",
      imageUrl: null,
      posterIndex: index,
      isDemo: true,
    }));
  }

  function makePosterDataUrl(item) {
    const index = Number.isFinite(item.posterIndex) ? item.posterIndex : hashString(`${item.id}${item.title}`);
    const [background, foreground, accent] = POSTER_PALETTES[Math.abs(index) % POSTER_PALETTES.length];
    const titleLines = wrapTitle(item.title, 10, 4);
    const category = escapeXML(item.category || "소식");
    const org = escapeXML(item.organization || "PINE");
    const date = escapeXML(formatDate(item.eventDate));
    const lineMarkup = titleLines.map((line, lineIndex) => `<tspan x="54" dy="${lineIndex ? 62 : 0}">${escapeXML(line)}</tspan>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="840" viewBox="0 0 720 840">
      <rect width="720" height="840" fill="${background}"/>
      <path d="M0 0h160l18 18h210l18-18h314v31h-92l-14 14H455l-17-14H0z" fill="${accent}" opacity=".95"/>
      <path d="M0 812h160l18-16h226l18 20h142l14-11h142v35H0z" fill="${foreground}"/>
      <rect x="48" y="65" width="624" height="710" fill="none" stroke="${foreground}" stroke-width="4"/>
      <path d="M54 146h125l18 8h72" fill="none" stroke="${foreground}" stroke-width="4"/>
      <text x="54" y="126" fill="${foreground}" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="2">${category}</text>
      <text x="666" y="126" fill="${foreground}" font-family="Arial, sans-serif" font-size="20" text-anchor="end">${date}</text>
      <text x="54" y="238" fill="${foreground}" font-family="Arial, sans-serif" font-size="52" font-weight="800">${lineMarkup}</text>
      <circle cx="572" cy="608" r="74" fill="${accent}" stroke="${foreground}" stroke-width="4"/>
      <path d="m572 555-48 62h25l-34 43h43v37h28v-37h43l-34-43h25z" fill="${foreground}"/>
      <text x="54" y="720" fill="${foreground}" font-family="Arial, sans-serif" font-size="22" font-weight="700">${org}</text>
      <text x="54" y="753" fill="${foreground}" font-family="Arial, sans-serif" font-size="17" letter-spacing="3">SCHOOL NOTICE · PINE</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function wrapTitle(value, lineLength, maxLines) {
    const text = String(value || "새로운 학교 소식").trim();
    const words = [...text];
    const lines = [];
    while (words.length && lines.length < maxLines) lines.push(words.splice(0, lineLength).join(""));
    if (words.length) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
    return lines;
  }

  function deadlineLabel(value) {
    const target = startOfDay(new Date(`${value}T00:00:00`));
    const diff = Math.round((target - today) / 86400000);
    if (!Number.isFinite(diff)) return { text: "일정 미정", urgent: false };
    if (diff < 0) return { text: "일정 종료", urgent: false };
    if (diff === 0) return { text: "오늘 마감", urgent: true };
    if (diff <= 3) return { text: `마감 D-${diff}`, urgent: true };
    return { text: `${formatDate(value)}까지`, urgent: false };
  }

  function formatDate(value, withYear = false) {
    if (!value) return "일정 미정";
    const date = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(date.getTime())) return "일정 미정";
    return new Intl.DateTimeFormat("ko-KR", { year: withYear ? "numeric" : undefined, month: "long", day: "numeric", weekday: withYear ? undefined : "short" }).format(date);
  }

  function fromDatabase(row) {
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      summary: row.summary || "",
      organization: row.organization || "",
      location: row.location || "",
      eventDate: row.event_date,
      imageUrl: row.image_url,
      externalUrl: row.external_url || "",
      tags: Array.isArray(row.tags) ? row.tags : [],
      popularity: row.popularity || 0,
      createdAt: row.created_at,
    };
  }

  function toDatabase(item) {
    return {
      title: item.title,
      category: item.category,
      summary: item.summary || null,
      organization: item.organization,
      location: item.location || null,
      event_date: item.eventDate,
      image_url: item.imageUrl || null,
      external_url: item.externalUrl || null,
      tags: item.tags || [],
    };
  }

  function safeImageUrl(value) {
    if (!value) return "";
    try {
      if (/^data:image\/(svg\+xml|png|jpeg|webp)/i.test(value) || /^blob:/i.test(value)) return value;
      const url = new URL(value, location.href);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function safeExternalUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function readableError(error) {
    const text = String(error?.message || "").toLowerCase();
    if (text.includes("row-level security")) return "등록 권한 설정을 확인해주세요. supabase.sql을 실행했는지 확인하세요.";
    if (text.includes("bucket") || text.includes("storage")) return "이미지 저장소 설정을 확인해주세요.";
    if (!navigator.onLine) return "인터넷 연결을 확인한 뒤 다시 시도해주세요.";
    return "공고를 등록하지 못했어요. 잠시 후 다시 시도해주세요.";
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }
  function escapeXML(value) { return escapeHTML(value); }
  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; }
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  function debounce(callback, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); };
  }
  function uniqueId() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  function addDays(date, days) { const result = new Date(date); result.setDate(result.getDate() + days); return result; }
  function toDateInput(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function isToday(value) { const date = new Date(value); return date.toDateString() === new Date().toDateString(); }
  function dateValue(value) { const date = new Date(value || 0).getTime(); return Number.isFinite(date) ? date : 0; }
  function hashString(value) { return [...String(value)].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0); }
})();
