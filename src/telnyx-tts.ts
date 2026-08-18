import type { Env } from "./types";

export function telnyxSpeechPayload(text: string, voice: string): Record<string, unknown> {
  return {
    payload: text,
    payload_type: "text",
    voice,
    language: "hi-IN",
    service_level: "premium",
    voice_settings: {
      voice_speed: 1.0,
      emotion: "friendly",
    },
    command_id: crypto.randomUUID(),
  };
}

async function callControl(env: Env, callControlId: string, action: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.TELNYX_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telnyx ${action} failed: ${response.status}`);
}

/** Plays text directly on the call. The audio is never stored by the Worker. */
export async function speakOnCall(env: Env, callControlId: string, text: string): Promise<void> {
  await callControl(env, callControlId, "speak", telnyxSpeechPayload(text, env.TELNYX_TTS_VOICE));
}

/** Clears queued speech as soon as Priya hears the caller begin speaking. */
export async function stopCallSpeech(env: Env, callControlId: string): Promise<void> {
  await callControl(env, callControlId, "playback_stop", { stop: "all", command_id: crypto.randomUUID() });
}
