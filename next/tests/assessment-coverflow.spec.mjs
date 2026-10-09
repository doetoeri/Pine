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
