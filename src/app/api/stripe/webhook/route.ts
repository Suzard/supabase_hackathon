import { env } from "@/lib/env";
import { stripeClient } from "@/lib/stripe";
import { setInvoiceStatus, type InvoiceStatus } from "@/lib/supabase-store";

const STATUS_BY_EVENT: Record<string, InvoiceStatus> = {
  "invoice.paid": "paid",
  "invoice.voided": "void",
  "invoice.marked_uncollectible": "uncollectible",
};

/** Stripe invoice lifecycle events, verified against the endpoint's signing secret. */
export async function POST(request: Request) {
  const stripe = stripeClient();
  if (!stripe) return Response.json({ error: "Billing is not enabled" }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing stripe-signature" }, { status: 400 });

  let event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, env.stripeWebhookSecret());
  } catch (err) {
    return Response.json({ error: `Invalid signature: ${err instanceof Error ? err.message : err}` }, { status: 400 });
  }

  const status = STATUS_BY_EVENT[event.type];
  if (status) {
    const invoiceId = (event.data.object as { id?: string }).id;
    if (invoiceId) await setInvoiceStatus(invoiceId, status);
  }
  return Response.json({ received: true });
}
