const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'ra-map.db');

let _db;
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      name TEXT,
      address TEXT,
      content_url TEXT,
      area_name TEXT,
      country_name TEXT,
      lat REAL,
      lng REAL,
      geocoded_at TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT,
      date TEXT,
      start_time TEXT,
      end_time TEXT,
      cost TEXT,
      content TEXT,
      lineup TEXT,
      attending INTEGER,
      interested_count INTEGER,
      is_ticketed INTEGER,
      is_festival INTEGER,
      flyer_front TEXT,
      content_url TEXT,
      venue_id TEXT,
      area_id TEXT,
      area_name TEXT,
      artists_json TEXT,
      genres_json TEXT,
      images_json TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id TEXT,
      date_from TEXT,
      date_to TEXT,
      event_count INTEGER,
      fetched_at TEXT
    );
  `);
}

module.exports = { getDb };
