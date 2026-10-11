CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT,
  name TEXT,
  description TEXT,
  tags TEXT DEFAULT '{}',
  latest_revision INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_project_name ON prompts(project_id, name);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT,
  revision INTEGER,
  template TEXT,
  variables TEXT DEFAULT '[]',
  model TEXT,
  note TEXT,
  author_user_id TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_lookup ON prompt_versions(prompt_id, revision);