/* Pre-compiles the sample paper's PDFs so the sample opens instantly, without a TeX download.
 *
 * Usage:  node tools/build_sample_pdfs.mjs [--tectonic /path/to/tectonic] [--lang vi,zh]
 *
 * Needs Tectonic (https://tectonic-typesetting.github.io) or latexmk + XeLaTeX on PATH.
 * Writes sample/pdfs/original.pdf and sample/pdfs/<lang>/<termMode>-<share>.pdf for every level
 * SAMPLE.hasPdf() accepts. Re-run it after editing sample/translations/*.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseProject } from "../src/latex.js";
import { assembleTex, buildProjectFiles, englishOnlyTex, xetexCompat } from "../src/assemble.js";
import { LANGS } from "../src/langs.js";
import { levelKey } from "../src/levels.js";
import { SAMPLE, sampleTranslation } from "../src/sample.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const which = cmd => { try { return execFileSync("/bin/sh", ["-c", `command -v ${cmd}`]).toString().trim(); } catch { return null; } };
const tectonic = arg("--tectonic") || which("tectonic");
const latexmk = !tectonic && which("latexmk");
if (!tectonic && !latexmk) { console.error("Install Tectonic or latexmk + XeLaTeX, or pass --tectonic PATH."); process.exit(1); }
const langs = (arg("--lang") || SAMPLE.langs.join(",")).split(",");

const levels = [{ termMode: "native", share: 0 }, { termMode: "gloss", share: 0 }];
for (let s = 0; s <= 100; s += 5) levels.push({ termMode: "english", share: s });

const src = path.join(ROOT, "sample", "sample-paper");
const files = {};
const walk = d => fs.readdirSync(d).forEach(f => { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files[path.relative(src, p).split(path.sep).join("/")] = new Uint8Array(fs.readFileSync(p)); });
walk(src);
const doc = parseProject(files);
const defs = JSON.parse(fs.readFileSync(path.join(ROOT, "sample/translations/terms.json"), "utf8")).terms;

const cacheDir = path.join(ROOT, "node_modules", ".cache", "taper-fonts");
fs.mkdirSync(cacheDir, { recursive: true });
async function fonts(lang) {
  const out = {};
  for (const f of LANGS[lang].fonts) {
    const p = path.join(cacheDir, f.file);
    if (!fs.existsSync(p)) {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error(`font ${f.file}: ${r.status}`);
      fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
    }
    out[f.file] = new Uint8Array(fs.readFileSync(p));
  }
  return out;
}

function compile(proj, outPdf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taper-sample-"));
  try {
    for (const [p, v] of Object.entries(proj)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), v); }
    const main = doc.main.split("/").pop(), cwd = path.join(dir, path.dirname(doc.main));
    if (tectonic) execFileSync(tectonic, [main], { cwd, stdio: "pipe" });
    else execFileSync(latexmk, ["-xelatex", "-interaction=nonstopmode", main], { cwd, stdio: "pipe" });
    fs.mkdirSync(path.dirname(outPdf), { recursive: true });
    fs.copyFileSync(path.join(cwd, main.replace(/\.tex$/, ".pdf")), outPdf);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const outRoot = path.join(ROOT, "sample", "pdfs");
const t = englishOnlyTex(doc), i = t.search(/\\begin\s*\{document\}/);
compile({ ...files, [doc.main]: xetexCompat(t.slice(0, i)) + t.slice(i) }, path.join(outRoot, "original.pdf"));
console.log("original.pdf");
for (const lang of langs) {
  const tr = sampleTranslation(doc, "sample", JSON.parse(fs.readFileSync(path.join(ROOT, `sample/translations/${lang}.json`), "utf8")), defs);
  const fb = await fonts(lang);
  for (const lv of levels.filter(SAMPLE.hasPdf)) {
    const { tex } = assembleTex(doc, tr, lv, { colorTerms: true, keepPaperFont: true });
    compile(buildProjectFiles(doc, files, tex, lang, fb), path.join(outRoot, lang, levelKey(lv) + ".pdf"));
  }
  console.log(`${lang}: ${levels.length} levels`);
}
