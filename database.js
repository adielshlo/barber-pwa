const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
    ON appointments (date, time_slot)
    WHERE status != 'cancelled';

  CREATE TABLE IF NOT EXISTS open_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    UNIQUE (date, time_slot)
  );
`);

// The previous schema used a blocklist model (blocked_slots removed hours
// from an implicit 9-18 default). That model is incompatible with the new
// whitelist model (open_slots explicitly grants hours), so the old table is
// dropped rather than migrated. Existing appointments are untouched.
const hasBlockedSlots = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blocked_slots'`)
  .get();
if (hasBlockedSlots) {
  db.exec(`DROP TABLE blocked_slots`);
}

// Backfill: any pre-existing active appointment implies its slot was open.
db.exec(`
  INSERT OR IGNORE INTO open_slots (date, time_slot)
  SELECT date, time_slot FROM appointments WHERE status != 'cancelled'
`);

module.exports = db;
