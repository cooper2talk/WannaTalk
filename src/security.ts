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

function pemToDer(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ""));
}

/**
 * Telnyx signs `timestamp|rawBody` with its account Ed25519 public key.
 * A missing or malformed signature always fails closed.
 */
export async function verifyTelnyxWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyPem: string,
): Promise<boolean> {
  if (!signature || !timestamp || !publicKeyPem) return false;

  const timestampValue = Number(timestamp);
  if (!Number.isFinite(timestampValue) || Math.abs(Date.now() / 1000 - timestampValue) > 5 * 60) {
    return false;
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(pemToDer(publicKeyPem)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "Ed25519",
      publicKey,
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
