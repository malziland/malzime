"use strict";

/* curl-live-attrappe.js — eine Attrappe von curl fuer scripts/pruefe-live.sh.
 *
 * Das Skript holt den Fingerabdruck und jede Website-Datei mit curl. Die
 * Attrappe bildet jede Adresse auf ein Verzeichnis ab: https://…/<pfad> wird
 * aus $ATTRAPPE_LIVE/<pfad> beantwortet. So laeuft das echte Skript gegen eine
 * nachgebaute Auslieferung, ohne Netz.
 *
 * Umgebung:
 *   ATTRAPPE_LIVE              Verzeichnis mit dem "ausgelieferten" Stand
 *   ATTRAPPE_TRANSPORTFEHLER   dieser Pfad ist nicht abrufbar (curl-Code 7)
 *   ATTRAPPE_NICHT_GEFUNDEN    fuer diesen Pfad antwortet der Server mit 404
 *                              (`curl -f` meldet das mit Code 22)
 */

const fs = require("fs");
const path = require("path");

/** Legt `<ordner>/curl` an und gibt den Ordner zurueck (fuer PATH). */
function curlLiveAttrappeAnlegen(ordner) {
  fs.mkdirSync(ordner, { recursive: true });
  const datei = path.join(ordner, "curl");
  fs.writeFileSync(
    datei,
    [
      "#!/bin/sh",
      'URL=""; AUS=""',
      "while [ $# -gt 0 ]; do",
      '  case "$1" in',
      '    -o) AUS="$2"; shift ;;',
      '    http*://*) URL="$1" ;;',
      "  esac",
      "  shift",
      "done",
      "PFAD=$(printf '%s' \"$URL\" | sed 's|^[a-z]*://[^/]*/||')",
      '[ -n "${ATTRAPPE_TRANSPORTFEHLER:-}" ] && [ "$PFAD" = "$ATTRAPPE_TRANSPORTFEHLER" ] && { echo "curl: (7) Verbindung abgelehnt" >&2; exit 7; }',
      '[ -n "${ATTRAPPE_NICHT_GEFUNDEN:-}" ] && [ "$PFAD" = "$ATTRAPPE_NICHT_GEFUNDEN" ] && { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }',
      "# Firebase Hosting beantwortet einen unbekannten Pfad mit der Startseite (Status 200).",
      'if [ -f "$ATTRAPPE_LIVE/$PFAD" ]; then QUELLE="$ATTRAPPE_LIVE/$PFAD"; else QUELLE="$ATTRAPPE_LIVE/index.html"; fi',
      'if [ -n "$AUS" ]; then cp "$QUELLE" "$AUS"; else cat "$QUELLE"; fi',
      "exit 0",
      "",
    ].join("\n")
  );
  fs.chmodSync(datei, 0o755);
  return ordner;
}

module.exports = { curlLiveAttrappeAnlegen };
