# TAPER user guide

TAPER (Translation-Assisted Progressive English Reading) helps researchers read English papers faster while they learn to read them in English. You give it a paper's LaTeX source. It translates the paper into your language once, then shows it to you at a level that moves toward English week by week. Technical terms always come first: they stay in English from the start, because most of them only really exist in English.

The same help is built into the app: every page has a **?** button, and there is a **Help** tab.

---

## 1. Opening TAPER

- **On the web:** open the GitHub Pages address your team shared.
- **On your computer:** in the project folder, run

  ```
  python run.py
  ```

  It opens `http://localhost:8000/index.html`. Keep using the same address and port: your library is stored per address.

Do not open `index.html` by double-clicking it. Browsers block parts of the app on `file://` pages.

## 2. First-time setup

### Add a model (Settings)

1. Paste an API key for at least one provider:

   | Provider | Where to get a key | Notes |
   |---|---|---|
   | Anthropic (Claude) | platform.claude.com | Default model `claude-opus-5-5` |
   | OpenAI | platform.openai.com | Press **List models**, pick one |
   | Google Gemini | aistudio.google.com | Press **List models**, pick one |
   | OpenRouter | openrouter.ai | Many models with one key |
   | Custom / local | — | Any OpenAI-compatible server, e.g. Ollama at `http://localhost:11434/v1` (start it with `OLLAMA_ORIGINS=*`) |

2. Choose the **translator** and the **verifier**:
   - The **translator** writes the glossary and the translation, and drafts plans and quizzes.
   - The **verifier** checks the glossary and every translated sentence. It can be a different provider.
3. Press **Test** next to each to make sure the key and model work.

Keys are kept only in your browser: for this tab by default, or on this device if you tick **Remember keys**. They are sent only to the provider you chose.

### Make your plan (My plan)

1. Enter your name or participant ID, native language, field, start date and number of weeks (12 by default).
2. Rate how hard reading English papers is for you (1–5).
3. Press **Draft a plan with AI**. The translator proposes a level for each week, with a short reason. Press **Use this plan**, or **Discard**.
4. Change any week by hand (technical terms, percentage of English sentences, a note), then press **Save plan**.

Later, open **Adjust with AI…**, say how it is going ("week 3 was too fast"), and TAPER suggests changes for the remaining weeks. Nothing changes until you accept.

Several people can share one computer. Use the **Reader** menu in the header to switch or add readers. Each reader has their own plan; the library is shared, so nobody pays twice for the same paper.

## 3. Translating a paper (Translate)

1. **Get the LaTeX source.** On arXiv, open the paper, choose *Other formats* (or *TeX Source*), and download the source. If it arrives as `.tar.gz`, unpack it and zip the folder.
2. Drop the `.zip` on the page, or press **Use the sample paper**.
3. Check what TAPER found: title, main file, number of sentences, figures and bibliography. If the zip holds several main files, choose the right one.
4. (Optional) Add the original PDF. Otherwise TAPER compiles the original from the source.
5. Choose the language and press **Translate**.

You will see the steps:

| Step | What happens |
|---|---|
| Glossary | The translator lists the paper's technical terms, their standard translation and a short definition. Always first. |
| Glossary check | The verifier corrects wrong translations and removes words that are not technical terms. |
| Translating | Sentences are translated in batches. Equations, citations, references, tables and code are never translated; they are protected and put back exactly. |
| Checking | Each sentence is checked automatically (protected parts, braces, LaTeX commands) and then by the verifier for meaning, terms and fluency. |
| Retries | Sentences that fail go back to the translator with the reviewer's notes (2 retries by default). |

**Cancel** at any time. Finished work is saved; **Resume** continues where it stopped. An estimate of model calls and tokens is shown before you start.

If you upload a paper that is already in your library, TAPER says so and opens it without new calls.

## 4. Reading (Reader)

- The **translated PDF** fills most of the window; the **English original** is beside it.
  - **Side by side / Translated / Original** switch the layout.
  - **–** and **⤢** on each pane minimise or maximise it. A button in the corner brings the other pane back.
  - **−  Fit  +** zoom.
