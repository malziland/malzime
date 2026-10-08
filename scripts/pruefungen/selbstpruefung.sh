#!/bin/sh
# selbstpruefung.sh — prueft die Pruefungen selbst.
#
# Jede Pruefung muss zweierlei koennen: bei kaputtem Material rot werden UND bei
# sauberem Material gruen. Nur das erste zu testen ist der Fehler, der in der
# Familie schon einmal passiert ist: Ein Abgabe-Check wurde gegen einen
# unvollstaendigen Bericht getestet, wurde korrekt rot, und liess trotzdem
# Stichwortsalat durch. Getestet war nur eine Richtung.
#
# Aufruf: sh selbstpruefung.sh
# Exit 0 = alle Pruefungen verhalten sich in beide Richtungen richtig.

HIER=$(cd "$(dirname "$0")" && pwd)
KAPUTT="$HIER/negativprobe/kaputt"
SAUBER="$HIER/negativprobe/sauber"
FEHLER=0

PROBEN=0

lauf() {
  # $1 = Skriptname, $2 = Verzeichnis, $3 = erwarteter Exit, $4 = Beschreibung
  PROBEN=$((PROBEN + 1))
  python3 "$HIER/checks/$1" "$2" > /tmp/selbstpruefung.out 2>&1
  IST=$?
  if [ "$IST" -eq "$3" ]; then
    echo "  ja    $4 (Exit $IST wie erwartet)"
  else
    echo "  NEIN  $4 (Exit $IST, erwartet $3)"
    sed 's/^/          /' /tmp/selbstpruefung.out | tail -8
    FEHLER=$((FEHLER + 1))
  fi
}

echo "SELBSTPRUEFUNG DER PRUEFUNGEN"
echo "============================================================"
echo "Richtung 1: kaputtes Material MUSS rot werden (Exit 1)"
lauf fakten-drift.py       "$KAPUTT" 1 "fakten-drift findet den Zahlen-Drift"
lauf stiller-fehlschlag.py "$KAPUTT" 1 "stiller-fehlschlag findet die Erfolgsluege"
lauf aussentext.py         "$KAPUTT" 1 "aussentext findet die verbotene Zusage"
lauf test-blind.py         "$KAPUTT" 1 "test-blind findet die blinden Tests"

echo ""
echo "Richtung 2: sauberes Material MUSS gruen bleiben (Exit 0)"
lauf fakten-drift.py       "$SAUBER" 0 "fakten-drift meldet nichts"
lauf stiller-fehlschlag.py "$SAUBER" 0 "stiller-fehlschlag meldet nichts"
lauf aussentext.py         "$SAUBER" 0 "aussentext meldet nichts"
lauf test-blind.py         "$SAUBER" 0 "test-blind meldet nichts"

echo ""
echo "Richtung 3: die Pruefung darf nicht still schwaecher werden (2026-08-12)"
lauf aussentext.py "$HIER/negativprobe/regeln-kaputt" 2 \
  "nicht kompilierbare Regel bricht ab (Exit 2), statt sie zu ueberspringen"
lauf aussentext.py "$HIER/negativprobe/regeln-mit-oder" 1 \
  "Regel mit | im Ausdruck laedt und schlaegt an (Trennung von rechts)"
lauf stiller-fehlschlag.py "$HIER/negativprobe/nur-ausgeschlossenes" 2 \
  "negativprobe/ wird uebersprungen, uebrig bleibt keine Suchflaeche"
lauf aussentext.py "$HIER/negativprobe/regeln-prosa-pipe" 2 \
  "| in der Begruendung wird erkannt, statt das Suchmuster still zu erweitern"

echo ""
echo "Richtung 4: kein Fehlalarm, sonst wird die Pruefung abgeschaltet (2026-08-12)"
lauf stiller-fehlschlag.py "$HIER/negativprobe/echte-bedingung" 0 \
  "if ... >/dev/null 2>&1; then gilt nicht als verworfener Fehler"
lauf test-blind.py "$HIER/negativprobe/test-mit-textblock" 0 \
  "Zusicherung hinter einem mehrzeiligen Text wird gefunden"
lauf test-blind.py "$HIER/negativprobe/gruppe-mit-tests" 0 \
  "test.describe ist eine Gruppe, kein Test ohne Zusicherung"
lauf stiller-fehlschlag.py "$HIER/negativprobe/berichter-ohne-set-e" 0 \
  "Sammel-Berichter mit eigenem Fehler-Exit braucht kein set -e"
lauf stiller-fehlschlag.py "$HIER/negativprobe/geprueftes-suchergebnis" 0 \
  "geprueftes Suchergebnis gilt nicht als still gelesen"
lauf fakten-drift.py "$HIER/negativprobe/eigene-muster" 1 \
  "eigene Muster gelten allein, die eingebauten schweigen"
lauf fakten-drift.py "$HIER/negativprobe/nur-historie" 0 \
  "ein Changelog mit alten Zahlen ist Historie, kein Drift"
lauf aussentext.py "$HIER/negativprobe/ignorierte-datei" 0 \
  "eine ignorierte Datei wird nicht geprueft (lokal = CI)"

echo ""
echo "Richtung 5: keine Suchflaeche und Tabellenformen (2026-08-13)"
lauf aussentext.py "$HIER/negativprobe/ohne-aussentexte" 2 \
  "null gepruefte Dateien ist Exit 2, nicht 'kein Verstoss gefunden'"
lauf test-blind.py "$HIER/negativprobe/tabellenform" 1 \
  "test.skip.each und die Schablonenform werden ueberhaupt als Test erkannt"
lauf test-blind.py "$HIER/negativprobe/uebersprungen-begruendet" 0 \
  "begruendet uebersprungen zaehlt nicht als Mangel, bleibt aber sichtbar"

