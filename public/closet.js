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
