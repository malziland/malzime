#!/bin/sh
# nur-nachtrag.sh — Ist dieser Pull-Request ein reiner Auslieferungs-Nachtrag?
#
# ANLASS (16.09.2026): Nach jeder Auslieferung folgt ein Nachtrag-PR: neue
# Cache-Kennung in den Seiten, build-info.json, Versionszeile im CHANGELOG,
# Pruefstand-Stempel in docs/VERIFICATION.md. Alles davon ist zu diesem
# Zeitpunkt schon live und am Live-Stand nachgerechnet (pruefe-live.sh). Der
# Browser-Test lief trotzdem jedes Mal voll — gut zehn Minuten fuer einen
# Stand, der sich von der geprueften Fassung nur in Cache-Kennungen und Text
# unterscheidet.
#
# DIE REGEL, eng und fail-closed. "ja" nur, wenn ALLES zutrifft:
#   - es gibt eine Basis (nur bei Pull-Requests gesetzt) und sie ist auffindbar
#   - jede geaenderte Datei ist eine GEAENDERTE, gewoehnliche Datei: Status M,
#     Modus 100644 vorher und nachher (kein Symlink, kein Submodul, keine
#     Rechte-Aenderung, nichts Neues, Geloeschtes, Umbenanntes)
#   - jede Datei ist eine von:
#       CHANGELOG.md, docs/VERIFICATION.md  — reiner Text, nicht ausgeliefert
#       public/build-info.json               — gueltiger Fingerabdruck: Pflicht-
#                                              felder da, jede genannte Datei
#                                              existiert unter public/
#       Seiten mit Cache-Kennung (public/**.html, public/js/demo.js — dieselbe
#       Liste wie BUSTER_DATEIEN in deploy.sh) — und sie unterscheiden sich
#       von der Basis AUSSCHLIESSLICH in Kennungen der Form ?v=<10 Ziffern>"
#       (Konvention YYYYMMDDNN; andere Ziffernfolgen hinter ?v= koennen Code
#       sein, Befund der unabhaengigen Pruefung 16.09.2026)
# Jeder andere Fall ist "nein" — dann laeuft der volle Browser-Test.
#
# Ausgabe: `nur_nachtrag=ja|nein` auf stdout und, falls gesetzt, in
# $GITHUB_OUTPUT; dazu eine Zeile `Grund: …`.
# Rueckgabewert: 0 = Entscheidung steht ("ja" oder "nein"); 1 = technischer
# Fehler (Basis fehlt, git scheitert, Datei unlesbar) — dann steht zusaetzlich
# "nein" in der Ausgabe, und der Pflicht-Job scheitert laut.
# Eingabe: Umgebungsvariable BASIS (z. B. origin/main); leer = kein PR.
set -eu

ARBEIT=""

aufraeumen() {
  if [ -n "$ARBEIT" ]; then
    rm -rf "$ARBEIT"
  fi
}