echo ""
echo "Richtung 6: Formulierung ueber einen Zeilenumbruch (2026-10-07)"
lauf aussentext.py "$HIER/negativprobe/umbruch" 1 \
  "eine Formulierung, die ueber einen Zeilenumbruch laeuft, wird gefunden"
lauf aussentext.py "$HIER/negativprobe/umbruch-absatz" 0 \
  "ueber Leerzeile, Listenpunkte, Ueberschrift und Tabellenzeilen hinweg wird nicht gesucht"
lauf aussentext.py "$HIER/negativprobe/umbruch-listenpunkt" 1 \
  "die eingerueckte Fortsetzung eines Listenpunkts gehoert zu seinem Satz"
lauf aussentext.py "$HIER/negativprobe/umbruch-html" 1 \
  "ein Satz in einem HTML-Absatz wird ueber den Zeilenumbruch gefunden"

echo ""
echo "Richtung 8: Formulierung mit einer Hervorhebung mittendrin (2026-10-08)"
lauf aussentext.py "$HIER/negativprobe/betont-markdown" 1 \
  "eine Wendung mit einem betonten Wort (Sternchen) wird gefunden"
lauf aussentext.py "$HIER/negativprobe/betont-html" 1 \
  "eine Wendung mit Hervorhebung und Zeichen in HTML-Schreibweise wird gefunden"
lauf aussentext.py "$HIER/negativprobe/betont-umbruch" 1 \
  "betont UND ueber einen Zeilenumbruch: beide Durchgaenge wirken zusammen"
lauf aussentext.py "$HIER/negativprobe/betont-sauber" 0 \
  "Namen mit Unterstrichen, getrennte Listenpunkte und Absaetze bleiben ohne Fund"

echo ""
echo "Richtung 7: was git ausnimmt, wird nicht gelesen (2026-10-08)"
# Vorher lasen drei der vier Pruefungen den Dateibaum und damit auch private Ordner,
# die nie ausgeliefert werden. Die Probe: sauberes Material, daneben ein von git
# AUSGENOMMENER Ordner mit dem kaputten Beispielmaterial.
# Git liefert Ausgenommenes nicht aus - nach einem frischen Abzug gaebe es den Ordner
# nicht, und die Probe waere von selbst gruen. Deshalb entsteht er erst hier und
# verschwindet danach wieder. Die Gegenprobe zeigt, dass die Probe ueberhaupt misst:
# Derselbe Inhalt OHNE git (Kopie ausserhalb jedes Repositorys) muss rot werden.
AUSG="$HIER/negativprobe/ausgenommen"
# Laeuft diese Selbstpruefung aus einem Haken heraus, koennen git-Variablen geerbt
# sein. Die Pruefungen legen sie selbst ab; die eine Abfrage hier unten auch.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
OHNE_GIT=$(mktemp -d 2>/dev/null) || OHNE_GIT=""
aufraeumen() {
  rm -rf "$AUSG/privat"
  [ -n "$OHNE_GIT" ] && rm -rf "$OHNE_GIT"
}
trap aufraeumen EXIT INT TERM
if [ -z "$OHNE_GIT" ] || ! git -C "$AUSG" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PROBEN=$((PROBEN + 1))
  FEHLER=$((FEHLER + 1))
  echo "  NEIN  nicht messbar: hier liegt kein git-Arbeitsbaum (oder kein Platz fuer die"
  echo "        Gegenprobe). Ohne git gibt es nichts Ausgenommenes - das ist kein Bestehen."
else
  rm -rf "$AUSG/privat"
  cp -R "$KAPUTT" "$AUSG/privat"
  cp -R "$AUSG/." "$OHNE_GIT/"
  for P in fakten-drift.py stiller-fehlschlag.py test-blind.py aussentext.py; do
    lauf "$P" "$AUSG" 0 "${P%.py} liest den von git ausgenommenen Ordner nicht"
    lauf "$P" "$OHNE_GIT" 1 "${P%.py} liest denselben Ordner, wenn kein git da ist (Gegenprobe)"
    # Nennt git zu einem Ordner NICHTS (hier: alles darin ist ausgenommen), ist das
    # zuerst ein Verdacht gegen das Messmittel. Die Pruefung liest dann den
    # Dateibaum - sie wird nie gruen, ohne eine Datei gelesen zu haben.
    lauf "$P" "$AUSG/privat" 1 "${P%.py}: nennt git zu einem Ordner nichts, wird er trotzdem gelesen"
  done
  # Eine geerbte git-Variable, die woandershin zeigt, aendert nichts: Gefragt wird das
  # Repository, in dem der Ordner liegt.
  GIT_DIR="$OHNE_GIT/gibt-es-nicht"
  export GIT_DIR
  for P in fakten-drift.py stiller-fehlschlag.py test-blind.py aussentext.py; do
    lauf "$P" "$AUSG" 0 "${P%.py} laesst sich von einer geerbten git-Variable nicht umlenken"
  done
  unset GIT_DIR
fi
aufraeumen
trap - EXIT INT TERM

echo "============================================================"
if [ "$FEHLER" -eq 0 ]; then
  # Die Zahl steht NUR hier und kommt aus dem Zaehler. Sie als Wort zu fuehren
  # hiess, sie irgendwann falsch zu fuehren (DOC-2026-08-12-07).
  echo "ERGEBNIS: alle $PROBEN Proben bestanden."
  echo "Die Pruefungen koennen rot werden und sind nicht ueberempfindlich."
  exit 0
fi
echo "ERGEBNIS: $FEHLER von $PROBEN Proben fehlgeschlagen."
echo "Eine Pruefung, die hier durchfaellt, ist selbst der Befund."
exit 1
