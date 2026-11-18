import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readSample } from "./helpers.js";
import { parseProject } from "../src/latex.js";
import { assembleTex, buildTermIndex, localCheck, termsInEnglish } from "../src/assemble.js";
import { LEVELS } from "../src/levels.js";
import { LANGS } from "../src/langs.js";
import { SAMPLE, sampleTranslation } from "../src/sample.js";

const doc = parseProject(readSample());
const defs = JSON.parse(fs.readFileSync(path.join(ROOT, "sample/translations/terms.json"), "utf8")).terms;
const load = lang => JSON.parse(fs.readFileSync(path.join(ROOT, `sample/translations/${lang}.json`), "utf8"));

test("the sample is translated into every supported language", () => {
  assert.deepEqual([...SAMPLE.langs].sort(), Object.keys(LANGS).sort());
});

test("every glossary term has a definition and occurs in the paper", () => {
  const idx = buildTermIndex({ terms: Object.keys(defs).map((en, i) => ({ id: "t" + i, en, native: "x" })) });
  const used = new Set(doc.sents.flatMap(s => termsInEnglish(s.en, idx).map(t => t.en)));
  assert.deepEqual(Object.keys(defs).filter(k => !used.has(k)), []);
});

for (const lang of SAMPLE.langs) {
  test(`sample translation (${lang}) is complete and passes the local checks`, () => {
    const data = load(lang);
    assert.equal(data.lang, lang);
    assert.deepEqual(Object.keys(defs).filter(k => !data.terms[k]), [], "every term translated");
    assert.deepEqual(doc.sents.map(s => s.id).filter(id => !data.sents[id]), [], "every sentence translated");
    const tr = sampleTranslation(doc, "p", data, defs);
    const idx = buildTermIndex(tr.glossary);
    for (const s of doc.sents) assert.deepEqual(localCheck(s.en, tr.sents[s.id].tr, idx), [], `${lang} ${s.id}`);
    assert.equal(tr.report.ok, doc.sents.length);
    for (const lv of LEVELS) {
      const { tex } = assembleTex(doc, tr, lv);
      assert.doesNotMatch(tex, /[⟦⟧]|\[\[/);
    }
  });
}
