/* TAPER app: wires the UI to the parser, pipeline, compiler, viewer and storage. */
import { parseProject, findMainTex, decodeText, plainText, stripComments } from "./latex.js";
import { assembleTex, buildProjectFiles, buildTermIndex, termsInEnglish, englishOnlyTex, xetexCompat } from "./assemble.js";
import { LANGS, langLabel } from "./langs.js";
import { LEVELS, TERM_MODES, levelKey, levelName, clampLevel, defaultPlan, normalizePlan, currentWeek, planLevel } from "./levels.js";
import { PROVIDERS, callLLM, listModels } from "./providers.js";
import { runPipeline, newTranslation, estimate } from "./pipeline.js";
import * as P from "./prompts.js";
import { compileProject, fetchFonts, detectLocal, summarizeLog, COMPILE_DEFAULTS } from "./compile.js";
import { db, local, sha256, deletePaper, deleteTranslation, storageEstimate } from "./store.js";
import { PdfView } from "./viewer.js";
import { TOPICS, TAB_TOPIC } from "./help.js";
import { SAMPLE, sampleTranslation, samplePdfUrl } from "./sample.js";

const $ = id => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
const slug = s => (s || "paper").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "paper";
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg, ms = 2600) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function saveFile(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function likert(el, name, low, high) {
  el.replaceChildren();
  for (let i = 1; i <= 5; i++) el.append(h("label", {}, h("input", { type: "radio", name, value: i }), h("span", {}, i === 1 ? `1 · ${low}` : i === 5 ? `5 · ${high}` : String(i))));
}
const picked = name => { const r = document.querySelector(`input[name="${name}"]:checked`); return r ? r.value : null; };

/* ======================= settings, keys, profiles ======================= */
const DEFAULT_SETTINGS = {
  translator: { provider: "anthropic", model: "claude-opus-5-5" },
  verifier: { provider: "anthropic", model: "claude-opus-5-5" },
  effort: "medium", maxRetries: 2, batchChars: 4500, concurrency: 2, customBase: "",
  rememberKeys: false, colorTerms: true, keepPaperFont: true, ...COMPILE_DEFAULTS
};
let settings = { ...DEFAULT_SETTINGS, ...local.get("settings", {}) };
const saveSettings = () => local.set("settings", settings);
const sessionKeys = { get() { try { return JSON.parse(sessionStorage.getItem("taper2:keys") || "{}"); } catch { return {}; } }, set(v) { try { sessionStorage.setItem("taper2:keys", JSON.stringify(v)); } catch { /* blocked */ } } };
let keys = settings.rememberKeys ? local.get("keys", {}) : sessionKeys.get();
function saveKeys() {
  if (settings.rememberKeys) { local.set("keys", keys); sessionKeys.set({}); }
  else { sessionKeys.set(keys); local.del("keys"); }
}
const cfgFor = role => ({ ...settings[role], apiKey: keys[settings[role].provider] || "", baseUrl: settings.customBase || PROVIDERS.custom.baseUrl, effort: settings.effort });
function configProblem(needVerifier = true) {
  for (const role of needVerifier ? ["translator", "verifier"] : ["translator"]) {
    const c = cfgFor(role);
    if (!c.model) return `Choose a ${role} model in Settings.`;
    if (c.provider !== "custom" && !c.apiKey) return `Add your ${PROVIDERS[c.provider].label} API key in Settings (used by the ${role}).`;
  }
  return null;
}

function newProfile(name = "Reader 1") {
  return { id: "u" + Date.now().toString(36), name, lang: "vi", field: "", englishLevel: 3, startDate: today(), weeks: 12, papersPerWeek: 1, notes: "", weekOverride: null, plan: defaultPlan(12), checkins: [] };
}
let profiles = local.get("profiles", []);
if (!profiles.length) { profiles = [newProfile()]; local.set("profiles", profiles); }
let activeId = local.get("activeProfile", profiles[0].id);
const profile = () => profiles.find(p => p.id === activeId) || profiles[0];
const saveProfiles = () => { local.set("profiles", profiles); local.set("activeProfile", activeId); };

/* ======================= study log ======================= */
let log = local.get("log", []);
const COLS = ["time", "profile", "week", "type", "paper", "lang", "level", "nativePct", "view", "detail"];
function logEvent(type, detail = {}, extra = {}) {
  const p = profile();
  log.push({ time: new Date().toISOString(), profile: p.name, week: currentWeek(p), type,
    paper: extra.paper ?? (rd.paperId ? rd.paperId.slice(0, 10) : ""), lang: extra.lang ?? rd.lang ?? "",
    level: extra.level ?? (rd.level ? levelKey(rd.level) : ""), nativePct: extra.nativePct ?? rd.nativePct ?? "", view: extra.view ?? rd.view ?? "", detail });
  local.set("log", log);
  $("logCount").textContent = log.length;
  if (state.tab === "data") renderData();
}

/* ======================= tabs, help ======================= */
const state = { tab: "library", running: null };
const TABS = ["library", "new", "reader", "plan", "settings", "data", "help"];
function showTab(tab, { push = true } = {}) {
  if (!TABS.includes(tab)) tab = "library";
  if (state.tab === "reader" && tab !== "reader") closeReading();
  state.tab = tab;
  document.body.dataset.tab = tab;
  if (tab !== "reader") setSlim(false);
  closePopovers();
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  TABS.forEach(t => { $("view-" + t).hidden = t !== tab; });
  if (push && location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  closePop();
  if (tab === "library") renderLibrary();
  if (tab === "data") renderData();
  if (tab === "plan") renderPlanTab();
  if (tab === "settings") renderSettings();
  if (tab === "new") {
    if (!pend.langTouched) $("newLang").value = profile().lang; // follow the plan until the reader picks another language here
    if (!pend.doc && !pend.loading) loadDefaultSample(); else updateNew();
  }
  if (tab === "reader" && rd.paperId) startReading();
  if (tab === "reader" && !rd.paperId && !state.openingSample) { state.openingSample = true; openSample().finally(() => { state.openingSample = false; }); }
}
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
document.addEventListener("click", e => {
  const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); showTab(g.dataset.goto); }
  const hb = e.target.closest("[data-help]"); if (hb) openHelp(hb.dataset.help);
});
addEventListener("hashchange", () => { const t = location.hash.slice(1); if (TABS.includes(t)) { $("helpDrawer").hidden = true; showTab(t, { push: false }); } });

function renderHelpPage() {
  $("helpToc").replaceChildren(...TOPICS.map(t => h("button", { "data-topic": t.id, onclick: () => { document.getElementById("help-" + t.id).scrollIntoView({ behavior: "smooth" }); markToc(t.id); } }, t.title)));
  $("helpContent").replaceChildren(...TOPICS.map(t => h("article", { id: "help-" + t.id }, h("h3", {}, t.title), h("div", { html: t.html }))));
}
const markToc = id => document.querySelectorAll("#helpToc button").forEach(b => b.setAttribute("aria-current", b.dataset.topic === id));
function openHelp(id) {
  const t = TOPICS.find(x => x.id === id) || TOPICS[0];
  $("helpDrawerTitle").textContent = t.title;
  $("helpDrawerBody").innerHTML = t.html;
  $("helpDrawer").hidden = false;
  $("helpDrawer").dataset.topic = t.id;
  $("helpClose").focus();
  logEvent("help", { topic: t.id });
}
$("headerHelp").onclick = () => openHelp(TAB_TOPIC[state.tab] || "start");
$("helpClose").onclick = () => { $("helpDrawer").hidden = true; };
$("helpMore").onclick = () => { const id = $("helpDrawer").dataset.topic; $("helpDrawer").hidden = true; showTab("help"); setTimeout(() => { document.getElementById("help-" + id)?.scrollIntoView(); markToc(id); }, 50); };
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const open = document.querySelector("details.popover[open]");
  if (open) { closePopovers(); open.querySelector("summary").focus(); return; }
  if (!$("helpDrawer").hidden || !$("termPop").hidden) { $("helpDrawer").hidden = true; closePop(); return; }
  if (document.body.classList.contains("rd-slim")) setSlim(false);
});

/* Popovers (<details class="popover">): kept inside the window, closed by Esc or a click elsewhere. */
function placePopover(d) {
  const body = d.querySelector(".pop-body"); if (!body) return;
  body.style.left = "0px"; body.style.maxHeight = "";
  const r = body.getBoundingClientRect(), pad = 8;
  let shift = 0;
  if (r.right > innerWidth - pad) shift = innerWidth - pad - r.right;
  if (r.left + shift < pad) shift = pad - r.left;
  body.style.left = shift + "px";
  body.style.maxHeight = Math.max(120, innerHeight - r.top - pad) + "px";
}
function closePopovers(except) { document.querySelectorAll("details.popover[open]").forEach(d => { if (d !== except) d.open = false; }); }
document.querySelectorAll("details.popover").forEach(d => d.addEventListener("toggle", () => { if (d.open) { closePopovers(d); placePopover(d); } }));
document.addEventListener("click", e => { closePopovers(e.target.closest("details.popover")); });
addEventListener("resize", () => document.querySelectorAll("details.popover[open]").forEach(placePopover));

