// Share formats for a fit result, all 1080x1920 (9:16) so they fill an
// Instagram/TikTok Story without cropping:
//   - three still cards (photo, passport stamp, minimal type)
//   - "The Reveal": a ~7s video recorded in the browser (countdown, a scan
//     that tags each piece, the globe spinning to the city, then the match
//     counting up), with its own sound.
// The top and bottom of the frame are left clear for the Story's own buttons
// and stickers.
//
// `fit` is { photoDataUrl, pct, accent, city, lat, lng, style, verdict,
// items[], challenge: { name, pct, city } | null, stamp: { count } | null }.
import { SKELETON, loadLand, paintSurface } from "./land.js";
import { formatScore } from "./score.js";

const W = 1080;
const H = 1920;
const SAFE_TOP = 250; // Story header (profile, progress bars)
const SAFE_BOTTOM = H - 300; // Story reply bar

const INK = "#2b241a";
const CREAM = "#f4ecda";
const MUTED = "#8a7a62";
const BODY = "#5a4e3e";
const ACCENT = "#a8452b";
const STAMP = "#e0a48f";

const SERIF = '"Bodoni Moda", Georgia, serif';
const SANS = '"Archivo", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const TAGLINE = "thefitd.com · what's yours?";

export const STORY_STYLES = [
  { id: "photo", label: "Photo" },
  { id: "stamp", label: "Stamp" },
  { id: "minimal", label: "Minimal" },
];

// --- Shared drawing helpers -------------------------------------------------

let fontsReady = null;
function loadFonts() {
  fontsReady ??= Promise.all(
    [`700 80px ${SERIF}`, `italic 500 40px ${SERIF}`, `800 80px ${SANS}`, `400 40px ${SANS}`, `600 30px ${MONO}`].map((f) =>
      document.fonts.load(f).catch(() => {})
    )
  );
  return fontsReady;
}

const photoCache = new Map();
function loadPhoto(src) {
  if (!photoCache.has(src)) {
    photoCache.clear(); // only the current result's photo is needed
    photoCache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      })
    );
  }
  return photoCache.get(src);
}

function newCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  return canvas;
}

// Draws the image scaled to cover the box, centered (like object-fit: cover).
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function setFont(ctx, font, spacing = 0) {
  ctx.font = font;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
}

// Largest font size (up to `max`) at which the text fits in `width`.
function fitFontSize(ctx, text, fontAt, max, width) {
  let size = max;
  ctx.font = fontAt(size);
  while (size > 24 && ctx.measureText(text).width > width) {
    size -= 4;
    ctx.font = fontAt(size);
  }
  return size;
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of String(text || "").split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wordmark(ctx, color, y = SAFE_TOP - 70) {
  setFont(ctx, `700 76px ${SERIF}`);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("fitd", W / 2, y);
}

function pill(ctx, text, { y, color, background }) {
  setFont(ctx, `600 30px ${MONO}`);
  const width = ctx.measureText(text).width + 64;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect((W - width) / 2, y - 34, width, 68, 34);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, y + 1);
}

function styleLine(fit) {
  return fit.style ? `Closest to ${fit.city} ${String(fit.style).toLowerCase()}` : "";
}

function challengeLine(fit) {
  const c = fit.challenge;
  return c ? `vs ${c.name || "a friend"}: ${formatScore(c.pct)}/10 ${c.city}` : "";
}

// A score as a big "8.5" with a smaller "/10" after it, on one baseline.
// Returns the drawn width; with `measureOnly` it only measures.
function drawScore(ctx, text, x, y, size, color, { measureOnly = false } = {}) {
  setFont(ctx, `800 ${size}px ${SANS}`, -2);
  const mainW = ctx.measureText(text).width;
  setFont(ctx, `700 ${size * 0.4}px ${SANS}`);
  const outOfW = ctx.measureText("/10").width + size * 0.05;
  if (!measureOnly) {
    const align = ctx.textAlign;
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    setFont(ctx, `800 ${size}px ${SANS}`, -2);
    ctx.fillText(text, x, y);
    setFont(ctx, `700 ${size * 0.4}px ${SANS}`);
    ctx.globalAlpha *= 0.7;
    ctx.fillText("/10", x + mainW + size * 0.05, y);
    ctx.globalAlpha /= 0.7;
    ctx.textAlign = align;
  }
  return mainW + outOfW;
}

