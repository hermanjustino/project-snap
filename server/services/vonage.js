// Vonage Video API is Project Snap's "communication layer": it turns the
// AI styling experience into something shareable and live — a stylist call,
// a live shopping stream, or a friend group video-rating a fit before you buy.
import { Vonage } from "@vonage/server-sdk";
import "dotenv/config";

const applicationId = process.env.VONAGE_APPLICATION_ID;
const privateKeyPath = process.env.VONAGE_PRIVATE_KEY_PATH || "./private.key";

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