/* ======================= header ======================= */
function renderHeader() {
  const sel = $("profileSel"); sel.replaceChildren();
  profiles.forEach(p => sel.add(new Option(p.name, p.id)));
  sel.add(new Option("New reader…", "__new"));
  sel.value = profile().id;
  const p = profile(), w = currentWeek(p), l = planLevel(p, w);
  $("weekBadge").textContent = `My plan: week ${w} of ${p.weeks}`;
  $("weekBadge").title = `${LANGS[p.lang].name}. This week's reading level: ${levelName(l)}. Click to open My plan.`;
  renderPlanStrips();
}
/* The same summary of the plan on every page that depends on it, so the link to My plan is always visible. */
const STRIP_TEXT = {
  library: (lang, lvl) => `Papers open in ${lang} when they have been translated into it, at this week's level.`,
  new: (lang, lvl) => `New papers are translated into ${lang}, then open in Read at this week's level.`
};
function renderPlanStrips() {
  const p = profile(), w = currentWeek(p), l = planLevel(p, w), lang = LANGS[p.lang].name;
  document.querySelectorAll("[data-plan-strip]").forEach(el => el.replaceChildren(
    h("span", { class: "label" }, "From my plan"),
    h("span", { class: "strip-main" }, h("b", {}, `${p.name} · ${lang} · week ${w} of ${p.weeks}`), ` · this week's level: `, h("b", {}, levelName(l))),
    h("span", { class: "strip-why" }, STRIP_TEXT[el.dataset.planStrip](lang, l)),
    h("button", { class: "btn small", "data-goto": "plan" }, "Change my plan")));
  $("planUseNow").textContent = `Right now: ${lang}, week ${w} of ${p.weeks}, reading level "${levelName(l)}".`;
}
$("profileSel").onchange = e => {
  if (e.target.value === "__new") { addProfile(); return; }
  activeId = e.target.value; saveProfiles(); renderHeader(); logEvent("profile", { switchedTo: profile().name });
  if (state.tab === "plan") renderPlanTab();
  if (state.tab === "library") renderLibrary();
  if (state.tab === "new") { pend.langTouched = false; $("newLang").value = profile().lang; updateNew(); }
  if (state.tab === "reader" && rd.paperId) renderLevelControls();
};
function addProfile() {
  const name = prompt("Name or participant ID for the new reader:", `Reader ${profiles.length + 1}`);
  if (!name) { renderHeader(); return; }
  const p = newProfile(name.trim()); p.lang = profile().lang;
  profiles.push(p); activeId = p.id; saveProfiles(); renderHeader();
  showTab("plan");
}

/* ======================= zip handling ======================= */
async function readZip(data) {
  if (typeof JSZip === "undefined") throw new Error("The zip library did not load. Check your internet connection and reload.");
  const zip = await JSZip.loadAsync(data);
  const files = {};
  const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store|\._)/.test(f.name));
  for (const f of entries) files[f.name] = await f.async("uint8array");
  const paths = Object.keys(files);
  if (paths.length) {
    const first = paths[0].split("/")[0] + "/";
    if (paths.every(p => p.startsWith(first) && p.includes("/"))) {
      const out = {}; for (const [p, v] of Object.entries(files)) out[p.slice(first.length)] = v; return out;
    }
  }
  return files;
}
async function zipFiles(files) {
  const z = new JSZip();
  for (const [p, v] of Object.entries(files)) z.file(p, v);
  return z.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/* ======================= the bundled sample paper ======================= */
/* Adds the pre-translated sample paper to the library (once per sample version). */
async function ensureSample(force = false) {
  const seedKey = `${SAMPLE.version}#${SAMPLE.rev}`;
  if (!force && local.get("sampleSeeded", null) === seedKey) return local.get("samplePaperId", null);
  try {
    const r = await fetch(SAMPLE.zip);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const id = (await sha256(bytes)).slice(0, 16);
    const doc = parseProject(await readZip(bytes));
    const paper = (await db.get("papers", id)) || { id, title: doc.title, main: doc.main, doc, zip: new Blob([bytes], { type: "application/zip" }), originalPdf: null, createdAt: new Date().toISOString() };
    paper.sample = true;
    if (!paper.originalPdf) {
      const o = await fetch(SAMPLE.pdfs + "original.pdf");
      if (o.ok) paper.originalPdf = new Blob([await o.arrayBuffer()], { type: "application/pdf" });
    }
    await db.put("papers", paper);
    const defs = (await (await fetch(SAMPLE.translations + "terms.json")).json()).terms;
    for (const lang of SAMPLE.langs) {
      const have = await db.get("translations", `${id}|${lang}`);
      if (have && !have.bundled) continue; // never replace a translation the reader made; do refresh the bundled one
      const t = await fetch(`${SAMPLE.translations}${lang}.json`);
      if (t.ok) await db.put("translations", sampleTranslation(doc, id, await t.json(), defs));
    }
    local.set("sampleSeeded", seedKey); local.set("samplePaperId", id);
    return id;
  } catch (e) { console.warn("[TAPER] could not add the sample paper:", e); return null; }
}
async function openSample(lang) {
  const id = await ensureSample();
  if (!id) { toast("The sample paper is not available here."); return; }
  const want = lang || profile().lang;
  openReader(id, (await db.get("translations", `${id}|${want}`)) ? want : SAMPLE.langs[0]);
}
$("openSample").onclick = () => openSample();
$("restoreSample").onclick = async () => { await ensureSample(true); renderLibrary(); toast("The sample paper is back in your library."); };

/* ======================= library ======================= */
async function renderLibrary() {
  const [papers, trs, renderKeys] = await Promise.all([db.all("papers"), db.all("translations"), db.keys("renders")]);
  const q = $("libSearch").value.trim().toLowerCase();
  const list = $("libList"); list.replaceChildren();
  const byPaper = new Map(papers.map(p => [p.id, { paper: p, trs: [] }]));
  trs.forEach(t => byPaper.get(t.paperId)?.trs.push(t));
  const rows = [...byPaper.values()].filter(r => !q || r.paper.title.toLowerCase().includes(q))
    .sort((a, b) => (Math.max(...b.trs.map(t => Date.parse(t.updatedAt || t.createdAt) || 0), Date.parse(b.paper.createdAt))) - (Math.max(...a.trs.map(t => Date.parse(t.updatedAt || t.createdAt) || 0), Date.parse(a.paper.createdAt))));
  $("libEmpty").hidden = rows.length > 0 || !!q;
  $("welcome").hidden = papers.some(p => !p.sample);
  $("sampleRestore").hidden = papers.some(p => p.sample);
  for (const { paper, trs: ts } of rows) {
    ts.sort((a, b) => (LANGS[a.lang]?.name || a.lang).localeCompare(LANGS[b.lang]?.name || b.lang));
    // Picking a language opens the paper in that language (or resumes an unfinished translation).
    const pick = h("select", { class: "lib-pick", "aria-label": `Read "${paper.title}" in`,
      onchange: e => {
        const t = ts.find(x => x.lang === e.target.value);
        e.target.value = "";
        if (!t) return;
        logEvent("library-open", { lang: t.lang }, { paper: paper.id.slice(0, 10), lang: t.lang });
        if (t.status === "complete") openReader(paper.id, t.lang); else loadPaperIntoNew(paper, t.lang);
      } },
      h("option", { value: "" }, ts.length ? `Choose a language (${ts.length})…` : "No translations yet"),
      ...ts.map(t => h("option", { value: t.lang }, langLabel(t.lang) + (t.status === "complete" ? "" : " (unfinished: resume)"))));
    const mine = ts.find(t => t.lang === profile().lang && t.status === "complete");
    const langs = h("div", { class: "langs" });
    for (const t of ts) {
      const nRenders = renderKeys.filter(k => k.startsWith(`${t.id}|`)).length;
      const r = t.report;
      const pill = t.status === "complete" ? (r && (r.flagged || r.fallback) ? h("span", { class: "pill warn" }, `${r.flagged + r.fallback} to review`) : h("span", { class: "pill ok" }, "verified"))
        : h("span", { class: "pill warn" }, t.status === "running" ? "incomplete" : t.status);
      langs.append(h("div", { class: "lib-lang" },
        h("div", { class: "top" }, h("strong", {}, langLabel(t.lang)), pill),
        t.bundled ? h("span", { class: "meta" }, `Included with TAPER: pre-translated, no credits · ${nRenders} level${nRenders === 1 ? "" : "s"} opened`)
          : [h("span", { class: "meta" }, `${t.translator.model} → checked by ${t.verifier.model}`),
             h("span", { class: "meta" }, `${fmtN(t.usage.input)} in / ${fmtN(t.usage.output)} out tokens · ${t.usage.calls} calls · ${nRenders} level${nRenders === 1 ? "" : "s"} compiled`)],
        h("div", { class: "row" },
          t.status === "complete" ? h("button", { class: "btn small primary", onclick: () => openReader(paper.id, t.lang) }, `Read in ${LANGS[t.lang]?.name || t.lang}`) : h("button", { class: "btn small primary", onclick: () => loadPaperIntoNew(paper, t.lang) }, "Resume translating"),
          h("button", { class: "btn small danger", onclick: async () => { if (confirm(`Delete the ${LANGS[t.lang]?.name || t.lang} translation of "${paper.title}"? This cannot be undone.`)) { await deleteTranslation(t.id); if (rd.paperId === paper.id && rd.lang === t.lang) clearReader(); renderLibrary(); } } }, "Delete this translation"))));
    }
    list.append(h("article", { class: "lib-card" },
      h("h3", {}, paper.title, paper.sample ? h("span", { class: "pill ok", style: "margin-left:8px;vertical-align:2px" }, "sample") : null),
      h("span", { class: "meta" }, `${paper.doc.stats.sentences} sentences · ${paper.doc.stats.words} words · added ${new Date(paper.createdAt).toLocaleDateString()}`),
      h("div", { class: "lib-open" },
        mine ? h("button", { class: "btn primary", onclick: () => openReader(paper.id, mine.lang) }, `Read in ${LANGS[mine.lang].name} (my plan's language)`) : null,
        h("label", { class: "field" }, h("span", { class: "label" }, mine ? "Or read it in another language" : "Read it in"), pick)),
      ts.length ? h("details", { class: "lib-details" }, h("summary", {}, `Translation details (${ts.length})`), langs) : null,
      h("div", { class: "row" },
        h("button", { class: "btn small", onclick: () => loadPaperIntoNew(paper) }, "Translate into another language"),
        h("button", { class: "btn small danger", onclick: async () => { if (confirm(`Delete "${paper.title}" and all its translations?`)) { await deletePaper(paper.id); if (rd.paperId === paper.id) clearReader(); renderLibrary(); } } }, "Delete paper and its translations"))));
  }
  const est = await storageEstimate();
  $("storageInfo").textContent = est ? `Using ${fmtN(est.used / 1024 / 1024 | 0)} MB of browser storage` : "";
}
$("libSearch").oninput = () => renderLibrary();

$("libExport").onclick = async () => {
  const [papers, trs, quizzes] = await Promise.all([db.all("papers"), db.all("translations"), db.all("quizzes")]);
  if (!papers.length) { toast("The library is empty."); return; }
  toast("Preparing the export…");
  const z = new JSZip();
  z.file("library.json", JSON.stringify({ app: "taper", version: 2, exported: new Date().toISOString(), papers: papers.map(({ zip, originalPdf, ...m }) => m), translations: trs, quizzes }, null, 1));
  for (const p of papers) {
    z.file(`papers/${p.id}.zip`, p.zip);
    if (p.originalPdf) z.file(`originals/${p.id}.pdf`, p.originalPdf);
  }
  saveFile(`taper-library-${stamp()}.zip`, await z.generateAsync({ type: "blob" }));
  logEvent("library-export", { papers: papers.length, translations: trs.length });
};
$("libImport").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const z = await JSZip.loadAsync(f);
    const meta = JSON.parse(await z.file("library.json").async("string"));
    if (meta.app !== "taper") throw new Error("This is not a TAPER library export.");
    let np = 0, nt = 0;
    for (const p of meta.papers) {
      const zf = z.file(`papers/${p.id}.zip`); if (!zf) continue;
      if (await db.get("papers", p.id)) continue;
      const of = z.file(`originals/${p.id}.pdf`);
      await db.put("papers", { ...p, zip: new Blob([await zf.async("uint8array")], { type: "application/zip" }), originalPdf: of ? new Blob([await of.async("uint8array")], { type: "application/pdf" }) : null });
      np++;
    }
    for (const t of meta.translations) {
      const cur = await db.get("translations", t.id);
      if (cur && cur.status === "complete" && t.status !== "complete") continue;
      if (cur && Date.parse(cur.updatedAt) >= Date.parse(t.updatedAt)) continue;
      await db.put("translations", t); nt++;
    }
    for (const q of meta.quizzes || []) if (!(await db.get("quizzes", q.id))) await db.put("quizzes", q);
    toast(`Imported ${np} paper${np === 1 ? "" : "s"} and ${nt} translation${nt === 1 ? "" : "s"}.`);
    renderLibrary();
  } catch (err) { toast("Import failed: " + err.message, 5000); }
};

