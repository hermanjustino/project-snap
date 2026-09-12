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

// --- Wardrobe storage: lives entirely in this browser (localStorage) so
// concurrent visitors at the hackathon each get their own private closet
// instead of sharing one on the server. ---
const WARDROBE_KEY = "projectSnap:wardrobe";

function getWardrobe() {
  try {
    return JSON.parse(localStorage.getItem(WARDROBE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveWardrobe(items) {
  try {
    localStorage.setItem(WARDROBE_KEY, JSON.stringify(items));
    return true;
  } catch (err) {
    console.error("[wardrobe] localStorage save failed", err);
    return false;
  }
}

// Downscale + JPEG-compress a photo client-side before it ever leaves the
// device: keeps the analyze request small and keeps localStorage (which
// has a small quota, usually 5-10MB per browser) from filling up after a
// handful of phone photos.
function resizeImageToDataUrl(file, maxDim = 720, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// --- Wardrobe UI ---
const photoInput = document.getElementById("photoInput");
const uploadStatus = document.getElementById("uploadStatus");
const wardrobeGrid = document.getElementById("wardrobeGrid");
const itemCount = document.getElementById("itemCount");

function renderWardrobe() {
  const items = getWardrobe();
  itemCount.textContent = items.length;
  wardrobeGrid.innerHTML = items
    .map(
      (item) => `
      <div class="item" data-id="${item.id}">
        <button class="remove" title="Remove">×</button>
        <img src="${item.imageDataUrl}" alt="${item.name}" />
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
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".item").dataset.id;
      saveWardrobe(getWardrobe().filter((i) => i.id !== id));
      renderWardrobe();
    });
  });
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) return;
  uploadStatus.textContent = "Analyzing with Gemini…";
  try {
    const imageDataUrl = await resizeImageToDataUrl(file);
    const form = new FormData();
    form.append("photo", dataUrlToBlob(imageDataUrl), "garment.jpg");

    const res = await fetch("/api/wardrobe/analyze", { method: "POST", body: form });
    const metadata = await res.json();
    if (!res.ok) throw new Error(metadata.error || "Analyze failed");

    const item = { id: newId(), imageDataUrl, addedAt: new Date().toISOString(), ...metadata };
    const items = getWardrobe();
    items.push(item);
    const saved = saveWardrobe(items);

    uploadStatus.textContent = saved
      ? "Added!"
      : "Added, but this browser's storage is full — remove an older item to keep adding.";
    photoInput.value = "";
    renderWardrobe();
  } catch (err) {
    uploadStatus.textContent = `Error: ${err.message}`;
  }
});

renderWardrobe();

// --- Stylist ---
const stylistBtn = document.getElementById("stylistBtn");
const stylistRequest = document.getElementById("stylistRequest");
const stylistResult = document.getElementById("stylistResult");

stylistBtn.addEventListener("click", async () => {
  const request = stylistRequest.value.trim();
  if (!request) return;

  const wardrobe = getWardrobe();
  stylistResult.style.display = "block";
  if (wardrobe.length === 0) {
    stylistResult.innerHTML = `<span class="muted">Add some wardrobe items first.</span>`;
    return;
  }

  stylistBtn.disabled = true;
  stylistResult.innerHTML = "Thinking about your wardrobe…";
  try {
    const catalog = wardrobe.map(({ id, category, name, colors, styleTags, season }) => ({
      id,
      category,
      name,
      colors,
      styleTags,
      season,
    }));

    const res = await fetch("/api/outfit/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request, wardrobe: catalog }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const items = wardrobe.filter((i) => data.itemIds?.includes(i.id));
    stylistResult.innerHTML = `
      <h3>${data.outfitName || "Your outfit"}</h3>
      <p>${data.stylingNotes || ""}</p>
      <div class="grid">
        ${items
          .map(
            (item) => `<div class="item"><img src="${item.imageDataUrl}" alt="${item.name}" />
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

// --- Biome preparedness bot ---
const biomeInput = document.getElementById("biomeInput");
const biomeResult = document.getElementById("biomeResult");

biomeInput.addEventListener("change", async () => {
  const file = biomeInput.files[0];
  if (!file) return;
  biomeResult.style.display = "block";
  biomeResult.innerHTML = "Assessing your preparedness for extreme biomes…";
  
  try {
    const imageDataUrl = await resizeImageToDataUrl(file);
    const form = new FormData();
    form.append("photo", dataUrlToBlob(imageDataUrl), "fit.jpg");
    // Request specifically for desert and rainforest safety context
    form.append("context", "Assess this outfit for survival and safety in both arid desert and tropical rainforest environments. Focus on UV protection, heat management, insect protection, and moisture management.");

    const res = await fetch("/api/outfit/rate", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    biomeResult.innerHTML = `
      <h3>${data.score}/10 — ${data.vibe}</h3>
      <p><em>${data.oneLiner}</em></p>
      <p><strong>Environment Fit:</strong> ${(data.highlights || []).join(", ")}</p>
      <p><strong>Safety Gaps:</strong> ${(data.suggestions || []).join(", ")}</p>`;
  } catch (err) {
    biomeResult.innerHTML = `<span class="muted">Error: ${err.message}</span>`;
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
