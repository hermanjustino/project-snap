import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import wardrobeRoutes from "./routes/wardrobe.js";
import outfitRoutes from "./routes/outfit.js";
import videoRoutes from "./routes/video.js";
import fashionWeekRoutes from "./routes/fashionWeek.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/wardrobe", wardrobeRoutes);
app.use("/api/outfit", outfitRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/fashion-week", fashionWeekRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✨ fitd running at http://localhost:${PORT}`);
});
