import { synthesizeHindiSpeech } from "./google-tts";
import { maskPhoneNumber, toArrayBuffer } from "./security";
import { PRIYA_SYSTEM_PROMPT, normalizeSpokenReply } from "./prompt";
import type { CallRecord, Env, TranscriptTurn } from "./types";

type StreamMessage = {
  event?: string;
  start?: { call_control_id?: string; call_session_id?: string; from?: string; to?: string };
  media?: { payload?: string; track?: string };
  stop?: { call_control_id?: string };
  mark?: { name?: string };
};

function fromBase64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function textFromTranscription(result: unknown): string {
  if (typeof result === "string") return result;
  const data = result as Record<string, unknown>;
  if (typeof data.text === "string") return data.text;
  if (typeof data.transcript === "string") return data.transcript;
  const channels = (data.results as Record<string, unknown> | undefined)?.channels as Array<Record<string, unknown>> | undefined;
  const alternatives = channels?.[0]?.alternatives as Array<Record<string, unknown>> | undefined;
  return typeof alternatives?.[0]?.transcript === "string" ? alternatives[0].transcript : "";
}

function textFromModel(result: unknown): string {
  if (typeof result === "string") return result;
  const data = result as Record<string, unknown>;
  return typeof data.response === "string" ? data.response : typeof data.text === "string" ? data.text : "";
}

