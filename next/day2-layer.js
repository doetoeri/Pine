import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";
import { buildNotificationFeed, NotificationStore } from "./core/notification-store.js";

const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let profile = snapshot.profile || readClassProfile();
const notificationStore = new NotificationStore(profile?.classKey || "");
let feed = [];
let reconcileQueued = false;
let lastDialogTrigger = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function setCurrentState(control, current) {
  const focusable = control.shadowRoot?.querySelector("button, a") || control;
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

function restoreDialogTriggerFocus() {
  const trigger = lastDialogTrigger;
  if (!trigger?.isConnected) return;
  requestAnimationFrame(() => trigger.focus?.({ preventScroll: true }));
}

function anyDialogOpen() {
  return ["#searchDialog", "#notificationDialog"].some((selector) => {
    const dialog = document.querySelector(selector);
    return Boolean(dialog?.open || dialog?.hasAttribute?.("open"));
  });
}

function enhanceDialogSemantics() {
  const searchDialog = document.querySelector("#searchDialog");
  if (searchDialog && !searchDialog.hasAttribute("aria-label")) {
    searchDialog.setAttribute("aria-label", "통합 검색");
  }

  const notificationDialog = document.querySelector("#notificationDialog");
  if (notificationDialog && !notificationDialog.hasAttribute("aria-label")) {
    notificationDialog.setAttribute("aria-label", "알림함");
  }
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
  button.setAttribute("aria-label", count ? `알림함, 읽지 않은 알림 ${count}개` : "알림함, 모두 읽음");
}

function inboxMarkup() {
  const rows = currentFeed();
  const unread = unreadCount();
  if (!rows.length) {
    return `<div class="empty">
      <md-icon>notifications_none</md-icon>
      <strong>알림이 없습니다</strong>
      <span>공지·수행·학급 행사가 생기면 기록이 이곳에 남습니다.</span>
    </div>`;
  }

  return `<div class="notification-summary">
      <span class="notification-summary__text">전체 ${rows.length}개 · 읽지 않음 ${unread}개</span>
      <md-text-button id="markAllNotificationsRead" ${unread ? "" : "disabled"}>모두 읽음</md-text-button>
    </div>
    <md-list class="notification-list" aria-label="알림 기록">
      ${rows.map((item) => `<md-list-item type="button" data-notification-id="${escapeHtml(item.id)}" data-notification-route="${escapeHtml(item.route)}" data-read="${item.read}">
        <md-icon slot="start">${escapeHtml(item.icon)}</md-icon>
        <div slot="headline">${escapeHtml(item.title)}</div>
        <div slot="supporting-text">${escapeHtml([item.kind, item.body, dateLabel(item.date)].filter(Boolean).join(" · "))}</div>
        ${item.read ? "" : '<span slot="end" class="notification-unread-dot" aria-label="읽지 않음"></span>'}
      </md-list-item>`).join("")}
    </md-list>`;
}

function renderInbox() {
  const target = document.querySelector("#notificationContent");
  if (!target) return;
  target.innerHTML = inboxMarkup();
}

function trustMarkup() {
  const access = snapshot.access || {};
  const signedIn = access.signedIn ? "인증된 계정" : "로그인하지 않음";
  const identity = access.displayName ? ` · ${access.displayName}` : "";
  return `<article class="surface" data-day2-trust>
    <div class="surface__header">
      <h2 class="surface__title">권한과 복구</h2>
      <span class="beta-badge">WRITE LOCKED</span>
    </div>
    <div class="trust-grid">
      <div class="trust-line"><strong>현재 역할</strong><span>${escapeHtml(roleLabel(access.role))}</span></div>
      <div class="trust-line"><strong>인증 상태</strong><span>${escapeHtml(signedIn + identity)}</span></div>
      <div class="trust-line"><strong>공용 편집</strong><span>Beta에서는 잠금. 서버 역할 규칙과 감사 로그를 검증한 뒤에만 활성화합니다.</span></div>
      <div class="trust-line"><strong>삭제 정책</strong><span>영구 삭제 대신 보관 처리 후 복원 가능하게 설계합니다. 삭제·복원 모두 감사 기록이 필수입니다.</span></div>
    </div>
  </article>`;
}

function injectTrustCard() {
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
  enhanceNavigationSemantics();
  enhanceDialogSemantics();
  enhanceNotificationButton();
  injectTrustCard();
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

const observer = new MutationObserver(() => queueReconcile());
const appRoot = document.querySelector("#app");
if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !anyDialogOpen()) return;
  window.setTimeout(restoreDialogTriggerFocus, 0);
});

document.addEventListener("click", (event) => {
  const routeControl = eventHost(event, (node) => node.hasAttribute("data-route"));
  if (routeControl) focusMainAfterRouteChange();

  const searchOpenButton = eventHost(event, (node) => node.id === "openSearch");
  const notificationOpenButton = eventHost(event, (node) => node.id === "openNotifications");
  if (searchOpenButton || notificationOpenButton) {
    lastDialogTrigger = searchOpenButton || notificationOpenButton;
  }

  const closeButton = eventHost(event, (node) => node.id === "closeSearch" || node.id === "closeNotifications");
  if (closeButton) {
    window.setTimeout(restoreDialogTriggerFocus, 0);
  }

  if (notificationOpenButton) {
    window.setTimeout(renderInbox, 0);
    return;
  }

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
  notificationStore.markRead(id);
  renderInbox();
  enhanceNotificationButton();
  document.querySelector("#notificationDialog")?.close?.();
  const destination = route ? document.querySelector(`[data-route="${route}"]`) : null;
  destination?.click?.();
});

queueReconcile();
await gateway.start();
