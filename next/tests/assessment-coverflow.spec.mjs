import { test, expect } from "@playwright/test";

test.use({ reducedMotion: "reduce" });
for (const width of [360, 768, 1440]) {
  test(`assessment covers select, open details and retain selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
      localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
        classAssignments: Array.from({ length: 16 }, (_, i) => ({ id: `cover-${i}`, classKey: "1-8", type: "assessment", subject: "공영", title: `영어 수행평가 ${i}`, dueDate: "2099-11-13", published: true, verificationStatus: "verified", description: "실제 상세 내용" })),
        evaluationPlans: [], events: [], resources: [], lostItems: [],
      } }));
    });
    await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
    await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".rail, .app-frame, .topbar")).toHaveCount(0);
    const scene = page.locator(".pc-scene");
    await expect(scene).toBeVisible();
    await expect(page.locator(".pc-cover")).toHaveCount(16);
    await scene.press("ArrowRight");
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "cover-1");
    await expect(page.locator(".pc-caption-title")).toHaveText("영어 수행평가 1");
    await page.locator('.pc-cover[aria-pressed="true"]').click();
    await expect(page.locator("#detail-title")).toHaveText("영어 수행평가 1");
    await expect(page.locator("#details")).toContainText("실제 상세 내용");
    await page.locator('#details [data-close]').first().click();
    await expect(page.locator("#details")).toBeHidden();
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "cover-1");
    await scene.press("End");
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "cover-15");
    const result = await page.evaluate(() => ({ captionInFlow: (() => { const flow = document.querySelector(".pc-flow").getBoundingClientRect(), caption = document.querySelector(".pc-caption").getBoundingClientRect(); return caption.top >= flow.top && caption.bottom <= flow.bottom + 1; })(), overflow: document.documentElement.scrollWidth > innerWidth, hidden: [...document.querySelectorAll(".pc-cover")].filter(card => card.style.visibility === "hidden").length }));
    expect(result.captionInFlow).toBe(true);
    expect(result.overflow).toBe(false);
    expect(result.hidden).toBeGreaterThan(0);
  });
}


test("both upload slots accept PDF/images and a failed transfer can be retried without losing the form", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: { classAssignments: [] } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await page.locator("#settings").waitFor();
  await page.evaluate(async () => {
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway(), documents = new Map();
    gateway.start = async () => gateway.snapshot();
    gateway.state.canArchiveContent = true; gateway.state.user = { uid: "isolated-operator" };
    const api = { db: {}, storage: {}, serverTimestamp: () => 1, Bytes: { fromUint8Array: bytes => ({ toUint8Array: () => bytes }) } };
    api.doc = (...args) => { const parts = args[0] === api.db ? args.slice(1) : [args[0].path || args[0], ...args.slice(1)]; if (parts.length === 1) parts.push(crypto.randomUUID()); return { path: parts.join("/"), id: parts.at(-1) }; };
    api.getDoc = async ref => ({ exists: () => documents.has(ref.path), data: () => documents.get(ref.path) });
    let rejectFirstPart = true;
    api.writeBatch = () => {
      const pending = [];
      return { set: (ref,value) => pending.push(["set",ref,value]), update: (ref,value) => pending.push(["update",ref,value]), delete: ref => pending.push(["delete",ref]), commit: async () => {
        await new Promise(resolve => setTimeout(resolve, 40));
        if (rejectFirstPart && pending.some(([action,ref]) => action === "set" && ref.path.includes("/assessmentFileChunks/"))) { rejectFirstPart = false; throw new Error("파일 전송 실패. 다시 저장해 주세요."); }
        for (const [action,ref,value] of pending) { if (action === "delete") documents.delete(ref.path); else documents.set(ref.path, action === "update" ? { ...documents.get(ref.path), ...value } : value); }
      } };
    };
    gateway.repository = { api, ensureUser: async () => gateway.state.user, collectionRef: name => "schools/gochon-high/"+name, documentRef: (name,id) => api.doc(api.db,"schools","gochon-high",name,id) };
    gateway.emit();
  });
  await page.locator("#add").click();
  const notice = page.locator('[name="noticeFile"]'), pack = page.locator('[name="packFile"]');
  expect(await notice.getAttribute("accept")).toEqual(await pack.getAttribute("accept"));
  await page.locator('[name="title"]').fill("형식 제한 없는 수행평가");
  await page.locator('[name="subject"]').fill("미술");
  await notice.setInputFiles({ name: "안내문.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nworksheet") });
  await pack.setInputFiles({ name: "학습지팩.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNYtfsMAAREAjLFENlZAAAAAElFTkSuQmCC", "base64") });
  await page.locator('[name="fileConfirmed"]').check();
  await page.locator('#editor-form button[type="submit"]').click();
  await expect(page.locator("#save-status")).toContainText("파일 전송 실패");
  await expect(page.locator('#editor-form button[type="submit"]')).toBeEnabled();
  expect(await notice.evaluate(input => input.files[0].name)).toBe("안내문.pdf");
  await page.locator('#editor-form button[type="submit"]').click();
  await expect(page.locator("#details")).toBeHidden();
  await expect(page.locator(".pc-cover")).toHaveCount(1);
  await page.locator(".pc-cover").click();
  await page.locator('[data-assessment-file="noticeAttachment"]').click();
  await expect(page.locator(".pc-file-body iframe")).toBeVisible();
  await expect(page.locator(".pc-file-download")).toHaveAttribute("download", "안내문.pdf");
  await page.locator("[data-pc-file-close]").click();
  await page.locator('[data-assessment-file="worksheetPack"]').click();
  await expect(page.locator(".pc-file-body img")).toBeVisible();
  expect(await page.locator(".pc-file-body img").evaluate(async img => { await img.decode(); return img.naturalWidth; })).toBe(1);
  await expect(page.locator(".pc-file-download")).toHaveAttribute("download", "학습지팩.png");
  await page.keyboard.press("Escape");
  await expect(page.locator(".pc-file-viewer")).toBeHidden();
  await expect(page.locator('[data-assessment-file="worksheetPack"]')).toBeFocused();
  await page.locator("#edit").click();
  await expect(page.locator("#editor-form")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeHidden();
});

test("covers enter in a restrained cascade without bouncing and stay settled on refresh", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
      classAssignments: Array.from({ length: 8 }, (_, i) => ({ id: `motion-${i}`, classKey: "1-8", type: "assessment", subject: "국어", title: `수행평가 ${i}`, published: true }))
    } }));
    window.motionSamples = [];
    const sample = () => {
      const scene = document.querySelector(".pc-scene");
      if (scene) {
        const cards = scene.querySelectorAll(".pc-cover");
        window.motionSamples.push({ phase: scene.dataset.motion, first: Number(cards[0].style.opacity), fourth: Number(cards[3].style.opacity), y: new DOMMatrix(getComputedStyle(cards[0]).transform).m42 });
        if (scene.dataset.motion === "resting") return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  const samples = await page.evaluate(() => window.motionSamples);
  expect(samples.some(sample => sample.first > .2 && sample.fourth < .05)).toBe(true);
  expect(samples.filter(sample => sample.phase === "entering").length).toBeGreaterThan(2);
  expect(samples.every(sample => sample.y >= 0 && sample.y <= 15)).toBe(true);
  expect(samples.slice(1).every((sample, i) => sample.y <= samples[i].y + .001)).toBe(true);
  expect(samples.at(-1).y).toBe(0);
  await page.evaluate(async () => {
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway();
    gateway.state.data.classAssignments[0].description = "갱신된 자료";
    gateway.emit();
  });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await expect(page.locator(".pc-cover").first()).toHaveCSS("opacity", "1");
  const transform = await page.locator(".pc-cover").first().evaluate(card => card.style.transform);
  await page.waitForTimeout(120);
  expect(await page.locator(".pc-cover").first().evaluate(card => card.style.transform)).toBe(transform);

  // Escape during the entrance must still close and restore the trigger's focus.
  await page.locator("#settings").focus();
  await page.evaluate(() => document.querySelector("#settings").click());
  await expect(page.locator("#preferences")).toHaveAttribute("data-dialog-motion", "opening");
  await page.keyboard.press("Escape");
  await expect(page.locator("#preferences")).toBeHidden();
  await expect(page.locator("#settings")).toBeFocused();
  await page.locator("#settings").click();
  await expect(page.locator("#preferences")).toBeVisible();
  await page.locator("#preferences [data-close]").click();
  await expect(page.locator("#preferences")).toBeHidden();
});
