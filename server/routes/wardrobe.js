import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeGarment } from "../services/gemini.js";
import { addItem, getWardrobe, removeItem } from "../services/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 8 * 1024 * 1024 } });
const router = Router();

// List the whole wardrobe.
router.get("/", async (_req, res) => {
  const items = await getWardrobe();
  res.json(items);
});

// Upload a garment photo -> Gemini tags it -> stored as a wardrobe item.
router.post("/", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "photo field is required" });

  try {
    const buffer = await readFile(req.file.path);
    const base64 = buffer.toString("base64");
    const metadata = await analyzeGarment(base64, req.file.mimetype);

    const item = {
      id: nanoid(10),
      imageUrl: `/uploads/${req.file.filename}`,
      addedAt: new Date().toISOString(),
      ...metadata,
    };

    await addItem(item);
    res.status(201).json(item);
  } catch (err) {
    console.error("[wardrobe] analyze failed:", err);
    res.status(500).json({ error: "Failed to analyze garment", detail: String(err.message || err) });
  }
});

router.delete("/:id", async (req, res) => {
  const items = await removeItem(req.params.id);
  res.json(items);
});

export default router;
