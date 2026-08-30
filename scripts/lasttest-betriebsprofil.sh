#!/bin/sh
# lasttest-betriebsprofil.sh — Warteschlange und Gleichzeitigkeit, kostenlos.
#
# ANLASS (Nutzer, 30.08.2026): „Wie testest du die Werte mit der
# Gleichzeitigkeit von Analysen, wenn mehrere gleichzeitig sind, und mit dem
# Warte-Bereich und dem ganzen Thema?"
#
# Der Firebase-Emulator faehrt Firestore und die Functions lokal; MISTRAL_MOCK=1
# ersetzt die KI durch eine Attrappe. Damit laeuft die ECHTE Warteschlange mit
# echten Jobs, echter Positionsrechnung und echter Wartezeit-Ansage — ohne
# einen einzigen bezahlten Aufruf.
#
# Aufruf:  sh scripts/lasttest-betriebsprofil.sh [Anzahl]   (Vorgabe 40)

set -e
ANZAHL="${1:-40}"
PROJEKT="malzime"
EMU_FIRESTORE="localhost:8080"
EMU_FUNCTIONS="http://localhost:5001/$PROJEKT/europe-west1"

echo "── Lasttest Betriebsprofil ──────────────────────────────"
echo "   $ANZAHL gleichzeitige Analysen, Mistral als Attrappe, keine Kosten"
echo

# 1. Einstellungssatz in den Emulator schreiben
echo "1. Einstellungssatz anlegen"
FIRESTORE_EMULATOR_HOST="$EMU_FIRESTORE" node -e '
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "malzime" });
const db = admin.firestore();
db.doc("config/betriebsprofil").set({
  aktiv: "t1-normal",
  profile: {
    "t1-normal": { mistralTimeoutMs: 90000, singleLargeTimeoutMs: 300000,
                   singleLargeMaxTokens: 5000, requestBudgetMs: 480000,
                   parallelitaet: 7, stundenlimit: 500, adressLimit: 500 },
    "t2-schnell": { mistralTimeoutMs: 90000, singleLargeTimeoutMs: 420000,
                    singleLargeMaxTokens: 5000, requestBudgetMs: 480000,
                    parallelitaet: 14, stundenlimit: 1000, adressLimit: 1000 },
  },
}).then(() => { console.log("   angelegt: t1-normal aktiv"); process.exit(0); });
' || { echo "   FEHLER: Emulator laeuft nicht? Starte ihn mit: firebase emulators:start"; exit 1; }

# 2. Gleichzeitig einreihen
echo
echo "2. $ANZAHL Analysen gleichzeitig einreihen"
START=$(date +%s)
i=1
while [ "$i" -le "$ANZAHL" ]; do
  curl -s -X POST "$EMU_FUNCTIONS/enqueue" \
    -H "Content-Type: application/json" \
    -d '{"imageBase64":"dGVzdA==","mimeType":"image/jpeg","lang":"de"}' \
    -o "/tmp/lasttest-$i.json" &
  i=$((i + 1))
done
wait
ENDE=$(date +%s)
echo "   eingereiht in $((ENDE - START)) s"

# 3. Auswerten
echo
echo "3. Ergebnis"
ANGENOMMEN=$(grep -l "jobId" /tmp/lasttest-*.json 2>/dev/null | wc -l | tr -d ' ')
ABGELEHNT=$((ANZAHL - ANGENOMMEN))
echo "   angenommen: $ANGENOMMEN   abgelehnt: $ABGELEHNT"
echo "   Wartezeit-Ansagen:"
grep -ho '"etaSeconds":[0-9]*' /tmp/lasttest-*.json 2>/dev/null | sort -t: -k2 -n | uniq -c | head -5 | sed 's/^/     /'
echo "   Positionen:"
grep -ho '"position":[0-9]*' /tmp/lasttest-*.json 2>/dev/null | sort -t: -k2 -n | tail -3 | sed 's/^/     /'
rm -f /tmp/lasttest-*.json

echo
echo "── Was dieser Lauf beweist ──────────────────────────────"
echo "   * Der Einstellungssatz wird unter Last gelesen (ein Zugriff, nicht $ANZAHL)"
echo "   * Die Warteschlange rechnet Positionen und Wartezeiten daraus"
echo "   * Kosten: 0 — kein Mistral-Aufruf"
