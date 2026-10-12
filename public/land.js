// Continent outlines shared by the 3D globe and the reveal video's globe:
// Natural Earth 1:110m land (public domain, via the world-atlas package),
// stored as one GeoJSON MultiPolygon in [lng, lat].
export const LAND_URL = "/data/land.json";

// The skeleton globe's colors.
export const SKELETON = {
  sphereColor: 0xf1e6cc,
  oceanColor: "#f1e6cc",
  lineColor: "rgba(107, 88, 66, 0.45)",
  equatorColor: "rgba(168, 69, 43, 0.55)",
  landColor: "#d8c49b",
  coastColor: "rgba(107, 88, 66, 0.7)",
  haloColor: 0xf4ead2,
};

let landPromise = null;
export function loadLand() {
  landPromise ??= fetch(LAND_URL).then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))));
  return landPromise;
}

// Makes a ring's longitudes continuous: a step of more than 180° is the ring
// crossing the 180° line, so the rest of the ring is shifted by 360° to carry
// on past the map edge. A ring that ends up a full turn round (Antarctica,
// which circles the pole) is closed along the pole instead of straight back.
function unwrapRing(ring) {
  let shift = 0;
  let previous = null;
  const out = ring.map(([lng, lat]) => {
    if (previous !== null) {
      const step = lng + shift - previous;
      if (step > 180) shift -= 360;
      else if (step < -180) shift += 360;
    }
    previous = lng + shift;
    return [previous, lat];
  });
  if (shift !== 0) {
    const pole = ring.reduce((sum, [, lat]) => sum + lat, 0) < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
  }
  return out;
}

// Paints latitude/longitude lines every 15° and (once loaded) the continents
// onto an equirectangular canvas (x = longitude from -180, y = latitude from
// 90). The equator is drawn heavier so the globe's orientation reads at a
// glance. Without `ocean` the background stays transparent.
export function paintSurface(canvas, land = null, { ocean = null } = {}) {
  const ctx = canvas.getContext("2d");
  const scale = canvas.width / 2048; // line widths were tuned at 2048px wide
  const step = 15;
  const toX = (lng) => ((lng + 180) / 360) * canvas.width;
  const toY = (lat) => ((90 - lat) / 180) * canvas.height;

  if (ocean) {
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const line = (x1, y1, x2, y2, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * scale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  for (let lng = -180; lng <= 180; lng += step) {
    line(toX(lng), 0, toX(lng), canvas.height, SKELETON.lineColor, 1.5);
  }
  for (let lat = -90 + step; lat < 90; lat += step) {
    const isEquator = lat === 0;
    line(0, toY(lat), canvas.width, toY(lat), isEquator ? SKELETON.equatorColor : SKELETON.lineColor, isEquator ? 3 : 1.5);
  }

  // Land on top of the grid, so the lines only show across the oceans. Each
  // polygon's rings go into one path and fill even-odd, leaving lakes open.
  // Shapes that cross the 180° line (Fiji, eastern Russia, Antarctica) are
  // unwrapped past the map edge and drawn again one map-width over, so the
  // overhang appears on the other side instead of a stripe across the globe.
  const rings = (land?.coordinates ?? []).map((polygon) => polygon.map(unwrapRing));
  for (const shiftLng of [-360, 0, 360]) {
    for (const polygon of rings) {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([lng, lat], i) => {
          const x = toX(lng + shiftLng);
          if (i) ctx.lineTo(x, toY(lat));
          else ctx.moveTo(x, toY(lat));
        });
        ctx.closePath();
      }
      ctx.fillStyle = SKELETON.landColor;
      ctx.fill("evenodd");
      ctx.strokeStyle = SKELETON.coastColor;
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();
    }
  }
  return canvas;
}
