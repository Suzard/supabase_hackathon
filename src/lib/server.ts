import "server-only";
import { after } from "next/server";
import { decrypt } from "./crypto";
import { chargeForUsage } from "./charge";
import { env } from "./env";
import { getPriceTable } from "./pricing";
import { routeRequest, type RouterDeps } from "./router";
import type { Protocol } from "./protocols";
import { supabaseStore } from "./supabase-store";

function deps(): RouterDeps {
  return {
    store: supabaseStore,
    // Read lazily so an unauthenticated request gets its 401 before any config is touched.
    decryptKey: (ciphertext) => decrypt(ciphertext, env.poolEncryptionKey()),
    getPrices: () => getPriceTable(),
    defer: (task) => after(task),
    charge: chargeForUsage,
    jevApiKey: env.aiGatewayApiKey(),
  };
}

/** Route handler body shared by every inference endpoint. */
export async function serve(request: Request, protocol: Protocol): Promise<Response> {
  try {
    return await routeRequest(request, protocol, deps());
  } catch (err) {
    console.error(`[${protocol.id}]`, err);
    const message = err instanceof Error ? err.message : "internal error";
    return Response.json(protocol.errorBody("api_error", `Token Charity failed: ${message}`), { status: 500 });
  }
}
