import { NextDataGateway } from "./core/data-gateway.js";

const gateway = new NextDataGateway();
const originalSnapshot = gateway.snapshot.bind(gateway);

function currentStudentNumber() {
  return String(globalThis.PINCON_ACCOUNT?.account?.studentNumber || "").trim();
}

function visibleToCurrentStudent(item) {
  const target = String(item?.targetStudentNumber || "").trim();
  if (!target) return true;
  const current = currentStudentNumber();
  return Boolean(current && current === target);
}

function filterSnapshot(snapshot) {
  if (!snapshot?.data || !Array.isArray(snapshot.data.announcements)) return snapshot;
  snapshot.data.announcements = snapshot.data.announcements.filter(visibleToCurrentStudent);
  return snapshot;
}

gateway.snapshot = function filteredSnapshot() {
  return filterSnapshot(originalSnapshot());
};

// Expose only the minimum helper needed by UI diagnostics/tests.
globalThis.PinConPersonalNotifications = Object.freeze({
  currentStudentNumber,
  visibleToCurrentStudent,
});
