// fitd's own cookieless analytics.
//
// Nothing is stored on the visitor's device. To count a visitor once per day,
// the server hashes their IP address + browser user agent with a random salt
// that changes every day; the same person gets the same hash all day, but the
// salt is thrown away afterwards, so hashes can't be linked across days or
// turned back into an IP. Only the hash is ever written (and it expires after
// 2 days); IP addresses are never stored.
//
// Storage is one Firestore document of counters per day. Locally (or when
// ANALYTICS_STORE=memory) counts live in memory instead, so development needs
// no Google Cloud credentials.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const TIME_ZONE = "America/Toronto"; // where a "day" starts and ends
const KEEP_HASHES_MS = 2 * 24 * 60 * 60 * 1000;

const CITY_IDS = new Set(
  JSON.parse(readFileSync(new URL("../../public/data/cities.json", import.meta.url), "utf8")).map((c) => c.id)
);
const PAGES = new Set(["/", "/closet.html"]);
const MODES = new Set(["city-match", "city"]);
const TIMERS = new Set([0, 3, 5]);
const OWN_HOSTS = /(^|\.)thefitd\.com$|\.run\.app$|^localhost$|^127\.0\.0\.1$/;
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|httpclient|monitor/i;

export function dayKey(date = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

function deviceType(userAgent) {
  if (/iPad|Tablet/i.test(userAgent)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(userAgent)) return "mobile";
  return "desktop";
}

function referrerHost(referrer) {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    return OWN_HOSTS.test(host) ? null : host;
  } catch {
    return null;
  }
}

const cityOrNull = (city) => (CITY_IDS.has(city) ? city : null);

/**
 * Turns an incoming event into the counters to increment, or null to ignore
 * it. Only known events and known values get through, so the stored data
 * can't grow arbitrary keys or carry anything personal.
 *
 * Returns nested { field: { key: n } } increments, e.g.
 * { pageviews: 1, pages: { "/": 1 }, devices: { mobile: 1 } }.
 */
export function countersFor(event, props = {}) {
  switch (event) {
    case "pageview": {
      const page = PAGES.has(props.path) ? props.path : "other";
      const counters = { pageviews: 1, pages: { [page]: 1 }, devices: { [props.device]: 1 } };
      counters.referrers = { [props.referrer ?? "direct"]: 1 };
      return counters;
    }
    case "fit_check_opened":
      if (!MODES.has(props.mode)) return null;
      return { events: { fit_check_opened: 1 }, fitCheckModes: { [props.mode]: 1 } };
    case "photo_captured":
      if (!MODES.has(props.mode) || !TIMERS.has(props.timer)) return null;
      return { events: { photo_captured: 1 }, timers: { [`${props.timer}s`]: 1 } };
    case "city_match_result": {
      const city = cityOrNull(props.city);
      return city && { events: { city_match_result: 1 }, cityMatches: { [city]: 1 } };
    }
    case "fit_check_result": {
      const city = cityOrNull(props.city);
      return city && { events: { fit_check_result: 1 }, cityFitChecks: { [city]: 1 } };
    }
    case "share_tapped":
      if (!MODES.has(props.mode)) return null;
      return { events: { share_tapped: 1 } };
    case "city_opened": {
      const city = cityOrNull(props.city);
      return city && { events: { city_opened: 1 }, cityOpens: { [city]: 1 } };
    }
    default:
      return null;
  }
}

// --- Stores ---------------------------------------------------------------

function mergeCounts(target, counters) {
  for (const [field, value] of Object.entries(counters)) {
    if (typeof value === "number") target[field] = (target[field] ?? 0) + value;
    else mergeCounts((target[field] ??= {}), value);
  }
}

