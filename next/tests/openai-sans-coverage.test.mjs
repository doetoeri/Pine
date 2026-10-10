import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
test("PinCon and /new load one shared typography stylesheet", () => {
  for (const page of ["../index.html", "../../new/index.html"]) {
    assert.match(read(page), /pincon-fonts\.css/);
  }
});
test("CoverFlow faces, titles and captions explicitly use PinCon OpenAI Sans", () => {
  const css = read("../../pincon-fonts.css");
  for (const selector of [".pc-face", ".pc-title", ".pc-date", ".pc-caption-title", ".pc-caption-subject", ".pc-reflection .pc-face"]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(css, /OpenAISansHangulVariable\.woff2/);
});
test("Korean variable WOFF2 is present for deployment", () => {
  const asset = statSync(new URL("../../fonts/OpenAISansHangulVariable.woff2", import.meta.url));
  assert.ok(asset.size > 10_000, "missing or empty Hangul font");
});
