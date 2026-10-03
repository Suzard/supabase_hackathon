// OpenAI Responses (Codex, OpenAI SDK)
import { openaiResponses } from "@/lib/protocols";
import { serve } from "@/lib/server";

export const maxDuration = 300;

export function POST(request: Request) {
  return serve(request, openaiResponses);
}
