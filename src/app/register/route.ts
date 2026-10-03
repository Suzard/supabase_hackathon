import { generateApiKey, hashApiKey } from "@/lib/crypto";
import { createRecipient } from "@/lib/supabase-store";

/** Issues a Token Charity key. Only its hash is stored; the key is shown once. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; label?: unknown };
  const email = typeof body.email === "string" ? body.email.slice(0, 320) : undefined;
  const label = typeof body.label === "string" ? body.label.slice(0, 120) : undefined;

  const apiKey = generateApiKey();
  await createRecipient({ email, label, apiKeyHash: hashApiKey(apiKey) });

  const origin = new URL(request.url).origin;
  return Response.json(
    {
      api_key: apiKey,
      note: "Shown once. Store it now.",
      anthropic: { ANTHROPIC_BASE_URL: origin, ANTHROPIC_API_KEY: apiKey },
      openai: { OPENAI_BASE_URL: `${origin}/v1`, OPENAI_API_KEY: apiKey },
      docs: `${origin}/agents.md`,
    },
    { status: 201 },
  );
}
