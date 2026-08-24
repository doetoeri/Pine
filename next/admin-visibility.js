import { NextDataGateway } from "./core/data-gateway.js";

const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let queued = false;

function setText(node, value) {
  const next = String(value ?? "");
  if (node && node.textContent !== next) node.textContent = next;
}

function patch() {
  queued = false;
  const actualAdmin = Boolean(snapshot.canArchiveContent);

  if (!actualAdmin) {
    document.querySelectorAll("#openAdminBeta").forEach((button) => button.remove());
  }

  if (snapshot.temporaryOpenWrite && !actualAdmin) {
    document.querySelectorAll("[data-day2-trust] .trust-line").forEach((line) => {
      const heading = line.querySelector("strong")?.textContent?.trim();
      if (heading === "현재 역할") setText(line.querySelector("span"), "오늘 편집자");
    });
  }
}

function queuePatch() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(patch);
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  queuePatch();
});

const observer = new MutationObserver(queuePatch);
observer.observe(document.documentElement, { childList: true, subtree: true });
queuePatch();
