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
  "disclaimerModal",
  "disclaimerConfirm",
  "exportPdf",
  "limitBanner",
  "limitCountdown",
  "maintenanceModal",
  "maintenanceMessage",
  "maintenanceReload",
  "resultsPanel",
  "srAnnounce",
];

export function setupDOM() {
  document.body.innerHTML = ids.map((id) => `<div id="${id}"></div>`).join("");
  /* biasSwitch braucht .checked Property */
  const toggle = document.getElementById("biasSwitch");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = "biasSwitch";
  toggle.replaceWith(input);
}