- **Level** sets how much is in English:
  - presets from *All native* to *All English*
  - **Use my week N level** follows your plan
  - **Fine-tune** sets the technical-term mode and the exact percentage of English sentences

  The shortest sentences switch to English first, and once a sentence is English it stays English at higher levels. Each level is compiled once and kept, and **changing level never uses model credits**.
- **Coloured terms**: blue is an English technical term, amber is a translated term. Click one to see both languages and a definition.
- **PDF** and **LaTeX .zip** download the current level. The .zip includes the fonts; compile it with XeLaTeX (`latexmk -xelatex main.tex`, `tectonic main.tex`, or Overleaf with the XeLaTeX compiler).
- **Glossary**: every technical term in the paper, searchable. **Download CSV** to make flashcards (Anki, Quizlet).
- **Report**: what the verifier corrected, any sentences it flagged, any sentences left in English because they failed the checks, and the tokens used. **Translate … again** retries just those sentences.
- **Check my understanding** (optional): rate how the level felt, or make a short quiz (questions in English with your language underneath). Nothing pops up on its own and nothing is required.

## 5. Library

Every paper and language you have translated, with its status, models, tokens used and compiled levels.

- **Open** reads it again for free.
- **Translate into another language** reuses the paper.
- **Export library** saves everything (sources, translations, original PDFs, quizzes) to one .zip. Use it as a backup or to move to another browser. **Import library** merges such a file back.

The library lives in your browser. Clearing site data deletes it, so export now and then.

## 6. Compiling: what you need

The translated paper is compiled with XeLaTeX. There are two ways:

| | Local helper | In the browser |
|---|---|---|
| How | `python run.py`, with MacTeX / TeX Live (latexmk + XeLaTeX) or Tectonic installed | Nothing to install (BusyTeX: TeX Live 2026 in WebAssembly) |
| First run | Instant | Downloads ~235 MB of TeX files once (plus ~340 MB if a paper needs less common packages); the browser caches them |
| Coverage | Any paper your TeX installation can build | Most papers; EPS figures and rare packages can fail |

**Settings → Compiling PDFs → Compile with** chooses: *Auto* (helper if running, otherwise browser), *Local helper only*, or *Browser only*.

To use your computer's LaTeX from the GitHub Pages site, run `python run.py --cors` and set **Local helper address** to `http://localhost:8000`.

Install a compiler:

- macOS: `brew install tectonic`, or MacTeX from tug.org/mactex
- Windows: MiKTeX or TeX Live, or Tectonic
- Linux: `sudo apt install latexmk texlive-xetex texlive-latex-extra`, or Tectonic

## 7. Study data

The **Study data** tab logs, per reader and week:

- opening papers
- level and layout changes
- reading time
- term lookups
- optional check-ins and quizzes
- plan drafts, edits and acceptances
- compiles and downloads

**Export CSV** after each session. API keys and paper text are never logged.

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| "Add your … API key" | Settings → paste the key for the provider you selected |
| 401 / 403 | Key wrong, expired, or out of credit |
| 429 | Rate limit. TAPER waits and retries; lower *Parallel requests* in Settings if it keeps happening |
| "No main .tex file found" | The zip needs a `.tex` with `\documentclass` and `\begin{document}` |
| Compile failed | Read the log excerpt shown. Convert EPS figures to PDF; use the local helper or Overleaf for unusual packages; you can always download the LaTeX .zip |
| Original failed to compile | Upload the original PDF (e.g. from arXiv) with **Upload the original PDF** |
| Ollama gives a network error | Start Ollama with `OLLAMA_ORIGINS=*` |
| Blank page | Use `python run.py` or the web address, not a `file://` page |
| Library is empty | Browser storage was cleared, or you are on a different port or address. Import your last export |

## 9. Good to know

- Machine translation is a starting point. Use the report, and have a native speaker check papers used in a study.
- Paper text goes only to the model provider you chose. Fonts and TeX files come from public CDNs.
- Right-to-left languages (Arabic, Persian, Hebrew) are not supported yet.
