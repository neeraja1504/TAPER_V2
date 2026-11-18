/* Builds the translated LaTeX for one level from a parsed doc and its translation.
 * No LLM calls happen here: every level comes from the same cached translation.
 *
 * Technical terms are written as \taperterm{id}{en|n}{text}. In the PDF that is coloured text
 * wrapped in a link to https://taper.term/<id>; the TAPER viewer catches the click and shows
 * the term popup. Headings and captions use \tapertermplain (colour only, no link) because
 * their text is copied into the table of contents and PDF bookmarks.
 */
import { restore, PH_RE, dirOf, normPath } from "./latex.js";
import { LANGS } from "./langs.js";
import { englishSet } from "./levels.js";

export const TERM_URL = "https://taper.term/";
export const FONT_DIR = "taper-fonts/";

/* ---------- glossary index ---------- */
export const normKey = k => String(k || "").toLowerCase().replace(/\s+/g, " ").trim();
const singular = k => k.replace(/(?<=[a-z]{3})(es|s)$/, "");
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildTermIndex(glossary) {
  const list = (glossary?.terms || []).filter(t => t && t.en && t.id);
  const byKey = new Map();
  for (const t of list) {
    const k = normKey(t.en);
    if (!byKey.has(k)) byKey.set(k, t);
    if (!byKey.has(singular(k))) byKey.set(singular(k), t);
  }
  const keys = [...new Set(list.map(t => t.en.trim()))].sort((a, b) => b.length - a.length);
  const re = keys.length
    ? new RegExp(`(?<![\\\\\\p{L}\\p{N}])(${keys.map(k => escRe(k).replace(/\s+/g, "\\s+")).join("|")})(?:e?s)?(?![\\p{L}\\p{N}])`, "giu")
    : null;
  const lookup = k => byKey.get(normKey(k)) || byKey.get(singular(normKey(k))) || null;
  return { list, byKey, re, lookup };
}

/* Term keys (English) that occur in an English sentence. */
export function termsInEnglish(en, idx) {
  if (!idx.re) return [];
  const found = new Map();
  for (const m of en.matchAll(idx.re)) { const t = idx.lookup(m[1]); if (t) found.set(t.id, t); }
  return [...found.values()];
}

/* ---------- escaping ---------- */
/* Escapes LaTeX specials the LLM may have written raw. Math is in placeholders, so a bare
   $ & % # _ in translated prose is always meant as text. */
export function escapeText(s) {
  return String(s).replace(/(^|[^\\])(?=[%&#_$])/g, "$1\\").replace(/(^|[^\\])(?=[%&#_$])/g, "$1\\");
}
export function sanitizeTr(tr) {
  let s = String(tr).replace(/\r/g, "").replace(/\n[ \t]*\n\s*/g, " ").replace(/[ \t]*\n[ \t]*/g, " ");
  // Escape specials outside [[term]] markers.
  return s.split(/(\[\[[^\]]*\]\])/).map((part, i) => i % 2 ? part : escapeText(part)).join("");
}

/* ---------- checks used by the pipeline ---------- */
export function placeholderBag(s) { return [...String(s).matchAll(PH_RE)].map(m => m[1]).sort().join(","); }
function braceDelta(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === "{") d++; else if (s[i] === "}") d--;
  }
  return d;
}
const SAFE_CMDS = new Set(["emph", "textbf", "textit", "textsl", "textsc", "textrm", "textsf", "textup", "textmd",
  "underline", "footnote", "uline", "enquote", "textnormal", "mbox", "ldots", "dots", "par", "S", "P"]);
/* Local, deterministic checks. Returns a list of problems (empty = OK). */
export function localCheck(en, tr, idx) {
  const problems = [];
  if (typeof tr !== "string" || !tr.trim()) return ["empty translation"];
  if (placeholderBag(en) !== placeholderBag(tr)) problems.push("placeholders (⟦n⟧) were added, dropped or changed");
  if (braceDelta(en) !== braceDelta(tr)) problems.push("curly braces do not balance like the original");
  const enCmds = new Set([...en.matchAll(/\\([A-Za-z@]+)/g)].map(m => m[1]));
  const bad = [...tr.matchAll(/\\([A-Za-z@]+)/g)].map(m => m[1]).filter(c => !enCmds.has(c) && !SAFE_CMDS.has(c));
  if (bad.length) problems.push(`new LaTeX commands not in the original: ${[...new Set(bad)].map(c => "\\" + c).join(", ")}`);
  if (/[⟦⟧]/.test(tr.replace(PH_RE, ""))) problems.push("broken placeholder brackets");
  if (idx) {
    const unknown = [...tr.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]).filter(k => !idx.lookup(k));
    if (unknown.length) problems.push(`[[...]] used for words that are not glossary terms: ${unknown.join(", ")}`);
  }
  return problems;
}

