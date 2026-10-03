// Phase 2 of the globe: ported from a raw Three.js component (React/Next.js
// removed — hooks/JSX/Tailwind/lucide-react stripped out, but the actual
// scene/texture/interaction logic is framework-agnostic and kept as-is).
// Recolored from the original's dark slate/blue theme to fitd's
// beige palette. Grid + land are baked into a canvas texture instead of
// drawn as separate scene objects, which sidesteps the async-scene-graph
// timing issue we hit with the previous globe.gl-based graticule fix.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const GLOBE_RADIUS = 80;
const EARTH_TEXTURE_URL = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const GRID_COLOR = "rgba(107, 88, 66, 0.25)";
const LAND_COLOR = "rgba(183, 161, 121, 0.4)";
const LAND_STROKE = "rgba(107, 88, 66, 0.4)";
const DESERT_COLOR = "rgba(227, 213, 184, 0.5)";
const FOREST_COLOR = "rgba(125, 140, 107, 0.5)";
const MARINE_COLOR = "rgba(64, 224, 208, 0.6)"; // Turquoise for reefs
const SAVANNA_COLOR = "rgba(210, 180, 140, 0.6)"; // Tan for grasslands
const WETLAND_COLOR = "rgba(46, 139, 87, 0.6)"; // Sea green for wetlands
const BIOME_HOVER_COLOR = "rgba(255, 165, 0, 0.7)"; // Orange highlight
const ATMOSPHERE_COLOR = 0xf4ead2;
const MARKER_COLOR = "#a8452b";

// Biome clothing advice
const BIOME_ADVICE = {
  desert: {
    title: "Desert Safety",
    advice: "Wear loose, light-colored long sleeves and pants to protect from UV rays and heat stroke. A wide-brimmed hat and polarized sunglasses are essential. Avoid cotton; choose moisture-wicking fabrics."
  },
  forest: {
    title: "Rainforest Safety",
    advice: "Wear breathable, quick-dry clothing treated with permethrin to prevent insect-borne diseases (Malaria/Dengue). Long sleeves and tucked-in pants protect against leeches and thorns. Waterproof boots are a must."
  },
  marine: {
    title: "Marine/Reef Safety",
    advice: "Wear a UPF 50+ rash guard and swim leggings to protect against intense UV reflection and stinging jellyfish. Use reef-safe sunscreen. Sturdy water shoes protect against sharp coral and stonefish."
  },
  savanna: {
    title: "Savanna/Grassland Safety",
    advice: "Wear neutral-colored (khaki, tan, olive) clothing to blend in and avoid attracting tsetse flies (which like dark/bright colors). High-top boots and thick socks protect against ticks and tall grass. Layers are key for temperature shifts."
  },
  wetland: {
    title: "Wetland Safety",
    advice: "Wear waterproof boots and quick-dry, breathable fabrics. High-strength insect repellent and long sleeves are critical to prevent mosquito-borne illnesses. Be cautious of uneven underwater terrain and sharp marsh grasses."
  }
};

let hoveredBiomeUid = null;
let selectedBiomeUid = null;
let biomeFeatures = [];

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

