import test from "node:test";
import assert from "node:assert/strict";
import { defaultPlan, normalizePlan, currentWeek, planLevel, levelName, clampLevel } from "../src/levels.js";

test("default plan starts with English terms and ends in full English", () => {
  const p = defaultPlan(12);
  assert.equal(p.length, 12);
  assert.deepEqual([p[0].termMode, p[0].share], ["english", 0]);
  assert.equal(p[11].share, 100);
  for (let i = 1; i < p.length; i++) assert.ok(p[i].share >= p[i - 1].share);
  assert.equal(defaultPlan(1)[0].share, 100);
});

test("AI plans are cleaned: clamped, one row per week, never stepping back", () => {
  const p = normalizePlan([{ week: 1, termMode: "gloss", share: 0 }, { week: 2, termMode: "native", share: 13 }, { week: 3, termMode: "english", share: 5 }, { week: 9, share: 400 }], 4, true);
  assert.deepEqual(p.map(r => [r.termMode, r.share]), [["gloss", 0], ["english", 15], ["english", 15], ["english", 100]]);
});

test("current week from the start date, with override", () => {
  const start = "2026-01-01";
  assert.equal(currentWeek({ startDate: start, weeks: 12 }, Date.parse("2026-01-03")), 1);
  assert.equal(currentWeek({ startDate: start, weeks: 12 }, Date.parse("2026-01-20")), 3);
  assert.equal(currentWeek({ startDate: start, weeks: 12 }, Date.parse("2027-01-01")), 12);
  assert.equal(currentWeek({ startDate: start, weeks: 12, weekOverride: 5 }), 5);
  assert.deepEqual(planLevel({ weeks: 12, plan: defaultPlan(12) }, 12), { termMode: "english", share: 100 });
});

test("level names", () => {
  assert.equal(levelName({ termMode: "english", share: 50 }), "Mixed: 50% of sentences in English");
  assert.match(levelName({ termMode: "gloss", share: 35 }), /35%/);
  assert.deepEqual(clampLevel({ termMode: "x", share: 103 }), { termMode: "english", share: 100 });
});
