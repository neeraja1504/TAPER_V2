/* Compiling LaTeX to PDF.
 *
 *   local    POST to the TAPER helper (`python run.py`), which runs latexmk/XeLaTeX or Tectonic.
 *            Most reliable. Works from GitHub Pages too when the helper runs with --cors.
 *   browser  BusyTeX (TeX Live 2026 compiled to WebAssembly) in a Web Worker. No install, but the
 *            first compile downloads ~235 MB of TeX files (cached by the browser afterwards).
 *   auto     local if the helper answers, otherwise browser.
 */
import { LANGS } from "./langs.js";

export const BUSYTEX_LIB = "https://cdn.jsdelivr.net/npm/texlyre-busytex@1.4.1/dist/index.js";
export const COMPILE_DEFAULTS = {
  compileMode: "auto",
  localUrl: "",                       // "" = same server that serves the app
  busytexPath: "vendor/busytex",      // where the deploy workflow puts the BusyTeX assets
  busytexBundle: "recommended",       // preloaded bundle: "recommended" (~200 MB) or "basic" (~90 MB)
  remoteEndpoint: ""                  // optional TeX Live package server for BusyTeX (blank = off)
};

/* LaTeX packages that none of the BusyTeX bundles contain. They are served from tex/ and added
   to browser compiles only when a .tex file loads them. (LPPL / LGPL; copied unmodified from TeX Live.) */
const SUPPLEMENTS = {
  xeCJK: ["xeCJK.sty", "xeCJK.cfg", "ctexhook.sty"],
  algorithm: ["algorithm.sty"],
  algorithmic: ["algorithmic.sty"],
  algorithmicx: ["algorithmicx.sty"],
  algpseudocode: ["algpseudocode.sty", "algorithmicx.sty"],
  algcompatible: ["algcompatible.sty", "algorithmicx.sty"]
};
export function neededSupplements(files) {
  const dec = new TextDecoder();
  const pkgs = new Set();
  for (const [p, v] of Object.entries(files)) {
    if (!/\.(tex|sty|cls)$/i.test(p)) continue;
    const t = typeof v === "string" ? v : dec.decode(v);
    for (const m of t.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) m[1].split(",").forEach(n => pkgs.add(n.trim()));
  }
  const have = new Set(Object.keys(files).map(p => p.split("/").pop()));
  return [...new Set([...pkgs].flatMap(n => SUPPLEMENTS[n] || []))].filter(f => !have.has(f));
}

const b64 = bytes => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toBytes = v => typeof v === "string" ? new TextEncoder().encode(v) : v;

function helperBase(settings) {
  const u = (settings.localUrl || "").trim().replace(/\/+$/, "");
  return u || (typeof location !== "undefined" ? location.origin : "");
}