function generateGlobeTexture(landFeatures, hoverUid = null, selectUid = null) {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  // Make the background transparent so the Earth map shows through
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += width / 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += height / 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (landFeatures?.features) {
    const projectCoords = ([lng, lat]) => [((lng + 180) / 360) * width, ((90 - lat) / 180) * height];

    landFeatures.features.forEach((feature) => {
      const geometry = feature.geometry;
      if (!geometry) return;

      const type = (feature.properties?.type || feature.properties?.biome || "").toLowerCase();
      const isBiome = type.includes("desert") || type.includes("forest") || type.includes("marine") || type.includes("grassland") || type.includes("wetland");
      const uid = feature.properties?.name || feature.properties?.code;

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = LAND_STROKE;

      if (isBiome) {
        if (uid === selectUid) {
          ctx.strokeStyle = "#000000"; // Black outline on click
          ctx.lineWidth = 4;
          ctx.fillStyle = BIOME_HOVER_COLOR;
        } else if (uid === hoverUid) {
          ctx.fillStyle = BIOME_HOVER_COLOR; // Orange highlight on hover
        } else {
          ctx.fillStyle = type.includes("desert") ? DESERT_COLOR : 
                          type.includes("forest") ? FOREST_COLOR : 
                          type.includes("marine") ? MARINE_COLOR : 
                          type.includes("grassland") ? SAVANNA_COLOR : WETLAND_COLOR;
        }
      } else {
        ctx.fillStyle = LAND_COLOR;
      }

      const polygons =
        geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];

      polygons.forEach((polygon) => {
        polygon.forEach((ring) => {
          ctx.beginPath();
          ring.forEach((coord, i) => {
            const [x, y] = projectCoords(coord);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      });
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
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

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

const sphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
const sphereMaterial = new THREE.MeshPhongMaterial({
  color: 0xcdba90, // Fallback ocean color if texture fails
  shininess: 8,
});
const globeMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
globeGroup.add(globeMesh);

textureLoader.load(
  EARTH_TEXTURE_URL,
  (texture) => {
    sphereMaterial.map = texture;
    sphereMaterial.color.set(0xffffff); // Clear fallback color
    sphereMaterial.needsUpdate = true;
  },
  undefined,
  (err) => console.error("Error loading Earth texture:", err)
);

const overlayGeometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.2, 64, 64);
const overlayMaterial = new THREE.MeshPhongMaterial({
  map: generateGlobeTexture(),
  transparent: true,
  opacity: 1,
  shininess: 0,
});
const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
globeGroup.add(overlayMesh);

const atmosphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS + 4, 64, 64);
const atmosphereMaterial = new THREE.MeshBasicMaterial({
  color: ATMOSPHERE_COLOR,
  transparent: true,
  opacity: 0.2,
  side: THREE.BackSide,
});
globeGroup.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

// Optional real landmass outlines — falls back to grid-only if the file
// isn't present yet (a later "piece by piece" step can drop this file in).
fetch("/data/world_regions.json")
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error("no local world data yet"))))
  .then((landData) => {
    biomeFeatures = landData;
    const updatedTexture = generateGlobeTexture(landData);
    overlayMaterial.map.dispose();
    overlayMaterial.map = updatedTexture;
    overlayMaterial.needsUpdate = true;
  })
  .catch(() => {
    /* grid-only globe is the expected default for now */
  });

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

// Fly-to animations (focusOnPoint / smoothResetView) bump this token; a newer
// tween or a manual zoom cancels the running one instead of fighting it.
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

function updateOverlayTexture() {
  const newTex = generateGlobeTexture(biomeFeatures, hoveredBiomeUid, selectedBiomeUid);
  overlayMaterial.map.dispose();
  overlayMaterial.map = newTex;
  overlayMaterial.needsUpdate = true;
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

  const markerHit = raycastMarkers(e);
  const biomeHit = raycastBiomes(e);

  if (markerHit) {
    tooltipEl.textContent = markerHit.userData.marker.label;
    tooltipEl.style.left = `${e.clientX + 14}px`;
    tooltipEl.style.top = `${e.clientY + 14}px`;
    tooltipEl.hidden = false;
    document.body.style.cursor = "pointer";
  } else if (biomeHit) {
    const name = biomeHit.properties.name;
    if (hoveredBiomeUid !== name) {
      hoveredBiomeUid = name;
      updateOverlayTexture();
    }
    tooltipEl.textContent = name;
    tooltipEl.style.left = `${e.clientX + 14}px`;
    tooltipEl.style.top = `${e.clientY + 14}px`;
    tooltipEl.hidden = false;
    document.body.style.cursor = "pointer";
  } else {
    tooltipEl.hidden = true;
    document.body.style.cursor = isDragging ? "grabbing" : "grab";
    if (hoveredBiomeUid !== null) {
      hoveredBiomeUid = null;
      updateOverlayTexture();
    }
  }
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

function raycastMarkers(e) {
  const rect = container.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(globeGroup.children).find((i) => i.object.userData?.marker);
  return hit?.object;
}

function raycastBiomes(e) {
  if (!biomeFeatures?.features) return null;
  const rect = container.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObject(overlayMesh);
  if (intersects.length > 0) {
    const uv = intersects[0].uv;
    // Convert UV to Lat/Lng
    const lng = uv.x * 360 - 180;
    const lat = uv.y * 180 - 90;

    // Check which feature contains this point
    return biomeFeatures.features.find((f) => {
      const type = (f.properties?.type || f.properties?.biome || "").toLowerCase();
      if (!type.includes("desert") && !type.includes("forest") && !type.includes("marine") && !type.includes("grassland") && !type.includes("wetland")) return false;
      return isPointInPolygon([lng, lat], f.geometry);
    });
  }
  return null;
}

function isPointInPolygon(point, geometry) {
  const [lng, lat] = point;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const polygon of polygons) {
    const ring = polygon[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function onClick(e) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }

  const markerHit = raycastMarkers(e);
  if (markerHit) {
    showRegionPopup(markerHit.userData.marker);
    return;
  }

  const biomeHit = raycastBiomes(e);
  if (biomeHit) {
    const name = biomeHit.properties.name;
    selectedBiomeUid = name;
    updateOverlayTexture();
    showBiomePopup(biomeHit);
  } else {
    selectedBiomeUid = null;
    updateOverlayTexture();
  }
}

function focusOnPoint(lat, lng, targetZ = Math.max(150, minDistance())) {
  // latLngToVector3 gives a position in the globe's own unrotated local
  // space. The globe can already be rotated from a manual drag, so that
  // local position has to be converted to its actual current world
  // position (via the globe's rotation) — otherwise the camera flies to
  // where the marker WOULD be at zero rotation, causing a visible jump.
  const localPos = latLngToVector3(lat, lng, GLOBE_RADIUS, targetZ - GLOBE_RADIUS);
  const pos = localPos.clone().applyQuaternion(globeGroup.quaternion);

  const startPos = camera.position.clone();
  const duration = 1200;
  const startTime = performance.now();
  zoomTarget = null;
  const tween = ++cameraTween;

  function updateCamera(now) {
    if (tween !== cameraTween) return; // interrupted by a newer tween or a zoom
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const easeT = 1 - Math.pow(1 - t, 3);
    
    camera.position.lerpVectors(startPos, pos, easeT);
    camera.lookAt(0, 0, 0);

    if (t < 1) {
      requestAnimationFrame(updateCamera);
    }
  }
  requestAnimationFrame(updateCamera);
}

function smoothResetView() {
  const startPos = camera.position.clone();
  const targetPos = new THREE.Vector3(0, 0, homeZ);
  const duration = 800;
  const startTime = performance.now();
  zoomTarget = null;
  const tween = ++cameraTween;

  function updateCamera(now) {
    if (tween !== cameraTween) return; // interrupted by a newer tween or a zoom
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const easeT = 1 - Math.pow(1 - t, 3);
    
    camera.position.lerpVectors(startPos, targetPos, easeT);
    camera.lookAt(0, 0, 0);

    if (t < 1) {
      requestAnimationFrame(updateCamera);
    }
  }
  requestAnimationFrame(updateCamera);
}

function getPolygonCentroid(geometry) {
  let latSum = 0, lngSum = 0, count = 0;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  
  polygons.forEach(polygon => {
    polygon[0].forEach(coord => {
      lngSum += coord[0];
      latSum += coord[1];
      count++;
    });
  });
  
  return { lat: latSum / count, lng: lngSum / count };
}

function showBiomePopup(feature) {
  currentPopupFeature = feature;
  const centroid = getPolygonCentroid(feature.geometry);
  focusOnPoint(centroid.lat, centroid.lng);

  const type = (feature.properties?.type || feature.properties?.biome || "").toLowerCase();
  const biomeKey = type.includes("desert") ? "desert" : 
                   type.includes("forest") ? "forest" : 
                   type.includes("marine") ? "marine" : 
                   type.includes("grassland") ? "savanna" : "wetland";
  const info = BIOME_ADVICE[biomeKey];

  popupEl.innerHTML = `
    <button class="popup-close" aria-label="Close">×</button>
    <h3>${feature.properties.name}</h3>
    <p><strong>${info.title}</strong></p>
    <p style="font-size: 0.9rem; margin-top: 0.5rem; line-height: 1.4;">${info.advice}</p>
    <button class="biome-fit-check-btn">📸 Fit Check</button>
  `;
  popupEl.hidden = false;
  popupEl.querySelector(".popup-close").addEventListener("click", () => {
    popupEl.hidden = true;
    selectedBiomeUid = null;
    updateOverlayTexture();
    smoothResetView();
  });
}

function yearOptionsHtml(selectedYear) {
  let options = "";
  for (let year = YEAR_MAX; year >= YEAR_MIN; year--) {
    options += `<option value="${year}"${year === selectedYear ? " selected" : ""}>${year}</option>`;
  }
  return options;
}

let currentPopupMarker = null;
let currentPopupFeature = null;
function showRegionPopup(marker) {
  currentPopupMarker = marker;
  focusOnPoint(marker.lat, marker.lng);
  popupEl.innerHTML = `
    <button class="popup-close" aria-label="Close">×</button>
    <h3>${marker.label} Style</h3>
    <select class="popup-year" aria-label="Year">${yearOptionsHtml(DEFAULT_YEAR)}</select>
    <div class="popup-images"><p class="muted">Loading…</p></div>
    <button class="fit-check-btn">📸 Fit Check</button>
  `;
  popupEl.hidden = false;

  popupEl.querySelector(".popup-close").addEventListener("click", () => {
    popupEl.hidden = true;
    smoothResetView();
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

  if (e.target.closest(".biome-fit-check-btn") && currentPopupFeature) {
    openRegionFitCheck(currentPopupFeature.properties.name);
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
// against: { city, year }, { region }, or { mode: "city-match" }.
async function openCamera(title, context) {
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
    fitCheckCaptureBtn.textContent = "📸 Capture & Score";
  } catch (err) {
    fitCheckResultEl.hidden = false;
    fitCheckResultEl.innerHTML = `<p class="muted">Couldn't access your camera: ${err.message}</p>`;
  }
}

function openFitCheck(city, year) {
  return openCamera(`Fit Check — ${city} ${year}`, { city, year });
}

function openRegionFitCheck(regionName) {
  return openCamera(`Fit Check — ${regionName}`, { region: regionName });
}

function openCityMatch() {
  highlightCity(null);
  return openCamera("Which city matches your fit?", { mode: "city-match" });
}

function closeFitCheck() {
  fitCheckPanel.hidden = true;
  fitCheckStream?.getTracks().forEach((track) => track.stop());
  fitCheckStream = null;
  fitCheckPublisherEl.innerHTML = "";
}

fitCheckCloseBtn.addEventListener("click", closeFitCheck);

fitCheckCaptureBtn.addEventListener("click", async () => {
  const videoEl = fitCheckPublisherEl.querySelector("video");
  if (!videoEl?.videoWidth) return; // camera hasn't produced a frame yet

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

  let url = "/api/outfit/fit-check";
  const form = new FormData();
  form.append("photo", dataUrlToBlob(photoDataUrl), "fit.jpg");

  if (fitCheckContext.region) {
    fitCheckResultEl.innerHTML = `<p class="muted">Assessing your outfit for the ${fitCheckContext.region} region…</p>`;
    form.append("context", `Assess this outfit for suitability in the ${fitCheckContext.region} region. Consider local climate and cultural context.`);
    url = "/api/outfit/rate";
  } else {
    fitCheckResultEl.innerHTML = `<p class="muted">Comparing your fit to ${fitCheckContext.city}'s runway, streetwear, everyday and heritage style…</p>`;
    form.append("city", fitCheckContext.city);
    form.append("year", fitCheckContext.year);
  }

  fitCheckCaptureBtn.disabled = true;

  try {
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Fit check failed");

    if (fitCheckContext.region) {
       lastFitResult = {
         photoDataUrl,
         score: data.score,
         max: 10,
         headline: data.vibe,
         subline: data.oneLiner,
         context: fitCheckContext.region,
         accent: scoreAccent(data.score * 10),
       };
       fitCheckResultEl.innerHTML = `
        <h3>${data.score}/10 — ${data.vibe}</h3>
        <p><em>${data.oneLiner}</em></p>
        <p><strong>Working:</strong> ${(data.highlights || []).join(", ")}</p>
        <p><strong>Try:</strong> ${(data.suggestions || []).join(", ")}</p>`;
    } else {
       lastFitResult = {
         photoDataUrl,
         score: data.fitScore,
         max: 100,
         headline: data.verdict,
         subline: data.tip,
         context: data.closestStyle ? `${fitCheckContext.city} ${data.closestStyle}` : fitCheckContext.city,
         accent: scoreAccent(data.fitScore),
       };
       fitCheckResultEl.innerHTML = `
         <div class="fit-score-badge" style="background: ${scoreGradient(data.fitScore)}">
           <span class="fit-score-num">${data.fitScore}</span><span class="fit-score-max">/100</span>
         </div>
         <h4 class="fit-verdict" style="color: ${scoreAccent(data.fitScore)}">${data.verdict}</h4>
         ${data.closestStyle ? `<p class="fit-closest">Closest to ${fitCheckContext.city} ${data.closestStyle.toLowerCase()}</p>` : ""}
         <p class="fit-reasoning">${data.reasoning}</p>
         <p class="fit-tip">💡 ${data.tip}</p>
       `;
    }
    fitCheckResultEl.insertAdjacentHTML(
      "beforeend",
      `<button class="share-fit-btn">${canShareFiles() ? "📤 Share" : "⬇️ Save image"}</button>`
    );
  } catch (err) {
    fitCheckResultEl.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  } finally {
    fitCheckCaptureBtn.disabled = false;
  }
});

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
  focusOnPoint(best.lat, best.lng, homeZ * 0.75);

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
    <button class="popup-close" data-action="close" aria-label="Close">×</button>
    <p class="match-eyebrow">Your fit is</p>
    <h2 class="match-headline">
      <span class="match-pct" style="color: ${scoreAccent(best.matchPercent)}">${best.matchPercent}%</span> ${best.city}
    </h2>
    <p class="fit-closest">Closest to ${best.city} ${String(best.closestStyle).toLowerCase()}</p>
    <p class="match-verdict">${data.verdict}</p>
    <p class="fit-reasoning">${best.reasoning}</p>
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
    <p class="fit-tip">💡 ${data.tip}</p>
    <div class="match-actions">
      <button class="share-fit-btn" data-action="share">${canShareFiles() ? "📤 Share" : "⬇️ Save image"}</button>
      <div class="match-actions-row">
        <button data-action="explore" data-city="${best.id}">Explore ${best.city}</button>
        <button data-action="retry">Try again</button>
      </div>
    </div>
  `;
  cityMatchCard.hidden = false;
  cityMatchCard.scrollTop = 0;
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
    smoothResetView();
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
  ctx.fillText("📸 thefitd.com", PAD, H - PAD);

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
  smoothResetView();
});
