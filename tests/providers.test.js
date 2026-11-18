import test from "node:test";
import assert from "node:assert/strict";
import { callLLM, listModels, parseJsonLoose } from "../src/providers.js";

function fakeFetch(responses) {
  const log = [];
  const f = async (url, init) => {
    log.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const r = responses.shift();
    return { ok: r.status === 200, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  return { f, log };
}
const req = { system: "sys", prompt: "Return JSON" };

test("Anthropic: browser headers, effort, refusal fallbacks, usage", async () => {
  const { f, log } = fakeFetch([{ status: 200, body: { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "```json\n{\"ok\":1}\n```" }], usage: { input_tokens: 10, output_tokens: 5 } } }]);
  const r = await callLLM({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant", effort: "medium", fetch: f }, req);
  assert.deepEqual(r.json, { ok: 1 });
  assert.deepEqual(r.usage, { input: 10, output: 5 });
  const { url, init, body } = log[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"], "sk-ant");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.equal(body.system, "sys");
});

test("Anthropic: refusals and cut-off answers become clear errors", async () => {
  const a = fakeFetch([{ status: 200, body: { stop_reason: "refusal", content: [] } }]);
  await assert.rejects(callLLM({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "k", fetch: a.f }, req), /declined/);
  const b = fakeFetch([{ status: 200, body: { stop_reason: "max_tokens", content: [] } }]);
  await assert.rejects(callLLM({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "k", fetch: b.f }, req), e => e.code === "too_long");
});

test("rate limits are retried", async () => {
  const { f, log } = fakeFetch([{ status: 429, body: { error: { message: "slow down" } } }, { status: 200, body: { choices: [{ message: { content: "{\"a\":2}" } }], usage: { prompt_tokens: 3, completion_tokens: 4 } } }]);
  const r = await callLLM({ provider: "openai", model: "m", apiKey: "k", fetch: f }, req, { retries: 1 });
  assert.equal(log.length, 2);
  assert.deepEqual(r.json, { a: 2 });
});

test("bad keys are not retried", async () => {
  const { f, log } = fakeFetch([{ status: 401, body: { error: { message: "invalid x-api-key" } } }]);
  await assert.rejects(callLLM({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "bad", fetch: f }, req), /401: invalid x-api-key/);
  assert.equal(log.length, 1);
});

test("OpenAI, OpenRouter, Gemini and custom endpoints", async () => {
  const oa = fakeFetch([{ status: 200, body: { choices: [{ message: { content: "{}" } }] } }]);
  await callLLM({ provider: "openai", model: "m", apiKey: "k", fetch: oa.f }, req);
  assert.equal(oa.log[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(oa.log[0].init.headers.authorization, "Bearer k");
  assert.deepEqual(oa.log[0].body.response_format, { type: "json_object" });
  assert.deepEqual(oa.log[0].body.messages.map(m => m.role), ["system", "user"]);

  const or = fakeFetch([{ status: 200, body: { choices: [{ message: { content: "{}" } }] } }]);
  await callLLM({ provider: "openrouter", model: "x/y", apiKey: "k", fetch: or.f }, req);
  assert.equal(or.log[0].url, "https://openrouter.ai/api/v1/chat/completions");

  const ge = fakeFetch([{ status: 200, body: { candidates: [{ content: { parts: [{ text: "{\"g\":1}" }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } } }]);
  const g = await callLLM({ provider: "gemini", model: "gemini-x", apiKey: "AIza", fetch: ge.f }, req);
  assert.equal(ge.log[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
  assert.equal(ge.log[0].init.headers["x-goog-api-key"], "AIza");
  assert.deepEqual(g.usage, { input: 7, output: 2 });

  const cu = fakeFetch([{ status: 200, body: { choices: [{ message: { content: "{}" } }] } }]);
  await callLLM({ provider: "custom", model: "llama", baseUrl: "http://localhost:11434/v1/", fetch: cu.f }, req);
  assert.equal(cu.log[0].url, "http://localhost:11434/v1/chat/completions");
  assert.equal(cu.log[0].init.headers.authorization, undefined);
});

test("missing key or model gives a settings hint", async () => {
  await assert.rejects(callLLM({ provider: "openai", model: "m" }, req), /API key in Settings/);
  await assert.rejects(callLLM({ provider: "openai", apiKey: "k" }, req), /Choose a model/);
});

test("model lists", async () => {
  const a = fakeFetch([{ status: 200, body: { data: [{ id: "claude-opus-5-5" }] } }]);
  assert.deepEqual(await listModels({ provider: "anthropic", apiKey: "k", fetch: a.f }), ["claude-opus-5-5"]);
  const g = fakeFetch([{ status: 200, body: { models: [{ name: "models/g1", supportedGenerationMethods: ["generateContent"] }, { name: "models/e", supportedGenerationMethods: ["embedContent"] }] } }]);
  assert.deepEqual(await listModels({ provider: "gemini", apiKey: "k", fetch: g.f }), ["g1"]);
});

test("loose JSON parsing", () => {
  assert.deepEqual(parseJsonLoose("Here you go:\n{\"a\":[1,2,],}\nThanks"), { a: [1, 2] });
  assert.throws(() => parseJsonLoose("no json"), /did not return JSON/);
});