function memoryStore() {
  const days = new Map();
  const visitors = new Set();
  const salts = new Map();
  return {
    async increment(day, counters) {
      mergeCounts(days.get(day) ?? days.set(day, {}).get(day), counters);
    },
    async isNewVisitor(day, hash) {
      const key = `${day}_${hash}`;
      if (visitors.has(key)) return false;
      visitors.add(key);
      return true;
    },
    async saltFor(day) {
      if (!salts.has(day)) salts.set(day, crypto.randomBytes(32).toString("hex"));
      return salts.get(day);
    },
    async readDays(dayKeys) {
      return dayKeys.map((day) => ({ day, ...(days.get(day) ?? {}) }));
    },
  };
}

async function firestoreStore() {
  const { Firestore, FieldValue } = await import("@google-cloud/firestore");
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const daysCol = db.collection("analytics_days");
  const visitorsCol = db.collection("analytics_visitors");
  const saltsCol = db.collection("analytics_salts");
  const saltCache = new Map();

  const toIncrements = (counters) =>
    Object.fromEntries(
      Object.entries(counters).map(([field, value]) => [
        field,
        typeof value === "number" ? FieldValue.increment(value) : toIncrements(value),
      ])
    );
  const expiresAt = () => new Date(Date.now() + KEEP_HASHES_MS);

  return {
    async increment(day, counters) {
      // merge + nested increments adds to existing counters, creating the
      // day's document (and any new keys) on first use.
      await daysCol.doc(day).set(toIncrements(counters), { merge: true });
    },
    async isNewVisitor(day, hash) {
      try {
        await visitorsCol.doc(`${day}_${hash}`).create({ expireAt: expiresAt() });
        return true;
      } catch (err) {
        if (err.code === 6) return false; // ALREADY_EXISTS: seen today
        throw err;
      }
    },
    async saltFor(day) {
      if (saltCache.has(day)) return saltCache.get(day);
      // Every Cloud Run instance must use the same salt for the day, so the
      // first one to need it creates it and the rest read it.
      const salt = await db.runTransaction(async (tx) => {
        const ref = saltsCol.doc(day);
        const snap = await tx.get(ref);
        if (snap.exists) return snap.get("salt");
        const fresh = crypto.randomBytes(32).toString("hex");
        tx.create(ref, { salt: fresh, expireAt: expiresAt() });
        return fresh;
      });
      saltCache.clear(); // only today's salt is ever needed in memory
      saltCache.set(day, salt);
      return salt;
    },
    async readDays(dayKeys) {
      const snaps = await db.getAll(...dayKeys.map((day) => daysCol.doc(day)));
      return snaps.map((snap, i) => ({ day: dayKeys[i], ...(snap.data() ?? {}) }));
    },
  };
}

// K_SERVICE is set on Cloud Run; anywhere else defaults to the memory store.
const useFirestore = (process.env.ANALYTICS_STORE ?? (process.env.K_SERVICE ? "firestore" : "memory")) === "firestore";
const storePromise = useFirestore ? firestoreStore() : Promise.resolve(memoryStore());
console.log(`[analytics] using ${useFirestore ? "Firestore" : "in-memory"} store`);

// --- Public API ---------------------------------------------------------------

/**
 * Records one event. `request` supplies the IP and user agent (used only to
 * derive today's visitor hash) and the referrer, for page views.
 */
export async function recordEvent({ event, props = {}, ip, userAgent = "", referrer = "" }) {
  if (!userAgent || BOTS.test(userAgent)) return;

  const extra = event === "pageview" ? { device: deviceType(userAgent), referrer: referrerHost(referrer) } : {};
  const counters = countersFor(event, { ...props, ...extra });
  if (!counters) return;

  const store = await storePromise;
  const day = dayKey();
  if (event === "pageview") {
    const salt = await store.saltFor(day);
    const hash = crypto.createHash("sha256").update(`${salt}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
    if (await store.isNewVisitor(day, hash)) counters.visitors = 1;
  }
  await store.increment(day, counters);
}

/** Daily counters for the last `days` days, oldest first. */
export async function readStats(days) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
  const store = await storePromise;
  return store.readDays([...new Set(keys)]);
}
