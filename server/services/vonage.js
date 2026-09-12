// Vonage Video API is fitd's "communication layer": it turns the
// AI styling experience into something shareable and live — a stylist call,
// a live shopping stream, or a friend group video-rating a fit before you buy.
import { Vonage } from "@vonage/server-sdk";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import "dotenv/config";

const applicationId = process.env.VONAGE_APPLICATION_ID;

// Local dev reads the key straight off disk. Deployed environments (Cloud
// Run, etc.) can't ship a gitignored private.key file in the image, so they
// instead pass the key base64-encoded as VONAGE_PRIVATE_KEY_B64 and we
// materialize it to a temp file at startup.
let privateKeyPath = process.env.VONAGE_PRIVATE_KEY_PATH || "./private.key";
if (process.env.VONAGE_PRIVATE_KEY_B64) {
  privateKeyPath = path.join(tmpdir(), "vonage-private.key");
  writeFileSync(privateKeyPath, Buffer.from(process.env.VONAGE_PRIVATE_KEY_B64, "base64"));
}

let vonage = null;
function getClient() {
  if (!applicationId) {
    throw new Error(
      "VONAGE_APPLICATION_ID is not set. Create a Video API application at " +
        "https://developer.vonage.com/en/vonage-video/overview, download " +
        "private.key into the project root, and fill in .env."
    );
  }
  if (!vonage) {
    vonage = new Vonage({ applicationId, privateKey: privateKeyPath });
  }
  return vonage;
}

/**
 * Creates a new video session ("room") and returns everything the frontend
 * needs to join it: the applicationId, sessionId, and a fresh token.
 */
export async function createStyleSession() {
  const client = getClient();
  const session = await client.video.createSession({ mediaMode: "routed" });
  const token = client.video.generateClientToken(session.sessionId, {
    role: "publisher",
  });

  return {
    applicationId,
    sessionId: session.sessionId,
    token,
  };
}

/**
 * Mint a fresh token for an existing session (e.g. a second guest joining a
 * live shopping stream / stylist call).
 */
export function issueToken(sessionId, role = "publisher") {
  const client = getClient();
  return client.video.generateClientToken(sessionId, { role });
}
