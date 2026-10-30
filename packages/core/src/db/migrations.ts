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
  /* sql */ `
  -- Local files: size and mtime let rescans skip files that haven't changed.
  ALTER TABLE sources ADD COLUMN mtime_ms INTEGER;
  ALTER TABLE sources ADD COLUMN size INTEGER;
  `,
  /* sql */ `
  -- Link resolutions (PLAN §5), keyed by provider and track ID, so a link resolves
  -- once however it's formatted. Only confident matches are kept.
  CREATE TABLE resolutions (
    link_key    TEXT PRIMARY KEY,
    candidate   TEXT NOT NULL,
    resolved_at TEXT NOT NULL
  );
  `,
  /* sql */ `
  -- IDs of recordings merged into another (PLAN §3), so they keep working.
  CREATE TABLE recording_aliases (
    id           TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE
  );
  CREATE INDEX recording_aliases_recording ON recording_aliases(recording_id);
  `,
  /* sql */ `
  -- Audio analysis (PLAN §7): when it ran, and why it failed if it did. A failed
  -- analysis keeps its row, so the track isn't retried until the analyzer changes.
  ALTER TABLE features ADD COLUMN analyzed_at TEXT;
  ALTER TABLE features ADD COLUMN error TEXT;
  `,
  /* sql */ `
  -- Play history (the History page): one row per track start. Seeded with each
  -- recording's last play, so the page doesn't start empty.
  CREATE TABLE plays (
    id           INTEGER PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    played_at    TEXT NOT NULL,
    engine       TEXT,
    origin       TEXT,
    requested_by TEXT
  );
  CREATE INDEX plays_played_at ON plays(played_at);
  INSERT INTO plays (recording_id, played_at)
    SELECT id, last_played_at FROM recordings WHERE last_played_at IS NOT NULL
    ORDER BY last_played_at;
  `,
  /* sql */ `
  -- OBS overlays (PLAN §8): each a JSON document, replaced whole on every change.
  -- The default one (id 'now-playing') is added by OverlayService.
  CREATE TABLE overlays (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    document   TEXT NOT NULL,
    revision   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
]
