// fitd's home page: a Three.js globe with a pin for each city. Tapping a pin
// opens that city's style popup; the Fit Check button matches the visitor's
// outfit to a city.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const GLOBE_RADIUS = 80;
const MARKER_COLOR = "#a8452b";

// Skeleton globe: a solid sphere drawn with latitude/longitude lines only.
const SKELETON = {
  sphereColor: 0xf1e6cc,
  lineColor: "rgba(107, 88, 66, 0.45)",
  equatorColor: "rgba(168, 69, 43, 0.55)",
  haloColor: 0xf4ead2,
};

// Cities live in a shared file so the server's city-match Fit Check uses the
// same list (and each city's style description).
const MARKERS = await fetch("/data/cities.json").then((res) => res.json());

const DEFAULT_YEAR = 2025;
const YEAR_MIN = 2015;
const YEAR_MAX = 2025;

function latLngToVector3(lat, lng, radius, alt = 0) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const r = radius + alt;
  return new THREE.Vector3(
    -(r * Math.sin(phi) * Math.cos(theta)),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

// Latitude/longitude lines every 15°, painted onto a transparent canvas that
// wraps the sphere (equirectangular: x = longitude, y = latitude). The equator
// is drawn heavier so the globe's orientation reads at a glance.
function buildGraticuleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const step = 15;

  const line = (x1, y1, x2, y2, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  for (let lng = -180; lng <= 180; lng += step) {
    const x = ((lng + 180) / 360) * canvas.width;
    line(x, 0, x, canvas.height, SKELETON.lineColor, 1.5);
  }
  for (let lat = -90 + step; lat < 90; lat += step) {
    const y = ((90 - lat) / 180) * canvas.height;
    const isEquator = lat === 0;
    line(0, y, canvas.width, y, isEquator ? SKELETON.equatorColor : SKELETON.lineColor, isEquator ? 3 : 1.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

const container = document.getElementById("globeViz");
const tooltipEl = document.getElementById("markerTooltip");
const popupEl = document.getElementById("regionPopup");

// Mobile browsers restore the previous scroll/zoom on reload, which can
// leave the full-screen globe shifted off-center.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo(0, 0);

// Size from the container rather than window.innerWidth/innerHeight: on
// phones those are still settling (address bar, restored zoom) at load time.
function viewportSize() {
  return {
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
  };
}

// Camera distance at which the whole globe (plus a margin) fits on screen.
// The FOV is vertical, so narrow portrait screens need the camera further back
// or the sides of the globe get cropped.
function fitCameraZ(aspect) {
  const halfFov = THREE.MathUtils.degToRad(45 / 2);
  return Math.max(280, (GLOBE_RADIUS + 15) / Math.tan(halfFov) / Math.min(aspect, 1));
}

const initialSize = viewportSize();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, initialSize.width / initialSize.height, 0.1, 2000);
let homeZ = fitCameraZ(camera.aspect);
camera.position.z = homeZ;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(initialSize.width, initialSize.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const globeGroup = new THREE.Group();
scene.add(globeGroup);

scene.add(new THREE.AmbientLight(0xffffff, 1.3));
const dirLight = new THREE.DirectionalLight(0xf4ead2, 1.2);
dirLight.position.set(200, 100, 150);
scene.add(dirLight);

// Solid core, the graticule just above its surface, and a soft halo behind.
globeGroup.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64),
    new THREE.MeshLambertMaterial({ color: SKELETON.sphereColor })
  )
);
globeGroup.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS + 0.15, 64, 64),
    new THREE.MeshBasicMaterial({ map: buildGraticuleTexture(), transparent: true, depthWrite: false })
  )
);
globeGroup.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 48, 48),
    new THREE.MeshBasicMaterial({ color: SKELETON.haloColor, transparent: true, opacity: 0.35, side: THREE.BackSide })
  )
);

const markerGeometry = new THREE.SphereGeometry(1.6, 16, 16);
const ringGeometry = new THREE.RingGeometry(2.2, 2.9, 32);
const pulsingRings = [];
const pinsById = new Map(); // city id -> { pin, ring }, for highlighting a match

