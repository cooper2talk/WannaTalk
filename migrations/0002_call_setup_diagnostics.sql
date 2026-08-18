CREATE TABLE IF NOT EXISTS call_setup_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  stage TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS call_setup_diagnostics_created_idx ON call_setup_diagnostics(created_at);
