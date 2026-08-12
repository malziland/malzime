#!/usr/bin/env python3
"""fakten-drift.py — findet Fakten, die an mehreren Stellen verschieden stehen.

Deckt die haeufigste Befundklasse ab: dieselbe Zahl in README, CHANGELOG und
Verifikationsmatrix, dreifach verschieden. Umsetzung der Ein-Quellen-Regel (KERN 11)
als Pruefung statt als Bitte.

Aufruf:  python3 fakten-drift.py [verzeichnis]
Exit 0 = kein Drift, Exit 1 = Drift gefunden, Exit 2 = Aufrufproblem.

Eigene Muster: eine Datei .pruefungen/fakten.txt anlegen, je Zeile
    <Bezeichnung>|<regulaerer Ausdruck mit genau einer Klammergruppe>
Beispiel:
    Zeilenlimit|max(?:imal)?\\s+(\\d+)\\s+Zeilen
"""
import os
import re
import sys

# Nur Textdateien, in denen Fakten behauptet werden. Code bleibt aussen vor:
# dort ist eine Zahl eine Implementierung, keine Behauptung.
ENDUNGEN = (".md", ".markdown", ".txt", ".rst", ".adoc")
# "negativprobe": eigenes Beispielmaterial dieser Pruefungen, sonst Dauerfunde.
UEBERSPRINGEN = {".git", "node_modules", "vendor", "dist", "build", ".venv",
                 "__pycache__", ".next", "target", "coverage", "negativprobe"}

# Historien-Dokumente halten vergangene Staende fest. Dass dort andere Zahlen
# stehen als heute, ist ihr Zweck und kein Widerspruch — ein Changelog mit 27
# verschiedenen Testzahlen ist ein gutes Changelog. Sie als Drift zu melden
# erzeugt einen Befund, der sich nur beheben laesst, indem man die Historie
# faelscht (Fehlalarm bis 2026-08-12).
HISTORIENDATEIEN = ("changelog", "history", "releases", "release-notes",
                    "aenderungen", "changes")

# Eingebaute Muster. Bezeichnung -> regulaerer Ausdruck mit einer Klammergruppe.
MUSTER = {
    "Testanzahl": r"(\d[\d.']*)\s*(?:Tests?|Testfaelle|test cases?)\b",
    "Testabdeckung": r"(?:Coverage|Abdeckung|Testabdeckung)[^\d\n]{0,20}(\d{1,3})\s*%",
    "Version": r"\bVersion\s+v?(\d+\.\d+(?:\.\d+)?)",
    "Node-Version": r"[Nn]ode(?:\.js)?\s+v?(\d+(?:\.\d+)*)",
    "Python-Version": r"[Pp]ython\s+v?(\d+\.\d+(?:\.\d+)?)",
    "Port": r"\b[Pp]ort\s+(\d{2,5})\b",
    "Aufbewahrungsfrist": r"(\d+)\s*(?:Tage|Tagen)\b",
}


def eigene_muster(wurzel):
    pfad = os.path.join(wurzel, ".pruefungen", "fakten.txt")
    if not os.path.isfile(pfad):
        return {}
    zusatz = {}
    with open(pfad, encoding="utf-8", errors="replace") as f:
        for nr, zeile in enumerate(f, 1):
            zeile = zeile.strip()
            if not zeile or zeile.startswith("#"):
                continue
            if "|" not in zeile:
                print(f"  Hinweis: {pfad}:{nr} ohne Trennzeichen |, uebersprungen")
                continue
            name, ausdruck = zeile.split("|", 1)
            try:
                if re.compile(ausdruck).groups != 1:
                    print(f"  Hinweis: {pfad}:{nr} braucht genau eine Klammergruppe")
                    continue
                zusatz[name.strip()] = ausdruck
            except re.error as fehler:
                print(f"  Hinweis: {pfad}:{nr} ungueltiger Ausdruck: {fehler}")
    return zusatz


