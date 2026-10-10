import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

function paperPdf(pages = 6) {
  const objects = [null, "<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let i = 0; i < pages; i++) {
    const stream = `0.1 0.2 0.3 rg BT /F1 24 Tf 50 760 Td (WORKSHEET - PAGE ${i + 1}) Tj 0 -60 Td /F1 14 Tf (Write your answer on this actual PDF sheet.) Tj ET 0.6 0.6 0.6 RG 50 600 m 545 600 l S`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let body = "%PDF-1.7\n", offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test.use({ reducedMotion: "reduce" });

test("the white greeting finishes on time even when app and fonts are delayed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
      classAssignments: [{ id: "greeting-cover", classKey: "1-8", type: "assessment", subject: "국어", title: "실제 저장된 수행평가", published: true }],
    } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const delay = async route => { await gate; await route.continue(); };
  await page.route("**/new/app.js?*", delay);
  await page.route("**/fonts/*.woff2", delay);
  const navigation = page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => window.PINCON_STARTUP);
    expect(await page.evaluate(() => window.PINCON_STARTUP.mode)).toBe("full");
    // WebKit can suspend animation frames before a pending module/font lets
    // the document paint. Check the independent timer without waiting on RAF.
    await page.waitForFunction(() => window.PINCON_STARTUP.finished, null, { polling: 50, timeout: 2500 });
    const greeting = await page.evaluate(() => ({ elapsed: window.PINCON_STARTUP.endAt - window.PINCON_STARTUP.startAt, background: getComputedStyle(document.body).backgroundImage }));
    expect(greeting.elapsed).toBeLessThan(1150);
    expect(greeting.background).toContain("radial-gradient");
    await expect(page.locator(".pc-startup")).toHaveCount(0);
    await expect(page.locator(".pc-scene")).toHaveCount(0);
    await expect(page.locator("#covers")).toHaveText("수행평가");
  } finally { release(); }
  await navigation;
  // Late data reveals real covers immediately, without replaying the greeting.
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await expect(page.locator(".pc-cover")).toHaveCSS("opacity", "1");
  await page.locator(".pc-cover").click();
  await expect(page.locator("#detail-title")).toHaveText("실제 저장된 수행평가");
});

test("cached covers join the greeting and same-day visits use only the short reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
      classAssignments: Array.from({ length: 16 }, (_, i) => ({ id: `greeting-${i}`, classKey: "1-8", type: "assessment", subject: "미술", title: `수행평가 ${i}`, published: true })),
    } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.PINCON_STARTUP.finished);
  expect(await page.evaluate(() => window.PINCON_STARTUP.mode)).toBe("full");
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveCSS("opacity", "1");
  await expect(page.locator(".pc-caption")).toHaveCSS("opacity", "1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.PINCON_STARTUP.finished);
  const repeat = await page.evaluate(() => ({ mode: window.PINCON_STARTUP.mode, elapsed: window.PINCON_STARTUP.endAt - window.PINCON_STARTUP.startAt }));
  expect(repeat.mode).toBe("short");
  expect(repeat.elapsed).toBeLessThan(500);
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  await expect(page.locator(".pc-cover").first()).toHaveCSS("opacity", "1");
});

test("greeting input dismisses immediately and motion preferences take priority", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("pincon-cover-lighting-v1", "off"));
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/new/app.js?*", async route => { await gate; await route.continue(); });
  const navigation = page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => window.PINCON_STARTUP);
    await expect(page.locator(".pc-startup-sheen")).toHaveCSS("display", "none");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => window.PINCON_STARTUP.finished)).toBe(true);
    await expect(page.locator(".pc-startup")).toHaveCount(0);
  } finally { release(); }
  await navigation;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => ({ mode: window.PINCON_STARTUP.mode, finished: window.PINCON_STARTUP.finished }))).toEqual({ mode: "none", finished: true });
  await expect(page.locator(".pc-startup")).toHaveCount(0);
  await page.locator("#settings").click();
  await expect(page.locator("#preferences")).toBeVisible();
});

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


