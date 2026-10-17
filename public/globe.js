// fitd's home page: a Three.js globe with a pin for each city. Tapping a pin
// opens that city's style popup; the Fit Check button matches the visitor's
// outfit to a city.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { track } from "./track.js";
import { SKELETON, loadLand, paintSurface } from "./land.js";
import { openShareSheet } from "./share-sheet.js";
import { passportSummary, stampPassport } from "./passport.js";
import { clearChallengeFromUrl, readChallenge } from "./challenge.js";
import { formatScore } from "./score.js";

const GLOBE_RADIUS = 80;
const MARKER_COLOR = "#a8452b";

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

// The skeleton globe's surface (grid lines + continents) painted onto a
// transparent canvas that wraps the sphere. The canvas is equirectangular, the
// same mapping latLngToVector3 uses for the pins, so the land lines up with
// the cities.
function buildSurfaceTexture(land = null) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const texture = new THREE.CanvasTexture(paintSurface(canvas, land));
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

// Solid core, the surface layer (grid + land) just above it, and a soft halo
// behind. The surface starts as grid-only and is redrawn once the land loads.
const surfaceMaterial = new THREE.MeshBasicMaterial({
  map: buildSurfaceTexture(),
  transparent: true,
  depthWrite: false,
});
loadLand()
  .then((land) => {
    surfaceMaterial.map.dispose();
    surfaceMaterial.map = buildSurfaceTexture(land);
  })
  .catch((err) => console.error("Couldn't load continent outlines:", err));

globeGroup.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64),
    new THREE.MeshLambertMaterial({ color: SKELETON.sphereColor })
  )
);
globeGroup.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS + 0.15, 64, 64),
    surfaceMaterial
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
  track("city_opened", { city: marker.id });
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
let lastFitResult = null; // what the Share button shares (shape in share.js)

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

// Without a requested size, browsers open the camera at a low default
// (often 640x480), which looks blurry stretched across a phone screen. Ask for
// up to 4K; the browser picks the closest mode the camera supports.
// "user" is the front camera; "environment" the back one, for mirror fit
// checks.
let cameraFacing = "user";
const cameraConstraints = () => ({
  audio: false,
  video: {
    facingMode: cameraFacing,
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    frameRate: { ideal: 30 },
  },
});

// Keep focus and exposure adjusting as people step back for a full-length
// shot, on cameras that let the page control them (mostly Android Chrome;
// iPhones do this automatically).
function enableContinuousAutoAdjust(stream) {
  const [videoTrack] = stream.getVideoTracks();
  const capabilities = videoTrack?.getCapabilities?.() ?? {};
  const wanted = {};
  if (capabilities.focusMode?.includes("continuous")) wanted.focusMode = "continuous";
  if (capabilities.exposureMode?.includes("continuous")) wanted.exposureMode = "continuous";
  if (capabilities.whiteBalanceMode?.includes("continuous")) wanted.whiteBalanceMode = "continuous";
  if (Object.keys(wanted).length) videoTrack.applyConstraints({ advanced: [wanted] }).catch(() => {});
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

  await startCameraStream();
}

