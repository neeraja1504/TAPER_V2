import test from "node:test";
import assert from "node:assert/strict";
import { parseProject } from "../src/latex.js";
import { runPipeline, newTranslation, estimate } from "../src/pipeline.js";
import { assembleTex } from "../src/assemble.js";
import { readSample } from "./helpers.js";

/* A scripted LLM: answers each prompt type deterministically, and misbehaves on purpose
   the first time for two sentences so the retry path is exercised. */
function mockLLM(doc, { breakPlaceholders = "s4", reviewFail = "s9", alwaysBreak = null } = {}) {
  const calls = { translator: 0, verifier: 0, prompts: [] };
  const seen = new Set();
  const llm = async (cfg, req) => {
    calls[cfg.role]++;
    calls.prompts.push(req.prompt);
    const usage = { input: 100, output: 50 };
    if (/List the technical terms/.test(req.prompt)) {
      return { json: { terms: [
        { en: "cross-encoder", native: "bộ mã hóa chéo", def: "scores pairs jointly" },
        { en: "hallucination", native: "ảo tưởng", def: "unsupported claim" },
        { en: "results", native: "kết quả", def: "not a term" },
        { en: "quantum chromodynamics", native: "sắc động lực học lượng tử", def: "not in this paper" }
      ] }, usage };
    }
    if (/Review this English → .* glossary/.test(req.prompt)) {
      return { json: { fixes: [
        { en: "hallucination", native: "ảo giác", issue: "standard term is ảo giác" },
        { en: "results", drop: true, issue: "everyday word" }
      ] }, usage };
    }
    if (/Translate each sentence/.test(req.prompt)) {
      const input = JSON.parse(req.prompt.slice(req.prompt.indexOf("Input:\n") + 7));
      const t = input.sentences.map(s => {
        let tr = "VI " + s.en.replace(/cross-encoder/gi, "[[cross-encoder]]").replace(/hallucination/gi, "[[hallucination]]");
        const first = !seen.has(s.id); seen.add(s.id);
        if ((s.id === breakPlaceholders && first) || s.id === alwaysBreak) tr = tr.replace(/⟦\d+⟧/g, "");
        return { id: s.id, tr };
      });
      return { json: { t }, usage };
    }
    if (/Check every pair/.test(req.prompt)) {
      const pairs = JSON.parse(req.prompt.slice(req.prompt.indexOf("Pairs:\n") + 7));
      const r = pairs.filter(p => p.id === reviewFail && !seen.has("v" + p.id)).map(p => { seen.add("v" + p.id); return { id: p.id, issue: "meaning changed" }; });
      return { json: { r }, usage };
    }
    throw new Error("unexpected prompt");
  };
  return { llm, calls };
}

const cfg = role => ({ role, provider: "anthropic", model: "claude-opus-5-5", apiKey: "k" });

test("glossary first, verified, filtered to terms in the paper", async () => {
  const doc = parseProject(readSample());
  const tr = newTranslation(doc, "p", "vi", cfg("translator"), cfg("verifier"));
  const { llm, calls } = mockLLM(doc);
  await runPipeline({ doc, tr, translator: cfg("translator"), verifier: cfg("verifier"), llm });
  assert.match(calls.prompts[0], /List the technical terms/, "the first call is the glossary");
  const terms = tr.glossary.terms.map(t => [t.en, t.native]);
  assert.deepEqual(terms, [["cross-encoder", "bộ mã hóa chéo"], ["hallucination", "ảo giác"]]);
  assert.deepEqual(tr.glossaryDropped.map(d => d.en), ["results"]);
});

test("local failures and reviewer flags are retried with notes, then pass", async () => {
  const doc = parseProject(readSample());
  const tr = newTranslation(doc, "p", "vi", cfg("translator"), cfg("verifier"));
  const { llm, calls } = mockLLM(doc);
  const stages = new Set();
  await runPipeline({ doc, tr, translator: cfg("translator"), verifier: cfg("verifier"), llm, onProgress: p => stages.add(p.stage) });
  assert.equal(tr.status, "complete");
  assert.equal(tr.sents.s4.status, "ok", "placeholder loss fixed on retry");
  assert.equal(tr.sents.s9.status, "ok", "review issue fixed on retry");
  assert.equal(tr.sents.s4.attempts, 2);
  assert.ok(calls.prompts.some(p => /review_notes/.test(p) && /placeholders/.test(p)), "retry carries the reason");
  assert.deepEqual([...stages], ["glossary", "glossary-check", "translate", "verify", "done"]);
  assert.equal(tr.report.fallback, 0);
  assert.equal(tr.report.flagged, 0);
  assert.equal(tr.usage.calls, calls.translator + calls.verifier);
  assert.ok(tr.usage.verifier.calls > 0 && tr.usage.translator.calls > 0);
});

test("sentences that never pass local checks fall back to English", async () => {
  const doc = parseProject(readSample());
  const tr = newTranslation(doc, "p", "vi", cfg("translator"), cfg("verifier"));
  const id = doc.sents.find(s => s.en.startsWith("Given a question")).id;
  const { llm } = mockLLM(doc, { alwaysBreak: id });
  await runPipeline({ doc, tr, translator: cfg("translator"), verifier: cfg("verifier"), llm, settings: { maxRetries: 1 } });
  assert.equal(tr.sents[id].status, "fallback");
  assert.equal(tr.report.fallback, 1);
  const { tex } = assembleTex(doc, tr, { termMode: "english", share: 0 });
  assert.match(tex, /Given a question \$q\$, a dense retriever/);
});

test("a finished translation is not re-run (no wasted credits)", async () => {
  const doc = parseProject(readSample());
  const tr = newTranslation(doc, "p", "vi", cfg("translator"), cfg("verifier"));
  const first = mockLLM(doc);
  await runPipeline({ doc, tr, translator: cfg("translator"), verifier: cfg("verifier"), llm: first.llm });
  const again = mockLLM(doc);
  await runPipeline({ doc, tr, translator: cfg("translator"), verifier: cfg("verifier"), llm: again.llm });
  assert.equal(again.calls.translator + again.calls.verifier, 0);
});

test("a cancelled run resumes where it stopped", async () => {
  const doc = parseProject(readSample());
  const tr = newTranslation(doc, "p", "vi", cfg("translator"), cfg("verifier"));
  const ac = new AbortController();
  const { llm } = mockLLM(doc);
  let n = 0;
  const stopping = async (c, req, o) => { if (/Translate each sentence/.test(req.prompt) && ++n === 2) ac.abort(); if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError"); return llm(c, req, o); };
  await assert.rejects(runPipeline({ doc, tr, translator: cfg("translator"), verifier: cfg("verifier"), llm: stopping, signal: ac.signal, settings: { batchChars: 400, concurrency: 1 } }), /Aborted/);
  const doneBefore = Object.keys(tr.sents).length;
  assert.ok(doneBefore > 0 && doneBefore < doc.sents.length);
  const resumed = mockLLM(doc);
  await runPipeline({ doc, tr, translator: cfg("translator"), verifier: cfg("verifier"), llm: resumed.llm, settings: { batchChars: 400 } });
  assert.equal(tr.status, "complete");
  assert.ok(!resumed.calls.prompts.some(p => /List the technical terms/.test(p)), "glossary is not redone");
});

test("estimate gives a call count and token figures", () => {
  const doc = parseProject(readSample());
  const e = estimate(doc);
  assert.ok(e.calls >= 3);
  assert.ok(e.translator.input > 0 && e.verifier.input > 0);
});
