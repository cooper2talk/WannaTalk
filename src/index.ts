import { CallSession } from "./call-session";
import { verifyTelnyxWebhook } from "./security";
import type { Env, TelnyxWebhook } from "./types";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function secureHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("content-security-policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isDashboardRequestAuthorized(request: Request, env: Env): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").some((item) => item.trim() === `wannatalk_admin=${env.DASHBOARD_ADMIN_SECRET}`);
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
}

function toWebSocketUrl(request: Request, callControlId: string): string {
  const url = new URL(request.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/media/${encodeURIComponent(callControlId)}`;
  url.search = "";
  return url.toString();
}

async function telnyxAnswerCall(request: Request, env: Env, callControlId: string): Promise<void> {
  const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/answer`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.TELNYX_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      stream_url: toWebSocketUrl(request, callControlId),
      stream_track: "inbound_track",
      stream_bidirectional_mode: "rtp",
      stream_bidirectional_codec: "PCMU",
    }),
  });
  if (!response.ok) throw new Error(`Telnyx answer failed: ${response.status}`);
}

function dashboardHtml(): string {
  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WannaTalk debug</title><style>
  body{margin:0;background:#061521;color:#eaf3f8;font:15px system-ui,sans-serif}main{max-width:1000px;margin:42px auto;padding:0 22px}h1{margin-bottom:4px}.tag{color:#54dfbb;font-size:12px;font-weight:700;letter-spacing:.14em}.note{color:#9cb5c4}table{width:100%;border-collapse:collapse;margin-top:28px;background:#0b2334}th,td{padding:12px;border-bottom:1px solid #1c3a4d;text-align:left}th{color:#8eabbc}.active{color:#54dfbb}.failed{color:#ff9b86}.turn{margin:8px 0;padding:10px;background:#102c3f;border-radius:8px}.caller{border-left:3px solid #f5c76e}.priya{border-left:3px solid #54dfbb}</style></head>
  <body><main><div class="tag">WANNATALK · PRIVATE DEBUG</div><h1>Priya live calls</h1><p class="note">Transcript-only debug data is deleted after 7 days. No call audio is stored.</p><div id="content">Loading calls…</div></main>
  <script>const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));async function load(){const r=await fetch('/api/debug/calls');if(!r.ok){location.href='/dashboard/login';return}const calls=await r.json();document.querySelector('#content').innerHTML=calls.length?'<table><thead><tr><th>State</th><th>Caller</th><th>Started</th><th>Transcript</th></tr></thead><tbody>'+calls.map(c=>'<tr><td class="'+esc(c.status)+'">'+esc(c.status)+'</td><td>'+esc(c.caller_number)+'</td><td>'+new Date(c.started_at).toLocaleString()+'</td><td><button data-id="'+esc(c.call_control_id)+'">View</button><div id="t-'+esc(c.call_control_id)+'"></div></td></tr>').join('')+'</tbody></table>':'No calls yet.';document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const id=b.dataset.id,d=document.querySelector('#t-'+id);const turns=await (await fetch('/api/debug/calls/'+encodeURIComponent(id)+'/turns')).json();d.innerHTML=turns.map(t=>'<div class="turn '+esc(t.speaker)+'"><b>'+esc(t.speaker)+'</b><br>'+esc(t.text)+'</div>').join('')})}load();setInterval(load,5000)</script></body></html>`;
}

function loginHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>WannaTalk debug login</title></head><body style="font:16px system-ui;max-width:400px;margin:12vh auto"><h1>WannaTalk debug</h1><form method="post" action="/dashboard/login"><label>Admin secret<br><input name="secret" type="password" autocomplete="current-password" required></label><p><button>Open dashboard</button></p></form></body></html>`;
}

async function dashboardLogin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  if (form.get("secret") !== env.DASHBOARD_ADMIN_SECRET) return new Response("Invalid secret", { status: 403 });
  return new Response(null, {
    status: 303,
    headers: { location: "/dashboard", "set-cookie": `wannatalk_admin=${env.DASHBOARD_ADMIN_SECRET}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` },
  });
}

