/* The translation pipeline. One run produces ONE translation of the paper (per language);
 * every reading level is then assembled locally from it, with no further LLM calls.
 *
 *   1. Glossary   translator lists technical terms + native translations (always first)
 *   2. Glossary check   verifier corrects or drops entries
 *   3. Translate  sentences in batches; terms marked [[English key]]
 *   4. Verify     local checks (placeholders, braces, commands) + verifier review
 *   5. Retry      failing sentences go back to the translator with the reviewer's notes
 *   6. Finalise   still failing local checks -> shown in English ("fallback");
 *                 still failing review -> kept but flagged in the report
 *
 * State lives in the translation record `tr` and is saved after every batch, so a run can be
 * cancelled and resumed without paying twice.
 */
import { callLLM } from "./providers.js";
import * as P from "./prompts.js";
import { buildTermIndex, localCheck, normKey, termsInEnglish } from "./assemble.js";
import { plainText } from "./latex.js";
import { LANGS } from "./langs.js";

export const DEFAULTS = { batchChars: 4500, batchMax: 40, glossaryChunk: 9000, concurrency: 2, maxRetries: 2, verify: true };

export function newTranslation(doc, paperId, lang, translator, verifier) {
  return {
    id: `${paperId}|${lang}`, paperId, lang, createdAt: new Date().toISOString(), updatedAt: null,
    translator: { provider: translator.provider, model: translator.model },
    verifier: { provider: verifier.provider, model: verifier.model },
    status: "new", glossary: null, sents: {}, report: null,
    usage: { input: 0, output: 0, calls: 0, translator: { input: 0, output: 0, calls: 0 }, verifier: { input: 0, output: 0, calls: 0 } }
  };
}

/* Rough cost estimate shown before a run (tokens ≈ characters / 4). */
export function estimate(doc, settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const chars = doc.stats.chars;
  const batches = Math.max(1, Math.ceil(chars / s.batchChars));
  const gl = Math.max(1, Math.ceil(chars / s.glossaryChunk));
  const tIn = Math.round(chars / 4 + gl * 700 + batches * 1400);
  const tOut = Math.round(chars / 4 * 1.6 + gl * 600);
  const vIn = s.verify ? Math.round(chars / 4 * 2.6 + batches * 1300) : 0;
  const vOut = s.verify ? Math.round(batches * 300) : 0;
  return { calls: gl + batches + (s.verify ? batches + 1 : 0), translator: { input: tIn, output: tOut }, verifier: { input: vIn, output: vOut }, retryNote: "Retries add a little more for sentences that fail review." };
}

async function pool(items, n, fn, signal) {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function chunkText(parts, max) {
  const out = []; let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length + 1 > max) { out.push(cur); cur = ""; }
    cur += (cur ? " " : "") + p;
  }
  if (cur) out.push(cur);
  return out;
}

