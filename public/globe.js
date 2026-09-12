// Phase 1: a spinnable globe on a beige backdrop. Region clicks + popular-
// clothing popups land in a later pass — this just establishes the globe as
// Project Snap's main interface.
const GLOBE_COLOR = "#cdba90";
const ATMOSPHERE_COLOR = "#f4ead2";

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

const controls = globe.controls();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;
controls.enableZoom = true;

window.addEventListener("resize", () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});
