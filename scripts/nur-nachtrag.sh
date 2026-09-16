#!/bin/sh
# nur-nachtrag.sh — Ist dieser Pull-Request ein reiner Auslieferungs-Nachtrag?
#
# ANLASS (16.09.2026): Nach jeder Auslieferung folgt ein Nachtrag-PR: neue
# Cache-Kennung in den Seiten, build-info.json, Versionszeile im CHANGELOG,
# Pruefstand-Stempel in docs/VERIFICATION.md. Alles davon ist zu diesem
# Zeitpunkt schon live und am Live-Stand nachgerechnet (pruefe-live.sh). Der
# Browser-Test lief trotzdem jedes Mal voll — gut zehn Minuten fuer einen
# Stand, der sich von der geprueften Fassung nur in `?v=`-Kennungen und Text
# unterscheidet.
#
# DIE REGEL, eng und fail-closed. "ja" nur, wenn ALLES zutrifft:
#   - es gibt eine Basis (nur bei Pull-Requests gesetzt) und sie ist auffindbar
#   - jede geaenderte Datei ist GEAENDERT (nicht neu, geloescht, umbenannt)
#   - jede Datei ist eine von:
#       CHANGELOG.md, docs/VERIFICATION.md  — reiner Text, nicht ausgeliefert
#       public/build-info.json               — muss gueltiges JSON mit
#                                              commit und dateien sein
#       Seiten mit Cache-Kennung (public/**.html, public/js/demo.js — dieselbe
#       Liste wie BUSTER_DATEIEN in deploy.sh) — und sie unterscheiden sich
#       von der Basis AUSSCHLIESSLICH in `?v=<Ziffern>`
# Jeder andere Fall, jeder Fehler, jede fehlende Angabe: "nein" — dann laeuft
# der volle Browser-Test.
#
# Ausgabe: `nur_nachtrag=ja|nein` auf stdout und, falls gesetzt, in
# $GITHUB_OUTPUT; dazu eine Zeile `Grund: …`. Rueckgabewert 0, sobald eine
# Entscheidung steht (auch "nein" ist eine Entscheidung, und die sichere).
# Eingabe: Umgebungsvariable BASIS (z. B. origin/main); leer = kein PR.

ergebnis() {
  echo "nur_nachtrag=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "nur_nachtrag=$1" >> "$GITHUB_OUTPUT"
  fi
  echo "Grund: $2"
  rm -f "${ALT:-}" "${NEU:-}"
  exit 0
}

BASIS="${BASIS:-}"
if [ -z "$BASIS" ]; then
  ergebnis nein "kein Pull-Request (BASIS leer) — main und Zeitplan pruefen immer voll"
fi
if ! git rev-parse --verify -q "$BASIS^{commit}" > /dev/null; then
  ergebnis nein "Basis $BASIS nicht auffindbar"
fi
if ! LISTE=$(git diff --name-status "$BASIS" HEAD); then
  ergebnis nein "git diff gegen $BASIS gescheitert"
fi
if [ -z "$LISTE" ]; then
  ergebnis nein "keine Aenderung gegenueber $BASIS"
fi

ALT=$(mktemp)
NEU=$(mktemp)
# Eine Zeile je Datei: "<Status><TAB><Pfad>". Tabulator als Trenner, damit
# Leerzeichen im Pfad nichts verschieben.
TAB=$(printf '\t')
ANZAHL=0
while IFS="$TAB" read -r STATUS PFAD REST; do
  [ -n "$STATUS" ] || continue
  if [ "$STATUS" != "M" ] || [ -n "$REST" ]; then
    ergebnis nein "$PFAD hat Status $STATUS (nur geaenderte Dateien zaehlen als Nachtrag)"
  fi
  case "$PFAD" in
    CHANGELOG.md | docs/VERIFICATION.md)
      ;;
    public/build-info.json)
      if ! git show "HEAD:$PFAD" | node -e '
        let t = "";
        process.stdin.on("data", (d) => (t += d));
        process.stdin.on("end", () => {
          const j = JSON.parse(t);
          const ok = typeof j.commit === "string" && j.commit.length >= 7 &&
            j.dateien && typeof j.dateien === "object" && Object.keys(j.dateien).length > 0;
          process.exit(ok ? 0 : 1);
        });' 2> /dev/null; then
        ergebnis nein "public/build-info.json ist kein gueltiger Fingerabdruck"
      fi
      ;;
    public/*.html | public/js/demo.js)
      if ! git show "$BASIS:$PFAD" | sed 's/[?]v=[0-9][0-9]*/?v=K/g' > "$ALT"; then
        ergebnis nein "$PFAD in der Basis nicht lesbar"
      fi
      if ! git show "HEAD:$PFAD" | sed 's/[?]v=[0-9][0-9]*/?v=K/g' > "$NEU"; then
        ergebnis nein "$PFAD im PR nicht lesbar"
      fi
      if ! cmp -s "$ALT" "$NEU"; then
        ergebnis nein "$PFAD aendert mehr als die Cache-Kennung"
      fi
      ;;
    *)
      ergebnis nein "$PFAD gehoert nicht zu einem Nachtrag"
      ;;
  esac
  ANZAHL=$((ANZAHL + 1))
done << LISTE_ENDE
$LISTE
LISTE_ENDE

ergebnis ja "nur Nachtrag ($ANZAHL Dateien: Cache-Kennung, Fingerabdruck, Version, Pruefstand)"
