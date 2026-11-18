/* LaTeX project parsing for TAPER.
 *
 * Turns an uploaded LaTeX project into a "doc": the flattened main file split into
 * raw LaTeX (kept byte-for-byte) and translatable prose blocks. Inside prose,
 * math, citations, references and unknown commands are replaced with placeholders
 * like ⟦12⟧ so the LLM never touches them. Prose is split into sentences locally,
 * so the English side is always the exact original text.
 *
 * Pure functions, no DOM: runs in the browser and in Node tests.
 */

export const PH_RE = /⟦(\d+)⟧/g;
export const ph = n => `⟦${n}⟧`;

/* Environments kept whole and never translated. */
const MATH_ENVS = new Set(["equation", "align", "gather", "multline", "eqnarray", "math", "displaymath",
  "flalign", "alignat", "split", "subequations", "dmath", "dgroup"]);
const PROTECT_ENVS = new Set([...MATH_ENVS, "tabular", "tabularx", "tabulary", "longtable", "array", "tabu",
  "verbatim", "Verbatim", "lstlisting", "minted", "alltt", "comment", "tikzpicture", "pgfpicture", "picture",
  "algorithmic", "algorithmic*", "algorithm2e", "thebibliography", "filecontents", "lstinline", "spverbatim",
  "forest", "axis", "circuitikz", "tikzcd", "CD", "pmatrix", "bmatrix", "matrix", "cases", "IEEEeqnarray"]);
const VERBATIM_ENVS = ["verbatim", "Verbatim", "lstlisting", "minted", "alltt", "comment", "spverbatim", "filecontents"];
/* Environments whose \begin takes this many mandatory arguments (beyond optional [..]). */
const ENV_ARGS = { minipage: 1, wrapfigure: 2, wraptable: 2, subfigure: 1, subtable: 1, multicols: 1, "multicols*": 1,
  adjustbox: 1, tcolorbox: 0, sidewaysfigure: 0, figure: 0, table: 0 };
/* Commands whose argument is its own translatable unit. */
const HEADING_CMDS = { part: "head", chapter: "head", section: "head", subsection: "head", subsubsection: "head",
  paragraph: "head", subparagraph: "head", title: "title", caption: "cap", subcaption: "cap", captionof: "cap" };
/* Formatting commands left in the text for the LLM to keep (only their content is translated). */
const INLINE_TEXT_CMDS = new Set(["emph", "textbf", "textit", "textsl", "textsc", "textrm", "textsf", "textup",
  "textmd", "underline", "footnote", "uline", "enquote", "textnormal", "mbox"]);
/* Layout/setup commands: kept as raw LaTeX when they start a paragraph. */
const STRUCTURAL_CMDS = new Set(["maketitle", "centering", "raggedright", "raggedleft", "noindent", "indent",
  "newpage", "clearpage", "cleardoublepage", "pagebreak", "vspace", "vskip", "hspace", "smallskip", "medskip",
  "bigskip", "vfill", "hfill", "includegraphics", "bibliography", "bibliographystyle", "printbibliography",
  "appendix", "tableofcontents", "listoffigures", "listoftables", "label", "newcommand", "renewcommand",
  "providecommand", "DeclareMathOperator", "newtheorem", "def", "gdef", "edef", "let", "setlength", "addtolength",
  "setcounter", "addtocounter", "addcontentsline", "input", "include", "thispagestyle", "pagestyle", "hline",
  "toprule", "midrule", "bottomrule", "resizebox", "scalebox", "subfloat", "frontmatter", "mainmatter",
  "backmatter", "author", "date", "affil", "address", "email", "institute", "keywords", "IEEEoverridecommandlockouts",
  "small", "footnotesize", "scriptsize", "tiny", "normalsize", "large", "Large", "LARGE", "huge", "Huge",
  "nocite", "balance", "onecolumn", "twocolumn", "graphicspath", "captionsetup", "setcitestyle", "linenumbers",
  "acknowledgments", "acknowledgements", "newenvironment", "renewenvironment", "usetikzlibrary", "hypersetup",
  "definecolor", "pgfplotsset", "tikzset", "lstset", "renewcaptionname", "AtBeginDocument", "makeatletter",
  "makeatother", "sloppy", "fussy", "flushbottom", "raggedbottom", "null", "relax", "protect"]);
