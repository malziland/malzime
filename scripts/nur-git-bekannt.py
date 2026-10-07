#!/usr/bin/env python3
"""nur-git-bekannt.py — richtet eine Verzeichnis-Pruefung auf das, was git kennt.

Manche Pruefungen lesen ein ganzes Verzeichnis (die vendorierten unter
scripts/pruefungen/ etwa). Am Arbeitsrechner liegen im Projektordner auch Ordner, die
`.gitignore` ausnimmt: private Berichte, Uebergaben, Sicherungen. Sie gehen nie in die
Pipeline — dort gibt es sie nicht. Lokal aber liest die Pruefung sie mit und wird rot
fuer etwas, das niemand ausliefert (TEST-2026-10-04-29).

Dieses Skript baut einen Spiegel des aktuellen Verzeichnisses, der genau die Dateien
enthaelt, die git kennt — eingecheckte und neue, aber keine ausgenommenen —, und ruft
den uebergebenen Befehl mit dem Spiegel als LETZTEM Argument auf. Der Spiegel besteht
aus Verweisen, nicht aus Kopien, und wird danach entfernt.

Aufruf (aus der Projektwurzel):
    python3 scripts/nur-git-bekannt.py <befehl> [argumente ...]
Beispiel:
    python3 scripts/nur-git-bekannt.py python3 scripts/pruefungen/checks/fakten-drift.py

Rueckgabewert: der des Befehls. 2 = nicht messbar (kein git-Arbeitsbaum, keine Datei,
Befehl nicht ausfuehrbar) — nie als bestanden werten.
"""
import os
import subprocess
import sys
import tempfile


def git_bekannt():
    """Pfade relativ zum aktuellen Verzeichnis; `None`, wenn git sie nicht nennen kann."""
    try:
        lauf = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."],
            capture_output=True, check=False)
    except OSError:
        return None
    if lauf.returncode != 0:
        return None
    return sorted({p for p in lauf.stdout.decode("utf-8", errors="replace").split("\0") if p})


def main():
    befehl = sys.argv[1:]
    if not befehl:
        print("FEHLER: kein Befehl angegeben. Aufruf: nur-git-bekannt.py <befehl> [argumente ...]",
              file=sys.stderr)
        return 2

    bekannt = git_bekannt()
    if bekannt is None:
        print("NICHT MESSBAR: git nennt keine Dateien — kein git-Arbeitsbaum oder git fehlt.",
              file=sys.stderr)
        return 2

    hier = os.getcwd()
    with tempfile.TemporaryDirectory(prefix="nur-git-bekannt-") as spiegel:
        gespiegelt = 0
        for relativ in bekannt:
            quelle = os.path.join(hier, *relativ.split("/"))
            # Im Index, aber im Arbeitsbaum geloescht: nichts zu pruefen.
            if not os.path.isfile(quelle):
                continue
            ziel = os.path.join(spiegel, *relativ.split("/"))
            os.makedirs(os.path.dirname(ziel), exist_ok=True)
            os.symlink(quelle, ziel)
            gespiegelt += 1
        if gespiegelt == 0:
            print("NICHT MESSBAR: git kennt hier keine einzige Datei — ohne Suchflaeche keine Aussage.",
                  file=sys.stderr)
            return 2
        print(f"Geprueft wird nur, was git kennt: {gespiegelt} Dateien "
              f"(von .gitignore ausgenommene Ordner bleiben draussen).", flush=True)
        try:
            return subprocess.run(befehl + [spiegel], check=False).returncode
        except OSError as fehler:
            print(f"NICHT MESSBAR: Befehl nicht ausfuehrbar: {fehler}", file=sys.stderr)
            return 2


if __name__ == "__main__":
    sys.exit(main())