/* ---------- sentence rendering ---------- */
function termTex(t, cls, text, linked) {
  const body = escapeText(text);
  return linked ? `\\taperterm{${t.id}}{${cls}}{${body}}` : `\\texorpdfstring{\\tapertermplain{${cls}}{${body}}}{${body}}`;
}
export function renderEnglish(en, idx, linked) {
  if (!idx.re) return en;
  return en.replace(idx.re, (m, key) => {
    const t = idx.lookup(key);
    return t ? (linked ? `\\taperterm{${t.id}}{en}{${m}}` : `\\texorpdfstring{\\tapertermplain{en}{${m}}}{${m}}`) : m;
  });
}
export function renderNative(tr, idx, termMode, linked) {
  return sanitizeTr(tr).replace(/\[\[([^\]]+)\]\]/g, (m, key) => {
    const t = idx.lookup(key);
    if (!t) return escapeText(key);
    if (termMode === "native") return termTex(t, "n", t.native || t.en, linked);
    if (termMode === "gloss") return termTex(t, "n", `${t.native || t.en} (${t.en})`, linked);
    return termTex(t, "en", t.en, linked);
  });
}
/* Wraps runs of Devanagari in the Devanagari font switch. */
export function wrapDevanagari(s) {
  return s.replace(/[ऀ-ॿ‌‍꣠-ꣿ]+(?:[ \t]+[ऀ-ॿ‌‍꣠-ꣿ]+)*/g, m => `{\\taperdeva ${m}}`);
}

/* ---------- preamble ---------- */
/* Removes pdfTeX-only settings so the source compiles with XeLaTeX. */
export function xetexCompat(pre) {
  return pre
    .replace(/\\pdf(output|minorversion|compresslevel|objcompresslevel|suppresswarningpagegroup|inclusioncopyfonts|pagewidth|pageheight|gentounicode|glyphtounicode)\b\s*=?\s*[0-9.]*\s*/g, "")
    .replace(/\\input\s*\{?glyphtounicode(\.tex)?\}?/g, "")
    .replace(/\\usepackage\s*\[([^\]]*)\]\s*\{(graphicx|graphics|hyperref|color|xcolor)\}/g, (m, opts, pkg) => {
      const kept = opts.split(",").map(o => o.trim()).filter(o => o && !/^(pdftex|dvips|dvipdfm|dvipdfmx|xetex|luatex)$/.test(o));
      return kept.length ? `\\usepackage[${kept.join(",")}]{${pkg}}` : `\\usepackage{${pkg}}`;
    });
}