const DEF_CMDS = new Set(["def", "gdef", "edef", "xdef"]);

/* ---------- text decoding ---------- */
export function decodeText(bytes) {
  if (typeof bytes === "string") return bytes;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("latin1").decode(bytes); }
}

/* ---------- comments ---------- */
/* Removes comment text but keeps the "%" so TeX's line-joining behaviour is unchanged.
   Skips verbatim-like environments and \verb. */
export function stripComments(src) {
  const lines = src.split("\n");
  let inVerb = null;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (inVerb) {
      if (line.includes(`\\end{${inVerb}}`)) inVerb = null;
      continue;
    }
    const vb = VERBATIM_ENVS.find(e => line.includes(`\\begin{${e}}`));
    const masked = line.replace(/\\verb\*?(.)(?:(?!\1).)*\1|\\(?:url|href)\s*\{[^}]*\}/g, m => " ".repeat(m.length));
    let cut = -1;
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] === "%" && !isEscaped(masked, i)) { cut = i; break; }
    }
    if (vb && (cut < 0 || line.indexOf(`\\begin{${vb}}`) < cut)) {
      if (!line.includes(`\\end{${vb}}`)) inVerb = vb;
      continue;
    }
    if (cut >= 0) lines[li] = line.slice(0, cut + 1);
  }
  return lines.join("\n");
}
function isEscaped(s, i) {
  let n = 0;
  for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) n++;
  return n % 2 === 1;
}

/* ---------- project structure ---------- */
export function findMainTex(texMap) {
  const cands = Object.entries(texMap).filter(([, t]) => {
    const s = stripComments(t);
    return /\\documentclass/.test(s) && /\\begin\s*\{document\}/.test(s);
  }).map(([p]) => p);
  if (!cands.length) return null;
  const pref = ["main.tex", "ms.tex", "paper.tex", "article.tex", "manuscript.tex"];
  cands.sort((a, b) => {
    const ra = pref.indexOf(a.split("/").pop().toLowerCase()), rb = pref.indexOf(b.split("/").pop().toLowerCase());
    if ((ra >= 0) !== (rb >= 0)) return ra >= 0 ? -1 : 1;
    const da = a.split("/").length, db = b.split("/").length;
    if (da !== db) return da - db;
    return texMap[b].length - texMap[a].length;
  });
  return cands[0];
}

export function dirOf(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i + 1); }
export function normPath(p) {
  const out = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return out.join("/");
}

/* Inlines \input / \include of .tex files, relative to the main file's folder (as LaTeX does). */
export function flatten(mainPath, texMap, depth = 0) {
  const root = dirOf(mainPath);
  const seen = new Set();
  const resolve = name => {
    name = name.trim().replace(/^"|"$/g, "");
    const tries = [name, name + ".tex"].map(n => normPath(root + n));
    return tries.find(t => texMap[t] !== undefined && /\.tex$/i.test(t)) || null;
  };
  const expand = (src, d) => {
    src = stripComments(src);
    return src.replace(/\\(input|include|subfile)(?![A-Za-z@])\s*(?:\{([^}]+)\}|([^\s{}\\%]+\.tex))/g, (m, cmd, a, b, off) => {
      if (isEscaped(src, off)) return m;
      const target = resolve(a || b);
      if (!target || d > 20 || seen.has(target + "@" + d)) return m;
      seen.add(target + "@" + d);
      const body = expand(texMap[target], d + 1);
      return cmd === "include" ? `\\clearpage\n${body}\n\\clearpage\n` : body;
    });
  };
  return expand(texMap[mainPath], depth);
}

