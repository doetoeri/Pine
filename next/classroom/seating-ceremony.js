const PHASES = Object.freeze(["idle", "intro", "countdown", "zones", "shuffle", "settle", "finale", "stable"]);

export const CEREMONY_TIMING = Object.freeze({
  intro: 1800,
  countdown: 3000,
  zones: 2400,
  shuffle: 2800,
  settle: 1050,
  finale: 1800,
});

const SHUFFLE_DELAYS = Object.freeze([115, 130, 150, 175, 205, 240, 285, 340, 410, 490]);
const phaseClass = phase => `ceremony-phase-${phase}`;

function seatingStats(view) {
  const seats = view?.general?.seats || [];
  const blocked = new Set(view?.general?.blocked || []);
  const rosterIds = new Set((view?.roster || []).map(student => student.uid));
  const assigned = seats.filter((uid, index) => uid && !blocked.has(index) && rosterIds.has(uid));
  const unique = new Set(assigned);
  return {
    assigned: assigned.length,
    duplicates: Math.max(0, assigned.length - unique.size),
    missing: Math.max(0, rosterIds.size - unique.size),
  };
}

function ceremonyRequested(params = new URL(location.href).searchParams) {
  const ceremony = params.get("ceremony");
  return ceremony === "1" || ceremony === "true" || ceremony === "ceremony" || params.get("reveal") === "ceremony";
}

export function isCeremonyRequested(params) {
  return ceremonyRequested(params);
}

