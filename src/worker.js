import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { fetchAllEvents } from './ra-client.js';
import { geocodeVenues } from './geocoder.js';

const app = new Hono();

// ─── API routes ───────────────────────────────────────────────────────────────

app.get('/api/events', async (c) => {
  const { from, to, area, genre, search, venue_id } = c.req.query();
  const DB = c.env.DB;

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

  if (from)     { sql += ` AND date(e.date) >= ?`; params.push(from); }
  if (to)       { sql += ` AND date(e.date) <= ?`; params.push(to); }
  if (area)     { sql += ` AND e.area_id = ?`; params.push(area); }
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

  const { results } = await DB.prepare(sql).bind(...params).all();
  return c.json(results.map(parseJsonFields));
});

app.get('/api/venues', async (c) => {
  const { from, to } = c.req.query();
  const DB = c.env.DB;

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

  const { results } = await DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

app.get('/api/genres', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT DISTINCT genres_json FROM events WHERE genres_json != '[]'`)
    .all();
  const genres = new Map();
  for (const row of results) {
    for (const g of JSON.parse(row.genres_json)) {
      genres.set(g.id, g.name);
    }
  }
  return c.json([...genres.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
});

app.get('/api/areas', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT DISTINCT area_id AS id, area_name AS name FROM events WHERE area_id IS NOT NULL`)
    .all();
  return c.json(results);
});

app.get('/api/stats', async (c) => {
  const DB = c.env.DB;
  const [events, venues, geocoded, lastFetch] = await Promise.all([
    DB.prepare(`SELECT COUNT(*) AS n FROM events`).first(),
    DB.prepare(`SELECT COUNT(*) AS n FROM venues`).first(),
    DB.prepare(`SELECT COUNT(*) AS n FROM venues WHERE lat IS NOT NULL`).first(),
    DB.prepare(`SELECT fetched_at FROM fetch_log ORDER BY id DESC LIMIT 1`).first(),
  ]);
  return c.json({
    events: events.n,
    venues: venues.n,
    venuesGeocoded: geocoded.n,
    lastFetch: lastFetch?.fetched_at || null,
  });
});

// ─── Static frontend ──────────────────────────────────────────────────────────
app.use('*', serveStatic({ root: './' }));

// ─── Scheduled fetch (cron trigger) ──────────────────────────────────────────
async function scheduled(event, env) {
  const DB = env.DB;
  const DEFAULT_AREAS = [13, 15];
  const dateFrom = formatDate(new Date());
  const dateTo = formatDate(addDays(new Date(), 30));

  console.log(`Scheduled fetch: ${dateFrom} → ${dateTo}`);

  // INSERT OR IGNORE + UPDATE preserves geocoded lat/lng; INSERT OR REPLACE would delete the row first
  const upsertVenue = DB.prepare(`
    INSERT INTO venues (id, name, address, content_url, area_name, country_name, fetched_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, address=excluded.address, fetched_at=excluded.fetched_at
  `);

  const upsertEvent = DB.prepare(`
    INSERT OR REPLACE INTO events (
      id, title, date, start_time, end_time, cost, content, lineup,
      attending, interested_count, is_ticketed, is_festival,
      flyer_front, content_url, venue_id, area_id, area_name,
      artists_json, genres_json, images_json, fetched_at
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
      ?9, ?10, ?11, ?12,
      ?13, ?14, ?15, ?16, ?17,
      ?18, ?19, ?20, ?21
    )
  `);

  const now = new Date().toISOString();

  for (const areaId of DEFAULT_AREAS) {
    console.log(`Fetching area ${areaId}...`);
    const listings = await fetchAllEvents({ areaId, dateFrom, dateTo });

    const venueStmts = [];
    const eventStmts = [];

    for (const listing of listings) {
      const e = listing.event;
      if (!e) continue;

      if (e.venue) {
        venueStmts.push(upsertVenue.bind(
          e.venue.id, e.venue.name, e.venue.address || null,
          e.venue.contentUrl || null, e.venue.area?.name || null,
          e.venue.country?.name || null, now
        ));
      }

      eventStmts.push(upsertEvent.bind(
        e.id, e.title, e.date, e.startTime, e.endTime, e.cost || null,
        e.content || null, e.lineup || null, e.attending, e.interestedCount,
        e.isTicketed ? 1 : 0, e.isFestival ? 1 : 0,
        e.flyerFront || null, e.contentUrl || null,
        e.venue?.id || null, e.area?.id || String(areaId), e.area?.name || null,
        JSON.stringify(e.artists || []), JSON.stringify(e.genres || []),
        JSON.stringify(e.images || []), now
      ));
    }

    await DB.batch([...venueStmts, ...eventStmts]);

    await DB.prepare(`
      INSERT INTO fetch_log (area_id, date_from, date_to, event_count, fetched_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(String(areaId), dateFrom, dateTo, listings.length, now).run();

    console.log(`Saved ${listings.length} events for area ${areaId}`);
  }

  console.log('Geocoding venues...');
  await geocodeVenues(DB);
  console.log('Scheduled fetch complete.');
}

function formatDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

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

export default { fetch: app.fetch, scheduled };
