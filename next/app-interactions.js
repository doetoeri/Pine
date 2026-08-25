import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";
import { brandTaglineFor } from "./core/brand-settings.js";
import { buildNotificationFeed, NotificationStore } from "./core/notification-store.js";

const LOGO_URL = "./assets/pincon-icon.svg";
const appRoot = document.querySelector("#app");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let profile = snapshot.profile || readClassProfile();
const notificationStore = new NotificationStore(profile?.classKey || "");
let feed = [];
let reconcileQueued = false;
let lastDialogTrigger = null;
let lastDialogTriggerId = "";
let bootReleased = false;
let routeTimer = 0;
let lastFocusedRoute = "";
let routeFocusRestoreQueued = false;

const MATERIAL_BUTTON_SELECTOR = [
  "md-icon-button",
  "md-text-button",
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-elevated-button",
].join(",");

const boundRoots = new WeakSet();

function activationKey(event) {
  return ["Enter", " "].includes(event.key)
    && !event.repeat
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey;
}

function dispatchHostActivation(host) {
  host.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  }));
}

function materialHostFromEvent(event) {
  return event.composedPath?.().find((node) => (
    node instanceof HTMLElement && node.matches?.(MATERIAL_BUTTON_SELECTOR)
  )) || null;
}

document.addEventListener("keydown", (event) => {
  if (!activationKey(event)) return;
  const host = materialHostFromEvent(event);
  if (!host || host.hasAttribute("disabled")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  dispatchHostActivation(host);
}, true);

function bindShadowCapture(host) {
  if (!(host instanceof HTMLElement) || host.hasAttribute("disabled")) return false;
  const root = host.shadowRoot;
  if (!root) return false;
  if (boundRoots.has(root)) return true;
  root.addEventListener("keydown", (event) => {
    if (!activationKey(event) || host.hasAttribute("disabled")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dispatchHostActivation(host);
  }, true);
  boundRoots.add(root);
  return true;
}

function prepareHost(host) {
  if (!(host instanceof HTMLElement)) return;
  bindShadowCapture(host);
  queueMicrotask(() => bindShadowCapture(host));
  requestAnimationFrame(() => bindShadowCapture(host));
  window.setTimeout(() => bindShadowCapture(host), 0);
  window.setTimeout(() => bindShadowCapture(host), 50);
  const updateComplete = host.updateComplete;
  if (updateComplete && typeof updateComplete.then === "function") {
    updateComplete.then(() => bindShadowCapture(host)).catch(() => {});
  }
}

function prepareMainFocus(scope = document) {
  const main = scope instanceof HTMLElement && scope.id === "mainContent"
    ? scope
    : scope.querySelector?.("#mainContent");
  if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
}

function prepareScope(scope = document) {
  prepareMainFocus(scope);
  if (scope instanceof HTMLElement && scope.matches?.(MATERIAL_BUTTON_SELECTOR)) prepareHost(scope);
  scope.querySelectorAll?.(MATERIAL_BUTTON_SELECTOR).forEach(prepareHost);
}

const keyboardObserver = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) prepareScope(node);
    }
  }
});
if (appRoot) keyboardObserver.observe(appRoot, { childList: true, subtree: true });
prepareScope();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function logoMarkup(extra = "") {
  return `<img class="pincon-brand-logo ${extra}" src="${LOGO_URL}" alt="" decoding="async" />`;
}

function currentTagline() {
  return brandTaglineFor(snapshot.data || {}, snapshot.profile?.classKey || "");
}

function syncTaglineNode(node, tagline) {
  if (!node) return;
  const hidden = !tagline;
  if (node.textContent !== tagline) node.textContent = tagline;
  if (node.title !== tagline) node.title = tagline;
  if (node.hidden !== hidden) node.hidden = hidden;
  if (node.getAttribute("data-brand-ready") !== "true") node.setAttribute("data-brand-ready", "true");
}

