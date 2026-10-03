import { Router } from "express";
import multer from "multer";
import { readFileSync } from "node:fs";
import {
  rateCityMatches,
  rateFitAgainstTrends,
  rateOutfit,
  shortlistCities,
  suggestOutfit,
} from "../services/gemini.js";
import { fetchImageAsBase64, searchCityStyles } from "../services/imageSearch.js";

// Same city list the globe draws its pins from.
const CITIES = JSON.parse(readFileSync(new URL("../../public/data/cities.json", import.meta.url), "utf8"));
const CITY_MATCH_YEAR = 2025;
const SHORTLIST_SIZE = 3;
const REFERENCES_PER_CITY_STYLE = 1;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const router = Router();

// AI personal stylist: "I need an outfit for a rainy first date" -> picks
// real items from the wardrobe and explains the choice. The wardrobe catalog
// itself lives in the caller's browser (localStorage), so the client sends
// it with each request instead of the server holding shared state.
router.post("/suggest", async (req, res) => {
  const { request, wardrobe } = req.body;
  if (!request) return res.status(400).json({ error: "request field is required" });
  if (!Array.isArray(wardrobe) || wardrobe.length === 0) {
    return res.status(400).json({ error: "Wardrobe is empty — add some items first." });
  }

  try {
    const suggestion = await suggestOutfit(wardrobe, request);
    res.json(suggestion);
  } catch (err) {
    console.error("[outfit] suggest failed:", err);
    res.status(500).json({ error: "Failed to build outfit suggestion", detail: String(err.message || err) });
  }
});

// Outfit-rating bot: upload a fit pic (or a frame grabbed from a live Vonage
// video session) and get a score + feedback.
router.post("/rate", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "photo field is required" });

  try {
    const base64 = req.file.buffer.toString("base64");
    const rating = await rateOutfit(base64, req.file.mimetype, req.body.context);
    res.json(rating);
  } catch (err) {
    console.error("[outfit] rate failed:", err);
    res.status(500).json({ error: "Failed to rate outfit", detail: String(err.message || err) });
  }
});

// Live "Fit Check": a frame captured from the camera, scored against real
// photos of every style in the city (runway, streetwear, everyday, heritage)
// for the year the visitor is browsing.
const REFERENCES_PER_STYLE = 2;

router.post("/fit-check", upload.single("photo"), async (req, res) => {
  const { city, year } = req.body;
  if (!req.file) return res.status(400).json({ error: "photo field is required" });
  if (!city || !year) return res.status(400).json({ error: "city and year fields are required" });

  try {
    const sections = await searchCityStyles(city, year);

    // Fetch each style's references in parallel; skip any that won't download.
    const styleReferences = await Promise.all(
      sections.map(async ({ label, images }) => {
        const fetched = await Promise.allSettled(
          images.slice(0, REFERENCES_PER_STYLE).map((img) => fetchImageAsBase64(img.thumbnailUrl))
        );
        return { label, images: fetched.filter((r) => r.status === "fulfilled").map((r) => r.value) };
      })
    );
    const usable = styleReferences.filter((s) => s.images.length > 0);
    if (usable.length === 0) {
      return res.status(502).json({ error: "Couldn't load reference photos to compare against — try again." });
    }

    const selfieBase64 = req.file.buffer.toString("base64");
    const result = await rateFitAgainstTrends(selfieBase64, req.file.mimetype, usable, city, year);
    res.json({ ...result, comparedAgainst: usable.reduce((n, s) => n + s.images.length, 0) });
  } catch (err) {
    console.error("[outfit] fit-check failed:", err);
    res.status(500).json({ error: "Failed to run fit check", detail: String(err.message || err) });
  }
});

// "Which city matches your fit?": a quick text-only pass shortlists the
// closest cities, then the outfit is scored against real photos of every
// style in each of them.
router.post("/city-match", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "photo field is required" });
  const selfieBase64 = req.file.buffer.toString("base64");

  try {
    const shortlistIds = await shortlistCities(selfieBase64, req.file.mimetype, CITIES, SHORTLIST_SIZE);
    const shortlist = [...new Set(shortlistIds)]
      .map((id) => CITIES.find((c) => c.id === id))
      .filter(Boolean)
      .slice(0, SHORTLIST_SIZE);
    if (shortlist.length === 0) {
      return res.status(502).json({ error: "Couldn't pick candidate cities — try again." });
    }

    const cityReferences = await Promise.all(
      shortlist.map(async (city) => {
        const sections = await searchCityStyles(city.label, CITY_MATCH_YEAR);
        const styles = await Promise.all(
          sections.map(async ({ label, images }) => {
            const fetched = await Promise.allSettled(
              images.slice(0, REFERENCES_PER_CITY_STYLE).map((img) => fetchImageAsBase64(img.thumbnailUrl))
            );
            return { label, images: fetched.filter((r) => r.status === "fulfilled").map((r) => r.value) };
          })
        );
        return { city: city.label, styles: styles.filter((s) => s.images.length > 0) };
      })
    );
    const usable = cityReferences.filter((c) => c.styles.length > 0);
    if (usable.length === 0) {
      return res.status(502).json({ error: "Couldn't load reference photos to compare against — try again." });
    }

    const result = await rateCityMatches(selfieBase64, req.file.mimetype, usable);

    // Attach each city's id and coordinates (so the globe can fly there) and
    // make sure the best match comes first.
    const matches = (result.matches || [])
      .map((m) => {
        const city = shortlist.find((c) => c.label === m.city);
        return city && { ...m, id: city.id, lat: city.lat, lng: city.lng };
      })
      .filter(Boolean)
      .sort((a, b) => b.matchPercent - a.matchPercent);
    if (matches.length === 0) {
      return res.status(502).json({ error: "Couldn't score the cities — try again." });
    }

    res.json({ matches, verdict: result.verdict, tip: result.tip });
  } catch (err) {
    console.error("[outfit] city-match failed:", err);
    res.status(500).json({ error: "Failed to match your fit to a city", detail: String(err.message || err) });
  }
});

export default router;