// Same, centered on `cx`.
function drawScoreCentered(ctx, text, cx, y, size, color) {
  const w = drawScore(ctx, text, 0, 0, size, color, { measureOnly: true });
  drawScore(ctx, text, cx - w / 2, y, size, color);
}

// "8.5/10 Toronto" on one baseline, shrunk together to fit `width`.
function drawPctCity(ctx, fit, { x, y, width, pctSize, citySize, align = "left", cityColor = INK }) {
  const score = formatScore(fit.pct);
  let scale = 1;
  const measure = () => {
    const pctW = drawScore(ctx, score, 0, 0, pctSize * scale, fit.accent, { measureOnly: true });
    setFont(ctx, `700 ${citySize * scale}px ${SERIF}`);
    const cityW = ctx.measureText(fit.city).width;
    return { pctW, cityW, gap: 26 * scale };
  };
  let m = measure();
  while (m.pctW + m.gap + m.cityW > width && scale > 0.4) {
    scale -= 0.05;
    m = measure();
  }
  const total = m.pctW + m.gap + m.cityW;
  const startX = align === "center" ? x - total / 2 : x;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  drawScore(ctx, score, startX, y, pctSize * scale, fit.accent);
  setFont(ctx, `700 ${citySize * scale}px ${SERIF}`);
  ctx.fillStyle = cityColor;
  ctx.fillText(fit.city, startX + m.pctW + m.gap, y);
}

// --- Still cards ------------------------------------------------------------

function drawPhotoCard(ctx, fit, photo) {
  drawCover(ctx, photo, 0, 0, W, H);

  // Soft shade at the top and bottom so the light text reads on any photo.
  let shade = ctx.createLinearGradient(0, 0, 0, 420);
  shade.addColorStop(0, "rgba(0,0,0,0.4)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, 420);
  shade = ctx.createLinearGradient(0, H - 900, 0, H);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, H - 900, W, 900);

  wordmark(ctx, CREAM);

  // The result card, sitting just above the Story's reply bar.
  const x = 60;
  const w = W - 120;
  const pad = 48;
  setFont(ctx, `400 36px ${SANS}`);
  const detail = styleLine(fit);
  const items = fit.items?.length ? fit.items.join(" · ") : "";
  const h = pad + 24 + 138 + (detail ? 62 : 0) + (items ? 50 : 0) + pad;
  const bottom = SAFE_BOTTOM - 70;
  const top = bottom - h;

  const vs = challengeLine(fit);
  if (vs) {
    setFont(ctx, `600 30px ${MONO}`);
    const vw = ctx.measureText(vs).width + 48;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(x, top - 82, vw, 60, 30);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(vs, x + 24, top - 51);
  }

  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, 40);
  ctx.fill();

  let y = top + pad + 24;
  setFont(ctx, `600 28px ${MONO}`, 5);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("MY CITY MATCH", x + pad, y);
  y += 30 + 108;
  drawPctCity(ctx, fit, { x: x + pad, y, width: w - pad * 2, pctSize: 116, citySize: 100 });
  if (detail) {
    y += 62;
    setFont(ctx, `400 36px ${SANS}`);
    ctx.fillStyle = BODY;
    ctx.fillText(detail, x + pad, y, w - pad * 2);
  }
  if (items) {
    y += 50;
    setFont(ctx, `600 26px ${MONO}`);
    ctx.fillStyle = MUTED;
    ctx.fillText(items.toUpperCase(), x + pad, y, w - pad * 2);
  }

  pill(ctx, TAGLINE, { y: SAFE_BOTTOM + 40, color: CREAM, background: "rgba(0,0,0,0.38)" });
}

function drawStamp(ctx, fit, { cx, cy, r, rotation }) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.fillStyle = "rgba(43, 36, 26, 0.86)";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = STAMP;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, 0, r - 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r - 34, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = STAMP;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const city = fit.city.toUpperCase();
  const size = fitFontSize(ctx, city, (s) => `800 ${s}px ${SANS}`, 64, r * 1.45);
  setFont(ctx, `800 ${size}px ${SANS}`, 2);
  ctx.fillText(city, 0, 20);
  setFont(ctx, `600 30px ${MONO}`, 3);
  ctx.fillText(`${formatScore(fit.pct)}/10 MATCH`, 0, -58);
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
  setFont(ctx, `600 24px ${MONO}`, 2);
  ctx.fillText(date, 0, 72);
  if (fit.stamp?.count > 1) ctx.fillText(`STAMP ×${fit.stamp.count}`, 0, 108);
  ctx.restore();
}