/* ======================= translate (new) ======================= */
const pend = { files: null, zipBytes: null, hash: null, doc: null, mains: [], origPdf: null, fromLibrary: null };
function fillLangSelect(sel, value) {
  sel.replaceChildren(...Object.keys(LANGS).map(k => new Option(langLabel(k), k)));
  sel.value = value && LANGS[value] ? value : "vi";
}

async function handleZip(file) {
  const st = $("zipStatus");
  st.className = "status"; st.textContent = `Reading ${file.name}…`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const files = await readZip(bytes);
    const paths = Object.keys(files);
    if (paths.some(p => /\.(tar\.gz|tgz|tar)$/i.test(p)) && !paths.some(p => /\.tex$/i.test(p))) throw new Error("The zip contains a .tar.gz archive. Unpack it first, then zip the folder.");
    const texMap = {}; for (const p of paths) if (/\.tex$/i.test(p)) texMap[p] = decodeText(files[p]);
    pend.mains = Object.entries(texMap).filter(([, t]) => { const s = stripComments(t); return /\\documentclass/.test(s) && /\\begin\s*\{document\}/.test(s); }).map(([p]) => p);
    Object.assign(pend, { files, zipBytes: bytes, hash: (await sha256(bytes)).slice(0, 16), origPdf: null, fromLibrary: null });
    parsePending(findMainTex(texMap));
    st.textContent = `Loaded ${file.name} (${paths.length} files).`;
    logEvent("paper-loaded", { file: file.name, files: paths.length, sentences: pend.doc?.stats.sentences }, { paper: pend.hash.slice(0, 10) });
  } catch (e) {
    st.className = "status bad"; st.textContent = e.message;
    pend.doc = null; $("paperInfo").hidden = true; updateNew();
  }
}
function parsePending(main) {
  try {
    pend.doc = parseProject(pend.files, main);
  } catch (e) {
    pend.doc = null; $("zipStatus").className = "status bad"; $("zipStatus").textContent = e.message; $("paperInfo").hidden = true; updateNew(); return;
  }
  const d = pend.doc;
  $("paperInfo").hidden = false;
  const facts = [["Title", d.title], ["Main file", d.main], ["Text", `${d.stats.sentences} sentences, ${d.stats.words} words, ${d.stats.blocks} paragraphs/headings`], ["Files", `${d.stats.texFiles} .tex, ${d.stats.figures} figures`],
    ["Bibliography", d.bib.hasBbl ? "compiled .bbl included" : d.bib.usesBib ? (d.bib.usesBiblatex ? "BibLaTeX (.bib) – needs biber" : "BibTeX .bib – will run bibtex") : "none"], ["Original engine", d.engine]];
  $("paperFacts").replaceChildren(...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
  $("mainRow").hidden = pend.mains.length < 2;
  if (pend.mains.length > 1) { $("mainSel").replaceChildren(...pend.mains.map(p => new Option(p, p))); $("mainSel").value = d.main; }
  const warn = [];
  if (!d.stats.sentences) warn.push("No prose was found to translate.");
  if (Object.keys(pend.files).some(p => /\.eps$/i.test(p))) warn.push("EPS figures can't be compiled in the browser. Use the local helper, or convert them to PDF.");
  if (d.bib.needBiber) warn.push("BibLaTeX without a .bbl needs biber; the in-browser compiler may fail. The local helper (latexmk) handles it.");
  if (d.stats.sentences > 1500) warn.push(`This is a long document (${d.stats.sentences} sentences): translation will take many calls.`);
  $("paperWarn").replaceChildren(...warn.map(w => h("li", {}, w)));
  updateNew();
}
$("mainSel").onchange = e => parsePending(e.target.value);
$("zipInput").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) handleZip(f); };
const drop = $("drop");
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) handleZip(f); });
async function loadDefaultSample() {
  pend.loading = true;
  try {
    const r = await fetch(SAMPLE.zip);
    if (r.ok) { await handleZip(new File([await r.blob()], "sample-paper.zip")); $("zipStatus").textContent = "The sample paper is selected (already translated: open it for free). Upload your own .zip to translate a different paper."; }
  } catch { /* offline or file:// */ }
  pend.loading = false; updateNew();
}
$("useSample").onclick = async () => {
  try {
    const r = await fetch("sample/sample-paper.zip");
    if (!r.ok) throw new Error("The sample is missing (sample/sample-paper.zip).");
    handleZip(new File([await r.blob()], "sample-paper.zip"));
  } catch (e) { $("zipStatus").className = "status bad"; $("zipStatus").textContent = e.message; }
};
$("origPdfInput").onchange = e => { pend.origPdf = e.target.files[0] || null; };
$("newLang").onchange = () => { pend.langTouched = true; updateNew(); };
$("newVerify").onchange = () => updateNew();

async function loadPaperIntoNew(paper, lang) {
  Object.assign(pend, { files: await readZip(paper.zip), zipBytes: null, hash: paper.id, origPdf: null, fromLibrary: paper, mains: [] });
  pend.doc = paper.doc;
  showTab("new");
  if (lang) $("newLang").value = lang;
  $("zipStatus").className = "status"; $("zipStatus").textContent = `From your library: ${paper.title}`;
  parsePending(paper.doc.main);
}

async function updateNew() {
  const tr = cfgFor("translator"), vr = cfgFor("verifier");
  const verify = $("newVerify").checked;
  $("modelSummary").replaceChildren(
    "Translator: ", h("strong", {}, `${PROVIDERS[tr.provider].label} · ${tr.model || "no model chosen"}`),
    ...(verify ? [" · Verifier: ", h("strong", {}, `${PROVIDERS[vr.provider].label} · ${vr.model || "no model chosen"}`)] : [" · no verification"]),
    " ", h("button", { class: "link", "data-goto": "settings" }, "Change models in Settings"));
  {
    const p = profile(), w = currentWeek(p), planLang = LANGS[p.lang].name, chosen = $("newLang").value;
    const note = $("planLangNote");
    if (chosen === p.lang) note.replaceChildren(`${planLang} is the language in your plan. `, h("button", { class: "link", "data-goto": "plan" }, "Change it in My plan"));
    else note.replaceChildren(`Your plan's language is ${planLang}; this paper will be translated into ${LANGS[chosen].name} instead. `,
      h("button", { class: "link", onclick: () => { pend.langTouched = false; $("newLang").value = p.lang; updateNew(); } }, `Use ${planLang}`));
    $("newAfter").replaceChildren(`When it is finished the paper opens in Read at your plan's level for week ${w}: `, h("b", {}, levelName(planLevel(p, w))), ". Changing the level later is free.");
  }
  const problem = configProblem(verify);
  const running = !!state.running;
  $("startBtn").disabled = !pend.doc || !pend.doc.stats.sentences || running || !!problem;
  $("dupNote").className = "status"; $("dupNote").replaceChildren();
  if (!pend.doc) { $("estimate").textContent = ""; return; }
  if (problem) { $("dupNote").className = "status bad"; $("dupNote").append(problem); }
  const e = estimate(pend.doc, { batchChars: settings.batchChars, verify });
  $("estimate").textContent = `Estimate: about ${e.calls} model calls · translator ≈ ${fmtN(e.translator.input)} input + ${fmtN(e.translator.output)} output tokens` +
    (verify ? ` · verifier ≈ ${fmtN(e.verifier.input)} + ${fmtN(e.verifier.output)}` : "") + ". Retries add a little more.";
  const lang = $("newLang").value;
  const existing = await db.get("translations", `${pend.hash}|${lang}`);
  $("startBtn").textContent = existing && existing.status !== "complete" ? "Resume translating" : "Start translating";
  if (existing && existing.status === "complete") {
    $("startBtn").disabled = true;
    $("dupNote").className = "status ok";
    $("dupNote").replaceChildren(`Already in your library in ${LANGS[lang].name}. `, h("button", { class: "link", onclick: () => openReader(pend.hash, lang) }, "Read it now (no credits)"));
  } else if (existing) {
    $("dupNote").append(` A partial translation exists; Resume continues it (${Object.keys(existing.sents || {}).length} of ${pend.doc.stats.sentences} sentences done).`);
  }
}

