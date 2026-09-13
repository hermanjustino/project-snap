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

const MARKERS = [
  { id: "nyc", lat: 40.7128, lng: -74.006, label: "New York" },
  { id: "ldn", lat: 51.5074, lng: -0.1278, label: "London" },
  { id: "par", lat: 48.8566, lng: 2.3522, label: "Paris" },
  { id: "lag", lat: 6.5244, lng: 3.3792, label: "Lagos" },
  { id: "nbo", lat: -1.2921, lng: 36.8219, label: "Nairobi" },
  { id: "tyo", lat: 35.6762, lng: 139.6503, label: "Tokyo" },
  { id: "sha", lat: 31.2304, lng: 121.4737, label: "Shanghai" },
  { id: "syd", lat: -33.8688, lng: 151.2093, label: "Sydney" },
  { id: "rio", lat: -22.9068, lng: -43.1729, label: "Rio de Janeiro" },
  { id: "lax", lat: 34.0522, lng: -118.2437, label: "Los Angeles" },
  { id: "jnb", lat: -26.2041, lng: 28.0473, label: "Johannesburg" },
];

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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 280;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
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
});

let isDragging = false;
let previousPointer = { x: 0, y: 0 };

function onPointerDown(e) {
  isDragging = true;
  previousPointer = { x: e.clientX, y: e.clientY };
}

function updateOverlayTexture() {
  const newTex = generateGlobeTexture(biomeFeatures, hoveredBiomeUid, selectedBiomeUid);
  overlayMaterial.map.dispose();
  overlayMaterial.map = newTex;
  overlayMaterial.needsUpdate = true;
}

function onPointerMove(e) {
  if (isDragging) {
    const deltaX = e.clientX - previousPointer.x;
    const deltaY = e.clientY - previousPointer.y;
    globeGroup.rotation.y += deltaX * 0.005;
    globeGroup.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, globeGroup.rotation.x + deltaY * 0.005));
    previousPointer = { x: e.clientX, y: e.clientY };
    return;
  }

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

