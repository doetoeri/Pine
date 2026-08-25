import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 360, height: 800, mode: "bottom" },
  { width: 390, height: 844, mode: "bottom" },
  { width: 600, height: 960, mode: "dialog" },
  { width: 768, height: 1024, mode: "dialog" },
  { width: 1024, height: 768, mode: "dialog" },
  { width: 1440, height: 900, mode: "side" },
];

async function seedCache(page, { empty = false } = {}) {
  await page.addInitScript(({ empty }) => {
    const now = new Date();
    const iso = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const future = new Date(now);
    future.setDate(future.getDate() + 10);
    const futureDate = iso(future);
    const today = iso(now);
    const collections = {
      announcements: empty ? [] : [{
        id: "notice-1",
        classKey: "1-8",
        title: "이번 주 학급 공지",
        body: "준비물과 변경된 내용을 확인하세요.",
        updatedAtMs: Date.now(),
      }],
      classAssignments: empty ? [] : [{
        id: "assignment-long",
        classKey: "1-8",
        type: "assessment",
        subject: "공영",
        title: "매우 긴 과목 이름과 안내 문장을 포함한 영어 말하기 수행평가",
        dueDate: futureDate,
        confirmed: true,
        evaluationRange: "교과서 2단원부터 3단원까지",
        evaluationMethod: "개별 말하기",
        materials: "발표 원고",
        weight: "20%",
        description: "평가 순서와 제출 방법을 상세 화면에서 확인합니다.",
        updatedAtMs: Date.now(),
      }],
      events: empty ? [] : [{
        id: "event-1",
        classKey: "1-8",
        status: "open",
        title: "학급 체육 행사",
        date: futureDate,
        location: "운동장",
        question: "운동복과 물을 준비하세요.",
      }],
      polls: [],
      feedback: [],
      supplies: [],
      supplyLoans: [],
      lostItems: [],
      resources: empty ? [] : [{
        id: "resource-1",
        classKey: "1-8",
        title: "공통영어 수행평가 학습 자료",
        subject: "공영",
        moderationStatus: "approved",
        description: "수행평가 대비 자료",
      }],
      patchNotes: [],
      academicSchedules: empty ? [] : [{
        id: "academic-1",
        title: "토요휴업일",
        date: futureDate,
        grade: 1,
      }],
      neisTimetables: empty ? [] : [{
        id: `timetable-${today}`,
        classKey: "1-8",
        date: today,
        source: "COMCIGAN",
        fetchedAtMs: Date.now(),
        periods: [{ period: 1, subject: "통과", room: "1-8", teacher: "담당 교사", materials: "교과서" }],
      }],
      meals: empty ? [] : [{
        id: `meal-${today}`,
        classKey: "1-8",
        date: today,
        mealType: "중식",
        dishesHtml: "현미밥<br>된장국(5.6)<br>달걀말이(1)",
        calories: "720 Kcal",
        source: "NEIS",
        fetchedAtMs: Date.now(),
      }],
      content: [],
      classSettings: [],
    };
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({
      version: 1,
      classKey: "1-8",
      savedAtMs: Date.now() - 120_000,
      data: collections,
    }));
  }, { empty });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
}

async function triggerHasFocus(locator) {
  return locator.evaluate((host) => document.activeElement === host || Boolean(host.shadowRoot?.activeElement));
}

for (const viewport of VIEWPORTS) {
  test(`detail surface stays usable at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await seedCache(page);
    await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });

    const trigger = page.locator('[data-detail-key^="assignment:classAssignments:"]').first();
    await expect(trigger).toBeVisible({ timeout: 8_000 });
    await page.evaluate(() => window.scrollTo(0, 180));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await trigger.click();

    const layer = page.locator("#detailLayer");
    const surface = page.locator("#detailSurface");
    await expect(layer).toBeVisible();
    await expect(surface).toHaveAttribute("data-mode", viewport.mode);
    await expect(page.locator("#detailTitle")).toBeFocused();
    await expect(page.locator("#detailTitle")).toContainText("영어 말하기 수행평가");
    await expect(surface).toContainText("D-");
    await expect(surface).toContainText("확정");
    await expect(surface).toContainText("공통영어");

    const geometry = await surface.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.top).toBeGreaterThanOrEqual(-1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
    expect(geometry.pageOverflow).toBe(false);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    if (viewport.mode === "side") {
      await expect(page.locator(".app-frame")).not.toHaveAttribute("aria-hidden", "true");
    } else {
      await expect(page.locator(".app-frame")).toHaveAttribute("aria-hidden", "true");
    }

    if (viewport.width < 600) {
      await expect(page.locator(".bottom-nav")).toBeVisible();
      const layers = await page.evaluate(() => ({
        sheet: Number.parseInt(getComputedStyle(document.querySelector(".detail-layer")).zIndex, 10),
        nav: Number.parseInt(getComputedStyle(document.querySelector(".bottom-nav")).zIndex, 10),
      }));
      expect(layers.sheet).toBeGreaterThan(layers.nav);
    }

    await page.goBack();
    await expect(layer).toBeHidden();
    await expect.poll(() => triggerHasFocus(trigger)).toBe(true);
    await context.close();
  });
}

test("notification opens its related item, keeps read state, and moves focus", async ({ page }) => {
  await seedCache(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-detail-key^="announcement:announcements:notice-1"]')).toBeVisible();

  await page.locator("#openNotifications").click();
  const row = page.locator('[data-notification-id="announcement:notice-1"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-read", "false");
  await row.click();

  await expect(page.locator("#detailLayer")).toBeVisible();
  await expect(page.locator("#detailTitle")).toBeFocused();
  await expect(page.locator("#detailSurface")).toContainText("알림 정보");
  await expect(page.locator("#detailSurface")).toContainText("발생 시각");
  await expect(page.locator("#detailSurface")).toContainText("변경된 내용");

  await page.goBack();
  await expect(page.locator("#detailLayer")).toBeHidden();
  await page.locator("#openNotifications").click();
  await expect(page.locator('[data-notification-id="announcement:notice-1"]')).toHaveAttribute("data-read", "true");
});

test("loading never reports zero and known empty cache uses an actual empty state", async ({ browser }) => {
  const loadingContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const loadingPage = await loadingContext.newPage();
  await loadingPage.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });
  await loadingPage.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  await loadingPage.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(loadingPage.locator("#today-title")).toBeVisible();
  await expect(loadingPage.locator(".hero-meta")).not.toContainText("0개 수업");
  await expect(loadingPage.locator(".hero-meta")).toContainText(/시간표 (확인 중|연결 오류)/);
  await expect(loadingPage.locator(".notice-banner")).toBeVisible({ timeout: 8_000 });
  await loadingContext.close();

  const emptyContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const emptyPage = await emptyContext.newPage();
  await seedCache(emptyPage, { empty: true });
  await emptyPage.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(emptyPage.locator("#today-title")).toBeVisible();
  await expect(emptyPage.getByText("등록된 수업이 없습니다")).toBeVisible();
  await expect(emptyPage.getByText("급식 정보가 없습니다")).toBeVisible();
  await emptyContext.close();
});
