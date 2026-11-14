import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";
const today = "2026-11-13";
const data = {
  meals: [{ id: "lunch", date: today, mealType: "중식", dishesHtml: "밥<br/>비빔밥 (1.5.6.19)", source: "NEIS" }],
  neisTimetables: [{ id: "fri", classKey: "1-8", date: today, source: "COMCIGAN", periods: [
    { period: 1, subject: "수학", startTime: "09:10", endTime: "10:00" },
    { period: 2, subject: "공통영어", startTime: "10:10", endTime: "11:00" },
  ] }],
  classAssignments: [
    { id: "first", classKey: "1-8", type: "assessment", title: "수학 발표", subject: "수학", dueDate: "2026-11-15", published: true,
      noticeAttachment: { storagePath: "class-resources/gochon-high/1-8/first/notice.pdf", fileName: "안내문.pdf", contentType: "application/pdf" } },
    { id: "second", classKey: "1-8", type: "assessment", title: "과학 보고서", dueDate: "2026-11-18" },
    { id: "past", classKey: "1-8", type: "assessment", title: "지난 수행", dueDate: "2026-11-12" },
    { id: "hidden", classKey: "1-8", type: "assessment", title: "비공개 수행", dueDate: today, published: false },
    { id: "other", classKey: "1-7", type: "assessment", title: "다른 학급 수행", dueDate: today },
  ],
  events: [
    { id: "event", classKey: "1-8", date: "2026-11-12", title: "학급 행사", question: "행사 장소를 확인합니다.", status: "closed" },
    { id: "important", classKey: "1-8", date: today, title: "중요한 일정", question: "일정 세부 내용", status: "closed", scheduleOnly: true },
    { id: "draft", classKey: "1-8", date: today, title: "비공개 행사", status: "draft" },
  ],
  academicSchedules: [{ id: today, date: today, eventsByGrade: { 1: ["1학년 행사"], 2: ["2학년 행사"] } }],
  announcements: [
    { id: "important", classKey: "1-8", title: "중요 공지를 확인하세요", priority: "urgent", body: "공지 본문입니다." },
    { id: "draft", classKey: "1-8", title: "비공개 공지", priority: "urgent", published: false },
  ],
  content: [],
};

async function start(page, rows = data) {
  await page.clock.setFixedTime(new Date("2026-11-13T00:35:00Z"));
  await page.addInitScript(rows => {
    if (sessionStorage.getItem("school-life-test")) return;
    sessionStorage.setItem("school-life-test", "yes");
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-startup-enabled-v1", "off");
    if (rows) {
      localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({
        classKey: "1-8", savedAtMs: Date.now(), data: rows,
      }));
    }
  }, rows);
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
}

test.use({ reducedMotion: "reduce", serviceWorkers: "block" });

for (const width of [320, 383, 768, 1363]) {
  test(`student tasks and reflow at ${width} CSS pixels`, async ({ page }) => {
    await page.setViewportSize({ width, height: 840 });
    await start(page);
    const main = page.getByRole("main");
    await expect(main.getByText("밥 · 비빔밥")).toBeVisible();
    await expect(main.getByText("다음 수업 · 2교시 공통영어")).toBeVisible();
    await expect(main.getByRole("link", { name: /수학 발표/ })).toContainText("D-2");
    await expect(main.getByText("중요한 일정")).toBeVisible();
    await expect(main.getByText("중요 공지를 확인하세요")).toBeVisible();
    await expect(main.getByText(/비공개|다른 학급 수행|지난 수행/)).toHaveCount(0);
    await expect(main.getByRole("link", { name: /학급 일정 관리/ })).toHaveCount(0);

    await main.getByRole("link", { name: "식단·알레르기" }).click();
    await expect(main.getByRole("heading", { name: "급식", exact: true })).toBeFocused();
    await expect(main.getByText("알레르기 표시 · 난류, 대두, 밀, 잣")).toBeVisible();
    const nextWeek = page.getByRole("link", { name: "다음 주" });
    await nextWeek.press("Enter");
    await expect(page).toHaveURL(/#meals\/2026-11-16/);
    await expect(nextWeek).toBeFocused();
    await page.goBack();
    await expect(main.getByText("알레르기 표시 · 난류, 대두, 밀, 잣")).toBeVisible();

    await page.getByRole("navigation", { name: "학교생활" }).getByRole("link", { name: "학급 일정" }).click();
    await expect(main.getByText("1학년 행사")).toBeVisible();
    await expect(main.getByText("2학년 행사")).toHaveCount(0);
    await main.locator("summary").filter({ hasText: "중요한 일정" }).click();
    await expect(main.getByText("일정 세부 내용")).toBeVisible();
    await expect(main.getByText("비공개 행사")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole("link", { name: "PinCon 홈" }).click();
    await main.getByRole("link", { name: /수학 발표/ }).click();
    await expect(page.locator("#detail-title")).toHaveText("수학 발표");
    await page.getByRole("button", { name: "안내문 보기" }).press("Enter");
    const attachment = page.getByRole("dialog", { name: "안내문" });
    await expect(attachment.getByText("안내 자료를 보려면 학번과 PIN으로 로그인해 주세요.")).toBeVisible();
    await attachment.getByRole("button", { name: "학생 로그인" }).press("Enter");
    await expect(page.getByRole("textbox", { name: "학번" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(attachment.getByRole("button", { name: "학생 로그인" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "안내문 보기" })).toBeFocused();
  });
}

test("missing school data returns a retry, public users cannot open event management", async ({ page }) => {
  await start(page, null);
  const meals = page.getByRole("region", { name: "오늘의 급식" });
  await expect(meals.getByText("최신 자료를 불러오지 못했어요.")).toBeVisible();
  await meals.getByRole("button", { name: "다시 시도" }).press("Enter");
  await expect(meals.getByText("최신 자료를 불러오지 못했어요.")).toBeVisible();
  await page.goto(base + "/next/admin/?content=events#content-center", { waitUntil: "domcontentloaded" });
  await page.waitForURL(url => url.pathname === "/next/", { timeout: 5_000, waitUntil: "domcontentloaded" });
});

test("assessment calendar avoids fixed overlays and the notice editor follows visual order", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await start(page);
  await page.getByRole("navigation", { name: "학교생활" }).getByRole("link", { name: "수행평가" }).click();
  await page.getByRole("button", { name: "달력 보기" }).click();
  await expect(page.locator("#calendar-month-title")).toBeVisible();
  const layout = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const calendar = rect(".pc-calendar"), buttons = rect(".assessment-footer");
    return [rect("#notice-open").bottom <= rect("#calendar-month-title").top, calendar.bottom <= buttons.top];
  });
  expect(layout).toEqual([true, true]);
  await page.getByRole("button", { name: "수행 공지 이미지 만들기" }).click();
  await expect(page.getByRole("dialog", { name: "오늘 밤, 수행 공지" })).toBeVisible();
  const order = await page.evaluate(() => {
    const controls = document.querySelector(".notice-controls"), preview = document.querySelector(".notice-preview-area");
    return [Boolean(controls.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING),
      controls.getBoundingClientRect().bottom <= preview.getBoundingClientRect().top];
  });
  expect(order).toEqual([true, true]);
  await page.getByRole("button", { name: "공지 이미지 닫기" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#notice-day")).toBeFocused();
});