export class CallSession {
  private call?: CallRecord;
  private turns: TranscriptTurn[] = [];
  private audioParts: Uint8Array[] = [];
  private lastAudioAt = 0;
  private lastAlarmAt = 0;
  private isSpeaking = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/connect" || request.headers.get("Upgrade") !== "websocket") {
      return new Response("Not found", { status: 404 });
    }
    const callControlId = url.searchParams.get("call_control_id");
    if (!callControlId) return new Response("Missing call_control_id", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    if (!this.call) {
      this.call = {
        callControlId,
        startedAt: new Date().toISOString(),
        status: "ringing",
      };
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let event: StreamMessage;
    try {
      event = JSON.parse(message) as StreamMessage;
    } catch {
      return;
    }

    if (event.event === "start") await this.handleStart(webSocket, event);
    if (event.event === "media" && event.media?.track !== "outbound") await this.handleMedia(webSocket, event);
    if (event.event === "mark") this.isSpeaking = false;
    if (event.event === "stop") await this.finish("ended");
  }

  async webSocketClose(): Promise<void> {
    if (this.call?.status === "active") await this.finish("ended");
  }

  async webSocketError(): Promise<void> {
    if (this.call?.status === "active") await this.finish("failed", "Telnyx media socket error");
  }

  async alarm(): Promise<void> {
    if (!this.call || this.call.status !== "active") return;
    if (Date.now() - this.lastAudioAt < 700) {
      await this.ctx.storage.setAlarm(Date.now() + 850);
      return;
    }
    const audio = concatBytes(this.audioParts);
    this.audioParts = [];
    if (audio.byteLength < 800) return;
    await this.transcribeAndReply(audio);
  }

  private async handleStart(webSocket: WebSocket, event: StreamMessage): Promise<void> {
    const callControlId = event.start?.call_control_id;
    if (!callControlId || (this.call && this.call.callControlId !== callControlId)) {
      webSocket.close(1008, "Unexpected call control ID");
      return;
    }
    this.call = {
      callControlId,
      callSessionId: event.start?.call_session_id,
      callerNumber: maskPhoneNumber(event.start?.from) ?? undefined,
      calledNumber: maskPhoneNumber(event.start?.to) ?? undefined,
      startedAt: this.call?.startedAt ?? new Date().toISOString(),
      status: "active",
    };
    await this.saveCall();
    await this.appendTurn("priya", this.env.PRIYA_GREETING);
    await this.sendSpeech(webSocket, this.env.PRIYA_GREETING);
  }

  private async handleMedia(webSocket: WebSocket, event: StreamMessage): Promise<void> {
    if (!event.media?.payload || !this.call || this.call.status !== "active") return;
    if (this.isSpeaking) {
      webSocket.send(JSON.stringify({ event: "clear" }));
      this.isSpeaking = false;
    }
    try {
      this.audioParts.push(fromBase64(event.media.payload));
    } catch {
      return;
    }
    this.lastAudioAt = Date.now();
    if (this.lastAudioAt - this.lastAlarmAt > 250) {
      this.lastAlarmAt = this.lastAudioAt;
      await this.ctx.storage.setAlarm(this.lastAudioAt + 850);
    }
  }

  private async transcribeAndReply(audio: Uint8Array): Promise<void> {
    try {
      const transcriptResponse = await this.env.AI.run("@cf/deepgram/nova-3", {
        // Workers AI requires binary input to be nested under `audio.body`.
        // Telnyx sends raw PCMU (mu-law), 8 kHz RTP payload bytes.
        audio: { body: toArrayBuffer(audio), contentType: "audio/mulaw;rate=8000" },
        encoding: "mulaw",
        language: "hi",
        smart_format: true,
      });
      const transcript = normalizeSpokenReply(textFromTranscription(transcriptResponse));
      if (!transcript) return;

      await this.appendTurn("caller", transcript);
      const replyResponse = await this.env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", {
        messages: [
          { role: "system", content: PRIYA_SYSTEM_PROMPT },
          ...this.turns.filter((turn) => turn.speaker !== "system").map((turn) => ({ role: turn.speaker === "priya" ? "assistant" : "user", content: turn.text })),
        ],
        max_tokens: 90,
        temperature: 0.55,
      });
      const reply = normalizeSpokenReply(textFromModel(replyResponse));
      if (!reply) return;

      await this.appendTurn("priya", reply);
      const socket = this.ctx.getWebSockets()[0];
      if (socket) await this.sendSpeech(socket, reply);
    } catch (error) {
      await this.fail(`AI inference error: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  private async sendSpeech(webSocket: WebSocket, text: string): Promise<void> {
    try {
      const audioContent = await synthesizeHindiSpeech(this.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON, this.env.GOOGLE_TTS_VOICE, text);
      this.isSpeaking = true;
      const markName = `priya-${crypto.randomUUID()}`;
      webSocket.send(JSON.stringify({ event: "media", media: { payload: audioContent } }));
      webSocket.send(JSON.stringify({ event: "mark", mark: { name: markName } }));
    } catch (error) {
      await this.fail(`TTS error: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  private async appendTurn(speaker: TranscriptTurn["speaker"], text: string): Promise<void> {
    const turn: TranscriptTurn = { speaker, text, createdAt: new Date().toISOString() };
    this.turns.push(turn);
    if (!this.call) return;
    await this.env.DB.prepare(
      "INSERT INTO transcript_turns (call_control_id, speaker, text, created_at) VALUES (?, ?, ?, ?)",
    ).bind(this.call.callControlId, turn.speaker, turn.text, turn.createdAt).run();
  }

  private async saveCall(): Promise<void> {
    if (!this.call) return;
    await this.env.DB.prepare(
      `INSERT INTO calls (call_control_id, call_session_id, caller_number, called_number, started_at, ended_at, status, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(call_control_id) DO UPDATE SET call_session_id=excluded.call_session_id, caller_number=excluded.caller_number,
       called_number=excluded.called_number, ended_at=excluded.ended_at, status=excluded.status, last_error=excluded.last_error`,
    ).bind(
      this.call.callControlId,
      this.call.callSessionId ?? null,
      this.call.callerNumber ?? null,
      this.call.calledNumber ?? null,
      this.call.startedAt,
      this.call.endedAt ?? null,
      this.call.status,
      this.call.lastError ?? null,
    ).run();
  }

  private async finish(status: CallRecord["status"], error?: string): Promise<void> {
    if (!this.call || this.call.status === "ended") return;
    this.call.status = status;
    this.call.endedAt = new Date().toISOString();
    this.call.lastError = error;
    await this.saveCall();
    this.audioParts = [];
  }

  private async fail(message: string): Promise<void> {
    if (!this.call) return;
    this.call.lastError = message;
    await this.saveCall();
  }
}
