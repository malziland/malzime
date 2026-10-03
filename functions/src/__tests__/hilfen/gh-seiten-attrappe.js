/* gh-seiten-attrappe.js — eine Attrappe fuer `gh`, die die Pruefergebnisse
 * eines Commits SEITENWEISE liefert, so wie die GitHub-Schnittstelle es tut:
 * ohne Angabe 30 Laeufe je Seite, hoechstens 100, weitere Seiten ueber
 * `page=N`.
 *
 * Wozu: Die Attrappe unter scripts/test-attrappen/ beantwortet die Abfrage der
 * Pruefergebnisse mit fertigen Zeilen und kennt keine Seiten. Ob deploy.sh bei
 * vielen Laeufen an einem Commit alle sieht — und ueber die Seiten hinweg den
 * JUENGSTEN je Check nimmt —, laesst sich nur pruefen, wenn die Antwort wie
 * die echte geschnitten ist (OPS-2026-10-03-18).
 *
 * Die Attrappe wendet den uebergebenen jq-Ausdruck mit echtem jq auf die
 * jeweilige Seite an. Alles, was NICHT die check-runs-Abfrage ist, reicht sie
 * an die Attrappe weiter, die ATTRAPPE_WEITER nennt.
 *
 * Steuerung ueber Umgebungsvariablen:
 *   ATTRAPPE_CHECK_LAEUFE     Datei mit einem JSON-Array ALLER Laeufe
 *   ATTRAPPE_CHECK_AUFRUFE    Datei, in die jede check-runs-Abfrage notiert wird
 *   ATTRAPPE_CHECK_SEITE_ROT  Nummer der Seite, deren Abruf scheitert
 *   ATTRAPPE_WEITER           Attrappe fuer alle anderen Aufrufe
 */

const fs = require("fs");
const path = require("path");

const SKRIPT = `#!/bin/sh
# ATTRAPPE (Testlauf) — beruehrt keinen echten Dienst.
URL=""; JQ=""; VORIG=""
for a in "$@"; do
  if [ "$VORIG" = "--jq" ]; then JQ="$a"; fi
  case "$a" in */check-runs*) URL="$a" ;; esac
  VORIG="$a"
done
if [ -z "$URL" ] || [ -z "\${ATTRAPPE_CHECK_LAEUFE:-}" ]; then
  if [ -n "\${ATTRAPPE_WEITER:-}" ]; then exec "$ATTRAPPE_WEITER" "$@"; fi
  echo "ATTRAPPE gh (Seiten): unbekannter Aufruf: $*" >&2
  exit 97
fi
if [ -n "\${ATTRAPPE_CHECK_AUFRUFE:-}" ]; then printf '%s\\n' "$URL" >> "$ATTRAPPE_CHECK_AUFRUFE"; fi
JE=$(printf '%s' "$URL" | sed -n 's/.*[?&]per_page=\\([0-9][0-9]*\\).*/\\1/p')
SEITE=$(printf '%s' "$URL" | sed -n 's/.*[?&]page=\\([0-9][0-9]*\\).*/\\1/p')
JE=\${JE:-30}
if [ "$JE" -gt 100 ]; then JE=100; fi
SEITE=\${SEITE:-1}
if [ "\${ATTRAPPE_CHECK_SEITE_ROT:-}" = "$SEITE" ]; then
  echo "ATTRAPPE gh (Seiten): Seite $SEITE scheitert (so gewollt)" >&2
  exit 1
fi
jq --argjson s "$SEITE" --argjson n "$JE" \\
  '{total_count: length, check_runs: .[(($s - 1) * $n):($s * $n)]}' "$ATTRAPPE_CHECK_LAEUFE" | jq -r "$JQ"
`;

/** Legt die Attrappe als ausfuehrbare Datei `gh` im genannten Ordner an. */
function ghSeitenAttrappeAnlegen(ordner) {
  const datei = path.join(ordner, "gh");
  fs.writeFileSync(datei, SKRIPT);
  fs.chmodSync(datei, 0o755);
  return datei;
}

/** Ein Lauf, wie ihn die Schnittstelle liefert (nur die benutzten Felder). */
function lauf(name, conclusion, started_at) {
  return { name, conclusion, started_at };
}

/** `anzahl` Laeufe von Nachtlauf und Zeitplan — keiner davon ein Pflicht-Check.
 *  Je Nacht haengt der Nachtlauf vier an denselben Commit. */
function fremdeLaeufe(anzahl) {
  const namen = ["npm-luecken", "mitgelieferte-bibliotheken", "abkuendigungen", "alarm"];
  const laeufe = [];
  for (let i = 0; i < anzahl; i++) {
    /* Feste Tage ab dem 01.06.2026 — verglichen werden die Zeiten nur
       untereinander, nie mit der Uhr. */
    const nacht = new Date(Date.UTC(2026, 5, 1 + Math.floor(i / namen.length), 3, 43)).toISOString();
    laeufe.push(lauf(namen[i % namen.length], "success", nacht));
  }
  return laeufe;
}

const PFLICHT = ["test-backend", "test-frontend", "test-e2e", "secret-scan", "playwright-version", "pruefungen"];

/** Die sechs Pflicht-Checks, alle gruen, gestartet zur genannten Zeit. */
function pflichtLaeufe(started_at = "2026-08-31T10:00:00Z", conclusion = "success") {
  return PFLICHT.map((name) => lauf(name, conclusion, started_at));
}

module.exports = { ghSeitenAttrappeAnlegen, lauf, fremdeLaeufe, pflichtLaeufe, PFLICHT };
