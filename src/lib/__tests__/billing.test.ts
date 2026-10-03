import { describe, expect, it, vi } from "vitest";
import { invoiceIfDue, invoiceThresholdUsd, type BillingStore, type Claim, type StripeInvoicing } from "../billing";

const claim: Claim = { invoiceId: "inv_row_1", amountUsd: 0.5512, amountCents: 55, requestCount: 3 };

function makeStore(overrides: Partial<BillingStore> = {}) {
  const calls: string[] = [];
  const store: BillingStore = {
    claimUnbilled: vi.fn(async () => claim),
    releaseInvoice: vi.fn(async () => void calls.push("release")),
    recipientForBilling: vi.fn(async () => ({ email: "human@example.com", stripeCustomerId: null })),
    setStripeCustomer: vi.fn(async () => void calls.push("setCustomer")),
    markInvoiceIssued: vi.fn(async () => void calls.push("issued")),
    ...overrides,
  };
  return { store, calls };
}

function makeStripe(fail?: "item" | "send") {
  const order: string[] = [];
  const stripe = {
    customers: { create: vi.fn(async () => (order.push("customer"), { id: "cus_1" })) },
    invoices: {
      create: vi.fn(async () => (order.push("invoice"), { id: "in_1" })),
      finalizeInvoice: vi.fn(async () => (order.push("finalize"), { id: "in_1", hosted_invoice_url: "https://invoice.stripe.com/i/test" })),
      sendInvoice: vi.fn(async () => {
        order.push("send");
        if (fail === "send") throw new Error("email bounced");
        return { id: "in_1" };
      }),
    },
    invoiceItems: {
      create: vi.fn(async () => {
        order.push("item");
        if (fail === "item") throw new Error("card_declined");
        return { id: "ii_1" };
      }),
    },
  };
  return { stripe: stripe as unknown as StripeInvoicing & typeof stripe, order };
}

describe("invoiceThresholdUsd", () => {
  it("never goes below Stripe's $0.50 minimum", () => {
    expect(invoiceThresholdUsd(undefined)).toBe(0.5);
    expect(invoiceThresholdUsd("0.10")).toBe(0.5);
    expect(invoiceThresholdUsd("abc")).toBe(0.5);
    expect(invoiceThresholdUsd("5")).toBe(5);
  });
});

describe("invoiceIfDue", () => {
  it("does nothing when the balance is below the threshold", async () => {
    const { store } = makeStore({ claimUnbilled: vi.fn(async () => null) });
    const { stripe, order } = makeStripe();
    expect(await invoiceIfDue("r1", 0.5, { store, stripe })).toBeNull();
    expect(order).toEqual([]);
  });

  it("creates customer, invoice, item, finalizes, sends, then records the hosted link", async () => {
    const { store, calls } = makeStore();
    const { stripe, order } = makeStripe();
    const issued = await invoiceIfDue("r1", 0.5, { store, stripe });

    expect(order).toEqual(["customer", "invoice", "item", "finalize", "send"]);
    expect(issued).toMatchObject({ stripeInvoiceId: "in_1", hostedInvoiceUrl: "https://invoice.stripe.com/i/test", amountCents: 55 });
    expect(calls).toEqual(["setCustomer", "issued"]);

    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "human@example.com" }),
      { idempotencyKey: "tc-customer-r1" },
    );
    expect(stripe.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", collection_method: "send_invoice", auto_advance: false }),
      { idempotencyKey: "tc-invoice-inv_row_1" },
    );
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: "in_1", amount: 55, currency: "usd" }),
      { idempotencyKey: "tc-item-inv_row_1" },
    );
  });

  it("reuses an existing Stripe customer", async () => {
    const { store } = makeStore({ recipientForBilling: vi.fn(async () => ({ email: "h@example.com", stripeCustomerId: "cus_existing" })) });
    const { stripe, order } = makeStripe();
    await invoiceIfDue("r1", 0.5, { store, stripe });
    expect(order[0]).toBe("invoice");
    expect(stripe.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_existing" }), expect.anything());
  });

  it("releases the usage when Stripe fails before finalization", async () => {
    const { store, calls } = makeStore();
    const { stripe } = makeStripe("item");
    await expect(invoiceIfDue("r1", 0.5, { store, stripe })).rejects.toThrow("card_declined");
    expect(calls).toContain("release");
    expect(calls).not.toContain("issued");
    expect(stripe.invoices.finalizeInvoice).not.toHaveBeenCalled();
  });

  it("keeps a finalized invoice even when the email fails, so usage is never billed twice", async () => {
    const { store, calls } = makeStore();
    const { stripe } = makeStripe("send");
    const issued = await invoiceIfDue("r1", 0.5, { store, stripe });
    expect(issued?.hostedInvoiceUrl).toBe("https://invoice.stripe.com/i/test");
    expect(calls).not.toContain("release");
    expect(store.markInvoiceIssued).toHaveBeenCalledWith("inv_row_1", expect.objectContaining({ error: expect.stringContaining("email bounced") }));
  });
});
