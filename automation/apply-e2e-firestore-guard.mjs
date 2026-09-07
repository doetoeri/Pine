import fs from "node:fs";

const path = "pincon-class-ops-data.js";
let source = fs.readFileSync(path, "utf8");

const anchor = "let apiPromise;\n";
const helper = `let apiPromise;\n\nfunction localAutomationMode() {\n  const hostname = String(globalThis.location?.hostname || \"\");\n  const search = String(globalThis.location?.search || \"\");\n  return globalThis.navigator?.webdriver === true\n    && [\"127.0.0.1\", \"localhost\"].includes(hostname)\n    && new URLSearchParams(search).get(\"liveFirebase\") !== \"1\";\n}\n`;
if (!source.includes("function localAutomationMode()")) {
  if (!source.includes(anchor)) throw new Error("apiPromise anchor not found");
  source = source.replace(anchor, helper);
}

const startAnchor = `    if (!this.state.classKey) throw new Error(\"먼저 PinCon에서 학년과 반을 선택해 주세요.\");\n    this.loadCache();\n`;
const guardedStart = `    if (!this.state.classKey) throw new Error(\"먼저 PinCon에서 학년과 반을 선택해 주세요.\");\n    this.loadCache();\n    if (localAutomationMode()) {\n      for (const name of PUBLIC_COLLECTIONS) {\n        if (this.state.collectionStatus[name] === \"idle\") this.state.collectionStatus[name] = \"success\";\n      }\n      this.state.ready = true;\n      this.state.syncing = false;\n      this.state.lastError = \"\";\n      this.emit();\n      return this.snapshot();\n    }\n`;
if (!source.includes("if (localAutomationMode())")) {
  if (!source.includes(startAnchor)) throw new Error("start anchor not found");
  source = source.replace(startAnchor, guardedStart);
}

fs.writeFileSync(path, source);
console.log("Applied E2E Firestore isolation guard.");
