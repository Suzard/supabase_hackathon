// Donates SEED_OPENAI_KEY / SEED_ANTHROPIC_KEY through the real /donate flow.
// Usage: node --env-file=.env.local scripts/seed.mjs [baseUrl]
const base = process.argv[2] ?? process.env.TC_BASE_URL ?? "http://localhost:3000";
const seeds = [
  ["openai", process.env.SEED_OPENAI_KEY],
  ["anthropic", process.env.SEED_ANTHROPIC_KEY],
  ["anthropic", process.env.SEED_ANTHROPIC_KEY_2],
];

for (const [provider, apiKey] of seeds) {
  if (!apiKey) {
    console.log(`skip ${provider}: seed key not set`);
    continue;
  }
  const res = await fetch(`${base}/donate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey, email: "seed@tokencharity.local" }),
  });
  console.log(provider, res.status, await res.text());
}