MARKERS.forEach((m) => {
  const pos = latLngToVector3(m.lat, m.lng, GLOBE_RADIUS, 0.5);

  const pin = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: MARKER_COLOR }));
  pin.position.copy(pos);
  pin.userData.marker = m;
  globeGroup.add(pin);

  const ring = new THREE.Mesh(
    ringGeometry,
    new THREE.MeshBasicMaterial({ color: MARKER_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
  );
  ring.position.copy(pos);
  ring.lookAt(0, 0, 0);
  globeGroup.add(ring);
  pulsingRings.push(ring);
  pinsById.set(m.id, { pin, ring });
});

// Makes one city's pin (e.g. the best city match) bigger with a wider pulse.
let highlightedCityId = null;
function highlightCity(id) {
  const previous = pinsById.get(highlightedCityId);
  if (previous) {
    previous.pin.scale.setScalar(1);
    previous.ring.userData.boost = 1;
  }
  highlightedCityId = id;
  const next = pinsById.get(id);
  if (next) {
    next.pin.scale.setScalar(2);
    next.ring.userData.boost = 2.2;
  }
}

// --- Camera zoom: pinch, wheel and the +/- buttons all set a target
// distance, and animate() eases the camera toward it every frame, so zooming
// glides instead of jumping. ---
// Limits scale with the "whole globe" distance, so a narrow phone can't zoom
// in until the screen is nothing but ground.
const minDistance = () => Math.max(GLOBE_RADIUS + 40, homeZ * 0.45);
const maxDistance = () => Math.max(400, homeZ * 1.4);
const ZOOM_EASE = 0.18; // fraction of the remaining distance covered per frame

let zoomTarget = null; // null = not zooming

function currentZoom() {
  return zoomTarget ?? camera.position.length();
}

function setZoomTarget(distance) {
  cancelCameraTween();
  zoomTarget = Math.min(maxDistance(), Math.max(minDistance(), distance));
}

function stepZoom() {
  if (zoomTarget === null) return;
  const distance = camera.position.length();
  const next = distance + (zoomTarget - distance) * ZOOM_EASE;
  if (Math.abs(zoomTarget - next) < 0.05) {
    camera.position.setLength(zoomTarget);
    zoomTarget = null;
  } else {
    camera.position.setLength(next);
  }
}

// Camera flights (flyCameraTo) bump this token; a newer flight or a manual
// zoom cancels the running one instead of fighting it.
let cameraTween = 0;
function cancelCameraTween() {
  cameraTween++;
}

// --- Touch/mouse gestures. Every active pointer is tracked so two fingers
// become a pinch-zoom rather than two competing drags. ---
const activePointers = new Map();
let isDragging = false;
let previousPointer = { x: 0, y: 0 };
let pinchStart = null; // { distance, zoom }
let suppressClick = false; // a drag or pinch shouldn't also count as a tap
let downAt = { x: 0, y: 0 };

function pointerDistance() {
  const [a, b] = [...activePointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function onPointerDown(e) {
  renderer.domElement.setPointerCapture?.(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 1) {
    isDragging = true;
    suppressClick = false;
    downAt = { x: e.clientX, y: e.clientY };
    previousPointer = { x: e.clientX, y: e.clientY };
  } else if (activePointers.size === 2) {
    isDragging = false;
    suppressClick = true;
    tooltipEl.hidden = true;
    pinchStart = { distance: pointerDistance(), zoom: currentZoom() };
  }
}

function onPointerMove(e) {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (activePointers.size >= 2 && pinchStart) {
    const distance = pointerDistance();
    if (distance > 0) setZoomTarget(pinchStart.zoom * (pinchStart.distance / distance));
    return;
  }

  if (isDragging) {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) suppressClick = true;
    // Rotate less per pixel when zoomed in, so the globe tracks the finger.
    const speed = 0.005 * (camera.position.length() / homeZ);
    const deltaX = e.clientX - previousPointer.x;
    const deltaY = e.clientY - previousPointer.y;
    globeGroup.rotation.y += deltaX * speed;
    globeGroup.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, globeGroup.rotation.x + deltaY * speed));
    previousPointer = { x: e.clientX, y: e.clientY };
    return;
  }

  if (e.pointerType === "touch") return; // hover tooltips are mouse-only

  const pin = pinUnderPointer(e);
  tooltipEl.hidden = !pin;
  if (pin) {
    tooltipEl.textContent = pin.userData.marker.label;
    tooltipEl.style.left = `${e.clientX + 14}px`;
    tooltipEl.style.top = `${e.clientY + 14}px`;
  }
  document.body.style.cursor = pin ? "pointer" : "grab";
}

