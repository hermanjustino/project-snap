import { Router } from "express";
import { STYLES, searchFashionWeekImages } from "../services/imageSearch.js";

const router = Router();

router.get("/", async (req, res) => {
  const { city, year, style = "runway" } = req.query;
  if (!city || !year) return res.status(400).json({ error: "city and year query params are required" });
  if (!STYLES.includes(style)) return res.status(400).json({ error: `style must be one of: ${STYLES.join(", ")}` });

  try {
    const result = await searchFashionWeekImages(city, year, 8, style);
    res.json(result);
  } catch (err) {
    console.error("[fashion-week] search failed:", err);
    res.status(500).json({ error: "Failed to search fashion week images", detail: String(err.message || err) });
  }
});

export default router;
