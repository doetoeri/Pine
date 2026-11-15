import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";
const today = "2026-11-13";
const data = {
  meals: [
    { id: "lunch", date: today, mealType: "중식", dishesHtml: "밥<br/>비빔밥 (1.5.6.19)", source: "NEIS" },
    { id: "thu", date: "2026-11-12", mealType: "중식", dishesHtml: "검증용 목요일 식단", source: "NEIS" },
  ],
  neisTimetables: [{ id: "1-8-20261113", classKey: "1-8", date: today, source: "COMCIGAN", periods: [
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
    { id: "undated", classKey: "1-8", title: "날짜 미정 행사", question: "날짜를 추후 공지합니다.", status: "closed" },
    { id: "draft", classKey: "1-8", date: today, title: "비공개 행사", status: "draft" },
  ],
  academicSchedules: [{ id: today, date: today, eventsByGrade: { 1: ["1학년 행사"], 2: ["2학년 행사"] } }],
  announcements: [
    { id: "important", classKey: "1-8", title: "중요 공지를 확인하세요", priority: "urgent", body: "공지 본문입니다." },
    { id: "second", classKey: "1-8", title: "다음 중요 공지", priority: "important", body: "다음 공지 본문." },
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

function selected(page) {
  return page.locator(".pc-cover[data-current=true]");
}

const nav = page => page.getByRole("navigation", { name: "학교생활", exact: true });

test("accessibility settings persist between home, details, assessment and reload", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await start(page);
  const root = page.locator("html");
  const trigger = page.getByRole("button", { name: "접근성 설정", exact: true });
  const panel = page.getByRole("dialog", { name: "접근성 설정" });
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "본문으로 건너뛰기" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.getByRole("heading", { name: "오늘의 학교생활" })).toBeFocused();
  await trigger.press("Enter");
  await expect(panel.getByLabel("화면 대비")).toBeFocused();
  await panel.getByLabel("화면 대비").selectOption("high");
  await expect(root).toHaveAttribute("data-pc-contrast", "high");
  await expect(selected(page).locator(":scope > .pc-face")).toHaveCSS("border-top-width", "3px");
  await expect(selected(page).locator(":scope > .pc-reflection")).toHaveCSS("display", "none");
  await panel.getByLabel("동작 줄이기", { exact: true }).check();
  await expect(root).toHaveAttribute("data-pc-reduced-motion", "");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.locator(".pc-scene").press("ArrowRight");
  await expect(selected(page)).toHaveAttribute("data-cover-id", "assessment");
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");

  await trigger.click();
  await panel.getByLabel("글자 크게", { exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  const home = page.getByRole("list", { name: "학교생활 목록" });
  await expect(home.getByRole("listitem")).toHaveCount(6);
  expect(await root.evaluate(node => getComputedStyle(node).fontSize)).toBe("20px");
  const todayCard = home.getByRole("button", { name: /오늘 한눈에 보기/ });
  await todayCard.press("Enter");
  const details = page.getByRole("dialog", { name: "오늘 한눈에 보기" });
  await expect(details.getByRole("link", { name: /수학 발표/ })).toBeVisible();
  await expect(details).not.toHaveAttribute("data-dialog-motion", "opening");
  await page.keyboard.press("Escape");
  await expect(todayCard).toBeFocused();
  expect(await root.evaluate(node => node.scrollWidth)).toBe(320);

  await nav(page).getByRole("link", { name: "급식", exact: true }).click();
  const mealList = page.getByRole("list", { name: "급식 목록" });
  await expect(mealList.getByRole("listitem")).toHaveCount(7);
  await page.getByRole("link", { name: "11월 12일 목요일" }).click();
  const meal = mealList.getByRole("button", { name: /검증용 목요일 식단/ });
  await expect(meal).toBeFocused();
  await expect(meal).toHaveAttribute("aria-current", "date");
  await meal.press("Enter");
  await expect(page.getByRole("dialog", { name: "11월 12일 목요일" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(meal).toBeFocused();

  await nav(page).getByRole("link", { name: "수행평가", exact: true }).click();
  await expect(root).toHaveAttribute("data-pc-contrast", "high");
  await expect(root).toHaveAttribute("data-pc-reduced-motion", "");
  expect(await page.evaluate(() => window.PINCON_STARTUP.mode)).toBe("none");
  const assignments = page.getByRole("list", { name: "수행평가 목록" });
  const assignment = assignments.getByRole("button", { name: /수학 발표.*2026-11-15.*안내문/ });
  await expect(assignment).toBeVisible();
  await assignment.press("Enter");
  await expect(page.getByRole("dialog", { name: "수학 발표" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(assignment).toBeFocused();
  await page.getByRole("button", { name: "달력 보기", exact: true }).click();
  await expect(page.getByRole("main", { name: "수행평가 달력" })).toBeVisible();
  await expect(page.getByRole("button", { name: "목록 보기", exact: true })).toBeVisible();
  await expect(page.locator(".pc-view-transition")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(assignments).toBeVisible();
  await expect(root).toHaveAttribute("data-pc-contrast", "high");
  await trigger.click();
  await panel.getByRole("button", { name: "기본 설정으로 되돌리기" }).click();
  await expect(panel.getByLabel("화면 대비")).toHaveValue("system");
  await expect(root).toHaveAttribute("data-pc-layout", "covers");
  await expect(root).not.toHaveAttribute("data-pc-reduced-motion", "");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("system accessibility media and manual choices have the expected priority", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Forced color emulation is exercised in Chromium");
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await start(page);
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-pc-contrast", "high");
  await expect(root).toHaveAttribute("data-pc-reduced-motion", "");
  await page.getByRole("button", { name: "접근성 설정", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "접근성 설정" });
  await panel.getByLabel("화면 대비").selectOption("normal");
  await panel.getByLabel("목록 보기", { exact: true }).check();
  await expect(root).toHaveAttribute("data-pc-contrast", "high");
  await expect(root).toHaveAttribute("data-pc-layout", "list");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  await expect(root).toHaveAttribute("data-pc-contrast", "normal");
  await expect(root).not.toHaveAttribute("data-pc-reduced-motion", "");
  await expect(root).toHaveAttribute("data-pc-text", "normal");
});

for (const width of [320, 383, 768, 1363]) {
  test(`shared Cover Flow and student tasks at ${width} CSS pixels`, async ({ page }) => {
    await page.setViewportSize({ width, height: 840 });
    await start(page);
    const main = page.getByRole("main");
    const flow = main.locator(".pc-scene");
    const dialog = page.locator("#school-detail");

    await expect(flow.locator(".pc-cover")).toHaveCount(6);
    await expect(selected(page)).toHaveAttribute("data-cover-id", "today");
    await expect(selected(page)).toHaveAccessibleName(/밥 · 비빔밥.*2교시 공통영어.*D-2 · 수학 발표/);
    const transform = await main.locator('[data-cover-id="timetable"]').evaluate(card => card.style.transform);
    expect(transform).toContain("rotateY(65deg)");
    await expect(selected(page).locator(".pc-reflection")).toHaveCount(1);

    await page.getByRole("button", { name: "이전 커버", exact: true }).click();
    await expect(selected(page)).toHaveText(/다음 수업.*2교시 공통영어/);
    await flow.press("Home");
    await expect(selected(page)).toHaveAttribute("data-cover-id", "meals");
    await selected(page).press("Enter");
    await expect(page).toHaveURL(/#meals$/);
    await expect(main.getByRole("heading", { name: "급식", exact: true })).toBeFocused();
    await expect(selected(page)).toHaveAttribute("data-cover-id", today);

    await selected(page).press("Enter");
    await expect(dialog.getByText("알레르기 표시 · 난류, 대두, 밀, 잣")).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(selected(page)).toBeFocused();

    await flow.press("ArrowLeft");
    await expect(page).toHaveURL(/#meals\/2026-11-12$/);
    const thursday = page.getByRole("link", { name: "11월 12일 목요일" });
    await expect(thursday).toHaveAttribute("aria-current", "date");
    await expect(selected(page)).toHaveAccessibleName(/검증용 목요일 식단/);
    await thursday.click();
    await expect(thursday).toBeFocused();
    const nextWeek = page.getByRole("link", { name: "다음 주" });
    await nextWeek.press("Enter");
    await expect(page).toHaveURL(/#meals\/2026-11-16$/);
    await expect(nextWeek).toBeFocused();
    await page.goBack();
    await expect(selected(page)).toHaveAttribute("data-cover-id", "2026-11-12");

    await nav(page).getByRole("link", { name: "시간표" }).click();
    await expect(flow.locator(".pc-cover")).toHaveCount(7);
    await expect(selected(page)).toHaveAccessibleName(/현재 수업 1교시 수학.*다음 수업 2교시 공통영어/);
    await selected(page).press("Enter");
    await expect(dialog.getByRole("list", { name: "교시별 수업" }).getByRole("listitem")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await main.getByRole("button", { name: "주간 시간표" }).click();
    await expect(dialog.getByRole("heading", { name: "주간 시간표" })).toBeFocused();
    await expect(dialog.getByText("공통영어", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await nav(page).getByRole("link", { name: "학급 일정" }).click();
    await expect(selected(page)).toHaveAccessibleName(/중요한 일정.*1학년 행사/);
    await selected(page).press("Enter");
    await expect(dialog.getByText("일정 세부 내용")).toBeVisible();
    await expect(dialog.getByText("2학년 행사")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await main.getByRole("button", { name: "이번 주 일정" }).click();
    await expect(dialog.getByText("행사 장소를 확인합니다.")).toBeVisible();
    await expect(dialog.getByText("날짜 미정 행사")).toBeVisible();
    await expect(dialog.getByText("비공개 행사")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(flow.locator('[data-cover-id="undated"]')).toHaveCount(1);
    await flow.focus();
    await expect(flow).toBeFocused();
    await flow.press("End");
    await expect(page).toHaveURL(/\/undated$/);
    await expect(selected(page)).toHaveAttribute("data-cover-id", "undated");
    await expect(main.locator("[data-stage-date]")).toHaveText("날짜 미정");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await nav(page).getByRole("link", { name: "공지", exact: true }).click();
    await expect(flow.locator(".pc-cover")).toHaveCount(2);
    await expect(selected(page)).toHaveAccessibleName(/중요 공지를 확인하세요/);
    await page.getByRole("button", { name: "다음 커버", exact: true }).click();
    await expect(selected(page)).toHaveAccessibleName(/다음 중요 공지/);
    await selected(page).press("Enter");
    await expect(dialog.getByText("다음 공지 본문.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("link", { name: "PinCon 홈" }).click();
    await expect(page).toHaveURL(base + "/");
    await flow.focus();
    await flow.press("Home");
    await expect(selected(page)).toHaveAttribute("data-cover-id", "meals");
    await flow.press("ArrowRight");
    await expect(selected(page)).toHaveAttribute("data-cover-id", "timetable");
    await flow.press("ArrowRight");
    await expect(selected(page)).toHaveAttribute("data-cover-id", "today");
    await selected(page).press("Enter");
    await dialog.getByRole("link", { name: /수학 발표/ }).click();
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

test("missing school data returns a retry and public users cannot open event management", async ({ page }) => {
  await start(page, null);
  await nav(page).getByRole("link", { name: "급식", exact: true }).click();
  await expect(selected(page)).toHaveAccessibleName(/최신 자료를 불러오지 못했어요/);
  await selected(page).press("Enter");
  const dialog = page.locator("#school-detail");
  await expect(dialog.getByText("최신 자료를 불러오지 못했어요.")).toBeVisible();
  await dialog.getByRole("button", { name: "다시 시도" }).press("Enter");
  await expect(dialog.getByText("최신 자료를 불러오지 못했어요.")).toBeVisible();
  await page.keyboard.press("Escape");
  await nav(page).getByRole("link", { name: "학급 일정" }).click();
  await expect(page.getByRole("link", { name: "학급 일정 관리" })).toHaveCount(0);
  await page.goto(base + "/next/admin/?content=events#content-center", { waitUntil: "domcontentloaded" });
  await page.waitForURL(url => url.pathname === "/next/", { timeout: 5_000, waitUntil: "domcontentloaded" });
});

test("date covers drag, open and keep their selection after reload", async ({ page }) => {
  await page.setViewportSize({ width: 383, height: 790 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await start(page);
  await nav(page).getByRole("link", { name: "급식", exact: true }).click();
  const scene = page.locator(".pc-scene");
  await expect(scene).toHaveAttribute("data-motion", "resting");
  const cover = await selected(page).boundingBox();
  await page.mouse.move(cover.x + 75, cover.y + 75);
  await page.mouse.down();
  await page.mouse.move(cover.x + 205, cover.y + 75, { steps: 13 });
  await page.mouse.up();
  await expect(scene).toHaveAttribute("data-motion", "resting");
  expect(await selected(page).getAttribute("data-cover-id")).not.toBe(today);
  const selection = await selected(page).getAttribute("data-cover-id");
  await expect(selected(page)).toBeVisible();
  await selected(page).click();
  await expect(page.locator("#school-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(selected(page)).toBeFocused();
  expect(await page.evaluate(() => document.querySelectorAll(".pc-shared-cover").length)).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(selected(page)).toHaveAttribute("data-cover-id", selection);
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
