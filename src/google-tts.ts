import { base64ToBytes, bytesToBase64Url, toArrayBuffer } from "./security";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function pemToPkcs8(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
}

async function googleAccessToken(serviceAccountJson: string): Promise<string> {
  const account = JSON.parse(serviceAccountJson) as ServiceAccount;
  if (!account.client_email || !account.private_key) throw new Error("Google TTS credential is incomplete");

  const now = Math.floor(Date.now() / 1000);
  const tokenEndpoint = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: tokenEndpoint,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(pemToPkcs8(account.private_key)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(input))));
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${signature}` }),
  });
  if (!response.ok) throw new Error(`Google OAuth failed: ${response.status}`);
  const token = (await response.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Google OAuth returned no access token");
  return token.access_token;
}

/** Returns raw 8 kHz mu-law bytes, directly compatible with Telnyx PCMU media. */
export async function synthesizeHindiSpeech(serviceAccountJson: string, voiceName: string, text: string): Promise<string> {
  const accessToken = await googleAccessToken(serviceAccountJson);
  const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "hi-IN", name: voiceName },
      audioConfig: { audioEncoding: "MULAW", sampleRateHertz: 8000, speakingRate: 1.0 },
    }),
  });
  if (!response.ok) throw new Error(`Google TTS failed: ${response.status}`);
  const payload = (await response.json()) as { audioContent?: string };
  if (!payload.audioContent) throw new Error("Google TTS returned no audio");
  return payload.audioContent;
}
