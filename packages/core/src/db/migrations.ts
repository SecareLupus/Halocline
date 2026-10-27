// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
// Never edit a migration once it has shipped; add a new one.
export const migrations: string[] = [
  /* sql */ `
  CREATE TABLE recordings (
    pk             INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    artists        TEXT NOT NULL,            -- JSON array
    album          TEXT,
    duration_ms    INTEGER,
    isrc           TEXT,
    artwork        TEXT,
    in_library     INTEGER NOT NULL DEFAULT 0,
    stream_safe    INTEGER NOT NULL DEFAULT 0,
    tags           TEXT NOT NULL DEFAULT '[]', -- JSON array
    added_at       TEXT NOT NULL,
    play_count     INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT
  );
  CREATE INDEX recordings_isrc ON recordings(isrc) WHERE isrc IS NOT NULL;

  CREATE VIRTUAL TABLE recordings_fts USING fts5(
    title, artists, album,
    content='recordings', content_rowid='pk',
    tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER recordings_ai AFTER INSERT ON recordings BEGIN
    INSERT INTO recordings_fts(rowid, title, artists, album)
    VALUES (new.pk, new.title, new.artists, new.album);
  END;
  CREATE TRIGGER recordings_ad AFTER DELETE ON recordings BEGIN
    INSERT INTO recordings_fts(recordings_fts, rowid, title, artists, album)
    VALUES ('delete', old.pk, old.title, old.artists, old.album);
  END;
  CREATE TRIGGER recordings_au AFTER UPDATE OF title, artists, album ON recordings BEGIN
    INSERT INTO recordings_fts(recordings_fts, rowid, title, artists, album)
    VALUES ('delete', old.pk, old.title, old.artists, old.album);
    INSERT INTO recordings_fts(rowid, title, artists, album)
    VALUES (new.pk, new.title, new.artists, new.album);
  END;

  CREATE TABLE sources (
    id            TEXT PRIMARY KEY,
    recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    locator       TEXT NOT NULL,
    format        TEXT,
    bitrate       INTEGER,
    available     INTEGER NOT NULL DEFAULT 1,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_checked  TEXT,
    UNIQUE (kind, locator)
  );
  CREATE INDEX sources_recording ON sources(recording_id);

  CREATE TABLE features (
    recording_id  TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
    bpm           REAL,
    camelot_key   TEXT,
    loudness_lufs REAL,
    energy        REAL,
    embedding     BLOB,
    genres        TEXT NOT NULL DEFAULT '[]',
    analyzed_from TEXT,
    version       INTEGER NOT NULL
  );

  CREATE TABLE queue_items (
    id               TEXT PRIMARY KEY,
    recording_id     TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    pinned_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    origin           TEXT NOT NULL,
    requested_by     TEXT,
    added_at         TEXT NOT NULL,
    position         INTEGER NOT NULL
  );
  CREATE INDEX queue_items_position ON queue_items(position);

  CREATE TABLE api_tokens (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    hash               TEXT NOT NULL UNIQUE,
    scopes             TEXT NOT NULL,         -- JSON array
    rate_limit_per_min INTEGER,
    created_at         TEXT NOT NULL,
    last_used_at       TEXT
  );

  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
]
