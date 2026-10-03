// Anthropic Messages (Claude Code, Anthropic SDK)
import { anthropicMessages } from "@/lib/protocols";
import { serve } from "@/lib/server";

export const maxDuration = 300;

export function POST(request: Request) {
  return serve(request, anthropicMessages);
}
