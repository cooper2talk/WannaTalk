CREATE TABLE IF NOT EXISTS calls (
  call_control_id TEXT PRIMARY KEY,
  call_session_id TEXT,
  caller_number TEXT,
  called_number TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS transcript_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_control_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (call_control_id) REFERENCES calls(call_control_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS transcript_turns_call_created_idx ON transcript_turns(call_control_id, created_at);
CREATE INDEX IF NOT EXISTS calls_started_at_idx ON calls(started_at);
