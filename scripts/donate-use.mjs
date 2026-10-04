// Donate one provider key, register a Token Charity key, then make one paid call.
//
// Usage:
//   DONATE_PROVIDER=anthropic DONATE_API_KEY=sk-ant-... RECIPIENT_EMAIL=you@example.com pnpm donate-use
//
// Optional:
//   TC_BASE_URL=http://localhost:3000
//   DONATE_EMAIL=donor@example.com
//   USE_MODEL=claude-fable-5

const base = process.env.TC_BASE_URL ?? "http://localhost:3000";
const provider = (process.env.DONATE_PROVIDER ?? "anthropic").trim();
const donateKey = (process.env.DONATE_API_KEY ?? "").trim();
const donateEmail = (process.env.DONATE_EMAIL ?? "donor@tokencharity.local").trim();
const recipientEmail = (process.env.RECIPIENT_EMAIL ?? "").trim();
const useModelOverride = (process.env.USE_MODEL ?? "").trim();

if (!donateKey) {
  console.error("Missing DONATE_API_KEY. Example:");
  console.error("DONATE_PROVIDER=anthropic DONATE_API_KEY=sk-ant-... RECIPIENT_EMAIL=you@example.com pnpm donate-use");
  process.exit(1);
}
if (!recipientEmail) {
  console.error("Missing RECIPIENT_EMAIL. This is required for /register billing identity.");
  process.exit(1);
}
if (provider !== "anthropic" && provider !== "openai") {
  console.error("DONATE_PROVIDER must be 'anthropic' or 'openai'.");
  process.exit(1);
}

function tcHeaders(apiKey) {
  return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

async function donate() {
  const res = await fetch(`${base}/donate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, api_key: donateKey, email: donateEmail }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`donate ${res.status}: ${body.error ?? JSON.stringify(body)}`);
  return body;
}

async function register() {
  const res = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: recipientEmail, label: "donate-use-script" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.api_key) throw new Error(`register ${res.status}: ${body.error ?? JSON.stringify(body)}`);
  return body.api_key;
}

async function pickModel(apiKey) {
  const res = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`models ${res.status}: ${JSON.stringify(body)}`);
  const models = Array.isArray(body.data) ? body.data.map((m) => m?.id).filter(Boolean) : [];
  if (!models.length) throw new Error("No pooled models available yet.");

  if (useModelOverride) {
    if (!models.includes(useModelOverride)) {
      throw new Error(`USE_MODEL=${useModelOverride} is not in /v1/models`);
    }
    return useModelOverride;
  }

  const preferred = models.find((m) =>
    provider === "anthropic" ? m.includes("claude") : m.includes("gpt") || m.includes("o")
  );
  return preferred ?? models[0];
}

async function runCreditsCall(apiKey, model) {
  if (provider === "anthropic") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { ...tcHeaders(apiKey), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 48,
        messages: [{ role: "user", content: "Reply exactly: donated credits working" }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`messages ${res.status}: ${JSON.stringify(body)}`);
    const text = body?.content?.find?.((c) => c?.type === "text")?.text ?? "(no text content)";
    return { status: res.status, text };
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: tcHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply exactly: donated credits working" }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`chat/completions ${res.status}: ${JSON.stringify(body)}`);
  const text = body?.choices?.[0]?.message?.content ?? "(no message content)";
  return { status: res.status, text };
}

async function latestCharge() {
  const res = await fetch(`${base}/api/stats`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const row = body?.recent?.[0];
  if (!row) return null;
  return {
    provider: row.provider,
    model: row.model,
    status: row.statusCode,
    chargedUsd: row.chargedUsd,
    listPriceUsd: row.listPriceUsd,
  };
}

try {
  console.log(`Base URL: ${base}`);
  console.log(`Step 1/4 Donate ${provider} key...`);
  const donated = await donate();
  console.log(`  ✅ donated key hint: ••••${donated.key_hint ?? "????"}`);

  console.log("Step 2/4 Register Token Charity key...");
  const tcKey = await register();
  console.log(`  ✅ token charity key: ${tcKey.slice(0, 10)}...`);

  console.log("Step 3/4 Pick model from pool...");
  const model = await pickModel(tcKey);
  console.log(`  ✅ model: ${model}`);

  console.log("Step 4/4 Make one paid request through Token Charity...");
  const result = await runCreditsCall(tcKey, model);
  console.log(`  ✅ response (${result.status}): ${result.text}`);

  await new Promise((r) => setTimeout(r, 1200));
  const charge = await latestCharge();
  if (charge) {
    console.log(
      `  ✅ latest ledger: ${charge.provider} ${charge.model} status=${charge.status} charged=$${Number(charge.chargedUsd).toFixed(6)} list=$${Number(charge.listPriceUsd).toFixed(6)}`,
    );
  }

  console.log("Done. You are now using donated credits through Token Charity.");
} catch (err) {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
}
