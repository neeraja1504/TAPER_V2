/**
 * Creates the feedback Google Form for TAPER 2 (the LaTeX paper translator).
 * It mirrors the original TAPER form (create_form.gs, which is left unchanged): the same five pages
 * and question styles, reworded for uploading a paper, the weekly plan, the translated/original
 * PDF viewer, term popups, the library and the verifier.
 *
 * How to run:
 *   1. Go to https://script.google.com and click "New project".
 *   2. Replace the code there with this whole file.
 *   3. Set TAPER_URL below to the public link of the translator (your GitHub Pages address).
 *   4. Click Run (function: createTaperLatexForm) and allow the permissions it asks for.
 *   5. Open the Execution log for the edit link, the link to send to participants, and the responses sheet.
 */

// Public link to the TAPER translator, e.g. "https://<username>.github.io/<repo-name>/".
const TAPER_URL = "";

const LANGUAGES = [
  "Vietnamese · Tiếng Việt",
  "Spanish · Español",
  "Chinese (Simplified) · 中文",
  "Hindi · हिन्दी",
  "Korean · 한국어",
  "Japanese · 日本語",
  "Portuguese · Português",
  "French · Français",
  "Russian · Русский"
];

const LEVELS = [
  "All native",
  "Native, English terms in brackets",
  "Native text, technical terms in English",
  "Mixed: 25% of sentences in English",
  "Mixed: 50% of sentences in English",
  "Mixed: 75% of sentences in English",
  "All English",
  "A custom (fine-tuned) level"
];