function onPointerUp() {
  isDragging = false;
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

function focusOnPoint(lat, lng, targetZ = 150) {
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

  function updateCamera(now) {
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
  const targetPos = new THREE.Vector3(0, 0, 280);
  const duration = 800;
  const startTime = performance.now();

  function updateCamera(now) {
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
    <h3>${marker.label} Fashion Week</h3>
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
  imagesEl.innerHTML = `<p class="muted">Searching ${city} Fashion Week ${year}…</p>`;

  try {
    const res = await fetch(`/api/fashion-week?city=${encodeURIComponent(city)}&year=${encodeURIComponent(year)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");

    if (!data.images?.length) {
      imagesEl.innerHTML = `<p class="muted">No images found for ${city} ${year}.</p>`;
      return;
    }

    imagesEl.innerHTML = data.images
      .map((img) => {
        const alt = img.title || `${city} ${year}`;
        return `<img
          src="${img.thumbnailUrl}"
          data-full="${img.imageUrl}"
          data-source="${img.source || img.imageUrl}"
          alt="${alt}"
          loading="lazy" />`;
      })
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

let fitCheckStream = null;
let fitCheckContext = { city: null, year: null };

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

async function openFitCheck(city, year) {
  fitCheckContext = { city, year };
  fitCheckTitle.textContent = `Fit Check — ${city} ${year}`;
  fitCheckResultEl.hidden = true;
  fitCheckResultEl.innerHTML = "";
  fitCheckCaptureBtn.disabled = true;
  fitCheckCaptureBtn.textContent = "Starting camera…";
  fitCheckPanel.hidden = false;
  popupEl.hidden = true; // step out of the way while the camera is up

  try {
    fitCheckStream = await navigator.mediaDevices.getUserMedia({ video: true });

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

    fitCheckCaptureBtn.disabled = false;
    fitCheckCaptureBtn.textContent = "📸 Capture & Score";
  } catch (err) {
    fitCheckResultEl.hidden = false;
    fitCheckResultEl.innerHTML = `<p class="muted">Couldn't access your camera: ${err.message}</p>`;
  }
}

function closeFitCheck() {
  fitCheckPanel.hidden = true;
  fitCheckStream?.getTracks().forEach((track) => track.stop());
  fitCheckStream = null;
  fitCheckPublisherEl.innerHTML = "";
}

async function openRegionFitCheck(regionName) {
  fitCheckContext = { region: regionName };
  fitCheckTitle.textContent = `Fit Check — ${regionName}`;
  fitCheckResultEl.hidden = true;
  fitCheckResultEl.innerHTML = "";
  fitCheckCaptureBtn.disabled = true;
  fitCheckCaptureBtn.textContent = "Starting camera…";
  fitCheckPanel.hidden = false;
  popupEl.hidden = true;

  try {
    fitCheckStream = await navigator.mediaDevices.getUserMedia({ video: true });

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

    fitCheckCaptureBtn.disabled = false;
    fitCheckCaptureBtn.textContent = "📸 Capture & Score";
  } catch (err) {
    fitCheckResultEl.hidden = false;
    fitCheckResultEl.innerHTML = `<p class="muted">Couldn't access your camera: ${err.message}</p>`;
  }
}


fitCheckCloseBtn.addEventListener("click", closeFitCheck);

fitCheckCaptureBtn.addEventListener("click", async () => {
  const videoEl = fitCheckPublisherEl.querySelector("video");
  if (!videoEl) return;

  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth || 640;
  canvas.height = videoEl.videoHeight || 480;
  canvas.getContext("2d").drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const photoDataUrl = canvas.toDataURL("image/jpeg", 0.85);

  fitCheckResultEl.hidden = false;
  
  let url = "/api/outfit/fit-check";
  const form = new FormData();
  form.append("photo", dataUrlToBlob(photoDataUrl), "fit.jpg");

  if (fitCheckContext.region) {
    fitCheckResultEl.innerHTML = `<p class="muted">Assessing your outfit for the ${fitCheckContext.region} region…</p>`;
    form.append("context", `Assess this outfit for suitability in the ${fitCheckContext.region} region. Consider local climate and cultural context.`);
    url = "/api/outfit/rate";
  } else {
    fitCheckResultEl.innerHTML = `<p class="muted">Scoring your fit against ${fitCheckContext.city} Fashion Week ${fitCheckContext.year}…</p>`;
    form.append("city", fitCheckContext.city);
    form.append("year", fitCheckContext.year);
  }

  fitCheckCaptureBtn.disabled = true;

  try {
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Fit check failed");

    if (fitCheckContext.region) {
       fitCheckResultEl.innerHTML = `
        <h3>${data.score}/10 — ${data.vibe}</h3>
        <p><em>${data.oneLiner}</em></p>
        <p><strong>Working:</strong> ${(data.highlights || []).join(", ")}</p>
        <p><strong>Try:</strong> ${(data.suggestions || []).join(", ")}</p>`;
    } else {
       fitCheckResultEl.innerHTML = `
         <div class="fit-score-badge" style="background: ${scoreGradient(data.fitScore)}">
           <span class="fit-score-num">${data.fitScore}</span><span class="fit-score-max">/100</span>
         </div>
         <h4 class="fit-verdict" style="color: ${scoreAccent(data.fitScore)}">${data.verdict}</h4>
         <p class="fit-reasoning">${data.reasoning}</p>
         <p class="fit-tip">💡 ${data.tip}</p>
       `;
    }
  } catch (err) {
    fitCheckResultEl.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  } finally {
    fitCheckCaptureBtn.disabled = false;
  }
});

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("click", onClick);

let pulseTime = 0;
function animate() {
  requestAnimationFrame(animate);

  pulseTime += 0.03;
  const scale = 1 + (Math.sin(pulseTime) + 1) * 0.5;
  pulsingRings.forEach((ring) => {
    ring.scale.set(scale, scale, scale);
    ring.material.opacity = 0.8 - (scale - 1) * 0.5;
  });

  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById("zoomIn")?.addEventListener("click", () => {
  camera.position.z = Math.max(140, camera.position.z - 30);
});
document.getElementById("zoomOut")?.addEventListener("click", () => {
  camera.position.z = Math.min(400, camera.position.z + 30);
});
document.getElementById("resetView")?.addEventListener("click", () => {
  globeGroup.rotation.set(0, 0, 0);
  camera.position.z = 280;
});
