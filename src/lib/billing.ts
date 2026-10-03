import type Stripe from "stripe";

// Stripe won't collect less than $0.50 USD, so no invoice is issued below it.
export const STRIPE_MIN_CHARGE_USD = 0.5;

export interface Claim {
  invoiceId: string;
  amountUsd: number;
  amountCents: number;
  requestCount: number;
}

export interface IssuedInvoice extends Claim {
  stripeInvoiceId: string;
  hostedInvoiceUrl: string | null;
}

export interface BillingStore {
  /** Atomically moves a recipient's unbilled usage onto a new pending invoice once it reaches minUsd. */
  claimUnbilled(recipientId: string, minUsd: number): Promise<Claim | null>;
  /** Returns the invoice's usage to the unbilled pool and marks the invoice failed. */
  releaseInvoice(invoiceId: string, error: string): Promise<void>;
  recipientForBilling(recipientId: string): Promise<{ email: string; stripeCustomerId: string | null } | null>;
  setStripeCustomer(recipientId: string, stripeCustomerId: string): Promise<void>;
  markInvoiceIssued(invoiceId: string, issued: { stripeInvoiceId: string; hostedInvoiceUrl: string | null; error?: string }): Promise<void>;
}

export type StripeInvoicing = Pick<Stripe, "customers" | "invoices" | "invoiceItems">;

/** The configured threshold, never below Stripe's minimum charge. */
export function invoiceThresholdUsd(configured: string | undefined): number {
  const value = Number(configured);
  return Number.isFinite(value) && value > STRIPE_MIN_CHARGE_USD ? value : STRIPE_MIN_CHARGE_USD;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Issues a Stripe invoice for the recipient's unbilled usage if it has reached minUsd.
 * Every Stripe call carries an idempotency key derived from our invoice row, so retries
 * never duplicate a customer, invoice, or line item. A failure before finalization
 * releases the usage for a later invoice; after finalization the invoice exists in
 * Stripe, so the usage stays on it.
 */
export async function invoiceIfDue(
  recipientId: string,
  minUsd: number,
  deps: { store: BillingStore; stripe: StripeInvoicing },
): Promise<IssuedInvoice | null> {
  const { store, stripe } = deps;
  const claim = await store.claimUnbilled(recipientId, minUsd);
  if (!claim) return null;

  let draftId: string;
  let hostedInvoiceUrl: string | null;
  try {
    const recipient = await store.recipientForBilling(recipientId);
    if (!recipient) throw new Error(`recipient ${recipientId} not found`);

    let customerId = recipient.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: recipient.email, metadata: { token_charity_recipient_id: recipientId } },
        { idempotencyKey: `tc-customer-${recipientId}` },
      );
      customerId = customer.id;
      await store.setStripeCustomer(recipientId, customerId);
    }

    const draft = await stripe.invoices.create(
      {
        customer: customerId,
        // Explicit: a new customer has no currency, so Stripe would fall back to the
        // account's default (which need not be USD) and reject the USD line item.
        currency: "usd",
        collection_method: "send_invoice",
        days_until_due: 7,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: "Token Charity inference at 5% of provider list price. Donated credits covered the rest.",
        metadata: { token_charity_invoice_id: claim.invoiceId },
      },
      { idempotencyKey: `tc-invoice-${claim.invoiceId}` },
    );
    if (!draft.id) throw new Error("Stripe returned an invoice without an id");
    draftId = draft.id;

    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: draftId,
        amount: claim.amountCents,
        currency: "usd",
        description: `${claim.requestCount} requests served from donated credits`,
      },
      { idempotencyKey: `tc-item-${claim.invoiceId}` },
    );

    const finalized = await stripe.invoices.finalizeInvoice(draftId, {}, { idempotencyKey: `tc-finalize-${claim.invoiceId}` });
    hostedInvoiceUrl = finalized.hosted_invoice_url ?? null;
  } catch (err) {
    await store.releaseInvoice(claim.invoiceId, message(err));
    throw err;
  }

  let sendError: string | undefined;
  try {
    await stripe.invoices.sendInvoice(draftId, {}, { idempotencyKey: `tc-send-${claim.invoiceId}` });
  } catch (err) {
    sendError = `email not sent: ${message(err)}`;
  }
  await store.markInvoiceIssued(claim.invoiceId, { stripeInvoiceId: draftId, hostedInvoiceUrl, error: sendError });
  return { ...claim, stripeInvoiceId: draftId, hostedInvoiceUrl };
}
