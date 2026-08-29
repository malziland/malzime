export const elements = {
  fileInput: document.getElementById("fileInput"),
  imagePreview: document.getElementById("imagePreview"),
  biasSwitch: document.getElementById("biasSwitch"),
  biasToggleWrap: document.getElementById("biasToggleWrap"),
  dataValue: document.getElementById("dataValue"),
  scanAnim: document.getElementById("scanAnim"),
  scanText: document.getElementById("scanText"),
  status: document.getElementById("status"),
  facts: document.getElementById("facts"),
  privacy: document.getElementById("privacy"),
  gpsMap: document.getElementById("gpsMap"),
  targeting: document.getElementById("targeting"),
  simulation: document.getElementById("simulation"),
  exportPdf: document.getElementById("exportPdf"),
  limitBanner: document.getElementById("limitBanner"),
  limitCountdown: document.getElementById("limitCountdown"),
  maintenanceModal: document.getElementById("maintenanceModal"),
  maintenanceMessage: document.getElementById("maintenanceMessage"),
  maintenanceReload: document.getElementById("maintenanceReload"),
  resultsPanel: document.getElementById("resultsPanel"),
  srAnnounce: document.getElementById("srAnnounce"),
  /* Live-Karte (v3.0 Live-Erlebnis, js/live-anzeige.js) */
  liveKarte: document.getElementById("liveKarte"),
  liveTextFest: document.getElementById("liveTextFest"),
  liveTextRausch: document.getElementById("liveTextRausch"),
  liveCursor: document.getElementById("liveCursor"),
  liveWarten: document.getElementById("liveWarten"),
  /* FEATURE-2026-08-29-01: Liste der bereits geschriebenen Merkmale. */
  liveMerkmale: document.getElementById("liveMerkmale"),
  /* Realitäts-Check (v3.1, js/realitaets-check.js) */
  realCheck: document.getElementById("realCheck"),
  rcZeilen: document.getElementById("rcZeilen"),
  rcAbsenden: document.getElementById("rcAbsenden"),
  rcErgebnis: document.getElementById("rcErgebnis"),
  rcProzent: document.getElementById("rcProzent"),
  rcRingWert: document.getElementById("rcRingWert"),
  rcVergleich: document.getElementById("rcVergleich"),
  rcBalkenAndere: document.getElementById("rcBalkenAndere"),
  rcMarkeDu: document.getElementById("rcMarkeDu"),
  rcAndereWert: document.getElementById("rcAndereWert"),
  rcDuWert: document.getElementById("rcDuWert"),
  rcWenige: document.getElementById("rcWenige"),
  rcAntwort: document.getElementById("rcAntwort"),
};

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  /* SEC-02: Die textNode-Serialisierung escaped <, > und & — aber NICHT
     Anführungszeichen. escapeHtml wird teils im Attribut-Kontext verwendet
     (z.B. render.js: data-key="${escapeHtml(key)}"). Ohne " / ' zu escapen
     könnte ein Wert mit Anführungszeichen aus dem Attribut ausbrechen. */
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
