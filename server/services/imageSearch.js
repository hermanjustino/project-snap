// Real fashion-week photos for the globe's region popups, via Serper.dev's
// Google Images endpoint. (Google's own Custom Search JSON API is closed to
// new customers, and Bing's Search APIs were retired in Aug 2025 — Serper
// is the live option for "query in, real image URLs out.")
import "dotenv/config";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_IMAGES_URL = "https://google.serper.dev/images";

// The different sides of a city's style that the popup shows and Fit Check
// compares against — not just its runway.
export const STYLES = [
  { id: "runway", label: "Runway", query: (city, year) => `${city} Fashion Week ${year}` },
  { id: "streetwear", label: "Streetwear", query: (city, year) => `${city} streetwear street style ${year}` },
  { id: "everyday", label: "Everyday", query: (city, year) => `${city} locals everyday outfits ${year} -"fashion week"` },
  { id: "heritage", label: "Heritage", query: (city) => `${city} traditional fashion modern style` },
];

// Popup and Fit Check search the same city/year back to back, and every style
// is a separate Serper query, so remember results for a while per instance.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

export async function searchImages(query, limit = 8) {
  const key = `${query}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.images;

  const images = await fetchSerperImages(query, limit);
  cache.set(key, { at: Date.now(), images });
  return images;
}

/**
 * Searches every style in STYLES for a city in parallel. A style whose search
 * fails comes back with no images rather than failing the whole city.
 */
// City names that also belong to somewhere else get their country added to the
// broader searches (e.g. "Lagos" otherwise also matches Lagos, Portugal).
const AMBIGUOUS_CITIES = { Lagos: "Lagos Nigeria" };

export async function searchCityStyles(city, year, perStyle = 4) {
  const place = AMBIGUOUS_CITIES[city] || city;
  const results = await Promise.allSettled(STYLES.map((style) => searchImages(style.query(place, year), perStyle)));
  return STYLES.map((style, i) => {
    if (results[i].status === "rejected") console.warn(`[image-search] ${style.id} failed:`, results[i].reason?.message);
    return {
      style: style.id,
      label: style.label,
      images: results[i].status === "fulfilled" ? results[i].value : [],
    };
  });
}

async function fetchSerperImages(query, limit) {
  if (!SERPER_API_KEY) {
    throw new Error(
      "SERPER_API_KEY is not set. Get a free key at https://serper.dev and add it to .env."
    );
  }

  const response = await fetch(SERPER_IMAGES_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: limit }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Serper request failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const images = (data.images || []).slice(0, limit).map((img) => ({
    imageUrl: img.imageUrl,
    thumbnailUrl: img.thumbnailUrl || img.imageUrl,
    title: img.title,
    source: img.link,
  }));

  return images;
}

/**
 * Downloads an image (e.g. one of the search results above) and returns it
 * as base64 + mime type, ready to hand to Gemini as inlineData.
 */
const imageCache = new Map();
const IMAGE_CACHE_MAX = 300; // ~10KB thumbnails, so a few MB at most

export async function fetchImageAsBase64(url) {
  const hit = imageCache.get(url);
  if (hit) return hit;
  const image = await downloadImage(url);
  if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);
  imageCache.set(url, image);
  return image;
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { base64: buffer.toString("base64"), mimeType };
}
