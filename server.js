const express = require('express');
const path = require('path');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.static(path.join(__dirname, 'public')));

// GET /api/events?from=2026-04-01&to=2026-04-30&area=13&genre=techno&search=fabric
app.get('/api/events', (req, res) => {
  const db = getDb();
  const { from, to, area, genre, search, venue_id } = req.query;

  let sql = `
    SELECT
      e.*,
      v.name AS venue_name,
      v.address AS venue_address,
      v.lat, v.lng,
      v.content_url AS venue_url
    FROM events e
    LEFT JOIN venues v ON e.venue_id = v.id
    WHERE 1=1
  `;
  const params = [];

  if (from) { sql += ` AND date(e.date) >= ?`; params.push(from); }
  if (to)   { sql += ` AND date(e.date) <= ?`; params.push(to); }
  if (area) { sql += ` AND e.area_id = ?`; params.push(area); }
  if (venue_id) { sql += ` AND e.venue_id = ?`; params.push(venue_id); }
  if (search) {
    sql += ` AND (e.title LIKE ? OR e.lineup LIKE ? OR v.name LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (genre) {
    sql += ` AND e.genres_json LIKE ?`;
    params.push(`%"name":"${genre}"%`);
  }

  sql += ` ORDER BY e.date ASC`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(parseJsonFields));
});

// GET /api/venues — venues that have coordinates, with event counts
app.get('/api/venues', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let eventFilter = '';
  const params = [];
  if (from) { eventFilter += ` AND date(e.date) >= ?`; params.push(from); }
  if (to)   { eventFilter += ` AND date(e.date) <= ?`; params.push(to); }

  const sql = `
    SELECT
      v.id, v.name, v.address, v.lat, v.lng, v.content_url,
      v.area_name, v.country_name,
      COUNT(e.id) AS event_count
    FROM venues v
    LEFT JOIN events e ON e.venue_id = v.id ${eventFilter}
    WHERE v.lat IS NOT NULL AND v.lng IS NOT NULL
    GROUP BY v.id
    HAVING event_count > 0
    ORDER BY event_count DESC
  `;

  res.json(db.prepare(sql).all(...params));
});

// GET /api/genres — distinct genres present in db
app.get('/api/genres', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT DISTINCT genres_json FROM events WHERE genres_json != '[]'`).all();
  const genres = new Map();
  for (const row of rows) {
    for (const g of JSON.parse(row.genres_json)) {
      genres.set(g.id, g.name);
    }
  }
  res.json([...genres.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
});

// GET /api/areas
app.get('/api/areas', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT DISTINCT area_id AS id, area_name AS name FROM events WHERE area_id IS NOT NULL`).all();
  res.json(rows);
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const db = getDb();
  const stats = {
    events: db.prepare(`SELECT COUNT(*) AS n FROM events`).get().n,
    venues: db.prepare(`SELECT COUNT(*) AS n FROM venues`).get().n,
    venuesGeocoded: db.prepare(`SELECT COUNT(*) AS n FROM venues WHERE lat IS NOT NULL`).get().n,
    lastFetch: db.prepare(`SELECT fetched_at FROM fetch_log ORDER BY id DESC LIMIT 1`).get()?.fetched_at || null,
  };
  res.json(stats);
});

function parseJsonFields(row) {
  return {
    ...row,
    artists: tryParse(row.artists_json, []),
    genres: tryParse(row.genres_json, []),
    images: tryParse(row.images_json, []),
  };
}

function tryParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

app.listen(PORT, () => {
  console.log(`ra-map server running at http://localhost:${PORT}`);
});
