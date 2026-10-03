import { Router } from "express";
import { searchCityStyles } from "../services/imageSearch.js";

const router = Router();

router.get("/", async (req, res) => {
  const { city, year } = req.query;
  if (!city || !year) return res.status(400).json({ error: "city and year query params are required" });

  try {
    const sections = await searchCityStyles(city, year);
    res.json({ sections });
  } catch (err) {
    console.error("[fashion-week] search failed:", err);
    res.status(500).json({ error: "Failed to search fashion week images", detail: String(err.message || err) });
  }
});

export default router;
