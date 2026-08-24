import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const file = new URL("../data/problem-bank.json", import.meta.url);
const bank = JSON.parse(await readFile(file, "utf8"));

const allowedDifficulty = new Set(["easy", "medium", "hard"]);
const allowedType = new Set(["multiple-choice", "short-answer"]);
const allowedSource = new Set(["ai-generated", "self-made", "teacher-approved", "open-license"]);
const allowedStatus = new Set(["draft", "published"]);

test("problem bank uses schema v1 and unique stable ids", () => {
  assert.equal(bank.schemaVersion, 1);
  assert.ok(Array.isArray(bank.problems));
  const ids = bank.problems.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "problem ids must be unique");
  for (const id of ids) assert.match(id, /^pb-[a-zA-Z0-9-]{6,80}$/);
});

test("every problem is AI-safe, renderable, and class-scoped", () => {
  for (const item of bank.problems) {
    assert.match(item.classKey, /^[1-3]-(10|[1-9])$/);
    assert.ok(typeof item.subject === "string" && item.subject.trim());
    assert.ok(typeof item.unit === "string" && item.unit.trim());
    assert.ok(allowedDifficulty.has(item.difficulty));
    assert.ok(allowedType.has(item.type));
    assert.ok(typeof item.question === "string" && item.question.trim());
    assert.ok(typeof item.answer === "string" && item.answer.trim());
    assert.ok(typeof item.explanation === "string" && item.explanation.trim());
    assert.ok(Array.isArray(item.tags) && item.tags.length <= 12);
    assert.ok(allowedSource.has(item.source?.kind));
    assert.ok(typeof item.source?.note === "string");
    assert.ok(allowedStatus.has(item.status));

    if (item.type === "multiple-choice") {
      assert.ok(Array.isArray(item.choices) && item.choices.length >= 2 && item.choices.length <= 6);
      assert.ok(item.choices.includes(item.answer), `${item.id}: answer must exactly match one choice`);
    } else {
      assert.deepEqual(item.choices, []);
    }
  }
});

test("AI generated additions start as drafts", () => {
  for (const item of bank.problems.filter((row) => row.source?.kind === "ai-generated")) {
    assert.equal(item.status, "draft", `${item.id}: AI-generated additions require review before publishing`);
  }
});
