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
const DEMO_BUSTER = "?v=2026090801";

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

/* `bereit`: ein Versprechen, das erfuellt ist, sobald die Uebersetzung
   geladen ist. BELEG (Pipeline-Lauf 34149354681, 07.09.2026): Die Knoepfe
   wurden erst NACH `await initI18n()` verdrahtet; ein Klick 0,68 s davor tat
   nichts, und 15 Sekunden lang blieb die Seite leer. Auf einer langsamen
   Maschine ist das die Pruefkette, im Schul-WLAN ein Kind, das auf ein Foto
   tippt. Jetzt wird sofort verdrahtet, und ein frueher Klick wartet auf die
   Uebersetzung statt zu verpuffen. Ohne Argument: sofort, wie vorher. */
export function initDemo(bereit = Promise.resolve()) {
  document.querySelectorAll(".demo-thumb[data-demo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      /* v3.0: Klang-Aktivierung direkt in der Klick-Geste — nach dem ersten
         `await` wäre die Nutzer-Aktivierung für den AudioContext verfallen. */
      klangAktivieren();
      const key = btn.dataset.demo;
      if (!key || !DEMO_KEYS.includes(key)) return;
      /* Pfad ERST nach dem Warten auflösen — er haengt an der Sprache, und die
         steht erst fest, wenn die Uebersetzung da ist. */
      bereit.then(() => loadDemoImage(demoBildPfad(key), key));
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
  state.geocodeCache = null; /* BUG-2026-08-20-06: neue Analyse, neue Aufnahme */

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
    /* BUG-2026-08-20-02 (Nachlauf): `demo` steht nicht auf der Feldliste des
       Loggers und waere stillschweigend verlorengegangen — welches Beispielbild
       es traf, gehoert aber genau zur Diagnose. Darum in `errorDetail`. */
    logClientError(err, { phase: "demo-image-load", errorDetail: `demo=${name}`.slice(0, 60) });
  }
}
