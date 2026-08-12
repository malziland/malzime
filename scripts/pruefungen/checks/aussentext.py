#!/usr/bin/env python3
"""aussentext.py — prueft Texte, die nach aussen gehen, gegen verbotene Formulierungen.

Der belegte Vorfall dahinter: Eine Formulierung, die im Netzwerk-Tab widerlegbar war,
stand dokumentiert auf der Verbotsliste und ueberlebte trotzdem monatelang im README.
Eine Wording-Regel ohne Test ist eine Bitte, kein Schutz.

Diese Pruefung hat eine eingebaute Positivkontrolle: Sie prueft sich selbst an einem
bekannten Verstoss. Schlaegt die Kontrolle nicht an, ist die Suche kaputt und die
Pruefung meldet das, statt gruen zu werden.

Aufruf:  python3 aussentext.py [verzeichnis]
Exit 0 = sauber, Exit 1 = Verstoss, Exit 2 = Aufrufproblem oder kaputte Suche.

Regeln liegen in .pruefungen/aussentext.txt, je Zeile:
    <regulaerer Ausdruck>|<Begruendung, warum die Formulierung nicht zulaessig ist>
Zeilen mit # sind Kommentare. Ohne Regeldatei legt die Pruefung eine Vorlage an.

Getrennt wird am LETZTEN |, denn der regulaere Ausdruck darf selbst | enthalten
(Oder-Verknuepfung). Die Begruendung ist Fliesstext und darf keines enthalten.
Eine Zeile, die sich nicht laden laesst, beendet den Lauf mit Exit 2. Sie als Hinweis
zu ueberspringen hiesse, mit einer stillschweigend geschwaechten Pruefung
weiterzuarbeiten - genau die Fehlerform, gegen die diese Pruefungen gebaut sind.
"""
import os
import re
import subprocess
import sys

# DOC-2026-08-12-05: ".js" fehlte — der Kommentar in public/js/api.js wird an
# jeden Besucher ausgeliefert und trug monatelang eine widerlegbare Zusage, ohne
# dass die Sperrliste ihn je gesehen haette.
ENDUNGEN = (".md", ".html", ".htm", ".txt", ".json", ".yml", ".yaml", ".vue", ".jsx",
            ".tsx", ".svelte", ".js", ".mjs", ".ts")
# "negativprobe" enthaelt das absichtlich kaputte Beispielmaterial dieser Pruefungen.
# Ohne den Ausschluss meldet jeder Lauf im eigenen Verzeichnis Dauerfunde aus dem
# eigenen Testmaterial — und ein Pruefer, der nie gruen werden kann, wird ignoriert.
UEBERSPRINGEN = {".git", "node_modules", "vendor", "dist", "build", ".venv",
                 "__pycache__", "target", "coverage", "test", "tests", "__tests__",
                 "negativprobe"}

VORLAGE = """# Verbotene Formulierungen in Texten, die nach aussen gehen.
# Format:  regulaerer Ausdruck|Begruendung
# Diese Zeilen sind Beispiele. Passe sie an dein Projekt an.
verlaesst nie den Browser|Absolute Zusage ueber Datenfluesse ist im Netzwerk-Tab widerlegbar. Beschreiben, was das System tut, nicht was es niemals tut.
zu ?100 ?% sicher|Sicherheit ist keine Zusage, die man geben kann.
garantiert (?:sicher|anonym|fehlerfrei)|Garantie ohne Nachweis. Formulierung abschwaechen oder Nachweis verlinken.
militaerisch(?:e|er)? Verschluesselung|Marketingbegriff ohne technischen Gehalt.
"""

# Ein Satz, der gegen die erste Vorlagenregel verstoesst. Dient der Selbstpruefung.
KONTROLLSATZ = "Deine Position verlaesst nie den Browser."
KONTROLLMUSTER = r"verlaesst nie den Browser"


def regeln_laden(wurzel):
    ordner = os.path.join(wurzel, ".pruefungen")
    pfad = os.path.join(ordner, "aussentext.txt")
    if not os.path.isfile(pfad):
        os.makedirs(ordner, exist_ok=True)
        with open(pfad, "w", encoding="utf-8") as f:
            f.write(VORLAGE)
        print(f"Vorlage angelegt: {os.path.relpath(pfad, wurzel)}")
        print("Bitte an das Projekt anpassen. Es gelten vorerst die Beispielregeln.")
        print("-" * 60)

    regeln = []
    maengel = []
    with open(pfad, encoding="utf-8", errors="replace") as f:
        for nr, zeile in enumerate(f, 1):
            zeile = zeile.strip()
            if not zeile or zeile.startswith("#"):
                continue
            if "|" not in zeile:
                maengel.append(f"Zeile {nr}: kein Trennzeichen | vorhanden")
                continue
            # Von rechts trennen: Der Ausdruck darf | enthalten, die Begruendung nicht.
            ausdruck, grund = zeile.rsplit("|", 1)
            # Steht in der Begruendung ein |, wandert der Text davor stillschweigend in
            # den Ausdruck und macht daraus eine viel zu weite Alternation. Der Ausdruck
            # kompiliert dabei tadellos - es faellt also nur ueber die Trefferzahl auf.
            # Erkennungsmerkmal: In einem Ausdruck steht | ohne Leerzeichen (a|b), in
            # Prosa mit ("learning | training").
            if " | " in ausdruck:
                maengel.append(
                    f"Zeile {nr}: Der Ausdruck enthaelt ' | ' mit Leerzeichen. "
                    "Vermutlich steht in der Begruendung ein |, und der Text davor "
                    "gehoert jetzt zum Suchmuster. Begruendung ohne | schreiben.")
                continue
            try:
                regeln.append((re.compile(ausdruck.strip(), re.I), grund.strip(),
                               ausdruck.strip()))
            except re.error as fehler:
                maengel.append(f"Zeile {nr}: ungueltiger Ausdruck: {fehler}")
    return regeln, maengel