for (const width of [360, 1440]) {
  test(`cover edges fade without removing a still-visible sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
      localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
        classAssignments: Array.from({ length: 96 }, (_, i) => ({ id: `edge-${i}`, classKey: "1-8", type: "assessment", subject: ["미술", "국어", "수학", "영어"][i % 4], title: `Assessment ${i}`, dueDate: "2099-11-13", published: true })),
      } }));
    });
    await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
    await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
    const scene = page.locator(".pc-scene"), viewport = page.locator(".pc-flow-viewport");
    for (let i = 0; i < 4; i++) await scene.press("PageDown");
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "edge-16");
    await expect(scene).toHaveAttribute("data-motion", "resting");
    expect(await viewport.evaluate(node => getComputedStyle(node).maskImage)).toBe("none");
    expect(await viewport.evaluate(node => getComputedStyle(node, "::after").maskImage)).not.toBe("none");
    expect(await page.locator(".pc-caption").evaluate(node => node.closest(".pc-flow-viewport"))).toBeNull();
    const selected = await page.locator('.pc-cover[aria-pressed="true"]').boundingBox();
    expect(selected.x).toBeGreaterThan(30);
    expect(selected.x + selected.width).toBeLessThan(width - 30);
    const far = page.locator('.pc-cover[data-index="23"]');
    if (width === 1440) {
      await expect(far).toHaveCSS("visibility", "visible");
      const box = await far.boundingBox();
      expect(box.x).toBeLessThan(width);
      expect(box.x + box.width).toBeGreaterThan(width);
    } else await expect(far).toHaveCSS("visibility", "hidden");
    const visibleCount = await page.locator(".pc-cover").evaluateAll(cards => cards.filter(card => card.style.visibility === "visible").length);
    expect(visibleCount).toBeLessThan(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath("cover-edges.png") });
    const front = page.locator('.pc-cover[data-index="16"]'), transform = await front.evaluate(node => node.style.transform);
    await page.mouse.move(width / 2, selected.y + selected.height / 2);
    await page.mouse.down();
    await page.mouse.move(width / 2 - 70, selected.y + selected.height / 2, { steps: 8 });
    await expect.poll(() => front.evaluate(node => node.style.transform)).not.toBe(transform);
    await page.screenshot({ path: test.info().outputPath("cover-edges-drag.png") });
    await page.mouse.up();
    await expect(scene).toHaveAttribute("data-motion", "resting");
    const idleUpdates = await page.evaluate(async () => {
      let count = 0; const observer = new MutationObserver(records => { count += records.length; });
      observer.observe(document.querySelector(".pc-flow-viewport"), { attributes: true, subtree: true, attributeFilter: ["style"] });
      await new Promise(resolve => setTimeout(resolve, 160)); observer.disconnect(); return count;
    });
    expect(idleUpdates).toBe(0);
  });
}

for (const width of [360, 768, 1440]) {
  test(`scrolling stays continuous through reversals and background sync at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
      localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
        classAssignments: Array.from({ length: 96 }, (_, i) => ({ id: `scroll-${i}`, classKey: "1-8", type: "assessment", subject: "국어", title: `Assessment ${i}`, dueDate: "2099-11-13", published: true })),
      } }));
    });
    await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
    await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
    const scene = page.locator(".pc-scene");
    for (let i = 0; i < 4; i++) await scene.press("PageDown");
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "scroll-16");
    await expect(scene).toHaveAttribute("data-motion", "resting");

    const result = await page.evaluate(async () => {
      const flow = document.querySelector(".pc-flow"), scene = flow.querySelector(".pc-scene");
      const front = flow.querySelector('.pc-cover[aria-pressed="true"]');
      const stats = { frames: 0, blankFrames: 0, depthSwitches: 0, layerSwitches: 0, maxTravel: 0 };
      const layers = [front, ...front.querySelectorAll(".pc-surface-light")];
      const previous = new Map(layers.map(node => [node, { depth: node.style.zIndex, hint: node.style.willChange }]));
      let running = true;
      const sample = () => {
        if (!running) return;
        stats.frames++;
        const selected = flow.querySelector('.pc-cover[aria-pressed="true"]');
        if (!flow.isConnected || !selected || selected.style.visibility === "hidden" || Number(selected.style.opacity) < .99) stats.blankFrames++;
        stats.maxTravel = Math.max(stats.maxTravel, Math.abs(new DOMMatrix(front.style.transform).m41));
        requestAnimationFrame(sample);
      };
      const observer = new MutationObserver(records => {
        for (const { target } of records) {
          const old = previous.get(target);
          if (!old) continue;
          const next = { depth: target.style.zIndex, hint: target.style.willChange };
          if (next.depth !== old.depth) stats.depthSwitches++;
          if (next.hint !== old.hint) stats.layerSwitches++;
          previous.set(target, next);
        }
      });
      layers.forEach(node => observer.observe(node, { attributes: true, attributeFilter: ["style"] }));
      requestAnimationFrame(sample);
      for (let i = 0; i < 6; i++) {
        scene.dispatchEvent(new WheelEvent("wheel", { deltaY: 8, bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 25));
        if (i === 2) {
          const { NextDataGateway } = await import("/next/core/data-gateway.js");
          const gateway = new NextDataGateway();
          gateway.state.data.classAssignments[16].description = "Background update while scrolling";
          gateway.state.data.classAssignments[16].updatedAt = Date.now();
          gateway.emit();
        }
      }
      await new Promise(resolve => {
        const check = () => scene.dataset.motion === "resting" ? resolve() : requestAnimationFrame(check);
        requestAnimationFrame(check);
      });
      running = false; observer.disconnect();
      return { ...stats, sameScene: scene === document.querySelector(".pc-scene"), selected: front.dataset.assessmentId };
    });
    expect(result.sameScene).toBe(true);
    expect(result.frames).toBeGreaterThan(3);
    expect(result.maxTravel).toBeGreaterThan(1);
    expect(result.blankFrames).toBe(0);
    // Sub-card scrolling must not change stacking order or discard the layers
    // when the nearest cover is the same before and after the gesture.
    expect(result.depthSwitches).toBe(0);
    expect(result.layerSwitches).toBe(0);

    for (const lighting of [true, false]) {
      const scroll = await page.evaluate(async lighting => {
        const { setCoverLightingEnabled } = await import("/next/assessments/coverflow.js?v=20261010-intro1");
        setCoverLightingEnabled(lighting);
        const scene = document.querySelector(".pc-scene");
        let running = true, frames = 0, blankFrames = 0;
        const sample = () => {
          if (!running) return;
          frames++;
          const selected = scene.querySelector('.pc-cover[aria-pressed="true"]');
          if (!scene.isConnected || !selected || selected.style.visibility === "hidden" || Number(selected.style.opacity) < .99) blankFrames++;
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        for (const deltaY of [90, 90, 90, -90, 90, -90, 90, -90, 90, 90]) {
          scene.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
          await new Promise(resolve => setTimeout(resolve, 35));
        }
        await new Promise(resolve => {
          const check = () => scene.dataset.motion === "resting" ? resolve() : requestAnimationFrame(check);
          requestAnimationFrame(check);
        });
        running = false;
        return { frames, blankFrames };
      }, lighting);
      expect(scroll.frames).toBeGreaterThan(3);
      expect(scroll.blankFrames).toBe(0);
      await expect(scene).toHaveAttribute("data-motion", "resting");
      const expected = lighting ? "scroll-20" : "scroll-24";
      await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", expected);
      await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveCSS("opacity", "1");
      await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveCSS("visibility", "visible");
    }
    // Data must still update even though detail-only changes retain the scene.
    for (let i = 0; i < 2; i++) await scene.press("PageUp");
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "scroll-16");
    await expect(scene).toHaveAttribute("data-motion", "resting");
    await page.locator('.pc-cover[aria-pressed="true"]').click();
    await expect(page.locator("#details")).toContainText("Background update while scrolling");
    expect(errors).toEqual([]);
  });
}

