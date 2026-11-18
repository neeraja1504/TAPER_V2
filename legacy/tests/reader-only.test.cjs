// Smoke test for public-repo/index.html, the reader-only page for GitHub Pages.
// Run with:  node tests/reader-only.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "public-repo", "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window, d = w.document;
w.CSS = { escape: s => s };

const errors = [], warnings = [];
w.addEventListener("error", e => errors.push(e.message));
w.console.warn = (...a) => warnings.push(a.join(" "));

const $ = id => d.getElementById(id);
const nativeText = () => $("nativeText").textContent.trim();
const setLevel = v => { $("level").value = v; $("level").dispatchEvent(new w.Event("input")); };
const results = [];
function check(name, fn) {
  try { fn(); results.push(`  ok   ${name}`); }
  catch (e) { results.push(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

setTimeout(() => {
  check("page loads without script errors or content warnings", () => {
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warnings, []);
  });

  check("only the reader is on the page", () => {
    assert.strictEqual(d.querySelector("nav.tabs"), null);
    ["view-intake", "view-own", "view-data", "doneReading", "checkin"].forEach(id => assert.strictEqual($(id), null, id));
    assert.ok(!$("view-reader").hidden);
  });

  check("every language renders both passages, including Korean", () => {
    const langs = [...$("lang").options].map(o => o.value);
    assert.ok(langs.includes("ko"));
    for (const p of [...$("passage").options].map(o => o.value)) {
      $("passage").value = p; $("passage").dispatchEvent(new w.Event("change"));
      for (const l of langs) {
        $("lang").value = l; $("lang").dispatchEvent(new w.Event("change"));
        setLevel(0);
        assert.ok(nativeText().length > 40, `${p}/${l} is empty`);
        assert.doesNotMatch(nativeText(), /\[\[|undefined/, `${p}/${l} has unrendered markup`);
      }
    }
    $("passage").value = "ml-training"; $("passage").dispatchEvent(new w.Event("change"));
    $("lang").value = "ko"; $("lang").dispatchEvent(new w.Event("change"));
  });

  check("clicking a term shows both forms and counts the lookup", () => {
    setLevel(2);
    d.querySelector('#nativeText .term[data-term="dataset"]').click();
    assert.match(d.querySelector(".pop").textContent, /dataset.*데이터셋/);
    assert.strictEqual($("lookups").textContent, "1");
    setLevel(3);
    assert.strictEqual($("lookups").textContent, "0");
  });

  console.log(results.join("\n"));
  console.log(process.exitCode ? "\nSome checks failed." : "\nAll checks passed.");
  w.close();
}, 300);
