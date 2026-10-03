import "server-only";
import { invoiceIfDue, invoiceThresholdUsd } from "./billing";
import { env } from "./env";
import type { RouterDeps } from "./router";
import { stripeClient } from "./stripe";
import { billingStore } from "./supabase-store";

/** After each metered request: invoice the recipient once their unbilled balance crosses the threshold. */
export const chargeForUsage: RouterDeps["charge"] = async ({ recipientId }) => {
  const stripe = stripeClient();
  if (!stripe) return;
  try {
    await invoiceIfDue(recipientId, invoiceThresholdUsd(env.invoiceThresholdUsd()), { store: billingStore, stripe });
  } catch (err) {
    console.error("invoicing failed", err);
  }
};