function makeBatches(sents, maxChars, maxN) {
  const out = []; let cur = [], n = 0;
  for (const s of sents) {
    if (cur.length && (n + s.en.length > maxChars || cur.length >= maxN)) { out.push(cur); cur = []; n = 0; }
    cur.push(s); n += s.en.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function runPipeline({ doc, tr, translator, verifier, settings = {}, onProgress = () => {}, onSave = async () => {}, signal, llm = callLLM }) {
  const S = { ...DEFAULTS, ...settings };
  const lang = LANGS[tr.lang]?.name || tr.lang;
  const title = doc.title;
  const progress = (stage, done, total, message) => onProgress({ stage, done, total, message });
  const save = async () => { tr.updatedAt = new Date().toISOString(); await onSave(tr); };

  const call = async (role, req) => {
    const cfg = role === "translator" ? translator : verifier;
    const r = await llm(cfg, req, { signal });
    const u = tr.usage;
    u.input += r.usage.input; u.output += r.usage.output; u.calls++;
    u[role].input += r.usage.input; u[role].output += r.usage.output; u[role].calls++;
    return r.json || {};
  };

  tr.status = "running";

  /* ---------- 1–2: glossary ---------- */
  if (!tr.glossary?.done) {
    const parts = doc.sents.map(s => plainText(s.en, doc.ph)).filter(Boolean);
    const chunks = chunkText(parts, S.glossaryChunk);
    const found = new Map();
    let done = 0;
    progress("glossary", 0, chunks.length, "Finding technical terms");
    await pool(chunks, S.concurrency, async chunk => {
      const j = await call("translator", P.glossaryPrompt(chunk, lang, title));
      for (const t of Array.isArray(j.terms) ? j.terms : []) {
        if (!t || typeof t.en !== "string" || !t.en.trim()) continue;
        const k = normKey(t.en);
        if (!found.has(k)) found.set(k, { en: t.en.trim(), native: String(t.native || "").trim(), def: String(t.def || "").trim() });
      }
      progress("glossary", ++done, chunks.length, "Finding technical terms");
    }, signal);
    let terms = [...found.values()];

    if (S.verify && terms.length) {
      const groups = []; for (let i = 0; i < terms.length; i += 120) groups.push(terms.slice(i, i + 120));
      let vd = 0;
      progress("glossary-check", 0, groups.length, "Verifier is checking the glossary");
      const fixes = [];
      await pool(groups, S.concurrency, async g => {
        const j = await call("verifier", P.glossaryVerifyPrompt(g, lang, title));
        if (Array.isArray(j.fixes)) fixes.push(...j.fixes);
        progress("glossary-check", ++vd, groups.length, "Verifier is checking the glossary");
      }, signal);
      const byKey = new Map(terms.map(t => [normKey(t.en), t]));
      for (const f of fixes) {
        const t = f && byKey.get(normKey(f.en));
        if (!t) continue;
        if (f.drop === true) { t.dropped = true; t.issue = f.issue || "not a technical term"; continue; }
        if (f.native && f.native !== t.native) { t.prevNative = t.native; t.native = String(f.native); t.fixed = true; }
        if (f.def) t.def = String(f.def);
        if (f.issue) t.issue = String(f.issue);
      }
      tr.glossaryDropped = terms.filter(t => t.dropped).map(t => ({ en: t.en, issue: t.issue }));
      terms = terms.filter(t => !t.dropped);
    }
    // Keep only terms that really occur in the English text.
    terms = terms.map((t, i) => ({ ...t, id: "t" + (i + 1) }));
    const idx0 = buildTermIndex({ terms });
    const used = new Set();
    doc.sents.forEach(s => termsInEnglish(s.en, idx0).forEach(t => used.add(t.id)));
    terms = terms.filter(t => used.has(t.id) && t.native);
    tr.glossary = { terms, done: true };
    await save();
  }
  const idx = buildTermIndex(tr.glossary);
  const glossFor = batch => {
    const m = new Map();
    batch.forEach(s => termsInEnglish(s.en, idx).forEach(t => m.set(t.id, t)));
    return [...m.values()];
  };

  /* ---------- 3: translate ---------- */
  const translateBatch = async (batch, notes) => {
    let j;
    try {
      j = await call("translator", P.translatePrompt(batch, lang, title, glossFor(batch), notes));
    } catch (e) {
      if (e.code === "too_long" && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await translateBatch(batch.slice(0, mid), notes);
        await translateBatch(batch.slice(mid), notes);
        return;
      }
      throw e;
    }
    const got = new Map((Array.isArray(j.t) ? j.t : []).filter(x => x && x.id).map(x => [String(x.id), x.tr]));
    for (const s of batch) {
      const prev = tr.sents[s.id] || { attempts: 0 };
      const text = got.get(s.id);
      if (typeof text !== "string") { tr.sents[s.id] = { ...prev, status: "local-fail", issues: ["missing from the translator's answer"], attempts: prev.attempts + 1 }; continue; }
      const problems = localCheck(s.en, text, idx);
      tr.sents[s.id] = { tr: text, status: problems.length ? "local-fail" : "translated", issues: problems, attempts: prev.attempts + 1 };
    }
  };

  const runTranslate = async (list, notes, label) => {
    const batches = makeBatches(list, S.batchChars, S.batchMax);
    let done = 0;
    progress("translate", 0, batches.length, label);
    await pool(batches, S.concurrency, async b => {
      await translateBatch(b, notes && Object.fromEntries(b.filter(s => notes[s.id]).map(s => [s.id, notes[s.id]])));
      await save();
      progress("translate", ++done, batches.length, label);
    }, signal);
  };

  /* ---------- 4: verify ---------- */
  const runVerify = async (list, label) => {
    if (!S.verify) { list.forEach(s => { tr.sents[s.id].status = "ok"; }); return; }
    const batches = makeBatches(list, S.batchChars, S.batchMax);
    let done = 0;
    progress("verify", 0, batches.length, label);
    await pool(batches, S.concurrency, async b => {
      const pairs = b.map(s => ({ id: s.id, en: s.en, tr: tr.sents[s.id].tr }));
      const j = await call("verifier", P.verifyPrompt(pairs, lang, title, glossFor(b)));
      const issues = new Map((Array.isArray(j.r) ? j.r : []).filter(x => x && x.id).map(x => [String(x.id), x]));
      for (const s of b) {
        const st = tr.sents[s.id], r = issues.get(s.id);
        if (!r) { st.status = "ok"; continue; }
        const issue = String(r.issue || "reviewer flagged this sentence");
        if (typeof r.fix === "string" && r.fix.trim() && !localCheck(s.en, r.fix, idx).length) {
          tr.sents[s.id] = { ...st, prev: st.tr, tr: r.fix, status: "fixed", issues: [issue] };
        } else {
          tr.sents[s.id] = { ...st, status: "review-fail", issues: [issue] };
        }
      }
      await save();
      progress("verify", ++done, batches.length, label);
    }, signal);
  };

  const byStatus = (...st) => doc.sents.filter(s => st.includes(tr.sents[s.id]?.status ?? "pending"));

  const pending = byStatus("pending");
  if (pending.length) await runTranslate(pending, null, "Translating sentences");
  const unverified = byStatus("translated");
  if (unverified.length) await runVerify(unverified, "Verifier is checking the translation");

  /* ---------- 5: retries ---------- */
  for (let round = 1; round <= S.maxRetries; round++) {
    const failing = byStatus("local-fail", "review-fail");
    if (!failing.length) break;
    const notes = Object.fromEntries(failing.map(s => {
      const st = tr.sents[s.id];
      return [s.id, `${st.tr ? `Previous translation: ${st.tr}\n` : ""}Problem: ${(st.issues || []).join("; ")}`];
    }));
    await runTranslate(failing, notes, `Retry ${round}: re-translating ${failing.length} sentence${failing.length === 1 ? "" : "s"}`);
    const again = byStatus("translated");
    if (again.length) await runVerify(again, `Retry ${round}: checking again`);
  }

  /* ---------- 6: finalise ---------- */
  for (const s of doc.sents) {
    const st = tr.sents[s.id];
    if (!st || st.status === "local-fail" || st.status === "pending") tr.sents[s.id] = { ...(st || {}), status: "fallback", issues: st?.issues || ["not translated"] };
    else if (st.status === "review-fail") st.status = "flagged";
  }
  tr.report = makeReport(doc, tr);
  tr.status = "complete";
  await save();
  progress("done", 1, 1, "Done");
  return tr;
}

export function makeReport(doc, tr) {
  const count = st => doc.sents.filter(s => tr.sents[s.id]?.status === st).length;
  const terms = tr.glossary?.terms || [];
  return {
    sentences: doc.sents.length, ok: count("ok"), fixed: count("fixed"), flagged: count("flagged"), fallback: count("fallback"),
    terms: terms.length, termsCorrected: terms.filter(t => t.fixed).length, termsDropped: (tr.glossaryDropped || []).length,
    items: doc.sents.filter(s => ["flagged", "fallback", "fixed"].includes(tr.sents[s.id]?.status))
      .map(s => ({ id: s.id, status: tr.sents[s.id].status, en: plainText(s.en, doc.ph), tr: tr.sents[s.id].tr ? plainText(tr.sents[s.id].tr.replace(/\[\[([^\]]+)\]\]/g, "$1"), doc.ph) : "", issues: tr.sents[s.id].issues || [] }))
  };
}
