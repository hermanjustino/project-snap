// The share sheet: pick a Story format (three still cards or The Reveal
// video), preview it full size, and share it with a challenge link.
import { track } from "./track.js";
import { STORY_STYLES, buildStoryCard, canRecordVideo, recordReveal } from "./share.js";
import { SITE_URL, challengeUrl, cleanName, saveName, savedName } from "./challenge.js";

const FORMAT_KEY = "fitd.shareFormat";

const sheet = document.getElementById("shareSheet");
const previewEl = document.getElementById("sharePreview");
const formatsEl = document.getElementById("shareFormats");
const nameInput = document.getElementById("shareName");
const shareBtn = document.getElementById("shareGo");
const copyBtn = document.getElementById("shareCopy");
const statusEl = document.getElementById("shareStatus");

const FORMATS = [...STORY_STYLES, ...(canRecordVideo() ? [{ id: "video", label: "Video" }] : [])];

let fit = null;
let format = "photo";
let renders = new Map(); // format -> Promise<{ blob, ext, url }>
let renderToken = 0; // ignore previews that finish after the sheet moved on

try {
  const saved = localStorage.getItem(FORMAT_KEY);
  if (FORMATS.some((f) => f.id === saved)) format = saved;
} catch {
  /* default format */
}

formatsEl.innerHTML = FORMATS.map(
  (f) => `<button role="tab" data-format="${f.id}" aria-selected="false">${f.label}</button>`
).join("");
const formatButtons = [...formatsEl.querySelectorAll("button")];

const isChallenge = () => fit?.mode === "city-match";

function shareLink() {
  return isChallenge() ? challengeUrl(fit, cleanName(nameInput.value)) : SITE_URL;
}

function shareText() {
  return isChallenge()
    ? `My fit is ${fit.pct}% ${fit.city}. What city is yours? ${shareLink()}`
    : `My fit scored ${fit.pct}/100 for ${fit.city}. Check yours at ${shareLink()}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

// Renders (or reuses) one format and shows it in the preview.
async function showFormat(next, audio = null) {
  format = next;
  try {
    localStorage.setItem(FORMAT_KEY, format);
  } catch {
    /* not remembered */
  }
  formatButtons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.format === format)));
  const token = ++renderToken;
  shareBtn.disabled = true;

  if (!renders.has(format)) {
    if (format === "video") {
      // Shown live while it records, then swapped for the finished clip.
      const canvas = document.createElement("canvas");
      previewEl.replaceChildren(canvas);
      setStatus("Recording your reveal…");
      const done = recordReveal(fit, canvas, {
        audio,
        onProgress: (p) => token === renderToken && setStatus(`Recording your reveal… ${Math.round(p * 100)}%`),
      })
        .then(({ blob, ext }) => ({ blob, ext, url: URL.createObjectURL(blob) }))
        .finally(() => audio?.close());
      renders.set(format, done);
    } else {
      setStatus("");
      renders.set(
        format,
        buildStoryCard(fit, format).then((blob) => ({ blob, ext: "jpg", url: URL.createObjectURL(blob) }))
      );
    }
  } else {
    audio?.close();
  }

  try {
    const { url } = await renders.get(format);
    if (token !== renderToken) return;
    if (format === "video") {
      const video = Object.assign(document.createElement("video"), { src: url, loop: true, muted: true, autoplay: true, playsInline: true });
      video.setAttribute("playsinline", "");
      previewEl.replaceChildren(video);
      video.play().catch(() => {});
      setStatus("Plays with sound once posted.");
    } else {
      const img = Object.assign(document.createElement("img"), { src: url, alt: "Your Story card" });
      previewEl.replaceChildren(img);
      setStatus("");
    }
    shareBtn.disabled = false;
  } catch (err) {
    if (token !== renderToken) return;
    renders.delete(format);
    previewEl.replaceChildren();
    setStatus(`Couldn't make this one: ${err.message}`);
  }
}

function newAudioContext() {
  try {
    return new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return null;
  }
}

function step(direction) {
  const i = FORMATS.findIndex((f) => f.id === format);
  const next = FORMATS[(i + direction + FORMATS.length) % FORMATS.length].id;
  showFormat(next, next === "video" ? newAudioContext() : null);
}

formatButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.format;
    if (next !== format || !renders.has(next)) showFormat(next, next === "video" ? newAudioContext() : null);
  });
});

// Swipe the preview left/right to flip through the formats.
let swipeFrom = null;
previewEl.addEventListener("pointerdown", (e) => (swipeFrom = e.clientX));
previewEl.addEventListener("pointerup", (e) => {
  if (swipeFrom === null) return;
  const dx = e.clientX - swipeFrom;
  swipeFrom = null;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
});

nameInput.addEventListener("change", () => {
  nameInput.value = cleanName(nameInput.value);
  saveName(nameInput.value);
});

shareBtn.addEventListener("click", async () => {
  const render = renders.get(format);
  if (!render) return;
  const { blob, ext } = await render;
  track("share_tapped", { mode: fit.mode, format });
  const file = new File([blob], `fitd-${fit.city.toLowerCase().replace(/\W+/g, "-")}.${ext}`, { type: blob.type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My fitd Fit Check", text: shareText() });
    } catch (err) {
      if (err.name !== "AbortError") setStatus(`Couldn't share: ${err.message}`);
    }
    return;
  }

  // Desktop: save the file, and put the link on the clipboard to paste.
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  const copied = await navigator.clipboard?.writeText(shareLink()).then(() => true, () => false);
  setStatus(copied ? "Saved. Your link is copied too." : "Saved.");
});

copyBtn.addEventListener("click", async () => {
  track("share_tapped", { mode: fit.mode, format: "link" });
  try {
    await navigator.clipboard.writeText(shareText());
    setStatus("Link copied.");
  } catch {
    setStatus(shareLink());
  }
});

function closeSheet() {
  renderToken++;
  sheet.hidden = true;
  previewEl.replaceChildren();
  for (const render of renders.values()) render.then(({ url }) => URL.revokeObjectURL(url), () => {});
  renders = new Map();
}

sheet.querySelector("[data-action=close]").addEventListener("click", closeSheet);

/** Opens the sheet for a result (see share.js for the shape of `result`). */
export function openShareSheet(result) {
  closeSheet();
  fit = result;
  nameInput.value = savedName();
  sheet.querySelector(".share-name").hidden = !isChallenge();
  copyBtn.textContent = isChallenge() ? "Copy challenge link" : "Copy link";
  sheet.hidden = false;
  // Video records in real time, so it only starts when picked.
  showFormat(format === "video" ? "photo" : format);
}