function applyBranding(root = document) {
  const topMark = root.querySelector?.(".brand__mark") || document.querySelector(".brand__mark");
  if (topMark && !topMark.querySelector(".pincon-brand-logo")) topMark.innerHTML = logoMarkup();

  const splashMark = root.querySelector?.(".splash__mark") || document.querySelector(".splash__mark");
  if (splashMark && !splashMark.querySelector(".pincon-brand-logo")) splashMark.innerHTML = logoMarkup();

  const railMark = root.querySelector?.(".rail__brand") || document.querySelector(".rail__brand");
  if (railMark && !railMark.querySelector(".pincon-brand-logo")) {
    railMark.innerHTML = `${logoMarkup()}<span class="rail__wordmark"><span>PinCon</span><small class="rail__tagline"></small></span>`;
  }

  const tagline = currentTagline();
  syncTaglineNode(document.querySelector(".brand__tagline"), tagline);
  syncTaglineNode(document.querySelector(".rail__tagline"), tagline);
}

function prepareReducedMotionLoader() {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const progress = document.querySelector("#pinconBoot md-linear-progress");
  if (!progress) return;
  progress.removeAttribute("indeterminate");
  progress.setAttribute("value", "0.6");
}

function releaseBootWhenStable() {
  if (bootReleased || !appRoot?.querySelector(".shell, .splash")) return;
  bootReleased = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add("pincon-boot-done");
      window.setTimeout(() => document.querySelector("#pinconBoot")?.remove(), 220);
    });
  });
}

function animateRouteOnce() {
  document.body.classList.remove("pincon-route-transition");
  requestAnimationFrame(() => document.body.classList.add("pincon-route-transition"));
  window.clearTimeout(routeTimer);
  routeTimer = window.setTimeout(() => document.body.classList.remove("pincon-route-transition"), 220);
}

function dateLabel(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date);
}

function roleLabel(role) {
  if (role === "system-admin") return "시스템 관리자";
  if (role === "manager") return "학급 관리자";
  if (role === "editor") return "편집자";
  return "학생 · 열람자";
}

function currentFeed() {
  return notificationStore.decorate(feed);
}

function unreadCount() {
  return notificationStore.unreadCount(feed);
}

function eventHost(event, predicate) {
  return event.composedPath?.().find((node) => node instanceof HTMLElement && predicate(node)) || null;
}

function actualFocusable(control) {
  if (!control) return null;
  return control.shadowRoot?.querySelector("button, a, input, textarea, select, [tabindex]") || control;
}

function setAccessibleLabel(control, label) {
  if (!control || !label) return;
  control.setAttribute("data-aria-label", label);
  actualFocusable(control)?.setAttribute("aria-label", label);
}

function focusActual(control) {
  actualFocusable(control)?.focus?.({ preventScroll: true });
}

function activeElementIsLost() {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement || active === appRoot;
}

function queueRouteFocusRestore() {
  if (!lastFocusedRoute || routeFocusRestoreQueued) return;
  routeFocusRestoreQueued = true;
  requestAnimationFrame(() => {
    routeFocusRestoreQueued = false;
    if (!lastFocusedRoute || !activeElementIsLost() || anyDialogOpen()) return;
    const selector = `[data-route="${CSS.escape(lastFocusedRoute)}"]`;
    const control = document.querySelector(`.rail ${selector}`) || document.querySelector(`.bottom-nav ${selector}`);
    if (control) focusActual(control);
  });
}

function setCurrentState(control, current) {
  const focusable = actualFocusable(control);
  if (!focusable) return;
  if (current) focusable.setAttribute("aria-current", "page");
  else focusable.removeAttribute("aria-current");
}

function enhanceNavigationSemantics() {
  document.querySelectorAll("[data-route]").forEach((control) => {
    const current = control.getAttribute("data-aria-current") === "page" || control.getAttribute("aria-current") === "page";
    setCurrentState(control, current);
  });
  const main = document.querySelector("#mainContent");
  if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
}

function focusMainAfterRouteChange() {
  requestAnimationFrame(() => {
    const main = document.querySelector("#mainContent");
    if (!main) return;
    main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
  });
}

function rememberDialogTrigger(trigger) {
  lastDialogTrigger = trigger || null;
  lastDialogTriggerId = trigger?.id || "";
}

function currentDialogTrigger() {
  if (lastDialogTriggerId) {
    const current = document.getElementById(lastDialogTriggerId);
    if (current) return current;
  }
  return lastDialogTrigger?.isConnected ? lastDialogTrigger : null;
}

