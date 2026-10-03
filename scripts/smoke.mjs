// End-to-end check against a running Token Charity: register, then one call per
// protocol. Model defaults are the newest IDs in the AI Gateway catalog on
// 2026-10-03; override with SMOKE_ANTHROPIC_MODEL / SMOKE_OPENAI_MODEL.
// Usage: node --env-file=.env.local scripts/smoke.mjs [baseUrl]
const base = process.argv[2] ?? process.env.TC_BASE_URL ?? "http://localhost:3000";
const anthropicModel = process.env.SMOKE_ANTHROPIC_MODEL ?? "claude-opus-5-5";
const openaiModel = process.env.SMOKE_OPENAI_MODEL ?? "gpt-6.1-sol";

const tc = (res) =>
  ["key", "decider", "attempt"].map((h) => `${h}=${res.headers.get(`x-token-charity-${h}`) ?? "-"}`).join(" ");

const reg = await fetch(`${base}/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "smoke@tokencharity.dev", label: "smoke-test" }),
});
if (reg.status !== 201) throw new Error(`register ${reg.status}: ${await reg.text()}`);
const { api_key } = await reg.json();
console.log("registered", api_key.slice(0, 12) + "...");

// Anthropic Messages, non-streaming
let res = await fetch(`${base}/v1/messages`, {
  method: "POST",
  headers: { "x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: anthropicModel, max_tokens: 32, messages: [{ role: "user", content: "Say hi in three words." }] }),
});
console.log(`\n/v1/messages ${res.status} ${tc(res)}\n`, (await res.text()).slice(0, 400));

// Anthropic Messages, streaming
res = await fetch(`${base}/v1/messages`, {
  method: "POST",
  headers: { "x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: anthropicModel, max_tokens: 32, stream: true, messages: [{ role: "user", content: "Count to three." }] }),
});
const sse = await res.text();
console.log(`\n/v1/messages stream ${res.status} ${tc(res)} content-type=${res.headers.get("content-type")}`);
console.log("  events:", [...sse.matchAll(/^event: (\S+)/gm)].map((m) => m[1]).join(","));

// OpenAI Responses
res = await fetch(`${base}/v1/responses`, {
  method: "POST",
  headers: { authorization: `Bearer ${api_key}`, "content-type": "application/json" },
  body: JSON.stringify({ model: openaiModel, max_output_tokens: 32, input: "Say hi in three words." }),
});
console.log(`\n/v1/responses ${res.status} ${tc(res)}\n`, (await res.text()).slice(0, 400));

// Usage rows are written after the response; give them a moment.
await new Promise((r) => setTimeout(r, 1500));
const stats = await (await fetch(`${base}/api/stats`)).json();
console.log("\nstats totals:", JSON.stringify(stats.totals));
console.log("recent:", stats.recent.slice(0, 4).map((r) => `${r.model} ${r.statusCode} $${r.listPriceUsd} ${r.decider}`).join(" | "));
