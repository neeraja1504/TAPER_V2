import test from "node:test";
import assert from "node:assert/strict";
import { parseProject } from "../src/latex.js";
import { assembleTex, sanitizeTr, localCheck, buildTermIndex, renderEnglish, renderNative, wrapDevanagari, xetexCompat, buildProjectFiles } from "../src/assemble.js";
import { englishSet, LEVELS } from "../src/levels.js";
import { readSample, fakeTranslation } from "./helpers.js";

const braceDelta = s => { let d = 0; for (let i = 0; i < s.length; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === "{") d++; else if (s[i] === "}") d--; } return d; };

test("every preset level assembles to balanced LaTeX with no leftover placeholders", () => {
  const doc = parseProject(readSample());
  const tr = fakeTranslation(doc);
  let lastPct = 101;
  for (const lv of LEVELS) {
    const { tex, nativePct } = assembleTex(doc, tr, lv);
    assert.doesNotMatch(tex, /[⟦⟧]|\[\[/);
    assert.equal(braceDelta(tex), 0, lv.name);
    assert.match(tex, /\\usepackage\[no-math\]\{fontspec\}/);
    assert.doesNotMatch(tex, /\\pdfoutput/);
    assert.ok(nativePct <= lastPct, "native share never grows with level");
    lastPct = nativePct;
  }
  assert.equal(lastPct, 0);
});

test("term modes: native, gloss and English terms", () => {
  const doc = parseProject(readSample());
  const tr = fakeTranslation(doc);
  const native = assembleTex(doc, tr, { termMode: "native", share: 0 }).tex;
  const gloss = assembleTex(doc, tr, { termMode: "gloss", share: 0 }).tex;
  const english = assembleTex(doc, tr, { termMode: "english", share: 0 }).tex;
  assert.match(native, /\\taperterm\{t2\}\{n\}\{bộ mã hóa chéo\}/);
  assert.match(gloss, /\\taperterm\{t2\}\{n\}\{bộ mã hóa chéo \(cross-encoder\)\}/);
  assert.match(english, /\\taperterm\{t2\}\{en\}\{cross-encoder\}/);
  assert.match(english, /\\DeclareRobustCommand\{\\taperterm\}\[3\]\{\\special\{pdf:bann/);
});

test("headings and captions use plain (unlinked) term styling", () => {
  const doc = parseProject(readSample());
  const tr = fakeTranslation(doc);
  tr.sents[doc.sents.find(s => s.kind === "cap" && /cross-encoder/.test(s.en)).id].tr = "VI: [[cross-encoder]] chú thích.";
  const { tex } = assembleTex(doc, tr, { termMode: "english", share: 0 });
  assert.match(tex, /\\caption\{[^]*?\\texorpdfstring\{\\tapertermplain\{en\}\{cross-encoder\}\}/);
});

test("English sentences grow monotonically and shortest go first", () => {
  const doc = parseProject(readSample());
  let prev = new Set();
  for (let share = 0; share <= 100; share += 5) {
    const cur = englishSet(doc.sents, share);
    for (const id of prev) assert.ok(cur.has(id), `sentence ${id} stays English at ${share}%`);
    prev = cur;
  }
  assert.equal(prev.size, doc.sents.length);
});

test("fallback and missing sentences are shown in English", () => {
  const doc = parseProject(readSample());
  const tr = fakeTranslation(doc);
  tr.sents.s2.status = "fallback";
  delete tr.sents.s3;
  const { tex } = assembleTex(doc, tr, { termMode: "english", share: 0 });
  assert.match(tex, /Large language models often produce fluent answers/);
  assert.match(tex, /We study \\taperterm\{t1\}\{en\}\{retrieval-augmented generation\}/);
});

test("sanitizeTr escapes LaTeX specials once and joins lines", () => {
  assert.equal(sanitizeTr("50% và 30\\% & #1 a_b"), "50\\% và 30\\% \\& \\#1 a\\_b");
  assert.equal(sanitizeTr("dòng một\n\ndòng hai"), "dòng một dòng hai");
  assert.equal(sanitizeTr("[[a_b]] x_y"), "[[a_b]] x\\_y");
});

test("local checks catch placeholder, brace and command problems", () => {
  const idx = buildTermIndex({ terms: [{ id: "t1", en: "encoder", native: "bộ mã hóa" }] });
  assert.deepEqual(localCheck("Uses ⟦0⟧ and \\emph{x}.", "Dùng ⟦0⟧ và \\emph{x}.", idx), []);
  assert.match(localCheck("Uses ⟦0⟧.", "Dùng.", idx).join(), /placeholders/);
  assert.match(localCheck("Uses \\emph{x}.", "Dùng \\emph{x.", idx).join(), /braces/);
  assert.match(localCheck("Uses x.", "Dùng \\cite{x}.", idx).join(), /new LaTeX commands/);
  assert.match(localCheck("An encoder.", "Một [[decoder]].", idx).join(), /not glossary terms/);
  assert.deepEqual(localCheck("An encoder.", "Một [[Encoders]].", idx), []);
});

test("English term matching skips command names and handles plurals", () => {
  const idx = buildTermIndex({ terms: [{ id: "t1", en: "text", native: "x" }, { id: "t2", en: "encoder", native: "y" }] });
  assert.equal(renderEnglish("\\textbf{text} encoders", idx, true), "\\textbf{\\taperterm{t1}{en}{text}} \\taperterm{t2}{en}{encoders}");
});

test("Devanagari runs get the Devanagari font", () => {
  assert.equal(wrapDevanagari("यह [x] एक परीक्षण है."), "{\\taperdeva यह} [x] {\\taperdeva एक परीक्षण है}.");
});

test("XeLaTeX compatibility removes pdfTeX-only settings", () => {
  const out = xetexCompat("\\pdfoutput=1\n\\usepackage[pdftex,final]{graphicx}\n\\usepackage[pdftex]{hyperref}\n\\pdfminorversion=7\n");
  assert.equal(out, "\\usepackage[final]{graphicx}\n\\usepackage{hyperref}\n");
});

test("language-specific font setup", () => {
  const doc = parseProject(readSample());
  const zh = assembleTex(doc, { ...fakeTranslation(doc), lang: "zh" }, LEVELS[2]).tex;
  assert.match(zh, /\\usepackage\{xeCJK\}\n\\setCJKmainfont\{NotoSansSC-Regular\.otf\}\[Path=taper-fonts\//);
  const ko = assembleTex(doc, { ...fakeTranslation(doc), lang: "ko" }, LEVELS[2]).tex;
  assert.match(ko, /CJKspace=true/);
  const hi = assembleTex(doc, { ...fakeTranslation(doc), lang: "hi" }, LEVELS[2]).tex;
  assert.match(hi, /\\newfontfamily\\taperdeva/);
  const vi = assembleTex(doc, fakeTranslation(doc), LEVELS[2]).tex;
  assert.match(vi, /\\setmainfont\{NotoSerif\}/);
  const files = buildProjectFiles(doc, { "main.tex": "x" }, vi, "vi", { "NotoSerif-Regular.ttf": new Uint8Array(1) });
  assert.ok(files["taper-fonts/NotoSerif-Regular.ttf"]);
  assert.ok(files["TAPER-README.txt"]);
});

test("inflected native forms and the original's English number", () => {
  const idx = buildTermIndex({ terms: [{ id: "t1", en: "language model", native: "modelo de lenguaje" }] });
  const en = "Large language models are fluent.";
  const tr = "Los grandes [[language model|modelos de lenguaje]] son fluidos.";
  assert.deepEqual(localCheck(en, tr, idx), []);
  assert.equal(renderNative(tr, idx, "native", true, en), "Los grandes \\taperterm{t1}{n}{modelos de lenguaje} son fluidos.");
  assert.equal(renderNative(tr, idx, "english", true, en), "Los grandes \\taperterm{t1}{en}{language models} son fluidos.");
  assert.equal(renderNative(tr, idx, "gloss", true, en), "Los grandes \\taperterm{t1}{n}{modelos de lenguaje (language models)} son fluidos.");
  assert.equal(renderNative("Un [[language model]].", idx, "english", true, "Language models work."), "Un \\taperterm{t1}{en}{language models}.");
});

test("title-case terms use glossary casing; adjacent English terms get a space", () => {
  const idx = buildTermIndex({ terms: [{ id: "t1", en: "question answering", native: "问答" }, { id: "t2", en: "benchmark", native: "基准" }, { id: "t3", en: "retrieval-augmented generation", native: "检索增强生成" }] });
  assert.equal(renderNative("关于[[retrieval-augmented generation]]的研究", idx, "english", false, "A Study of Retrieval-Augmented Generation"),
    "关于\\texorpdfstring{\\tapertermplain{en}{retrieval-augmented generation}}{retrieval-augmented generation}的研究");
  assert.equal(renderNative("三个[[question answering]][[benchmark]]上", idx, "english", true, "On three question answering benchmarks"),
    "三个\\taperterm{t1}{en}{question answering} \\taperterm{t2}{en}{benchmarks}上");
  assert.equal(renderNative("三个[[question answering]][[benchmark]]上", idx, "native", true, "x"), "三个\\taperterm{t1}{n}{问答}\\taperterm{t2}{n}{基准}上");
});

test("a term that starts a sentence is capitalised", () => {
  const idx = buildTermIndex({ terms: [{ id: "t1", en: "language model", native: "языковая модель" }] });
  assert.equal(renderNative("[[language model|языковые модели]] учатся.", idx, "english", true, "Language models learn."), "\\taperterm{t1}{en}{Language models} учатся.");
  assert.equal(renderNative("[[language model]] учится.", idx, "native", true, "x"), "\\taperterm{t1}{n}{Языковая модель} учится.");
});