$("startBtn").onclick = async () => {
  const lang = $("newLang").value, verify = $("newVerify").checked;
  const problem = configProblem(verify);
  if (problem) { toast(problem, 4000); return; }
  const doc = pend.doc, paperId = pend.hash;
  let paper = await db.get("papers", paperId);
  if (!paper) {
    paper = { id: paperId, title: doc.title, main: doc.main, doc, zip: new Blob([pend.zipBytes], { type: "application/zip" }), originalPdf: null, createdAt: new Date().toISOString() };
  }
  if (pend.origPdf) paper.originalPdf = pend.origPdf;
  if (paper.doc.main !== doc.main) paper.doc = doc;
  await db.put("papers", paper);
  const translator = cfgFor("translator"), verifier = verify ? cfgFor("verifier") : cfgFor("translator");
  let tr = await db.get("translations", `${paperId}|${lang}`);
  if (!tr || tr.status === "complete") tr = newTranslation(doc, paperId, lang, translator, verify ? verifier : { provider: "-", model: "none" });
  const ac = new AbortController();
  state.running = { ac, paperId, lang };
  $("cancelBtn").hidden = false; $("startBtn").disabled = true; $("progressCard").hidden = false; $("progLog").textContent = "";
  document.querySelectorAll("#stageList li").forEach(li => li.className = "");
  const addLog = m => { $("progLog").textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; };
  addLog(`Starting: ${doc.title} → ${LANGS[lang].name}`);
  logEvent("translate-start", { translator: translator.model, verifier: verify ? verifier.model : null, sentences: doc.stats.sentences }, { paper: paperId.slice(0, 10), lang });
  const order = ["glossary", "glossary-check", "translate", "verify", "done"];
  let lastStage = "";
  try {
    await runPipeline({
      doc, tr, translator, verifier,
      settings: { maxRetries: +settings.maxRetries, batchChars: +settings.batchChars, concurrency: +settings.concurrency, verify },
      signal: ac.signal,
      onSave: t => db.put("translations", t),
      onProgress: p => {
        const i = order.indexOf(p.stage);
        document.querySelectorAll("#stageList li").forEach(li => { const j = order.indexOf(li.dataset.stage); li.className = j < i ? "done" : j === i ? (p.stage === "done" ? "done" : "active") : ""; });
        $("progBar").style.width = (p.total ? 100 * p.done / p.total : 0) + "%";
        $("progText").textContent = `${p.message}${p.total > 1 ? ` (${p.done}/${p.total})` : ""} · ${fmtN(tr.usage.input)} in / ${fmtN(tr.usage.output)} out tokens so far`;
        if (p.message !== lastStage) { addLog(p.message); lastStage = p.message; }
      }
    });
    const r = tr.report;
    addLog(`Finished: ${r.terms} terms, ${r.ok + r.fixed} sentences verified, ${r.flagged} flagged, ${r.fallback} left in English.`);
    logEvent("translate-done", { usage: tr.usage, report: { terms: r.terms, ok: r.ok, fixed: r.fixed, flagged: r.flagged, fallback: r.fallback } }, { paper: paperId.slice(0, 10), lang });
    toast("Translation finished. Opening the reader…");
    state.running = null;
    openReader(paperId, lang);
  } catch (e) {
    const msg = e.name === "AbortError" ? "Stopped. Your progress is saved; press Resume translating to continue." : `Stopped: ${e.message}. Progress so far is saved; press Resume translating to continue.`;
    addLog(msg); $("progText").textContent = msg; $("progText").className = e.name === "AbortError" ? "status" : "status bad";
    logEvent("translate-stopped", { error: e.message }, { paper: paperId.slice(0, 10), lang });
  } finally {
    state.running = null; $("cancelBtn").hidden = true; updateNew();
  }
};
$("cancelBtn").onclick = () => state.running?.ac.abort();

/* ======================= reader ======================= */
const rd = { paperId: null, lang: null, paper: null, tr: null, doc: null, files: null, level: null, view: "split", nativePct: null, pdf: null, seq: 0, idx: null, readStart: null };
let viewTr, viewOrig;
function viewers() {
  if (!viewTr) {
    viewTr = new PdfView($("pdfTr"), { onTerm: (id, btn) => showTerm(id, btn) });
    viewOrig = new PdfView($("pdfOrig"));
  }
}
function clearReader() { closeReading(); Object.assign(rd, { paperId: null, lang: null, paper: null, tr: null, doc: null, files: null }); $("rdShell").hidden = true; $("rdEmpty").hidden = false; }

async function openReader(paperId, lang) {
  const [paper, tr] = await Promise.all([db.get("papers", paperId), db.get("translations", `${paperId}|${lang}`)]);
  if (!paper || !tr) { toast("That translation is no longer in the library."); return; }
  closeReading();
  Object.assign(rd, { paperId, lang, paper, tr, doc: paper.doc, files: null, idx: buildTermIndex(tr.glossary) });
  const saved = local.get(`level:${profile().id}:${paperId}|${lang}`, null);
  rd.level = saved ? clampLevel(saved) : planLevel(profile());
  local.set("lastOpen", { paperId, lang });
  $("rdEmpty").hidden = true; $("rdShell").hidden = false;
  $("rdTitle").textContent = paper.title; $("rdTitle").title = paper.title;
  $("rdSlimTitle").textContent = paper.title;
  $("rdLang").textContent = tr.bundled ? "Sample paper · pre-translated, included with TAPER" : `English → ${langLabel(lang)} · translated by ${tr.translator.model}${tr.verifier.model !== "none" ? `, checked by ${tr.verifier.model}` : ""}`;
  const langs = (await db.all("translations")).filter(t => t.paperId === paperId && t.status === "complete").map(t => t.lang);
  $("rdLangSel").replaceChildren(...langs.map(l => new Option(langLabel(l), l)));
  $("rdLangSel").value = lang;
  closeSide();
  setView(local.get("view", "split"), false);
  logEvent("open", { title: paper.title });
  showTab("reader");
  renderLevelControls();
  rd.origTried = false;
  await showTranslated();
  showOriginal();
}
function startReading() { if (rd.pdf && !rd.readStart) rd.readStart = { t: Date.now(), level: levelKey(rd.level) }; }
function closeReading() {
  if (rd.readStart) {
    const seconds = Math.round((Date.now() - rd.readStart.t) / 1000);
    if (seconds >= 5) logEvent("read", { seconds }, { level: rd.readStart.level });
    rd.readStart = null;
  }
}
addEventListener("pagehide", closeReading);
document.addEventListener("visibilitychange", () => { if (document.hidden) closeReading(); else if (state.tab === "reader") startReading(); });

async function getFiles() { if (!rd.files) rd.files = await readZip(rd.paper.zip); return rd.files; }

function renderLevelControls() {
  const sel = $("rdLevel"); sel.replaceChildren();
  const p = profile(), w = currentWeek(p), pl = planLevel(p, w);
  const same = (a, b) => a.termMode === b.termMode && a.share === b.share;
  const planGroup = h("optgroup", { label: "From my plan" }, h("option", { value: "plan" }, `Week ${w} of my plan: ${levelName(pl)}`));
  const all = h("optgroup", { label: "All levels, most native to most English" }, ...LEVELS.map((l, i) => h("option", { value: "p" + i }, l.name)));
  sel.append(planGroup, all);
  const presetIdx = LEVELS.findIndex(l => same(l, rd.level));
  const onPlan = same(pl, rd.level);
  if (onPlan) sel.value = "plan";
  else if (presetIdx >= 0) sel.value = "p" + presetIdx;
  else { sel.append(h("optgroup", { label: "Custom" }, h("option", { value: "custom" }, levelName(rd.level)))); sel.value = "custom"; }
  $("rdUsePlan").textContent = `Back to my plan's level (week ${w})`;
  $("rdUsePlan").hidden = onPlan;
  $("rdTermMode").value = rd.level.termMode; $("rdShare").value = rd.level.share; $("rdShareVal").textContent = rd.level.share + "%";
  $("paneTrSub").textContent = `${LANGS[rd.lang].name} · ${levelName(rd.level)}${onPlan ? ` · your plan's level for week ${w}` : ""}`;
}
function setLevel(l, source) {
  closeReading();
  rd.level = clampLevel(l);
  local.set(`level:${profile().id}:${rd.paperId}|${rd.lang}`, rd.level);
  logEvent("level", { from: source, level: levelName(rd.level) });
  renderLevelControls();
  showTranslated();
}
$("rdLevel").onchange = e => {
  const v = e.target.value;
  if (v === "plan") setLevel(planLevel(profile()), "my week");
  else if (v.startsWith("p")) setLevel(LEVELS[+v.slice(1)], "preset");
};
$("rdUsePlan").onclick = () => setLevel(planLevel(profile()), "my week");
$("rdLangSel").onchange = e => { logEvent("language", { to: e.target.value }); openReader(rd.paperId, e.target.value); };
$("rdShare").oninput = e => { $("rdShareVal").textContent = e.target.value + "%"; };
$("rdApply").onclick = () => { $("rdCustom").open = false; setLevel({ termMode: $("rdTermMode").value, share: +$("rdShare").value }, "fine-tune"); };

const renderId = () => `${rd.paperId}|${rd.lang}|${levelKey(rd.level)}|${settings.colorTerms ? 1 : 0}${settings.keepPaperFont !== false ? 1 : 0}|${rd.tr.updatedAt || rd.tr.createdAt}`;
function paneMessage(el, html, busy) { el.replaceChildren(h("div", { class: busy ? "pdf-busy" : "pdf-empty", html: (busy ? '<span class="spin"></span>' : "") + html })); }

