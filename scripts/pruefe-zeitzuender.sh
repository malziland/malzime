#!/bin/sh
# zeitzuender.sh — laesst die Kandidaten aus zeitzuender.py mit VORGESTELLTER Uhr laufen.
#
# TEST-2026-08-20-01 (belegter Schaden): Ein Test verglich die echte Uhr mit einem festen
# Datum im Produktivcode und waere ab einem berechenbaren Tag bei jedem Lauf rot geworden —
# als Pflicht-Check haette er jede Auslieferung blockiert, ohne dass jemand etwas aenderte.
#
# Diese Pruefung misst die WIRKUNG statt der Struktur: Was mit vorgestellter Uhr rot wird,
# ist ein Zeitzuender. Ein Test, der die zeitabhaengige Funktion gar nicht aufruft, kann
# hier nicht faelschlich anschlagen.
#
# Aufruf: sh scripts/pruefe-zeitzuender.sh [verzeichnis] [--nur backend|frontend]
#
# Der Lauf braucht den jeweiligen Test-Runner. In der Pipeline liegen die Pakete nicht
# in einem gemeinsamen Job: `test-backend` hat jest (npm ci --prefix functions),
# `test-frontend` hat vitest (npm ci im Wurzelverzeichnis), und der schlanke Job
# `pruefungen` hat bewusst gar keine. Deshalb der Filter — jeder Job prueft die
# Kandidaten, die er auch ausfuehren KANN. Ohne Filter (lokal, vor-dem-push) laeuft alles.
#
# Exit 0 = kein Zeitzuender, 1 = Fundstelle, 2 = Messproblem (NIE als bestanden werten).

set -u
WURZEL=.
NUR=alle
while [ $# -gt 0 ]; do
  case "$1" in
    --nur) NUR=${2:-alle}; shift 2 ;;
    *) WURZEL=$1; shift ;;
  esac
done
HIER=$(cd "$(dirname "$0")" && pwd)
VORSPRUNG_TAGE=400

if [ ! -d "$WURZEL/functions" ] || [ ! -d "$WURZEL/public" ]; then
  echo "FEHLER: '$WURZEL' sieht nicht nach dem Projekt aus (functions/ und public/ fehlen)." >&2
  exit 2
fi

# Selbstprobe zuerst: Eine Pruefung, die nicht beweisen kann, dass sie rot werden
# KANN, belegt nichts. Beispielmaterial in scripts/zeitzuender-proben/.
PROBEN="$HIER/zeitzuender-proben"
PROBE_KAPUTT=$(python3 "$HIER/pruefe-zeitzuender.py" "$PROBEN/kaputt" --kandidaten 2>&1)
KAPUTT_RC=$?
PROBE_SAUBER=$(python3 "$HIER/pruefe-zeitzuender.py" "$PROBEN/sauber" --kandidaten 2>&1)
SAUBER_RC=$?
if [ "$KAPUTT_RC" -ne 1 ]; then
  echo "FEHLER: Selbstprobe — die Pruefung findet den bekannten Zeitzuender NICHT (Exit $KAPUTT_RC statt 1)." >&2
  echo "$PROBE_KAPUTT" | sed 's/^/          /' >&2
  exit 2
fi
if [ "$SAUBER_RC" -ne 0 ]; then
  echo "FEHLER: Selbstprobe — die Pruefung meldet sauberes Material als Fund (Exit $SAUBER_RC statt 0)." >&2
  echo "$PROBE_SAUBER" | sed 's/^/          /' >&2
  exit 2
fi
echo "Selbstprobe: die Pruefung wird bei kaputtem Material rot und bei sauberem gruen."

KANDIDATEN=$(python3 "$HIER/pruefe-zeitzuender.py" "$WURZEL" --kandidaten)
RC=$?
if [ "$RC" -eq 2 ]; then
  echo "FEHLER: Kandidatensuche fehlgeschlagen — das ist ein Messproblem, kein Bestehen." >&2
  exit 2
fi
if [ -z "$KANDIDATEN" ]; then
  # BEFUND 31.08.2026 (Runde 5, P3-19): Hier stand Rueckgabewert 0. Findet das
  # Suchmuster im GANZEN Baum keinen einzigen Kandidaten, ist das kein
  # Bestehen, sondern ein Messproblem: Frueher gab es welche. Verschiebt sich
  # die Konvention (anderer Dateiname, andere Schreibweise), verstummt die
  # Pruefung lautlos und meldet weiter gruen.
  echo "NICHT MESSBAR: Im ganzen Baum gibt es keinen einzigen Kandidaten."
  echo "  Frueher gab es welche. Hat sich das Suchmuster verschoben?"
  echo "  Ein Lauf ohne Messung ist kein bestandener Lauf."
  exit 2
fi

