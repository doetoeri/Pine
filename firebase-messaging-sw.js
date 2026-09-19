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
      period: data.period || "",
      category: data.category || "",
      targetRoute: data.targetRoute || data.route || "today",
      scheduledAtMs: Number(data.scheduledAtMs || timestamp || Date.now()),
      sentAtMs: Number(data.sentAtMs || data.scheduledAtMs || timestamp || Date.now()),
      slotIndex: Number(data.slotIndex || -1),
    },
  };
}

const TELEMETRY_DB = "pincon-notification-telemetry-v1";
const TELEMETRY_STORE = "received";

function openTelemetryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TELEMETRY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TELEMETRY_STORE)) {
        db.createObjectStore(TELEMETRY_STORE, { keyPath: "notificationId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistReceivedReceipt(receipt) {
  if (!receipt?.notificationId) return;
  const db = await openTelemetryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(TELEMETRY_STORE, "readwrite");
    tx.objectStore(TELEMETRY_STORE).put(receipt);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function drainReceivedReceipts() {
  const db = await openTelemetryDb();
  const receipts = await new Promise((resolve, reject) => {
    const tx = db.transaction(TELEMETRY_STORE, "readwrite");
    const store = tx.objectStore(TELEMETRY_STORE);
    const request = store.getAll();
    let rows = [];
    request.onsuccess = () => {
      rows = Array.isArray(request.result) ? request.result : [];
      store.clear();
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(rows);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return receipts;
}

if (globalThis.PINCON_FIREBASE_CONFIG) {
  firebase.initializeApp(globalThis.PINCON_FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(async (payload) => {
    const title = payload.data?.title || "PinCon 알림";
    const options = notificationOptions(payload);
    if (options.data?.experimentId) {
      const receipt = {
        type: "pincon-experiment-notification-received",
        notificationId: options.data.notificationId,
        experimentId: options.data.experimentId,
        condition: options.data.condition,
        period: options.data.period,
        category: options.data.category,
        targetRoute: options.data.targetRoute,
        slotIndex: options.data.slotIndex,
        sentAtMs: options.data.sentAtMs,
        receivedAtMs: Date.now(),
      };
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (clients.length) {
        clients.forEach((client) => client.postMessage(receipt));
      } else {
        await persistReceivedReceipt(receipt).catch(() => {});
      }
    }
    return self.registration.showNotification(title, options);
  });
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "pincon-experiment-drain-received") return;
  event.waitUntil((async () => {
    const receipts = await drainReceivedReceipts().catch(() => []);
    if (!receipts.length) return;
    event.source?.postMessage?.({
      type: "pincon-experiment-notification-received-batch",
      receipts,
    });
  })());
});

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
    target.searchParams.set("pinconPeriod", data.period || "");
    target.searchParams.set("pinconCategory", data.category || "");
    target.searchParams.set("pinconTargetRoute", data.targetRoute || data.route || "today");
    target.searchParams.set("pinconSentAt", String(Number(data.sentAtMs || data.scheduledAtMs || Date.now())));
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