function drawStampCard(ctx, fit, photo) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  wordmark(ctx, CREAM);

  setFont(ctx, `700 64px ${SERIF}`);
  ctx.fillStyle = CREAM;
  ctx.textAlign = "left";
  ctx.fillText("My fit passport", 100, SAFE_TOP + 70);
  setFont(ctx, `600 28px ${MONO}`, 2);
  ctx.fillStyle = "#c9b894";
  const vs = challengeLine(fit);
  ctx.fillText(vs || (fit.style ? `${fit.city} ${fit.style}`.toUpperCase() : fit.city.toUpperCase()), 100, SAFE_TOP + 122);

  // The photo as a slightly tilted print.
  ctx.save();
  ctx.translate(W / 2 - 40, 930);
  ctx.rotate(-0.035);
  ctx.fillStyle = CREAM;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40;
  ctx.fillRect(-370, -470, 740, 940);
  ctx.shadowColor = "transparent";
  drawCover(ctx, photo, -340, -440, 680, 820);
  ctx.restore();

  drawStamp(ctx, fit, { cx: W - 260, cy: 1290, r: 215, rotation: -0.16 });
  pill(ctx, TAGLINE, { y: SAFE_BOTTOM + 40, color: CREAM, background: "rgba(244,236,218,0.12)" });
}

function drawMinimalCard(ctx, fit) {
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  wordmark(ctx, INK);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, `600 32px ${MONO}`, 8);
  ctx.fillStyle = MUTED;
  ctx.fillText("MY CITY MATCH", W / 2, 640);

  drawScoreCentered(ctx, formatScore(fit.pct), W / 2, 930, 300, fit.accent);

  const citySize = fitFontSize(ctx, fit.city, (s) => `700 ${s}px ${SERIF}`, 170, W - 160);
  setFont(ctx, `700 ${citySize}px ${SERIF}`);
  ctx.fillStyle = INK;
  ctx.fillText(fit.city, W / 2, 1110);

  let y = 1190;
  const detail = styleLine(fit);
  if (detail) {
    setFont(ctx, `400 38px ${SANS}`);
    ctx.fillStyle = BODY;
    ctx.fillText(detail, W / 2, y, W - 160);
    y += 90;
  }
  if (fit.verdict) {
    setFont(ctx, `italic 500 48px ${SERIF}`);
    ctx.fillStyle = INK;
    for (const line of wrapLines(ctx, `“${fit.verdict}”`, W - 200).slice(0, 3)) {
      ctx.fillText(line, W / 2, y);
      y += 62;
    }
  }
  const vs = challengeLine(fit);
  if (vs) {
    setFont(ctx, `600 30px ${MONO}`);
    ctx.fillStyle = ACCENT;
    ctx.fillText(vs, W / 2, Math.max(y + 30, 1500));
  }
  pill(ctx, TAGLINE, { y: SAFE_BOTTOM + 40, color: INK, background: "rgba(43,36,26,0.08)" });
}

/** Renders a still Story card ("photo" | "stamp" | "minimal") to a JPEG blob. */
export async function buildStoryCard(fit, style = "photo") {
  await loadFonts();
  const canvas = newCanvas();
  const ctx = canvas.getContext("2d");
  const photo = style === "minimal" ? null : await loadPhoto(fit.photoDataUrl);
  if (style === "stamp") drawStampCard(ctx, fit, photo);
  else if (style === "minimal") drawMinimalCard(ctx, fit);
  else drawPhotoCard(ctx, fit, photo);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

// --- The Reveal (video) -----------------------------------------------------

const VIDEO_TYPES = [
  ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
  ["video/mp4;codecs=avc1,mp4a", "mp4"],
  ["video/mp4", "mp4"],
  ["video/webm;codecs=vp9,opus", "webm"],
  ["video/webm;codecs=vp8,opus", "webm"],
  ["video/webm", "webm"],
];

function videoFormat() {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) return null;
  const found = VIDEO_TYPES.find(([type]) => MediaRecorder.isTypeSupported(type));
  return found ? { mimeType: found[0], ext: found[1] } : null;
}

export const canRecordVideo = () => videoFormat() !== null;

