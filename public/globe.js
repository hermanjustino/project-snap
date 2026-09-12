// Phase 2 of the globe: ported from a raw Three.js component (React/Next.js
// removed — hooks/JSX/Tailwind/lucide-react stripped out, but the actual
// scene/texture/interaction logic is framework-agnostic and kept as-is).
// Recolored from the original's dark slate/blue theme to Project Snap's
// beige palette. Grid + land are baked into a canvas texture instead of
// drawn as separate scene objects, which sidesteps the async-scene-graph
// timing issue we hit with the previous globe.gl-based graticule fix.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const GLOBE_RADIUS = 80;
const OCEAN_COLOR = "#cdba90";
const GRID_COLOR = "rgba(107, 88, 66, 0.35)";
const LAND_COLOR = "#b7a179";
const LAND_STROKE = "#6b5842";
const ATMOSPHERE_COLOR = 0xf4ead2;
const MARKER_COLOR = "#a8452b";

// Placeholder fashion-capital markers. Real per-region "popular clothing"
// data is a later pass — for now this just proves the click-a-region-for-a-
// popup mechanism end to end.
const MARKERS = [
  { id: "nyc", lat: 40.7128, lng: -74.006, label: "New York" },
  { id: "ldn", lat: 51.5074, lng: -0.1278, label: "London" },
  { id: "tyo", lat: 35.6762, lng: 139.6503, label: "Tokyo" },
  { id: "par", lat: 48.8566, lng: 2.3522, label: "Paris" },
];

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

function generateGlobeTexture(landFeatures) {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = OCEAN_COLOR;
  ctx.fillRect(0, 0, width, height);

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
    ctx.fillStyle = LAND_COLOR;
    ctx.strokeStyle = LAND_STROKE;
    ctx.lineWidth = 1.5;

    const projectCoords = ([lng, lat]) => [((lng + 180) / 360) * width, ((90 - lat) / 180) * height];

    landFeatures.features.forEach((feature) => {
      const geometry = feature.geometry;
      if (!geometry) return;
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

const sphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
const initialTexture = generateGlobeTexture();
const sphereMaterial = new THREE.MeshPhongMaterial({ map: initialTexture, shininess: 8 });
const globeMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
globeGroup.add(globeMesh);

const atmosphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS + 3, 64, 64);
const atmosphereMaterial = new THREE.MeshBasicMaterial({
  color: ATMOSPHERE_COLOR,
  transparent: true,
  opacity: 0.25,
  side: THREE.BackSide,
});
globeGroup.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

// Optional real landmass outlines — falls back to grid-only if the file
// isn't present yet (a later "piece by piece" step can drop this file in).
fetch("/data/ne_50m_land.json")
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error("no local land data yet"))))
  .then((landData) => {
    const updatedTexture = generateGlobeTexture(landData);
    sphereMaterial.map.dispose();
    sphereMaterial.map = updatedTexture;
    sphereMaterial.needsUpdate = true;
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

function onPointerMove(e) {
  if (isDragging) {
    const deltaX = e.clientX - previousPointer.x;
    const deltaY = e.clientY - previousPointer.y;
    globeGroup.rotation.y += deltaX * 0.005;
    globeGroup.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, globeGroup.rotation.x + deltaY * 0.005));
    previousPointer = { x: e.clientX, y: e.clientY };
    return;
  }

  const hit = raycastMarkers(e);
  if (hit) {
    tooltipEl.textContent = hit.userData.marker.label;
    tooltipEl.style.left = `${e.clientX + 14}px`;
    tooltipEl.style.top = `${e.clientY + 14}px`;
    tooltipEl.hidden = false;
  } else {
    tooltipEl.hidden = true;
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

function onClick(e) {
  const hit = raycastMarkers(e);
  if (!hit) return;
  showRegionPopup(hit.userData.marker);
}

function showRegionPopup(marker) {
  popupEl.innerHTML = `
    <button class="popup-close" aria-label="Close">×</button>
    <h3>${marker.label}</h3>
    <p>Popular styles here — coming soon.</p>
  `;
  popupEl.hidden = false;
  popupEl.querySelector(".popup-close").addEventListener("click", () => {
    popupEl.hidden = true;
  });
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("click", onClick);

let pulseTime = 0;
function animate() {
  requestAnimationFrame(animate);

  if (!isDragging) globeGroup.rotation.y += 0.0015;

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
