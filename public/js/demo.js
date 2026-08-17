import { elements } from "./dom.js";
import { state } from "./state.js";
import { analyzeImage } from "./api.js";
import { klangAktivieren } from "./klang.js";
import { t } from "./i18n.js";
import { setStatus, stopScanAnim } from "./ui.js";
import { logClientError } from "./error-logger.js";

/* Cache-Buster der Demo-Bilder. Steht bewusst als eigene Konstante, damit
   scripts/deploy.sh ihn beim Hosting-Deploy mit derselben Ersetzung hochzählt
   wie in den HTML-Seiten.

   2026-08-13 (OPS-2026-08-13-01): Hier stand der Verweis auf das Suchmuster
   ausgeschrieben — und wurde vom Deploy prompt selbst überschrieben, weil das
   Muster null Ziffern erlaubte. Beides ist behoben; der Satz nennt das Muster
   trotzdem nicht mehr wörtlich. */
const DEMO_BUSTER = "?v=2026081802";

/* 2026-08-13: Die KI-Kennzeichnung ist in die Pixel gebrannt (Pflicht seit
   08/2026 — ein CSS-Etikett verschwindet, sobald jemand das Bild speichert).
   Ein gebranntes Zeichen kann nicht mitübersetzen: Bei englischer Oberfläche
   stand trotzdem „KI ERSTELLT" im Bild. Deshalb zwei Dateisätze, die Pfade
   liegen als Übersetzungsschlüssel (`demo.full.*`) in den Locale-Dateien. */
function demoBildPfad(key) {
  const pfad = t(`demo.full.${key}`);
  /* Fällt der Schlüssel aus (Locale unvollständig), lieber die deutsche Fassung
     als gar kein Bild — die Kennzeichnung ist in beiden Sätzen vorhanden. */
  const sicher = pfad === `demo.full.${key}` ? `./img/demo/demo-${key}.jpg` : pfad;
  return `${sicher}${DEMO_BUSTER}`;
}

const DEMO_KEYS = ["selfie", "cafe", "hiker"];

export function initDemo() {
  document.querySelectorAll(".demo-thumb[data-demo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      /* v3.0: Klang-Aktivierung direkt in der Klick-Geste — nach dem ersten
         `await` wäre die Nutzer-Aktivierung für den AudioContext verfallen. */
      klangAktivieren();
      const key = btn.dataset.demo;
      /* Pfad ERST beim Klick auflösen — die Sprache kann sich zwischen dem
         Seitenaufbau und dem Klick geändert haben. */
      if (key && DEMO_KEYS.includes(key)) loadDemoImage(demoBildPfad(key), key);
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
  } catch (err) {
    /* UX-2026-08-13-FE-06: Vorher völlig lautlos — der Bildschirm blieb einfach
       stehen, wenn der Abruf scheiterte (Schul-WLAN, Offline-Moment). Die
       Demo-Fotos sind ausgerechnet der Rückfallweg für Workshops. Jetzt Meldung,
       Animation stoppen, Fehler protokollieren. */
    stopScanAnim(true);
    setStatus(t("error.networkError"), undefined, "error.networkError");
    logClientError(err, { phase: "demo-image-load", demo: name });
  }
}
