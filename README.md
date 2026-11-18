# TAPER: Translation-Assisted Progressive English Reading

TAPER translates an English research paper, written in LaTeX, into a researcher's own language, then moves them toward reading it in English over a set number of weeks. Technical terms come first: from week 1 they stay in English, because most of them only exist in English anyway.

- **Upload the paper's LaTeX source** (.zip, e.g. from arXiv). Equations, figures, tables, citations and references are kept exactly.
- **An LLM translates, a second LLM verifies.** Pick the provider and model for each: Anthropic, OpenAI, Google Gemini, OpenRouter, or a local model such as Ollama.
- **One translation, every level.** The paper is translated once per language. Each weekly level (how terms are shown, what share of sentences is in English) is rebuilt locally, so it costs no extra credits.
- **A weekly plan** that the LLM drafts and adjusts, and the reader edits.
- **Reader:** the compiled translated PDF large, the English original beside it, minimise and maximise either one, click a technical term to see both languages.
- **Library** of past translations: reopen any paper for free, export or import everything.
- **Help** on every page (**?**), a Help tab, and guides in [docs/](docs/).
- **Study log** (CSV/JSON) and a feedback Google Form for the course study.

## Run it

```
python run.py
```

This serves the app at http://localhost:8000/index.html and opens it in your browser. It uses only the Python standard library.

If MacTeX/TeX Live (latexmk + XeLaTeX) or [Tectonic](https://tectonic-typesetting.github.io) is installed, PDFs are compiled on your computer. Otherwise the app compiles in the browser (see below).

| Option | What it does |
|---|---|
| `--port 8001` | Use another port. The library is stored per address, so keep using one |
| `--no-browser` | Don't open a browser |
| `--cors` | Let the GitHub Pages site use this computer's LaTeX (then set Settings → Local helper address to `http://localhost:8000`) |
| `--tex-path DIR` | Extra folder to look for latexmk / xelatex / tectonic |

The app opens with a **sample paper that is already translated** into all nine languages, with ready-made PDFs, so you can try the reader with no API key. To translate your own papers:

1. **Settings:** paste an API key and choose a translator and a verifier model.
2. **My plan:** set your language, start date and weeks, then draft a plan.
3. **Translate:** upload a LaTeX .zip, or use the sample paper.

## Publish on GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages → Source** and choose **GitHub Actions**.

[.github/workflows/pages.yml](.github/workflows/pages.yml) runs the tests and publishes the app together with BusyTeX (TeX Live 2026 in WebAssembly), so the site compiles LaTeX in the browser. The site is about 700 MB. The first compile in each browser downloads about 235 MB of TeX files (more only if a paper needs uncommon packages); after that they are cached.

Private repositories need a paid GitHub plan for Pages. Otherwise run it locally.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/`, `src/` | The app (ES modules, no build step) |
| `run.py` | Local server and LaTeX compile helper |
| `sample/` | Sample paper: source and .zip, translations in every language (`sample/translations/`), pre-built PDFs (`sample/pdfs/`, rebuilt with `node tools/build_sample_pdfs.mjs`) |
| `tex/` | LaTeX packages missing from the browser TeX bundles (xeCJK, algorithms), copied unmodified from TeX Live |
| `docs/USER_GUIDE.md` | How to use TAPER |
| `docs/DEVELOPER.md` | Architecture, data model, pipeline, deployment, adding languages/providers |
| `google-form/create_form_latex.gs` | Builds the feedback Google Form for this version |
| `google-form/create_form.gs` | The original form (unchanged) |
| `tests/` | Unit tests |
| `legacy/` | The original passage-based TAPER reader, its build script, public-repo version and tests |

## Test

```
npm install
npm test
```

## Google Form

[google-form/create_form_latex.gs](google-form/create_form_latex.gs) builds a new feedback form. It mirrors the original form (same five pages and question styles), reworded for the translator.

1. Paste it into a new project at https://script.google.com.
2. Set `TAPER_URL` to your GitHub Pages address.
3. Run `createTaperLatexForm`.

The log prints the edit link, the participant link and the responses sheet. The original `create_form.gs` is unchanged.

## Notes

- Machine translation is a starting point. Check the verification report, and have a native speaker review papers used with participants.
- API keys stay in the browser and are sent only to the chosen provider.
- BusyTeX is AGPL-3.0. Publishing the site with it is fine for a public course repository.
