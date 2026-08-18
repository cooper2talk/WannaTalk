export interface Env {
  AI: Ai;
  DB: D1Database;
  CALL_SESSION: DurableObjectNamespace;
  TELNYX_API_KEY: string;
  TELNYX_WEBHOOK_PUBLIC_KEY: string;
  GOOGLE_TTS_SERVICE_ACCOUNT_JSON: string;
  DASHBOARD_ADMIN_SECRET: string;
  TELNYX_NUMBER: string;
  PRIYA_GREETING: string;
  GOOGLE_TTS_VOICE: string;
  TRANSCRIPT_RETENTION_DAYS: string;
}

export interface TelnyxWebhook {
  data?: {
    event_type?: string;
    id?: string;
    payload?: {
      call_control_id?: string;
      call_leg_id?: string;
      call_session_id?: string;
      from?: string;
      to?: string;
      [key: string]: unknown;
    };
  };
}

export interface CallRecord {
  callControlId: string;
  callSessionId?: string;
  callerNumber?: string;
  calledNumber?: string;
  startedAt: string;
  endedAt?: string;
  status: "ringing" | "active" | "ended" | "failed";
  lastError?: string;
}

export interface TranscriptTurn {
  speaker: "caller" | "priya" | "system";
  text: string;
  createdAt: string;
}
