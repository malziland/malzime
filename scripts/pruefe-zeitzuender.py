#!/usr/bin/env python3
"""zeitzuender.py — findet Tests, die an einem festen Datum von selbst rot werden.

Die Fehlerform (TEST-2026-08-20-01, belegter Schaden): Im Produktivcode steht ein fester
Zeitpunkt (`Date.parse("2026-08-12T00:00:00Z")`), gegen den zur Laufzeit die echte Uhr
gerechnet wird. Der zugehoerige Test benutzt ebenfalls die echte Uhr. Er ist gruen — bis
zu einem vorher berechenbaren Tag. Danach ist er bei JEDEM Lauf rot, ohne dass jemand
etwas geaendert hat, und blockiert als Pflicht-Check jede Auslieferung. Gefunden wurde
das erst durch ein Audit; keine Pruefung konnte es sehen.

Regel: Wer im Produktivcode einen festen Zeitpunkt gegen die Uhr rechnet, dessen Test
stellt die Uhr selbst (`jest.setSystemTime`, `useFakeTimers`, `vi.setSystemTime`,
`freeze_time`, injizierter Zeitparameter).

Ausnahmeweg (KERN 12): Eine Testdatei, die bewusst mit der echten Uhr rechnen MUSS,
traegt irgendwo die Marke

    uhr-absicht: <Begruendung in einem Satz>

Die Marke wird bei jedem Lauf mitausgegeben und zaehlt nicht als Mangel — eine Ausnahme,
die niemand mehr sieht, ist nach zwei Monaten der Normalzustand.

Diese Datei findet nur die KANDIDATEN. Entschieden wird an der Wirkung: `zeitzuender.sh`
laesst genau diese Testdateien mit vorgestellter Uhr laufen — was dann rot wird, ist ein
echter Zeitzuender. Grund fuer die Zweiteilung: Die rein strukturelle Fassung meldete
sofort einen Fehlalarm (ein Test, der die zeitabhaengige Funktion gar nicht aufruft), und
ein Riegel, der aus dem falschen Grund rot ist, wird nach zwei Wochen ignoriert.

Aufruf:  python3 pruefe-zeitzuender.py [verzeichnis] [--kandidaten]
         --kandidaten gibt nur die Testpfade aus, einen je Zeile (fuer zeitzuender.sh).
Exit 0 = keine Kandidaten, Exit 1 = Kandidaten vorhanden, Exit 2 = Aufrufproblem.
"""
import os
import re
import sys

# "zeitzuender-proben" und "negativprobe": eigenes Beispielmaterial der Pruefungen.
# Ohne diesen Ausschluss meldet die Pruefung beim Projektlauf ihre eigene Probe als
# Fund — ein Dauer-Fehlalarm, der den Riegel unbrauchbar macht.
UEBERSPRINGEN = {".git", "node_modules", "vendor", "dist", "build", ".venv",
                 "__pycache__", "target", "coverage", "negativprobe",
                 "zeitzuender-proben"}
QUELLENDUNGEN = (".js", ".mjs", ".cjs", ".ts", ".py")

# Fester Zeitpunkt im Quelltext: Date.parse("2026-..."), new Date("2026-..."),
# datetime(2026, ...) — mindestens ein vierstelliges Jahr in einer Zeichenkette.
FESTES_DATUM = re.compile(
    r"""(?:Date\.parse|new\s+Date|datetime\.fromisoformat|dateutil\.parser\.parse)\s*\(\s*["'](\d{4}-\d{2}-\d{2})""")
# Die echte Uhr.
ECHTE_UHR = re.compile(r"Date\.now\s*\(\s*\)|new\s+Date\s*\(\s*\)|time\.time\s*\(\s*\)|datetime\.now\s*\(")
# Uhr wird gestellt.
UHR_GESTELLT = re.compile(
    r"setSystemTime|useFakeTimers|fakeTimers|freeze_time|freezegun|"
    r"jest\.spyOn\s*\(\s*Date\s*,|clock\.(?:tick|restore)|sinon\.useFakeTimers")