async function showTranslated() {
  viewers();
  const seq = ++rd.seq;
  const id = renderId();
  const status = m => { if (seq === rd.seq) { $("rdStatus").textContent = m; } };
  rd.pdf = null;
  const cached = await db.get("renders", id);
  if (seq !== rd.seq) return;
  if (cached?.pdf) {
    rd.nativePct = cached.nativePct;
    rd.pdf = new Uint8Array(await cached.pdf.arrayBuffer());
    try { await viewTr.load(rd.pdf); } catch (e) { paneMessage($("pdfTr"), "The PDF viewer could not load: " + e.message); }
    afterRender(`${levelName(rd.level)} · ${rd.nativePct}% in ${LANGS[rd.lang].name} · from your library (no credits)`);
    return;
  }
  viewTr.clear(); paneMessage($("pdfTr"), "Building this level…", true);
  if (rd.tr.bundled && SAMPLE.hasPdf(rd.level) && settings.colorTerms !== false && settings.keepPaperFont !== false) {
    try {
      const r = await fetch(samplePdfUrl(rd.lang, levelKey(rd.level)));
      if (r.ok) {
        const pdf = new Uint8Array(await r.arrayBuffer());
        const { nativePct } = assembleTex(rd.doc, rd.tr, rd.level);
        await db.put("renders", { id, paperId: rd.paperId, lang: rd.lang, levelKey: levelKey(rd.level), pdf: new Blob([pdf], { type: "application/pdf" }), nativePct, via: "included", createdAt: new Date().toISOString() });
        if (seq !== rd.seq) return;
        rd.nativePct = nativePct; rd.pdf = pdf;
        await viewTr.load(pdf);
        afterRender(`${levelName(rd.level)} · ${nativePct}% in ${LANGS[rd.lang].name} · included with TAPER (no credits)`);
        return;
      }
    } catch { /* fall through to compiling */ }
  }
  try {
    const files = await getFiles();
    const { tex, nativePct } = assembleTex(rd.doc, rd.tr, rd.level, { colorTerms: settings.colorTerms, keepPaperFont: settings.keepPaperFont });
    const fonts = await fetchFonts(rd.lang, m => { status(m); paneMessage($("pdfTr"), m, true); });
    const proj = buildProjectFiles(rd.doc, files, tex, rd.lang, fonts);
    const res = await compileProject({ files: proj, main: rd.doc.main, engine: "xelatex", bib: rd.doc.bib, settings, onStatus: m => { status(m); if (seq === rd.seq) paneMessage($("pdfTr"), m, true); } });
    await db.put("renders", { id, paperId: rd.paperId, lang: rd.lang, levelKey: levelKey(rd.level), pdf: new Blob([res.pdf], { type: "application/pdf" }), nativePct, via: res.via, createdAt: new Date().toISOString() });
    pruneRenders();
    if (seq !== rd.seq) return;
    rd.nativePct = nativePct; rd.pdf = res.pdf;
    await viewTr.load(res.pdf);
    afterRender(`${levelName(rd.level)} · ${nativePct}% in ${LANGS[rd.lang].name} · compiled ${res.via}`);
    logEvent("compiled", { via: res.via });
  } catch (e) {
    if (seq !== rd.seq) return;
    status("Compile failed.");
    const box = h("div", { class: "pdf-error" },
      h("strong", {}, "This level could not be compiled."),
      h("p", { class: "hint" }, e.message),
      e.log ? h("pre", {}, summarizeLog(e.log)) : null,
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => showTranslated() }, "Try again"),
        h("button", { class: "btn", onclick: downloadZip }, "Download the LaTeX source (.zip)"),
        e.log ? h("button", { class: "btn", onclick: () => saveFile(`taper-compile-log-${stamp()}.txt`, e.log, "text/plain") }, "Save the full error log") : null,
        h("button", { class: "btn", onclick: () => openHelp("compile") }, "Help with compiling")));
    $("pdfTr").replaceChildren(box);
    logEvent("compile-failed", { error: e.message.slice(0, 200) });
  }
}
function afterRender(msg) {
  $("rdStatus").textContent = msg;
  $("shareFill").style.width = (rd.nativePct || 0) + "%";
  closeReading(); if (state.tab === "reader") startReading();
}
async function pruneRenders() {
  const stamp_ = rd.tr.updatedAt || rd.tr.createdAt;
  const keysNow = await db.keys("renders");
  for (const k of keysNow) if (k.startsWith(`${rd.paperId}|${rd.lang}|`) && !k.endsWith("|" + stamp_)) await db.del("renders", k);
}

async function showOriginal() {
  viewers();
  $("origActions").hidden = true; $("pdfOrig").hidden = false;
  if (rd.paper.originalPdf) {
    try { await viewOrig.load(new Uint8Array(await rd.paper.originalPdf.arrayBuffer())); } catch (e) { paneMessage($("pdfOrig"), "Could not show the original PDF: " + e.message); }
  } else if (!rd.origTried) {
    rd.origTried = true; compileOriginal(); // free: no model calls
  } else { viewOrig.clear(); $("pdfOrig").hidden = true; $("origActions").hidden = false; }
}
$("compileOrig").onclick = () => compileOriginal();
async function compileOriginal() {
  $("origActions").hidden = true; $("pdfOrig").hidden = false;
  paneMessage($("pdfOrig"), "Compiling the original…", true);
  try {
    const files = await getFiles();
    const onStatus = m => paneMessage($("pdfOrig"), m, true);
    let res;
    try {
      res = await compileProject({ files, main: rd.doc.main, engine: rd.doc.engine, bib: rd.doc.bib, settings, onStatus });
    } catch (first) {
      if (rd.doc.engine !== "pdflatex") throw first;
      // No pdfLaTeX (e.g. only Tectonic): compile the unchanged English text with the XeLaTeX fixes.
      onStatus("Trying again with XeLaTeX…");
      const t = englishOnlyTex(rd.doc), i = t.search(/\\begin\s*\{document\}/);
      res = await compileProject({ files: { ...files, [rd.doc.main]: xetexCompat(t.slice(0, i)) + t.slice(i) }, main: rd.doc.main, engine: "xelatex", bib: rd.doc.bib, settings, onStatus });
    }
    rd.paper.originalPdf = new Blob([res.pdf], { type: "application/pdf" });
    await db.put("papers", rd.paper);
    showOriginal();
  } catch (e) {
    $("pdfOrig").replaceChildren(h("div", { class: "pdf-error" }, h("strong", {}, "The original could not be compiled."), h("p", { class: "hint" }, e.message + " You can upload the original PDF instead (e.g. from arXiv)."), e.log ? h("pre", {}, summarizeLog(e.log)) : null));
    $("origActions").hidden = false;
  }
}
$("origUpload").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  rd.paper.originalPdf = f; await db.put("papers", rd.paper); showOriginal();
};

/* layout: both papers, or one of them filling the window */
function setView(v, log_ = true) {
  rd.view = v; local.set("view", v);
  const panes = $("panes");
  panes.classList.toggle("only-tr", v === "tr"); panes.classList.toggle("only-orig", v === "orig"); panes.classList.toggle("split", v === "split");
  [["vSplit", "split"], ["vTr", "tr"], ["vOrig", "orig"]].forEach(([id, k]) => $(id).setAttribute("aria-pressed", v === k));
  $("maxTr").textContent = v === "tr" ? "Show both papers" : "Show only the translation";
  $("maxOrig").textContent = v === "orig" ? "Show both papers" : "Show only the English original";
  if (log_) logEvent("view", { view: v });
}
$("vSplit").onclick = () => setView("split");
$("vTr").onclick = () => setView("tr");
$("vOrig").onclick = () => setView("orig");
$("maxTr").onclick = () => setView(rd.view === "tr" ? "split" : "tr");
$("maxOrig").onclick = () => setView(rd.view === "orig" ? "split" : "orig");

/* Hide the menus so the paper fills the window: by the button, or by scrolling down the paper.
   Scrolling back to the top of the paper, the button, or Esc brings them back. */
let slimAuto = false;
function setSlim(on, auto = false) {
  if (document.body.classList.contains("rd-slim") === on) return;
  document.body.classList.toggle("rd-slim", on);
  slimAuto = on && auto;
  $("rdFocus").textContent = on ? "Show controls" : "Hide controls";
  $("rdFocus").setAttribute("aria-pressed", on);
  closePopovers();
}
$("rdFocus").onclick = () => setSlim(!document.body.classList.contains("rd-slim"));
for (const id of ["pdfTr", "pdfOrig"]) {
  let last = 0, down = 0;
  $(id).addEventListener("scroll", e => {
    const t = e.target.scrollTop, d = t - last; last = t;
    if (!rd.pdf) return;
    const slim = document.body.classList.contains("rd-slim");
    down = d > 0 ? down + d : 0;
    if (!slim && down > 80 && t > 160) { down = 0; setSlim(true, true); }
    else if (slim && slimAuto && t < 8) setSlim(false);
  }, { passive: true });
}
$("dlMenu").addEventListener("click", e => { if (e.target.closest(".menu-body button")) $("dlMenu").open = false; });
$("zoomIn").onclick = () => { viewTr?.zoomBy(1.15); viewOrig?.zoomBy(1.15); };
$("zoomOut").onclick = () => { viewTr?.zoomBy(1 / 1.15); viewOrig?.zoomBy(1 / 1.15); };
$("zoomFit").onclick = () => { viewTr?.setZoom("fit"); viewOrig?.setZoom("fit"); };

/* downloads */
$("dlPdf").onclick = () => {
  if (!rd.pdf) { toast("The PDF for this level is not ready yet."); return; }
  saveFile(`${slug(rd.paper.title)}-${rd.lang}-${levelKey(rd.level)}.pdf`, new Blob([rd.pdf], { type: "application/pdf" }));
  logEvent("download", { what: "pdf" });
};
async function downloadZip() {
  try {
    const { tex } = assembleTex(rd.doc, rd.tr, rd.level, { colorTerms: settings.colorTerms, keepPaperFont: settings.keepPaperFont });
    const fonts = await fetchFonts(rd.lang, m => toast(m));
    const proj = buildProjectFiles(rd.doc, await getFiles(), tex, rd.lang, fonts);
    saveFile(`${slug(rd.paper.title)}-${rd.lang}-${levelKey(rd.level)}-latex.zip`, await zipFiles(proj));
    logEvent("download", { what: "latex" });
  } catch (e) { toast("Could not build the .zip: " + e.message, 5000); }
}
$("dlZip").onclick = downloadZip;

