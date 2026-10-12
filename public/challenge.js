// "What city is your fit?" challenge links. A shared result links to
// thefitd.com/?c=<city id>.<match %>&n=<first name>, which opens a card
// challenging the friend to check their own fit. Everything is in the link
// itself: no photo or account is stored anywhere.
export const SITE_URL = "https://thefitd.com";
const NAME_KEY = "fitd.name";
const MAX_NAME = 20;

export function cleanName(name) {
  return String(name ?? "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, MAX_NAME);
}

export function savedName() {
  try {
    return cleanName(localStorage.getItem(NAME_KEY));
  } catch {
    return "";
  }
}

export function saveName(name) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* not remembered */
  }
}

export function challengeUrl({ cityId, pct }, name) {
  const url = new URL(SITE_URL);
  url.searchParams.set("c", `${cityId}.${pct}`);
  if (name) url.searchParams.set("n", name);
  return url.toString();
}

/**
 * Reads a challenge from the page's address, or null if there isn't a valid
 * one. Only known cities and whole percentages get through.
 */
export function readChallenge(cities, search = location.search) {
  const params = new URLSearchParams(search);
  const match = /^([a-z]{2,4})\.(\d{1,3})$/.exec(params.get("c") ?? "");
  if (!match) return null;
  const city = cities.find((c) => c.id === match[1]);
  const pct = Number(match[2]);
  if (!city || pct < 1 || pct > 100) return null;
  return { cityId: city.id, city: city.label, lat: city.lat, lng: city.lng, pct, name: cleanName(params.get("n")) };
}

/** Removes the challenge from the address bar, so a reload starts fresh. */
export function clearChallengeFromUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("c");
  url.searchParams.delete("n");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
