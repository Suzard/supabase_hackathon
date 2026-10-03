import "server-only";
import Stripe from "stripe";
import { env } from "./env";

let client: Stripe | null = null;

/** Lazily constructed so builds without STRIPE_SECRET_KEY still succeed. Null when billing is off. */
export function stripeClient(): Stripe | null {
  const key = env.stripeSecretKey();
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}
