import { NextDataGateway } from "./core/data-gateway.js";
import { accountRequest } from "./core/student-auth.js";

const gateway = new NextDataGateway();
const originalSnapshot = gateway.snapshot.bind(gateway);
let personalRows = [];
let loaded = false;
let loading = false;

function legacyPublicAnnouncement(item) {
  return !item?.personalNotification && !String(item?.targetStudentNumber || "").trim();
}

function privateAnnouncement(item = {}) {
  return {
    id: `personal-${item.id || "notification"}`,
    title: String(item.title || "개별 알림"),
    body: String(item.body || ""),
    priority: String(item.priority || "normal"),
    important: item.important === true,
    classKey: String(item.classKey || ""),
    createdAtMs: Number(item.createdAtMs || 0),
    updatedAtMs: Number(item.updatedAtMs || item.createdAtMs || 0),
    personalNotification: true,
    __private: true,
  };
}

function decorateSnapshot(snapshot) {
  if (!snapshot?.data) return snapshot;
  const publicRows = Array.isArray(snapshot.data.announcements)
    ? snapshot.data.announcements.filter(legacyPublicAnnouncement)
    : [];
  snapshot.data.announcements = [...personalRows, ...publicRows];
  return snapshot;
}

gateway.snapshot = function securePersonalSnapshot() {
  return decorateSnapshot(originalSnapshot());
};

async function loadPersonalNotifications() {
  if (loaded || loading) return;
  const account = globalThis.PINCON_ACCOUNT;
  if (account?.mode !== "student" || !account?.account?.uid) {
    loaded = true;
    return;
  }
  loading = true;
  try {
    const result = await accountRequest("/api/accounts/personal-notifications");
    personalRows = Array.isArray(result?.notifications)
      ? result.notifications.map(privateAnnouncement)
      : [];
  } catch (error) {
    console.warn("PinCon personal notifications unavailable", error);
    personalRows = [];
  } finally {
    loading = false;
    loaded = true;
    gateway.emit?.();
  }
}

await loadPersonalNotifications();

globalThis.PinConPersonalNotifications = Object.freeze({
  reload: async () => {
    loaded = false;
    await loadPersonalNotifications();
  },
});
