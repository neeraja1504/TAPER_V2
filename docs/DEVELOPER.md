# TAPER developer guide

How the LaTeX translator is built, how data flows through it, and how to change, test and deploy it.

## Overview

TAPER is a static web app with no build step: plain ES modules in `src/`, one HTML page, one stylesheet. It runs from GitHub Pages or from `python run.py`. Everything that needs a server is optional:

- **LLM calls** go straight from the browser to the provider (Anthropic, OpenAI, Gemini, OpenRouter, any OpenAI-compatible endpoint).
- **LaTeX compilation** goes to the local helper in `run.py` (latexmk/XeLaTeX or Tectonic) when it is running, otherwise to BusyTeX (TeX Live 2026 in WebAssembly) in a Web Worker.
- **Storage** is IndexedDB (papers, translations, compiled PDFs, quizzes) plus localStorage (settings, profiles, study log).

```
upload .zip ──► latex.js: find main, flatten \input, segment, placeholders, sentences ──► doc
                                                                                           │
             pipeline.js: glossary ─► glossary check ─► translate ─► verify ─► retry ◄─────┘
                          (translator)   (verifier)     (translator)  (local + verifier)
                                                                                           │
                                                                    translation record (tr)│
level (termMode, share) ──► assemble.js: rebuild LaTeX for that level, add fonts/macros ◄──┘
                                       │
                         compile.js: local helper or BusyTeX ──► PDF ──► viewer.js (PDF.js + term hotspots)
```

The key design choice: **one translation per paper and language; every level is assembled locally.** The translator marks technical terms as `[[English key]]` in each translated sentence. A level only decides:

1. how each `[[key]]` is shown: native term, "native (English)", or English
2. which sentences are replaced by the original English

So moving up a week, or reopening a paper, costs no LLM calls. Levels are also consistent: the English set grows monotonically, shortest sentences first.

## Files

| File | Role |
|---|---|
| `index.html` | Page shell: header, tabs, all views, help drawer, term popup |
| `css/app.css` | Styles; light/dark tokens; amber = native, blue = English |
| `src/app.js` | UI wiring: library, translate, reader, plan, settings, study data, help |
| `src/latex.js` | Parsing: comments, main-file detection, `\input` flattening, segmentation into raw LaTeX and prose blocks, placeholders, sentence splitting |
| `src/assemble.js` | Builds the translated `.tex` for a level: term rendering, escaping, local checks, XeLaTeX compatibility, per-language font setup, `\taperterm` macro, project files |
| `src/pipeline.js` | Glossary → check → translate → verify → retry → finalise; resumable; usage accounting; cost estimate |
| `src/prompts.js` | Every prompt (glossary, glossary check, translate, verify, plan, plan adjustment, quiz) |
| `src/providers.js` | Provider adapters, retries, JSON parsing, model listing |
| `src/levels.js` | Levels, default and AI plan normalisation, current week, English sentence selection |
| `src/compile.js` | Local helper client, BusyTeX runner, font download/cache, log summary |
| `src/viewer.js` | PDF.js viewer with lazy pages and clickable term/link hotspots |
| `src/store.js` | IndexedDB + localStorage helpers |
| `src/help.js` | In-app help topics (keep in step with `USER_GUIDE.md`) |
| `src/langs.js` | Languages and their Noto font files |
| `run.py` | Static server + `/api/health` + `/api/compile` |
| `tex/` | xeCJK (LPPL) and algorithms/algorithmicx (LGPL/LPPL), unmodified from TeX Live: added to browser compiles only when a paper loads them, because no BusyTeX bundle contains them |
| `tools/make_sample.py` | Builds `sample/sample-paper.zip` |
| `.github/workflows/pages.yml` | Tests, then deploys the site + BusyTeX to GitHub Pages |
| `google-form/create_form_latex.gs` | Feedback form for TAPER 2 (the original `create_form.gs` is unchanged) |
| `legacy/` | The original passage-based TAPER reader and its tests |

## Parsing (`latex.js`)

1. **Main file:** a `.tex` with `\documentclass` and `\begin{document}`. Prefers `main/ms/paper.tex`, then the shallowest path, then the largest.
2. **Flatten:** inline `\input`, `\include` (adds `\clearpage`) and `\subfile` of `.tex` files, relative to the main file's folder.
3. **Comments** are removed but the `%` is kept, so TeX's line joining is unchanged. Verbatim environments, `\verb` and `\url` are skipped.
4. **Segment:** the body is scanned once.
   - Kept raw, never translated: math environments, tables, verbatim, code, TikZ, algorithms, bibliographies, and structural commands at the start of a paragraph (`\includegraphics`, `\label`, `\vspace`, …).
   - Become their own units: headings, captions and `\title`.
   - Inside prose, these become placeholders `⟦n⟧`: inline and display math, citations, references, URLs, unknown macros, `\\`.
   - Formatting commands (`\emph`, `\textbf`, `\footnote`, …) stay in the text; the model keeps them and translates their content.
