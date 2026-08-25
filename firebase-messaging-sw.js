/* global firebase */
importScripts("https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js");
importScripts("./firebase-config.js?v=20260817-fcm1");

function notificationOptions(payload = {}) {
  const data = payload.data || {};
  const urgency = String(data.urgency || "normal");
  const timestamp = Number(data.timestampMs || Date.now());
  const link = data.link || "./next/#today";
  const tag = data.tag || `pincon-${data.kind || "school-update"}`;

  return {
    body: data.body || "새 학교 알림이 도착했습니다.",
    icon: "./icons/icon-192.png?v=20260817-figma",
    badge: "./icons/icon-192.png?v=20260817-figma",
    tag,
    renotify: urgency === "urgent",
    requireInteraction: urgency === "urgent",
    silent: urgency === "silent",
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    vibrate: urgency === "urgent" ? [90, 45, 90] : undefined,
    actions: [
      { action: "open-pincon", title: "PinCon 열기" },
      { action: "dismiss", title: "닫기" },
    ],
    data: {
      link,
      route: data.route || "today",
      kind: data.kind || "school-update",
      notificationId: data.notificationId || tag,
    },
  };
}

if (globalThis.PINCON_FIREBASE_CONFIG) {
  firebase.initializeApp(globalThis.PINCON_FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.data?.title || "PinCon 알림";
    return self.registration.showNotification(title, notificationOptions(payload));
  });
}

self.addEventListener("notificationclick", (event) => {
  if (event.action === "dismiss") {
    event.notification.close();
    return;
  }

  const link = event.notification.data?.link || "./next/#today";
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => "focus" in client);
    if (existing) {
      if ("navigate" in existing) await existing.navigate(link);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(link);
  })());
});

/*
 * Web/PWA notifications can appear in Samsung's status bar and notification
 * shade, but a true Android 16 promoted-ongoing Live Update chip requires a
 * native Android Notification/NotificationCompat implementation. Service
 * workers do not expose POST_PROMOTED_NOTIFICATIONS or setRequestPromotedOngoing.
 */
