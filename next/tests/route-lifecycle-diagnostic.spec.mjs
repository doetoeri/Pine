import { test, expect } from "@playwright/test";

const ROUTES = ["timetable", "schedule", "classroom", "more"];

function snapshot(page, label) {
  return page.evaluate((tag) => ({
    tag,
    hash: location.hash,
    width: innerWidth,
    shell: document.querySelectorAll("#app .shell").length,
    splash: document.querySelectorAll("#app .splash").length,
    rail: document.querySelectorAll(".rail__nav").length,
    railToday: document.querySelectorAll('.rail__nav [data-route="today"]').length,
    bottomToday: document.querySelectorAll('.bottom-nav [data-route="today"]').length,
    main: document.querySelector("#mainContent")?.id || "",
    title: document.querySelector("#mainContent h1")?.id || "",
    bodyClass: document.body.className,
    appChild: document.querySelector("#app")?.firstElementChild?.className || "",
    profile: localStorage.getItem("pincon-profile-v2"),
  }), label);
}

test("diagnose route shell around more to today", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible();

  for (const route of ROUTES) {
    await page.locator(`.rail__nav [data-route="${route}"]`).click();
    await expect(page.locator(`#${route}-title`)).toBeVisible();
    console.log("ROUTE_STATE", JSON.stringify(await snapshot(page, `after-${route}`)));
  }

  for (const delay of [0, 50, 150, 350, 750, 1200, 2000]) {
    if (delay) await page.waitForTimeout(delay);
    console.log("ROUTE_STATE", JSON.stringify(await snapshot(page, `more+${delay}`)));
  }

  const today = page.locator('.rail__nav [data-route="today"]');
  console.log("TODAY_COUNT", await today.count());
  await today.click({ timeout: 5000 });
  await expect(page.locator("#today-title")).toBeVisible({ timeout: 1000 });
  console.log("ROUTE_STATE", JSON.stringify(await snapshot(page, "after-today")));
});
