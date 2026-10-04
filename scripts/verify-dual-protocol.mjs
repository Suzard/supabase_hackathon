// Validate a Token Charity API key against both supported protocols.
// Usage:
//   node --env-file=.env.local scripts/verify-dual-protocol.mjs [baseUrl]
// Env:
//   TC_API_KEY or TOKEN_CHARITY_API_KEY   (required)
//   TC_BASE_URL                            (optional default base URL)
//   TC_ANTHROPIC_MODEL                     (optional, default: claude-sonnet-5-5)
//   TC_OPENAI_MODEL                        (optional, default: gpt-4o-mini)

const base = process.argv[2] ?? process.env.TC_BASE_URL ?? "http://localhost:3000";
const tcApiKey = process.env.TC_API_KEY ?? process.env.TOKEN_CHARITY_API_KEY ?? "";
const anthropicModel = process.env.TC_ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const openaiModel = process.env.TC_OPENAI_MODEL ?? "gpt-4o-mini";

if (!tcApiKey.trim()) {
  console.error("Missing Token Charity API key. Set TC_API_KEY (or TOKEN_CHARITY_API_KEY).");
  process.exit(1);
}

function tcHeaders(res) {
  const key = res.headers.get("x-token-charity-key") ?? "-";
  const decider = res.headers.get("x-token-charity-decider") ?? "-";
  const attempt = res.headers.get("x-token-charity-attempt") ?? "-";
  return `key=${key} decider=${decider} attempt=${attempt}`;
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function anthropicText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .filter((chunk) => chunk?.type === "text" && typeof chunk.text === "string")
    .map((chunk) => chunk.text)
    .join("\n")
    .trim();
}

function openAiText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .filter((chunk) => chunk?.type === "output_text" && typeof chunk.text === "string")
    .map((chunk) => chunk.text)
    .join("\n")
    .trim();
}

async function callAnthropic() {
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": tcApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 96,
      messages: [{ role: "user", content: "Tell me a short joke." }],
    }),
  });

  const body = await res.text();
  const parsed = parseJson(body);
  return {
    name: "Anthropic protocol (/v1/messages)",
    ok: res.ok,
    status: res.status,
    headers: tcHeaders(res),
    responseText: anthropicText(parsed),
    preview: body.slice(0, 260),
  };
}

async function callOpenAI() {
  const res = await fetch(`${base}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tcApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel,
      max_output_tokens: 96,
      input: "Tell me a short joke.",
    }),
  });

  const body = await res.text();
  const parsed = parseJson(body);
  return {
    name: "OpenAI protocol (/v1/responses)",
    ok: res.ok,
    status: res.status,
    headers: tcHeaders(res),
    responseText: openAiText(parsed),
    preview: body.slice(0, 260),
  };
}

console.log(`Token Charity dual-protocol verifier\nbase=${base}`);

const results = await Promise.allSettled([callAnthropic(), callOpenAI()]);

let failures = 0;
for (const r of results) {
  if (r.status === "rejected") {
    failures += 1;
    console.log(`\nFAIL request error\n${String(r.reason)}`);
    continue;
  }

  const x = r.value;
  if (!x.ok) failures += 1;

  console.log(`\n${x.ok ? "PASS" : "FAIL"} ${x.name}`);
  console.log(`status=${x.status} ${x.headers}`);
  if (x.responseText) {
    console.log(`response=${x.responseText.replace(/\s+/g, " ").trim()}`);
  } else {
    console.log(`preview=${x.preview.replace(/\s+/g, " ").trim()}`);
  }
}

if (failures > 0) {
  console.error(`\nVerification failed (${failures} check${failures === 1 ? "" : "s"}).`);
  process.exit(2);
}

console.log("\nAll protocol checks passed.");
