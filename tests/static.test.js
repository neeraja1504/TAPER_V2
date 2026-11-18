import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { neededSupplements } from "../src/compile.js";
import { TOPICS, TAB_TOPIC } from "../src/help.js";

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");

test("every element id used by app.js exists in index.html", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]));
  const dynamic = new Set(["lkU", "lkC", "ciStatus", "quizBox"]); // created by app.js itself
  const missing = [...used].filter(id => !ids.has(id) && !dynamic.has(id) && !id.startsWith("key-"));
  assert.deepEqual(missing, []);
});

test("every help topic referenced by the page exists", () => {
  const topics = new Set(TOPICS.map(t => t.id));
  const refs = [...html.matchAll(/data-help="([^"]+)"/g)].map(m => m[1]).concat(Object.values(TAB_TOPIC));
  assert.deepEqual(refs.filter(r => !topics.has(r)), []);
});

test("files the page loads exist", () => {
  for (const f of ["css/app.css", "src/app.js", "sample/sample-paper.zip", "tex/xeCJK.sty", "tex/ctexhook.sty", "tex/algorithmicx.sty"]) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test("browser compiles get packages missing from the TeX bundles, only when used", () => {
  const enc = s => new TextEncoder().encode(s);
  assert.deepEqual(neededSupplements({ "main.tex": enc("\\usepackage{xeCJK}\\usepackage[noend]{algpseudocode}") }).sort(),
    ["algorithmicx.sty", "algpseudocode.sty", "ctexhook.sty", "xeCJK.cfg", "xeCJK.sty"]);
  assert.deepEqual(neededSupplements({ "main.tex": "\\usepackage{amsmath,algorithm}", "algorithm.sty": "" }), []);
  assert.deepEqual(neededSupplements({ "main.tex": "\\usepackage{amsmath}" }), []);
});