function onPointerUp(e) {
  activePointers.delete(e.pointerId);

  if (activePointers.size === 1) {
    // Going from a pinch back to one finger: carry on rotating from where
    // that finger is now, rather than jumping from its old position.
    pinchStart = null;
    const [remaining] = activePointers.values();
    previousPointer = { ...remaining };
    isDragging = true;
  } else if (activePointers.size === 0) {
    pinchStart = null;
    isDragging = false;
  }
}

function onWheel(e) {
  e.preventDefault();
  // Mouse wheels, trackpad scrolls and trackpad pinches (ctrlKey) all land
  // here; exponential scaling makes each notch feel the same at any zoom.
  const sensitivity = e.ctrlKey ? 0.01 : 0.0015;
  setZoomTarget(currentZoom() * Math.exp(e.deltaY * sensitivity));
}

// The city pin (if any) under a pointer event, found by casting a ray from the
// camera through that point on screen.
const raycaster = new THREE.Raycaster();
function pinUnderPointer(e) {
  const rect = container.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((e.clientY - rect.top) / rect.height) * 2
  );
  raycaster.setFromCamera(ndc, camera);
  for (const hit of raycaster.intersectObjects(globeGroup.children)) {
    if (hit.object.userData.marker) return hit.object;
  }
  return null;
}

function onClick(e) {
  if (suppressClick) {
    suppressClick = false; // the pointer was dragging or pinching, not tapping
    return;
  }
  const pin = pinUnderPointer(e);
  if (pin) showRegionPopup(pin.userData.marker);
}

