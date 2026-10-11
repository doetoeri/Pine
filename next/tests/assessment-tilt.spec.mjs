import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });

async function seed(page, permission = "granted") {
  await page.addInitScript(result => {
    if (!sessionStorage.getItem("pincon-tilt-test-seeded")) {
      sessionStorage.setItem("pincon-tilt-test-seeded", "yes");
      localStorage.setItem("pincon-startup-enabled-v1", "off");
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
      localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
        classAssignments: Array.from({ length: 24 }, (_, i) => ({ id: `tilt-${i}`, classKey: "1-8", type: "assessment", subject: "영어", title: `기울기 수행평가 ${i}`, dueDate: "2099-11-13", published: true })),
      } }));
    }
    window.sensorPermission = result;
    window.permissionCalls = 0;
    // Permission is a real user gesture in the test; only the OS answer and
    // sensor hardware are replaced. App, cover physics and dialogs stay real.
    Object.defineProperty(window, "DeviceMotionEvent", { configurable: true, value: class {
      static async requestPermission() { window.permissionCalls++; return window.sensorPermission; }
    } });
    if (result === null) delete window.DeviceMotionEvent.requestPermission;
    window.sensorAngle = 0;
    const display = screen, orientation = new EventTarget();
    Object.defineProperty(orientation, "angle", { get: () => window.sensorAngle });
    // Keep synthetic rotation independent of WebKit's native viewport events.
    Object.defineProperty(display, "orientation", { configurable: true, value: orientation });
    Object.defineProperty(window, "screen", { configurable: true, value: display });
    window.sensorHidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.sensorHidden });
    window.sendTilt = () => {
      const event = new Event("devicemotion"), b = (window.sensorBeta ?? 0) * Math.PI / 180, g = (window.sensorGamma ?? 0) * Math.PI / 180;
      const push = window.sensorPush || 0;
      const accelerationIncludingGravity = { x: -9.8 * Math.sin(g) * Math.cos(b) + push, y: 9.8 * Math.sin(b), z: 9.8 * Math.cos(b) * Math.cos(g) };
      Object.defineProperties(event, { accelerationIncludingGravity: { value: accelerationIncludingGravity }, acceleration: { value: { x: push, y: 0, z: 0 } } });
      window.dispatchEvent(event);
    };
  }, permission);
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
}
async function sensor(page, gamma = 0, beta = 0) {
  await page.evaluate(({ gamma, beta }) => {
    window.sensorGamma = gamma; window.sensorBeta = beta;
    window.sendTilt();
    window.sensorTimer ||= setInterval(window.sendTilt, 35);
  }, { gamma, beta });
}
async function enable(page) {
  await page.locator("#settings").click();
  await page.getByRole("switch", { name: "기울여 넘기기 Beta" }).check();
  await expect(page.locator("#tilt-enabled")).toBeChecked();
  await page.locator('#preferences [data-close]').click();
  await expect(page.locator("#preferences")).toBeHidden();
  await sensor(page);
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
}
const selected = page => page.locator('.pc-cover[aria-pressed="true"]');
const index = page => selected(page).evaluate(node => Number(node.dataset.index));
async function idleMutations(page) {
  return page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(document.querySelector(".pc-scene"), { subtree: true, attributes: true });
    await new Promise(resolve => setTimeout(resolve, 500));
    observer.disconnect(); return count;
  });
}

