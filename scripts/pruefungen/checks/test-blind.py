#!/usr/bin/env python3
"""test-blind.py — findet Tests, die rechnerisch nicht rot werden koennen.

Umsetzung von KERN 4 Frage 2 ("kann sie ueberhaupt scheitern?") als Pruefung. Ein Test
ohne Zusicherung, ein uebersprungener Test und eine immer wahre Zusicherung sind gruen,
egal was der Code tut. Sie zaehlen als Abdeckung und decken nichts ab.

Sprachneutral ueber Muster gaengiger Rahmenwerke: pytest, unittest, jest, vitest,
mocha, go test, JUnit.

Aufruf:  python3 test-blind.py [verzeichnis]
Exit 0 = sauber, Exit 1 = Fundstellen, Exit 2 = Aufrufproblem.
"""
import os
import re
import sys

TESTDATEI = re.compile(
    r"(?:^|[/\\])(?:test_[^/\\]+|[^/\\]+_test|[^/\\]+\.(?:test|spec))\.[a-z]+$|"
    r"(?:^|[/\\])(?:tests?|__tests__|spec)[/\\]", re.I)
ENDUNGEN = (".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".java", ".rb", ".php", ".rs")
# "negativprobe": eigenes Beispielmaterial dieser Pruefungen, sonst Dauerfunde.
UEBERSPRINGEN = {".git", "node_modules", "vendor", "dist", "build", ".venv",
                 "__pycache__", "target", "coverage", "negativprobe"}

# Beginn einer Testfunktion in gaengigen Rahmenwerken.
TESTBEGINN = re.compile(
    r"^\s*(?:"
    r"def\s+test\w*\s*\(|"                       # pytest / unittest
    r"(?:it|test)\s*(?:\.\w+)?\s*\(\s*[\"'`]|"   # jest / vitest / mocha
    r"func\s+Test\w*\s*\(|"                      # go
    r"(?:public\s+)?void\s+test\w*\s*\("         # junit
    r")", re.I)

ZUSICHERUNG = re.compile(
    r"\b(?:assert\w*|expect|should|require\.|assert_\w+|t\.Error|t\.Fatal|"
    r"toBe|toEqual|toThrow|toHaveBeen|verify|checkThat|"
    # Eine erwartete Ausnahme ist eine vollwertige Zusicherung: der Test wird rot,
    # wenn sie ausbleibt. Ohne diese Formen meldet die Pruefung Fehlalarm.
    r"raises|assertRaises|rejects|expectException|willThrow|ShouldPanic)\b", re.I)

UEBERSPRUNGEN = re.compile(
    r"(?:@(?:pytest\.mark\.)?skip|@Ignore|\bit\.skip|\btest\.skip|\bxit\b|\bxdescribe\b|"
    r"\bdescribe\.skip|\.todo\b|t\.Skip\(|@unittest\.skip|pytest\.skip\()", re.I)

IMMER_WAHR = re.compile(
    r"(?:assert\s+True\b|assert\s+1\s*==\s*1|assertTrue\s*\(\s*True\s*\)|"
    r"expect\s*\(\s*true\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*true\s*\)|"
    r"expect\s*\(\s*1\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*1\s*\)|"
    r"assert\s*\(\s*true\s*\)|assertEquals\s*\(\s*1\s*,\s*1\s*\))", re.I)


def testdateien(wurzel):
    for ordner, unterordner, namen in os.walk(wurzel):
        unterordner[:] = [u for u in unterordner
                          if u not in UEBERSPRINGEN and not u.startswith(".")]
        for name in namen:
            pfad = os.path.join(ordner, name)
            if name.lower().endswith(ENDUNGEN) and TESTDATEI.search(pfad):
                yield pfad


def einruecken(zeile):
    return len(zeile) - len(zeile.lstrip())


def bloecke(zeilen):
    """Grobe Blockbildung: von einem Testbeginn bis zum naechsten oder bis die
    Einrueckung wieder auf oder unter das Ausgangsniveau faellt."""
    treffer = [i for i, z in enumerate(zeilen) if TESTBEGINN.search(z)]
    for pos, start in enumerate(treffer):
        ende = treffer[pos + 1] if pos + 1 < len(treffer) else len(zeilen)
        basis = einruecken(zeilen[start])
        for i in range(start + 1, ende):
            roh = zeilen[i]
            if roh.strip() and einruecken(roh) <= basis and not roh.strip().startswith(
                    ("}", ")", "]")):
                ende = i
                break
        yield start, ende


def main():
    wurzel = sys.argv[1] if len(sys.argv) > 1 else "."
    if not os.path.isdir(wurzel):
        print(f"FEHLER: kein Verzeichnis: {wurzel}")
        return 2

    print("TESTS, DIE NICHT ROT WERDEN KOENNEN")
    print(f"Geprueft unter: {os.path.abspath(wurzel)}")
    print("-" * 60)

    dateien = 0
    tests = 0
    funde = []

    for pfad in testdateien(wurzel):
        dateien += 1
        try:
            with open(pfad, encoding="utf-8", errors="replace") as f:
                zeilen = f.readlines()
        except OSError:
            continue
        kurz = os.path.relpath(pfad, wurzel)

        for start, ende in bloecke(zeilen):
            tests += 1
            block = "".join(zeilen[start:ende])
            kopf = zeilen[start].strip()[:60]
            vorlauf = "".join(zeilen[max(0, start - 3):start])

            if UEBERSPRUNGEN.search(block) or UEBERSPRUNGEN.search(vorlauf):
                funde.append((kurz, start + 1, kopf, "uebersprungen",
                              "Ein uebersprungener Test zaehlt als Abdeckung und "
                              "prueft nichts. Reparieren oder loeschen."))
                continue
            if IMMER_WAHR.search(block):
                funde.append((kurz, start + 1, kopf, "immer wahr",
                              "Die Zusicherung ist unabhaengig vom Code wahr."))
                continue
            if not ZUSICHERUNG.search(block):
                funde.append((kurz, start + 1, kopf, "ohne Zusicherung",
                              "Der Test laeuft durch, ohne etwas zu behaupten. Er wird "
                              "nur rot, wenn der Code abstuerzt."))

    if dateien == 0:
        print("Keine Testdateien gefunden. Ohne Suchflaeche keine Aussage. Das ist")
        print("kein bestandener Test, sondern ein Befund ueber die Suche oder das")
        print("Projekt.")
        return 2

    print(f"Testdateien: {dateien}, erkannte Tests: {tests}")
    for kurz, nr, kopf, art, rat in funde:
        print(f"\n{kurz}:{nr}  [{art}]")
        print(f"  {kopf}")
        print(f"  {rat}")

    print("-" * 60)
    if not funde:
        print(f"ERGEBNIS: alle {tests} erkannten Tests koennen scheitern.")
        print("Das sagt nichts darueber, ob sie das Richtige pruefen.")
        return 0
    print(f"ERGEBNIS: {len(funde)} von {tests} Tests koennen so nicht rot werden.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
