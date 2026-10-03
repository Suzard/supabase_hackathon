import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateApiKey, hashApiKey } from "../crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips and never stores plaintext", () => {
    const secret = "sk-test-donated-key-1234";
    const sealed = encrypt(secret, key);
    expect(sealed).not.toContain(secret);
    expect(decrypt(sealed, key)).toBe(secret);
  });
  it("uses a fresh IV per encryption", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });
  it("rejects tampered ciphertext", () => {
    const sealed = Buffer.from(encrypt("secret", key), "base64");
    sealed[sealed.length - 1] ^= 1;
    expect(() => decrypt(sealed.toString("base64"), key)).toThrow();
  });
  it("rejects a wrong-length key", () => {
    expect(() => encrypt("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
  it("issues prefixed keys and hashes deterministically", () => {
    const k = generateApiKey();
    expect(k).toMatch(/^tc_live_[A-Za-z0-9_-]{32}$/);
    expect(hashApiKey(k)).toBe(hashApiKey(k));
    expect(hashApiKey(k)).not.toBe(hashApiKey(generateApiKey()));
  });
});
