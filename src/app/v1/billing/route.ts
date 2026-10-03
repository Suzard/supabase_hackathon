import { authenticate } from "@/lib/auth";
import { invoiceThresholdUsd } from "@/lib/billing";
import { env } from "@/lib/env";
import { billingSummary, supabaseStore } from "@/lib/supabase-store";

/** The caller's unbilled balance and invoices, with hosted payment links to hand to a human. */
export async function GET(request: Request) {
  const recipient = await authenticate(request.headers, supabaseStore.findRecipient);
  if (!recipient) return Response.json({ error: "Missing or unknown Token Charity key" }, { status: 401 });

  const summary = await billingSummary(recipient.id);
  return Response.json(
    {
      unbilled_usd: summary.unbilledUsd,
      invoice_threshold_usd: invoiceThresholdUsd(env.invoiceThresholdUsd()),
      invoices: summary.invoices.map((i) => ({
        amount_usd: i.amountUsd,
        requests: i.requestCount,
        status: i.status,
        pay_url: i.hostedInvoiceUrl,
        created_at: i.createdAt,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
