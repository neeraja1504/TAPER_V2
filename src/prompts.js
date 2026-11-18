/* Prompts for the translator and the verifier. Every prompt asks for JSON only. */
import { TERM_MODES } from "./levels.js";

const json = o => JSON.stringify(o, null, 1);

/* Step 1a: technical terms first. */
export function glossaryPrompt(text, lang, title) {
  return {
    system: `You are an expert scientific terminologist and translator from English into ${lang}. You help ${lang}-speaking researchers learn the English vocabulary of their field.`,
    prompt: `Paper: "${title}"

List the technical terms in the text below: domain-specific vocabulary a researcher must learn in English to read papers in this field (for example "gradient descent", "attention mechanism", "false positive rate"). Include multi-word terms as a single entry. Do not include everyday academic words ("results", "method", "approach", "paper"), people, datasets or product names, or anything inside ⟦n⟧ placeholders.

For each term give:
- "en": the term in English, lower case unless it is an acronym or always capitalised, singular
- "native": the standard ${lang} term used in ${lang} academic writing. If ${lang} researchers normally keep the English word, give the usual ${lang} rendering (transliteration or established loanword)
- "def_native": a plain definition written in ${lang}, at most 20 words. This is what the reader sees first, so write it for a ${lang}-speaking researcher
- "def": the same definition in plain English, at most 15 words

Return only JSON: {"terms":[{"en":"...","native":"...","def_native":"...","def":"..."}]}

Text:
"""
${text}
"""`
  };
}

/* Step 1b: the verifier checks the glossary. */
export function glossaryVerifyPrompt(terms, lang, title) {
  return {
    system: `You are a strict reviewer of English–${lang} scientific terminology.`,
    prompt: `Paper: "${title}"

Review this English → ${lang} glossary of technical terms. Report only real problems:
- the ${lang} translation is wrong, non-standard, or not what ${lang} researchers actually use
- the entry is not a technical term (an everyday word, a name, a dataset)
- a definition is wrong, or the ${lang} definition is not written in ${lang}

Return only JSON: {"fixes":[{"en":"term exactly as listed","native":"corrected ${lang} term, if the translation was the problem","def_native":"corrected ${lang} definition, if needed","def":"corrected English definition, if needed","drop":true if it is not a technical term,"issue":"short reason"}]}
Return {"fixes":[]} if everything is fine.

Glossary:
${json(terms.map(t => ({ en: t.en, native: t.native, def_native: t.defNative || "", def: t.def })))}`
  };
}

/* Step 2: translate sentences. Terms are marked [[English key]] so every level can be built locally. */
export function translatePrompt(batch, lang, title, glossary, notes) {
  const hasNotes = notes && Object.keys(notes).length;
  return {
    system: `You are an expert scientific translator from English into ${lang}. You translate sentences of a LaTeX research paper for ${lang}-speaking researchers who are learning to read English papers.`,
    prompt: `Paper: "${title}"

Translate each sentence into natural, fluent, academically appropriate ${lang}.

Rules:
1. Translate the meaning faithfully. Do not add, drop or summarise content. Sentences in the same paragraph are given in order; use them as context.
2. Placeholders like ⟦12⟧ stand for math, citations, references or other LaTeX. Copy every placeholder exactly once and unchanged, in the grammatically right position.
3. Keep the LaTeX formatting commands that appear in the sentence (\\emph{...}, \\textbf{...}, \\footnote{...}, ~, \\%, \\&) and translate only the human text inside them. Keep curly braces balanced exactly as in the original. Do not add any other LaTeX commands. Write % & # _ $ as \\% \\& \\# \\_ \\$.
4. Technical terms: wherever a concept from the glossary appears, write it as [[English key]] using the exact English key from the glossary, not the ${lang} word. If ${lang} grammar needs a different form of the term in this sentence (plural, case, gender), write [[English key|inflected ${lang} form]], e.g. [[language model|<plural ${lang} form>]]. Everything around it (particles, case endings, articles) stays in ${lang} and must read naturally when the marker is later replaced by either the ${lang} term or the English term. Only glossary keys may appear before the "|" inside [[ ]].
5. Keep numbers, symbols, URLs and code unchanged.
${hasNotes ? "6. Some sentences were translated before and failed review. Fix the problems listed in \"review_notes\".\n" : ""}
Return only JSON with one entry per input id: {"t":[{"id":"s1","tr":"..."}]}

Input:
${json({ glossary: Object.fromEntries(glossary.map(t => [t.en, t.native])), sentences: batch.map(s => ({ id: s.id, en: s.en, ...(s.kind !== "para" ? { kind: s.kind === "head" ? "heading" : s.kind === "cap" ? "figure caption" : "title" } : {}) })), ...(hasNotes ? { review_notes: notes } : {}) })}`
  };
}