5. **Sentences** are split locally: brace-aware, with abbreviations (`e.g.`, `et al.`, `Fig.`) and initials handled. The English side is therefore always the exact source.
6. `restore()` puts placeholders back and inserts `{}` when a macro would otherwise run into a following letter (`\ours{}là`).

Rebuilding the English from a doc reproduces the flattened source (tested), so every untranslated sentence is byte-identical to the original.

## Pipeline (`pipeline.js`)

The translation record (`tr`) holds `glossary`, `sents[id] = { tr, status, issues, attempts }`, `report` and `usage`. It is saved after every batch, so runs are resumable. Sentence statuses:

| Status | Meaning |
|---|---|
| `pending` | Not yet translated (absent from `sents`) |
| `translated` | Passed local checks, waiting for review |
| `local-fail` | Failed local checks: placeholders, braces, new commands, or non-glossary `[[…]]`. Retried |
| `review-fail` | Verifier found a problem and gave no usable fix. Retried |
| `ok` | Passed review |
| `fixed` | Verifier supplied a fix that passes the local checks |
| `flagged` | Still failing review after the retries. Shown translated, listed in the report |
| `fallback` | Still failing local checks. **Shown in English** so the document always compiles |

Glossary terms that never occur in the English text are dropped, which guards against invented terms.

If a batch answer is cut off (`too_long`), the batch is split in half and retried.

## Assembly (`assemble.js`)

- `assembleTex(doc, tr, level)` returns `{ tex, nativePct }`.
- Terms are written as follows:
  - in paragraphs: `\taperterm{id}{en|n}{text}`, which wraps the text in a dvipdfmx link annotation to `https://taper.term/<id>`; `viewer.js` turns those links into clickable hotspots
  - in headings and captions: `\tapertermplain` (colour only), because those strings travel into bookmarks and the table of contents
- **Preamble additions** go right before `\begin{document}`:
  - `fontspec` (with `no-math`) and `xcolor`
  - colours and the term macros
  - per language: Noto Serif for Vietnamese and Russian; `xeCJK` with Noto Sans SC/KR/JP for Chinese, Korean and Japanese; a `\taperdeva` font family for Hindi, wrapped around Devanagari runs
  - TeX Gyre Termes or Pagella when the paper used Times or Palatino
- **pdfTeX-only settings** are removed so the source builds with XeLaTeX: `\pdfoutput`, `\pdfminorversion`, `glyphtounicode`, and `pdftex` driver options.
- `buildProjectFiles` = original files + flattened translated main + `taper-fonts/` + `TAPER-README.txt`.

## Providers (`providers.js`)

`callLLM(cfg, { system, prompt, maxTokens })` returns `{ text, json, usage }`. It retries 408/429/5xx and malformed JSON with backoff; 4xx errors fail fast.

Anthropic requests:

- send `anthropic-dangerous-direct-browser-access: true`
- send `output_config.effort` for models that support it
- enable server-side refusal fallbacks (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta) on models that support them
- turn `stop_reason: "refusal"` and `"max_tokens"` into clear errors

To add a provider, add an entry to `PROVIDERS` and a branch in `callOnce` and `listModels`.

## Compilation

### `run.py`

- `POST /api/compile` takes `{ main, engine, files: {path: base64} }` and returns `{ ok, pdf, log, engine }`.
- It tries latexmk (`-xelatex`/`-pdf`, nonstop mode, `-f` so recoverable errors still give a PDF), then Tectonic, then plain xelatex + bibtex.
- Paths are checked for traversal. It binds to 127.0.0.1 only, and shell escape is never enabled.
- `--cors` adds CORS and Private Network Access headers on `/api/*`, so the GitHub Pages site can use it.

### Browser (BusyTeX)

- `texlyre-busytex@1.4.1` is imported from jsDelivr. Its worker and data files must be same-origin, under `vendor/busytex/`.
- **Bundles:** `texlive-recommended` (≈200 MB, includes fontspec, xcolor, booktabs, hyperref, natbib, TeX Gyre) is preloaded. `texlive-extra` (≈340 MB: multirow, cleveref, enumitem, siunitx, pgfplots, …) is listed as a catalog package, which BusyTeX downloads only when a compile needs one of its files. The engine itself is ≈32 MB. Everything is cached in IndexedDB by Emscripten.
- **Missing from every bundle:** `xeCJK` (needed for Chinese, Japanese, Korean) and the `algorithm`/`algorithmic`/`algpseudocode` family. `compile.js` (`neededSupplements`) adds them from `tex/` when a `.tex` file loads them. To support another missing package, put its files in `tex/` and add it to `SUPPLEMENTS`.
- **Remote package server:** BusyTeX can fetch packages on demand from a TeX Live server (Settings → TeX package server). The public `texlive2026.texlyre.org` server did not respond during testing, so this is off by default.
- Measured in headless Chromium: the sample paper compiles in about 25 s on first use (Vietnamese, Chinese, Hindi), mostly loading the bundle; later compiles take a few seconds.
- The deploy workflow downloads them. For a local test, run `npx texlyre-busytex@1.4.1 download-assets vendor` (about 520 MB; `vendor/` is git-ignored).
- **Licence:** BusyTeX is AGPL-3.0. Publishing the site with it means the site's source must be available under compatible terms. That is fine for a public course repository; check before using it in anything closed.

