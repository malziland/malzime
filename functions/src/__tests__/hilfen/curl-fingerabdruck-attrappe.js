/* curl-fingerabdruck-attrappe.js — eine Attrappe fuer `curl`, die den
 * Fingerabdruck der Live-Seite (`build-info.json`) beantwortet.
 *
 * Wozu: `scripts/deploy.sh` liest vor einer reinen Website-Auslieferung, welchen
 * Server-Code die Seite heute ausweist, und vergleicht ihn mit dem Stand, der
 * ausgeliefert werden soll. Die Attrappe unter scripts/test-attrappen/ kennt
 * diese Abfrage nicht (sie antwortet darauf leer). Diese hier steht im Suchpfad
 * davor, beantwortet NUR die Abfrage des Fingerabdrucks und reicht alles andere
 * an die Attrappe weiter, die ATTRAPPE_CURL_WEITER nennt. Kein Netz.
 *
 * Steuerung ueber Umgebungsvariablen:
 *   ATTRAPPE_FINGERABDRUCK_LIVE     Datei mit dem Fingerabdruck, den die Seite "ausweist"
 *   ATTRAPPE_FINGERABDRUCK_ANTWORT  stattdessen genau dieser Text (auch leer) —
 *                                   fuer Antworten, die kein Fingerabdruck sind
 *   ATTRAPPE_FINGERABDRUCK_ROT=1    der Abruf scheitert
 *   ATTRAPPE_CURL_WEITER            Attrappe fuer alle anderen Aufrufe
 *   ATTRAPPE_PROTOKOLL              jeder Aufruf wird dort mitgeschrieben
 */

const fs = require("fs");
const path = require("path");

const SKRIPT = `#!/bin/sh
# ATTRAPPE (Testlauf) — beruehrt kein Netz.
case "$*" in
  *build-info.json*)
    [ -n "\${ATTRAPPE_PROTOKOLL:-}" ] && echo "curl $*" >> "$ATTRAPPE_PROTOKOLL"
    if [ "\${ATTRAPPE_FINGERABDRUCK_ROT:-0}" = "1" ]; then
      echo "ATTRAPPE curl: Fingerabdruck nicht erreichbar (so gewollt)" >&2
      exit 7
    fi
    # \`\${VAR+x}\`: auch ein LEER gesetzter Wert zaehlt als Antwort.
    if [ -n "\${ATTRAPPE_FINGERABDRUCK_ANTWORT+x}" ]; then
      printf '%s' "$ATTRAPPE_FINGERABDRUCK_ANTWORT"
      exit 0
    fi
    if [ -z "\${ATTRAPPE_FINGERABDRUCK_LIVE:-}" ]; then
      echo "ATTRAPPE curl (Fingerabdruck): ATTRAPPE_FINGERABDRUCK_LIVE fehlt" >&2
      exit 97
    fi
    cat "$ATTRAPPE_FINGERABDRUCK_LIVE"
    exit $? ;;
esac
if [ -n "\${ATTRAPPE_CURL_WEITER:-}" ]; then exec "$ATTRAPPE_CURL_WEITER" "$@"; fi
echo "ATTRAPPE curl (Fingerabdruck): unbekannter Aufruf: $*" >&2
exit 97
`;

/** Legt die Attrappe als ausfuehrbare Datei `curl` im genannten Ordner an. */
function curlFingerabdruckAttrappeAnlegen(ordner) {
  const datei = path.join(ordner, "curl");
  fs.writeFileSync(datei, SKRIPT);
  fs.chmodSync(datei, 0o755);
  return datei;
}

module.exports = { curlFingerabdruckAttrappeAnlegen };