test("administrators can delete assessments in new, cancel and retry safely without losing attachments", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
      classAssignments: [0, 1].map(i => ({ id: `delete-${i}`, classKey: "1-8", type: "assessment", title: `삭제 검사 ${i}`, subject: "미술", dueDate: "2099-11-13", published: true,
        noticeAttachment: { storagePath: `assessments/delete-${i}/notice.jpg`, fileName: "안내문.jpg", contentType: "image/jpeg" } })),
    } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-cover")).toHaveCount(2);
  await page.locator('.pc-cover[aria-pressed="true"]').click();
  await expect(page.locator("#delete-assessment")).toHaveCount(0);
  await page.evaluate(async () => {
    const { NextDataGateway } = await import("/next/core/data-gateway.js");
    const gateway = new NextDataGateway(), documents = new Map(gateway.state.data.classAssignments.map(row => [`schools/gochon-high/classAssignments/${row.id}`, { ...row }]));
    const fixture = window.deleteFixture = { attempts: 0, documents };
    gateway.start = async () => gateway.snapshot();
    gateway.state.canArchiveContent = true; gateway.state.user = { uid: "delete-operator" };
    const api = { db: {}, serverTimestamp: () => 1 };
    api.doc = (...args) => { const parts = args[0] === api.db ? args.slice(1) : [args[0].path || args[0], ...args.slice(1)]; if (parts.length === 1) parts.push(crypto.randomUUID()); return { path: parts.join("/"), id: parts.at(-1) }; };
    api.getDoc = async ref => ({ exists: () => documents.has(ref.path), data: () => documents.get(ref.path) });
    api.writeBatch = () => {
      const pending = [];
      return { set: (ref, value) => pending.push([ref.path, value]), commit: async () => {
        fixture.attempts++; gateway.emit();
        await new Promise(resolve => setTimeout(resolve, 300));
        if (fixture.attempts === 1) throw new Error("삭제 연결 실패. 다시 시도해 주세요.");
        for (const [path, value] of pending) documents.set(path, value);
      } };
    };
    gateway.repository = { api, ensureUser: async () => gateway.state.user, collectionRef: name => "schools/gochon-high/" + name, documentRef: (name, id) => api.doc(api.db, "schools", "gochon-high", name, id) };
    gateway.emit();
  });
  await page.locator("#delete-assessment").click();
  await expect(page.locator("#delete-confirmation")).toBeVisible();
  await expect(page.locator("#cancel-delete")).toBeFocused();
  await page.locator("#cancel-delete").click();
  await expect(page.locator("#delete-confirmation")).toBeHidden();
  expect(await page.evaluate(() => window.deleteFixture.attempts)).toBe(0);
  await page.locator("#delete-assessment").click();
  await page.locator("#confirm-delete").click();
  await expect(page.locator("#confirm-delete")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#delete-status")).toContainText("삭제 연결 실패");
  await expect(page.locator("#confirm-delete")).toBeEnabled();
  await expect(page.locator(".pc-cover")).toHaveCount(2);
  await page.locator("#confirm-delete").evaluate(button => { button.click(); button.click(); });
  await expect(page.locator("#details")).toBeHidden();
  await expect(page.locator(".pc-cover")).toHaveCount(1);
  const stored = await page.evaluate(() => ({ attempts: window.deleteFixture.attempts, record: window.deleteFixture.documents.get("schools/gochon-high/classAssignments/delete-0"), logs: [...window.deleteFixture.documents].filter(([path]) => path.includes("/changeLogs/")).map(([, value]) => value) }));
  expect(stored.attempts).toBe(2);
  expect(stored.record.deleted).toBe(true);
  expect(stored.record.noticeAttachment.storagePath).toBe("assessments/delete-0/notice.jpg");
  expect(stored.logs).toHaveLength(1);
  expect(stored.logs[0].action).toBe("delete");
  expect(stored.logs[0].actorUid).toBe("delete-operator");
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toBeFocused();
  await page.locator(".pc-cover").click();
  await page.locator("#delete-assessment").click();
  await page.locator("#confirm-delete").click();
  await expect(page.locator("#details")).toBeHidden();
  await expect(page.locator(".pc-cover")).toHaveCount(0);
  await expect(page.locator("#add")).toBeFocused();
});