// Timeline, in seconds.
const T_SCAN = 1.5; // countdown 3-2-1 before this
const T_GLOBE = 3.1;
const T_REVEAL = 4.6;
const T_CITY = 5.4; // the count-up lands and the city appears
const DURATION = 7.2;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;
const easeInOut = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
const lerp = (a, b, t) => a + (b - a) * t;
const RAD = Math.PI / 180;

// A small orthographic globe drawn pixel by pixel from the same equirectangular
// map as the 3D globe, so it shows the real continents without WebGL. The
// tilt (`centerLat`) stays fixed while it spins, so each pixel's latitude and
// longitude offset are worked out once and a frame is only a table lookup.
async function makeGlobeRenderer(size, centerLat) {
  const map = document.createElement("canvas");
  map.width = 1024;
  map.height = 512;
  paintSurface(map, await loadLand().catch(() => null), { ocean: SKELETON.oceanColor });
  const mapPixels = map.getContext("2d").getImageData(0, 0, map.width, map.height).data;

  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const octx = out.getContext("2d");
  const image = octx.createImageData(size, size);
  const px = image.data;

  const sinP = Math.sin(centerLat * RAD);
  const cosP = Math.cos(centerLat * RAD);
  const offsets = []; // pixel offset in the output
  const rows = []; // start of the map row at that pixel's latitude
  const dLngs = []; // longitude relative to the center, in map columns
  const lights = []; // a little darker toward the edge
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1;
      const y = 1 - ((j + 0.5) / size) * 2;
      const rr = x * x + y * y;
      if (rr > 1) continue;
      const z = Math.sqrt(1 - rr);
      const lat = Math.asin(z * sinP + y * cosP) / RAD;
      const dLng = Math.atan2(x, z * cosP - y * sinP) / RAD;
      offsets.push((j * size + i) * 4);
      rows.push(Math.min(map.height - 1, Math.floor(((90 - lat) / 180) * map.height)) * map.width);
      dLngs.push((dLng / 360) * map.width);
      lights.push(0.8 + 0.2 * z);
    }
  }

  return function draw(centerLng) {
    const shift = ((centerLng + 180) / 360) * map.width;
    for (let k = 0; k < offsets.length; k++) {
      let u = Math.floor(shift + dLngs[k]) % map.width;
      if (u < 0) u += map.width;
      const m = (rows[k] + u) * 4;
      const o = offsets[k];
      const light = lights[k];
      px[o] = mapPixels[m] * light;
      px[o + 1] = mapPixels[m + 1] * light;
      px[o + 2] = mapPixels[m + 2] * light;
      px[o + 3] = 255;
    }
    octx.putImageData(image, 0, 0);
    return out;
  };
}

// The globe's tilt: the city's latitude, kept away from the poles so the
// view still reads as a globe.
const globeTilt = (fit) => Math.max(-50, Math.min(55, fit.lat));

// Where a lat/lng lands on the globe drawing: x, y in [-1, 1] and whether
// it's on the visible side.
function projectPoint(lat, lng, centerLat, centerLng) {
  const dl = (lng - centerLng) * RAD;
  const p = lat * RAD;
  const p0 = centerLat * RAD;
  return {
    x: Math.cos(p) * Math.sin(dl),
    y: Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl),
    visible: Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl) > 0,
  };
}

// Sound, generated with Web Audio and recorded into the video. Each cue is
// scheduled up front against the audio clock.
function scheduleSound(audio, out) {
  const t0 = audio.currentTime + 0.05;
  const tone = (at, freq, dur, { type = "sine", gain = 0.18, toFreq = null } = {}) => {
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0 + at);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + at + dur);
    amp.gain.setValueAtTime(0.0001, t0 + at);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + at + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(amp).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur + 0.05);
  };

  [0, 0.5, 1.0].forEach((at) => tone(at, 880, 0.12, { type: "triangle", gain: 0.25 })); // 3-2-1
  tone(T_SCAN, 1320, 0.1, { type: "triangle", gain: 0.2 }); // shutter
  tone(T_SCAN + 0.05, 220, T_GLOBE - T_SCAN - 0.1, { gain: 0.07, toFreq: 880 }); // scan sweep
  tone(T_GLOBE, 160, T_REVEAL - T_GLOBE, { type: "triangle", gain: 0.08, toFreq: 70 }); // spin
  for (let i = 0; i < 8; i++) tone(T_REVEAL + i * 0.1, 440 * 2 ** (i / 12), 0.07, { type: "square", gain: 0.05 }); // count-up
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(T_CITY + i * 0.04, f, 1.4, { gain: 0.1 })); // reveal chord
}

