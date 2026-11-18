import test from "node:test";
import assert from "node:assert/strict";
import { parseProject, splitSentences, stripComments, flatten, restore, segment, PH_RE } from "../src/latex.js";
import { readSample } from "./helpers.js";

const rebuild = doc => doc.items.map(it => it.t === "raw" ? it.s : it.sents.map(s => restore(s.en, doc.ph) + s.sep).join("")).join("");

test("sample paper: main file, title, sentences, bibliography", () => {
  const doc = parseProject(readSample());
  assert.equal(doc.main, "main.tex");
  assert.match(doc.title, /^Grounding Answers in Retrieved Evidence/);
  assert.equal(doc.sents.length, 30);
  assert.equal(doc.bib.hasBbl, true);
  assert.equal(doc.bib.needBibtex, false);
  assert.equal(doc.engine, "pdflatex");
  assert.ok(doc.sents.some(s => s.kind === "head" && s.en === "Introduction"), "\\input{sections/intro} is inlined");
});

test("math, citations, refs and tables never reach the translator", () => {
  const doc = parseProject(readSample());
  const all = doc.sents.map(s => s.en).join("\n");
  assert.doesNotMatch(all, /\$|\\cite|\\ref|\\begin\{equation|\\begin\{tabular|\\label|Closed-book model/);
  assert.ok(doc.ph.includes("$q$"));
  assert.ok(doc.ph.some(p => p.startsWith("\\begin{equation}")));
});

test("rebuilding the English reproduces the flattened source (comments aside)", () => {
  const files = readSample();
  const doc = parseProject(files);
  const dec = b => new TextDecoder().decode(b);
  const flat = flatten("main.tex", { "main.tex": dec(files["main.tex"]), "sections/intro.tex": dec(files["sections/intro.tex"]) });
  const norm = s => s.replace(/%\n[ \t]*/g, "");
  assert.equal(norm(rebuild(doc)), norm(flat));
});

test("sentence splitting respects abbreviations, initials and braces", () => {
  const parts = t => splitSentences(t).map(p => p.text);
  assert.deepEqual(parts("We use e.g. this one. Then we stop."), ["We use e.g. this one.", "Then we stop."]);
  assert.deepEqual(parts("As Smith et al. show, it works. Fig. 3 shows more."), ["As Smith et al. show, it works.", "Fig. 3 shows more."]);
  assert.deepEqual(parts("J. Smith wrote it. It is good."), ["J. Smith wrote it.", "It is good."]);
  assert.deepEqual(parts("A note\\footnote{First. Second.} here. Next one."), ["A note\\footnote{First. Second.} here.", "Next one."]);
  assert.deepEqual(parts("Value is 3.5 here. Done."), ["Value is 3.5 here.", "Done."]);
});

test("comments are stripped, escaped percent signs and verbatim are kept", () => {
  assert.equal(stripComments("50\\% of cases % note"), "50\\% of cases %");
  const v = "\\begin{verbatim}\n% keep\n\\end{verbatim}\nx % drop";
  assert.equal(stripComments(v), "\\begin{verbatim}\n% keep\n\\end{verbatim}\nx %");
  assert.equal(stripComments("\\url{http://a.b/c%20d} % x"), "\\url{http://a.b/c%20d} %");
});

test("flatten handles \\input without braces and \\include", () => {
  const m = { "main.tex": "A\n\\input sec/a.tex\n\\include{sec/b}\nZ", "sec/a.tex": "AAA", "sec/b.tex": "BBB" };
  const out = flatten("main.tex", m);
  assert.match(out, /AAA/);
  assert.match(out, /\\clearpage\nBBB\n\\clearpage/);
  assert.doesNotMatch(flatten("main.tex", { "main.tex": "\\includegraphics{x}" }), /clearpage/);
});

test("restore adds {} between a control word and a following letter", () => {
  assert.equal(restore("⟦0⟧là", ["\\ours"]), "\\ours{}là");
  assert.equal(restore("⟦0⟧ là", ["\\ours"]), "\\ours là");
  assert.equal(restore("⟦0⟧x", ["$a$"]), "$a$x");
});

test("protected environments and structural commands stay raw", () => {
  const src = "\\documentclass{article}\\begin{document}\nText here is fine.\n\n\\begin{lstlisting}\nint x; // Not prose.\n\\end{lstlisting}\n\\vspace{2mm}\nMore text with \\textbf{bold words} and $x^2$.\n\\end{document}";
  const { items, ph } = segment(src);
  const blocks = items.filter(i => i.t === "blk").flatMap(b => b.sents.map(s => s.en));
  assert.deepEqual(blocks, ["Text here is fine.", "More text with \\textbf{bold words} and ⟦0⟧."]);
  assert.deepEqual(ph, ["$x^2$"]);
  assert.match(items.filter(i => i.t === "raw").map(i => i.s).join(""), /lstlisting[\s\S]*\\vspace\{2mm\}/);
});

test("headings, captions and titles become their own units", () => {
  const src = "\\documentclass{article}\\title{A \\emph{Great} Title}\\begin{document}\\section*{Related Work}\\label{s}\nWe compare.\n\\begin{figure}\\centering\\includegraphics{a.png}\\caption[short]{Long caption here.}\\end{figure}\\end{document}";
  const { items } = segment(src);
  const kinds = items.filter(i => i.t === "blk").map(b => [b.kind, b.sents.map(s => s.en).join("|")]);
  assert.deepEqual(kinds, [["title", "A \\emph{Great} Title"], ["head", "Related Work"], ["para", "We compare."], ["cap", "Long caption here."]]);
  const raw = items.filter(i => i.t === "raw").map(i => i.s).join("");
  assert.match(raw, /\\caption\[short\]\{\}\\end\{figure\}/);
});

test("no prose sentence keeps a broken placeholder", () => {
  const doc = parseProject(readSample());
  for (const s of doc.sents) for (const m of s.en.matchAll(PH_RE)) assert.ok(doc.ph[+m[1]] !== undefined);
});
