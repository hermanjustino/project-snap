import { Router, text } from "express";
import crypto from "node:crypto";
import { readStats, recordEvent } from "../services/analytics.js";

const router = Router();

// Events arrive from navigator.sendBeacon as a small text/plain JSON body.
// The response is always 204: a tracking failure is logged, never surfaced.
router.post("/t", text({ type: "*/*", limit: "2kb" }), async (req, res) => {
  try {
    const { e: event, p: props, r: referrer } = JSON.parse(req.body || "{}");
    await recordEvent({
      event,
      props: props && typeof props === "object" ? props : {},
      // Cloud Run puts the visitor's address first in X-Forwarded-For. It's
      // only used, hashed, to tell visitors apart; spoofing it can at worst
      // inflate the visitor count.
      ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
      userAgent: req.get("user-agent"),
      referrer: typeof referrer === "string" ? referrer : "",
    });
  } catch (err) {
    console.error("[analytics] failed to record event:", err.message);
  }
  res.status(204).end();
});

// The /stats dashboard's data. Requires STATS_KEY as a bearer token.
function authorized(req) {
  const key = process.env.STATS_KEY;
  const given = (req.get("authorization") || "").replace(/^Bearer /, "");
  if (!key || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

router.get("/stats", async (req, res) => {
  if (!process.env.STATS_KEY) return res.status(503).json({ error: "Stats aren't set up: STATS_KEY is not configured." });
  if (!authorized(req)) return res.status(401).json({ error: "Wrong or missing key." });

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  try {
    res.json({ days: await readStats(days) });
  } catch (err) {
    console.error("[analytics] failed to read stats:", err);
    res.status(500).json({ error: "Couldn't load stats." });
  }
});

export default router;
