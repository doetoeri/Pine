import test from "node:test";
import assert from "node:assert/strict";
import { currentSlot } from "./notification-frequency-core.mjs";
import { intensiveDefaults } from "../next/experiment/notification-study.js";

const config = intensiveDefaults();
const at = (hour, minute) => new Date(`2026-11-06T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`);
test("intensive slots accept exactly one hour before and after", () => {
  assert.equal(currentSlot(at(7, 0), config)?.index, 0);
  assert.equal(currentSlot(at(8, 0), config)?.index, 0);
  assert.equal(currentSlot(at(9, 0), config)?.index, 0);
  assert.equal(currentSlot(at(6, 59), config), null);
  assert.equal(currentSlot(at(9, 1), config), null);
});
test("overlapping windows choose the nearest scheduled slot", () => {
  assert.equal(currentSlot(at(17, 44), config)?.index, 2);
  assert.equal(currentSlot(at(17, 45), config)?.index, 2);
  assert.equal(currentSlot(at(17, 46), config)?.index, 3);
  assert.equal(currentSlot(at(20, 37), config)?.index, 5);
  assert.equal(currentSlot(at(21, 40), config)?.index, 5);
  assert.equal(currentSlot(at(21, 41), config), null);
});
