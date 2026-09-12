// Phase 2 of the globe: ported from a raw Three.js component (React/Next.js
// removed — hooks/JSX/Tailwind/lucide-react stripped out, but the actual
// scene/texture/interaction logic is framework-agnostic and kept as-is).
// Recolored from the original's dark slate/blue theme to Project Snap's
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
];

const DEFAULT_YEAR = 2020;
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

function focusOnPoint(lat, lng, targetZ = 160) {
  const pos = latLngToVector3(lat, lng, GLOBE_RADIUS, 80);
  
  // Simple linear transition for camera position
  const startPos = camera.position.clone();
  const duration = 1000;
  const startTime = performance.now();

  function updateCamera(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    
    // Ease out cubic
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

function showBiomePopup(feature) {
  // Use the first coordinate of the polygon as a focal point
  const coords = feature.geometry.type === "Polygon" ? feature.geometry.coordinates[0][0] : feature.geometry.coordinates[0][0][0];
  focusOnPoint(coords[1], coords[0]);

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

function showRegionPopup(marker) {
  focusOnPoint(marker.lat, marker.lng);
  popupEl.innerHTML = `
    <button class="popup-close" aria-label="Close">×</button>
    <h3>${marker.label} Fashion Week</h3>
    <select class="popup-year" aria-label="Year">${yearOptionsHtml(DEFAULT_YEAR)}</select>
    <div class="popup-images"><p class="muted">Loading…</p></div>
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
  if (!img) return;
  openLightbox(img.dataset.full, img.dataset.source, img.alt);
});

lightboxEl.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
lightboxEl.addEventListener("click", (e) => {
  if (e.target === lightboxEl) closeLightbox(); // backdrop click
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightboxEl.hidden) closeLightbox();
});

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("click", onClick);

let pulseTime = 0;
function animate() {
  requestAnimationFrame(animate);

  // Stop auto-rotation if a popup is active
  if (!isDragging && popupEl.hidden) {
    globeGroup.rotation.y += 0.0015;
  }

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
