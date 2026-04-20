const RA_GRAPHQL = 'https://ra.co/graphql';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36';

async function query(q, variables = {}) {
  const res = await fetch(RA_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query: q, variables }),
  });
  if (!res.ok) throw new Error(`RA API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

const EVENT_FIELDS = `
  id title date startTime endTime cost content lineup
  attending interestedCount isTicketed isFestival
  flyerFront flyerBack contentUrl
  area { id name }
  venue {
    id name address contentUrl live
    area { id name }
    country { name }
  }
  artists { id name contentUrl }
  genres { id name }
  images { id filename alt type }
`;

async function fetchEvents({ areaId, dateFrom, dateTo, page = 1, pageSize = 100 }) {
  const data = await query(`
    query GET_EVENTS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
      eventListings(
        filters: $filters
        pageSize: $pageSize
        page: $page
        sort: { listingDate: { priority: 1, order: ASCENDING } }
      ) {
        data {
          id
          listingDate
          event { ${EVENT_FIELDS} }
        }
        totalResults
      }
    }
  `, {
    filters: {
      areas: { eq: areaId },
      listingDate: { gte: dateFrom, lte: dateTo },
    },
    pageSize,
    page,
  });
  return data.eventListings;
}

export async function fetchAllEvents({ areaId, dateFrom, dateTo, pageSize = 100, onProgress }) {
  const first = await fetchEvents({ areaId, dateFrom, dateTo, page: 1, pageSize });
  const total = first.totalResults;
  const pages = Math.ceil(total / pageSize);
  let all = first.data;

  if (onProgress) onProgress(all.length, total);

  for (let p = 2; p <= pages; p++) {
    await sleep(300);
    const next = await fetchEvents({ areaId, dateFrom, dateTo, page: p, pageSize });
    all = all.concat(next.data);
    if (onProgress) onProgress(all.length, total);
  }

  return all;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
