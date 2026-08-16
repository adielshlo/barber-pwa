require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const usingTurso = Boolean(process.env.TURSO_DATABASE_URL);
const localPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');

if (!usingTurso) {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
}

const db = createClient(
  usingTurso
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${localPath}` }
);

async function initDb() {
  if (!usingTurso) {
    await db.execute('PRAGMA journal_mode = WAL');
  }
  await db.execute('PRAGMA foreign_keys = ON');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
      ON appointments (date, time_slot)
      WHERE status != 'cancelled'
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS open_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      UNIQUE (date, time_slot)
    )
  `);

  // The previous schema used a blocklist model (blocked_slots removed hours
  // from an implicit 9-18 default). That model is incompatible with the new
  // whitelist model (open_slots explicitly grants hours), so the old table is
  // dropped rather than migrated. Existing appointments are untouched.
  const hasBlockedSlots = await db.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blocked_slots'`
  );
  if (hasBlockedSlots.rows.length > 0) {
    await db.execute('DROP TABLE blocked_slots');
  }

  // Backfill: any pre-existing active appointment implies its slot was open.
  await db.execute(`
    INSERT OR IGNORE INTO open_slots (date, time_slot)
    SELECT date, time_slot FROM appointments WHERE status != 'cancelled'
  `);
}

module.exports = { db, initDb };
