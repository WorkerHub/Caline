-- 本文件由 worker/src/lib/schema.ts 生成，请勿手改。
-- 重写命令：pnpm --filter ./worker schema:sql
-- 它是唯一基线迁移 schema_v1 的逐字镜像，worker/test/schema-sql.test.ts 断言两者完全一致。
-- 历史增量迁移链已坍缩为单一 V1，全新建表即为最终形态。
-- 语句之间用分号分隔，语句内部不得出现分号（迁移执行器按分号切分）。
-- 表名/索引名里的 {prefix} 是占位符，执行时替换成生效的 TABLE_PREFIX。

CREATE TABLE IF NOT EXISTS {prefix}users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user',
  status               TEXT NOT NULL DEFAULT 'pending',
  email_verified       INTEGER NOT NULL DEFAULT 0,
  language             TEXT NOT NULL DEFAULT 'zh',
  display_name         TEXT NOT NULL DEFAULT '',
  timezone             TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  label                TEXT NOT NULL DEFAULT '',
  avatar               TEXT NOT NULL DEFAULT '',
  url                  TEXT NOT NULL DEFAULT '',
  github_id            TEXT
);

CREATE TABLE IF NOT EXISTS {prefix}user_2fa (
  user_id           INTEGER PRIMARY KEY,
  totp_secret       TEXT,
  totp_enabled      INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL,
  email_2fa_enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS {prefix}passkey_credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);

CREATE TABLE IF NOT EXISTS {prefix}sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS {prefix}email_verification_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register_verify', 'password_reset', 'email_2fa')),
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}auth_counters (
  key          TEXT PRIMARY KEY,
  action       TEXT NOT NULL,
  account      TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT '',
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}comment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER,
  nick            TEXT NOT NULL DEFAULT '',
  mail            TEXT NOT NULL DEFAULT '',
  link            TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL,
  pid             INTEGER,
  rid             INTEGER,
  content_raw     TEXT NOT NULL DEFAULT '',
  content_html    TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'approved',
  sticky          INTEGER NOT NULL DEFAULT 0,
  like_count      INTEGER NOT NULL DEFAULT 0,
  edit_token_hash TEXT,
  ip              TEXT NOT NULL DEFAULT '',
  ua              TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}counter (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL UNIQUE,
  pageview   INTEGER NOT NULL DEFAULT 0,
  reaction0  INTEGER NOT NULL DEFAULT 0,
  reaction1  INTEGER NOT NULL DEFAULT 0,
  reaction2  INTEGER NOT NULL DEFAULT 0,
  reaction3  INTEGER NOT NULL DEFAULT 0,
  reaction4  INTEGER NOT NULL DEFAULT 0,
  reaction5  INTEGER NOT NULL DEFAULT 0,
  reaction6  INTEGER NOT NULL DEFAULT 0,
  reaction7  INTEGER NOT NULL DEFAULT 0,
  reaction8  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_{prefix}users_github_id
  ON {prefix}users(github_id) WHERE github_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_{prefix}passkeys_user
  ON {prefix}passkey_credentials(user_id);

CREATE INDEX IF NOT EXISTS idx_{prefix}sessions_user
  ON {prefix}sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_{prefix}sessions_expires
  ON {prefix}sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_{prefix}email_codes_lookup
  ON {prefix}email_verification_codes(email, purpose, created_at);

CREATE INDEX IF NOT EXISTS idx_{prefix}email_codes_expires
  ON {prefix}email_verification_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_{prefix}auth_counters_action_account
  ON {prefix}auth_counters(action, account);

CREATE INDEX IF NOT EXISTS idx_{prefix}comment_url_status_created
  ON {prefix}comment(url, status, created_at);

CREATE INDEX IF NOT EXISTS idx_{prefix}comment_status_created
  ON {prefix}comment(status, created_at);

CREATE INDEX IF NOT EXISTS idx_{prefix}comment_rid
  ON {prefix}comment(rid);
