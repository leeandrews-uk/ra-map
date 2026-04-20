/**
 * Fetch RA events for London (area 13) and store in SQLite.
 * Usage:
 *   node scripts/fetch-events.js                      # next 30 days
 *   node scripts/fetch-events.js 2026-04-01 2026-06-30
 *   node scripts/fetch-events.js 2026-04-01 2026-06-30 13,15  # multiple areas
 */

const { fetchAllEvents } = require('../ra-client');
const { getDb } = require('../db');
const { geocodeVenues } = require('../geocoder');

// Default: London (13), South+East (15)
const DEFAULT_AREAS = [13, 15];

const [,, argFrom, argTo, argAreas] = process.argv;
const dateFrom = argFrom || formatDate(new Date());
const dateTo = argTo || formatDate(addDays(new Date(), 30));
const areaIds = argAreas ? argAreas.split(',').map(Number) : DEFAULT_AREAS;

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

async function main() {
  const db = getDb();
  console.log(`Fetching events ${dateFrom} → ${dateTo} for areas: ${areaIds.join(', ')}`);

  const upsertVenue = db.prepare(`
    INSERT OR REPLACE INTO venues (id, name, address, content_url, area_name, country_name, fetched_at)
    VALUES (@id, @name, @address, @contentUrl, @areaName, @countryName, @fetchedAt)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, address=excluded.address, fetched_at=excluded.fetched_at
  `);

  const upsertEvent = db.prepare(`
    INSERT OR REPLACE INTO events (
      id, title, date, start_time, end_time, cost, content, lineup,
      attending, interested_count, is_ticketed, is_festival,
      flyer_front, content_url, venue_id, area_id, area_name,
      artists_json, genres_json, images_json, fetched_at
    ) VALUES (
      @id, @title, @date, @startTime, @endTime, @cost, @content, @lineup,
      @attending, @interestedCount, @isTicketed, @isFestival,
      @flyerFront, @contentUrl, @venueId, @areaId, @areaName,
      @artistsJson, @genresJson, @imagesJson, @fetchedAt
    )
  `);

  let totalSaved = 0;

  for (const areaId of areaIds) {
    console.log(`\nArea ${areaId}...`);
    const listings = await fetchAllEvents({
      areaId,
      dateFrom,
      dateTo,
      onProgress: (n, total) => process.stdout.write(`\r  ${n}/${total} events`),
    });
    console.log('');

    const now = new Date().toISOString();
    const saveAll = db.transaction((listings) => {
      for (const listing of listings) {
        const e = listing.event;
        if (!e) continue;

        if (e.venue) {
          upsertVenue.run({
            id: e.venue.id,
            name: e.venue.name,
            address: e.venue.address || null,
            contentUrl: e.venue.contentUrl || null,
            areaName: e.venue.area?.name || null,
            countryName: e.venue.country?.name || null,
            fetchedAt: now,
          });
        }

        upsertEvent.run({
          id: e.id,
          title: e.title,
          date: e.date,
          startTime: e.startTime,
          endTime: e.endTime,
          cost: e.cost || null,
          content: e.content || null,
          lineup: e.lineup || null,
          attending: e.attending,
          interestedCount: e.interestedCount,
          isTicketed: e.isTicketed ? 1 : 0,
          isFestival: e.isFestival ? 1 : 0,
          flyerFront: e.flyerFront || null,
          contentUrl: e.contentUrl || null,
          venueId: e.venue?.id || null,
          areaId: e.area?.id || String(areaId),
          areaName: e.area?.name || null,
          artistsJson: JSON.stringify(e.artists || []),
          genresJson: JSON.stringify(e.genres || []),
          imagesJson: JSON.stringify(e.images || []),
          fetchedAt: now,
        });
      }
    });

    saveAll(listings);
    totalSaved += listings.length;

    db.prepare(`
      INSERT INTO fetch_log (area_id, date_from, date_to, event_count, fetched_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(areaId), dateFrom, dateTo, listings.length, now);
  }

  console.log(`\nSaved ${totalSaved} events total.`);
  console.log('Geocoding venues without coordinates...');
  await geocodeVenues(db);
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