export function createSeatingCeremony({
  root,
  enabled = ceremonyRequested(),
  logoUrl = "../assets/pincon-icon.svg",
} = {}) {
  let phase = "idle";
  let started = false;
  let currentView = null;
  let overlay = null;
  let launchOverlay = null;
  let shuffleTimer = 0;
  let phaseTimers = [];
  let shuffleTick = 0;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  if (enabled) document.body.classList.add("ceremony-pending");

  const clearTimers = () => {
    phaseTimers.forEach(clearTimeout);
    phaseTimers = [];
    if (shuffleTimer) clearTimeout(shuffleTimer);
    shuffleTimer = 0;
  };

  const byId = () => new Map((currentView?.roster || []).map(student => [student.uid, student]));

  function restoreNames() {
    const students = byId();
    root?.querySelectorAll(".planner-room .desk[data-seat-index]").forEach(desk => {
      const index = Number(desk.dataset.seatIndex);
      const uid = currentView?.general?.seats?.[index] || "";
      const student = students.get(uid);
      const name = desk.querySelector("strong");
      const number = desk.querySelector(".desk-number");
      const blocked = currentView?.general?.blocked?.includes(index);
      if (name) name.textContent = blocked ? "―" : student?.name || "빈자리";
      if (number) number.textContent = student && !blocked ? `${student.number}번` : "";
    });
  }

  function applySeatTiming() {
    root?.querySelectorAll(".planner-room .desk[data-seat-index]").forEach(desk => {
      const index = Number(desk.dataset.seatIndex);
      const row = Math.floor(index / 6);
      const col = index % 6;
      const zone = Number(desk.dataset.seatZone || Math.floor(col / 2) + 1) - 1;
      const settleOrder = row * 6 + col;
      const direction = zone === 0 ? -1 : zone === 2 ? 1 : row % 2 ? -1 : 1;
      desk.style.setProperty("--ceremony-zone-delay", `${zone * 640 + row * 28}ms`);
      desk.style.setProperty("--ceremony-settle-delay", `${Math.min(settleOrder, 33) * 8}ms`);
      desk.style.setProperty("--ceremony-shift-x", `${direction * (9 + (row % 2) * 3)}px`);
      desk.style.setProperty("--ceremony-shift-y", `${((row % 3) - 1) * 5}px`);
      desk.style.setProperty("--ceremony-name-shift", `${direction * 10}px`);
    });
  }

  function shuffleNames() {
    const students = currentView?.roster || [];
    if (!students.length) return;
    const desks = [...(root?.querySelectorAll(".planner-room .desk:not(.is-blocked)") || [])];
    desks.forEach((desk, index) => {
      const student = students[(index * 7 + shuffleTick * 5 + Math.floor(index / 3)) % students.length];
      const name = desk.querySelector("strong");
      const number = desk.querySelector(".desk-number");
      if (name) name.textContent = student.name;
      if (number) number.textContent = `${student.number}번`;
    });
    shuffleTick += 1;
  }

  function runShuffleStep(step = 0) {
    if (phase !== "shuffle" || step >= SHUFFLE_DELAYS.length) return;
    shuffleNames();
    shuffleTimer = window.setTimeout(() => runShuffleStep(step + 1), SHUFFLE_DELAYS[step]);
  }

  function removeLaunch() {
    launchOverlay?.classList.add("is-leaving");
    const stale = launchOverlay;
    launchOverlay = null;
    window.setTimeout(() => stale?.remove(), reducedMotion ? 40 : 360);
    document.body.classList.remove("ceremony-awaiting-launch");
  }

  async function launch({ fullscreen = false } = {}) {
    if (!enabled || started || !currentView?.general?.seats?.some(Boolean)) return;
    if (fullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } catch {
        document.body.classList.add("ceremony-fullscreen-failed");
      }
    }
    removeLaunch();
    start();
  }

  function ensureLaunch() {
    if (!enabled || started || launchOverlay?.isConnected || !currentView?.general?.seats?.some(Boolean)) return;
    document.body.classList.add("ceremony-awaiting-launch");
    launchOverlay = document.createElement("div");
    launchOverlay.className = "ceremony-launch-layer";
    launchOverlay.innerHTML = `
      <div class="ceremony-launch-aurora" aria-hidden="true"></div>
      <div class="ceremony-launch-grid" aria-hidden="true"></div>
      <section class="ceremony-launch-card" aria-label="자리 배치 공개 시작">
        <div class="ceremony-launch-mark">
          <span class="ceremony-launch-ring"></span>
          <img src="${logoUrl}" alt="">
        </div>
        <div class="ceremony-launch-copy">
          <span>PINCON · CLASSROOM CEREMONY</span>
          <h1>새 자리 공개 준비 완료</h1>
          <p>전체화면으로 시작하면 카운트다운 뒤 새로운 자리가 공개됩니다.</p>
        </div>
        <div class="ceremony-launch-actions">
          <button class="ceremony-launch-primary" type="button" data-launch-fullscreen>전체화면으로 공개</button>
          <button class="ceremony-launch-secondary" type="button" data-launch-window>창에서 공개</button>
        </div>
        <small>전체화면은 브라우저 보안 정책상 한 번의 클릭이 필요합니다.</small>
      </section>
      <div class="ceremony-launch-signature"><img src="${logoUrl}" alt=""><span>Powered by PinCon</span></div>
    `;
    document.body.appendChild(launchOverlay);
    launchOverlay.querySelector("[data-launch-fullscreen]")?.addEventListener("click", () => launch({ fullscreen: true }), { once: true });
    launchOverlay.querySelector("[data-launch-window]")?.addEventListener("click", () => launch({ fullscreen: false }), { once: true });
  }

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;
    overlay = document.createElement("div");
    overlay.className = "ceremony-layer";
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <div class="ceremony-blackout" aria-hidden="true"></div>
      <div class="ceremony-curtain ceremony-curtain-left" aria-hidden="true"><span></span></div>
      <div class="ceremony-curtain ceremony-curtain-right" aria-hidden="true"><span></span></div>
      <div class="ceremony-watermark" aria-hidden="true"><img src="${logoUrl}" alt=""></div>
      <div class="ceremony-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="ceremony-ribbon ceremony-ribbon-a" aria-hidden="true"></div>
      <div class="ceremony-ribbon ceremony-ribbon-b" aria-hidden="true"></div>
      <div class="ceremony-light ceremony-light-a" aria-hidden="true"></div>
      <div class="ceremony-light ceremony-light-b" aria-hidden="true"></div>
      <div class="ceremony-zone-glow ceremony-zone-glow-1" aria-hidden="true"></div>
      <div class="ceremony-zone-glow ceremony-zone-glow-2" aria-hidden="true"></div>
      <div class="ceremony-zone-glow ceremony-zone-glow-3" aria-hidden="true"></div>
      <div class="ceremony-shuffle-scan" aria-hidden="true"></div>
      <div class="ceremony-lock-wave" aria-hidden="true"></div>

      <section class="ceremony-stage" aria-label="PinCon 자리 배치 공개">
        <div class="ceremony-emblem" aria-hidden="true">
          <span class="ceremony-orbit"></span>
          <span class="ceremony-orbit ceremony-orbit-secondary"></span>
          <span class="ceremony-emblem-flare"></span>
          <img src="${logoUrl}" alt="">
        </div>
        <div class="ceremony-copy">
          <span>PINCON CEREMONY</span>
          <h2>새로운 자리 배치를 공개합니다</h2>
          <p>공개까지 잠시만 기다려주세요.</p>
        </div>
      </section>

      <section class="ceremony-countdown" aria-label="자리 공개 카운트다운">
        <span class="ceremony-countdown-kicker">SEATING REVEAL</span>
        <div class="ceremony-countdown-core">
          <span class="ceremony-countdown-halo"></span>
          <span class="ceremony-countdown-ring ceremony-countdown-ring-a"></span>
          <span class="ceremony-countdown-ring ceremony-countdown-ring-b"></span>
          <b data-count="3">3</b>
          <b data-count="2">2</b>
          <b data-count="1">1</b>
        </div>
        <div class="ceremony-countdown-progress" aria-hidden="true"><i></i><i></i><i></i></div>
        <p>잠시 후 새로운 자리가 공개됩니다</p>
      </section>

      <div class="ceremony-zone-rhythm" aria-hidden="true">
        <span data-zone="1"><b>01</b> 1분단</span>
        <span data-zone="2"><b>02</b> 2분단</span>
        <span data-zone="3"><b>03</b> 3분단</span>
      </div>

      <section class="ceremony-finale" aria-label="자리 배치 완료">
        <span class="ceremony-finale-beam" aria-hidden="true"></span>
        <img src="${logoUrl}" alt="">
        <div>
          <span>PINCON · CLASSROOM</span>
          <h2>배치 완료</h2>
          <p data-ceremony-stats></p>
        </div>
      </section>

      <div class="ceremony-signature" aria-hidden="true"><img src="${logoUrl}" alt=""><span>Powered by PinCon</span></div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateOverlay() {
    if (!overlay) return;
    const stats = seatingStats(currentView);
    const statsNode = overlay.querySelector("[data-ceremony-stats]");
    if (statsNode) statsNode.textContent = `${stats.assigned}명 · 중복 ${stats.duplicates} · 누락 ${stats.missing}`;
  }

  function applyPhase(nextPhase) {
    if (!PHASES.includes(nextPhase)) return;
    document.body.classList.remove(...PHASES.map(phaseClass));
    phase = nextPhase;
    document.body.dataset.ceremonyPhase = phase;

    if (phase !== "stable" && phase !== "idle") {
      document.body.classList.add("is-ceremony", phaseClass(phase));
      root?.setAttribute("data-ceremony-phase", phase);
    } else {
      document.body.classList.add(phaseClass(phase));
      root?.setAttribute("data-ceremony-phase", phase);
    }

    if (phase === "shuffle") {
      shuffleTick = 0;
      runShuffleStep();
    } else if (shuffleTimer) {
      clearTimeout(shuffleTimer);
      shuffleTimer = 0;
    }

    if (phase === "settle" || phase === "finale" || phase === "stable") restoreNames();

    if (phase === "stable") {
      overlay?.classList.add("is-leaving");
      const cleanup = window.setTimeout(() => {
        overlay?.remove();
        overlay = null;
        document.body.classList.remove("is-ceremony", ...PHASES.map(phaseClass));
        document.body.classList.add("ceremony-complete");
        document.body.removeAttribute("data-ceremony-phase");
        root?.removeAttribute("data-ceremony-phase");
      }, reducedMotion ? 80 : 560);
      phaseTimers.push(cleanup);
    }
  }

  function schedule() {
    if (reducedMotion) {
      applyPhase("finale");
      phaseTimers.push(window.setTimeout(() => applyPhase("stable"), 850));
      return;
    }

    let elapsed = CEREMONY_TIMING.intro;
    phaseTimers.push(window.setTimeout(() => applyPhase("countdown"), elapsed));
    elapsed += CEREMONY_TIMING.countdown;
    phaseTimers.push(window.setTimeout(() => applyPhase("zones"), elapsed));
    elapsed += CEREMONY_TIMING.zones;
    phaseTimers.push(window.setTimeout(() => applyPhase("shuffle"), elapsed));
    elapsed += CEREMONY_TIMING.shuffle;
    phaseTimers.push(window.setTimeout(() => applyPhase("settle"), elapsed));
    elapsed += CEREMONY_TIMING.settle;
    phaseTimers.push(window.setTimeout(() => applyPhase("finale"), elapsed));
    elapsed += CEREMONY_TIMING.finale;
    phaseTimers.push(window.setTimeout(() => applyPhase("stable"), elapsed));
  }

  function start() {
    if (!enabled || started || !currentView?.general?.seats?.some(Boolean)) return;
    started = true;
    clearTimers();
    document.body.classList.remove("ceremony-pending", "ceremony-awaiting-launch", "ceremony-complete");
    ensureOverlay();
    updateOverlay();
    applySeatTiming();
    applyPhase("intro");
    schedule();
  }

  function onRender(view) {
    currentView = view;
    if (!enabled || !view?.general?.seats?.some(Boolean)) return;
    applySeatTiming();
    updateOverlay();
    if (!started) ensureLaunch();
    else if (phase === "settle" || phase === "finale" || phase === "stable") restoreNames();
  }

  function replay() {
    if (!enabled || !currentView?.general?.seats?.some(Boolean)) return;
    clearTimers();
    restoreNames();
    launchOverlay?.remove();
    launchOverlay = null;
    overlay?.remove();
    overlay = null;
    document.body.classList.remove("ceremony-pending", "ceremony-awaiting-launch", "ceremony-complete", "is-ceremony", ...PHASES.map(phaseClass));
    started = false;
    phase = "idle";
    start();
  }

  function destroy() {
    clearTimers();
    restoreNames();
    launchOverlay?.remove();
    launchOverlay = null;
    overlay?.remove();
    overlay = null;
    document.body.classList.remove("ceremony-pending", "ceremony-awaiting-launch", "ceremony-complete", "is-ceremony", ...PHASES.map(phaseClass));
    document.body.removeAttribute("data-ceremony-phase");
    root?.removeAttribute("data-ceremony-phase");
  }

  return {
    get enabled() { return enabled; },
    get phase() { return phase; },
    get running() { return enabled && started && !["idle", "stable"].includes(phase); },
    onRender,
    replay,
    launch,
    destroy,
  };
}
