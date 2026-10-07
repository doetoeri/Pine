import { test, expect } from "@playwright/test";
test("live update bursts keep navigation, dialogs and unchanged cards mounted", async ({ page }) => {
  await page.addInitScript(() => {
    const date = new Date();
    const today = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    const data = Object.fromEntries(["announcements", "classAssignments", "evaluationPlans", "events", "polls", "feedback", "supplies", "supplyLoans", "lostItems", "resources", "patchNotes", "academicSchedules", "neisTimetables", "meals", "content", "classSettings"].map((name) => [name, []]));
    data.neisTimetables = [{ id: "today", classKey: "1-8", date: today, periods: [{ period: 1, subject: "공수", room: "1-8" }] }];
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".today-timetable")).toContainText("공통수학");
  await page.evaluate(() => {
    globalThis.__stableNodes = {
      nav: document.querySelector(".bottom-nav"),
      search: document.querySelector("#openSearch"),
      dialog: document.querySelector("#searchDialog"),
      timetable: document.querySelector(".today-timetable"),
      meal: document.querySelector(".today-meal"),
    };
  });
  await page.evaluate(async () => {
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway();
    for (let i = 0; i < 40; i += 1) {
      gateway.state.data.announcements = [{ id: "new", title: "마지막 공지 " + i, body: "변경 내용", updatedAtMs: Date.now() }];
      gateway.emit();
    }
  });
  await expect(page.locator(".today-notices")).toContainText("마지막 공지 39");
  expect(await page.evaluate(() => {
    const saved = globalThis.__stableNodes;
    return saved.nav === document.querySelector(".bottom-nav")
      && saved.search === document.querySelector("#openSearch")
      && saved.dialog === document.querySelector("#searchDialog")
      && saved.timetable === document.querySelector(".today-timetable")
      && saved.meal === document.querySelector(".today-meal");
  })).toBe(true);
  await page.locator("#openSearch").click();
  await expect(page.locator("#searchDialog")).toBeVisible();
  await page.evaluate(async () => {
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway();
    gateway.state.data.announcements = [{ id: "new", title: "대화상자 중 변경", updatedAtMs: Date.now() }];
    gateway.emit();
  });
  await expect(page.locator("#searchDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".today-notices")).toContainText("대화상자 중 변경");
});
test("repository batches notification and cache writes", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/next/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { PinconClassOpsRepository } = await import("/pincon-class-ops-data.js");
    const repository = new PinconClassOpsRepository();
    let changes = 0;
    let saves = 0;
    repository.addEventListener("change", () => { changes += 1; });
    const original = repository.flushCache.bind(repository);
    repository.flushCache = () => { saves += 1; original(); };
    for (let i = 0; i < 50; i += 1) { repository.emit(); repository.saveCache(); }
    await new Promise((resolve) => setTimeout(resolve, 850));
    const result = { changes, saves };
    repository.dispose();
    return result;
  });
  expect(result).toEqual({ changes: 1, saves: 1 });
});