def positivkontrolle(regeln):
    """Die Suche muss an einem bekannten Verstoss anschlagen (KERN 8, Bedingung 5)."""
    if not any(a.search(KONTROLLSATZ) for a, _, _ in regeln):
        # Nur aussagekraeftig, wenn die Kontrollregel ueberhaupt geladen ist.
        if any(roh == KONTROLLMUSTER for _, _, roh in regeln):
            return False
    return True


def git_dateien(wurzel):
    """Alles, was im Repository landet: verfolgte Dateien PLUS noch nicht
    hinzugefuegte, die nicht ignoriert sind. Gibt None zurueck, wenn hier kein
    Repository liegt oder git fehlt — dann faellt die Suche auf den Dateibaum
    zurueck.

    AUDIT-BEFUND TEST-2026-08-12-29: Die Suche lief ueber den Dateibaum und sah
    damit auch ignorierte Dateien. Auditberichte (docs/audit-*.md) zitieren die
    verbotenen Formulierungen naturgemaess, um sie zu melden — der lokale Lauf war
    deshalb dauerhaft rot, waehrend die CI gruen war. Ein Pruefer, der immer rot
    ist, wird genauso ignoriert wie einer, der immer gruen ist."""
    try:
        roh = subprocess.run(
            ["git", "-C", wurzel, "ls-files", "--cached", "--others",
             "--exclude-standard", "-z"],
            capture_output=True, timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if roh.returncode != 0:
        return None
    namen = [n for n in roh.stdout.decode("utf-8", "replace").split("\0") if n]
    if not namen:
        return None  # leeres Ergebnis ist zuerst ein Verdacht gegen das Messmittel
    return namen


def dateien(wurzel):
    verfolgt = git_dateien(wurzel)
    if verfolgt is not None:
        for rel in verfolgt:
            if not rel.lower().endswith(ENDUNGEN):
                continue
            teile = rel.split(os.sep)
            if any(t in UEBERSPRINGEN or t.startswith(".") for t in teile[:-1]):
                continue
            pfad = os.path.join(wurzel, rel)
            if os.path.isfile(pfad):
                yield pfad
        return

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

    print("AUSSENTEXT")
    print(f"Geprueft unter: {os.path.abspath(wurzel)}")
    print("-" * 60)

    regeln, maengel = regeln_laden(wurzel)
    if maengel:
        print("FEHLER: Die Regeldatei ist nicht vollstaendig ladbar.")
        for eintrag in maengel:
            print(f"  {eintrag}")
        print("Eine Regel, die nicht laedt, prueft nichts — und der Lauf saehe trotzdem")
        print("aus wie ein Ergebnis. Erst die Regeldatei reparieren, dann messen.")
        return 2

    if not regeln:
        print("Keine Regeln geladen. Ohne Regeln keine Aussage, kein bestandener Test.")
        return 2

    if not positivkontrolle(regeln):
        print("FEHLER: Die Positivkontrolle schlaegt nicht an. Die Suche ist kaputt,")
        print("nicht der Text sauber. Ergebnis ist wertlos, bis das behoben ist.")
        return 2

    geprueft = 0
    funde = []
    for pfad in dateien(wurzel):
        geprueft += 1
        try:
            with open(pfad, encoding="utf-8", errors="replace") as f:
                zeilen = f.readlines()
        except OSError:
            continue
        for nr, zeile in enumerate(zeilen, 1):
            for ausdruck, grund, _ in regeln:
                treffer = ausdruck.search(zeile)
                if treffer:
                    funde.append((os.path.relpath(pfad, wurzel), nr,
                                  treffer.group(0), grund))

    print(f"Regeln: {len(regeln)} (Positivkontrolle bestanden)")
    print(f"Dateien: {geprueft}")

    # TEST-2026-08-12-03: Null gepruefte Dateien ist kein sauberes Ergebnis,
    # sondern eine gescheiterte Messung. Die drei anderen Pruefungen sagten das
    # bereits; diese hier meldete "kein Verstoss gefunden" und ging mit 0 raus —
    # dieselbe Ausfallform, gegen die sie selbst antritt (KERN 5c).
    if geprueft == 0:
        print("-" * 60)
        print("Keine Aussentexte gefunden. Ohne Suchflaeche keine Aussage. Das ist")
        print("kein bestandener Test, sondern eine gescheiterte Messung: Entweder")
        print("gibt es die Dateien nicht, oder die Suche greift nicht.")
        return 2

    for kurz, nr, text, grund in funde:
        print(f"\n{kurz}:{nr}")
        print(f"  Formulierung: {text}")
        print(f"  Grund:        {grund}")

    print("-" * 60)
    if not funde:
        print("ERGEBNIS: kein Verstoss gefunden.")
        return 0
    print(f"ERGEBNIS: {len(funde)} Verstoss/Verstoesse. Formulierung aendern oder die")
    print("Regel begruendet streichen. Beides ist eine Entscheidung, kein Versehen.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
