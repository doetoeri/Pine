import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const browserRoot = process.env.MEANING_LINK_BROWSER_ROOT || "/tmp/meaning-link-browser/node_modules";
process.env.FONTCONFIG_PATH = process.env.FONTCONFIG_PATH || "/etc/fonts";
process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || "/tmp/meaning-link-browser-cache";
fs.mkdirSync(process.env.XDG_CACHE_HOME, { recursive: true });
const puppeteer = require(`${browserRoot}/puppeteer-core`);
const chromiumModule = await import(pathToFileURL(`${browserRoot}/@sparticuz/chromium/build/index.js`).href);
const chromium = chromiumModule.default || chromiumModule;
chromium.setGraphicsMode = false;
const appPath = process.env.MEANING_LINK_APP_PATH || "/workspace/scratch/9c0d8e522913/meaning-link-worksheet/index.html";
const appDir = path.dirname(appPath);
let baseUrl = process.env.MEANING_LINK_URL || "";
const xlsx = require(path.join(appDir, "vendor/xlsx.full.min.js"));
const xlsxPath = "/tmp/meaning-link-import-test.xlsx";
const jsonPath = "/tmp/meaning-link-import-test.json";
const invalidPath = "/tmp/meaning-link-empty.txt";

const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
  ["영단어", "한글 뜻", "영어 예문", "Day", "단원", "과", "태그"],
  ["xlsxword", "엑셀 검증 단어", "The xlsxword row came from a local workbook.", "5", "XLSX", "1", "파일"],
  ["sheetcell", "시트 셀", "A sheetcell keeps punctuation: commas, colons, and apostrophes.", "5", "XLSX", "1", "파일"]
]), "Words");
fs.writeFileSync(
  xlsxPath,
  xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }),
);
fs.writeFileSync(jsonPath, JSON.stringify({
  entries: [
    { word: "jsonword", meaning: "JSON 검증", example: "A jsonword survives backup and restore." },
    { word: "punctuation", meaning: "문장부호", example: "Keep commas, semicolons; and apostrophes intact!" }
  ],
  settings: { ...{ mode: "recall", paperSize: "A4", orientation: "portrait", columns: 1 }, documentTitle: "JSON 복원 학습지" }
}, null, 2));
fs.writeFileSync(invalidPath, "");

const results = [];
const consoleErrors = [];
let browser;
let server;

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function startServer() {
  if (baseUrl) return;
  server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const filePath = path.resolve(appDir, relative);
    if (!filePath.startsWith(`${path.resolve(appDir)}${path.sep}`) && filePath !== appPath) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache" });
      response.end(data);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
}

async function run(name, callback) {
  const started = Date.now();
  try {
    await callback();
    results.push({ name, status: "pass", ms: Date.now() - started });
  } catch (error) {
    results.push({ name, status: "fail", ms: Date.now() - started, error: error.stack || error.message });
  }
}

async function waitForRender(page, action) {
  await page.evaluate(async (source) => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("render timeout")), 5000);
      document.addEventListener("meaninglink:rendered", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      if (source.type === "settings") MeaningLinkApp.setSettings(source.value);
      else if (source.type === "entries") MeaningLinkApp.setEntries(source.value);
      else MeaningLinkApp.render();
    });
  }, action);
}