/* term popup */
function closePop() { $("termPop").hidden = true; }
function showTerm(id, anchor) {
  const t = rd.idx.list.find(x => x.id === id);
  if (!t) return;
  const uses = rd.doc.sents.filter(s => termsInEnglish(s.en, rd.idx).some(x => x.id === id)).length;
  const pop = $("termPop");
  pop.replaceChildren(
    h("span", { class: "label" }, "Technical term"),
    h("span", { class: "en", lang: "en" }, t.en),
    h("span", { class: "na", lang: LANGS[rd.lang].tag }, t.native),
    t.defNative ? h("span", { class: "def-native", lang: LANGS[rd.lang].tag }, t.defNative) : null,
    t.def ? h("span", { class: "def", lang: "en" }, t.defNative ? "In English: " + t.def : t.def) : null,
    h("span", { class: "status" }, `Appears in ${uses} sentence${uses === 1 ? "" : "s"} of this paper`));
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(16, Math.min(innerWidth - pr.width - 16, r.left)) + "px";
  pop.style.top = (r.bottom + 8 + pr.height > innerHeight ? r.top - pr.height - 8 : r.bottom + 8) + "px";
  logEvent("lookup", { term: t.en });
}
document.addEventListener("click", e => { if (!$("termPop").hidden && !e.target.closest("#termPop, .pdf-term")) closePop(); });
$("pdfTr").addEventListener("scroll", closePop, { passive: true });

/* side panel: glossary, report, check-in */
function openSide(kind, title, body) {
  $("sidePanel").hidden = false; $("panes").classList.add("with-side");
  $("sideTitle").textContent = title; $("sideBody").replaceChildren(...[body].flat().filter(Boolean));
  $("sidePanel").dataset.kind = kind;
  logEvent("panel", { panel: kind });
}
function closeSide() { $("sidePanel").hidden = true; $("panes").classList.remove("with-side"); }
$("sideClose").onclick = closeSide;

$("showGlossary").onclick = () => {
  const terms = [...rd.idx.list].sort((a, b) => a.en.localeCompare(b.en));
  const list = h("div", { class: "gloss-list" });
  const draw = q => list.replaceChildren(...terms.filter(t => !q || t.en.toLowerCase().includes(q) || t.native.toLowerCase().includes(q) || (t.defNative || "").toLowerCase().includes(q)).map(t =>
    h("div", { class: "gloss-item" }, h("span", { class: "en", lang: "en" }, t.en), h("span", { class: "na", lang: LANGS[rd.lang].tag }, t.native),
      t.defNative ? h("span", { class: "def-native", lang: LANGS[rd.lang].tag }, t.defNative) : null, t.def ? h("span", { class: "def", lang: "en" }, t.def) : null)));
  draw("");
  const search = h("input", { type: "search", placeholder: "Search terms", "aria-label": "Search terms", oninput: e => draw(e.target.value.trim().toLowerCase()) });
  const csv = () => {
    const esc = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    saveFile(`${slug(rd.paper.title)}-glossary-${rd.lang}.csv`, "english,native,definition_native,definition_english\n" + terms.map(t => [t.en, t.native, t.defNative || "", t.def || ""].map(esc).join(",")).join("\n"), "text/csv");
    logEvent("download", { what: "glossary" });
  };
  openSide("glossary", `Glossary · ${terms.length} terms`, [
    h("p", { class: "hint" }, "The technical terms of this paper, checked by the verifier. Download them as flashcards (CSV works with Anki and Quizlet)."),
    h("div", { class: "row" }, search, h("button", { class: "btn small", onclick: csv }, "Download as flashcards (CSV)")), list]);
};

$("showReport").onclick = () => {
  const r = rd.tr.report || { sentences: rd.doc.sents.length, ok: 0, fixed: 0, flagged: 0, fallback: 0, items: [], terms: rd.idx.list.length, termsCorrected: 0, termsDropped: 0 };
  const u = rd.tr.usage;
  const items = st => r.items.filter(i => i.status === st);
  const itemList = (st, intro) => {
    const arr = items(st); if (!arr.length) return null;
    return h("section", {}, h("h4", {}, `${intro} (${arr.length})`), ...arr.slice(0, 80).map(i => h("div", { class: "rep-item " + st }, h("span", { lang: "en" }, i.en), i.tr ? h("span", { class: "hint" }, i.tr) : null, h("span", { class: "issue" }, i.issues.join("; ")))));
  };
  const corrected = rd.idx.list.filter(t => t.fixed);
  const redo = items("flagged").length + items("fallback").length;
  openSide("report", "Translation quality report", [
    h("section", {},
      h("dl", { class: "facts" },
        h("dt", {}, "Sentences"), h("dd", {}, `${r.sentences}: ${r.ok} passed, ${r.fixed} fixed by the verifier, ${r.flagged} flagged, ${r.fallback} left in English`),
        h("dt", {}, "Glossary"), h("dd", {}, `${r.terms} terms, ${r.termsCorrected} corrected, ${r.termsDropped} removed`),
        h("dt", {}, "Translator"), h("dd", {}, `${rd.tr.translator.model} · ${fmtN(u.translator.input)} in / ${fmtN(u.translator.output)} out, ${u.translator.calls} calls`),
        h("dt", {}, "Verifier"), h("dd", {}, `${rd.tr.verifier.model} · ${fmtN(u.verifier.input)} in / ${fmtN(u.verifier.output)} out, ${u.verifier.calls} calls`))),
    redo ? h("section", {}, h("p", { class: "hint" }, "Flagged sentences are shown translated; sentences left in English failed the automatic checks."),
      h("button", { class: "btn", onclick: retranslateFlagged }, `Translate the ${redo} flagged/English sentence${redo === 1 ? "" : "s"} again`)) : null,
    itemList("fallback", "Left in English"), itemList("flagged", "Flagged by the verifier"), itemList("fixed", "Corrected by the verifier"),
    corrected.length ? h("section", {}, h("h4", {}, `Glossary corrections (${corrected.length})`), ...corrected.map(t => h("div", { class: "rep-item fixed" }, h("span", {}, `${t.en}: ${t.prevNative} → ${t.native}`), t.issue ? h("span", { class: "issue" }, t.issue) : null))) : null,
    (rd.tr.glossaryDropped || []).length ? h("section", {}, h("h4", {}, "Removed from the glossary"), h("p", { class: "hint" }, rd.tr.glossaryDropped.map(d => d.en).join(", "))) : null]);
};

async function retranslateFlagged() {
  const problem = configProblem(rd.tr.verifier.model !== "none");
  if (problem) { toast(problem, 4000); return; }
  if (!confirm("This uses a few more model calls. Continue?")) return;
  const tr = rd.tr;
  for (const s of rd.doc.sents) if (["flagged", "fallback"].includes(tr.sents[s.id]?.status)) delete tr.sents[s.id];
  const msg = h("p", { class: "status" }, "Working…");
  $("sideBody").replaceChildren(msg);
  try {
    await runPipeline({ doc: rd.doc, tr, translator: cfgFor("translator"), verifier: cfgFor("verifier"), settings: { maxRetries: +settings.maxRetries, batchChars: +settings.batchChars, concurrency: +settings.concurrency, verify: tr.verifier.model !== "none" },
      onSave: t => db.put("translations", t), onProgress: p => { msg.textContent = `${p.message} ${p.total > 1 ? `(${p.done}/${p.total})` : ""}`; } });
    logEvent("retranslate", { report: tr.report && { flagged: tr.report.flagged, fallback: tr.report.fallback } });
    $("showReport").click();
    showTranslated();
  } catch (e) { msg.className = "status bad"; msg.textContent = e.message; }
}

