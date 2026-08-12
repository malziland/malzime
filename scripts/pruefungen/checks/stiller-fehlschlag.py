#!/usr/bin/env python3
"""stiller-fehlschlag.py — findet Stellen, an denen ein Fehlschlag wie Erfolg aussieht.

Der belegte Vorfall dahinter: Ein Push wurde abgelehnt, die Meldung sagte trotzdem
Erfolg, die Korrektur landete nie, die Auslieferung lief weiter. Umsetzung von
KERN 5c ("jeder Kanal hat eine Fehlerform, die wie Erfolg aussieht") als Pruefung.

Aufruf:  python3 stiller-fehlschlag.py [verzeichnis]
Exit 0 = sauber, Exit 1 = Fundstellen, Exit 2 = Aufrufproblem.
"""
import os
import re
import sys

ENDUNGEN = (".sh", ".bash", ".zsh", ".yml", ".yaml")
# "negativprobe": eigenes Beispielmaterial dieser Pruefungen, sonst Dauerfunde.
UEBERSPRINGEN = {".git", "node_modules", "vendor", "dist", "build", ".venv",
                 "__pycache__", "target", "coverage", "negativprobe"}

ERFOLGSWORT = (r"(?:erfolg|erledigt|fertig|gruen|ok\b|done|success|passed|"
               r"deployed|veroeffentlicht|abgeschlossen|✓|✅)")

REGELN = [
    (
        "Erfolgsmeldung nach Semikolon",
        re.compile(r";\s*(?:echo|print|printf)\b[^\n]*" + ERFOLGSWORT, re.I),
        "Das Semikolon fuehrt die Meldung auch aus, wenn der Befehl davor scheitert. "
        "Mit && verketten, dann haengt die Meldung am Rueckgabewert.",
    ),
    (
        "Fehler wird verschluckt",
        re.compile(r"\|\|\s*(?:true|:)\s*$", re.M),
        "|| true macht aus jedem Fehlschlag einen Erfolg. Nur zulaessig, wenn der "
        "Rueckgabewert danach ausdruecklich geprueft und gemeldet wird.",
    ),
    (
        "Ausgabe verworfen und Fehler mit",
        re.compile(r">\s*/dev/null\s+2>&1\s*(?:;|$)", re.M),
        "Ohne anschliessende Pruefung des Rueckgabewerts ist nicht unterscheidbar, "
        "ob der Befehl lief oder scheiterte.",
    ),
    (
        "Rueckgabewert nach Pipe",
        re.compile(r"\|[^\n|]+\n[^\n]*\$\?", re.M),
        "Nach einer Pipe liefert $? den Wert des LETZTEN Befehls, nicht des ersten. "
        "Mit set -o pipefail arbeiten oder den Wert direkt abfragen.",
    ),
    (
        "Leeres Suchergebnis als Ergebnis gelesen",
        re.compile(r"(?:grep|rg|ag)\b[^\n|]*\|\s*(?:wc|head|tail)\b[^\n]*\n"
                   r"(?![^\n]*(?:if|test|\[)).*?" + ERFOLGSWORT, re.I | re.S),
        "Eine Suche, die nichts findet, und eine Suche, die scheitert, sehen gleich "
        "aus. Positivkontrolle noetig: an bekannter Fundstelle muss sie anschlagen.",
    ),
]

# Fuer Shell-Skripte zusaetzlich: fehlendes set -e ist die Grundform des Problems.
SET_E = re.compile(r"^\s*set\s+-[a-z]*e", re.M)
SHELL_ENDUNGEN = (".sh", ".bash", ".zsh")


def dateien(wurzel):
    for ordner, unterordner, namen in os.walk(wurzel):
        unterordner[:] = [u for u in unterordner
                          if u not in UEBERSPRINGEN and not u.startswith(".")]
        for name in namen:
            if name.lower().endswith(ENDUNGEN):
                yield os.path.join(ordner, name)


def main():
    wurzel = sys.argv[1] if len(sys.argv) > 1 else "."
    if not os.path.isdir(wurzel):
        print(f"FEHLER: kein Verzeichnis: {wurzel}")
        return 2

    print("STILLER FEHLSCHLAG")
    print(f"Geprueft unter: {os.path.abspath(wurzel)}")
    print("-" * 60)

    geprueft = 0
    funde = []

    for pfad in dateien(wurzel):
        geprueft += 1
        try:
            with open(pfad, encoding="utf-8", errors="replace") as f:
                inhalt = f.read()
        except OSError:
            continue
        kurz = os.path.relpath(pfad, wurzel)

        for name, ausdruck, rat in REGELN:
            for treffer in ausdruck.finditer(inhalt):
                zeile = inhalt.count("\n", 0, treffer.start()) + 1
                text = treffer.group(0).strip().splitlines()[0][:70]
                funde.append((kurz, zeile, name, text, rat))

        if pfad.lower().endswith(SHELL_ENDUNGEN) and not SET_E.search(inhalt):
            funde.append((kurz, 1, "Kein set -e",
                          "Skript bricht bei Fehlern nicht ab",
                          "Ohne set -e laeuft das Skript nach einem Fehlschlag weiter "
                          "und kann am Ende Erfolg melden."))

    if geprueft == 0:
        print("Keine Skript- oder Pipeline-Dateien gefunden. Ohne Suchflaeche keine")
        print("Aussage. Das ist kein bestandener Test.")
        return 2

    print(f"Dateien: {geprueft}")
    for kurz, zeile, name, text, rat in funde:
        print(f"\n{kurz}:{zeile}  {name}")
        print(f"  Stelle:  {text}")
        print(f"  Abhilfe: {rat}")

    print("-" * 60)
    if not funde:
        print("ERGEBNIS: keine Fundstellen.")
        return 0
    print(f"ERGEBNIS: {len(funde)} Fundstelle(n). Jede Erfolgsmeldung gehoert an den")
    print("Rueckgabewert des Befehls, ueber den sie etwas behauptet.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
