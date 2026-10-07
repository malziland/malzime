/* ── Zwei Handgriffe an der Foto-Vorschau ───────────────────────────────
   Bis 07.10.2026 Teil von js/api.js; das Verhalten ist unverändert. */

import { elements } from "./dom.js";
import { t } from "./i18n.js";

/* Die Vorschau oben zeigt das Original ueber eine Objekt-URL. Kann der
   Browser das Format nicht anzeigen (HEIC auf Android, 08.09.2026), bleibt
   dort ein kaputtes Bildsymbol stehen, obwohl die Analyse laeuft. Dann zeigt
   die Vorschau das, was der Browser aus dem Foto gemacht hat — dasselbe Bild,
   das auch zum Server geht. Kann der Browser das Original anzeigen, aendert
   sich nichts. */
export function vorschauAusErgebnisFallsNoetig(prepared) {
  const img = elements.imagePreview && elements.imagePreview.querySelector("img");
  if (!img || !prepared || !prepared.imageBase64) return;
  const ersetzen = () => {
    try {
      URL.revokeObjectURL(img.src);
    } catch (_) {
      /* Objekt-URL war schon weg — egal. */
    }
    img.src = `data:${prepared.mimeType || "image/jpeg"};base64,${prepared.imageBase64}`;
  };
  if (img.complete) {
    if (img.naturalWidth === 0) ersetzen();
  } else {
    img.addEventListener("error", ersetzen, { once: true });
  }
}

/* DATENSCHUTZ-ENTSCHEIDUNG (bewusst): Nach einem Reload zeigen wir das
   hochgeladene Foto NICHT wieder. Es wird unmittelbar nach der Analyse
   serverseitig gelöscht und absichtlich NIRGENDS — auch nicht im Browser —
   zwischengespeichert; Datensparsamkeit hat Vorrang. Statt einer leeren Lücke
   setzen wir an die Stelle des Fotos einen kurzen, positiven Datenschutz-
   Hinweis: der „verschwundene" Anblick wird so zum Lerneffekt. */
export function showPhotoDeletedNotice() {
  if (!elements.imagePreview) return;
  const note = document.createElement("div");
  note.className = "photo-deleted-note";
  note.setAttribute("role", "note");

  /* Das Schloss-Symbol kommt rein dekorativ aus dem CSS (::before) — so bleibt
     kein hartcodierter Text im JS (i18n-Guardian), und Screenreader lesen es
     nicht vor. Der eigentliche Text läuft über t() (DE/EN). */
  const text = document.createElement("span");
  text.className = "photo-deleted-text";
  const strong = document.createElement("strong");
  strong.textContent = t("reload.photoTitle");
  text.appendChild(strong);
  text.appendChild(document.createTextNode(" " + t("reload.photoBody")));

  note.appendChild(text);
  elements.imagePreview.innerHTML = "";
  elements.imagePreview.appendChild(note);
}
