# TAPER: Translation-Assisted Progressive English Reading

A side-by-side reader for the user study: the student's language on one side, the English original on the other, with an adjustable translation level, a 12-week schedule, comprehension check-ins and an exportable study log.

## Run it

```
python run.py
```

This serves the folder at http://localhost:8000/TAPER.html and opens it in your browser. It uses only the Python standard library, so there's nothing to install. Options: `--port 8001`, `--no-browser`.

Keep using the same port. The study log is stored in the browser, per address, so a different port starts an empty log. Export the log from the **Study data** tab after every session.

To use **Add a passage** locally, paste an Anthropic API key into that tab. The key is kept only in the open tab.

## Files

| File | What it is |
|---|---|
| `TAPER.html` | The whole app: page, styles and script. Passages and translations are in the `PASSAGES` block at the top of the script. |
| `run.py` | Local server and browser launcher. |
| `build.py` | Writes `dist/TAPER.artifact.html`, the version to publish as a claude.ai Artifact. That version leaves out the `<html>/<head>/<body>` wrapper because claude.ai adds its own. |
| `tests/smoke.test.js` | Loads the page in jsdom and checks the levels, languages, lookups, check-in and CSV export. |

## Test

```
npm install
npm test
```

Run the tests after editing passages. A `[[term]]` that is missing from `terms`, or that doesn't appear in the English sentence, fails the first check.

## Add or edit a passage

In `PASSAGES`, wrap each technical term as `[[term]]` in the English sentence and in every translated sentence, using the same English key. Then add the key to `terms` with one translation per language. Have a native speaker review the translations before running participants.
