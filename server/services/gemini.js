// Gemini is fitd's "AI brain": it looks at wardrobe photos and turns
// them into structured metadata, then reasons over that metadata to build
// outfits and rate looks.
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

if (!apiKey) {
  console.warn(
    "[gemini] GEMINI_API_KEY is not set — Gemini calls will fail. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey"
  );
}

const ai = new GoogleGenAI({ apiKey });

function extractJson(text) {
  // Gemini sometimes wraps JSON in ```json fences — strip them defensively.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

/**
 * Analyze a single wardrobe photo and return structured metadata describing
 * the garment: category, colors, style tags, season, and a short description.
 */
export async function analyzeGarment(imageBase64, mimeType) {
  const prompt = `You are a fashion cataloger. Look at this photo of a single
clothing item or accessory and return ONLY a JSON object (no prose, no markdown
fences) with this exact shape:
{
  "category": "top | bottom | dress | outerwear | shoes | accessory | bag",
  "name": "short human-friendly name, e.g. 'Blue oxford button-down'",
  "colors": ["primary color", "secondary color"],
  "styleTags": ["e.g. casual, formal, streetwear, vintage, minimalist"],
  "season": ["spring", "summer", "fall", "winter"],
  "description": "one sentence description"
}`;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }],
      },
    ],
  });

  return extractJson(response.text);
}

/**
 * Given the wardrobe's structured metadata plus a request (occasion, weather,
 * vibe), ask Gemini to compose an outfit from the *existing* items by id.
 */
export async function suggestOutfit(wardrobeItems, request) {
  const catalog = wardrobeItems.map(({ id, category, name, colors, styleTags, season }) => ({
    id,
    category,
    name,
    colors,
    styleTags,
    season,
  }));

  const prompt = `You are an AI personal stylist. Here is the user's wardrobe
catalog as JSON:
${JSON.stringify(catalog, null, 2)}

The user's request: "${request}"

Pick a coherent outfit using ONLY item ids from the catalog above (do not
invent items). Return ONLY a JSON object (no prose, no markdown fences):
{
  "itemIds": ["id1", "id2", "..."],
  "outfitName": "short catchy name for the look",
  "stylingNotes": "2-3 sentences explaining why this works for the request",
  "confidence": "high | medium | low"
}
If the wardrobe truly cannot satisfy the request, return an empty itemIds
array and explain what's missing in stylingNotes.`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  return extractJson(response.text);
}

/**
 * Live "Fit Check": compare a captured frame against real reference photos of
 * each style in a city (runway, streetwear, everyday, heritage) and score how
 * well it fits in — plus which of those styles it's closest to.
 *
 * styleReferences: [{ label: "Streetwear", images: [{ base64, mimeType }] }]
 */
export async function rateFitAgainstTrends(selfieBase64, selfieMimeType, styleReferences, city, year) {
  const labels = styleReferences.map((s) => s.label);
  const prompt = `You are judging how well an outfit fits in with ${city}'s
fashion scene in ${year}. The FIRST image is a person's live outfit, captured
just now. After it come real reference photos of different sides of ${city}'s
style, grouped by style; each group is introduced by its style name. The
styles are: ${labels.join(", ")}.

Rate how well the outfit would fit in with ${city} overall: an outfit that
nails any one of these styles should score well — it doesn't need to look
like the runway. Return ONLY a JSON object (no prose, no markdown fences):
{
  "fitScore": 1-100,
  "closestStyle": "the one style it's closest to, exactly one of: ${labels.join(" | ")}",
  "verdict": "a short punchy one-line verdict, e.g. 'Straight off a ${city} sidewalk' or 'Not quite ${city} yet'",
  "reasoning": "2-3 sentences comparing the outfit to the reference looks, naming the styles it draws from"
}

The outfit to judge:`;

  const parts = [{ text: prompt }, { inlineData: { mimeType: selfieMimeType, data: selfieBase64 } }];
  for (const { label, images } of styleReferences) {
    parts.push({ text: `${label} references from ${city}:` });
    for (const img of images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
  });

  return extractJson(response.text);
}