try {
  await startServer();
  browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
    headless: "shell"
  });
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await run("HTTP 첫 화면·샘플·핵심 요소", async () => {
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(baseUrl, { waitUntil: "networkidle0", timeout: 20000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => Boolean(window.MeaningLinkApp));
    assert.equal(await page.title(), "의미연결 깜지 생성기");
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 12);
    assert.equal(await page.$$eval(".sample-chip", (nodes) => nodes.length), 12);
    assert.ok(await page.$("#printRoot .sheet-page"));
    const bodyText = await page.$eval("body", (element) => element.innerText);
    assert.match(bodyText, /붙여넣기 · 파일 가져오기/);
    assert.match(bodyText, /인쇄 미리보기/);
  });

  await run("구분자·CSV 따옴표·제목행 자동 인식", async () => {
    const parsed = await page.evaluate(() => {
      const pipe = MeaningLinkApp.parseDelimited("word | 뜻 | Example, with comma\nnext | 다음 | A second example.", "auto");
      const csv = MeaningLinkApp.parseDelimited('word,meaning,example\nalpha,"뜻, 의미","A, B, and C"', "comma");
      return {
        pipeDelimiter: pipe.delimiter,
        pipeRows: pipe.rows,
        csvRows: csv.rows,
        header: MeaningLinkApp.detectHeaderRow(csv.rows[0])
      };
    });
    assert.equal(parsed.pipeDelimiter, "|");
    assert.equal(parsed.pipeRows[0][2], " Example, with comma");
    assert.equal(parsed.csvRows[1][1], "뜻, 의미");
    assert.equal(parsed.csvRows[1][2], "A, B, and C");
    assert.equal(parsed.header, true);
  });

  await run("직접 입력·자동 저장·새로고침 복원", async () => {
    await page.click("#addRowBtn");
    const cards = await page.$$(".entry-card");
    const lastCard = cards.at(-1);
    await lastCard.$eval('[data-field="word"]', (input) => input.focus());
    await page.keyboard.type("precision");
    await lastCard.$eval('[data-field="meaning"]', (input) => input.focus());
    await page.keyboard.type("정확성; 정밀함");
    await lastCard.$eval('[data-field="example"]', (input) => input.focus());
    await page.keyboard.type("Precision matters: commas, apostrophes, and punctuation!");
    await new Promise((resolve) => setTimeout(resolve, 450));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(MeaningLinkApp.storageKey)));
    assert.equal(saved.entries.at(-1).word, "precision");
    assert.equal(saved.entries.at(-1).meaning, "정확성; 정밀함");
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => Boolean(window.MeaningLinkApp));
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 13);
    assert.equal(await page.$eval('.entry-card:last-child [data-field="word"]', (input) => input.value), "precision");
  });

  await run("붙여넣기 UI·열 매핑 미리보기·추가", async () => {
    await page.click("#openImportBtn");
    await page.waitForSelector("#importDialog[open]");
    await page.type("#pasteInput", "영단어\t한글 뜻\t영어 예문\tDay\t단원\nresilient\t회복력이 있는\tThe system is resilient.\t3\t검증\nallocate\t배분하다\tWe allocate time carefully.\t3\t검증");
    await page.click("#analyzeImportBtn");
    assert.equal(await page.$eval("#headerRowInput", (input) => input.checked), true);
    assert.equal(await page.$eval("#confirmImportBtn", (button) => button.textContent.trim()), "2개 가져오기");
    assert.equal(await page.$$eval("#importPreviewBody tr", (nodes) => nodes.length), 2);
    await page.click("#confirmImportBtn");
    await page.waitForFunction(() => document.querySelectorAll(".entry-card").length === 15);
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 15);
  });

  await run("XLSX 실제 파일·빈 파일 오류 복구", async () => {
    await page.click("#openImportBtn");
    await page.waitForSelector("#importDialog[open]");
    const fileInput = await page.$("#dataFileInput");
    await fileInput.uploadFile(xlsxPath);
    await page.waitForFunction(() => document.querySelector("#confirmImportBtn")?.textContent.includes("2개"));
    assert.match(await page.$eval("#detectionResult", (element) => element.textContent), /Words/);
    assert.equal(await page.$eval("#mapWord", (select) => select.selectedOptions[0].textContent), "영단어");
    await page.click("#confirmImportBtn");
    await page.waitForFunction(() => MeaningLinkApp.getState().entries.some((entry) => entry.word === "xlsxword"));
    assert.equal((await page.evaluate(() => MeaningLinkApp.getState().entries.filter((entry) => entry.unit === "XLSX").length)), 2);

    await page.click("#openImportBtn");
    await page.waitForSelector("#importDialog[open]");
    const emptyInput = await page.$("#dataFileInput");
    await emptyInput.uploadFile(invalidPath);
    await page.waitForFunction(() => document.querySelector("#detectionResult")?.textContent.includes("찾지 못했습니다"));
    assert.equal(await page.$eval("#confirmImportBtn", (button) => button.disabled), true);
    await page.click("#importDialog .dialog-header .icon-button");
  });

  await run("행 복제·이동·선택 삭제·샘플 일괄 삭제", async () => {
    const entries = [
      { word: "one", meaning: "하나", example: "One stays first." },
      { word: "two", meaning: "둘", example: "Two stays second." },
      { word: "three", meaning: "셋", example: "Three stays third." }
    ];
    await waitForRender(page, { type: "entries", value: entries });
    await page.click('.entry-card:first-child [data-action="down"]');
    assert.deepEqual(await page.evaluate(() => MeaningLinkApp.getState().entries.map((entry) => entry.word)), ["two", "one", "three"]);
    await page.click('.entry-card:nth-child(2) [data-action="up"]');
    assert.deepEqual(await page.evaluate(() => MeaningLinkApp.getState().entries.map((entry) => entry.word)), ["one", "two", "three"]);
    await page.click('.entry-card:first-child [data-action="duplicate"]');
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 4);
    const ids = await page.evaluate(() => MeaningLinkApp.getState().entries.slice(0, 2).map((entry) => entry.id));
    assert.notEqual(ids[0], ids[1]);
    await page.click('.entry-card:nth-child(1) [data-select-entry]');
    await page.click('.entry-card:nth-child(2) [data-select-entry]');
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#deleteSelectedBtn");
    await page.waitForFunction(() => MeaningLinkApp.getState().entries.length === 2);
    await page.click('.entry-card:first-child [data-action="delete"]');
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 1);

    await page.evaluate(() => MeaningLinkApp.reset());
    await page.waitForFunction(() => document.querySelectorAll(".sample-chip").length === 12);
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clearSamplesBtn");
    await page.waitForFunction(() => MeaningLinkApp.getState().entries.length === 0);
    assert.equal(await page.$$eval(".sample-chip", (nodes) => nodes.length), 0);
  });

  await run("설정 컨트롤·JSON 복원·다운로드 동작", async () => {
    await page.click("#settingsTab");
    await page.evaluate(() => {
      const values = {
        paperSize: "B5", orientation: "landscape", columns: "2", wordsPerPage: "7", repeatCount: "3",
        fontPt: "11.5", slotHeightMm: "10.5", itemGapMm: "4.5", marginMm: "14", columnGapMm: "8",
        hintOpacity: "0.12", documentTitle: "컨트롤 검증 학습지"
      };
      Object.entries(values).forEach(([key, value]) => {
        const control = document.querySelector(`[data-setting="${key}"]`);
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      ["showMeaning", "showExample", "showNumbers", "showGroupTitle", "shuffle", "includeAnswerKey"].forEach((key, index) => {
        const control = document.querySelector(`[data-setting="${key}"]`);
        control.checked = index % 2 === 0;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settings = await page.evaluate(() => MeaningLinkApp.getState().settings);
    assert.equal(settings.paperSize, "B5");
    assert.equal(settings.orientation, "landscape");
    assert.equal(settings.columns, 2);
    assert.equal(settings.wordsPerPage, 7);
    assert.equal(settings.repeatCount, 3);
    assert.equal(settings.hintOpacity, 0.12);
    assert.equal(settings.documentTitle, "컨트롤 검증 학습지");

    await page.click("#themeBtn");
    assert.equal(await page.$eval("body", (body) => body.dataset.theme), "dark");
    await page.click("#themeBtn");
    assert.equal(await page.$eval("body", (body) => body.dataset.theme || "light"), "light");

    await page.click("#entriesTab");
    const downloads = await page.evaluate(() => {
      const captured = [];
      const original = HTMLAnchorElement.prototype.click;
      Object.defineProperty(HTMLAnchorElement.prototype, "click", {
        configurable: true,
        value() { captured.push({ download: this.download, href: this.href }); }
      });
      document.querySelector("#exportJsonBtn").click();
      document.querySelector("#downloadSampleBtn").click();
      Object.defineProperty(HTMLAnchorElement.prototype, "click", { configurable: true, value: original });
      return captured;
    });
    assert.equal(downloads.length, 2);
    assert.match(downloads[0].download, /\.json$/);
    assert.match(downloads[1].download, /\.tsv$/);

    page.once("dialog", (dialog) => dialog.accept());
    const jsonInput = await page.$("#jsonImportInput");
    await jsonInput.uploadFile(jsonPath);
    await page.waitForFunction(() => MeaningLinkApp.getState().entries.length === 2 && MeaningLinkApp.getState().settings.documentTitle === "JSON 복원 학습지");
    const restored = await page.evaluate(() => MeaningLinkApp.getState());
    assert.equal(restored.entries[1].example, "Keep commas, semicolons; and apostrophes intact!");
    assert.equal(restored.settings.mode, "recall");
  });

  await run("30개·긴 뜻과 예문·자동 페이지 나눔", async () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      word: `architecture${index + 1}`,
      meaning: `공간과 구조를 계획하는 긴 설명 ${index + 1} — 쉼표, 괄호(조건), 세미콜론; 문장부호 보존`,
      example: `Architecture${index + 1} connects people, materials, climate, movement, and context in a carefully planned space that remains readable even when the explanatory sentence becomes substantially longer than usual.`,
      day: String(Math.floor(index / 10) + 1),
      unit: "긴 문장 검증",
      lesson: String((index % 3) + 1),
      tags: "30개"
    }));
    await waitForRender(page, { type: "settings", value: { mode: "study", columns: 2, wordsPerPage: 10, repeatCount: 2, slotHeightMm: 8, fontPt: 9.5, includeAnswerKey: false, shuffle: false } });
    await waitForRender(page, { type: "entries", value: entries });
    const diagnostics = await page.evaluate(() => MeaningLinkApp.getDiagnostics());
    assert.equal(diagnostics.printableEntries, 30);
    assert.ok(diagnostics.pages >= 3);
    assert.equal(diagnostics.clipped, 0);
    assert.equal(diagnostics.oversize, 0);
    assert.equal(await page.$$eval(".worksheet-item", (nodes) => nodes.length), 30);
    const boundsOk = await page.$$eval(".sheet-column", (columns) => columns.every((column) => column.scrollHeight <= column.clientHeight + 2));
    assert.equal(boundsOk, true);
  });

  await run("네 학습지 유형·정답 비노출·정답지", async () => {
    const one = [{ word: "alphaunit", meaning: "검증용 뜻", example: "We placed alphaunit inside the example.", day: "4", unit: "유형", lesson: "1", tags: "" }];
    await waitForRender(page, { type: "entries", value: one });

    await waitForRender(page, { type: "settings", value: { mode: "study", includeAnswerKey: false, columns: 1 } });
    assert.equal(await page.$$eval(".mode-study", (nodes) => nodes.length), 1);
    assert.match(await page.$eval(".mode-study", (element) => element.innerText), /alphaunit/);

    await waitForRender(page, { type: "settings", value: { mode: "recall", includeAnswerKey: false } });
    assert.equal(await page.$$eval(".mode-recall", (nodes) => nodes.length), 1);
    assert.equal((await page.$eval(".mode-recall", (element) => element.innerText)).includes("alphaunit"), false);
    assert.equal(await page.$$eval(".mode-recall .blank-token", (nodes) => nodes.length), 1);

    await waitForRender(page, { type: "settings", value: { mode: "test", includeAnswerKey: true, shuffle: false } });
    const problemText = await page.$eval('.sheet-page[data-kind="worksheet"] .mode-test', (element) => element.innerText);
    assert.equal(problemText.includes("alphaunit"), false);
    assert.equal(await page.$$eval(".check-box", (nodes) => nodes.length), 1);
    assert.ok(await page.$('.sheet-page[data-kind="answer"]'));
    assert.match(await page.$eval('.sheet-page[data-kind="answer"]', (element) => element.innerText), /alphaunit/);

    await waitForRender(page, { type: "settings", value: { mode: "mixed", includeAnswerKey: false } });
    assert.equal(await page.$$eval(".mixed-stage", (nodes) => nodes.length), 4);
  });

  await run("예문 불일치·빈 뜻·빈 예문 안전 처리", async () => {
    const entries = [
      { word: "mismatch", meaning: "불일치", example: "This sentence uses another expression." },
      { word: "emptycase", meaning: "", example: "" }
    ];
    await waitForRender(page, { type: "settings", value: { mode: "recall", includeAnswerKey: false } });
    await waitForRender(page, { type: "entries", value: entries });
    assert.equal(await page.$$eval(".mode-recall", (nodes) => nodes.length), 2);
    assert.ok((await page.$eval(".mode-recall:first-of-type", (element) => element.innerText)).includes("알맞은 단어"));
    assert.ok((await page.$eval(".mode-recall:last-of-type", (element) => element.innerText)).includes("예문 없음"));
    const diagnostics = await page.evaluate(() => MeaningLinkApp.getDiagnostics());
    assert.equal(diagnostics.clipped, 0);
  });

  await run("필터·전체 선택·빈 행·설정 초기화·미리보기·인쇄·설치 버튼", async () => {
    await page.emulateMediaType("screen");
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const entries = [
      { word: "filterone", meaning: "필터 하나", example: "Filterone is visible.", day: "1", unit: "Alpha" },
      { word: "filtertwo", meaning: "필터 둘", example: "Filtertwo is visible.", day: "1", unit: "Beta" },
      { word: "rarequery", meaning: "검색 전용", example: "Rarequery is searchable.", day: "2", unit: "Beta" }
    ];
    await waitForRender(page, { type: "entries", value: entries });

    await page.select("#dayFilter", "1");
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 2);
    await page.select("#dayFilter", "");
    await page.select("#unitFilter", "Beta");
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 2);
    await page.select("#unitFilter", "");
    await page.$eval("#searchInput", (input) => {
      input.value = "rarequery";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.$$eval(".entry-card", (nodes) => nodes.length), 1);
    await page.$eval("#searchInput", (input) => {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    await page.click("#selectVisibleInput");
    assert.match(await page.$eval("#selectedCount", (element) => element.textContent), /3개/);
    assert.equal(await page.$eval("#deleteSelectedBtn", (button) => button.disabled), false);
    await page.click("#selectVisibleInput");
    assert.match(await page.$eval("#selectedCount", (element) => element.textContent), /0개/);

    await waitForRender(page, { type: "entries", value: [] });
    await page.click("#emptyAddBtn");
    await page.waitForFunction(() => MeaningLinkApp.getState().entries.length === 1);

    const fitText = await page.$eval("#fitPreviewBtn", (button) => button.textContent);
    await page.click("#zoomInBtn");
    assert.notEqual(await page.$eval("#fitPreviewBtn", (button) => button.textContent), fitText);
    await page.click("#fitPreviewBtn");
    assert.match(await page.$eval("#fitPreviewBtn", (button) => button.textContent), /맞춤/);
    await page.click("#zoomOutBtn");

    await page.evaluate(() => {
      window.__printChecks = 0;
      window.__originalPrint = window.print;
      window.print = () => { window.__printChecks += 1; };
    });
    await page.click("#headerPrintBtn");
    await page.waitForFunction(() => window.__printChecks === 1);
    await page.click("#previewPrintBtn");
    await page.waitForFunction(() => window.__printChecks === 2);
    await page.evaluate(() => { window.print = window.__originalPrint; });

    await page.click("#settingsTab");
    await waitForRender(page, { type: "settings", value: { paperSize: "B5", mode: "test", columns: 2 } });
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#resetSettingsBtn");
    await page.waitForFunction(() => MeaningLinkApp.getState().settings.paperSize === "A4" && MeaningLinkApp.getState().settings.mode === "mixed");

    await page.evaluate(() => {
      window.__installPromptChecks = 0;
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperties(event, {
        prompt: { value: () => { window.__installPromptChecks += 1; } },
        userChoice: { value: Promise.resolve({ outcome: "accepted" }) }
      });
      window.dispatchEvent(event);
    });
    assert.equal(await page.$eval("#installBtn", (button) => button.classList.contains("hidden")), false);
    await page.click("#installBtn");
    await page.waitForFunction(() => window.__installPromptChecks === 1 && document.querySelector("#installBtn").classList.contains("hidden"));

    await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1 });
    await page.click('[data-view="preview"]');
    assert.equal(await page.$eval("body", (body) => body.dataset.mobileView), "preview");
    await page.click('[data-view="edit"]');
    assert.equal(await page.$eval("body", (body) => body.dataset.mobileView), "edit");
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  });

  await run("B5 가로·2단·동적 @page", async () => {
    await waitForRender(page, { type: "settings", value: { paperSize: "B5", orientation: "landscape", columns: 2, mode: "study" } });
    const dimensions = await page.$eval(".sheet-page", (element) => ({ width: element.style.width, height: element.style.height, columns: getComputedStyle(element).getPropertyValue("--sheet-columns").trim() }));
    assert.equal(dimensions.width, "250mm");
    assert.equal(dimensions.height, "176mm");
    assert.equal(dimensions.columns, "2");
    assert.match(await page.$eval("#pageStyle", (element) => element.textContent), /250mm 176mm/);
  });

  await run("스마트폰·태블릿·데스크톱 반응형", async () => {
    await page.emulateMediaType("screen");
    await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    let layout = await page.evaluate(() => ({
      widthOk: document.documentElement.scrollWidth <= innerWidth + 1,
      switchDisplay: getComputedStyle(document.querySelector(".mobile-view-switch")).display,
      previewDisplay: getComputedStyle(document.querySelector("#previewPanel")).display
    }));
    assert.equal(layout.widthOk, true);
    assert.equal(layout.switchDisplay, "grid");
    assert.equal(layout.previewDisplay, "none");
    await page.click('[data-view="preview"]');
    layout = await page.evaluate(() => ({ widthOk: document.documentElement.scrollWidth <= innerWidth + 1, previewDisplay: getComputedStyle(document.querySelector("#previewPanel")).display }));
    assert.equal(layout.widthOk, true);
    assert.equal(layout.previewDisplay, "block");
    await page.screenshot({ path: "/tmp/meaning-link-mobile.png", fullPage: false });

    await page.setViewport({ width: 800, height: 1000, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const desktop = await page.evaluate(() => ({
      widthOk: document.documentElement.scrollWidth <= innerWidth + 1,
      workspace: getComputedStyle(document.querySelector(".workspace")).display,
      editor: getComputedStyle(document.querySelector("#editorPanel")).display,
      preview: getComputedStyle(document.querySelector("#previewPanel")).display
    }));
    assert.equal(desktop.widthOk, true);
    assert.equal(desktop.workspace, "grid");
    assert.notEqual(desktop.editor, "none");
    assert.notEqual(desktop.preview, "none");
    await page.screenshot({ path: "/tmp/meaning-link-desktop.png", fullPage: false });
  });

  await run("인쇄 미디어·벡터 PDF·화면 도구 숨김", async () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      word: `printword${index + 1}`,
      meaning: `인쇄 검증 뜻 ${index + 1}`,
      example: `This printword${index + 1} example verifies sharp browser PDF text.`,
      day: "P",
      unit: "Print"
    }));
    await waitForRender(page, { type: "settings", value: { paperSize: "A4", orientation: "portrait", mode: "study", columns: 2, wordsPerPage: 10, includeAnswerKey: false } });
    await waitForRender(page, { type: "entries", value: entries });
    await page.emulateMediaType("print");
    const printState = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector(".app-header")).display,
      editor: getComputedStyle(document.querySelector("#editorPanel")).display,
      toolbar: getComputedStyle(document.querySelector(".preview-toolbar")).display,
      root: getComputedStyle(document.querySelector("#printRoot")).display,
      pages: document.querySelectorAll(".sheet-page").length,
      clipping: MeaningLinkApp.getDiagnostics().clipped
    }));
    assert.equal(printState.header, "none");
    assert.equal(printState.editor, "none");
    assert.equal(printState.toolbar, "none");
    assert.equal(printState.root, "block");
    assert.ok(printState.pages >= 3);
    assert.equal(printState.clipping, 0);
    const pdfPath = "/tmp/meaning-link-print-test.pdf";
    await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true });
    const pdf = fs.readFileSync(pdfPath);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 25000);
    const pdfText = pdf.toString("latin1");
    const pageObjects = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.ok(pageObjects >= 3);
  });

  await run("서비스 워커 캐시·오프라인 재접속", async () => {
    await page.emulateMediaType("screen");
    await page.goto(baseUrl, { waitUntil: "networkidle0", timeout: 20000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "networkidle0" });
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForFunction(() => Boolean(window.MeaningLinkApp));
    assert.equal(await page.title(), "의미연결 깜지 생성기");
    await page.setOfflineMode(false);
  });

  await run("index.html 직접 열기", async () => {
    const directPage = await browser.newPage();
    const errors = [];
    directPage.on("pageerror", (error) => errors.push(error.message));
    await directPage.goto(pathToFileURL(appPath).href, { waitUntil: "load", timeout: 20000 });
    await directPage.waitForFunction(() => Boolean(window.MeaningLinkApp));
    assert.equal(await directPage.title(), "의미연결 깜지 생성기");
    assert.ok(await directPage.$("#printRoot .sheet-page"));
    assert.equal(errors.length, 0);
    await directPage.close();
  });

  await run("치명적 콘솔 오류 없음", async () => {
    assert.deepEqual(consoleErrors, []);
  });
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}

const failed = results.filter((result) => result.status === "fail");
console.log(JSON.stringify({
  summary: { passed: results.length - failed.length, failed: failed.length, total: results.length },
  results,
  consoleErrors
}, null, 2));

if (failed.length) process.exitCode = 1;