export function taperPreamble(langCode, pre, opts = {}) {
  const L = LANGS[langCode] || { script: "latin", fonts: [] };
  const color = opts.colorTerms !== false;
  const lines = ["", "% ===== Added by TAPER (translated version; compile with XeLaTeX) ====="];
  if (!/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bfontspec\b/.test(pre)) lines.push("\\usepackage[no-math]{fontspec}");
  const fp = `Path=${FONT_DIR}`;
  if (L.script === "latin-ext") {
    lines.push(`\\setmainfont{NotoSerif}[${fp}, Extension=.ttf, UprightFont=*-Regular, BoldFont=*-Bold, ItalicFont=*-Italic, BoldItalicFont=*-BoldItalic]`);
  } else if (opts.keepPaperFont !== false) {
    if (/\{(times|mathptmx|newtxtext|txfonts|ptm|stix|stix2)\}/.test(pre)) lines.push("\\setmainfont{texgyretermes}[Extension=.otf, UprightFont=*-regular, BoldFont=*-bold, ItalicFont=*-italic, BoldItalicFont=*-bolditalic]");
    else if (/\{(palatino|mathpazo|newpxtext|pxfonts|palatino)\}/.test(pre)) lines.push("\\setmainfont{texgyrepagella}[Extension=.otf, UprightFont=*-regular, BoldFont=*-bold, ItalicFont=*-italic, BoldItalicFont=*-bolditalic]");
  }
  if (L.script === "cjk") {
    const f = L.fonts[0].file;
    lines.push("\\usepackage{xeCJK}");
    lines.push(`\\setCJKmainfont{${f}}[${fp}, AutoFakeBold=2.5, AutoFakeSlant=0.2]`);
    lines.push(`\\setCJKsansfont{${f}}[${fp}, AutoFakeBold=2.5, AutoFakeSlant=0.2]`);
    lines.push(`\\setCJKmonofont{${f}}[${fp}]`);
    if (L.cjkSpace) lines.push("\\xeCJKsetup{CJKspace=true}");
  }
  if (L.script === "deva") {
    lines.push(`\\newfontfamily\\taperdeva{NotoSerifDevanagari}[${fp}, Extension=.ttf, UprightFont=*-Regular, BoldFont=*-Bold, Script=Devanagari]`);
  }
  lines.push("\\usepackage{xcolor}");
  lines.push(color ? "\\definecolor{taperen}{RGB}{21,79,156}" : "\\definecolor{taperen}{gray}{0}");
  lines.push(color ? "\\definecolor{tapern}{RGB}{154,83,0}" : "\\definecolor{tapern}{gray}{0}");
  lines.push("\\providecommand{\\texorpdfstring}[2]{#1}");
  lines.push(`\\DeclareRobustCommand{\\taperterm}[3]{\\special{pdf:bann << /Type /Annot /Subtype /Link /Border [0 0 0] /A << /S /URI /URI (${TERM_URL}#1) >> >>}\\textcolor{taper#2}{#3}\\special{pdf:eann}}`);
  lines.push("\\DeclareRobustCommand{\\tapertermplain}[2]{\\textcolor{taper#1}{#2}}");
  if (L.script === "deva") lines.push("\\ifdefined\\pdfstringdefDisableCommands\\pdfstringdefDisableCommands{\\let\\taperdeva\\relax}\\fi");
  lines.push("% ===== End of TAPER additions =====", "");
  return lines.join("\n");
}

/* ---------- top level ---------- */
/* Returns { tex, nativePct, englishIds } for the given level. */
export function assembleTex(doc, tr, level, opts = {}) {
  const idx = buildTermIndex(tr.glossary);
  const enSet = englishSet(doc.sents, level.share);
  const deva = LANGS[tr.lang]?.script === "deva";
  let out = "", nativeChars = 0, totalChars = 0;
  for (const it of doc.items) {
    if (it.t === "raw") { out += it.s; continue; }
    const linked = it.kind === "para";
    for (const s of it.sents) {
      const t = tr.sents?.[s.id];
      const useEn = enSet.has(s.id) || !t || typeof t.tr !== "string" || t.status === "fallback";
      let text;
      if (useEn) text = renderEnglish(s.en, idx, linked);
      else {
        text = renderNative(t.tr, idx, level.termMode, linked);
        if (deva) text = wrapDevanagari(text);
        nativeChars += s.en.length;
      }
      totalChars += s.en.length;
      out += restore(text, doc.ph) + s.sep;
    }
  }
  const bd = out.search(/\\begin\s*\{document\}/);
  const pre = xetexCompat(out.slice(0, bd));
  const tex = pre + taperPreamble(tr.lang, pre, opts) + out.slice(bd);
  return { tex, nativePct: totalChars ? Math.round(100 * nativeChars / totalChars) : 0 };
}

/* Original English with the compat fixes only (used when the original is compiled with XeLaTeX). */
export function englishOnlyTex(doc) {
  const out = doc.items.map(it => it.t === "raw" ? it.s : it.sents.map(s => restore(s.en, doc.ph) + s.sep).join("")).join("");
  return out;
}

/* Files for the translated project: originals + translated main + fonts + a README. */
export function buildProjectFiles(doc, files, tex, langCode, fontBytes) {
  const out = { ...files };
  out[doc.main] = tex;
  const root = dirOf(doc.main);
  for (const f of LANGS[langCode]?.fonts || []) if (fontBytes?.[f.file]) out[normPath(root + FONT_DIR + f.file)] = fontBytes[f.file];
  out[normPath(root + "TAPER-README.txt")] =
`This project was translated with TAPER (Translation-Assisted Progressive English Reading).

Compile with XeLaTeX from this folder:
    latexmk -xelatex ${doc.main.split("/").pop()}
or  tectonic ${doc.main.split("/").pop()}
or upload the folder to Overleaf and set the compiler to XeLaTeX.

The main file has been flattened (\\input files inlined) and translated.
Fonts for the translated language are in ${FONT_DIR}.
Technical terms are coloured and link to https://taper.term/... ; those links only work inside the TAPER viewer.
`;
  return out;
}
