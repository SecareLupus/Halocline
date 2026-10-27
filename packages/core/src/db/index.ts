import Database from 'better-sqlite3'
import { migrations } from './migrations'

export type Db = Database.Database

/** Opens (or creates) the database and brings its schema up to date. Pass `:memory:` in tests. */
export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export function getKv(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value
}

export function setKv(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
