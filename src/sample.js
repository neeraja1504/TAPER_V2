/* The sample paper that ships with TAPER, already translated into every supported language,
 * with PDFs pre-compiled for the common levels. It lets anyone try the reader with no API key,
 * no credits and no TeX download.
 *
 * sample/sample-paper.zip           LaTeX source
 * sample/translations/terms.json    English glossary definitions
 * sample/translations/<lang>.json   glossary translations + one translation per sentence
 * sample/pdfs/original.pdf          the English original
 * sample/pdfs/<lang>/<level>.pdf    compiled levels (see tools/build_sample_pdfs.mjs)
 */
import { makeReport } from "./pipeline.js";

export const SAMPLE = {
  zip: "sample/sample-paper.zip",
  translations: "sample/translations/",
  pdfs: "sample/pdfs/",
  langs: ["vi", "es", "zh", "hi", "ko", "ja", "pt", "fr", "ru"],
  version: "2026-11-18",
  /* Levels with a pre-compiled PDF: every 5% of English sentences with terms in English,
     plus the two fully native levels. */
  hasPdf: level => (level.termMode === "english" && level.share % 5 === 0) || (level.share === 0 && ["native", "gloss"].includes(level.termMode))
};

/* Builds a translation record (the same shape the pipeline produces) from a sample file. */
export function sampleTranslation(doc, paperId, data, defs) {
  const order = Object.keys(defs);
  const terms = order.filter(en => data.terms[en]).map((en, i) => ({ id: "t" + (i + 1), en, native: data.terms[en], def: defs[en] }));
  const sents = {};
  for (const s of doc.sents) {
    const tr = data.sents[s.id];
    sents[s.id] = typeof tr === "string" ? { tr, status: "ok", issues: [], attempts: 1 } : { status: "fallback", issues: ["not in the sample translation"] };
  }
  const tr = {
    id: `${paperId}|${data.lang}`, paperId, lang: data.lang, bundled: true,
    createdAt: SAMPLE.version + "T00:00:00.000Z", updatedAt: SAMPLE.version + "T00:00:00.000Z",
    translator: { provider: "bundled", model: "included with TAPER" },
    verifier: { provider: "bundled", model: "none" },
    status: "complete", glossary: { terms, done: true }, sents,
    usage: { input: 0, output: 0, calls: 0, translator: { input: 0, output: 0, calls: 0 }, verifier: { input: 0, output: 0, calls: 0 } }
  };
  tr.report = makeReport(doc, tr);
  return tr;
}

export const samplePdfUrl = (lang, levelKey) => `${SAMPLE.pdfs}${lang}/${levelKey}.pdf`;
