/* Minimales DOM-Setup — erstellt alle IDs die dom.js beim Import braucht */
const ids = [
  "fileInput",
  "imagePreview",
  "biasSwitch",
  "biasToggleWrap",
  "dataValue",
  "scanAnim",
  "scanText",
  "status",
  "facts",
  "privacy",
  "gpsMap",
  "targeting",
  "simulation",
  "exportPdf",
  "limitBanner",
  "limitCountdown",
  "maintenanceModal",
  "maintenanceMessage",
  "maintenanceReload",
  "resultsPanel",
  "srAnnounce",
  /* Live-Karte (v3.0 Live-Erlebnis) */
  "liveKarte",
  "liveStatusText",
  "liveTextFest",
  "liveTextRausch",
  "liveCursor",
  "liveWarten",
  /* Realitäts-Check (v3.1) */
  "realCheck",
  "rcZeilen",
  "rcErgebnis",
  "rcProzent",
  "rcRingWert",
  "rcVergleich",
  "rcBalkenAndere",
  "rcMarkeDu",
  "rcAndereWert",
  "rcDuWert",
  "rcWenige",
  "rcAntwort",
];

export function setupDOM() {
  document.body.innerHTML = ids.map((id) => `<div id="${id}"></div>`).join("");
  /* biasSwitch braucht .checked Property */
  const toggle = document.getElementById("biasSwitch");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = "biasSwitch";
  toggle.replaceWith(input);
  /* rcAbsenden ist im echten Markup ein <button> — .disabled muss wirken */
  const absenden = document.createElement("button");
  absenden.type = "button";
  absenden.id = "rcAbsenden";
  absenden.disabled = true;
  document.body.appendChild(absenden);
  /* Wie in index.html startet die Realitäts-Check-Karte verborgen — sichtbar
     macht sie erst realitaets-check.js bei einem echten Menschen-Profil. */
  document.getElementById("realCheck").hidden = true;
}
