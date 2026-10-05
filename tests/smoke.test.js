// Smoke test for TAPER.html: loads the page in jsdom and checks the reader,
// translation levels, term lookups, check-in flow and study log.
// Run with:  npm install  then  npm test
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "TAPER.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window, d = w.document;
w.CSS = { escape: s => s };

const errors = [], warnings = [];
w.addEventListener("error", e => errors.push(e.message));
w.console.warn = (...a) => warnings.push(a.join(" "));

const $ = id => d.getElementById(id);
const nativeText = () => $("nativeText").textContent.trim();
const nativePct = () => parseInt($("sharePct").textContent, 10);
const setLevel = v => { $("level").value = v; $("level").dispatchEvent(new w.Event("input")); };
const readLog = () => JSON.parse(w.localStorage.getItem("taper:log") || "[]");
const results = [];
function check(name, fn) {
  try { fn(); results.push(`  ok   ${name}`); }
  catch (e) { results.push(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

setTimeout(() => {
  let now = w.Date.now();
  w.Date.now = () => now;

  check("page loads without script errors or content warnings", () => {
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warnings, []);
  });

  check("level 0 translates everything", () => {
    setLevel(0);
    assert.match(nativeText(), /tập dữ liệu/);
    assert.doesNotMatch(nativeText(), /dataset/);
    assert.strictEqual(nativePct(), 100);
  });

  check("level 1 glosses terms in brackets", () => {
    setLevel(1);
    assert.match(nativeText(), /tập dữ liệu \(dataset\)/);
  });

  check("level 2 keeps technical terms in English", () => {
    setLevel(2);
    assert.match(nativeText(), /một dataset lớn/);
    assert.ok(nativePct() < 100 && nativePct() > 50);
  });

  check("level 6 is all English", () => {
    setLevel(6);
    assert.strictEqual(nativePct(), 0);
    assert.match(nativeText(), /^We train a transformer/);
  });

  check("reading time is logged under the level that was read", () => {
    setLevel(0);
    now += 5000;
    setLevel(4);
    const row = readLog().filter(r => r.type === "read").pop();
    assert.strictEqual(row.level, 0);
    assert.strictEqual(row.nativePct, 100);
    assert.strictEqual(row.detail.seconds, 5);
  });

  check("every language renders both passages", () => {
    for (const p of [...$("passage").options].map(o => o.value)) {
      $("passage").value = p; $("passage").dispatchEvent(new w.Event("change"));
      for (const l of [...$("lang").options].map(o => o.value)) {
        $("lang").value = l; $("lang").dispatchEvent(new w.Event("change"));
        setLevel(0);
        assert.ok(nativeText().length > 40, `${p}/${l} is empty`);
        assert.doesNotMatch(nativeText(), /\[\[|undefined/, `${p}/${l} has unrendered markup`);
      }
    }
    $("passage").value = "ml-training"; $("passage").dispatchEvent(new w.Event("change"));
    $("lang").value = "vi"; $("lang").dispatchEvent(new w.Event("change"));
  });

  check("clicking a term shows both forms and logs a lookup", () => {
    setLevel(2);
    d.querySelector('#nativeText .term[data-term="dataset"]').click();
    assert.match(d.querySelector(".pop").textContent, /dataset.*tập dữ liệu/);
    assert.strictEqual(readLog().pop().type, "lookup");
  });

  check("check-in hides the text and saves a scored row", () => {
    now += 3000;
    $("doneReading").click();
    assert.ok($("panels").hidden && !$("checkin").hidden);
    ["quiz0_0", "quiz1_1", "understand4", "comfort3"].forEach(id => $(id).click());
    d.querySelector('input[name="next"][value="same"]').click();
    $("submitCheck").click();
    const row = readLog().pop();
    assert.strictEqual(row.type, "checkin");
    assert.strictEqual(row.detail.correct, 2);
  });

  check("CSV export has a header and one line per event", () => {
    const csv = w.eval("toCsv()").split("\n");
    assert.match(csv[0], /^time,participant,session/);
    assert.strictEqual(csv.length, readLog().length + 1);
  });

  console.log(results.join("\n"));
  console.log(process.exitCode ? "\nSome checks failed." : "\nAll checks passed.");
  w.close();
}, 300);
