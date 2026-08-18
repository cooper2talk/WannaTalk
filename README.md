# WannaTalk

Standalone Cloudflare/Telnyx test project for **Priya**, a Hindi/Hinglish conversational voice demo on `+1 540 390 8080`.

## Safety and data policy

- Inbound calls only; no call audio is recorded or retained.
- Short-lived debug transcripts and minimal call metadata are kept for 7 days, then deleted by a Worker Cron trigger.
- Priya only discusses friendly everyday topics: greetings, routines, hobbies, food, movies, and travel. She must not collect sensitive data or give medical, legal, financial, or other unapproved advice.

## Required Cloudflare resources

1. Create a D1 database named `wannatalk-debug`, then replace `database_id` in `wrangler.jsonc` with its ID.
2. Enable Workers AI, Durable Objects, D1, and billing.
3. Add the secrets below directly in Cloudflare. Do not put them in `.dev.vars`, source code, or Git.

```powershell
wrangler secret put TELNYX_API_KEY
wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY
wrangler secret put DASHBOARD_ADMIN_SECRET
```

For `TELNYX_WEBHOOK_PUBLIC_KEY`, copy the value from **Telnyx Mission Control →
Keys & Credentials → Public Key**. The Worker accepts the normal PEM value
and Telnyx's base64 public-key display format. Never use the Telnyx API key in
place of this verification key.

## Required Telnyx setup

Create a dedicated Voice API / Call Control Application for WannaTalk and bind only `+15403908080`. Set its webhook URL to:

`https://<your-worker>.workers.dev/webhooks/telnyx`

After deployment, its WebSocket endpoint is:

`wss://<your-worker>.workers.dev/media`

The Worker answers an incoming call and requests inbound PCMU 8 kHz streaming for transcription. It verifies all Telnyx webhooks before accepting them.
Cloudflare Workers AI receives raw PCMU audio as `audio/mulaw;rate=8000` and uses the supported Hindi `hi` language hint for transcription. Telnyx plays Priya's replies directly into the active call using its premium NaturalHD voice; the Worker never stores audio and does not require a Google service-account key.

## Local commands

```powershell
pnpm install
pnpm run check
pnpm test
pnpm run dev
```
