import { Router } from "express";
import { createStyleSession, issueToken } from "../services/vonage.js";

const router = Router();

// Start a new live styling session (video room). Used for: a live "AI +
// friend" stylist call, a live shopping stream, or a Fashion Week lookbook
// watch-party.
router.post("/session", async (_req, res) => {
  try {
    const session = await createStyleSession();
    res.json(session);
  } catch (err) {
    console.error("[video] session create failed:", err);
    res.status(500).json({ error: "Failed to create video session", detail: String(err.message || err) });
  }
});

// Mint an additional join token for an existing session (e.g. a second
// guest joining a live shopping stream).
router.post("/session/:sessionId/token", (req, res) => {
  try {
    const token = issueToken(req.params.sessionId, req.body.role || "publisher");
    res.json({ token });
  } catch (err) {
    console.error("[video] token issue failed:", err);
    res.status(500).json({ error: "Failed to issue token", detail: String(err.message || err) });
  }
});

export default router;