/* ---------- scanning helpers ---------- */
/* Index just past the group that opens at s[i] ("{" or "["), honouring nesting and escapes. */
export function matchGroup(s, i) {
  const open = s[i], close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") { j++; continue; }
    if (open === "[" && c === "{") { const k = matchGroup(s, j); if (k < 0) return -1; j = k - 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}
function readName(s, i) {
  // s[i] === "\\"; returns [name, nextIndex]
  const m = /^[A-Za-z@]+\*?/.exec(s.slice(i + 1, i + 60));
  if (m) return [m[0], i + 1 + m[0].length];
  return [s[i + 1] || "", i + 2];
}
/* Captures optional [..] and mandatory {..} groups that follow immediately (max groups). */
function captureArgs(s, j, max = 9, allowSpace = false) {
  let n = 0;
  while (n < max) {
    let k = j;
    if (allowSpace) while (s[k] === " " || s[k] === "\t") k++;
    if (s[k] !== "{" && s[k] !== "[") break;
    const e = matchGroup(s, k);
    if (e < 0) break;
    j = e; n++;
  }
  return j;
}
function findEnvEnd(s, from, env) {
  const esc = env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${esc}\\}`, "g");
  re.lastIndex = from;
  let depth = 0, m;
  while ((m = re.exec(s))) {
    if (m[1] === "begin") depth++;
    else if (--depth === 0) return m.index + m[0].length;
  }
  return s.length;
}
function findClosingDollar(s, i, double) {
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "$") {
      if (!double) return j + 1;
      if (s[j + 1] === "$") return j + 2;
    }
  }
  return s.length;
}

/* ---------- segmentation ---------- */
/* Splits the flattened source into items:
     { t: "raw", s }                                     LaTeX kept as-is
     { t: "blk", id, kind, sents: [{ id, en, sep }] }    translatable prose
   Placeholder texts live in doc.ph (index = number inside ⟦n⟧). */
export function segment(flat) {
  const phs = [];
  const items = [];
  let blockN = 0, sentN = 0;
  const addPh = text => { phs.push(text); return ph(phs.length - 1); };
  const raw = s => { if (!s) return; const last = items[items.length - 1]; if (last && last.t === "raw") last.s += s; else items.push({ t: "raw", s }); };

  const pushBlock = (text, kind) => {
    const lead = text.match(/^\s*/)[0];
    const trail = text.slice(lead.length).match(/\s*$/)[0];
    const core = text.slice(lead.length, text.length - trail.length);
    raw(lead);
    if (!/\p{L}/u.test(core.replace(PH_RE, ""))) {
      raw(restore(core, phs));
    } else {
      const parts = kind === "head" || kind === "title" ? [{ text: core, sep: "" }] : splitSentences(core);
      const id = "b" + (++blockN);
      items.push({ t: "blk", id, kind, sents: parts.map(p => ({ id: "s" + (++sentN), en: p.text, sep: p.sep })) });
    }
    raw(trail);
  };

  const begin = flat.search(/\\begin\s*\{document\}/);
  const endDoc = flat.search(/\\end\s*\{document\}/);
  if (begin < 0) throw new Error("No \\begin{document} found in the main .tex file.");
  const preamble = flat.slice(0, begin);
  const beginTok = flat.slice(begin).match(/^\\begin\s*\{document\}/)[0];
  const body = flat.slice(begin + beginTok.length, endDoc < 0 ? flat.length : endDoc);
  const tail = endDoc < 0 ? "" : flat.slice(endDoc);

  // Preamble: raw, except the \title argument.
  const tm = /\\title\s*(\[[^\]]*\])?\s*\{/.exec(preamble);
  if (tm && !isEscaped(preamble, tm.index)) {
    const open = tm.index + tm[0].length - 1, close = matchGroup(preamble, open);
    if (close > 0) {
      raw(preamble.slice(0, open + 1));
      const sub = scanInline(preamble.slice(open + 1, close - 1), addPh);
      pushBlock(sub, "title");
      raw(preamble.slice(close - 1));
    } else raw(preamble);
  } else raw(preamble);
  raw(beginTok);
  scanBody(body, { raw, pushBlock, addPh, phs });
  raw(tail);
  return { items, ph: phs };
}

/* Replaces math/commands in a short argument (title, heading) with placeholders. */
function scanInline(s, addPh) {
  let out = "";
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "\\") {
      const [name, j] = readName(s, i);
      if (/^[A-Za-z@]/.test(name)) {
        const base = name.replace(/\*$/, "");
        if (INLINE_TEXT_CMDS.has(base)) { out += "\\" + name; i = j; continue; }
        const e = captureArgs(s, j);
        out += addPh(s.slice(i, e)); i = e; continue;
      }
      if (name === "(") { const e = s.indexOf("\\)", j); const end = e < 0 ? s.length : e + 2; out += addPh(s.slice(i, end)); i = end; continue; }
      if (name === "\\") { const e = captureArgs(s, s[j] === "*" ? j + 1 : j, 1); out += addPh(s.slice(i, e)); i = e; continue; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === "$") { const dbl = s[i + 1] === "$"; const e = findClosingDollar(s, i + (dbl ? 2 : 1), dbl); out += addPh(s.slice(i, e)); i = e; continue; }
    if (c === "%" ) { const m = /^%[^\n]*\n?[ \t]*/.exec(s.slice(i)); i += m[0].length; continue; }
    out += c; i++;
  }
  return out;
}

function scanBody(s, ctx) {
  const { raw, pushBlock, addPh } = ctx;
  let buf = "";
  let depth = 0; // brace depth inside buf
  const flush = () => { if (buf) { pushBlock(buf, "para"); buf = ""; depth = 0; } };
  const bufEmpty = () => !/\S/.test(buf.replace(PH_RE, "").replace(/[{}]/g, "")) && !/⟦/.test(buf);

  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "\\") {
      const [name, j] = readName(s, i);
      const base = name.replace(/\*$/, "");
      if (base === "begin" || base === "end") {
        const m = /^\s*\{([^}]*)\}/.exec(s.slice(j));
        if (!m) { buf += s.slice(i, j); i = j; continue; }
        const env = m[1].trim(), after = j + m[0].length;
        if (base === "end") { flush(); raw(s.slice(i, after)); i = after; continue; }
        const envBase = env.replace(/\*$/, "");
        if (PROTECT_ENVS.has(env) || PROTECT_ENVS.has(envBase)) {
          const end = findEnvEnd(s, i, env);
          const chunk = s.slice(i, end);
          if (MATH_ENVS.has(envBase)) buf += addPh(chunk);
          else { flush(); raw(chunk); }
          i = end; continue;
        }
        let k = after;
        while (s[k] === "[") { const e = matchGroup(s, k); if (e < 0) break; k = e; }
        k = captureArgs(s, k, ENV_ARGS[env] ?? 0);
        flush(); raw(s.slice(i, k)); i = k; continue;
      }
      if (HEADING_CMDS[base]) {
        let k = j;
        if (base === "captionof") { k = captureArgs(s, k, 1); }
        while (s[k] === " ") k++;
        while (s[k] === "[") { const e = matchGroup(s, k); if (e < 0) break; k = e; }
        while (s[k] === " " || s[k] === "\n") k++;
        if (s[k] === "{") {
          const e = matchGroup(s, k);
          if (e > 0) {
            if (base !== "caption" && base !== "subcaption" && base !== "captionof") flush();
            else if (!bufEmpty()) { buf += addPh(s.slice(i, e)); i = e; continue; }
            else flush();
            raw(s.slice(i, k + 1));
            pushBlock(scanInline(s.slice(k + 1, e - 1), addPh), HEADING_CMDS[base]);
            raw("}");
            i = e; continue;
          }
        }
        buf += addPh(s.slice(i, k)); i = k; continue;
      }
      if (base === "item") {
        flush();
        let k = j;
        if (s[k] === "[") { const e = matchGroup(s, k); if (e > 0) k = e; }
        raw(s.slice(i, k)); i = k; continue;
      }
      if (name === "verb" || name === "verb*") {
        const d = s[j]; const e = s.indexOf(d, j + 1); const end = e < 0 ? s.length : e + 1;
        buf += addPh(s.slice(i, end)); i = end; continue;
      }
      if (/^[A-Za-z@]/.test(name)) {
        if (INLINE_TEXT_CMDS.has(base)) { buf += "\\" + name; i = j; continue; }
        let e;
        if (DEF_CMDS.has(base)) {
          const m = /^\s*\\[A-Za-z@]+[^{]*/.exec(s.slice(j));
          e = m ? captureArgs(s, j + m[0].length, 1) : j;
        } else if (base === "let") {
          const m = /^\s*\\[A-Za-z@]+\s*=?\s*(\\[A-Za-z@]+|.)/.exec(s.slice(j));
          e = m ? j + m[0].length : j;
        } else {
          e = captureArgs(s, j, 9, /^(cite|ref|eqref|autoref|cref|Cref|label|url|href|includegraphics)/.test(base));
        }
        const cmd = s.slice(i, e);
        if (STRUCTURAL_CMDS.has(base) && bufEmpty()) { flush(); raw(cmd); }
        else buf += addPh(cmd);
        i = e; continue;
      }
      // control symbols
      if (name === "(") { const e = s.indexOf("\\)", j); const end = e < 0 ? s.length : e + 2; buf += addPh(s.slice(i, end)); i = end; continue; }
      if (name === "[") { const e = s.indexOf("\\]", j); const end = e < 0 ? s.length : e + 2; buf += addPh(s.slice(i, end)); i = end; continue; }
      if (name === "\\") { let k = j; if (s[k] === "*") k++; k = captureArgs(s, k, 1); buf += addPh(s.slice(i, k)); i = k; continue; }
      buf += s.slice(i, j); i = j; continue;
    }
    if (c === "$") {
      const dbl = s[i + 1] === "$";
      const e = findClosingDollar(s, i + (dbl ? 2 : 1), dbl);
      buf += addPh(s.slice(i, e)); i = e; continue;
    }
    if (c === "%") { const m = /^%[^\n]*\n?[ \t]*/.exec(s.slice(i)); i += m[0].length; continue; }
    if (c === "\n") {
      const m = /^\n[ \t]*\n\s*/.exec(s.slice(i));
      if (m) {
        if (depth > 0) { buf += " \\par "; }
        else { flush(); raw(m[0]); }
        i += m[0].length; continue;
      }
    }
    if (c === "{") depth++;
    if (c === "}") depth = Math.max(0, depth - 1);
    buf += c; i++;
  }
  flush();
}

/* ---------- sentences ---------- */
const ABBREV = new Set(["e.g", "i.e", "etc", "al", "fig", "figs", "eq", "eqs", "sec", "secs", "tab", "tabs", "ref",
  "refs", "cf", "vs", "resp", "approx", "dr", "prof", "mr", "ms", "mrs", "no", "nos", "vol", "pp", "ch", "thm", "lem",
  "def", "alg", "app", "w.r.t", "i.i.d", "a.k.a", "inc", "ltd", "st", "jr", "sr", "viz", "ca", "eqn", "eqns", "sect",
  "approx", "max", "min", "avg", "std", "dept", "univ", "e.g.,", "i.e.,", "cor", "prop", "defn", "rem", "ex"]);

export function splitSentences(text) {
  const out = [];
  let start = 0, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0 || !".?!".includes(c)) continue;
    let k = i + 1;
    while (k < text.length && /[)"'”’]/.test(text[k])) k++;
    const ws = /^\s+/.exec(text.slice(k));
    if (!ws) continue;
    const next = text[k + ws[0].length];
    if (next === undefined) continue;
    if (!/[\p{Lu}\\⟦(“"`\d[]/u.test(next)) continue;
    if (c === ".") {
      const before = text.slice(start, i);
      const word = (/([\p{L}.]+)$/u.exec(before) || ["", ""])[1].toLowerCase();
      if (ABBREV.has(word) || ABBREV.has(word.replace(/\.$/, ""))) continue;
      if (/(^|[\s(])\p{Lu}$/u.test(before)) continue; // initials: "J. Smith"
      if (/\bet al$/i.test(before)) continue;
    }
    const end = k;
    out.push({ text: text.slice(start, end), sep: ws[0] });
    start = end + ws[0].length;
    i = start - 1;
  }
  if (start < text.length) out.push({ text: text.slice(start), sep: "" });
  // merge fragments without letters into the previous sentence
  const merged = [];
  for (const p of out) {
    if (merged.length && !/\p{L}{2}/u.test(p.text.replace(PH_RE, ""))) {
      const prev = merged[merged.length - 1];
      prev.text += prev.sep + p.text; prev.sep = p.sep;
    } else merged.push({ ...p });
  }
  return merged.length ? merged : [{ text, sep: "" }];
}