function drawCountdown(ctx, photo, t) {
  drawCover(ctx, photo, 0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, W, H);
  const n = 3 - Math.floor(t / 0.5);
  const local = (t % 0.5) / 0.5;
  const scale = lerp(1.35, 1, easeOut(local * 2.5));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.min(1, local * 5) * (1 - Math.max(0, local - 0.8) * 2.5);
  setFont(ctx, `800 420px ${SANS}`);
  ctx.fillStyle = CREAM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillText(String(n), 0, 10);
  ctx.fillStyle = CREAM;
  ctx.fillText(String(n), 0, 0);
  ctx.restore();
  wordmark(ctx, CREAM);
}

function drawScan(ctx, fit, photo, t) {
  const p = (t - T_SCAN) / (T_GLOBE - T_SCAN);
  drawCover(ctx, photo, 0, 0, W, H);
  // Flash right after the "shutter".
  if (t - T_SCAN < 0.25) {
    ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - (t - T_SCAN) / 0.25)})`;
    ctx.fillRect(0, 0, W, H);
  }
  const lineY = lerp(SAFE_TOP, SAFE_BOTTOM, easeInOut(p));

  // Everything above the line gets a faint tint, as if already read.
  ctx.fillStyle = "rgba(168, 69, 43, 0.12)";
  ctx.fillRect(0, 0, W, lineY);
  const glow = ctx.createLinearGradient(0, lineY - 70, 0, lineY + 70);
  glow.addColorStop(0, "rgba(168,69,43,0)");
  glow.addColorStop(0.5, "rgba(168,69,43,0.55)");
  glow.addColorStop(1, "rgba(168,69,43,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, lineY - 70, W, 140);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, lineY - 4, W, 8);

  // Tag each piece as the line passes it, alternating sides, top to bottom.
  const items = fit.items?.length ? fit.items : ["reading your fit"];
  items.forEach((item, i) => {
    const y = lerp(SAFE_TOP + 180, SAFE_BOTTOM - 160, items.length > 1 ? i / (items.length - 1) : 0.4);
    const since = (lineY - y) / 160;
    if (since <= 0) return;
    const label = item.toLowerCase();
    setFont(ctx, `600 40px ${MONO}`);
    const w = ctx.measureText(label).width + 48;
    const left = i % 2 === 0;
    const x = left ? 70 : W - 70 - w;
    ctx.save();
    ctx.globalAlpha = clamp01(since);
    ctx.translate(x + w / 2, y);
    const s = lerp(0.6, 1, easeOut(since));
    ctx.scale(s, s);
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -38, w, 76, 18);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 2);
    ctx.restore();
  });
  wordmark(ctx, CREAM);
}

function drawGlobeScene(ctx, fit, drawGlobe, t) {
  const p = easeInOut((t - T_GLOBE) / (T_REVEAL - T_GLOBE - 0.2));
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  wordmark(ctx, INK);

  // Spin in from 1.4 turns away, ending face-on to the city.
  const lng = fit.lng - lerp(500, 0, p);
  const lat = globeTilt(fit);
  const size = 860;
  const cx = W / 2;
  const cy = H / 2 - 40;
  // A soft halo behind it (a gradient: much cheaper per frame than a shadow).
  const halo = ctx.createRadialGradient(cx, cy + 20, size * 0.45, cx, cy + 20, size * 0.6);
  halo.addColorStop(0, "rgba(74,65,48,0.22)");
  halo.addColorStop(1, "rgba(74,65,48,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.drawImage(drawGlobe(lng), cx - size / 2, cy - size / 2, size, size);

  const pin = projectPoint(fit.lat, fit.lng, lat, lng);
  if (pin.visible) {
    const x = cx + (pin.x * size) / 2;
    const y = cy - (pin.y * size) / 2;
    const pulse = p >= 1 ? (t * 2) % 1 : 0;
    if (pulse) {
      ctx.strokeStyle = `rgba(168,69,43,${1 - pulse})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(x, y, 22 + pulse * 60, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  setFont(ctx, `600 32px ${MONO}`, 6);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("FINDING YOUR CITY", W / 2, cy + size / 2 + 130);
}

