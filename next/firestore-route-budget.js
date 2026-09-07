import { PinconClassOpsRepository } from "../pincon-class-ops-data.js";

const COLLECTION_ORDER = Object.freeze([
  "announcements",
  "classAssignments",
  "evaluationPlans",
  "events",
  "polls",
  "feedback",
  "supplies",
  "supplyLoans",
  "lostItems",
  "resources",
  "patchNotes",
  "academicSchedules",
  "neisTimetables",
  "meals",
  "content",
  "classSettings",
]);

const ROUTE_COLLECTIONS = Object.freeze({
  today: [
    "announcements", "classAssignments", "evaluationPlans", "events", "patchNotes",
    "academicSchedules", "neisTimetables", "meals", "content", "classSettings",
  ],
  timetable: [
    "announcements", "classAssignments", "academicSchedules", "neisTimetables", "content", "classSettings",
  ],
  schedule: [
    "announcements", "classAssignments", "evaluationPlans", "events", "academicSchedules", "neisTimetables", "classSettings",
  ],
  classroom: [
    "announcements", "events", "polls", "feedback", "supplies", "supplyLoans", "lostItems", "resources", "content", "classSettings",
  ],
  more: [
    "announcements", "classAssignments", "evaluationPlans", "feedback", "resources", "patchNotes", "academicSchedules", "content", "classSettings",
  ],
});

const instances = new Set();
const prototype = PinconClassOpsRepository.prototype;
const originalListenPublic = prototype.listenPublic;

function isNextRoot() {
  const path = String(location.pathname || "").replace(/\/+$/, "") || "/";
  return path === "/next" || path === "/next/index.html";
}

function currentRoute() {
  return location.hash.replace(/^#/, "").split("/")[0] || "today";
}

function wantedCollections() {
  if (!isNextRoot()) return new Set(COLLECTION_ORDER);
  return new Set(ROUTE_COLLECTIONS[currentRoute()] || ROUTE_COLLECTIONS.today);
}

if (!prototype.__pinconRouteBudgetPatched) {
  Object.defineProperty(prototype, "__pinconRouteBudgetPatched", { value: true });
  prototype.listenPublic = function budgetedListenPublic(...args) {
    instances.add(this);
    if (!this.api || !isNextRoot()) return originalListenPublic.apply(this, args);

    const originalOnSnapshot = this.api.onSnapshot;
    if (typeof originalOnSnapshot !== "function") return originalListenPublic.apply(this, args);

    const wanted = wantedCollections();
    let callIndex = 0;
    const api = this.api;
    api.onSnapshot = function budgetedOnSnapshot(queryRef, ...snapshotArgs) {
      const collectionName = COLLECTION_ORDER[callIndex++] || "";
      if (!wanted.has(collectionName)) return () => {};
      return originalOnSnapshot.call(api, queryRef, ...snapshotArgs);
    };

    try {
      return originalListenPublic.apply(this, args);
    } finally {
      api.onSnapshot = originalOnSnapshot;
    }
  };
}

function refreshRouteSubscriptions() {
  if (document.hidden || !isNextRoot()) return;
  for (const instance of instances) {
    if (!instance?.api) continue;
    try { instance.listenPublic(); } catch {}
  }
}

window.addEventListener("hashchange", refreshRouteSubscriptions);
window.addEventListener("popstate", refreshRouteSubscriptions);

globalThis.PinConFirestoreRouteBudget = Object.freeze({
  route: currentRoute,
  collections: () => [...wantedCollections()],
  refresh: refreshRouteSubscriptions,
});
