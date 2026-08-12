import { elements } from "./dom.js";
import { state } from "./state.js";
import { analyzeImage } from "./api.js";
import { klangAktivieren } from "./klang.js";
import { t } from "./i18n.js";

const DEMO_IMAGES = {
  selfie: "./img/demo/demo-selfie.jpg?v=2026081204",
  cafe: "./img/demo/demo-cafe.jpg?v=2026081204",
  hiker: "./img/demo/demo-hiker.jpg?v=2026081204",
};

export function initDemo() {
  document.querySelectorAll(".demo-thumb[data-demo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      /* v3.0: Klang-Aktivierung direkt in der Klick-Geste — nach dem ersten
         `await` wäre die Nutzer-Aktivierung für den AudioContext verfallen. */
      klangAktivieren();
      const key = btn.dataset.demo;
      if (key && DEMO_IMAGES[key]) loadDemoImage(DEMO_IMAGES[key], key);
    });
  });
}

async function loadDemoImage(url, name) {
  if (state.currentAbortController) {
    state.currentAbortController.abort();
    state.currentAbortController = null;
  }
  state.isAnalyzing = false;

  if (state.geocodeAbortController) {
    state.geocodeAbortController.abort();
    state.geocodeAbortController = null;
  }
  state.pendingGeocode = null;

  const prev = elements.imagePreview.querySelector("img");
  if (prev) URL.revokeObjectURL(prev.src);

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const file = new File([blob], `demo-${name}.jpg`, { type: "image/jpeg" });

    const previewUrl = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = t("preview.alt");
    elements.imagePreview.innerHTML = "";
    elements.imagePreview.appendChild(img);

    state.lastFile = file;
    state.lastPrepared = null;
    state.lastData = null;
    analyzeImage();
  } catch (_err) {
    /* Fetch fehlgeschlagen — stille Behandlung */
  }
}
