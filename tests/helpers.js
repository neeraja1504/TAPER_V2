import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readSample() {
  const root = path.join(ROOT, "sample", "sample-paper");
  const files = {};
  const walk = d => fs.readdirSync(d).forEach(f => {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files[path.relative(root, p).split(path.sep).join("/")] = new Uint8Array(fs.readFileSync(p));
  });
  walk(root);
  return files;
}

/* A fake translation of the sample paper: "VI:" + the English, with glossary terms marked. */
export function fakeTranslation(doc, lang = "vi") {
  const terms = [
    { id: "t1", en: "retrieval-augmented generation", native: "sinh văn bản tăng cường truy xuất", def: "generation conditioned on retrieved text" },
    { id: "t2", en: "cross-encoder", native: "bộ mã hóa chéo", def: "model scoring a pair jointly" },
    { id: "t3", en: "hallucination", native: "ảo giác", def: "unsupported generated claim" },
    { id: "t4", en: "dense retriever", native: "bộ truy xuất dày đặc", def: "vector-based retriever" }
  ];
  const sents = {};
  const re = /(retrieval-augmented generation|cross-encoder|hallucination|dense retriever)/gi;
  for (const s of doc.sents) sents[s.id] = { tr: "VI: " + s.en.replace(re, m => `[[${m.toLowerCase()}]]`), status: "ok" };
  return { id: "p|" + lang, paperId: "p", lang, glossary: { terms, done: true }, sents };
}
