// --- Tab navigation ---
const tabs = document.querySelectorAll("nav button");
const sections = document.querySelectorAll("main section");
tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabs.forEach((b) => b.classList.remove("active"));
    sections.forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// --- Wardrobe ---
const photoInput = document.getElementById("photoInput");
const uploadStatus = document.getElementById("uploadStatus");
const wardrobeGrid = document.getElementById("wardrobeGrid");
const itemCount = document.getElementById("itemCount");

async function loadWardrobe() {
  const res = await fetch("/api/wardrobe");
  const items = await res.json();
  itemCount.textContent = items.length;
  wardrobeGrid.innerHTML = items
    .map(
      (item) => `
      <div class="item" data-id="${item.id}">
        <button class="remove" title="Remove">×</button>
        <img src="${item.imageUrl}" alt="${item.name}" />
        <div class="meta">
          <strong>${item.name}</strong>
          <div class="tags">
            <span class="tag">${item.category}</span>
            ${(item.styleTags || []).map((t) => `<span class="tag">${t}</span>`).join("")}
          </div>
        </div>
      </div>`
    )
    .join("");

  wardrobeGrid.querySelectorAll(".remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".item").dataset.id;
      await fetch(`/api/wardrobe/${id}`, { method: "DELETE" });
      loadWardrobe();
    });
  });
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) return;
  uploadStatus.textContent = "Analyzing with Gemini…";
  const form = new FormData();
  form.append("photo", file);
  try {
    const res = await fetch("/api/wardrobe", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
    uploadStatus.textContent = "Added!";
    photoInput.value = "";
    loadWardrobe();
  } catch (err) {
    uploadStatus.textContent = `Error: ${err.message}`;
  }
});

loadWardrobe();

// --- Stylist ---
const stylistBtn = document.getElementById("stylistBtn");
const stylistRequest = document.getElementById("stylistRequest");
const stylistResult = document.getElementById("stylistResult");

stylistBtn.addEventListener("click", async () => {
  const request = stylistRequest.value.trim();
  if (!request) return;
  stylistBtn.disabled = true;
  stylistResult.style.display = "block";
  stylistResult.innerHTML = "Thinking about your wardrobe…";
  try {
    const res = await fetch("/api/outfit/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    stylistResult.innerHTML = `
      <h3>${data.outfitName || "Your outfit"}</h3>
      <p>${data.stylingNotes || ""}</p>
      <div class="grid">
        ${(data.items || [])
          .map(
            (item) => `<div class="item"><img src="${item.imageUrl}" alt="${item.name}" />
              <div class="meta"><strong>${item.name}</strong></div></div>`
          )
          .join("")}
      </div>`;
  } catch (err) {
    stylistResult.innerHTML = `<span class="muted">Error: ${err.message}</span>`;
  } finally {
    stylistBtn.disabled = false;
  }
});

// --- Outfit rating bot ---
const rateInput = document.getElementById("rateInput");
const rateResult = document.getElementById("rateResult");

rateInput.addEventListener("change", async () => {
  const file = rateInput.files[0];
  if (!file) return;
  rateResult.style.display = "block";
  rateResult.innerHTML = "Judging your fit…";
  const form = new FormData();
  form.append("photo", file);
  try {
    const res = await fetch("/api/outfit/rate", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    rateResult.innerHTML = `
      <h3>${data.score}/10 — ${data.vibe}</h3>
      <p><em>${data.oneLiner}</em></p>
      <p><strong>Working:</strong> ${(data.highlights || []).join(", ")}</p>
      <p><strong>Try:</strong> ${(data.suggestions || []).join(", ")}</p>`;
  } catch (err) {
    rateResult.innerHTML = `<span class="muted">Error: ${err.message}</span>`;
  }
});

// --- Live video session (Vonage Video API) ---
const startSessionBtn = document.getElementById("startSessionBtn");
const videoStatus = document.getElementById("videoStatus");

startSessionBtn.addEventListener("click", async () => {
  startSessionBtn.disabled = true;
  videoStatus.textContent = "Starting session…";
  try {
    const res = await fetch("/api/video/session", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // OT is provided by the Vonage Video (OpenTok) client SDK loaded in index.html.
    const session = OT.initSession(data.applicationId, data.sessionId);
    const publisher = OT.initPublisher("publisher");

    session.on("streamCreated", (event) => {
      session.subscribe(event.stream, "subscribers", { insertMode: "append" });
    });

    session.connect(data.token, (err) => {
      if (err) {
        videoStatus.textContent = `Connect error: ${err.message}`;
        return;
      }
      session.publish(publisher);
      videoStatus.textContent = `Live! Session: ${data.sessionId}`;
    });
  } catch (err) {
    videoStatus.textContent = `Error: ${err.message}`;
  } finally {
    startSessionBtn.disabled = false;
  }
});
