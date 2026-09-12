// Real fashion-week photos for the globe's region popups, via Serper.dev's
// Google Images endpoint. (Google's own Custom Search JSON API is closed to
// new customers, and Bing's Search APIs were retired in Aug 2025 — Serper
// is the live option for "query in, real image URLs out.")
import "dotenv/config";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_IMAGES_URL = "https://google.serper.dev/images";

export async function searchFashionWeekImages(city, year, limit = 8) {
  if (!SERPER_API_KEY) {
    throw new Error(
      "SERPER_API_KEY is not set. Get a free key at https://serper.dev and add it to .env."
    );
  }

  const query = `${city} Fashion Week ${year}`;
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

  return { query, images };
}

/**
 * Downloads an image (e.g. one of the search results above) and returns it
 * as base64 + mime type, ready to hand to Gemini as inlineData.
 */
export async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { base64: buffer.toString("base64"), mimeType };
}
