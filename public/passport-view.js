// Shows the fit passport on the My Closet page: a stamp for each city a Fit
// Check has matched, and a locked one for each city still to collect.
import { passportSummary } from "./passport.js";

const COLORS = ["#e0a48f", "#c9b894", "#9cc7a8", "#d8b46a", "#b9a8d6"];
const el = document.getElementById("passport");
const cities = await fetch("/data/cities.json").then((res) => res.json());
const { checks, cities: stamps } = passportSummary();

// The same city always gets the same color, shape and tilt.
function looks(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { color: COLORS[hash % COLORS.length], round: hash % 3 === 0, tilt: (hash % 17) - 8 };
}

const SHOW_LOCKED = 3; // a few locked stamps hint at what's left, without a wall of them
const collected = [...stamps.entries()].sort((a, b) => b[1].count - a[1].count);
const locked = cities.filter((c) => !stamps.has(c.id));
const label = (id) => cities.find((c) => c.id === id)?.label ?? id;

el.querySelector(".passport-summary").innerHTML = checks
  ? `${stamps.size} of ${cities.length} cities · ${checks} check${checks === 1 ? "" : "s"}`
  : `No stamps yet. <a href="/">Do a Fit Check</a> to stamp your first city.`;

el.querySelector(".stamps").innerHTML = [
  ...collected.map(([id, s]) => {
    const { color, round, tilt } = looks(id);
    return `<div class="stamp${round ? " round" : ""}" style="color: ${color}; --tilt: ${tilt}deg">
      <strong>${label(id)}</strong>
      <span>×${s.count} · best ${s.best}%</span>
    </div>`;
  }),
  ...locked.slice(0, SHOW_LOCKED).map(({ id }) => {
    const { round, tilt } = looks(id);
    return `<div class="stamp locked${round ? " round" : ""}" style="--tilt: ${tilt}deg"><span>? locked</span></div>`;
  }),
].join("");

const hidden = locked.length - SHOW_LOCKED;
if (hidden > 0) {
  el.querySelector(".stamps").insertAdjacentHTML(
    "afterend",
    `<p class="passport-more">+${hidden} more cities to unlock</p>`
  );
}
