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

export async function geocodeVenues(DB) {
  const { results: ungeocoded } = await DB.prepare(`
    SELECT id, name, address FROM venues
    WHERE (lat IS NULL OR lng IS NULL) AND address IS NOT NULL
  `).all();

  if (!ungeocoded.length) {
    console.log('All venues already geocoded.');
    return;
  }

  const update = DB.prepare(`UPDATE venues SET lat=?1, lng=?2, geocoded_at=?3 WHERE id=?4`);
  let done = 0;

  for (const venue of ungeocoded) {
    const coords = await geocodeAddress(venue.address);
    if (coords) {
      await update.bind(coords.lat, coords.lng, new Date().toISOString(), venue.id).run();
      done++;
      console.log(`Geocoded ${done}/${ungeocoded.length}: ${venue.name}`);
    }
    await sleep(1100);
  }

  console.log(`Geocoded ${done}/${ungeocoded.length} venues.`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