test("Beta is opt in, permission denial is clear, and Safari never prompts on reload", async ({ page }) => {
  await seed(page, "denied");
  await sensor(page, 30);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
  expect(await index(page)).toBe(0);
  await page.locator("#settings").click();
  await page.locator("#tilt-enabled").click();
  await expect(page.locator("#tilt-enabled")).not.toBeChecked();
  await expect(page.locator("#tilt-status")).toContainText("허용되지 않았어요");
  expect(await page.evaluate(() => window.permissionCalls)).toBe(1);
  await page.evaluate(() => { window.sensorPermission = "granted"; });
  await page.locator("#tilt-enabled").check();
  await expect(page.locator("#tilt-enabled")).toBeChecked();
  expect(await page.evaluate(() => window.permissionCalls)).toBe(2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-scene")).toBeVisible();
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
  await expect(page.locator("#tilt-enabled")).not.toBeChecked();
  await page.locator("#settings").click();
  await expect(page.locator("#tilt-status")).toContainText("다시 켜서");
  await page.evaluate(() => { window.sensorPermission = "granted"; });
  await page.locator("#tilt-enabled").check();
  await expect(page.locator("#tilt-enabled")).toBeChecked();
  await page.locator("#tilt-enabled").uncheck();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#tilt-enabled")).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("pincon-tilt-swipe-v1"))).toBe("off");
});

test("tilt accelerates both ways, settles when level, and does no idle work at an end", async ({ page }) => {
  await seed(page); await enable(page);
  await sensor(page, 2);
  expect(await idleMutations(page)).toBe(0);
  await sensor(page, 28);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThanOrEqual(3);
  await sensor(page, 0);
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  expect(await idleMutations(page)).toBe(0);
  const stopped = await index(page);
  expect(stopped).toBeGreaterThan(0);
  await page.evaluate(() => { window.sensorPush = 5; });
  expect(await idleMutations(page)).toBe(0);
  expect(await index(page)).toBe(stopped);
  await page.evaluate(() => { window.sensorPush = 0; });
  await sensor(page, -28);
  await expect(selected(page)).toHaveAttribute("data-index", "0");
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  expect(await idleMutations(page)).toBe(0);
  await sensor(page, 28);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  await page.locator("#settings").click();
  await page.locator("#tilt-enabled").uncheck();
  await page.locator('#preferences [data-close]').click();
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  expect(await idleMutations(page)).toBe(0);
});

test("touch and keyboard take control, dialogs pause, and calendar returns recalibrate", async ({ page }) => {
  await seed(page); await enable(page);
  await sensor(page, 28);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await page.locator(".pc-scene").press("Home");
  await expect(selected(page)).toHaveAttribute("data-index", "0");
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  expect(await idleMutations(page)).toBe(0);
  const box = await selected(page).boundingBox();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7 - 210, box.y + box.height * .5, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => index(page)).toBeGreaterThan(0);
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await selected(page).click();
  await expect(page.locator("#details")).toBeVisible();
  await sensor(page, -28);
  expect(await idleMutations(page)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeHidden();
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  const retained = await selected(page).getAttribute("data-assessment-id");
  await page.locator("#view-toggle").click();
  await expect(page.locator(".pc-calendar")).toBeVisible();
  await sensor(page, 30);
  await expect(page.locator(".pc-cover")).toHaveCount(0);
  await page.locator("#view-toggle").click();
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  await expect(selected(page)).toHaveAttribute("data-assessment-id", retained);
  await expect(page.locator(".pc-view-transition")).toHaveCount(0);
  expect(await idleMutations(page)).toBe(0);
});

test("landscape uses the horizontal axis and rotation takes a new neutral pose", async ({ page }) => {
  await seed(page); await enable(page);
  await page.locator(".pc-scene").press("PageDown");
  await expect(selected(page)).toHaveAttribute("data-index", "4");
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  await page.evaluate(() => { window.sensorAngle = 90; screen.orientation.dispatchEvent(new Event("change")); });
  expect(await page.evaluate(() => screen.orientation.angle)).toBe(90);
  await sensor(page, 0, 0);
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  await sensor(page, 0, -30);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThanOrEqual(6);
  const continuing = await index(page);
  await page.evaluate(() => { screen.orientation.dispatchEvent(new Event("change")); window.dispatchEvent(new Event("orientationchange")); });
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThan(continuing);
  await sensor(page, 0, 0);
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await sensor(page, 0, 30);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeLessThanOrEqual(4);
  await page.evaluate(() => { window.sensorAngle = 0; screen.orientation.dispatchEvent(new Event("change")); });
  await sensor(page, 12, 55);
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  expect(await idleMutations(page)).toBe(0);
});

test("lost sensor readings stop safely and missing hardware leaves Beta off", async ({ page }) => {
  await seed(page);
  await page.locator("#settings").click();
  await page.locator("#tilt-enabled").check();
  await page.locator('#preferences [data-close]').click();
  await expect(page.locator("#tilt-enabled")).not.toBeChecked({ timeout: 5000 });
  await expect(page.locator("#tilt-status")).toContainText("사용할 수 없어요");
  expect(await idleMutations(page)).toBe(0);
  await enable(page);
  await sensor(page, 28);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { clearInterval(window.sensorTimer); window.sensorTimer = 0; });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  const stopped = await index(page);
  await sensor(page, 28);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThan(stopped);
  await page.evaluate(() => { clearInterval(window.sensorTimer); window.sensorTimer = 0; });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  const stoppedAgain = await index(page);
  await expect(page.locator("#tilt-enabled")).not.toBeChecked({ timeout: 5000 });
  expect(await index(page)).toBe(stoppedAgain);
  expect(await idleMutations(page)).toBe(0);
});

test("background and reduced motion pause sensors, with no catch up on return", async ({ page }) => {
  await seed(page); await enable(page);
  await sensor(page, 28);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { window.sensorHidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  const paused = await index(page);
  expect(await idleMutations(page)).toBe(0);
  await page.evaluate(() => { window.sensorHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  expect(await index(page)).toBe(paused);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#tilt-status")).toContainText("동작 줄이기");
  await sensor(page, -30);
  expect(await idleMutations(page)).toBe(0);
  expect(await index(page)).toBe(paused);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  expect(await index(page)).toBe(paused);
});

test("browsers without a permission sheet remember Beta and calibrate again after reload", async ({ page }) => {
  await seed(page, null); await enable(page);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
  await sensor(page, 28);
  await expect.poll(() => index(page), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-scene")).toBeVisible();
  await sensor(page, 18, 55);
  await expect(page.locator("#tilt-enabled")).toBeChecked();
  await expect(page.locator("#tilt-status")).toHaveText(/처음 자세로 돌리면 멈춰요/);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
  expect(await index(page)).toBe(0);
  expect(await idleMutations(page)).toBe(0);
});
