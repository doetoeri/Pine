import { NextDataGateway } from "./core/data-gateway.js";

const gateway = new NextDataGateway();
const originalStart = gateway.start.bind(gateway);
const DEADLINE_MS = 4500;

let liveStartPromise = null;
let deadlineReleased = false;

function degradedCollectionStatus(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.collectionStatus || {}).map(([name, status]) => [
      name,
      ["idle", "loading"].includes(status) ? "error" : status,
    ]),
  );
}

function releaseDegradedReady(message = "") {
  const snapshot = gateway.snapshot();
  if (!snapshot.profile || snapshot.ready) return gateway.snapshot();

  gateway.state = {
    ...gateway.state,
    ready: true,
    syncing: false,
    error: snapshot.usingCache ? "" : (message || "실시간 연결이 지연되고 있습니다. 연결되면 자동으로 갱신됩니다."),
    collectionStatus: degradedCollectionStatus(snapshot),
  };
  gateway.emit();

  // Do not let the visual boot layer cover an otherwise usable cached shell.
  document.body.classList.add("pincon-boot-done");
  window.setTimeout(() => document.querySelector("#pinconBoot")?.remove(), 220);
  return gateway.snapshot();
}

gateway.start = async function resilientStart() {
  if (!liveStartPromise) {
    liveStartPromise = Promise.resolve().then(() => originalStart());
    liveStartPromise.catch(() => {});
  }

  if (deadlineReleased) return this.snapshot();

  let timer = 0;
  const result = await Promise.race([
    liveStartPromise.then((value) => ({ live: true, value })).catch((error) => ({ live: true, error })),
    new Promise((resolve) => {
      timer = window.setTimeout(() => resolve({ live: false }), DEADLINE_MS);
    }),
  ]);
  if (timer) window.clearTimeout(timer);

  if (!result.live) {
    deadlineReleased = true;
    return releaseDegradedReady();
  }

  if (result.error) {
    deadlineReleased = true;
    return releaseDegradedReady(result.error?.message || "실시간 연결에 실패했습니다. 저장된 정보를 표시합니다.");
  }

  const current = this.snapshot();
  if (!current.ready && current.profile) {
    deadlineReleased = true;
    return releaseDegradedReady(current.error || "실시간 연결이 지연되고 있습니다.");
  }
  return result.value || current;
};

window.addEventListener("online", () => {
  // The original Firebase start keeps running in the background. If it already
  // failed before connectivity returned, a normal gateway retry can reconnect.
  const snapshot = gateway.snapshot();
  if (snapshot.ready && snapshot.error && !snapshot.syncing) {
    gateway.retry?.().catch(() => {});
  }
});