// --- Camera flights: one eased animation used for flying to a city and back
// out to the whole globe. Starting a new flight (or zooming by hand)
// supersedes the one in progress via the cameraTween token. ---
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function flyCameraTo(destination, durationMs) {
  zoomTarget = null;
  const flight = ++cameraTween;
  const from = camera.position.clone();
  const startedAt = performance.now();

  const frame = (now) => {
    if (flight !== cameraTween) return;
    const progress = Math.min((now - startedAt) / durationMs, 1);
    camera.position.copy(from).lerp(destination, easeOutCubic(progress));
    camera.lookAt(0, 0, 0);
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Fly to look straight down at a lat/lng from `distance` away. The globe may
// have been spun by hand, so the spot's position is taken in world space.
function flyToLocation(lat, lng, distance = Math.max(150, minDistance())) {
  const spot = latLngToVector3(lat, lng, distance).applyQuaternion(globeGroup.quaternion);
  flyCameraTo(spot, 1200);
}

function flyHome() {
  flyCameraTo(new THREE.Vector3(0, 0, homeZ), 800);
}

function yearOptionsHtml(selectedYear) {
  let options = "";
  for (let year = YEAR_MAX; year >= YEAR_MIN; year--) {
    options += `<option value="${year}"${year === selectedYear ? " selected" : ""}>${year}</option>`;
  }
  return options;
}

let currentPopupMarker = null;
function showRegionPopup(marker) {
  currentPopupMarker = marker;
  flyToLocation(marker.lat, marker.lng);
  popupEl.innerHTML = `
    <button class="popup-close" aria-label="Close">×</button>
    <h3>${marker.label} Style</h3>
    <select class="popup-year" aria-label="Year">${yearOptionsHtml(DEFAULT_YEAR)}</select>
    <div class="popup-images"><p class="muted">Loading…</p></div>
    <button class="fit-check-btn">Fit Check</button>
  `;
  popupEl.hidden = false;

  popupEl.querySelector(".popup-close").addEventListener("click", () => {
    popupEl.hidden = true;
    flyHome();
  });

  const yearSelect = popupEl.querySelector(".popup-year");
  yearSelect.addEventListener("change", () => loadFashionWeekImages(marker.label, yearSelect.value));

  loadFashionWeekImages(marker.label, DEFAULT_YEAR);
}

async function loadFashionWeekImages(city, year) {
  const imagesEl = popupEl.querySelector(".popup-images");
  if (!imagesEl) return; // popup was closed/reopened before this resolved
  imagesEl.innerHTML = `<p class="muted">Searching ${city} style, ${year}…</p>`;

  try {
    const params = new URLSearchParams({ city, year });
    const res = await fetch(`/api/fashion-week?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");

    const sections = (data.sections || []).filter((section) => section.images.length);
    if (!sections.length) {
      imagesEl.innerHTML = `<p class="muted">No images found for ${city} ${year}.</p>`;
      return;
    }

    // One labelled row per style (Runway, Streetwear, Everyday, Heritage).
    imagesEl.innerHTML = sections
      .map(
        (section) => `
          <h4 class="style-heading">${section.label}</h4>
          <div class="style-images">
            ${section.images
              .map((img) => {
                const alt = img.title || `${city} ${section.label}`;
                return `<img
                  src="${img.thumbnailUrl}"
                  data-full="${img.imageUrl}"
                  data-source="${img.source || img.imageUrl}"
                  alt="${alt}"
                  loading="lazy" />`;
              })
              .join("")}
          </div>`
      )
      .join("");
  } catch (err) {
    imagesEl.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  }
}

// Clicking a fashion-week thumbnail opens the full-size image in a lightbox
// instead of navigating away to its source page. Delegated on popupEl (which
// itself is never replaced, only its innerHTML) so this keeps working across
// every showRegionPopup() re-render without needing to rebind per image.
const lightboxEl = document.getElementById("imageLightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxSource = document.getElementById("lightboxSource");

function openLightbox(fullUrl, sourceUrl, alt) {
  lightboxImg.src = fullUrl;
  lightboxImg.alt = alt || "";
  lightboxSource.href = sourceUrl || fullUrl;
  lightboxEl.hidden = false;
}

function closeLightbox() {
  lightboxEl.hidden = true;
  lightboxImg.src = "";
}

popupEl.addEventListener("click", (e) => {
  const img = e.target.closest(".popup-images img");
  if (img) {
    openLightbox(img.dataset.full, img.dataset.source, img.alt);
    return;
  }

  if (e.target.closest(".fit-check-btn") && currentPopupMarker) {
    const year = popupEl.querySelector(".popup-year")?.value || DEFAULT_YEAR;
    openFitCheck(currentPopupMarker.label, year);
  }
});

lightboxEl.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
lightboxEl.addEventListener("click", (e) => {
  if (e.target === lightboxEl) closeLightbox(); // backdrop click
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightboxEl.hidden) closeLightbox();
  if (e.key === "Escape" && !fitCheckPanel.hidden) closeFitCheck();
  else if (e.key === "Escape" && !cityMatchCard.hidden) closeCityMatch();
});

// --- Live "Fit Check": direct browser camera access (getUserMedia, no
// third-party video API or credentials needed) + Gemini comparison against
// the fashion-week photos for whatever city/year is currently selected. ---
const fitCheckPanel = document.getElementById("fitCheckPanel");
const fitCheckTitle = document.getElementById("fitCheckTitle");
const fitCheckPublisherEl = document.getElementById("fitCheckPublisher");
const fitCheckCaptureBtn = document.getElementById("fitCheckCapture");
const fitCheckResultEl = document.getElementById("fitCheckResult");
const fitCheckCloseBtn = document.getElementById("fitCheckClose");
const cityMatchCard = document.getElementById("cityMatchCard");
const countdownEl = document.getElementById("fitCheckCountdown");
const flashEl = document.getElementById("fitCheckFlash");
const timerButtons = [...document.querySelectorAll(".timer-toggle button")];

let fitCheckStream = null;
let fitCheckContext = { city: null, year: null };
let lastFitResult = null; // what the Share button turns into an image card

// A vibrant, score-driven accent instead of one flat color for every result:
// low scores read as a warm alert, high scores as a rich, celebratory glow.
function scoreGradient(score) {
  if (score >= 70) return "linear-gradient(135deg, #2f9e5c, #c9d84a)";
  if (score >= 40) return "linear-gradient(135deg, #c98a3b, #e0483a)";
  return "linear-gradient(135deg, #a8452b, #6b2418)";
}

function scoreAccent(score) {
  if (score >= 70) return "#2f9e5c";
  if (score >= 40) return "#c9752f";
  return "#a8452b";
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Opens the full-screen camera. `context` says what the capture is scored
// against: { city, year } or { mode: "city-match" }.
async function openCamera(title, context) {
  cancelCountdown();
  fitCheckContext = context;
  fitCheckTitle.textContent = title;
  fitCheckResultEl.hidden = true;
  fitCheckResultEl.innerHTML = "";
  fitCheckCaptureBtn.disabled = true;
  fitCheckCaptureBtn.textContent = "Starting camera…";
  fitCheckPanel.hidden = false;
  popupEl.hidden = true; // step out of the way while the camera is up
  cityMatchCard.hidden = true;

  try {
    fitCheckStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });

    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.width = "100%";
    videoEl.style.height = "100%";
    videoEl.style.objectFit = "cover";
    videoEl.srcObject = fitCheckStream;
    fitCheckPublisherEl.innerHTML = "";
    fitCheckPublisherEl.appendChild(videoEl);

    // Only allow a capture once the camera is showing a picture; tapping
    // earlier would score a black frame.
    await new Promise((resolve) => {
      if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) resolve();
      else videoEl.addEventListener("loadeddata", resolve, { once: true });
    });
    fitCheckCaptureBtn.disabled = false;
    fitCheckCaptureBtn.textContent = captureLabel();
  } catch (err) {
    fitCheckResultEl.hidden = false;
    fitCheckResultEl.innerHTML = `<p class="muted">Couldn't access your camera: ${err.message}</p>`;
  }
}

function openFitCheck(city, year) {
  return openCamera(`Fit Check — ${city} ${year}`, { city, year });
}

function openCityMatch() {
  highlightCity(null);
  return openCamera("Which city matches your fit?", { mode: "city-match" });
}

function closeFitCheck() {
  cancelCountdown();
  fitCheckPanel.hidden = true;
  fitCheckStream?.getTracks().forEach((track) => track.stop());
  fitCheckStream = null;
  fitCheckPublisherEl.innerHTML = "";
}

fitCheckCloseBtn.addEventListener("click", closeFitCheck);

// --- Capture timer: take the photo now, or after a 3s / 5s countdown so
// people can step back and get their whole outfit in frame. ---
const TIMER_CHOICES = [0, 3, 5];
const TIMER_STORAGE_KEY = "fitd.captureTimer";

let captureTimer = 0;
try {
  const saved = Number(localStorage.getItem(TIMER_STORAGE_KEY));
  if (TIMER_CHOICES.includes(saved)) captureTimer = saved;
} catch {
  /* storage blocked (e.g. private mode) — default to no timer */
}

function captureLabel() {
  return captureTimer ? `Capture in ${captureTimer}s` : "Capture & Score";
}

function renderTimerToggle() {
  timerButtons.forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.timer) === captureTimer)));
}
renderTimerToggle();

timerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    captureTimer = Number(button.dataset.timer);
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, String(captureTimer));
    } catch {
      /* not remembered, but still applies for this session */
    }
    renderTimerToggle();
    if (!fitCheckCaptureBtn.disabled) fitCheckCaptureBtn.textContent = captureLabel();
  });
});

let countdownInterval = null;

function showCountdownNumber(n) {
  countdownEl.textContent = n;
  countdownEl.classList.remove("tick");
  void countdownEl.offsetWidth; // restart the pop animation for each number
  countdownEl.classList.add("tick");
}

function startCountdown(seconds, onDone) {
  // Driven by the clock rather than by counting ticks, so a busy or throttled
  // main thread can delay a frame but not the photo itself.
  const endsAt = performance.now() + seconds * 1000;
  let shown = seconds;
  fitCheckResultEl.hidden = true; // clear the view so they can pose
  countdownEl.hidden = false;
  showCountdownNumber(shown);
  fitCheckCaptureBtn.textContent = "Cancel";
  timerButtons.forEach((b) => (b.disabled = true));

  countdownInterval = setInterval(() => {
    const remaining = Math.ceil((endsAt - performance.now()) / 1000);
    if (remaining <= 0) {
      cancelCountdown();
      onDone();
    } else if (remaining !== shown) {
      shown = remaining;
      showCountdownNumber(shown);
    }
  }, 100);
}