async function handleTelnyxWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const verified = await verifyTelnyxWebhook(
    rawBody,
    request.headers.get("telnyx-signature-ed25519"),
    request.headers.get("telnyx-timestamp"),
    env.TELNYX_WEBHOOK_PUBLIC_KEY,
  );
  if (!verified) return new Response("Invalid Telnyx signature", { status: 401 });

  let event: TelnyxWebhook;
  try {
    event = JSON.parse(rawBody) as TelnyxWebhook;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const payload = event.data?.payload;
  if (event.data?.event_type === "call.initiated" && payload?.call_control_id && payload.to === env.TELNYX_NUMBER) {
    await telnyxAnswerCall(request, env, payload.call_control_id);
  }
  return new Response(null, { status: 204 });
}

async function purgeExpiredTranscripts(env: Env): Promise<void> {
  const days = Math.max(1, Number(env.TRANSCRIPT_RETENTION_DAYS) || 7);
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM transcript_turns WHERE created_at < ?").bind(threshold),
    env.DB.prepare("DELETE FROM calls WHERE started_at < ?").bind(threshold),
  ]);
}

export { CallSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return secureHeaders(new Response(JSON.stringify({ ok: true, service: "wannatalk" }), { headers: jsonHeaders }));
      if (request.method === "POST" && url.pathname === "/webhooks/telnyx") return secureHeaders(await handleTelnyxWebhook(request, env));
      if (url.pathname.startsWith("/media/") && request.headers.get("Upgrade") === "websocket") {
        const callControlId = decodeURIComponent(url.pathname.slice("/media/".length));
        const objectId = env.CALL_SESSION.idFromName(callControlId);
        const target = new URL("https://call-session.local/connect");
        target.searchParams.set("call_control_id", callControlId);
        return env.CALL_SESSION.get(objectId).fetch(new Request(target, request));
      }
      if (request.method === "GET" && url.pathname === "/dashboard/login") return secureHeaders(new Response(loginHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }));
      if (request.method === "POST" && url.pathname === "/dashboard/login") return secureHeaders(await dashboardLogin(request, env));
      if (request.method === "GET" && url.pathname === "/dashboard") {
        if (!isDashboardRequestAuthorized(request, env)) return Response.redirect(new URL("/dashboard/login", request.url), 303);
        return secureHeaders(new Response(dashboardHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }));
      }
      if (request.method === "GET" && url.pathname === "/api/debug/calls") {
        if (!isDashboardRequestAuthorized(request, env)) return unauthorized();
        const { results } = await env.DB.prepare("SELECT call_control_id, caller_number, called_number, started_at, ended_at, status, last_error FROM calls ORDER BY started_at DESC LIMIT 50").all();
        return secureHeaders(new Response(JSON.stringify(results), { headers: jsonHeaders }));
      }
      const turnsMatch = url.pathname.match(/^\/api\/debug\/calls\/([^/]+)\/turns$/);
      if (request.method === "GET" && turnsMatch) {
        if (!isDashboardRequestAuthorized(request, env)) return unauthorized();
        const { results } = await env.DB.prepare("SELECT speaker, text, created_at FROM transcript_turns WHERE call_control_id = ? ORDER BY id ASC").bind(decodeURIComponent(turnsMatch[1])).all();
        return secureHeaders(new Response(JSON.stringify(results), { headers: jsonHeaders }));
      }
      return secureHeaders(new Response("Not found", { status: 404 }));
    } catch (error) {
      console.error("WannaTalk request failed", error instanceof Error ? error.message : "unknown error");
      return secureHeaders(new Response("Internal server error", { status: 500 }));
    }
  },
  async scheduled(_: ScheduledEvent, env: Env): Promise<void> {
    await purgeExpiredTranscripts(env);
  },
};
