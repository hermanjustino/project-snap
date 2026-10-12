// Fit passport: every city-match result stamps the matched city. Kept only in
// this browser (localStorage), like the wardrobe, so there's no account and
// nothing about it is sent to the server.
const PASSPORT_KEY = "fitd.passport";
const MAX_ENTRIES = 1000;

export function readPassport() {
  try {
    const entries = JSON.parse(localStorage.getItem(PASSPORT_KEY) || "[]");
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/** Records one check: { city: city id, pct: match %, at: timestamp }. */
export function stampPassport(city, pct) {
  const entries = readPassport();
  entries.push({ city, pct, at: Date.now() });
  try {
    localStorage.setItem(PASSPORT_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full or blocked: the stamp just isn't kept */
  }
}

/**
 * Totals per city: { checks, cities: Map(id -> { count, best, last }) }, with
 * the cities in the order they were first stamped.
 */
export function passportSummary(entries = readPassport()) {
  const cities = new Map();
  for (const { city, pct, at } of entries) {
    const stamp = cities.get(city) ?? { count: 0, best: 0, last: 0 };
    stamp.count += 1;
    stamp.best = Math.max(stamp.best, pct);
    stamp.last = Math.max(stamp.last, at);
    cities.set(city, stamp);
  }
  return { checks: entries.length, cities };
}
