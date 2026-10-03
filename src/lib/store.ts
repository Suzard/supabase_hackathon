import type { Candidate, Decision } from "./decide";
import type { KeyStatusChange } from "./exhaustion";
import type { ProtocolId } from "./protocols";
import type { Provider } from "./providers";

export interface UsageRow {
  recipientId: string;
  poolKeyId: string;
  provider: Provider;
  protocol: ProtocolId;
  model: string;
  stream: boolean;
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number };
  listPriceUsd: number;
  priceKnown: boolean;
  statusCode: number;
  errorBody: string | null;
  decision: Decision;
  attempt: number;
  latencyMs: number;
}

/** Everything the router needs from persistence, so it can be tested without a database. */
export interface Store {
  findRecipient(apiKeyHash: string): Promise<{ id: string } | null>;
  liveCandidates(provider: Provider): Promise<Candidate[]>;
  keySecret(id: string): Promise<{ ciphertext: string; hint: string } | null>;
  markKey(id: string, status: KeyStatusChange, lastError: string): Promise<void>;
  insertUsage(row: UsageRow): Promise<void>;
  recordKeyUsage(id: string, tokens: number, costUsd: number): Promise<void>;
}