function cancelCountdown() {
  if (countdownInterval === null) return;
  clearInterval(countdownInterval);
  countdownInterval = null;
  countdownEl.hidden = true;
  timerButtons.forEach((b) => (b.disabled = false));
  fitCheckCaptureBtn.textContent = captureLabel();
}

function flashCamera() {
  flashEl.classList.remove("flash");
  void flashEl.offsetWidth;
  flashEl.classList.add("flash");
}

fitCheckCaptureBtn.addEventListener("click", () => {
  if (countdownInterval !== null) {
    cancelCountdown();
    return;
  }
  const videoEl = fitCheckPublisherEl.querySelector("video");
  if (!videoEl?.videoWidth) return; // camera hasn't produced a frame yet

  if (captureTimer) startCountdown(captureTimer, captureAndScore);
  else captureAndScore();
});

async function captureAndScore() {
  const videoEl = fitCheckPublisherEl.querySelector("video");
  if (!videoEl?.videoWidth) return; // camera closed or stopped mid-countdown
  flashCamera();

  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth || 640;
  canvas.height = videoEl.videoHeight || 480;
  canvas.getContext("2d").drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const photoDataUrl = canvas.toDataURL("image/jpeg", 0.85);

  fitCheckResultEl.hidden = false;
  lastFitResult = null;

  if (fitCheckContext.mode === "city-match") {
    runCityMatch(photoDataUrl, videoEl);
    return;
  }

  const { city, year } = fitCheckContext;
  fitCheckResultEl.innerHTML = `<p class="muted">Comparing your fit to ${city}'s runway, streetwear, everyday and heritage style…</p>`;
  fitCheckCaptureBtn.disabled = true;

  try {
    const form = new FormData();
    form.append("photo", dataUrlToBlob(photoDataUrl), "fit.jpg");
    form.append("city", city);
    form.append("year", year);
    const res = await fetch("/api/outfit/fit-check", { method: "POST", body: form });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Fit check failed");

    const { fitScore, verdict, reasoning, closestStyle } = result;
    const accent = scoreAccent(fitScore);
    lastFitResult = {
      photoDataUrl,
      score: fitScore,
      max: 100,
      headline: verdict,
      subline: reasoning,
      context: closestStyle ? `${city} ${closestStyle}` : city,
      accent,
    };

    const closest = closestStyle ? `<p class="fit-closest">Closest to ${city} ${closestStyle.toLowerCase()}</p>` : "";
    fitCheckResultEl.innerHTML = `
      <div class="fit-score-badge" style="background: ${scoreGradient(fitScore)}">
        <span class="fit-score-num">${fitScore}</span><span class="fit-score-max">/100</span>
      </div>
      <h4 class="fit-verdict" style="color: ${accent}">${verdict}</h4>
      ${closest}
      <p class="fit-reasoning">${reasoning}</p>
      <button class="share-fit-btn">${canShareFiles() ? "Share" : "Save image"}</button>
    `;
  } catch (err) {
    fitCheckResultEl.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  } finally {
    fitCheckCaptureBtn.disabled = false;
  }
}

// --- City match: "which city matches your fit?" ---

// Shown one after another while the match runs (it takes 10-30s), roughly in
// step with what the server is doing. The last one stays up until it's done.
const CITY_MATCH_STEPS = [
  "Reading your fit…",
  `Checking it against ${MARKERS.length} cities…`,
  "Pulling real street photos from your top 3…",
  "Comparing runway, streetwear, everyday and heritage looks…",
  "Scoring your matches…",
];