/* Step 3: the verifier checks the sentence translations. */
export function verifyPrompt(pairs, lang, title, glossary) {
  return {
    system: `You are a strict reviewer of English → ${lang} scientific translations.`,
    prompt: `Paper: "${title}"

Each pair has the English source ("en") and a ${lang} translation ("tr"). In "tr", [[key]] or [[key|inflected ${lang} form]] marks a technical term from the glossary; it will be shown either in ${lang} or in English depending on the reader's level.

Check every pair:
1. Meaning is preserved: no omissions, additions or mistranslations.
2. Glossary concepts are marked with [[key]] using the right key, and the sentence reads naturally both with the ${lang} term and with the English term in that slot.
3. Every ⟦n⟧ placeholder and LaTeX command from "en" is kept, in a sensible position.
4. The ${lang} is fluent and appropriate for a research paper.

Report only real problems; small stylistic choices are fine. For each problem give a short reason and, if you can, a corrected "fix" that follows the same rules.

Return only JSON: {"r":[{"id":"s3","issue":"...","fix":"corrected tr"}]}. Return {"r":[]} if all pairs are fine.

Glossary: ${json(Object.fromEntries(glossary.map(t => [t.en, t.native])))}

Pairs:
${json(pairs.map(p => ({ id: p.id, en: p.en, tr: p.tr })))}`
  };
}

const LEVEL_TEXT = `A level has two parts:
- "termMode": "native" (technical terms translated), "gloss" (translated, English term in brackets) or "english" (technical terms kept in English)
- "share": 0–100, the percentage of sentences shown in the original English (shortest sentences switch first)`;

/* Weekly plan drafted by the LLM; the user edits it afterwards. */
export function planPrompt(profile, langName) {
  return {
    system: "You design gentle, encouraging reading plans for researchers who are moving from reading papers in their native language to reading them in English.",
    prompt: `Design a ${profile.weeks}-week plan for this reader. Each week sets how much of a research paper is shown in English.

${LEVEL_TEXT}

Principles:
- Week 1 always starts by keeping technical terms in English ("termMode":"english"), because technical terms mostly exist in English anyway. Use "gloss" before that only if the reader's English comfort is 1.
- The share of English sentences rises steadily and never goes down. The last week reaches 100.
- Move more slowly for readers with low English comfort or few reading sessions per week, faster for confident readers.
- "focus" is one short, encouraging sentence (max 15 words) about what to pay attention to that week.

Reader:
${json({ nativeLanguage: langName, field: profile.field || "", englishComfort_1to5: profile.englishLevel || 3, papersPerWeek: profile.papersPerWeek || 1, weeks: profile.weeks, notes: profile.notes || "" })}

Return only JSON: {"plan":[{"week":1,"termMode":"english","share":0,"focus":"..."}],"rationale":"two or three sentences"}`
  };
}

export function adjustPlanPrompt(profile, langName, week, feedback, recent) {
  return {
    system: "You adjust reading plans for researchers moving from their native language to English. You are supportive, never pushy.",
    prompt: `The reader is in week ${week} of a ${profile.weeks}-week plan. Suggest a revised plan for weeks ${week}–${profile.weeks} based on their feedback. Keep earlier weeks unchanged.

${LEVEL_TEXT}

Keep the share non-decreasing from week ${week} onward and reach 100 by the last week, unless the reader explicitly asks to slow down, in which case the end can be below 100.

Reader: ${json({ nativeLanguage: langName, field: profile.field || "", englishComfort_1to5: profile.englishLevel || 3 })}
Current plan: ${json((profile.plan || []).map(r => ({ week: r.week, termMode: r.termMode, share: r.share })))}
Their feedback: ${JSON.stringify(feedback || "(none)")}
Recent optional self-ratings (1–5): ${json(recent || [])}

Return only JSON: {"plan":[{"week":${week},"termMode":"english","share":0,"focus":"..."}],"rationale":"two or three sentences addressed to the reader"}`
  };
}

/* Optional "check my understanding". */
export function quizPrompt(text, langName, title) {
  return {
    system: "You write short, fair comprehension questions about research papers.",
    prompt: `Paper: "${title}"

Write 4 multiple-choice questions that check whether a reader understood the main ideas of the paper (problem, method, key result, one important detail). Each has 4 options and one correct answer. Give each question and its options in English and in ${langName}.

Return only JSON: {"questions":[{"q":"English question","q_native":"${langName} question","options":["a","b","c","d"],"options_native":["a","b","c","d"],"answer":0}]}

Paper text (may be cut short):
"""
${text}
"""`
  };
}

export { TERM_MODES };