ausgeben() {
  printf 'nur_nachtrag=%s\n' "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'nur_nachtrag=%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

ergebnis() {
  ausgeben "$1"
  # printf statt echo: Pfade mit \n duerfen keine eigenen Zeilen erzeugen.
  printf 'Grund: %s\n' "$2"
  aufraeumen
  exit 0
}

fehler() {
  ausgeben nein
  printf 'FEHLER: %s\n' "$1" >&2
  aufraeumen
  exit 1
}

BASIS="${BASIS:-}"
if [ -z "$BASIS" ]; then
  ergebnis nein "kein Pull-Request (BASIS leer) — main und Zeitplan pruefen immer voll"
fi
if ! git rev-parse --verify -q "$BASIS^{commit}" > /dev/null; then
  fehler "Basis $BASIS nicht auffindbar"
fi

ARBEIT=$(mktemp -d) || fehler "mktemp gescheitert"
LISTE="$ARBEIT/liste"
# --raw zeigt Modi und Status; --no-renames meldet Umbenennungen als D+A;
# --ignore-submodules=none zeigt auch Submodule, die .gitmodules ausblendet.
if ! git diff --raw --no-renames --ignore-submodules=none --no-abbrev "$BASIS" HEAD > "$LISTE"; then
  fehler "git diff gegen $BASIS gescheitert"
fi
if [ ! -s "$LISTE" ]; then
  ergebnis nein "keine Aenderung gegenueber $BASIS"
fi

# Liest eine Datei aus einem Stand in eine Datei — ohne Pipe, damit ein
# Fehler von git nicht hinter dem Rueckgabewert eines zweiten Befehls
# verschwindet.
lesen() {
  if ! git cat-file -e "$1:$2" 2> /dev/null; then
    fehler "$2 in $1 nicht lesbar"
  fi
  if ! git show "$1:$2" > "$3"; then
    fehler "$2 in $1 nicht lesbar"
  fi
}

# Ersetzt genau die Kennungs-Form ?v=<10 Ziffern>" durch einen Platzhalter.
normieren() {
  if ! sed 's/[?]v=[0-9]\{10\}"/?v=K"/g' "$1" > "$2"; then
    fehler "sed gescheitert"
  fi
}

TAB=$(printf '\t')
ANZAHL=0
# Zeilenformat von --raw: ":<modus_a> <modus_b> <sha_a> <sha_b> <status><TAB><pfad>"
while IFS="$TAB" read -r KOPF PFAD || [ -n "${KOPF:-}" ]; do
  [ -n "$KOPF" ] || continue
  # Zerlegen an Leerzeichen, ohne dass die Shell Platzhalter aufloest.
  set -f
  set -- $KOPF
  set +f
  MODUS_ALT="${1#:}"
  MODUS_NEU="$2"
  STATUS="$5"
  if [ "$STATUS" != "M" ]; then
    ergebnis nein "$PFAD hat Status $STATUS (nur geaenderte Dateien zaehlen als Nachtrag)"
  fi
  if [ "$MODUS_ALT" != "100644" ] || [ "$MODUS_NEU" != "100644" ]; then
    ergebnis nein "$PFAD hat Modus $MODUS_ALT -> $MODUS_NEU (nur gewoehnliche Dateien ohne Rechte-Aenderung)"
  fi
  case "$PFAD" in
    CHANGELOG.md | docs/VERIFICATION.md) ;;
    public/build-info.json)
      lesen HEAD "$PFAD" "$ARBEIT/fingerabdruck"
      if ! git ls-tree -r --name-only HEAD public/ > "$ARBEIT/dateien"; then
        fehler "Dateiliste von public/ nicht lesbar"
      fi
      if ! node -e '
        const fs = require("fs");
        const [, fingerabdruck, dateiliste] = process.argv;
        const j = JSON.parse(fs.readFileSync(fingerabdruck, "utf8"));
        const vorhanden = new Set(fs.readFileSync(dateiliste, "utf8").split("\n").filter(Boolean));
        const d = j.dateien;
        const ok =
          typeof j.commit === "string" && j.commit.length >= 7 &&
          typeof j.cacheBuster === "string" && /^[0-9]{10}$/.test(j.cacheBuster) &&
          typeof j.ausgeliefertAm === "string" && j.ausgeliefertAm.length > 0 &&
          d !== null && typeof d === "object" && !Array.isArray(d) &&
          Object.keys(d).length > 0 &&
          Object.keys(d).every((p) => vorhanden.has("public/" + p));
        process.exit(ok ? 0 : 1);' "$ARBEIT/fingerabdruck" "$ARBEIT/dateien" 2> /dev/null; then
        ergebnis nein "public/build-info.json ist kein gueltiger Fingerabdruck"
      fi
      ;;
    public/*.html | public/js/demo.js)
      lesen "$BASIS" "$PFAD" "$ARBEIT/alt-roh"
      lesen HEAD "$PFAD" "$ARBEIT/neu-roh"
      normieren "$ARBEIT/alt-roh" "$ARBEIT/alt"
      normieren "$ARBEIT/neu-roh" "$ARBEIT/neu"
      if ! cmp -s "$ARBEIT/alt" "$ARBEIT/neu"; then
        ergebnis nein "$PFAD aendert mehr als die Cache-Kennung"
      fi
      ;;
    *)
      ergebnis nein "$PFAD gehoert nicht zu einem Nachtrag"
      ;;
  esac
  ANZAHL=$((ANZAHL + 1))
done < "$LISTE"

ergebnis ja "nur Nachtrag ($ANZAHL Dateien: Cache-Kennung, Fingerabdruck, Version, Pruefstand)"
