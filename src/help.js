/* In-app help. Each topic is shown in the "?" drawer (contextual) and on the Help page.
 * Keep this in step with docs/USER_GUIDE.md. */

export const TOPICS = [
  { id: "start", title: "Getting started", html: `
<p>TAPER translates an English research paper written in LaTeX into your language, then moves you toward reading it in English week by week. Technical terms come first: they stay in English from the start, because most of them only really exist in English.</p>
<p><b>Try it first with the sample paper.</b> It is already translated into every language and opens instantly, with no API key and no credits. Change the level or the language at the top of the Reader.</p>
<ol>
<li><b>Set up a model.</b> In <a href="#settings">Settings</a>, paste an API key (Anthropic, OpenAI, Google Gemini, OpenRouter, or a local model) and pick a <em>translator</em> and a <em>verifier</em> model.</li>
<li><b>Tell TAPER about you.</b> In <a href="#plan">My plan</a>, choose your language, your start date and how many weeks you want. Ask the AI to draft a plan, then edit it.</li>
<li><b>Translate a paper.</b> In <a href="#new">Translate</a>, upload the paper's LaTeX source as a .zip (on arXiv: "Other formats → Download source"). Or try the sample paper.</li>
<li><b>Read.</b> The <a href="#reader">Reader</a> shows the translated PDF large, with the English original beside it. Click a coloured term to see it in both languages.</li>
</ol>
<p>Every paper is translated <b>once</b> per language. All reading levels are built from that translation, so moving up a week, or opening the paper again from the <a href="#library">Library</a>, costs no credits.</p>` },

  { id: "translate", title: "Translating a paper", html: `
<p><b>What to upload:</b> a .zip of the paper's LaTeX source: the main .tex file, any \\input files, figures, and the .bib or .bbl file. arXiv papers: open the paper page, choose <em>Other formats</em> (or <em>TeX Source</em>) and download the source; if it arrives as .tar.gz, unpack it and zip the folder.</p>
<p><b>What gets translated:</b> titles, headings, paragraphs, lists, captions and footnotes. Equations, citations, references, labels, tables, code and figures are never sent to the model's output; they are replaced by placeholders like ⟦12⟧ and put back exactly.</p>
<p><b>The steps you will see:</b></p>
<ol>
<li><b>Glossary</b>: the translator lists the paper's technical terms with their standard translation and a short definition. This always comes first.</li>
<li><b>Glossary check</b>: the verifier corrects wrong translations and drops words that are not technical terms.</li>
<li><b>Translating</b>: sentences are translated in batches. Technical terms are marked so every level can be built later without new calls.</li>
<li><b>Checking</b>: each sentence is checked automatically (placeholders, braces, LaTeX commands), then by the verifier model for meaning, terms and fluency.</li>
<li><b>Retries</b>: sentences that fail go back to the translator with the reviewer's notes (2 retries by default).</li>
</ol>
<p>You can cancel at any time. Finished work is saved, and <em>Resume</em> continues where it stopped. Optionally add the original PDF; otherwise TAPER compiles the original from the source.</p>` },

  { id: "levels", title: "Levels: how much is in English", html: `
<p>A level has two parts:</p>
<ul>
<li><b>Technical terms</b>: translated · translated with the English term in brackets · kept in English.</li>
<li><b>English sentences</b>: the percentage of sentences shown in the original English. The shortest sentences switch first, and a sentence that is English at one level stays English at every higher level.</li>
</ul>
<p>The presets go from <em>All native</em> to <em>All English</em>. <em>Native text, technical terms in English</em> is where the plan starts. Changing level only rebuilds the PDF locally: it never uses credits.</p>` },

  { id: "plan", title: "My plan and weekly progress", html: `
<p>Your plan says which level to read at in each week. TAPER works out the current week from your start date (or you can set the week yourself).</p>
<ul>
<li><b>Draft a plan with AI</b>: the translator model proposes a plan from your language, field and English comfort. Nothing changes until you accept it.</li>
<li><b>Adjust with AI</b>: tell it how it is going ("too fast", "I'm comfortable, speed up") and it proposes changes for the remaining weeks.</li>
<li><b>Edit by hand</b>: change any week's term mode, English share or note, then Save.</li>
</ul>
<p>The plan is a suggestion. In the Reader you can always pick a different level for a paper.</p>
<p>Several people can share one computer: each reader has their own profile and plan (header menu). The library of translations is shared, so nobody pays twice for the same paper.</p>` },

  { id: "reader", title: "The reader", html: `
<p>The translated PDF fills the window. The English original sits beside it.</p>
<ul>
<li><b>Side by side / Translated / Original</b> (top right) maximise either PDF or show both. On narrow screens the panes stack.</li>
<li><b>– and ⤢</b> on each pane minimise or maximise it.</li>
<li><b>Level</b>: pick a preset, <em>Use my week</em>, or fine-tune terms and English share. Each level is compiled once and cached.</li>
<li><b>Coloured terms</b>: blue = English technical term, amber = translated term. Click one to see both languages and a definition. Lookups are counted in your study data.</li>
<li><b>Download</b>: the PDF, or the translated LaTeX as a .zip (with fonts) to compile yourself or upload to Overleaf with the XeLaTeX compiler.</li>
<li><b>Report</b>: the glossary, verifier corrections, and any sentences that were flagged or left in English.</li>
<li><b>Check my understanding</b> (optional): rate how a level felt, or ask for a short quiz. Nothing is required, and nothing pops up on its own.</li>
</ul>` },

  { id: "keys", title: "API keys and models", html: `
<p>TAPER calls the model provider directly from your browser with your own key. Supported:</p>
<ul>
<li><b>Anthropic (Claude)</b>: default <code>claude-opus-5-5</code>. Keys: platform.claude.com.</li>
<li><b>OpenAI</b>, <b>Google Gemini</b>, <b>OpenRouter</b>: paste a key, then <em>List models</em> and pick one.</li>
<li><b>Custom / local</b>: any OpenAI-compatible server, e.g. Ollama (<code>http://localhost:11434/v1</code>; start Ollama with <code>OLLAMA_ORIGINS=*</code> so the browser may call it).</li>
</ul>
<p><b>Translator vs verifier:</b> the translator writes the glossary and translations (and drafts plans and quizzes). The verifier checks them. They can be different providers. A strong model as verifier catches more problems; a cheaper translator plus a strong verifier is a reasonable way to save credits.</p>
<p><b>Keys are stored</b> only in this browser: for the session by default, or on this device if you tick <em>Remember keys</em>. They are sent only to the provider you chose. Do not use a shared computer with remembered keys.</p>` },

  { id: "compile", title: "Compiling the PDF", html: `
<p>Translated papers are compiled with <b>XeLaTeX</b> (needed for Chinese, Japanese, Korean, Hindi and Vietnamese fonts). TAPER can compile in two ways:</p>
<ul>
<li><b>Local helper</b> (most reliable): run <code>python run.py</code>. It uses latexmk + XeLaTeX from MacTeX / TeX Live, or Tectonic, if installed. To use it from the GitHub Pages site, run <code>python run.py --cors</code> and set the helper address in Settings to <code>http://localhost:8000</code>.</li>
<li><b>In the browser</b>: BusyTeX (TeX Live 2026 in WebAssembly). Nothing to install, but the first compile downloads about 235 MB (the TeX engine and the common LaTeX packages), and a paper that needs less common packages downloads about 340 MB more once. The browser caches everything. EPS figures and a few rare packages will not compile this way.</li>
</ul>
<p><em>Auto</em> uses the local helper when it answers and the browser otherwise. If a compile fails, open the log in the error message, or download the LaTeX .zip and compile it in Overleaf (set the compiler to XeLaTeX).</p>
<p>The original English PDF is compiled with the paper's own engine (usually pdfLaTeX), or you can upload the PDF from arXiv instead.</p>` },

  { id: "library", title: "Library and credits", html: `
<p>The Library keeps every paper you have translated, per language: the source, the translation, the glossary, the verification report and each compiled level.</p>
<ul>
<li><b>Open</b> reads it again for free.</li>
<li>Uploading the same .zip again is recognised, so you are not charged twice.</li>
<li>Token use per translation is shown so you can see what each paper cost.</li>
<li><b>Export</b> saves everything to one .zip (a backup, or to move to another browser). <b>Import</b> merges such a file back.</li>
</ul>
<p>The library lives in this browser's storage. Clearing site data deletes it, so export now and then.</p>` },

  { id: "check", title: "Check my understanding (optional)", html: `
<p>Nothing here is required. It is there if you want it.</p>
<ul>
<li><b>How did this level feel?</b> Two quick ratings and whether you want more English next time. These help the AI adjust your plan and are saved in your study data.</li>
<li><b>Quiz</b>: four multiple-choice questions about the paper's main ideas, in English with your language underneath. Generated once per paper and language (one model call), then reused.</li>
</ul>` },

  { id: "data", title: "Study data", html: `
<p>For the course study, TAPER logs what happens in the reader: opening papers, level changes, term lookups, reading time, optional check-ins and quizzes, plan changes. Each row has the reader profile and week.</p>
<p>Export the log as CSV or JSON after each session. It stays in this browser until you clear it. API keys and paper text are never written to the log.</p>` },

  { id: "privacy", title: "Privacy and costs", html: `
<ul>
<li>Paper text goes only to the model provider you choose. Nothing is sent anywhere else, except font and TeX downloads from public CDNs and, for in-browser compiling, package files fetched from the TeX Live mirror set in Settings.</li>
<li>Costs depend on the provider and model. Before you start, TAPER estimates the number of calls and tokens. A typical 10-page paper is roughly 20–60 calls.</li>
<li>Machine translation is a starting point. Use the verification report, and ask a native speaker to check papers used in a study.</li>
</ul>` },

  { id: "trouble", title: "Troubleshooting", html: `
<ul>
<li><b>"Add your … API key"</b>: open Settings and paste the key for the provider you selected.</li>
<li><b>401 / 403</b>: the key is wrong, expired or has no credit. <b>429</b>: rate limit; TAPER waits and retries automatically.</li>
<li><b>No main .tex found</b>: the zip must contain a .tex file with <code>\\documentclass</code> and <code>\\begin{document}</code>. If several do, choose the right one in the list.</li>
<li><b>Compile failed</b>: read the log excerpt. Common causes are EPS figures (convert to PDF), packages the browser engine lacks (use the local helper or Overleaf), or a custom class that needs pdfLaTeX. You can still download the LaTeX .zip.</li>
<li><b>Ollama / local model gives a network error</b>: start it with <code>OLLAMA_ORIGINS=*</code>.</li>
<li><b>The page is blank</b> when opened as a file: use <code>python run.py</code> or the GitHub Pages address. Browsers block modules on file:// pages.</li>
<li><b>Everything disappeared</b>: browser storage was cleared. Import your last library export.</li>
</ul>` }
];

export const TAB_TOPIC = { library: "library", new: "translate", reader: "reader", plan: "plan", settings: "keys", data: "data", help: "start" };
