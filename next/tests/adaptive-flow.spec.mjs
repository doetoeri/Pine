import { expect, test } from "@playwright/test";

const base = "http://127.0.0.1:4173";
const current = page => page.locator('.pc-cover[data-current="true"]');
const settings = page => page.getByRole("button", { name: "접근성 설정", exact: true });
const host = page => page.getByRole("navigation", { name: "학교생활", exact: true });
const before = "UklGRiIAAABXRUJQVlA4TAYAAAAvAAAAAA==";
const api = "**/api/class-ops/vision-lab*";

test.use({ reducedMotion: "reduce", serviceWorkers: "block" });

test("only the current cover is accessible and focus follows keyboard selection", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(base);
  const flow = page.locator(".pc-flow");
  await expect(flow.getByRole("group", { name: /6장 중/ })).toBeVisible();
  const slide = flow.getByRole("group", { name: /6장 중/ });
  await expect(slide.getByRole("button")).toHaveCount(1);
  await expect(current(page)).toHaveAttribute("aria-current", "true");
  await expect(flow.getByRole("status")).toBeEmpty();
  await current(page).press("ArrowRight");
  await expect(current(page)).toBeFocused();
  await expect(current(page)).toHaveAttribute("data-cover-id", "assessment");
  await expect(slide.getByRole("button")).toHaveCount(1);
  const active = await current(page).evaluate(node => {
    const box = node.getBoundingClientRect();
    const outline = getComputedStyle(node.querySelector(".pc-face"));
    return { visible: node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), width: outline.outlineWidth, style: outline.outlineStyle };
  });
  expect(active).toEqual({ visible: true, width: "3px", style: "solid" });
  await current(page).press("Tab");
  const previous = flow.getByRole("button", { name: "이전 커버" });
  await expect(previous).toBeFocused();
  await previous.press("Space");
  await expect(previous).toBeFocused();
  await expect(flow.getByRole("status")).toHaveText(/오늘 한눈에 보기.*6장 중/);
  await previous.press("Shift+Tab");
  await expect(current(page)).toBeFocused();
  await current(page).press("Enter");
  const dialog = page.getByRole("dialog", { name: "오늘 한눈에 보기" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(current(page)).toBeFocused();
});

test("a vertical gesture that leaves the card does not activate it", async ({ page }) => {
  await page.setViewportSize({ width: 383, height: 790 });
  await page.goto(base);
  const card = current(page);
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  const x = bounds.x + bounds.width / 2;
  await page.mouse.move(x, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, bounds.y + bounds.height + 36, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#school-detail")).toBeHidden();
  await expect(card).toHaveAttribute("data-cover-id", "today");
  await card.click();
  await expect(page.locator("#school-detail")).toBeVisible();
});

test("200 percent text reflows while the user's cover layout preference remains available", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(base);
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-pc-layout", "covers");
  const overrides = await page.addStyleTag({ content: "html { font-size: 200% } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }" });
  await expect(root).toHaveAttribute("data-pc-layout", "list");
  await expect(page.getByRole("list", { name: "학교생활 목록" }).getByRole("listitem")).toHaveCount(6);
  const width = () => root.evaluate(node => node.scrollWidth);
  expect(await width()).toBe(320);
  await host(page).getByRole("link", { name: "급식", exact: true }).click();
  await expect(page.getByRole("list", { name: "급식 목록" })).toBeVisible();
  expect(await width()).toBe(320);
  await settings(page).click();
  const dialog = page.getByRole("dialog", { name: "접근성 설정" });
  await expect(dialog.getByLabel("목록 보기")).not.toBeChecked();
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await overrides.evaluate(node => node.remove());
  await expect(root).toHaveAttribute("data-pc-layout", "covers");
});

test("invalid student input explains the required format and clears the error on correction", async ({ page }) => {
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto(base + "/new/?settings=account");
  const dialog = page.getByRole("dialog", { name: "설정", exact: true });
  const number = dialog.getByRole("textbox", { name: "학번" });
  await expect(number).toBeFocused();
  await expect(number).toHaveAccessibleDescription("숫자 5자리");
  await number.fill("12");
  await dialog.locator('input[name="pin"]').fill("123456");
  await dialog.getByRole("button", { name: "학생 로그인", exact: true }).press("Enter");
  await expect(number).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.locator("#preferences-status")).toHaveText("학번을 숫자 5자리로 입력해 주세요.");
  await number.fill("12345");
  await expect(number).not.toHaveAttribute("aria-invalid", "true");
  await expect(dialog.locator("#preferences-status")).toBeEmpty();
});

test("Lab links follow visibility and both images receive and clear the same filter", async ({ page }) => {
  let available = false;
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.route(api, route => {
    const view = new URL(route.request().url()).searchParams.get("view");
    return route.fulfill({ status: !view && !available ? 403 : 200, headers: { "access-control-allow-origin": "*" },
      json: view ? { available } : available ? { comparison: { before, after: before, highContrast: before } } : { error: "vision-lab-private" } });
  });
  await page.goto(base);
  await settings(page).click();
  const link = page.getByRole("link", { name: /Vision Lab/ });
  await expect(link).toBeHidden();
  await page.keyboard.press("Escape");
  await page.goto(base + "/vision-lab/");
  await expect(page.getByRole("status")).toHaveText("현재 체험실을 열람할 수 없어요.");
  await expect(page.getByLabel("시각 시뮬레이션")).toBeHidden();
  available = true;
  await page.goto(base);
  await settings(page).click();
  await link.click();
  const mode = page.getByLabel("시각 시뮬레이션");
  await expect(mode).toBeVisible();
  const filters = () => page.locator(".lab-pair img").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).filter));
  for (const value of ["protan", "deutan", "tritan", "monochrome", "blur", "contrast"]) {
    await mode.selectOption(value);
    const [a, b] = await filters();
    expect(a).toBe(b);
    expect(a).not.toBe("none");
  }
  await page.getByRole("button", { name: "일반 시각으로 돌아가기" }).click();
  await expect(mode).toBeFocused();
  expect(await filters()).toEqual(["none", "none"]);
});