$("openCheck").onclick = async () => {
  const feel = h("section", {},
    h("h4", {}, "How did this level feel?"),
    h("p", { class: "hint" }, "Optional. It helps the AI adjust your plan."),
    h("fieldset", { class: "q" }, h("legend", {}, "I understood the paper…"), h("div", { class: "likert", id: "lkU" })),
    h("fieldset", { class: "q" }, h("legend", {}, "This mix of languages felt…"), h("div", { class: "likert", id: "lkC" })),
    h("fieldset", { class: "q" }, h("legend", {}, "Next time I'd like…"), h("div", { class: "opts" },
      ...[["more-native", "More of my language"], ["same", "The same"], ["more-english", "More English"]].map(([v, t]) => h("label", {}, h("input", { type: "radio", name: "ciNext", value: v }), " " + t)))),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: saveCheckin }, "Save my answers"), h("span", { class: "status", id: "ciStatus" })));
  const quizBox = h("section", { id: "quizBox" }, h("h4", {}, "Quiz"), h("p", { class: "hint" }, "Optional: four questions on the paper's main ideas."));
  openSide("check", "Check my understanding", [feel, quizBox]);
  likert($("lkU"), "ciU", "Not at all", "Completely");
  likert($("lkC"), "ciC", "Very hard", "Very comfortable");
  const cached = await db.get("quizzes", `${rd.paperId}|${rd.lang}`);
  if (cached) renderQuiz(cached.questions);
  else quizBox.append(h("button", { class: "btn", onclick: generateQuiz }, "Write a quiz for this paper (1 model call)"));
};
function saveCheckin() {
  const u = picked("ciU"), c = picked("ciC"), n = picked("ciNext");
  if (!u && !c && !n) { $("ciStatus").textContent = "Pick at least one answer, or just close this panel."; return; }
  const entry = { time: new Date().toISOString(), week: currentWeek(profile()), level: levelKey(rd.level), understand: u ? +u : null, comfort: c ? +c : null, next: n };
  const p = profile(); p.checkins = [...(p.checkins || []), entry].slice(-30); saveProfiles();
  logEvent("checkin", { understand: entry.understand, comfort: entry.comfort, next: n });
  $("ciStatus").className = "status ok"; $("ciStatus").textContent = "Saved. Thank you!";
}
async function generateQuiz() {
  const box = $("quizBox");
  const problem = configProblem(false);
  if (problem) { toast(problem, 4000); return; }
  box.querySelector("button")?.remove();
  const st = h("p", { class: "status" }, h("span", { class: "spin" }), "Writing questions…"); box.append(st);
  try {
    const text = rd.doc.sents.map(s => plainText(s.en, rd.doc.ph)).join(" ").slice(0, 12000);
    const r = await callLLM(cfgFor("translator"), P.quizPrompt(text, LANGS[rd.lang].name, rd.paper.title));
    const qs = (r.json.questions || []).filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer));
    if (!qs.length) throw new Error("The model returned no usable questions.");
    await db.put("quizzes", { id: `${rd.paperId}|${rd.lang}`, paperId: rd.paperId, lang: rd.lang, questions: qs, createdAt: new Date().toISOString() });
    st.remove(); renderQuiz(qs);
    logEvent("quiz-made", { questions: qs.length, tokens: r.usage });
  } catch (e) { st.className = "status bad"; st.textContent = e.message; box.append(h("button", { class: "btn", onclick: generateQuiz }, "Try again")); }
}
function renderQuiz(qs) {
  const box = $("quizBox");
  const showNative = h("label", { class: "check" }, h("input", { type: "checkbox", checked: true, onchange: e => box.querySelectorAll(".nat").forEach(n => { n.hidden = !e.target.checked; }) }), ` Show in ${LANGS[rd.lang].name} too`);
  const items = qs.map((q, i) => h("fieldset", { class: "quiz-q" },
    h("legend", {}, `${i + 1}. ${q.q}`), q.q_native ? h("span", { class: "nat" }, q.q_native) : null,
    ...q.options.map((o, j) => h("label", { "data-q": i, "data-o": j }, h("input", { type: "radio", name: "qz" + i, value: j }), h("span", {}, o, q.options_native?.[j] ? h("span", { class: "nat" }, ` · ${q.options_native[j]}`) : null)))));
  const result = h("span", { class: "status" });
  const check = () => {
    let right = 0, answered = 0;
    qs.forEach((q, i) => {
      const v = picked("qz" + i); if (v != null) answered++;
      box.querySelectorAll(`label[data-q="${i}"]`).forEach(l => { l.classList.remove("right", "wrong"); if (+l.dataset.o === q.answer) l.classList.add("right"); else if (v != null && +l.dataset.o === +v) l.classList.add("wrong"); });
      if (v != null && +v === q.answer) right++;
    });
    result.textContent = `${right} of ${qs.length} correct.`;
    logEvent("quiz", { correct: right, answered, total: qs.length });
  };
  box.append(showNative, ...items, h("div", { class: "row" }, h("button", { class: "btn primary", onclick: check }, "Check my answers"), result));
}

/* ======================= plan ======================= */
let planDraft = null, proposal = null;
function renderPlanTab() {
  const p = profile();
  fillLangSelect($("pfLang"), p.lang);
  $("pfName").value = p.name; $("pfField").value = p.field || ""; $("pfStart").value = p.startDate || "";
  $("pfWeeks").value = p.weeks; $("pfPerWeek").value = p.papersPerWeek ?? 1; $("pfOverride").value = p.weekOverride || ""; $("pfNotes").value = p.notes || "";
  likert($("pfEnglish"), "pfEng", "Very hard", "Very easy");
  const r = document.querySelector(`input[name="pfEng"][value="${p.englishLevel || 3}"]`); if (r) r.checked = true;
  $("pfDelete").disabled = profiles.length < 2;
  planDraft = normalizePlan(p.plan, p.weeks);
  renderPlanTable();
  $("planProposal").hidden = !proposal;
}
function renderPlanTable() {
  const p = profile(), now = currentWeek(p);
  $("planNow").textContent = `This week: ${now} of ${p.weeks}`;
  $("planBody").replaceChildren(...planDraft.map((row, i) => h("tr", { class: row.week === now ? "now" : "" },
    h("td", {}, String(row.week), row.week === now ? " (now)" : ""),
    h("td", {}, h("select", { "aria-label": `Week ${row.week} technical terms`, onchange: e => { planDraft[i].termMode = e.target.value; } }, ...Object.entries(TERM_MODES).map(([k, v]) => { const o = new Option(v, k); o.selected = k === row.termMode; return o; }))),
    h("td", {}, h("input", { type: "number", min: 0, max: 100, step: 5, value: row.share, "aria-label": `Week ${row.week} English sentences percent`, onchange: e => { planDraft[i].share = clampLevel({ termMode: "english", share: +e.target.value }).share; e.target.value = planDraft[i].share; } }), " %"),
    h("td", {}, h("input", { type: "text", value: row.focus || "", "aria-label": `Week ${row.week} focus`, onchange: e => { planDraft[i].focus = e.target.value; } })))));
}
function readProfileForm() {
  const p = profile();
  const weeks = Math.max(1, Math.min(52, +$("pfWeeks").value || 12));
  Object.assign(p, { name: $("pfName").value.trim() || p.name, lang: $("pfLang").value, field: $("pfField").value.trim(), startDate: $("pfStart").value || today(),
    weeks, papersPerWeek: +$("pfPerWeek").value || 0, weekOverride: +$("pfOverride").value || null, notes: $("pfNotes").value.trim(), englishLevel: +(picked("pfEng") || 3) });
  if (planDraft.length !== weeks) planDraft = normalizePlan(planDraft, weeks);
  return p;
}
$("profileForm").addEventListener("submit", e => {
  e.preventDefault();
  const p = readProfileForm();
  p.plan = normalizePlan(planDraft, p.weeks);
  saveProfiles(); renderHeader(); renderPlanTab();
  $("pfStatus").className = "status ok"; $("pfStatus").textContent = "Saved. Translate and Read now use these details.";
  logEvent("profile-saved", { lang: p.lang, field: p.field, englishLevel: p.englishLevel, weeks: p.weeks, startDate: p.startDate });
});
$("pfWeeks").onchange = () => { const w = Math.max(1, Math.min(52, +$("pfWeeks").value || 12)); planDraft = normalizePlan(planDraft, w); renderPlanTable(); };
$("pfNew").onclick = addProfile;
$("pfDelete").onclick = () => {
  if (profiles.length < 2) return;
  if (!confirm(`Delete the reader "${profile().name}"? Their plan is removed; translations stay in the library and the study log is kept.`)) return;
  profiles = profiles.filter(p => p.id !== activeId); activeId = profiles[0].id; saveProfiles(); renderHeader(); renderPlanTab();
};
$("planSave").onclick = () => {
  const p = readProfileForm();
  p.plan = normalizePlan(planDraft, p.weeks); saveProfiles(); renderHeader();
  $("planStatus").className = "status ok"; $("planStatus").textContent = "Plan saved. Read now opens papers at this week's level.";
  logEvent("plan-saved", { plan: p.plan.map(r => `${r.termMode}-${r.share}`).join(" ") });
};
$("planReset").onclick = () => { planDraft = defaultPlan(profile().weeks); renderPlanTable(); $("planStatus").className = "status"; $("planStatus").textContent = "Default plan loaded. Press Save weekly plan to keep it."; };

