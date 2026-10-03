import type { RouterDeps } from "./router";

// The single seam where a metered amount becomes a Stripe charge. Which Stripe product
// backs it (MPP per call, prepaid Checkout credits, or a threshold invoice) is an open
// decision, so for now metering's usage row is the only record.
export const chargeForUsage: RouterDeps["charge"] = async () => {};
