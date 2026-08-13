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
    # jest / vitest / mocha. TEST-2026-08-12-06, in zwei Schritten gelernt:
    #   1. BELIEBIG VIELE Zusaetze, nicht nur einer — sonst blieb
    #      `test.skip.each(...)` unsichtbar.
    #   2. Und hinter der Klammer darf ALLES stehen. Die erste Fassung verlangte
    #      dort ein Anfuehrungszeichen und uebersah damit weiterhin die
    #      haeufigste Tabellenform ueberhaupt: `test.each(liste.map(...))`.
    #      Zwei Anlaeufe fuer dieselbe Zeile — die zweite Fassung war am
    #      Beispielmaterial gruen und am echten Projekt trotzdem blind.
    # Der Name muss am Zeilenanfang stehen und genau `it`/`test` heissen;
    # `testHelper(` faellt damit nicht darunter. Die Schablonenform
    # (`test.each` + Rueckstrich) kommt ohne Klammer aus.
    # Ausgenommen sind die Mitglieder, die KONFIGURIEREN statt zu deklarieren
    # (`test.setTimeout(...)`, `test.use(...)`, `test.step(...)`). Ohne diese
    # Ausnahme meldet die Pruefung sie als Tests ohne Zusicherung — und schneidet
    # obendrein den echten Test darueber mitten entzwei, sodass dessen
    # Zusicherung ungesehen bleibt. Ein Fehlalarm, der einen zweiten erzeugt.
    # 2026-08-13: `describe` gehoert ebenfalls dazu. `test.describe("…", () => {…})`
    # ist eine GRUPPE, kein Test — die Zusicherungen stehen in den Tests darin.
    # Ohne diese Ausnahme meldete die Pruefung jede Playwright-Gruppe als
    # „Test ohne Zusicherung": derselbe Fehlalarm wie bei `test.use`, nur eine
    # Zeile weiter.
    r"(?:it|test)(?!\s*\.\s*(?:setTimeout|use|slow|info|step|extend|describe|before\w+|after\w+)\b)"
    r"\s*(?:\.\w+)*\s*(?:\(|`)|"
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

# Begruendetes Ueberspringen (KERN 12). Der Grund ist Pflicht: Ein Marker ohne
# Text waere eine Abschaltung mit Tarnkappe. Was hier steht, taucht im Bericht
# auf — die Abweichung bleibt sichtbar, sie wird nur nicht mehr als Mangel
# gezaehlt.
BEGRUENDET = re.compile(r"pruefungen:uebersprungen-weil[ \t]+(.+)")

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


def offen_danach(zeile, offen):
    """Steht nach dieser Zeile noch ein mehrzeiliger Text offen? Gezaehlt werden
    Backticks (JS/TS) und dreifache Anfuehrungszeichen (Python)."""
    marken = zeile.count("`") + zeile.count('"""') + zeile.count("'''")
    return (offen + marken) % 2


def bloecke(zeilen):
    """Grobe Blockbildung: von einem Testbeginn bis zum naechsten oder bis die
    Einrueckung wieder auf oder unter das Ausgangsniveau faellt.

    Innerhalb eines mehrzeiligen Textes zaehlt die Einrueckung NICHT. Ein
    Textblock enthaelt regelmaessig Zeilen ohne jede Einrueckung; ohne diese
    Ausnahme endete der Block dort, die Zusicherung dahinter blieb ungesehen und
    der Test galt faelschlich als blind (Fehlalarm bis 2026-08-12)."""
    treffer = [i for i, z in enumerate(zeilen) if TESTBEGINN.search(z)]
    for pos, start in enumerate(treffer):
        ende = treffer[pos + 1] if pos + 1 < len(treffer) else len(zeilen)
        basis = einruecken(zeilen[start])
        offen = offen_danach(zeilen[start], 0)
        for i in range(start + 1, ende):
            roh = zeilen[i]
            if not offen and roh.strip() and einruecken(roh) <= basis \
                    and not roh.strip().startswith(("}", ")", "]")):
                ende = i
                break
            offen = offen_danach(roh, offen)
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
    begruendet = []

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
                # Nicht jedes Ueberspringen ist ein Versaeumnis: Ein Test, der
                # ein Werkzeug braucht, das in dieser Umgebung fehlt, ist
                # uebersprungen richtiger als mit einer Schein-Zusicherung
                # gruen. Wer das behauptet, schreibt die Begruendung daneben —
                # dann bleibt die Abweichung sichtbar, statt zu verschwinden
                # (KERN 12). Ohne Begruendungstext gilt der Marker nicht.
                erlaubt = BEGRUENDET.search(block) or BEGRUENDET.search(vorlauf)
                if erlaubt and erlaubt.group(1).strip():
                    begruendet.append((kurz, start + 1, erlaubt.group(1).strip()))
                    continue
                funde.append((kurz, start + 1, kopf, "uebersprungen",
                              "Ein uebersprungener Test zaehlt als Abdeckung und "
                              "prueft nichts. Reparieren, loeschen — oder mit "
                              "'pruefungen:uebersprungen-weil <Grund>' begruenden."))
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

    # Begruendet Uebersprungene werden AUSGEGEBEN, nicht verschwiegen. Eine
    # Ausnahme, die niemand mehr sieht, ist nach zwei Monaten keine Ausnahme
    # mehr, sondern der Normalzustand.
    if begruendet:
        print(f"\nBegruendet uebersprungen ({len(begruendet)}) — bleibt sichtbar, zaehlt nicht als Mangel:")
        for kurz, nr, grund in begruendet:
            print(f"  {kurz}:{nr}  {grund}")

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
