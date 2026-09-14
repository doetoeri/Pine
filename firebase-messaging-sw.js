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
      experimentId: data.experimentId || "",
      condition: data.condition || "",
      category: data.category || "",
      targetRoute: data.targetRoute || data.route || "today",
      scheduledAtMs: Number(data.scheduledAtMs || timestamp || Date.now()),
    },
  };
}

if (globalThis.PINCON_FIREBASE_CONFIG) {
  firebase.initializeApp(globalThis.PINCON_FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(async (payload) => {
    const title = payload.data?.title || "PinCon 알림";
    const options = notificationOptions(payload);
    if (options.data?.experimentId) {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((client) => client.postMessage({
        type: "pincon-experiment-notification-received",
        notificationId: options.data.notificationId,
        experimentId: options.data.experimentId,
        condition: options.data.condition,
        category: options.data.category,
        targetRoute: options.data.targetRoute,
      }));
    }
    return self.registration.showNotification(title, options);
  });
}

self.addEventListener("notificationclick", (event) => {
  if (event.action === "dismiss") {
    event.notification.close();
    return;
  }

  const data = event.notification.data || {};
  const rawLink = data.link || "./next/#today";
  const target = new URL(rawLink, self.location.origin);
  if (data.experimentId) {
    target.searchParams.set("pinconNotificationId", data.notificationId || "");
    target.searchParams.set("pinconExperimentId", data.experimentId);
    target.searchParams.set("pinconCondition", data.condition || "");
    target.searchParams.set("pinconCategory", data.category || "");
    target.searchParams.set("pinconTargetRoute", data.targetRoute || data.route || "today");
    target.searchParams.set("pinconSentAt", String(Number(data.scheduledAtMs || Date.now())));
  }
  const link = target.href;
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
