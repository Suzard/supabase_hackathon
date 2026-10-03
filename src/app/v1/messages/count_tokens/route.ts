// Anthropic token counting (free upstream, not metered)
import { anthropicCountTokens } from "@/lib/protocols";
import { serve } from "@/lib/server";

export const maxDuration = 300;

export function POST(request: Request) {
  return serve(request, anthropicCountTokens);
}