def dateien(wurzel):
    for ordner, unterordner, namen in os.walk(wurzel):
        unterordner[:] = [u for u in unterordner
                          if u not in UEBERSPRINGEN and not u.startswith(".")]
        for name in namen:
            if not name.lower().endswith(ENDUNGEN):
                continue
            stamm = os.path.splitext(name)[0].lower()
            if stamm in HISTORIENDATEIEN:
                continue
            yield os.path.join(ordner, name)


def main():
    wurzel = sys.argv[1] if len(sys.argv) > 1 else "."
    if not os.path.isdir(wurzel):
        print(f"FEHLER: kein Verzeichnis: {wurzel}")
        return 2

    # Legt das Projekt eigene Muster fest, gelten NUR diese. Die eingebauten sind
    # ein Startpunkt fuer Projekte, die noch nicht entschieden haben, welche Zahlen
    # bei ihnen kanonisch sind — als Dauerbetrieb taugen sie nicht: "(\d+) Tage"
    # haelt eine Aufbewahrungsfrist, eine Karenzzeit und eine Pruefperiode fuer
    # denselben Fakt und meldet Widersprueche, die keine sind (Fehlalarm bis
    # 2026-08-12). Wer die Pruefung in eine Pipeline haengt, schreibt seine Muster
    # in .pruefungen/fakten.txt.
    eigene = eigene_muster(wurzel)
    muster = eigene if eigene else dict(MUSTER)

    # bezeichnung -> wert -> Liste von Fundstellen
    funde = {name: {} for name in muster}
    geprueft = 0

    for pfad in dateien(wurzel):
        geprueft += 1
        try:
            with open(pfad, encoding="utf-8", errors="replace") as f:
                zeilen = f.readlines()
        except OSError:
            continue
        for nr, zeile in enumerate(zeilen, 1):
            # Ein Wert mit Datum oder Stand daneben ist nach KERN 11 zulaessig.
            if re.search(r"Stand\s+\d{4}-\d{2}-\d{2}|Commit\s+[0-9a-f]{7}", zeile):
                continue
            for name, ausdruck in muster.items():
                for treffer in re.finditer(ausdruck, zeile):
                    wert = treffer.group(1).replace("'", "").replace(".", "")
                    funde[name].setdefault(wert, []).append(
                        f"{os.path.relpath(pfad, wurzel)}:{nr}")

    print("FAKTEN-DRIFT")
    print(f"Geprueft: {geprueft} Textdateien unter {os.path.abspath(wurzel)}")
    herkunft = "aus .pruefungen/fakten.txt" if eigene else "eingebaut, nicht konfiguriert"
    print(f"Muster: {len(muster)} ({herkunft})")
    print("-" * 60)

    if geprueft == 0:
        print("Keine Textdateien gefunden. Ohne Suchflaeche keine Aussage.")
        return 2

    treffer_gesamt = 0
    for name, werte in sorted(funde.items()):
        if len(werte) < 2:
            continue
        # Mehrere verschiedene Werte fuer denselben Fakt.
        treffer_gesamt += 1
        print(f"\nDRIFT: {name} steht mit {len(werte)} verschiedenen Werten da.")
        for wert, stellen in sorted(werte.items(), key=lambda p: -len(p[1])):
            orte = ", ".join(stellen[:4])
            mehr = f" (+{len(stellen) - 4} weitere)" if len(stellen) > 4 else ""
            print(f"  {wert:<12} {orte}{mehr}")
        print("  Abhilfe: eine kanonische Quelle bestimmen, andere Stellen verweisen")
        print("  lassen oder den Wert weglassen. Nicht alle Kopien nachziehen.")

    print("-" * 60)
    if treffer_gesamt == 0:
        print("ERGEBNIS: kein Drift gefunden.")
        return 0
    print(f"ERGEBNIS: {treffer_gesamt} Fakt(en) driften. Ein-Quellen-Regel anwenden.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
