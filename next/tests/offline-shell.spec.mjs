import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
test("an installed PWA opens the saved class when its server is unavailable", async ({ page, context, browserName }) => {
  const server = spawn("python3", ["-m", "http.server", "4174", "--bind", "127.0.0.1"], { stdio: "ignore" });
  try {
    await expect.poll(async () => {
      try { return (await fetch("http://127.0.0.1:4174/next/")).ok; } catch { return false; }
    }).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
      const data = Object.fromEntries(["announcements", "classAssignments", "evaluationPlans", "events", "polls", "feedback", "supplies", "supplyLoans", "lostItems", "resources", "patchNotes", "academicSchedules", "neisTimetables", "meals", "content", "classSettings"].map((name) => [name, []]));
      data.announcements = [{ id: "saved", classKey: "1-8", title: "저장된 학급 공지", updatedAtMs: Date.now() }];
      localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ version: 1, classKey: "1-8", savedAtMs: Date.now(), data }));
    });
    await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
    await page.goto("http://127.0.0.1:4174/next/#today", { waitUntil: "load" });
    await expect(page.locator(".today-notices")).toContainText("저장된 학급 공지");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
    await new Promise((resolve) => { server.once("exit", resolve); server.kill(); });
    // WebKit's emulated offline reload reports an internal engine error.
    // Its real server outage still exercises the service-worker fallback.
    if (browserName === "chromium") await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#today-title")).toBeVisible();
    await expect(page.locator(".today-notices")).toContainText("저장된 학급 공지");
    await page.locator('.bottom-nav [data-route="timetable"]').click();
    await expect(page.locator("#timetable-title")).toBeVisible();
  } finally {
    server.kill();
  }
});
