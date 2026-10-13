import { test, expect } from "@playwright/test";

const rows = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `calendar-${i}`, classKey: "1-8", type: "assessment", subject: i % 2 ? "통합과학" : "공통국어", title: `공동 보고서 ${i + 1}`, dueDate: "2026-11-13", published: true })),
  { id: "january", classKey: "1-8", type: "assessment", subject: "수학", title: "새해 수학 발표", dueDate: "2027-01-05", published: true },
  { id: "undated", classKey: "1-8", type: "assessment", subject: "미술", title: "날짜가 없는 미술 과제", published: true },
  { id: "deleted", classKey: "1-8", type: "assessment", title: "삭제됨", dueDate: "2026-11-13", deleted: true },
  { id: "draft", classKey: "1-8", type: "assessment", title: "비공개", dueDate: "2026-11-13", published: false },
  { id: "other-class", classKey: "1-7", type: "assessment", title: "다른 반", dueDate: "2026-11-13", published: true },
];
async function seed(page, records = rows) {
  await page.addInitScript(records => {
    if (sessionStorage.getItem("pincon-calendar-test-seeded")) return;
    sessionStorage.setItem("pincon-calendar-test-seeded", "yes");
    localStorage.setItem("pincon-startup-enabled-v1", "off");
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: { classAssignments: records } }));
  }, records);
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
}
test.use({ reducedMotion: "reduce" });

