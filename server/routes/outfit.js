import { Router } from "express";
import multer from "multer";
import { rateFitAgainstTrends, rateOutfit, suggestOutfit } from "../services/gemini.js";
import { fetchImageAsBase64, searchFashionWeekImages } from "../services/imageSearch.js";

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

// Live "Style Check": a frame captured from a Vonage video session, scored
// against real Fashion Week photos for the city/year the visitor is browsing.
router.post("/fit-check", upload.single("photo"), async (req, res) => {
  const { city, year } = req.body;
  if (!req.file) return res.status(400).json({ error: "photo field is required" });
  if (!city || !year) return res.status(400).json({ error: "city and year fields are required" });

  try {
    const { images } = await searchFashionWeekImages(city, year, 4);

    const referenceImages = [];
    for (const img of images.slice(0, 3)) {
      try {
        referenceImages.push(await fetchImageAsBase64(img.thumbnailUrl));
      } catch (err) {
        console.warn("[outfit] skipping unfetchable reference image:", err.message);
      }
    }
    if (referenceImages.length === 0) {
      return res.status(502).json({ error: "Couldn't load reference runway photos to compare against — try again." });
    }

    const selfieBase64 = req.file.buffer.toString("base64");
    const result = await rateFitAgainstTrends(selfieBase64, req.file.mimetype, referenceImages, city, year);
    res.json({ ...result, comparedAgainst: referenceImages.length });
  } catch (err) {
    console.error("[outfit] fit-check failed:", err);
    res.status(500).json({ error: "Failed to run fit check", detail: String(err.message || err) });
  }
});

export default router;