function restoreDialogTriggerFocus() {
  requestAnimationFrame(() => {
    const trigger = currentDialogTrigger();
    if (trigger) focusActual(trigger);
  });
}

function anyDialogOpen() {
  return ["#searchDialog", "#notificationDialog"].some((selector) => {
    const dialog = document.querySelector(selector);
    return Boolean(dialog?.open || dialog?.hasAttribute?.("open"));
  });
}

function enhanceDialogSemantics() {
  const searchDialog = document.querySelector("#searchDialog");
  if (searchDialog) searchDialog.setAttribute("data-aria-label", "통합 검색");
  const notificationDialog = document.querySelector("#notificationDialog");
  if (notificationDialog) notificationDialog.setAttribute("data-aria-label", "알림함");
  setAccessibleLabel(document.querySelector("#openSearch"), "통합 검색");
}

function enhanceNotificationButton() {
  const button = document.querySelector("#openNotifications");
  if (!button) return;
  let wrapper = button.parentElement?.classList.contains("notification-trigger-wrap") ? button.parentElement : null;
  if (!wrapper) {
    wrapper = document.createElement("span");
    wrapper.className = "notification-trigger-wrap";
    button.parentNode?.insertBefore(wrapper, button);
    wrapper.append(button);
  }
  let badge = wrapper.querySelector(".notification-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "notification-badge";
    badge.setAttribute("aria-hidden", "true");
    wrapper.append(badge);
  }
  const count = unreadCount();
  const text = count > 99 ? "99+" : String(count);
  if (badge.textContent !== text) badge.textContent = text;
  badge.hidden = count === 0;
  setAccessibleLabel(button, count ? `알림함, 읽지 않은 알림 ${count}개` : "알림함, 모두 읽음");
}

function inboxMarkup() {
  const rows = currentFeed();
  const unread = unreadCount();
  if (!rows.length) {
    return `<div class="empty"><md-icon>notifications_none</md-icon><strong>알림이 없습니다</strong><span>공지·수행·학급 행사가 생기면 기록이 이곳에 남습니다.</span></div>`;
  }
  return `<div class="notification-summary"><span class="notification-summary__text">전체 ${rows.length}개 · 읽지 않음 ${unread}개</span><md-text-button id="markAllNotificationsRead" ${unread ? "" : "disabled"}>모두 읽음</md-text-button></div>
    <md-list class="notification-list" aria-label="알림 기록">
      ${rows.map((item) => `<md-list-item type="button" data-notification-id="${escapeHtml(item.id)}" data-notification-route="${escapeHtml(item.route)}" data-notification-kind="${escapeHtml(item.detailKind)}" data-notification-collection="${escapeHtml(item.collection)}" data-notification-record-id="${escapeHtml(item.recordId)}" data-read="${item.read}" aria-label="${escapeHtml(`${item.read ? "읽음" : "읽지 않음"}, ${item.title}, 관련 항목 열기`)}"><md-icon slot="start">${escapeHtml(item.icon)}</md-icon><div slot="headline">${escapeHtml(item.title)}</div><div slot="supporting-text">${escapeHtml([item.kind, item.body, dateLabel(item.date)].filter(Boolean).join(" · "))}</div><span slot="end" class="notification-row-end">${item.read ? "" : '<span class="notification-unread-dot" aria-label="읽지 않음"></span>'}<md-icon aria-hidden="true">chevron_right</md-icon></span></md-list-item>`).join("")}
    </md-list>`;
}

function renderInbox() {
  const target = document.querySelector("#notificationContent");
  if (target) target.innerHTML = inboxMarkup();
}

function trustMarkup() {
  return `<article class="surface" data-day2-trust><div class="surface__header"><h2 class="surface__title">관리자 도구</h2><span class="beta-badge">PinCon Beta</span></div><p class="page-subtitle">학급 정보를 관리하려면 별도의 관리자 화면을 사용하세요. 학생 화면은 계속 읽기 전용으로 유지됩니다.</p><div class="trust-actions"><md-filled-tonal-button id="openAdminBeta"><md-icon slot="icon">admin_panel_settings</md-icon>관리자 화면 열기</md-filled-tonal-button></div></article>`;
}