for (const width of [360, 768, 1280]) {
  test(`calendar groups deadlines, opens every task and returns to covers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "달력 보기", exact: true }).click();
    await expect(page.locator(".pc-calendar")).toHaveAttribute("data-month", "2026-11");
    await expect(page.locator(".pc-calendar-day")).toHaveCount(35);
    const day = page.locator('[data-date="2026-11-13"]');
    await expect(day.locator(".pc-calendar-tile")).toHaveCount(2);
    await expect(day.locator(".pc-calendar-more")).toHaveText("+3개");
    await expect(page.locator('.pc-calendar-unscheduled [data-assessment-id="undated"]')).toBeVisible();
    await expect(page.locator('[data-assessment-id="deleted"], [data-assessment-id="draft"], [data-assessment-id="other-class"]')).toHaveCount(0);
    const first = day.locator('[data-assessment-id="calendar-0"]');
    await first.click();
    await expect(page.locator("#detail-title")).toHaveText("공동 보고서 1");
    await page.keyboard.press("Escape");
    await expect(first).toBeFocused();
    await day.locator(".pc-calendar-more").click();
    await expect(page.locator("#calendar-day-title")).toBeFocused();
    await expect(page.locator(".pc-calendar-agenda .pc-calendar-tile")).toHaveCount(5);
    await page.locator('.pc-calendar-agenda [data-assessment-id="calendar-4"]').click();
    await expect(page.locator("#detail-title")).toHaveText("공동 보고서 5");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "다음 달", exact: true }).click();
    await expect(page.locator(".pc-calendar")).toHaveAttribute("data-month", "2026-12");
    await page.getByRole("button", { name: "다음 달", exact: true }).click();
    await expect(page.locator(".pc-calendar")).toHaveAttribute("data-month", "2027-01");
    await expect(page.locator('[data-date="2027-01-05"] [data-assessment-id="january"]')).toBeVisible();
    await page.getByRole("button", { name: "커버 보기", exact: true }).click();
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "calendar-0");
    await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("view motion moves real sheets, stays bounded and cleans up after rapid reversals", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await seed(page);
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  const moving = await page.evaluate(() => {
    const source = new Map([...document.querySelectorAll('.pc-cover')].map(node => [node.dataset.assessmentId, node.querySelector(':scope > .pc-face').getBoundingClientRect().toJSON()]));
    document.querySelector("#view-toggle").click();
    const proxies = [...document.querySelectorAll(".pc-view-proxy")];
    const errors = [];
    for (const proxy of proxies) {
      for (const animation of proxy.getAnimations()) { animation.pause(); animation.currentTime = 0; }
      const original = source.get(proxy.dataset.assessmentId), start = proxy.getBoundingClientRect();
      errors.push(...['left', 'top', 'width', 'height'].map(key => Math.abs(start[key] - original[key])));
      for (const animation of proxy.getAnimations()) animation.play();
    }
    return { count: proxies.length, errors, transforms: proxies.flatMap(node => node.getAnimations().flatMap(animation => animation.effect.getKeyframes().map(frame => frame.transform).filter(Boolean))) };
  });
  expect(moving.count).toBeGreaterThan(0);
  expect(moving.count).toBeLessThanOrEqual(12);
  expect(moving.transforms.some(transform => transform.includes("matrix3d("))).toBe(true);
  expect(Math.max(...moving.errors)).toBeLessThan(1);
  const reversal = await page.evaluate(() => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 140; }
    const old = document.querySelector('.pc-view-proxy'), previous = old.getBoundingClientRect(), id = old.dataset.assessmentId;
    document.querySelector('#view-toggle').click();
    const next = document.querySelector(`.pc-view-proxy[data-assessment-id="${id}"]`);
    for (const animation of next.getAnimations()) { animation.pause(); animation.currentTime = 0; }
    const current = next.getBoundingClientRect();
    return ['left', 'top', 'width', 'height'].map(key => Math.abs(previous[key] - current[key]));
  });
  expect(Math.max(...reversal)).toBeLessThan(1);
  await page.evaluate(() => { for (const animation of document.getAnimations()) animation.finish(); });
  await expect(page.locator(".pc-view-transition")).toHaveCount(0);
  await expect(page.locator(".pc-view-hidden")).toHaveCount(0);
  await page.evaluate(() => document.querySelector('#view-toggle').click());
  await expect(page.locator(".pc-view-transition")).toHaveCount(0);
  const maximumSkins = await page.evaluate(() => {
    for (let i = 0; i < 5; i++) document.querySelector("#view-toggle").click();
    return Math.max(...[...document.querySelectorAll('.pc-view-proxy')].map(node => node.querySelectorAll('.pc-view-skin').length));
  });
  expect(maximumSkins).toBeLessThanOrEqual(4);
  await expect(page.locator(".pc-scene")).toBeVisible();
  await expect(page.locator(".pc-view-transition")).toHaveCount(0);
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveCSS("visibility", "visible");
  await page.evaluate(() => document.querySelector("#view-toggle").click());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".pc-view-transition")).toHaveCount(0);
  await expect(page.locator(".pc-view-hidden")).toHaveCount(0);
  await page.getByRole("button", { name: "커버 보기", exact: true }).click();
  await expect(page.locator(".pc-view-transition")).toHaveCount(0);
  await expect(page.locator("#covers")).not.toHaveAttribute("aria-busy", "true");
});

test("every grid entry follows the current cover, including crowded days and another year", async ({ page }) => {
  await seed(page);
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "달력 보기", exact: true }).click();
  await expect(page.locator('[data-date="2026-11-13"]')).toHaveClass(/is-anchor/);
  await expect(page.locator('.pc-calendar-agenda')).toHaveCount(0);
  await page.getByRole("button", { name: "다음 달", exact: true }).click();
  await page.getByRole("button", { name: "커버 보기", exact: true }).click();
  await page.locator('.pc-scene').focus(); await page.keyboard.press("PageDown");
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "calendar-4");
  await page.getByRole("button", { name: "달력 보기", exact: true }).click();
  await expect(page.locator('.pc-calendar')).toHaveAttribute('data-month', '2026-11');
  await expect(page.locator('[data-date="2026-11-13"] [data-calendar-anchor="true"]')).toHaveAttribute('data-assessment-id', 'calendar-4');
  await expect(page.locator('[data-date="2026-11-13"] .pc-calendar-more')).toHaveText('+3개');
  await page.getByRole("button", { name: "커버 보기", exact: true }).click();
  await page.locator('.pc-scene').focus(); await page.keyboard.press("ArrowRight");
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute('data-assessment-id', 'january');
  await page.getByRole("button", { name: "달력 보기", exact: true }).click();
  await expect(page.locator('.pc-calendar')).toHaveAttribute('data-month', '2027-01');
  await expect(page.locator('[data-date="2027-01-05"] [data-calendar-anchor="true"]')).toHaveAttribute('data-assessment-id', 'january');
});

test("grid recognizes labelled dates and corrected date state without writing to records", async ({ page }) => {
  const fixture = [
    { id: 'written', dueDate: '2026년 11월 13일', dateType: 'undecided' },
    { id: 'labelled', description: '준비물: 필기도구\n제출일: 11월 20일', announcedDate: '2026-10-13' },
    { id: 'tentative', description: '제출일: 11월 27일 예정' },
    { id: 'period', dueDate: '2026-11-21', dateType: 'range' },
  ].map(row => ({ ...row, classKey: '1-8', type: 'assessment', published: true, title: row.id, subject: '국어' }));
  await seed(page, fixture);
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await page.getByRole('button', { name: '달력 보기', exact: true }).click();
  await expect(page.locator('[data-date="2026-11-13"] [data-assessment-id="written"]')).toBeVisible();
  await expect(page.locator('[data-date="2026-11-20"] [data-assessment-id="labelled"]')).toBeVisible();
  await expect(page.locator('.pc-calendar-unscheduled .pc-calendar-tile')).toHaveCount(2);
  const stored = await page.evaluate(async () => (new (await import('/next/core/data-gateway.js')).NextDataGateway()).snapshot().data.classAssignments);
  expect(stored).toEqual(fixture);
  await page.getByRole('button', { name: '커버 보기', exact: true }).click();
  await page.locator('.pc-scene').focus(); await page.keyboard.press('End');
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute('data-assessment-id', 'tentative');
  await page.getByRole('button', { name: '달력 보기', exact: true }).click();
  await expect(page.locator('[data-calendar-anchor="true"]')).toHaveAttribute('data-assessment-id', 'tentative');
  await expect(page.locator('[data-calendar-anchor="true"]')).toBeInViewport();
});

test("short mobile grid scrolls to its date before the transition and lands on the real tile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seed(page, [{ id: 'last-day', classKey: '1-8', type: 'assessment', published: true, subject: '미술', title: '작품 제출', dueDate: '2026-05-31' }]);
  await page.goto('http://127.0.0.1:4173/new/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.pc-scene')).toHaveAttribute('data-motion', 'resting');
  const end = await page.evaluate(() => {
    document.querySelector('#view-toggle').click();
    const proxy = document.querySelector('.pc-view-proxy[data-assessment-id="last-day"]');
    window.gridAnimations = document.getAnimations();
    for (const animation of window.gridAnimations) { animation.pause(); animation.currentTime = animation.effect.getComputedTiming().endTime; }
    const real = document.querySelector('[data-calendar-anchor="true"]').getBoundingClientRect(), final = proxy.getBoundingClientRect();
    return { scroll: document.querySelector('.pc-calendar').scrollTop, errors: ['left', 'top', 'width', 'height'].map(key => Math.abs(real[key] - final[key])), transition: !!document.querySelector('.pc-view-transition') };
  });
  expect(end.scroll).toBeGreaterThan(0);
  expect(end.transition).toBe(true);
  expect(Math.max(...end.errors)).toBeLessThan(1);
  await page.evaluate(() => { for (const animation of window.gridAnimations) animation.finish(); });
  await expect(page.locator('.pc-view-transition')).toHaveCount(0);
  await expect(page.locator('[data-calendar-anchor="true"]')).toBeInViewport();
  await expect(page.locator('.pc-view-hidden')).toHaveCount(0);
});

test("editing a formerly undecided deadline updates date state and reaches its calendar cell", async ({ page }) => {
  await seed(page, [{ id: 'editable', classKey: '1-8', type: 'assessment', published: true, subject: '영어', title: '발표 평가', dueDate: '', dateType: 'undecided' }]);
  await page.goto('http://127.0.0.1:4173/new/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toBeVisible();
  await page.evaluate(async () => {
    const gateway = new (await import('/next/core/data-gateway.js')).NextDataGateway();
    gateway.state.canArchiveContent = true; gateway.emit();
    const { ContentServiceV2 } = await import('/next/admin/content-service-v2.js?v=20261009-upload2');
    ContentServiceV2.prototype.save = async (_collection, values, { id }) => {
      window.savedAssessment = values;
      return { id, record: values };
    };
  });
  await page.locator('.pc-cover[aria-pressed="true"]').click();
  await page.getByRole('button', { name: '내용·첨부 수정', exact: true }).click();
  await page.locator('input[name="dueDate"]').fill('2027-01-05');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#details')).not.toBeVisible();
  expect(await page.evaluate(() => window.savedAssessment.dateType)).toBe('exact');
  await page.getByRole('button', { name: '달력 보기', exact: true }).click();
  await expect(page.locator('.pc-calendar')).toHaveAttribute('data-month', '2027-01');
  await expect(page.locator('[data-date="2027-01-05"] [data-assessment-id="editable"]')).toBeVisible();
});

test("calendar keyboard crosses month boundaries and background sync retains the view", async ({ page }) => {
  await seed(page);
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "달력 보기", exact: true }).click();
  const first = page.locator('.pc-calendar-number[data-calendar-day="2026-11-01"]');
  await first.focus();
  await first.press("ArrowLeft");
  await expect(page.locator(".pc-calendar")).toHaveAttribute("data-month", "2026-10");
  await expect(page.locator('.pc-calendar-number[data-calendar-day="2026-10-31"]')).toBeFocused();
  await expect(page.locator('.pc-calendar-number[tabindex="0"]')).toHaveCount(1);
  const preserved = await page.evaluate(async () => {
    const calendar = document.querySelector(".pc-calendar");
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway();
    gateway.state.data.classAssignments[0].description = "상세 내용 갱신";
    gateway.emit();
    return calendar === document.querySelector(".pc-calendar");
  });
  expect(preserved).toBe(true);
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  const todayMonth = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  await expect(page.locator(".pc-calendar")).toHaveAttribute("data-month", todayMonth);
});

test("startup setting persists and enabling it restores the next greeting", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await seed(page);
  // Seed only the first document; subsequent navigations must read the setting.
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await page.getByRole("button", { name: "화면과 계정 설정", exact: true }).click();
  await expect(page.locator("#startup-enabled")).not.toBeChecked();
  await page.locator("#startup-enabled").check();
  expect(await page.evaluate(() => localStorage.getItem("pincon-startup-enabled-v1"))).toBe("on");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => window.PINCON_STARTUP.mode)).toBe("full");
  await page.getByRole("button", { name: "화면과 계정 설정", exact: true }).click();
  await page.locator("#startup-enabled").uncheck();
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => ({ mode: window.PINCON_STARTUP.mode, enabled: window.PINCON_STARTUP.enabled, finished: window.PINCON_STARTUP.finished }))).toEqual({ mode: "none", enabled: false, finished: true });
  await expect(page.locator(".pc-startup")).toHaveCount(0);
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
});