test("both upload slots accept PDF/images and a failed transfer can be retried without losing the form", async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.stack); });
  await page.setViewportSize({ width: 360, height: 800 });
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
  const pdf = paperPdf();
  const jpg = Buffer.from(await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 424; const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0,0,300,424); ctx.fillStyle = "#273043"; ctx.font = "18px Arial"; ctx.fillText("IMAGE SHEET",30,60); return canvas.toDataURL("image/jpeg").split(",")[1]; }), "base64");
  await notice.setInputFiles({ name: "안내문.pdf", mimeType: "application/pdf", buffer: pdf });
  await pack.setInputFiles({ name: "학습지팩.jpg", mimeType: "image/jpeg", buffer: jpg });
  await page.locator('[name="fileConfirmed"]').check();
  await page.locator('#editor-form button[type="submit"]').click();
  await expect(page.locator("#save-status")).toContainText("파일 전송 실패");
  await expect(page.locator('#editor-form button[type="submit"]')).toBeEnabled();
  expect(await notice.evaluate(input => input.files[0].name)).toBe("안내문.pdf");
  await page.locator('#editor-form button[type="submit"]').click();
  await expect(page.locator("#details")).toBeHidden();
  await expect(page.locator(".pc-cover")).toHaveCount(1);
  await page.locator(".pc-cover").click();
  const original = page.waitForEvent("download");
  await page.locator('[data-assessment-download="noticeAttachment"]').click();
  const received = await original;
  expect(received.suggestedFilename()).toBe("안내문.pdf");
  expect(await readFile(await received.path())).toEqual(pdf);
  await expect(page.locator(".pc-file-viewer")).toHaveCount(0);
  await page.locator('[data-assessment-file="noticeAttachment"]').click();
  const stage = page.locator(".pc-paper-stage");
  await expect(stage).toHaveAttribute("data-page", "1", { timeout: 25000 });
  await expect(page.locator('[data-paper-prev]')).toBeDisabled();
  await expect(page.locator('.pc-paper-page-number span')).toHaveText("/ 6");
  await expect(page.locator(".pc-file-download")).toHaveAttribute("download", "안내문.pdf");
  await expect(page.locator('[data-paper-page="1"] img').first()).toBeVisible();
  await expect(page.locator('[data-paper-page="2"]')).toHaveClass(/pc-paper-loaded/);
  await expect(page.locator(".pc-paper-fan")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("paper-pdf.png") });
  await page.locator('[data-paper-next]').click();
  await expect(stage).toHaveAttribute("data-phase", "flipping");
  await expect(stage).toHaveAttribute("data-page", "2");
  await expect(stage).toHaveAttribute("data-phase", "read");
  await stage.press("ArrowLeft");
  await expect(stage).toHaveAttribute("data-page", "1");
  await expect(stage).toHaveAttribute("data-phase", "read");
  const sheet = await page.locator('.pc-paper-book').boundingBox();
  await page.mouse.move(sheet.x + sheet.width * .9, sheet.y + sheet.height * .8);
  await page.mouse.down();
  await page.mouse.move(sheet.x + sheet.width * .65, sheet.y + sheet.height * .7, { steps: 6 });
  await page.screenshot({ path: test.info().outputPath("paper-fold.png") });
  await page.mouse.move(sheet.x + sheet.width * .2, sheet.y + sheet.height * .7, { steps: 6 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-page", "2");
  await expect(stage).toHaveAttribute("data-phase", "read");
  await page.mouse.move(sheet.x + sheet.width * .1, sheet.y + sheet.height * .8);
  await page.mouse.down();
  await page.mouse.move(sheet.x + sheet.width * .75, sheet.y + sheet.height * .7, { steps: 12 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-page", "1");
  await expect(stage).toHaveAttribute("data-phase", "read");
  await page.mouse.move(sheet.x + sheet.width * .9, sheet.y + sheet.height * .8);
  await page.mouse.down();
  await page.mouse.move(sheet.x + sheet.width * .82, sheet.y + sheet.height * .8, { steps: 3 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-phase", "read");
  await expect(stage).toHaveAttribute("data-page", "1");
  await stage.press("End");
  await expect(stage).toHaveAttribute("data-page", "6");
  await expect(page.locator('[data-paper-next]')).toBeDisabled();
  await page.locator('[data-paper-zoom]').click();
  await expect(stage).toHaveClass(/pc-paper-zoomed/);
  await page.locator('[data-paper-zoom]').click();
  await expect(stage).not.toHaveClass(/pc-paper-zoomed/);
  await page.waitForTimeout(300);
  const mutations = await stage.evaluate(async node => { let count = 0; const observer = new MutationObserver(records => count += records.length); observer.observe(node, { subtree:true, attributes:true, attributeFilter:["style"] }); await new Promise(resolve => setTimeout(resolve,200)); observer.disconnect(); return count; });
  expect(mutations).toBe(0);
  await page.locator("[data-pc-file-close]").click();
  await page.locator('[data-assessment-file="worksheetPack"]').click();
  await expect(stage).toHaveAttribute("data-page", "1");
  await expect(page.locator(".pc-paper-fan")).toHaveCount(0);
  await expect(page.locator('[data-paper-page="1"] img')).toBeVisible();
  expect(await page.locator('[data-paper-page="1"] img').evaluate(img => img.naturalWidth)).toBe(300);
  await expect(page.locator('[data-paper-next]')).toBeDisabled();
  await expect(page.locator(".pc-file-download")).toHaveAttribute("download", "학습지팩.jpg");
  await page.screenshot({ path: test.info().outputPath("paper-jpg.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".pc-file-viewer")).toBeHidden();
  await expect(page.locator('[data-assessment-file="worksheetPack"]')).toBeFocused();
  const imageDownload = page.waitForEvent("download");
  await page.locator('[data-assessment-download="worksheetPack"]').click();
  expect(await readFile(await (await imageDownload).path())).toEqual(jpg);
  await page.locator("#edit").click();
  await expect(page.locator("#editor-form")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeHidden();
  expect(errors).toEqual([]);
});

test("detail expansion returns to its cover and handles reopen or reduced motion during the transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: { classAssignments: [{ id: "shared-cover", subject: "수학", title: "연결된 수행평가", description: "상세 내용", published: true }] } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pc-scene")).toHaveAttribute("data-motion", "resting");
  const opening = await page.evaluate(() => {
    const cover = document.querySelector(".pc-cover"); cover.click();
    return { ghost: Boolean(document.querySelector(".pc-shared-cover:popover-open")), sourceHidden: cover.classList.contains("pc-shared-source"), phase: document.querySelector("#details").dataset.dialogMotion };
  });
  expect(opening).toEqual({ ghost: true, sourceHidden: true, phase: "opening" });
  await expect(page.locator(".pc-shared-cover")).toHaveCount(0);
  await page.evaluate(() => document.querySelector('#details [data-close]').click());
  await expect(page.locator("#details")).toHaveAttribute("data-dialog-motion", "closing");
  await page.evaluate(() => document.querySelector(".pc-cover").click());
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-title")).toHaveText("연결된 수행평가");
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeHidden();
  await expect(page.locator(".pc-cover")).not.toHaveClass(/pc-shared-source/);
  await expect(page.locator(".pc-cover")).toBeFocused();
  await page.evaluate(() => document.querySelector(".pc-cover").click());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".pc-shared-cover")).toHaveCount(0);
  await expect(page.locator(".pc-cover")).not.toHaveClass(/pc-shared-source/);
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
  expect(samples.some(sample => sample.first > .2 && sample.first > sample.fourth + .15)).toBe(true);
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

test("cover lighting follows tilt, stops updating at rest and remembers the off setting", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
      classAssignments: Array.from({ length: 16 }, (_, i) => ({ id: `light-${i}`, classKey: "1-8", type: "assessment", subject: "미술", title: `수행평가 ${i}`, published: true }))
    } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
  const scene = page.locator(".pc-scene"), flow = page.locator(".pc-flow");
  await expect(scene).toHaveAttribute("data-motion", "resting");
  await expect(flow).toHaveAttribute("data-lighting", "on");
  const front = page.locator('.pc-cover[data-index="0"] > .pc-face > .pc-surface-light');
  const start = await front.evaluate(node => ({ transform: node.style.transform, background: getComputedStyle(node).backgroundImage }));
  await scene.press("ArrowRight");
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "light-1");
  await expect(scene).toHaveAttribute("data-motion", "resting");
  const turned = await front.evaluate(node => ({ transform: node.style.transform, background: getComputedStyle(node).backgroundImage }));
  expect(turned.transform).not.toBe(start.transform);
  expect(turned.background).toBe(start.background);
  const mirror = page.locator('.pc-cover[data-index="0"] .pc-reflection .pc-surface-light');
  expect(await mirror.evaluate(node => node.style.transform)).toBe(turned.transform);
  await expect(page.locator('.pc-cover[data-index="15"] .pc-surface-light').first()).toHaveCSS("opacity", "0");
  const idleUpdates = await page.evaluate(async () => {
    let updates = 0;
    const observer = new MutationObserver(records => { updates += records.length; });
    document.querySelectorAll(".pc-surface-light").forEach(node => observer.observe(node, { attributes: true, attributeFilter: ["style"] }));
    await new Promise(resolve => setTimeout(resolve, 200));
    observer.disconnect();
    return updates;
  });
  expect(idleUpdates).toBe(0);
  await page.locator("#settings").click();
  await expect(page.locator("#cover-lighting")).toBeChecked();
  await page.locator("#cover-lighting").uncheck();
  await expect(flow).toHaveAttribute("data-lighting", "off");
  await expect(front).toHaveCSS("display", "none");
  await page.locator("#preferences [data-close]").click();
  await expect(page.locator("#preferences")).toBeHidden();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(flow).toHaveAttribute("data-lighting", "off");
  await page.locator("#settings").click();
  await expect(page.locator("#cover-lighting")).not.toBeChecked();
  await page.locator("#cover-lighting").check();
  await expect(flow).toHaveAttribute("data-lighting", "on");
});