function showProposal(plan, rationale, kind) {
  proposal = { plan, kind };
  $("planRationale").textContent = rationale || "";
  $("proposalBody").replaceChildren(...plan.map(r => h("tr", {}, h("td", {}, String(r.week)), h("td", {}, TERM_MODES[r.termMode]), h("td", {}, r.share + "%"), h("td", {}, r.focus || ""))));
  $("planProposal").hidden = false;
  $("planProposal").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function askPlan(kind) {
  const problem = configProblem(false);
  if (problem) { toast(problem, 4000); return; }
  const p = readProfileForm();
  const st = $("planStatus"); st.className = "status"; st.replaceChildren(h("span", { class: "spin" }), kind === "draft" ? "Drafting a plan…" : "Thinking about your feedback…");
  try {
    const week = currentWeek(p);
    const req = kind === "draft" ? P.planPrompt(p, LANGS[p.lang].name)
      : P.adjustPlanPrompt({ ...p, plan: planDraft }, LANGS[p.lang].name, week, $("planFeedback").value.trim(), (p.checkins || []).slice(-8));
    const r = await callLLM(cfgFor("translator"), req);
    let plan = normalizePlan(r.json.plan, p.weeks, kind === "draft");
    if (kind === "adjust") {
      const fixedEarly = planDraft.filter(x => x.week < week);
      const later = normalizePlan(r.json.plan, p.weeks).filter(x => x.week >= week);
      plan = [...fixedEarly, ...later];
    }
    st.textContent = "";
    showProposal(plan, r.json.rationale, kind);
    logEvent(kind === "draft" ? "plan-ai-draft" : "plan-ai-adjust", { feedback: kind === "adjust" ? $("planFeedback").value.trim().slice(0, 200) : undefined, tokens: r.usage });
  } catch (e) { st.className = "status bad"; st.textContent = e.message; }
}
$("planAI").onclick = () => askPlan("draft");
$("planAdjust").onclick = () => askPlan("adjust");
$("planAccept").onclick = () => {
  const p = profile();
  planDraft = proposal.plan; p.plan = normalizePlan(planDraft, p.weeks); saveProfiles();
  logEvent("plan-accepted", { kind: proposal.kind, plan: p.plan.map(r => `${r.termMode}-${r.share}`).join(" ") });
  proposal = null; $("planProposal").hidden = true; renderPlanTable(); renderHeader();
  $("planStatus").className = "status ok"; $("planStatus").textContent = "Plan updated. You can still edit any week below.";
};
$("planDiscard").onclick = () => { logEvent("plan-discarded", { kind: proposal?.kind }); proposal = null; $("planProposal").hidden = true; };

/* ======================= settings ======================= */
function renderSettings() {
  const list = $("keyList"); list.replaceChildren();
  for (const [id, pv] of Object.entries(PROVIDERS)) {
    const inp = h("input", { type: "password", id: "key-" + id, placeholder: pv.keyHint, autocomplete: "off", value: keys[id] || "", "aria-label": `${pv.label} API key`,
      onchange: e => { const v = e.target.value.trim(); if (v) keys[id] = v; else delete keys[id]; saveKeys(); flash(`${pv.label} key ${v ? "saved" : "removed"}.`); updateNew(); } });
    const show = h("button", { class: "btn small", type: "button", onclick: () => { inp.type = inp.type === "password" ? "text" : "password"; show.textContent = inp.type === "password" ? "Show key" : "Hide key"; } }, "Show key");
    list.append(h("div", { class: "key-row" }, h("span", { class: "name" }, pv.label, pv.keyUrl ? [" ", h("a", { href: pv.keyUrl, target: "_blank", rel: "noopener", class: "hint" }, "get a key")] : null), inp, show));
  }
  $("customBase").value = settings.customBase || "";
  $("rememberKeys").checked = !!settings.rememberKeys;
  for (const [role, pre] of [["translator", "tr"], ["verifier", "vr"]]) {
    const ps = $(pre + "Provider");
    ps.replaceChildren(...Object.entries(PROVIDERS).map(([k, v]) => new Option(v.label, k)));
    ps.value = settings[role].provider;
    $(pre + "Model").value = settings[role].model || "";
    fillModelList(pre, PROVIDERS[settings[role].provider].models);
  }
  $("effort").value = settings.effort; $("setRetries").value = settings.maxRetries; $("setBatch").value = settings.batchChars; $("setConc").value = settings.concurrency;
  $("setCompileMode").value = settings.compileMode; $("setLocalUrl").value = settings.localUrl || ""; $("setBundle").value = settings.busytexBundle; $("setRemote").value = settings.remoteEndpoint || "";
  $("setColor").checked = settings.colorTerms !== false; $("setKeepFont").checked = settings.keepPaperFont !== false;
}
const flash = m => { $("setStatus").className = "status ok"; $("setStatus").textContent = m; clearTimeout(flash.t); flash.t = setTimeout(() => { $("setStatus").textContent = ""; }, 3000); };
const fillModelList = (pre, models) => $(pre + "Models").replaceChildren(...models.map(m => h("option", { value: m })));
for (const [role, pre] of [["translator", "tr"], ["verifier", "vr"]]) {
  $(pre + "Provider").onchange = e => {
    const pv = PROVIDERS[e.target.value];
    settings[role] = { provider: e.target.value, model: pv.defaultModel || "" };
    $(pre + "Model").value = settings[role].model; fillModelList(pre, pv.models); saveSettings(); flash(`${role[0].toUpperCase() + role.slice(1)}: ${pv.label}. ${pv.defaultModel ? "" : "Press Load the model list to pick a model."}`); updateNew();
  };
  $(pre + "Model").onchange = e => { settings[role].model = e.target.value.trim(); saveSettings(); flash("Model saved."); updateNew(); };
  $(pre + "List").onclick = async () => {
    const st = $(pre + "Status"); st.className = "status"; st.textContent = "Loading…";
    try { const ms = await listModels(cfgFor(role)); fillModelList(pre, ms); st.className = "status ok"; st.textContent = `${ms.length} models. Click the model box to choose.`; $(pre + "Model").focus(); }
    catch (e) { st.className = "status bad"; st.textContent = e.message; }
  };
  $(pre + "Test").onclick = async () => {
    const st = $(pre + "Status"); st.className = "status"; st.textContent = "Testing…";
    const t0 = performance.now();
    try {
      const r = await callLLM(cfgFor(role), { system: "You are a test endpoint. Reply with JSON only.", prompt: 'Return exactly {"ok": true}', maxTokens: 2000 }, { retries: 0 });
      st.className = r.json?.ok ? "status ok" : "status bad"; st.textContent = r.json?.ok ? `Works (${((performance.now() - t0) / 1000).toFixed(1)} s).` : "Answered, but not with the expected JSON.";
    } catch (e) { st.className = "status bad"; st.textContent = e.message; }
  };
}
$("customBase").onchange = e => { settings.customBase = e.target.value.trim(); saveSettings(); flash("Saved."); };
$("rememberKeys").onchange = e => { settings.rememberKeys = e.target.checked; saveSettings(); saveKeys(); flash(e.target.checked ? "Keys will be remembered on this device." : "Keys will be forgotten when this tab closes."); };
$("clearKeys").onclick = () => { keys = {}; saveKeys(); renderSettings(); flash("All keys forgotten."); updateNew(); };
const numSetting = (id, key, min, max) => { $(id).onchange = e => { settings[key] = Math.max(min, Math.min(max, +e.target.value || DEFAULT_SETTINGS[key])); e.target.value = settings[key]; saveSettings(); flash("Saved."); }; };
numSetting("setRetries", "maxRetries", 0, 5); numSetting("setBatch", "batchChars", 1000, 20000); numSetting("setConc", "concurrency", 1, 6);
$("effort").onchange = e => { settings.effort = e.target.value; saveSettings(); flash("Saved."); };
$("setCompileMode").onchange = e => { settings.compileMode = e.target.value; saveSettings(); flash("Saved."); };
$("setLocalUrl").onchange = e => { settings.localUrl = e.target.value.trim(); saveSettings(); flash("Saved."); };
$("setBundle").onchange = e => { settings.busytexBundle = e.target.value; saveSettings(); flash("Saved. Reload the page for this to take effect."); };
$("setRemote").onchange = e => { settings.remoteEndpoint = e.target.value.trim(); saveSettings(); flash("Saved."); };
$("setColor").onchange = e => { settings.colorTerms = e.target.checked; saveSettings(); flash("Saved. New levels use this setting."); };
$("setKeepFont").onchange = e => { settings.keepPaperFont = e.target.checked; saveSettings(); flash("Saved."); };
$("checkCompile").onclick = async () => {
  const out = $("compileInfo"); out.className = "status"; out.textContent = "Checking…";
  const info = await detectLocal(settings);
  let browser = "not checked";
  try { const r = await fetch(new URL((settings.busytexPath || "vendor/busytex") + "/busytex.wasm", location.href), { method: "HEAD" }); browser = r.ok ? "available" : "not installed on this site"; } catch { browser = "not reachable"; }
  out.textContent = `Local helper: ${info ? (info.engines.length ? "running with " + info.engines.join(", ") : "running, but no LaTeX found") : "not running"} · In-browser engine: ${browser}.`;
  out.className = info?.engines?.length || browser === "available" ? "status ok" : "status bad";
};

/* ======================= study data ======================= */
function renderData() {
  const body = $("logBody"); body.replaceChildren();
  log.slice().reverse().slice(0, 400).forEach(r => body.append(h("tr", {},
    h("td", {}, new Date(r.time).toLocaleString()), h("td", {}, r.profile), h("td", {}, String(r.week)), h("td", {}, r.type), h("td", {}, r.paper || ""), h("td", {}, r.lang || ""),
    h("td", {}, r.level || ""), h("td", {}, r.nativePct === "" || r.nativePct == null ? "" : r.nativePct + "%"), h("td", { class: "detail" }, JSON.stringify(r.detail)))));
  const by = t => log.filter(r => r.type === t);
  const secs = by("read").reduce((s, r) => s + (r.detail.seconds || 0), 0);
  const quiz = by("quiz"); const acc = quiz.length ? Math.round(100 * quiz.reduce((s, r) => s + r.detail.correct / r.detail.total, 0) / quiz.length) + "%" : "—";
  const stats = [[log.length, "events"], [new Set(log.map(r => r.profile)).size, "readers"], [by("translate-done").length, "translations"], [Math.round(secs / 60), "minutes reading"], [by("lookup").length, "term lookups"], [by("checkin").length, "check-ins"], [acc, "quiz accuracy"]];
  $("stats").replaceChildren(...stats.map(([b, s]) => h("div", { class: "stat" }, h("b", {}, String(b)), h("span", {}, s))));
}
function toCsv() {
  const esc = v => { const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [COLS.join(",")].concat(log.map(r => COLS.map(c => esc(r[c])).join(","))).join("\n");
}
$("exportCsv").onclick = () => { closeReading(); saveFile(`taper-log-${stamp()}.csv`, toCsv(), "text/csv"); };
$("exportJson").onclick = () => { closeReading(); saveFile(`taper-log-${stamp()}.json`, JSON.stringify({ exported: new Date().toISOString(), profiles: profiles.map(({ id, name, lang, field, englishLevel, startDate, weeks, plan, checkins }) => ({ id, name, lang, field, englishLevel, startDate, weeks, plan, checkins })), rows: log }, null, 2), "application/json"); };
$("clearLog").onclick = () => { $("clearConfirm").hidden = false; };
$("clearNo").onclick = () => { $("clearConfirm").hidden = true; };
$("clearYes").onclick = () => { log = []; local.set("log", log); $("logCount").textContent = 0; $("clearConfirm").hidden = true; if (state.tab === "data") renderData(); toast("Log cleared"); };

/* ======================= start ======================= */
$("logCount").textContent = log.length;
fillLangSelect($("newLang"), profile().lang);
renderHeader();
renderHelpPage();
const startTab = location.hash.slice(1);
const firstVisit = !local.get("visited", false);
local.set("visited", true);
ensureSample().then(id => {
  const last = local.get("lastOpen", null);
  if (firstVisit && !startTab && id) {
    openSample().then(() => toast("This is the sample paper, already translated for you. Change the level or language at the top; set up your own plan in My plan.", 7000));
  } else if (startTab === "reader") {
    if (last) openReader(last.paperId, last.lang); else if (id) openSample(); else showTab("reader");
  } else if (state.tab === "library") renderLibrary();
});
showTab(TABS.includes(startTab) && startTab !== "reader" ? startTab : "library");
if (location.protocol === "file:") toast("Open TAPER through python run.py or the GitHub Pages address: browsers block parts of it on file:// pages.", 8000);
