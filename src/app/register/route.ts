import { generateApiKey, hashApiKey } from "@/lib/crypto";
import { createRecipient } from "@/lib/supabase-store";

/** Issues a Token Charity key for a billing email. Only the key's hash is stored; the key is shown once. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; label?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "`email` is required: usage is billed to it" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.slice(0, 120) : undefined;

  const apiKey = generateApiKey();
  await createRecipient({ email, label, apiKeyHash: hashApiKey(apiKey) });

  const origin = new URL(request.url).origin;
  return Response.json(
    {
      api_key: apiKey,
      note: "Shown once. Store it now.",
      // ANTHROPIC_AUTH_TOKEN (Bearer) takes effect immediately in Claude Code; ANTHROPIC_API_KEY
      // prompts once for interactive approval (https://code.claude.com/docs/en/llm-gateway-connect).
      anthropic: { ANTHROPIC_BASE_URL: origin, ANTHROPIC_AUTH_TOKEN: apiKey },
      openai: { OPENAI_BASE_URL: `${origin}/v1`, OPENAI_API_KEY: apiKey },
      docs: `${origin}/agents.md`,
    },
    { status: 201 },
  );
}