function createTaperLatexForm() {
  if (!TAPER_URL) throw new Error("Set TAPER_URL at the top of the script to the translator's link first.");

  const form = FormApp.create("TAPER 2: Try the paper translator and tell us what you think");
  form.setDescription(
    "TAPER (Translation-Assisted Progressive English Reading) translates an English research paper, written in LaTeX, " +
    "into your language, then moves you toward reading it in English week by week. Technical terms come first: " +
    "they stay in English from the start. You see the translated PDF large, with the English original beside it.\n\n" +
    "This form takes about 15–20 minutes. You'll answer a few questions, try the translator for about 10 minutes, " +
    "then tell us what you think. There are no right or wrong answers.\n\n" +
    "Translator: " + TAPER_URL
  );
  form.setCollectEmail(false);
  form.setProgressBar(true);

  /* ---------- Page 1: about you ---------- */
  form.addSectionHeaderItem().setTitle("About you");

  form.addTextItem().setTitle("Participant ID")
    .setHelpText("The ID the study team gave you, e.g. P01. Use the same ID as your TAPER reader profile.").setRequired(true);

  form.addListItem().setTitle("What is your first language?").setRequired(true)
    .setChoiceValues(LANGUAGES.concat(["Other"]));

  form.addTextItem().setTitle("If you chose Other, which language?");

  form.addTextItem().setTitle("Field of study").setHelpText("e.g. Computer Science");

  form.addScaleItem().setTitle("For me, reading English technical papers is…")
    .setBounds(1, 5).setLabels("Very hard", "Very easy").setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle("How often do you use an LLM (ChatGPT, Claude, Gemini…) to help you read or understand English text?")
    .setChoiceValues(["Daily", "Weekly", "Monthly", "Rarely or never"]).setRequired(true);

  form.addCheckboxItem()
    .setTitle("When you read a hard English paper today, what do you do? (Choose all that apply)")
    .setChoiceValues([
      "Read it in English without help",
      "Ask an LLM to translate or explain it",
      "Paste it into Google Translate, DeepL or similar",
      "Translate the whole PDF with a document translator",
      "Look up single words",
      "Ask a classmate or advisor"
    ])
    .showOtherOption(true);

  /* ---------- Page 2: try the translator ---------- */
  form.addPageBreakItem()
    .setTitle("Try the TAPER translator")
    .setHelpText(
      "Open the translator in a new tab and spend about 10 minutes with it:\n" + TAPER_URL + "\n\n" +
      "1. Settings: paste the API key the study team gave you (or your own) and keep the suggested models.\n" +
      "2. My plan: enter your Participant ID and language, then press \"Draft a plan with AI\" and look at the plan. You can edit it.\n" +
      "3. Translate: press \"Use the sample paper\" (or upload a paper's LaTeX .zip from arXiv) and press Translate.\n" +
      "4. Reader: the translated PDF is large on the left, the English original on the right. " +
      "Try at least 3 levels, click a few coloured technical terms, and try the Side by side / Translated / Original buttons.\n" +
      "5. Open the Glossary and the Report, and, if you like, \"Check my understanding\".\n" +
      "6. Go to the Library and open the paper again: this costs nothing.\n\n" +
      "Use the ? buttons whenever something is unclear. Then come back to this form."
    );

  form.addMultipleChoiceItem().setTitle("Did you open the translator and try it?")
    .setChoiceValues(["Yes, I tried it", "I opened it but couldn't get it to work"]).setRequired(true);

  form.addMultipleChoiceItem().setTitle("How did you run TAPER?")
    .setChoiceValues(["The website (GitHub Pages)", "On my computer with python run.py", "I'm not sure"]).setRequired(true);

  form.addMultipleChoiceItem().setTitle("Which paper did you translate?")
    .setChoiceValues(["The sample paper", "A paper I chose myself", "Both", "I didn't get that far"]).setRequired(true);

  form.addListItem().setTitle("Which language did you translate into?").setRequired(true)
    .setChoiceValues(LANGUAGES.concat(["None of these is my language"]));

  form.addMultipleChoiceItem().setTitle("Did the translated PDF appear?")
    .setChoiceValues(["Yes, straight away", "Yes, after waiting for the first download or trying again", "No, it failed to compile"]).setRequired(true);

  form.addCheckboxItem().setTitle("Which translation levels did you try? (Choose all that apply)")
    .setChoiceValues(LEVELS).setRequired(true);

  form.addMultipleChoiceItem().setTitle("Which level felt best for reading a technical paper today?")
    .setChoiceValues(LEVELS).setRequired(true);

  /* ---------- Page 3: what you thought of TAPER ---------- */
  form.addPageBreakItem().setTitle("What did you think of TAPER?");

  form.addScaleItem().setTitle("Overall, how much did you like TAPER?")
    .setBounds(1, 5).setLabels("Not at all", "Very much").setRequired(true);

  form.addScaleItem().setTitle("How easy was TAPER to use?")
    .setBounds(1, 5).setLabels("Very hard", "Very easy").setRequired(true);

  form.addScaleItem().setTitle("How well did you understand the paper you read in TAPER?")
    .setBounds(1, 5).setLabels("Not at all", "Completely").setRequired(true);

  form.addScaleItem().setTitle("How good were the translations in your language?")
    .setBounds(1, 5).setLabels("Very poor", "Excellent").setRequired(true);

  form.addScaleItem().setTitle("How well were the technical terms handled (kept in English, translated correctly)?")
    .setBounds(1, 5).setLabels("Very poorly", "Very well").setRequired(true);

  form.addScaleItem().setTitle("How well did the translated PDF keep the paper's equations, figures and layout?")
    .setBounds(1, 5).setLabels("Very poorly", "Perfectly").setRequired(true);

  form.addGridItem().setTitle("How useful was each feature?")
    .setRows([
      "Choosing my own language",
      "The weekly plan drafted by the AI",
      "Editing my plan",
      "The level selector and fine-tuning",
      "Seeing the translated PDF large with the English original beside it",
      "Maximising / minimising the two PDFs",
      "Clicking a term to see both languages",
      "The glossary (and flashcard download)",
      "The verification report",
      "The library of past translations",
      "\"Check my understanding\" (ratings and quiz)",
      "The help (?) buttons and Help page"
    ])
    .setColumns(["Not useful", "A little useful", "Useful", "Very useful", "Didn't try it"])
    .setRequired(true);

  form.addScaleItem()
    .setTitle("Do you think TAPER would help you get better at reading English over time?")
    .setBounds(1, 5).setLabels("Not at all", "Definitely").setRequired(true);

  form.addScaleItem()
    .setTitle("How much did the verifier step (a second model checking the translation) make you trust the translation?")
    .setBounds(1, 5).setLabels("Not at all", "A lot").setRequired(true);

  /* ---------- Page 4: TAPER vs an LLM ---------- */
  form.addPageBreakItem()
    .setTitle("TAPER compared with using an LLM")
    .setHelpText("Think about how you usually get help with English papers, for example asking ChatGPT or Claude to translate or explain.");

  form.addMultipleChoiceItem()
    .setTitle("To read an English technical paper, which would you rather use?")
    .setChoiceValues([
      "TAPER, definitely",
      "TAPER, probably",
      "No preference",
      "An LLM, probably",
      "An LLM, definitely"
    ]).setRequired(true);

  form.addParagraphTextItem().setTitle("Why?").setRequired(true);

  form.addGridItem().setTitle("Which is better for each of these?")
    .setRows([
      "Understanding the paper quickly",
      "Learning the English technical terms",
      "Improving my English reading over time",
      "Trusting that the translation is accurate",
      "Keeping equations, figures and references intact",
      "Not spending money or credits twice on the same paper",
      "Being easy to use"
    ])
    .setColumns(["TAPER", "About the same", "An LLM"])
    .setRequired(true);

  form.addMultipleChoiceItem().setTitle("Would you use TAPER together with an LLM?")
    .setChoiceValues([
      "Yes, I'd use both",
      "No, TAPER alone is enough",
      "No, I'd keep using only an LLM",
      "Not sure"
    ]).setRequired(true);

  /* ---------- Page 5: feedback ---------- */
  form.addPageBreakItem().setTitle("Your feedback");

  form.addParagraphTextItem().setTitle("What did you like most about TAPER?");

  form.addParagraphTextItem().setTitle("What was confusing or frustrating?");

  form.addParagraphTextItem().setTitle("What would you change or add?");

  form.addTextItem().setTitle("Which other languages should TAPER support?");

  form.addTextItem().setTitle("Which papers or fields would you most like to read with TAPER?");

  form.addMultipleChoiceItem().setTitle("Would you like to take part in the full study?")
    .setHelpText("The full study runs over 12 weeks: you read papers in TAPER at the level your plan suggests.")
    .setChoiceValues(["Yes", "Maybe", "No"]);

  form.addParagraphTextItem().setTitle("Anything else you'd like to tell us?");

  form.setConfirmationMessage("Thank you! Your feedback helps us improve TAPER.");

  // Responses also go to a Google Sheet so they can be joined with TAPER's study-data CSV by Participant ID.
  const sheet = SpreadsheetApp.create("TAPER 2: Feedback form (responses)");
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log("Edit the form:        " + form.getEditUrl());
  Logger.log("Send to participants: " + form.getPublishedUrl());
  Logger.log("Responses sheet:      " + sheet.getUrl());
}