/* Returns the helper's info ({ engines }) or null if it is not reachable. */
export async function detectLocal(settings) {
  const base = helperBase(settings);
  if (!base || base.startsWith("file:")) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 1500);
  try {
    const r = await fetch(base + "/api/health", { signal: ac.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.taper ? j : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function compileLocal(base, { files, main, engine, signal }) {
  const payload = { main, engine, files: {} };
  for (const [p, v] of Object.entries(files)) payload.files[p] = b64(toBytes(v));
  const r = await fetch(base + "/api/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
  const j = await r.json().catch(() => ({ ok: false, error: `The helper returned ${r.status}.` }));
  if (!j.ok) { const e = new Error(j.error || "LaTeX compilation failed."); e.log = j.log || ""; throw e; }
  return { pdf: unb64(j.pdf), log: j.log || "", via: `local (${j.engine})` };
}

let runnerPromise = null;
async function getRunner(settings, onStatus) {
  if (!runnerPromise) {
    runnerPromise = (async () => {
      onStatus?.("Loading the in-browser TeX engine…");
      const mod = await import(/* @vite-ignore */ BUSYTEX_LIB);
      const base = new URL(settings.busytexPath || COMPILE_DEFAULTS.busytexPath, location.href).href.replace(/\/+$/, "");
      // Preload one bundle; the larger ones are fetched only if a paper needs a file from them.
      const basic = settings.busytexBundle === "basic";
      const runner = new mod.BusyTexRunner({
        busytexBasePath: base,
        preloadDataPackages: [`${base}/${basic ? "texlive-basic" : "texlive-recommended"}.js`],
        catalogDataPackages: (basic ? ["texlive-recommended", "texlive-extra"] : ["texlive-extra"]).map(b => `${base}/${b}.js`),
        onDownloadProgress: msg => { if (typeof msg === "string" && /download|%|MB/i.test(msg)) onStatus?.("Downloading TeX files (first time only): " + msg.slice(0, 80)); }
      });
      await runner.initialize(true);
      return { mod, runner };
    })().catch(e => { runnerPromise = null; throw e; });
  }
  return runnerPromise;
}

async function compileBrowser(settings, { files, main, engine, bib, onStatus }) {
  let mr;
  try { mr = await getRunner(settings, onStatus); }
  catch (e) {
    throw new Error(`The in-browser TeX engine could not start (${e.message}). On GitHub Pages it needs the BusyTeX files the deploy workflow installs; locally, run "python run.py" with a TeX installation or switch Compile to "local helper" in Settings.`);
  }
  const { mod, runner } = mr;
  onStatus?.("Compiling in the browser…");
  const tool = engine === "xelatex" ? new mod.XeLatex(runner) : new mod.PdfLatex(runner);
  const dec = new TextDecoder();
  const additionalFiles = Object.entries(files).filter(([p]) => p !== main).map(([path, v]) => ({ path, content: /\.(tex|bib|bbl|sty|cls|bst|cfg|def|clo|txt)$/i.test(path) && typeof v !== "string" ? dec.decode(v) : v }));
  const dir = main.includes("/") ? main.slice(0, main.lastIndexOf("/") + 1) : "";
  for (const f of neededSupplements(files)) {
    const r = await fetch(new URL("tex/" + f, location.href));
    if (r.ok) additionalFiles.push({ path: dir + f, content: await r.text() });
  }
  const input = typeof files[main] === "string" ? files[main] : dec.decode(files[main]);
  const res = await tool.compile({ input, mainTexPath: main, additionalFiles, bibtex: !!bib?.needBibtex, biber: !!bib?.needBiber, rerun: true, remoteEndpoint: settings.remoteEndpoint || undefined });
  if (!res.success || !res.pdf) { const e = new Error("LaTeX compilation failed in the browser."); e.log = res.log || ""; throw e; }
  return { pdf: res.pdf, log: res.log || "", via: "browser (BusyTeX)" };
}

/* files: { path: Uint8Array|string }, main: path of the main .tex, engine: "xelatex" | "pdflatex". */
export async function compileProject({ files, main, engine, bib, settings = {}, onStatus, signal }) {
  const S = { ...COMPILE_DEFAULTS, ...settings };
  if (S.compileMode !== "browser") {
    const info = await detectLocal(S);
    if (info && info.engines?.length) {
      onStatus?.(`Compiling with ${info.engines[0]} on this computer…`);
      return compileLocal(helperBase(S), { files, main, engine, signal });
    }
    if (S.compileMode === "local") {
      throw new Error(info ? "The local helper is running but found no LaTeX installation. Install MacTeX/TeX Live or Tectonic (see Help → Compiling)." : `The local helper is not reachable at ${helperBase(S)}. Start it with "python run.py" (add --cors when using the GitHub Pages site).`);
    }
  }
  return compileBrowser(S, { files, main, engine, bib, onStatus });
}

/* Font files for a language, cached with the Cache API so they download once. */
export async function fetchFonts(langCode, onStatus) {
  const out = {};
  const list = LANGS[langCode]?.fonts || [];
  if (!list.length) return out;
  let cache = null;
  try { cache = await caches.open("taper-fonts-v1"); } catch { /* no Cache API (file:// or private mode) */ }
  for (const f of list) {
    let res = cache ? await cache.match(f.url) : null;
    if (!res) {
      onStatus?.(`Downloading font ${f.file}…`);
      res = await fetch(f.url);
      if (!res.ok) throw new Error(`Could not download the font ${f.file} (${res.status}).`);
      if (cache) await cache.put(f.url, res.clone());
    }
    out[f.file] = new Uint8Array(await res.arrayBuffer());
  }
  return out;
}

/* Short, readable summary of a TeX log: the first error with a little context. */
export function summarizeLog(log) {
  if (!log) return "";
  const lines = log.split("\n");
  const i = lines.findIndex(l => /^! |^.*:\d+: |Fatal error|error:/i.test(l));
  if (i < 0) return lines.slice(-12).join("\n");
  return lines.slice(Math.max(0, i - 2), i + 8).join("\n");
}
