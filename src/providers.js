/* LLM providers, called directly from the browser with the user's own API key.
 *
 *   anthropic   Claude Messages API
 *   openai      OpenAI Chat Completions
 *   gemini      Google Gemini generateContent
 *   openrouter  OpenRouter (OpenAI-compatible, many models)
 *   custom      any OpenAI-compatible endpoint, e.g. Ollama at http://localhost:11434/v1
 *
 * callLLM(cfg, { system, prompt, maxTokens }) -> { text, json, usage: { input, output } }
 */

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", keyHint: "sk-ant-…", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"], defaultModel: "claude-opus-5-5", keyUrl: "https://platform.claude.com/settings/keys" },
  openai: { label: "OpenAI", keyHint: "sk-…", models: [], defaultModel: "", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", keyHint: "AIza…", models: [], defaultModel: "", keyUrl: "https://aistudio.google.com/apikey" },
  openrouter: { label: "OpenRouter", keyHint: "sk-or-…", models: [], defaultModel: "", keyUrl: "https://openrouter.ai/keys" },
  custom: { label: "Custom / local (OpenAI-compatible, e.g. Ollama)", keyHint: "optional", models: [], defaultModel: "", baseUrl: "http://localhost:11434/v1" }
};

export class LLMError extends Error {
  constructor(message, { status, retryable = false, code } = {}) { super(message); this.status = status; this.retryable = retryable; this.code = code; }
}

/* Models that accept server-side refusal fallbacks and the effort setting. */
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-[12]|sonnet-5-5)$/;
const EFFORT_MODELS = /^claude-(opus-[45]|fable|mythos|sonnet-5|haiku-5)/;

export function parseJsonLoose(s) {
  if (s && typeof s === "object") return s;
  let t = String(s || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new LLMError("The model did not return JSON.", { code: "bad_json", retryable: true });
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); }
  catch {
    try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); }
    catch { throw new LLMError("The model returned malformed JSON.", { code: "bad_json", retryable: true }); }
  }
}

async function http(url, init, signal, f) {
  f = f || ((u, o) => globalThis.fetch(u, o)); // never call a detached window.fetch (Illegal invocation)
  let res;
  try { res = await f(url, { ...init, signal }); }
  catch (e) {
    if (e.name === "AbortError") throw e;
    throw new LLMError(`Could not reach ${new URL(url).host}. Check your connection${url.includes("localhost") ? " and that the local server is running" : ""}.`, { retryable: true });
  }
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error?.status || body?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new LLMError(`${res.status}: ${msg}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 || res.status === 408 });
  }
  return body ?? text;
}

const openAIHeaders = key => ({ "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) });
function baseFor(cfg) {
  if (cfg.provider === "openai") return "https://api.openai.com/v1";
  if (cfg.provider === "openrouter") return "https://openrouter.ai/api/v1";
  return (cfg.baseUrl || PROVIDERS.custom.baseUrl).replace(/\/+$/, "");
}

async function callOnce(cfg, req, signal) {
  const { provider, model, apiKey } = cfg;
  if (!model) throw new LLMError(`Choose a model for ${PROVIDERS[provider]?.label || provider} in Settings.`);
  if (provider !== "custom" && !apiKey) throw new LLMError(`Add your ${PROVIDERS[provider]?.label || provider} API key in Settings.`);

  if (provider === "anthropic") {
    const fallback = FALLBACK_MODELS.test(model);
    const body = {
      model, max_tokens: req.maxTokens || 16000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      ...(EFFORT_MODELS.test(model) && cfg.effort ? { output_config: { effort: cfg.effort } } : {}),
      ...(fallback ? { fallbacks: "default" } : {})
    };
    const data = await http("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        ...(fallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {})
      },
      body: JSON.stringify(body)
    }, signal, cfg.fetch);
    if (data.stop_reason === "refusal") throw new LLMError("The model declined this request.", { code: "refusal" });
    if (data.stop_reason === "max_tokens") throw new LLMError("The answer was cut off (too long).", { code: "too_long" });
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    return { text, usage: { input: (data.usage?.input_tokens || 0) + (data.usage?.cache_read_input_tokens || 0) + (data.usage?.cache_creation_input_tokens || 0), output: data.usage?.output_tokens || 0 } };
  }

  if (provider === "gemini") {
    const data = await http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    }, signal, cfg.fetch);
    const cand = data.candidates?.[0];
    if (!cand) throw new LLMError(data.promptFeedback?.blockReason ? `Gemini blocked the request (${data.promptFeedback.blockReason}).` : "Gemini returned no answer.", { code: "refusal" });
    if (cand.finishReason === "MAX_TOKENS") throw new LLMError("The answer was cut off (too long).", { code: "too_long" });
    const text = (cand.content?.parts || []).map(p => p.text || "").join("");
    return { text, usage: { input: data.usageMetadata?.promptTokenCount || 0, output: data.usageMetadata?.candidatesTokenCount || 0 } };
  }

  // OpenAI, OpenRouter and OpenAI-compatible servers
  const data = await http(baseFor(cfg) + "/chat/completions", {
    method: "POST",
    headers: { ...openAIHeaders(apiKey), ...(provider === "openrouter" ? { "x-title": "TAPER" } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.prompt }],
      ...(provider === "openai" ? { response_format: { type: "json_object" } } : {})
    })
  }, signal, cfg.fetch);
  const ch = data.choices?.[0];
  if (!ch) throw new LLMError("The model returned no answer.");
  if (ch.finish_reason === "length") throw new LLMError("The answer was cut off (too long).", { code: "too_long" });
  if (ch.message?.refusal) throw new LLMError("The model declined this request.", { code: "refusal" });
  return { text: ch.message?.content || "", usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 } };
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
});

/* Calls the model with retries on rate limits, server errors and unparseable JSON. */
export async function callLLM(cfg, req, { signal, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await callOnce(cfg, req, signal);
      const json = req.raw ? null : parseJsonLoose(r.text);
      return { ...r, json };
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastErr = e;
      if (!e.retryable || attempt === retries) break;
      if (e.code === "bad_json") req = { ...req, prompt: req.prompt + "\n\nReturn valid JSON only, with no text before or after it." };
      await sleep(Math.min(30000, 1500 * 2 ** attempt + Math.random() * 500), signal);
    }
  }
  throw lastErr;
}

/* Lists model ids the key can use. */
export async function listModels(cfg, { signal } = {}) {
  const { provider, apiKey } = cfg;
  if (provider === "anthropic") {
    const data = await http("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } }, signal, cfg.fetch);
    return (data.data || []).map(m => m.id);
  }
  if (provider === "gemini") {
    const data = await http("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": apiKey } }, signal, cfg.fetch);
    return (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, ""));
  }
  const data = await http(baseFor(cfg) + "/models", { headers: openAIHeaders(apiKey) }, signal, cfg.fetch);
  return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}
