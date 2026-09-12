// Phase 1: a spinnable globe on a beige backdrop. Region clicks + popular-
// clothing popups land in a later pass — this just establishes the globe as
// Project Snap's main interface.
const GLOBE_COLOR = "#cdba90";
const ATMOSPHERE_COLOR = "#f4ead2";
const GRID_LINE_COLOR = "#6b5842";
const GRID_LINE_OPACITY = 0.55;

const globe = Globe()(document.getElementById("globeViz"))
  .backgroundColor("rgba(0,0,0,0)")
  .showGlobe(true)
  .showGraticules(true)
  .showAtmosphere(true)
  .atmosphereColor(ATMOSPHERE_COLOR)
  .atmosphereAltitude(0.2)
  .width(window.innerWidth)
  .height(window.innerHeight);

globe.globeMaterial().color.set(GLOBE_COLOR);
globe.globeMaterial().shininess = 2;

// globe.gl draws the lat/long grid at a fixed lightgrey/0.1 opacity with no
// public option to restyle it, so we reach into the underlying Three.js
// scene and recolor that mesh directly to make spinning visibly obvious.
// The graticule mesh is added to the scene asynchronously (after
// construction, and not covered by onGlobeReady), so poll briefly for it.
function styleGraticules() {
  let found = false;
  globe.scene().traverse((obj) => {
    if (obj.type === "LineSegments" && obj.material?.color) {
      obj.material.color.set(GRID_LINE_COLOR);
      obj.material.opacity = GRID_LINE_OPACITY;
      obj.material.transparent = true;
      found = true;
    }
  });
  return found;
}

(function waitForGraticules(attemptsLeft = 50) {
  if (styleGraticules() || attemptsLeft <= 0) return;
  requestAnimationFrame(() => waitForGraticules(attemptsLeft - 1));
})();

const controls = globe.controls();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;
controls.enableZoom = true;

window.addEventListener("resize", () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});