function injectTrustCard() {
  if (!snapshot.isManager) return;
  const section = document.querySelector("#more-title")?.closest("section");
  const grid = section?.querySelector(".grid");
  if (!grid || grid.querySelector("[data-day2-trust]")) return;
  grid.insertAdjacentHTML("beforeend", trustMarkup());
}

function reconcile() {
  reconcileQueued = false;
  profile = snapshot.profile || readClassProfile();
  notificationStore.setClassKey(profile?.classKey || "");
  feed = buildNotificationFeed(snapshot.data || {});
  applyBranding();
  enhanceNavigationSemantics();
  enhanceDialogSemantics();
  enhanceNotificationButton();
  injectTrustCard();
  releaseBootWhenStable();
  queueRouteFocusRestore();
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  requestAnimationFrame(reconcile);
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  queueReconcile();
});
notificationStore.addEventListener("change", () => queueReconcile());

const enhancementObserver = new MutationObserver(() => {
  queueReconcile();
  queueRouteFocusRestore();
});
if (appRoot) enhancementObserver.observe(appRoot, { childList: true, subtree: true });

document.addEventListener("focusin", (event) => {
  const routeControl = eventHost(event, (node) => node.hasAttribute("data-route"));
  lastFocusedRoute = routeControl?.getAttribute("data-route") || "";
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && anyDialogOpen()) window.setTimeout(restoreDialogTriggerFocus, 0);
});

document.addEventListener("click", (event) => {
  const routeControl = eventHost(event, (node) => node.hasAttribute("data-route"));
  if (routeControl) {
    lastFocusedRoute = "";
    animateRouteOnce();
  }

  const notificationOpenButton = eventHost(event, (node) => node.id === "openNotifications");
  if (!notificationOpenButton) return;
  rememberDialogTrigger(notificationOpenButton);
  event.preventDefault();
  event.stopPropagation();
  renderInbox();
  document.querySelector("#notificationDialog")?.show?.();
}, true);

document.addEventListener("click", (event) => {
  const routeControl = eventHost(event, (node) => node.hasAttribute("data-route"));
  if (routeControl) focusMainAfterRouteChange();

  const adminButton = eventHost(event, (node) => node.id === "openAdminBeta");
  if (adminButton) {
    location.href = "./admin/";
    return;
  }
  const searchOpenButton = eventHost(event, (node) => node.id === "openSearch");
  if (searchOpenButton) rememberDialogTrigger(searchOpenButton);
  const closeButton = eventHost(event, (node) => node.id === "closeSearch" || node.id === "closeNotifications");
  if (closeButton) window.setTimeout(restoreDialogTriggerFocus, 0);

  const markAll = eventHost(event, (node) => node.id === "markAllNotificationsRead");
  if (markAll) {
    notificationStore.markAllRead(feed);
    renderInbox();
    enhanceNotificationButton();
    return;
  }

  const row = eventHost(event, (node) => node.hasAttribute("data-notification-id"));
  if (!row) return;
  const id = row.getAttribute("data-notification-id");
  const route = row.getAttribute("data-notification-route");
  const detailKind = row.getAttribute("data-notification-kind");
  const collection = row.getAttribute("data-notification-collection");
  const recordId = row.getAttribute("data-notification-record-id");
  notificationStore.markRead(id);
  renderInbox();
  enhanceNotificationButton();
  document.querySelector("#notificationDialog")?.close?.();
  const detailKey = detailKind && collection && recordId
    ? globalThis.PinConNext?.detailKeyForReference?.(detailKind, collection, recordId)
    : "";
  if (detailKey && globalThis.PinConNext?.navigateToDetail) {
    globalThis.PinConNext.navigateToDetail(route || "today", detailKey, row, { notificationId: id });
    return;
  }
  const destination = route ? document.querySelector(`[data-route="${route}"]`) : null;
  destination?.click?.();
});

prepareReducedMotionLoader();
queueReconcile();
await gateway.start();

window.setTimeout(() => {
  if (!bootReleased) {
    bootReleased = true;
    document.body.classList.add("pincon-boot-done");
  }
}, 4500);
