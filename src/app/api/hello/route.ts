// Claude Code sends a best-effort HEAD /api/hello connection-warming probe to an
// ANTHROPIC_BASE_URL gateway (https://code.claude.com/docs/en/llm-gateway-protocol).
export function HEAD() {
  return new Response(null, { status: 200 });
}
