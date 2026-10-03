// OpenAI Chat Completions (older OpenAI-compatible clients)
import { openaiChat } from "@/lib/protocols";
import { serve } from "@/lib/server";

export const maxDuration = 300;

export function POST(request: Request) {
  return serve(request, openaiChat);
}
