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

  await page.evaluate(async () => {
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway();
    gateway.state.data.evaluationPlans = [{ id: "stable-plan", title: "공식 평가계획서", subject: "공통영어", status: "verified", sourceUrl: "https://example.com/plan.pdf" }];
    gateway.emit();
  });
  await page.locator('.nav-control[data-route="classroom"]:visible').click();
  const planCard = page.locator('[data-evaluation-plan-open="stable-plan"]');
  await expect(planCard).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await planCard.evaluate((node) => { globalThis.__stablePlanCard = node; node.focus(); });
  await expect(planCard).toBeFocused();
  await page.evaluate(async () => {
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway();
    for (let i = 0; i < 40; i += 1) {
      gateway.state.data.events = [{ id: "event", title: "변경된 학급 행사 " + i, date: "2099-01-01", status: "open" }];
      gateway.emit();
    }
  });
  await expect(page.locator('[data-render-key="events"]')).toContainText("변경된 학급 행사 39");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await planCard.evaluate((node) => ({ sameCard: node === globalThis.__stablePlanCard, focused: document.activeElement === node }))).toEqual({ sameCard: true, focused: true });
  await expect(page.locator("[data-evaluation-plan-library-host]")).toHaveCount(1);
  await expect(page.locator(".evaluation-plan-region article")).toHaveCount(1);
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

test("the first empty server result clears stale cached records", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/next/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { PinconClassOpsRepository } = await import("/pincon-class-ops-data.js");
    const repository = new PinconClassOpsRepository();
    repository.state.data.announcements = [{ id: "deleted", title: "오래된 공지" }];
    repository.state.collectionStatus.announcements = "cached";
    const receivers = new Map();
    repository.api = {
      db: {},
      collection: (...args) => args.at(-1),
      query: (name) => name,
      where: () => null,
      limit: () => null,
      onSnapshot: (name, options, receive) => { receivers.set(name, receive); return () => {}; },
    };
    repository.listenPublic();
    const receive = receivers.get("announcements");
    receive({ docs: [], docChanges: () => [], metadata: { fromCache: false } });
    const afterDeletion = repository.state.data.announcements.length;
    receive({ docs: [{ id: "new", data: () => ({ title: "서버 공지" }) }], docChanges: () => [{ type: "added" }], metadata: { fromCache: false } });
    const records = repository.state.data.announcements;
    receive({ get docs() { throw new Error("Metadata-only updates must not read unchanged documents"); }, docChanges: () => [], metadata: { fromCache: false } });
    const sameRecords = records === repository.state.data.announcements;
    repository.dispose();
    return { afterDeletion, title: records[0].title, sameRecords };
  });
  expect(result).toEqual({ afterDeletion: 0, title: "서버 공지", sameRecords: true });
});
