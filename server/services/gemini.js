// Gemini is Project Snap's "AI brain": it looks at wardrobe photos and turns
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
 * Live "Style Check": compare a captured frame (e.g. from a Vonage video
 * session) against a handful of real Fashion Week reference photos for a
 * given city/year, and score how well it fits in.
 */
export async function rateFitAgainstTrends(selfieBase64, selfieMimeType, referenceImages, city, year) {
  const prompt = `You are judging how well an outfit fits in with a city's
current fashion scene. The FIRST image is a person's live outfit, captured
just now. The remaining ${referenceImages.length} image(s) are real runway/
street looks from ${city} Fashion Week ${year} — the trends it's being
compared against.

Rate how well the first outfit would fit in among the reference looks.
Return ONLY a JSON object (no prose, no markdown fences):
{
  "fitScore": 1-100,
  "verdict": "a short punchy one-line verdict, e.g. 'Runway ready' or 'Not quite ${city} yet'",
  "reasoning": "2-3 sentences comparing the outfit to what's shown in the reference looks",
  "tip": "one concrete suggestion to fit in better"
}`;

  const parts = [
    { text: prompt },
    { inlineData: { mimeType: selfieMimeType, data: selfieBase64 } },
    ...referenceImages.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
  ];

  const response = await ai.models.generateContent({
    model,
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
