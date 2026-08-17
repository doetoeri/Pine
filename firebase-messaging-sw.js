/* global firebase */
importScripts("https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js");
importScripts("./firebase-config.js?v=20260817-fcm1");

if (globalThis.PINCON_FIREBASE_CONFIG) {
  firebase.initializeApp(globalThis.PINCON_FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.data?.title || "Pincon 알림";
    const options = {
      body: payload.data?.body || "새 학교 알림이 도착했습니다.",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: payload.data?.tag || "pincon-school-update",
      data: { link: payload.data?.link || "./" },
    };
    return self.registration.showNotification(title, options);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "./";
  event.waitUntil(self.clients.openWindow(link));
});
