/**
 * Geocode venue addresses using Nominatim (OpenStreetMap).
 * Free, no API key. Rate-limited to 1 req/sec per usage policy.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'ra-map/1.0 (personal project)';

async function geocodeAddress(address) {
  if (!address) return null;
  const url = `${NOMINATIM}?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

async function geocodeVenues(db) {
  const ungeocoded = db.prepare(`
    SELECT id, name, address FROM venues
    WHERE (lat IS NULL OR lng IS NULL) AND address IS NOT NULL
  `).all();

  if (!ungeocoded.length) {
    console.log('  All venues already geocoded.');
    return;
  }

  const update = db.prepare(`
    UPDATE venues SET lat=?, lng=?, geocoded_at=? WHERE id=?
  `);

  let done = 0;
  for (const venue of ungeocoded) {
    const coords = await geocodeAddress(venue.address);
    if (coords) {
      update.run(coords.lat, coords.lng, new Date().toISOString(), venue.id);
      done++;
      process.stdout.write(`\r  Geocoded ${done}/${ungeocoded.length}: ${venue.name.slice(0, 40)}`);
    }
    await sleep(1100); // Nominatim: max 1 req/sec
  }
  console.log(`\n  Geocoded ${done}/${ungeocoded.length} venues.`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { geocodeVenues, geocodeAddress };