// City match is interactive (someone is waiting in front of the camera), so
// its calls cap how long Gemini "thinks" before answering. The shortlist is a
// rough first cut and needs very little; scoring gets more room.
const SHORTLIST_CONFIG = { thinkingConfig: { thinkingBudget: 128 } };
const CITY_MATCH_CONFIG = { thinkingConfig: { thinkingBudget: 512 } };

/**
 * City match, step 1: a quick text-only pass that reads the outfit and picks
 * the `count` cities (from their style descriptions) it most resembles, so
 * the slower photo comparison only has to look at a shortlist.
 *
 * cities: [{ id, label, style }]  ->  ["tyo", "seo", "ldn"]
 */
export async function shortlistCities(selfieBase64, selfieMimeType, cities, count = 3) {
  const catalog = cities.map(({ id, label, style }) => ({ id, city: label, style }));
  const prompt = `You are a fashion expert who knows how people dress in cities
around the world. Here are the cities to choose from, each with a short
description of its style, as JSON:
${JSON.stringify(catalog, null, 2)}

Look at the outfit in the photo and pick the ${count} cities whose style it most
closely resembles, best match first. Judge the clothes and styling only, not
the person or the background. Return ONLY a JSON object (no prose, no markdown
fences):
{ "cityIds": ["id1", "id2", "id3"] }`;

  const response = await ai.models.generateContent({
    model,
    config: SHORTLIST_CONFIG,
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: selfieMimeType, data: selfieBase64 } }] }],
  });

  const { cityIds } = extractJson(response.text);
  return cityIds;
}

/**
 * City match, step 2: compare the outfit against real reference photos from
 * each shortlisted city (grouped by city, then by style) and score them.
 *
 * cityReferences: [{ city: "Tokyo", styles: [{ label: "Streetwear", images: [{ base64, mimeType }] }] }]
 */
export async function rateCityMatches(selfieBase64, selfieMimeType, cityReferences) {
  const names = cityReferences.map((c) => c.city);
  const styleLabels = [...new Set(cityReferences.flatMap((c) => c.styles.map((s) => s.label)))];
  const prompt = `You are matching a person's outfit to the city whose fashion it
fits best. The FIRST image is their outfit, captured just now. After it come
real reference photos from ${names.length} cities (${names.join(", ")}),
grouped by city and then by style (${styleLabels.join(", ")}); each group is
introduced by its city and style.

Score how well the outfit matches each city. An outfit that nails any one of a
city's styles should score well there. Judge the clothes and styling only.
Return ONLY a JSON object (no prose, no markdown fences):
{
  "matches": [
    {
      "city": "exactly one of: ${names.join(" | ")}",
      "matchPercent": 1-100,
      "closestStyle": "the style in that city it's closest to, exactly one of: ${styleLabels.join(" | ")}",
      "reasoning": "1-2 sentences on what in the outfit matches this city"
    }
  ],
  "verdict": "a short punchy one-liner about the best match, e.g. 'Straight off a Shibuya crossing'"
}
Include every city exactly once, best match first.

The outfit:`;

  const parts = [{ text: prompt }, { inlineData: { mimeType: selfieMimeType, data: selfieBase64 } }];
  for (const { city, styles } of cityReferences) {
    for (const { label, images } of styles) {
      parts.push({ text: `${city} — ${label}:` });
      for (const img of images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }

  const response = await ai.models.generateContent({
    model,
    config: CITY_MATCH_CONFIG,
    contents: [{ role: "user", parts }],
  });

  return extractJson(response.text);
}

/**
 * Outfit-rating bot: score a full-outfit photo (e.g. a selfie or a still
 * pulled from a live Vonage video session) and give feedback.
 */
export async function rateOutfit(imageBase64, mimeType, context = "") {
  const prompt = `You are a witty but encouraging AI outfit-rating bot.
${context ? `Context from the user: "${context}"` : ""}
Look at this outfit photo and return ONLY a JSON object (no prose, no markdown
fences):
{
  "score": 1-10,
  "vibe": "one or two words describing the aesthetic",
  "highlights": ["what's working"],
  "suggestions": ["1-2 concrete improvements"],
  "oneLiner": "a short, shareable one-line verdict"
}`;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }],
      },
    ],
  });

  return extractJson(response.text);
}