function showProgress(el, steps, intervalMs = 4000) {
  let i = 0;
  const render = () => {
    el.innerHTML = `<div class="progress"><span class="spinner" aria-hidden="true"></span><p>${steps[i]}</p></div>`;
  };
  render();
  const timer = setInterval(() => {
    if (i < steps.length - 1) {
      i++;
      render();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

async function runCityMatch(photoDataUrl, videoEl) {
  videoEl.pause(); // freeze on the captured frame while it's scored
  fitCheckCaptureBtn.disabled = true;
  const stopProgress = showProgress(fitCheckResultEl, CITY_MATCH_STEPS);

  try {
    const form = new FormData();
    form.append("photo", dataUrlToBlob(photoDataUrl), "fit.jpg");
    const res = await fetch("/api/outfit/city-match", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "City match failed");

    stopProgress();
    closeFitCheck();
    showCityMatch(data, photoDataUrl);
  } catch (err) {
    stopProgress();
    fitCheckResultEl.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
    videoEl.play();
  } finally {
    fitCheckCaptureBtn.disabled = false;
  }
}

function showCityMatch(data, photoDataUrl) {
  const [best, ...others] = data.matches;
  highlightCity(best.id);
  flyToLocation(best.lat, best.lng, homeZ * 0.75);

  lastFitResult = {
    photoDataUrl,
    scoreText: `${best.matchPercent}%`,
    badgeLabel: "match",
    headline: `My fit is ${best.matchPercent}% ${best.city}`,
    subline: data.verdict,
    context: `${best.city} ${best.closestStyle}`,
    accent: scoreAccent(best.matchPercent),
    shareText: `My fit is ${best.matchPercent}% ${best.city}. Which city is yours? ${SHARE_URL}`,
  };

  cityMatchCard.innerHTML = `
    <div class="match-body">
    <button class="popup-close" data-action="close" aria-label="Close">×</button>
    <p class="match-eyebrow">Your fit is</p>
    <h2 class="match-headline">
      <span class="match-pct" style="color: ${scoreAccent(best.matchPercent)}">${best.matchPercent}%</span> ${best.city}
    </h2>
    <p class="fit-closest">Closest to ${best.city} ${String(best.closestStyle).toLowerCase()}</p>
    <p class="match-verdict">${data.verdict}</p>
    <p class="fit-reasoning">${best.reasoning}</p>
    <button class="match-explore" data-action="explore" data-city="${best.id}">Explore ${best.city} →</button>
    ${
      others.length
        ? `<p class="match-runners-title">Also close</p>
           <ul class="match-runners">
             ${others
               .map(
                 (m) => `<li><button data-action="explore" data-city="${m.id}">
                   <span class="runner-name">${m.city}</span>
                   <span class="runner-bar"><span style="width: ${m.matchPercent}%"></span></span>
                   <span class="runner-pct">${m.matchPercent}%</span>
                 </button></li>`
               )
               .join("")}
           </ul>`
        : ""
    }
    </div>
    <div class="match-actions">
      <button class="share-fit-btn" data-action="share">${canShareFiles() ? "Share" : "Save image"}</button>
      <button class="retry-btn" data-action="retry">Try again</button>
    </div>
  `;
  cityMatchCard.hidden = false;
}

function closeCityMatch() {
  cityMatchCard.hidden = true;
  highlightCity(null);
}

cityMatchCard.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, city } = btn.dataset;

  if (action === "share") {
    shareFitResult(btn);
  } else if (action === "explore") {
    const marker = MARKERS.find((m) => m.id === city);
    closeCityMatch();
    if (marker) showRegionPopup(marker);
  } else if (action === "retry") {
    closeCityMatch();
    openCityMatch();
  } else if (action === "close") {
    closeCityMatch();
    flyHome();
  }
});

document.getElementById("cityMatchBtn").addEventListener("click", openCityMatch);

// --- Sharing a fit check: the result is rendered onto a portrait image card
// (photo + score + verdict + link) so it reads on its own when posted to a
// story or a group chat. ---
const SHARE_URL = "https://thefitd.com";

function canShareFiles() {
  try {
    const probe = new File([""], "probe.jpg", { type: "image/jpeg" });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of String(text || "").split(/\s+/)) {
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

async function buildShareCard(result) {
  const W = 1080;
  const H = 1350;
  const PAD = 60;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ece1c8";
  ctx.fillRect(0, 0, W, H);

  // Photo, cropped to fill a rounded frame.
  const photo = await loadImage(result.photoDataUrl);
  const frame = { x: PAD, y: PAD, w: W - PAD * 2, h: 760 };
  const scale = Math.max(frame.w / photo.width, frame.h / photo.height);
  const sw = frame.w / scale;
  const sh = frame.h / scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, 36);
  ctx.clip();
  ctx.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, frame.x, frame.y, frame.w, frame.h);
  ctx.restore();

  // Score badge overlapping the photo's bottom-right corner.
  const cx = W - PAD - 110;
  const cy = frame.y + frame.h - 20;
  ctx.beginPath();
  ctx.arc(cx, cy, 110, 0, Math.PI * 2);
  ctx.fillStyle = result.accent;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#ece1c8";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const scoreText = result.scoreText ?? String(result.score);
  ctx.font = `800 ${scoreText.length > 3 ? 66 : 84}px system-ui, -apple-system, sans-serif`; // "100%" needs to fit
  ctx.fillText(scoreText, cx, cy - 10);
  ctx.font = "600 30px system-ui, -apple-system, sans-serif";
  ctx.fillText(result.badgeLabel ?? `/ ${result.max}`, cx, cy + 52);

  // Text block.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = frame.y + frame.h + 120; // clears the score badge
  ctx.fillStyle = "#8c7f63";
  ctx.font = "600 32px system-ui, -apple-system, sans-serif";
  ctx.fillText(`FIT CHECK · ${result.context}`.toUpperCase(), PAD, y);

  y += 72;
  ctx.fillStyle = "#4a4130";
  ctx.font = "800 60px system-ui, -apple-system, sans-serif";
  for (const line of wrapLines(ctx, result.headline, W - PAD * 2).slice(0, 2)) {
    ctx.fillText(line, PAD, y);
    y += 70;
  }

  ctx.fillStyle = "#6b5842";
  ctx.font = "400 34px system-ui, -apple-system, sans-serif";
  for (const line of wrapLines(ctx, result.subline, W - PAD * 2).slice(0, 3)) {
    ctx.fillText(line, PAD, y);
    y += 46;
  }

  ctx.fillStyle = "#a8452b";
  ctx.font = "700 34px system-ui, -apple-system, sans-serif";
  ctx.fillText("thefitd.com", PAD, H - PAD);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

async function shareFitResult(button) {
  if (!lastFitResult) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing…";

  try {
    const blob = await buildShareCard(lastFitResult);
    const file = new File([blob], "fitd-fit-check.jpg", { type: "image/jpeg" });
    const text =
      lastFitResult.shareText ??
      `${lastFitResult.score}/${lastFitResult.max} — ${lastFitResult.headline}. Check your fit at ${SHARE_URL}`;

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "My fitd Fit Check", text });
      } catch (err) {
        if (err.name !== "AbortError") throw err; // user closing the sheet isn't an error
      }
      return;
    }

    // Desktop fallback: save the card so it can be posted anywhere.
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (err) {
    alert(`Couldn't share: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

fitCheckResultEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".share-fit-btn");
  if (btn) shareFitResult(btn);
});

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
renderer.domElement.addEventListener("click", onClick);

let pulseTime = 0;
function animate() {
  requestAnimationFrame(animate);
  // The full-screen camera covers the globe; don't spend phone battery (or
  // starve the capture countdown) drawing something nobody can see.
  if (!fitCheckPanel.hidden) return;

  pulseTime += 0.03;
  const scale = 1 + (Math.sin(pulseTime) + 1) * 0.5;
  pulsingRings.forEach((ring) => {
    ring.scale.setScalar(scale * (ring.userData.boost || 1));
    ring.material.opacity = 0.8 - (scale - 1) * 0.5;
  });

  stepZoom();
  renderer.render(scene, camera);
}
animate();

function resizeRenderer() {
  const { width, height } = viewportSize();
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);

  // Keep the user's zoom level relative to the new "whole globe" distance.
  const newHomeZ = fitCameraZ(camera.aspect);
  camera.position.multiplyScalar(newHomeZ / homeZ);
  if (zoomTarget !== null) zoomTarget *= newHomeZ / homeZ;
  homeZ = newHomeZ;
}

// ResizeObserver also catches the address bar showing/hiding and orientation
// changes, which don't always fire a window resize on mobile.
new ResizeObserver(resizeRenderer).observe(container);

document.getElementById("zoomIn")?.addEventListener("click", () => setZoomTarget(currentZoom() * 0.8));
document.getElementById("zoomOut")?.addEventListener("click", () => setZoomTarget(currentZoom() * 1.25));
document.getElementById("resetView")?.addEventListener("click", () => {
  globeGroup.rotation.set(0, 0, 0);
  flyHome();
});
