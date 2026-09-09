import { accountRequest } from "../core/student-auth.js";

const forcedScene = new URL(location.href).searchParams.get("scene") || "";

async function start() {
  try {
    const view = await accountRequest("/api/class-ops/classroom-layout");
    const display = view?.classroomLayout?.display || {};
    const key = forcedScene || display.activeScene || "morning";
    const scene = display.scenes?.[key] || display.scenes?.morning || {};
    const assessmentRequested = key === "assessment" || scene.targetMode === "assessment";
    if (assessmentRequested) {
      await import("./tv-assessment-v2.js?v=20260910-assessment4");
      return;
    }
  } catch (error) {
    console.warn("[PinCon] TV scene detection failed; using standard TV", error);
  }
  await import("./tv.js?v=20260907-tv4");
}

start();