# Wegwerf-Setup: stellt die Uhr INNERHALB der Testumgebung vor. NODE_OPTIONS genuegt
# nicht — Jest und Vitest geben ihren Tests ein eigenes Date-Global.
# Die Dateien liegen IM Projekt (mktemp -d ausserhalb waere fuer Vitest ausserhalb der
# Projektwurzel und wird nicht aufgeloest); sie werden beim Verlassen geloescht.
ABS=$(cd "$WURZEL" && pwd)
UHR="$ABS/.zeitzuender-uhr.js"
VCONF="$ABS/.zeitzuender-vitest.config.js"
cat > "$UHR" <<EOF
const ZIEL = Date.now() + ${VORSPRUNG_TAGE} * 24 * 60 * 60 * 1000;
const Echt = Date;
global.Date = class extends Echt {
  constructor(...a) { return a.length ? new Echt(...a) : new Echt(ZIEL); }
  static now() { return ZIEL; }
};
EOF
# Vitest kennt kein --setupFiles auf der Kommandozeile (der Aufruf scheitert mit
# "Unknown option" — ein Fehlschlag, der wie ein Befund aussieht). Deshalb eine
# temporaere Konfiguration, die die echte erweitert.
cat > "$VCONF" <<'EOF'
import { defineConfig } from "vitest/config";
import basis from "./vitest.config.js";
export default defineConfig({
  ...basis,
  test: { ...basis.test, setupFiles: ["./.zeitzuender-uhr.js"] },
});
EOF
trap 'rm -f "$UHR" "$VCONF"' EXIT

echo "Zeitzuender-Probe: Uhr um ${VORSPRUNG_TAGE} Tage vorgestellt."
FEHLER=0
GEMESSEN=0
for TEST in $KANDIDATEN; do
  REL=${TEST#"$WURZEL"/}
  case "$REL" in
    functions/*)
      [ "$NUR" = "frontend" ] && { echo "  --      $REL (uebersprungen: --nur frontend)"; continue; }
      AUSGABE=$(cd "$WURZEL/functions" && npx jest "${REL#functions/}" --setupFiles="$UHR" 2>&1) ;;
    *)
      [ "$NUR" = "backend" ] && { echo "  --      $REL (uebersprungen: --nur backend)"; continue; }
      AUSGABE=$(cd "$WURZEL" && npx vitest run "$REL" --config .zeitzuender-vitest.config.js 2>&1) ;;
  esac
  LAUF=$?
  GEMESSEN=$((GEMESSEN + 1))
  # KERN 5c: Ein gescheiterter Aufruf sieht aus wie ein Befund. Diese Formen sind
  # Messprobleme und enden mit Exit 2, niemals als "Zeitzuender gefunden".
  if echo "$AUSGABE" | grep -qE "Cannot find module|No tests found|command not found|Unknown option|CACError|Failed to load config|Validation Error"; then
    echo "  FEHLER  $REL — Lauf nicht zustande gekommen (Messproblem):" >&2
    echo "$AUSGABE" | tail -5 | sed 's/^/          /' >&2
    exit 2
  fi
  if [ "$LAUF" -eq 0 ]; then
    echo "  ja      $REL bleibt mit vorgestellter Uhr gruen"
  else
    echo "  NEIN    $REL wird mit vorgestellter Uhr ROT — Zeitzuender"
    echo "$AUSGABE" | grep -E "✕|●|Expected|Received" | head -6 | sed 's/^/          /'
    FEHLER=$((FEHLER + 1))
  fi
done

if [ "$FEHLER" -gt 0 ]; then
  echo ""
  echo "Abhilfe: im Test die Uhr stellen (jest.setSystemTime / vi.setSystemTime /"
  echo "useFakeTimers) oder den Zeitpunkt als Parameter injizieren."
  exit 1
fi
if [ "$GEMESSEN" -eq 0 ]; then
  # BEFUND 31.08.2026 (Runde 5, P3-19): Hier stand Rueckgabewert 0 fuer JEDEN
  # Lauf ohne Messung — auch dann, wenn es ueberhaupt keine Kandidaten mehr
  # gibt, weil sich etwa das Suchmuster verschoben hat. "Nichts gefunden" und
  # "nichts geprueft" sahen gleich aus.
  #
  # Unterschieden wird jetzt: Gibt es GAR KEINEN Kandidaten im ganzen Baum, ist
  # das ein Messproblem (2). Gibt es welche, passt aber der Filter dieses Laufs
  # auf keinen — der Normalfall bei `--nur backend`, weil alle Kandidaten im
  # Frontend liegen —, ist nichts zu tun (0).
  if [ -z "$KANDIDATEN" ]; then
    echo "NICHT MESSBAR: Im ganzen Baum gibt es keinen einzigen Kandidaten."
    echo "  Frueher gab es welche. Hat sich das Suchmuster verschoben?"
    exit 2
  fi
  echo "Kein Kandidat fuer diesen Lauf (--nur $NUR) — die vorhandenen liegen"
  echo "im jeweils anderen Bereich. Nichts zu messen, nichts offen."
  exit 0
fi
echo "Kein Zeitzuender: alle $GEMESSEN gemessenen Kandidaten bleiben auch in der Zukunft gruen."
exit 0