async function startCameraStream() {
  fitCheckStream?.getTracks().forEach((track) => track.stop());
  fitCheckStream = null;
  fitCheckCaptureBtn.disabled = true;
  fitCheckCaptureBtn.textContent = "Starting camera…";

  try {
    const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
    if (fitCheckPanel.hidden) {
      stream.getTracks().forEach((track) => track.stop()); // closed while starting
      return;
    }
    fitCheckStream = stream;
    enableContinuousAutoAdjust(stream);

    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.width = "100%";
    videoEl.style.height = "100%";
    videoEl.style.objectFit = "cover";
    videoEl.srcObject = stream;
    fitCheckPublisherEl.innerHTML = "";
    fitCheckPublisherEl.classList.toggle("mirrored", cameraFacing === "user");
    fitCheckPublisherEl.appendChild(videoEl);

    // Only offer the switch on devices with more than one camera (labels and
    // the full list are only available once access is granted).
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => (flipBtn.hidden = devices.filter((d) => d.kind === "videoinput").length < 2))
      .catch(() => {});

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

const flipBtn = document.getElementById("fitCheckFlip");
flipBtn.addEventListener("click", () => {
  if (countdownInterval !== null) return;
  cameraFacing = cameraFacing === "user" ? "environment" : "user";
  fitCheckResultEl.hidden = true;
  startCameraStream();
});

function openFitCheck(city, year) {
  track("fit_check_opened", { mode: "city" });
  return openCamera(`Fit Check — ${city} ${year}`, { city, year });
}

function openCityMatch() {
  track("fit_check_opened", { mode: "city-match" });
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

// The photo is taken from the camera's full-resolution frame, then scaled
// down to at most 1600px on its long side: still sharper than anything Gemini
// or the 1080px share card uses, without uploading a 4K image over mobile data.
const PHOTO_MAX_EDGE = 1600;

function captureFrame(videoEl) {
  const { videoWidth: w, videoHeight: h } = videoEl;
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function captureAndScore() {
  const videoEl = fitCheckPublisherEl.querySelector("video");
  if (!videoEl?.videoWidth) return; // camera closed or stopped mid-countdown
  flashCamera();
  const mode = fitCheckContext.mode === "city-match" ? "city-match" : "city";
  track("photo_captured", { mode, timer: captureTimer });

  const photoDataUrl = captureFrame(videoEl);

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
    track("fit_check_result", { city: MARKERS.find((m) => m.label === city)?.id });
    const marker = MARKERS.find((m) => m.label === city);
    lastFitResult = {
      mode: "city",
      photoDataUrl,
      pct: fitScore,
      accent,
      city,
      cityId: marker?.id,
      lat: marker?.lat ?? 0,
      lng: marker?.lng ?? 0,
      style: closestStyle,
      verdict,
      items: [],
      challenge: null,
      stamp: null,
    };

    const closest = closestStyle ? `<p class="fit-closest">Closest to ${city} ${closestStyle.toLowerCase()}</p>` : "";
    fitCheckResultEl.innerHTML = `
      <div class="fit-score-badge" style="background: ${scoreGradient(fitScore)}">
        <span class="fit-score-num">${formatScore(fitScore)}</span><span class="fit-score-max">/10</span>
      </div>
      <h4 class="fit-verdict" style="color: ${accent}">${verdict}</h4>
      ${closest}
      <p class="fit-reasoning">${reasoning}</p>
      <button class="share-fit-btn">Share</button>
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

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A friend's challenge from a shared link (?c=yyz.88&n=Herman), if any. It
// stays active for the visit, so every result is shown next to theirs.
let activeChallenge = readChallenge(MARKERS);
let challengeCompleted = false;

function vsTilesHtml(mine) {
  const c = activeChallenge;
  const theirs = `<div class="vs-tile">
      <span class="vs-who">${escapeHtml(c.name || "Your friend")}</span>
      <span class="vs-pct" style="color: ${scoreAccent(c.pct)}">${formatScore(c.pct)}<small>/10</small></span>
      <span class="vs-city">${escapeHtml(c.city)}</span>
    </div>`;
  const yours = mine
    ? `<div class="vs-tile vs-mine" style="background-image: linear-gradient(rgba(43,36,26,0.15), rgba(43,36,26,0.7)), url('${mine.photoDataUrl}')">
        <span class="vs-who">You</span>
        <span class="vs-pct" style="color: #fff">${formatScore(mine.pct)}<small>/10</small></span>
        <span class="vs-city">${escapeHtml(mine.city)}</span>
      </div>`
    : `<div class="vs-tile vs-empty">you?</div>`;
  return `<div class="vs-tiles">${theirs}${yours}</div>`;
}

function showChallenge() {
  const c = activeChallenge;
  const who = c.name ? `${escapeHtml(c.name)}'s` : "A friend's";
  track("challenge_opened", { city: c.cityId });
  highlightCity(c.cityId);
  flyToLocation(c.lat, c.lng, homeZ * 0.75);
  cityMatchCard.innerHTML = `
    <div class="match-body">
      <button class="popup-close" data-action="close" aria-label="Close">×</button>
      <p class="match-eyebrow">${c.name ? `${escapeHtml(c.name)} challenged you` : "You've been challenged"}</p>
      <h2 class="challenge-headline">${who} fit scored ${formatScore(c.pct)}/10 for ${escapeHtml(c.city)}. What's yours?</h2>
      ${vsTilesHtml(null)}
    </div>
    <div class="match-actions match-actions-stack">
      <button class="share-fit-btn" data-action="retry">Check my fit</button>
      <p class="match-note">No sign-up. Your photo is only used for the match.</p>
    </div>
  `;
  cityMatchCard.hidden = false;
}

function showCityMatch(data, photoDataUrl) {
  const [best, ...others] = data.matches;
  track("city_match_result", { city: best.id });
  if (activeChallenge && !challengeCompleted) {
    challengeCompleted = true;
    track("challenge_completed", { city: activeChallenge.cityId });
  }
  highlightCity(best.id);
  flyToLocation(best.lat, best.lng, homeZ * 0.75);
  stampPassport(best.id, best.matchPercent);

  lastFitResult = {
    mode: "city-match",
    photoDataUrl,
    pct: best.matchPercent,
    accent: scoreAccent(best.matchPercent),
    city: best.city,
    cityId: best.id,
    lat: best.lat,
    lng: best.lng,
    style: best.closestStyle,
    verdict: data.verdict,
    items: data.items ?? [],
    challenge: activeChallenge && { name: activeChallenge.name, pct: activeChallenge.pct, city: activeChallenge.city },
    stamp: { count: passportSummary().cities.get(best.id)?.count ?? 1 },
  };

  cityMatchCard.innerHTML = `
    <div class="match-body">
    <button class="popup-close" data-action="close" aria-label="Close">×</button>
    <p class="match-eyebrow">Your city match</p>
    <h2 class="match-headline">
      <span class="match-pct" style="color: ${scoreAccent(best.matchPercent)}">${formatScore(best.matchPercent)}<small class="match-out-of">/10</small></span> ${best.city}
    </h2>
    ${activeChallenge ? vsTilesHtml(lastFitResult) : ""}
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
                   <span class="runner-pct">${formatScore(m.matchPercent)}</span>
                 </button></li>`
               )
               .join("")}
           </ul>`
        : ""
    }
    </div>
    <div class="match-actions">
      <button class="share-fit-btn" data-action="share">${activeChallenge ? "Share back" : "Share"}</button>
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
    if (lastFitResult) openShareSheet(lastFitResult);
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

if (activeChallenge) {
  clearChallengeFromUrl();
  showChallenge();
}

// --- Sharing: the Share buttons open the share sheet (share-sheet.js) with
// the current result. ---
fitCheckResultEl.addEventListener("click", (e) => {
  if (e.target.closest(".share-fit-btn") && lastFitResult) openShareSheet(lastFitResult);
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