### Original PDF

The original is compiled with the paper's own engine. If that fails, for example when only Tectonic is available for a pdfLaTeX paper, it is compiled again with XeLaTeX after the same compatibility fixes. Users can upload the original PDF instead.

## Storage

| Store | Key | Contents |
|---|---|---|
| `papers` | paper id (first 16 hex of the zip's SHA-256) | title, parsed `doc`, original `zip` Blob, `originalPdf` Blob |
| `translations` | `paperId\|lang` | `tr` record (glossary, sentences, report, usage, models) |
| `renders` | `paperId\|lang\|levelKey\|opts\|tr.updatedAt` | compiled PDF Blob, nativePct. Stale ones are pruned when a translation changes |
| `quizzes` | `paperId\|lang` | generated questions |

localStorage keys are prefixed `taper2:`: `settings`, `profiles`, `activeProfile`, `log`, `keys` (only with *Remember keys*), `level:<profile>:<paper|lang>`, `view`, `lastOpen`. Without *Remember keys*, keys live in sessionStorage.

## Study log

Each row has these columns: `time, profile, week, type, paper, lang, level, nativePct, view, detail`.

Event types:

- **Papers and translation:** `paper-loaded`, `translate-start`, `translate-done`, `translate-stopped`
- **Reading:** `open`, `level`, `view`, `read` (seconds, logged when leaving a level/tab/page), `lookup`, `panel`, `checkin`, `quiz-made`, `quiz`
- **Compiling:** `compiled`, `compile-failed`
- **Plan and profile:** `plan-ai-draft`, `plan-ai-adjust`, `plan-accepted`, `plan-discarded`, `plan-saved`, `profile`, `profile-saved`
- **Other:** `download`, `help`, `library-export`, `retranslate`

## Testing

```
npm install
npm test            # unit tests: parsing, assembly, pipeline (mock LLM), providers (mock fetch), plans
npm run test:legacy # the original reader's tests
```

The unit tests cover:

- round-tripping the sample paper
- protected environments
- sentence splitting
- every preset level assembling to balanced LaTeX
- term modes, font setup per language, and XeLaTeX compatibility
- the retry/fallback paths and resume after cancel
- provider request formats

To check real compilation, compile a downloaded LaTeX .zip from the app with `tectonic main.tex` or `latexmk -xelatex main.tex`. During development:

- the sample paper was compiled in Vietnamese, Chinese, Japanese, Korean, Hindi, Spanish and Russian at several levels with Tectonic 0.17
- the source of arXiv 1706.03762 was compiled in Chinese with Tectonic
- the sample paper was compiled in Vietnamese, Chinese and Hindi in the browser with BusyTeX
- the whole UI (settings, plan, translate, reader, popups, panels, library, study data) was driven in headless Chromium with a mocked model API

## Deploying to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/pages.yml`. It runs the tests, copies the app, downloads BusyTeX (cached between runs), and deploys. The site is about 700 MB, under the 1 GB Pages limit; browsers only download the parts they use.
4. Put the site address into `TAPER_URL` in `google-form/create_form_latex.gs`.

A private repository can use GitHub Pages only on paid plans. Otherwise run locally with `python run.py`.

## Adding a language

Add an entry to `LANGS` in `src/langs.js` with `script`, which is one of:

- `latin`: no font change
- `latin-ext`: Noto Serif
- `cjk`: xeCJK, with one `fonts[0]` file
- `deva`: Devanagari font switch

and the font URLs (served with CORS). Another script needs a branch in `taperPreamble`, plus a wrapper like `wrapDevanagari` if XeTeX should switch fonts per run. Then add the language to the Google Form list.

## Known limits

- Right-to-left scripts are not supported (they need bidi handling).
- Text inside tables, TikZ figures and algorithms stays in English.
- Paper-specific macros that expand to prose (`\newcommand{\ours}{our method}`) stay as they are; they are placeholders.
- Very large papers mean many calls. The estimate is shown before starting.
- The browser engine cannot convert EPS figures and may lack rare packages; the local helper and the LaTeX .zip cover those cases.
