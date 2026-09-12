import { Router } from "express";
import multer from "multer";
import { analyzeGarment } from "../services/gemini.js";

// Memory storage: the server never persists wardrobe photos. Each visitor's
// wardrobe lives in their own browser (localStorage) so concurrent hackathon
// attendees don't share or clobber each other's closets. The server's only
// job here is a stateless "analyze this photo" call to Gemini.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const router = Router();

router.post("/analyze", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "photo field is required" });

  try {
    const base64 = req.file.buffer.toString("base64");
    const metadata = await analyzeGarment(base64, req.file.mimetype);
    res.json(metadata);
  } catch (err) {
    console.error("[wardrobe] analyze failed:", err);
    res.status(500).json({ error: "Failed to analyze garment", detail: String(err.message || err) });
  }
});

export default router;
