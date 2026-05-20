export const elements = {
  fileInput: document.getElementById("fileInput"),
  imagePreview: document.getElementById("imagePreview"),
  biasSwitch: document.getElementById("biasSwitch"),
  biasToggleWrap: document.getElementById("biasToggleWrap"),
  dataValue: document.getElementById("dataValue"),
  scanAnim: document.getElementById("scanAnim"),
  scanText: document.getElementById("scanText"),
  queueStatus: document.getElementById("queueStatus"),
  status: document.getElementById("status"),
  facts: document.getElementById("facts"),
  privacy: document.getElementById("privacy"),
  gpsMap: document.getElementById("gpsMap"),
  targeting: document.getElementById("targeting"),
  simulation: document.getElementById("simulation"),
  disclaimerModal: document.getElementById("disclaimerModal"),
  disclaimerConfirm: document.getElementById("disclaimerConfirm"),
  exportPdf: document.getElementById("exportPdf"),
  limitBanner: document.getElementById("limitBanner"),
  limitCountdown: document.getElementById("limitCountdown"),
  maintenanceModal: document.getElementById("maintenanceModal"),
  maintenanceMessage: document.getElementById("maintenanceMessage"),
  maintenanceReload: document.getElementById("maintenanceReload"),
  resultsPanel: document.getElementById("resultsPanel"),
  srAnnounce: document.getElementById("srAnnounce"),
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
