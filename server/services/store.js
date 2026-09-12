// Dead-simple JSON-file "database" for a one-day hackathon.
// Good enough to survive a demo; swap for Firestore/Postgres post-hackathon.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "wardrobe.json");

async function ensureFile() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(DATA_FILE, "utf-8");
  } catch {
    await writeFile(DATA_FILE, "[]", "utf-8");
  }
}

export async function getWardrobe() {
  await ensureFile();
  const raw = await readFile(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

export async function saveWardrobe(items) {
  await ensureFile();
  await writeFile(DATA_FILE, JSON.stringify(items, null, 2), "utf-8");
}

export async function addItem(item) {
  const items = await getWardrobe();
  items.push(item);
  await saveWardrobe(items);
  return item;
}

export async function removeItem(id) {
  const items = await getWardrobe();
  const next = items.filter((i) => i.id !== id);
  await saveWardrobe(next);
  return next;
}