function drawRevealScene(ctx, fit, photo, t) {
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  wordmark(ctx, INK);

  // The photo, small and rounded, so the video still shows the fit.
  const appear = easeOut((t - T_REVEAL) / 0.4);
  const pw = 520;
  const ph = 640;
  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(W / 2, SAFE_TOP + 40 + ph / 2 + (1 - appear) * 40);
  ctx.rotate(-0.025);
  ctx.beginPath();
  ctx.roundRect(-pw / 2, -ph / 2, pw, ph, 36);
  ctx.clip();
  drawCover(ctx, photo, -pw / 2, -ph / 2, pw, ph);
  ctx.restore();

  const countP = easeOut((t - T_REVEAL) / (T_CITY - T_REVEAL));
  const shown = formatScore(Math.round(fit.pct * countP));
  const top = SAFE_TOP + ph + 150;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, `600 30px ${MONO}`, 8);
  ctx.fillStyle = MUTED;
  ctx.fillText("MY CITY MATCH", W / 2, top);

  const cityIn = easeOut((t - T_CITY) / 0.5);
  if (cityIn <= 0) {
    drawScoreCentered(ctx, shown, W / 2, top + 230, 230, fit.accent);
  } else {
    ctx.save();
    const pop = 1 + 0.08 * Math.sin(Math.PI * clamp01((t - T_CITY) / 0.35));
    ctx.translate(W / 2, top + 190);
    ctx.scale(pop, pop);
    drawPctCity(ctx, fit, { x: 0, y: 0, width: W - 140, pctSize: 190, citySize: 150, align: "center" });
    ctx.restore();

    ctx.globalAlpha = cityIn;
    let y = top + 280;
    const detail = styleLine(fit);
    if (detail) {
      setFont(ctx, `400 38px ${SANS}`);
      ctx.fillStyle = BODY;
      ctx.fillText(detail, W / 2, y, W - 160);
      y += 70;
    }
    if (fit.verdict) {
      setFont(ctx, `italic 500 44px ${SERIF}`);
      ctx.fillStyle = INK;
      for (const line of wrapLines(ctx, `“${fit.verdict}”`, W - 220).slice(0, 2)) {
        ctx.fillText(line, W / 2, y);
        y += 58;
      }
    }
    ctx.globalAlpha = 1;
  }

  const tagIn = easeOut((t - T_CITY - 0.5) / 0.5);
  if (tagIn > 0) {
    ctx.globalAlpha = tagIn;
    pill(ctx, TAGLINE, { y: SAFE_BOTTOM + 40, color: CREAM, background: INK });
    ctx.globalAlpha = 1;
  }
}

/**
 * Records The Reveal into `canvas` (which the caller can show while it
 * plays). Resolves to { blob, ext }. Recording happens in real time, so it
 * takes as long as the video (about 7 seconds).
 */
export async function recordReveal(fit, canvas, { audio = null, onProgress } = {}) {
  const format = videoFormat();
  if (!format) throw new Error("This browser can't record video");
  await loadFonts();
  const [photo, drawGlobe] = await Promise.all([loadPhoto(fit.photoDataUrl), makeGlobeRenderer(480, globeTilt(fit))]);

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const drawFrame = (t) => {
    if (t < T_SCAN) drawCountdown(ctx, photo, t);
    else if (t < T_GLOBE) drawScan(ctx, fit, photo, t);
    else if (t < T_REVEAL) drawGlobeScene(ctx, fit, drawGlobe, t);
    else drawRevealScene(ctx, fit, photo, t);
  };
  drawFrame(0);

  // `audio` is an AudioContext the caller created during the tap that
  // started this: browsers only allow sound to start from a user gesture.
  const stream = canvas.captureStream(30);
  try {
    if (!audio) throw new Error("no audio");
    await audio.resume();
    const out = audio.createMediaStreamDestination();
    scheduleSound(audio, out);
    out.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  } catch {
    // no sound, but still a video
  }

  const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (e) => reject(e.error || new Error("Recording failed"));
  });
  recorder.start(250);

  const start = performance.now();
  await new Promise((resolve) => {
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      drawFrame(Math.min(t, DURATION));
      onProgress?.(Math.min(1, t / DURATION));
      if (t >= DURATION) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  return { blob: new Blob(chunks, { type: format.mimeType.split(";")[0] }), ext: format.ext };
}
