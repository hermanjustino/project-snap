import { Router } from "express";
import multer from "multer";
import { readFile } from "node:fs/promises";
import { rateOutfit, suggestOutfit } from "../services/gemini.js";
import { getWardrobe } from "../services/store.js";

const upload = multer({ dest: "uploads/", limits: { fileSize: 8 * 1024 * 1024 } });
const router = Router();

// AI personal stylist: "I need an outfit for a rainy first date" -> picks
// real items from the wardrobe and explains the choice.
router.post("/suggest", async (req, res) => {
  const { request } = req.body;
  if (!request) return res.status(400).json({ error: "request field is required" });

  try {
    const wardrobe = await getWardrobe();
    if (wardrobe.length === 0) {
      return res.status(400).json({ error: "Wardrobe is empty — add some items first." });
    }

    const suggestion = await suggestOutfit(wardrobe, request);
    const items = wardrobe.filter((i) => suggestion.itemIds?.includes(i.id));
    res.json({ ...suggestion, items });
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
    const buffer = await readFile(req.file.path);
    const base64 = buffer.toString("base64");
    const rating = await rateOutfit(base64, req.file.mimetype, req.body.context);
    res.json(rating);
  } catch (err) {
    console.error("[outfit] rate failed:", err);
    res.status(500).json({ error: "Failed to rate outfit", detail: String(err.message || err) });
  }
});

export default router;