AUSNAHME = re.compile(r"uhr-absicht\s*:\s*(.+)")

TESTPFAD = re.compile(r"(?:^|[/\\])(?:__tests__|tests?|spec|e2e)[/\\]|"
                      r"(?:^|[/\\])(?:test_[^/\\]+|[^/\\]+_test|[^/\\]+\.(?:test|spec))\.[a-z]+$", re.I)


def dateien(wurzel):
    for pfad, ordner, namen in os.walk(wurzel):
        ordner[:] = [o for o in ordner if o not in UEBERSPRINGEN]
        for name in namen:
            if name.endswith(QUELLENDUNGEN):
                yield os.path.join(pfad, name)


def lies(pfad):
    try:
        with open(pfad, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError as fehler:                       # Lesefehler ist ein Messproblem,
        print(f"FEHLER: {pfad} nicht lesbar: {fehler}", file=sys.stderr)  # kein Bestehen.
        sys.exit(2)


def modulname(pfad):
    """handle-reap.js -> handle-reap; handle-reap.test.js -> handle-reap."""
    name = os.path.basename(pfad)
    for endung in (".test.js", ".spec.js", ".test.mjs", ".test.ts", ".spec.ts"):
        if name.endswith(endung):
            return name[: -len(endung)]
    return os.path.splitext(name)[0]


def main():
    argumente = [a for a in sys.argv[1:] if a != "--kandidaten"]
    nur_kandidaten = "--kandidaten" in sys.argv[1:]
    wurzel = argumente[0] if argumente else "."
    if not os.path.isdir(wurzel):
        print(f"FEHLER: '{wurzel}' ist kein Verzeichnis.", file=sys.stderr)
        return 2

    quellen, tests = {}, {}
    for pfad in dateien(wurzel):
        (tests if TESTPFAD.search(pfad) else quellen).setdefault(modulname(pfad), []).append(pfad)

    if not quellen and not tests:
        print("FEHLER: keine Quelldateien gefunden — Messmittel oder Pfad falsch.", file=sys.stderr)
        return 2

    funde, ausnahmen, betroffen = [], [], 0
    for modul, pfade in sorted(quellen.items()):
        for quellpfad in pfade:
            inhalt = lies(quellpfad)
            treffer = FESTES_DATUM.search(inhalt)
            if not treffer or not ECHTE_UHR.search(inhalt):
                continue                    # Fixdatum ohne Uhrvergleich ist harmlos.
            betroffen += 1
            for testpfad in tests.get(modul, []):
                testinhalt = lies(testpfad)
                marke = AUSNAHME.search(testinhalt)
                if marke:
                    ausnahmen.append((testpfad, marke.group(1).strip()))
                    continue
                if not UHR_GESTELLT.search(testinhalt):
                    funde.append((testpfad, quellpfad, treffer.group(1)))

    if nur_kandidaten:
        for testpfad, _, _ in funde:
            print(testpfad)
        return 1 if funde else 0

    print(f"Geprueft: {len(quellen)} Quell-Module, {len(tests)} Test-Module; "
          f"{betroffen} mit festem Zeitpunkt gegen die echte Uhr.")
    for pfad, grund in ausnahmen:
        print(f"  Ausnahme (uhr-absicht): {pfad} — {grund}")
    if funde:
        print("\nKandidaten — Tests zu Code mit festem Zeitpunkt, ohne gestellte Uhr:")
        for testpfad, quellpfad, datum in funde:
            print(f"  {testpfad}\n      Fixdatum {datum} in {quellpfad}")
        print("\nOb einer davon wirklich kippt, entscheidet der Lauf mit vorgestellter Uhr:")
        print("  sh scripts/pruefe-zeitzuender.sh")
        return 1
    print("Keine Kandidaten.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
