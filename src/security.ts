/** Converts either normal base64 or base64url into raw bytes. */
export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bytesToBase64Url(value: Uint8Array): string {
  return bytesToBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Makes a non-shared ArrayBuffer accepted by Web Crypto's strict DOM types. */
export function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

/**
 * Telnyx may show its Ed25519 verification key as either a PEM/SPKI value or
 * as the base64-encoded 32-byte public key. Web Crypto requires SPKI, so wrap
 * a raw Ed25519 public key in the standard SPKI prefix when needed.
 */
function telnyxPublicKeyToSpki(value: string): Uint8Array {
  const cleaned = value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const decoded = base64ToBytes(cleaned);

  // DER SubjectPublicKeyInfo prefix for an Ed25519 (OID 1.3.101.112) key.
  const ed25519SpkiPrefix = Uint8Array.of(
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  );

  if (decoded.byteLength !== 32) return decoded;

  const spki = new Uint8Array(ed25519SpkiPrefix.byteLength + decoded.byteLength);
  spki.set(ed25519SpkiPrefix);
  spki.set(decoded, ed25519SpkiPrefix.byteLength);
  return spki;
}

/**
 * Telnyx signs `timestamp|rawBody` with its account Ed25519 public key.
 * A missing or malformed signature always fails closed.
 */
export async function verifyTelnyxWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKey: string,
): Promise<boolean> {
  if (!signature || !timestamp || !publicKey) return false;

  const timestampValue = Number(timestamp);
  if (!Number.isFinite(timestampValue) || Math.abs(Date.now() / 1000 - timestampValue) > 5 * 60) {
    return false;
  }

  try {
    const importedKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(telnyxPublicKeyToSpki(publicKey)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "Ed25519",
      importedKey,
      toArrayBuffer(base64ToBytes(signature)),
      new TextEncoder().encode(`${timestamp}|${rawBody}`),
    );
  } catch {
    return false;
  }
}

export function maskPhoneNumber(value?: string): string | null {
  if (!value) return null;
  const suffix = value.replace(/\D/g, "").slice(-4);
  return suffix ? `***-***-${suffix}` : null;
}
