import { authenticate } from "@/lib/auth";
import { invoiceIfDue, STRIPE_MIN_CHARGE_USD } from "@/lib/billing";
import { stripeClient } from "@/lib/stripe";
import { billingSummary, billingStore, supabaseStore } from "@/lib/supabase-store";

/** Bills the caller's unbilled balance now instead of waiting for the threshold. */
export async function POST(request: Request) {
  const recipient = await authenticate(request.headers, supabaseStore.findRecipient);
  if (!recipient) return Response.json({ error: "Missing or unknown Token Charity key" }, { status: 401 });

  const stripe = stripeClient();
  if (!stripe) return Response.json({ error: "Billing is not enabled" }, { status: 503 });

  let issued;
  try {
    issued = await invoiceIfDue(recipient.id, STRIPE_MIN_CHARGE_USD, { store: billingStore, stripe });
  } catch (err) {
    // The balance was returned to the unbilled pool; the caller can retry.
    return Response.json({ error: `Stripe could not issue the invoice: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }
  if (!issued) {
    const { unbilledUsd } = await billingSummary(recipient.id);
    return Response.json(
      { error: `Unbilled balance is $${unbilledUsd.toFixed(4)}, below Stripe's $${STRIPE_MIN_CHARGE_USD.toFixed(2)} minimum` },
      { status: 400 },
    );
  }
  return Response.json(
    { amount_usd: issued.amountUsd, requests: issued.requestCount, pay_url: issued.hostedInvoiceUrl },
    { status: 201 },
  );
}
