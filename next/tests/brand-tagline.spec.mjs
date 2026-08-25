import { test, expect } from "@playwright/test";

async function seedClass(page, tagline) {
  await page.addInitScript(({ tagline }) => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({
      classKey: "1-8",
      savedAtMs: Date.now(),
      data: {
        classSettings: [{ id: "1-8", classKey: "1-8", brandTagline: tagline, deleted: false }],
      },
    }));
  }, { tagline });
  await page.route("https://www.gstatic.com/**", (route) => route.abort());
}

test("mobile header keeps PinCon Beta and shows the class tagline separately", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await seedClass(page, "우리 반 허브");
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".shell")).toBeVisible();
  const badge = page.locator(".brand__title .beta-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Beta");
  await expect(page.locator(".brand__tagline")).toBeVisible();
  await expect(page.locator(".brand__tagline")).toHaveText("우리 반 허브");
  await context.close();
});

test("desktop floating brand uses the same class brand tagline", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  await seedClass(page, "우리 반 허브");
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".rail")).toBeVisible();
  const tagline = page.locator(".rail__tagline");
  await expect(tagline).toBeVisible();
  await expect(tagline).toHaveText("우리 반 허브");

  const contained = await page.evaluate(() => {
    const rail = document.querySelector(".rail")?.getBoundingClientRect();
    const tag = document.querySelector(".rail__tagline")?.getBoundingClientRect();
    return Boolean(rail && tag && tag.left >= rail.left && tag.right <= rail.right);
  });
  expect(contained).toBe(true);
  await context.close();
});