/* ---------- placeholders ---------- */
/* Puts placeholder text back. A placeholder that ends in a control word and is followed
   directly by a letter gets "{}" so "\ours" + "là" cannot become "\oursla". */
export function restore(text, phs) {
  return text.replace(PH_RE, (m, n, off) => {
    const v = phs[+n];
    if (v === undefined) return "";
    const next = text[off + m.length];
    if (next && /\p{L}/u.test(next) && /\\[A-Za-z@]+$/.test(v)) return v + "{}";
    return v;
  });
}

/* ---------- top level ---------- */
/* files: { path: Uint8Array | string }. Returns the parsed doc (JSON-serialisable). */
export function parseProject(files, mainHint) {
  const texMap = {};
  for (const [p, v] of Object.entries(files)) if (/\.(tex|ltx)$/i.test(p)) texMap[p] = decodeText(v);
  const main = mainHint && texMap[mainHint] !== undefined ? mainHint : findMainTex(texMap);
  if (!main) throw new Error("No main .tex file found. The zip needs a .tex file with \\documentclass and \\begin{document}.");
  const flat = flatten(main, texMap);
  const { items, ph: phs } = segment(flat);
  const sents = [];
  items.forEach(it => { if (it.t === "blk") it.sents.forEach(s => sents.push({ id: s.id, en: s.en, kind: it.kind, blk: it.id })); });
  const titleBlk = items.find(it => it.t === "blk" && it.kind === "title");
  const title = titleBlk ? plainText(titleBlk.sents.map(s => s.en).join(" "), phs) : main.replace(/\.tex$/, "");
  const jobname = main.split("/").pop().replace(/\.(tex|ltx)$/i, "");
  const paths = Object.keys(files);
  const hasBbl = paths.some(p => normPath(p) === normPath(dirOf(main) + jobname + ".bbl"));
  const usesBib = /\\(bibliography|addbibresource)\s*\{/.test(flat);
  const usesBiblatex = /\\usepackage(\[[^\]]*\])?\{biblatex\}/.test(flat);
  const engine = /\\usepackage(\[[^\]]*\])?\{(fontspec|xeCJK|polyglossia|unicode-math|xltxtra)\}/.test(flat) ? "xelatex" : "pdflatex";
  const words = sents.reduce((n, s) => n + plainText(s.en, phs).split(/\s+/).filter(Boolean).length, 0);
  return {
    main, jobname, title: title || "Untitled paper", items, ph: phs, sents,
    stats: { sentences: sents.length, blocks: items.filter(i => i.t === "blk").length, words, chars: sents.reduce((n, s) => n + s.en.length, 0),
      figures: paths.filter(p => /\.(png|jpe?g|pdf|eps)$/i.test(p)).length, texFiles: Object.keys(texMap).length },
    bib: { hasBbl, usesBib, usesBiblatex, needBibtex: usesBib && !hasBbl && !usesBiblatex, needBiber: usesBiblatex && !hasBbl },
    engine
  };
}

/* Readable text for display: drops placeholders and LaTeX markup. */
export function plainText(s, phs) {
  return restore(s, phs || [])
    .replace(/\$[^$]*\$/g, "")
    .replace(/\\(?:emph|textbf|textit|textsc|textsl|underline|textrm|textsf|mbox)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\[A-Za-z@]+\*?(\[[^\]]*\])?(\{[^{}]*\})*/g, "")
    .replace(/\\(.)/g, "$1").replace(/[{}~]/g, " ").replace(/\s+/g, " ").trim();
}
