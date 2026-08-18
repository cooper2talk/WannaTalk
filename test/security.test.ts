import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, maskPhoneNumber, verifyTelnyxWebhook } from "../src/security";

describe("security helpers", () => {
  it("round-trips base64 bytes", () => {
    const input = new TextEncoder().encode("Priya");
    expect(new TextDecoder().decode(base64ToBytes(bytesToBase64(input)))).toBe("Priya");
  });

  it("masks phone numbers before storage", () => {
    expect(maskPhoneNumber("+15403908080")).toBe("***-***-8080");
    expect(maskPhoneNumber(undefined)).toBeNull();
  });

  it("verifies a current Telnyx Ed25519 event with a raw base64 public key", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const rawPublicKey = spki.slice(-32);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"data":{"event_type":"call.initiated"}}';
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(`${timestamp}|${body}`)));

    await expect(verifyTelnyxWebhook(body, bytesToBase64(signature), timestamp, bytesToBase64(rawPublicKey))).resolves.toBe(true);
    await expect(verifyTelnyxWebhook(body, bytesToBase64(signature), "1", bytesToBase64(rawPublicKey))).resolves.toBe(false);
  });
});
