#!/usr/bin/env python3
"""
pruefe-deploy-riegel.py — Sind die Riegel im Auslieferungs-Skript noch da?

WOZU: Die Rueckbauprobe am 31.08.2026 hat gezeigt, dass `scripts/deploy.sh`
von KEINEM Test abgedeckt ist. Trockenlauf, Aufraeumfalle, Stand-Bindung,
Notschalter-Bilanz — alle liessen sich entfernen, ohne dass irgendetwas rot
wurde.

Das ist die gefaehrlichste Sorte Luecke: Das Skript enthaelt genau die Riegel,
die verhindern, dass ungepruefter Code in die Produktion geht. Waeren sie weg,
faellt es erst auf, wenn es zu spaet ist.

WAS HIER GEPRUEFT WIRD: Dass jeder Riegel vorhanden ist UND an der richtigen
Stelle steht. Die Reihenfolge ist nicht kosmetisch — ein Trockenlauf nach dem
Cache-Buster liesse bei jedem Abbruch einen unsauberen Arbeitsbaum zurueck, und
eine Aufraeumfalle vor dem Cache-Buster fande nichts zum Aufraeumen.

WAS ES NICHT KANN: Es fuehrt das Skript nicht aus. Ob ein Riegel WIRKT, zeigt
nur ein echter Lauf — dafuer gibt es die Negativproben, die bei jeder Aenderung
von Hand gefahren werden (dokumentiert im jeweiligen Commit).

AUFRUF:  python3 scripts/pruefe-deploy-riegel.py
RUECKGABE: 0 = alle Riegel da, 1 = etwas fehlt, 2 = nicht messbar.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SKRIPT = WURZEL / "scripts" / "deploy.sh"
CI = WURZEL / ".github" / "workflows" / "ci.yml"


# ─────────────────────────────────────────────────────────────────────────────
# DIE RIEGEL
#
# `muster`   — was im Skript stehen muss (regulaerer Ausdruck)
# `warum`    — was passiert, wenn er fehlt
# `vor`      — optional: dieser Riegel muss VOR dem genannten Muster stehen
# ─────────────────────────────────────────────────────────────────────────────
RIEGEL_DEPLOY = [
    {
        "name": "Stand-Bindung an die CI-Freigabe",
        "muster": r"HEAD != origin/main",
        "braucht_abbruch": True,
        "warum": "Ohne sie wird der Arbeitsbaum ausgeliefert, egal was die Pipeline sagt.",
    },
    {
        "name": "Sauberer Arbeitsbaum",
        "muster": r"Arbeitsbaum nicht sauber",
        "braucht_abbruch": True,
        "warum": "Ohne sie gehen ungespeicherte Aenderungen mit in die Produktion.",
    },
    {
        "name": "Trockenlauf",
        "muster": r"firebase deploy --only .* --dry-run",
        "warum": (
            "Ohne ihn scheitert eine Auslieferung erst nach 25 Minuten an Dingen,\n"
            "     die in 28 Sekunden sichtbar gewesen waeren. Am 30.08. sechsmal passiert."
        ),
        # OPS-2026-08-31-16: Hier stand `Cache-Busting-Version generieren` —
        # dieser Text existiert in deploy.sh NUR in einer Kommentarzeile, und
        # Zeile 126 entfernt Kommentare, bevor gesucht wird. `re.search` fand
        # nichts, `anderer` war None, und die Reihenfolge-Pruefung fiel STILL
        # aus. Belegt: Trockenlauf ans Dateiende verschoben -> Waechter meldete
        # weiter "ok". Der neue Anker ist eine CODE-Zeile, die den Buster
        # tatsaechlich erzeugt und die niemand entfernen kann, ohne die
        # Auslieferung zu brechen.
        # GRENZE, gemessen: `re.search` nimmt den ERSTEN Treffer. Es gibt zwei
        # Trockenlauf-Zeilen (Firestore und Rest). Wird nur EINE hinter den
        # Buster verschoben, findet die Regel noch die andere und meldet ok.
        # Erst wenn beide falsch stehen, schlaegt sie an. Fuer den Schaden, um
        # den es geht — ein Abbruch NACH dem Buster hinterlaesst einen
        # unsauberen Arbeitsbaum — genuegt das, weil beide Zeilen im selben
        # Block stehen und gemeinsam verschoben wuerden.
        "vor": r'^VERSION="\(kein Hosting-Deploy',
    },
    {
        "name": "Aufraeumen bei Abbruch",
        "muster": r"trap aufraeumen_bei_abbruch EXIT",
        "warum": (
            "Ohne sie blockiert ein gescheiterter Versuch den naechsten: Die\n"
            "     hochgezaehlte Cache-Kennung bleibt liegen und laesst den\n"
            "     Sauberkeits-Riegel anschlagen."
        ),
        "nach": r"Cache-Busting-Version: ",
    },
    {
        # OPS-2026-08-31-13: Diese Regel war bei ihrer Entstehung SOFORT tot.
        # `re.search` ohne `re.M` verankert `^` am Anfang der GANZEN Datei,
        # nicht am Zeilenanfang — das Muster fand nie etwas, und die Regel
        # meldete auch im richtigen Zustand "FEHLT". Die drei Suchstellen
        # laufen jetzt mit re.M. Bestehende Regeln waren nicht betroffen,
        # sie verwenden keinen Zeilenanker.
        "name": "Hochgeladen-Marke nach dem Upload",
        "muster": r"^HOCHGELADEN=1",
        "warum": (
            "Steht sie VOR `firebase deploy --only $TARGET`, meldet die Aufraeumfalle\n"
            "     bei einem gescheiterten Upload faelschlich 'steht bereits live', laesst\n"
            "     14 Dateien liegen und blockiert den naechsten Versuch. Schlimmer: dann\n"
            "     behauptet build-info.json einen Stand, der nie ausgeliefert wurde."
        ),
        "nach": r"^  firebase deploy --only \"\$TARGET\"",
    },
    {
        "name": "Firestore als eigener Schritt",
        # OPS-2026-08-31-10: Das Muster traf zuerst auf den TROCKENLAUF
        # (dieselbe Zeile mit --dry-run). re.search liefert nur den ersten
        # Treffer — der echte Deploy-Schritt konnte durch echo ersetzt werden,
        # und der Waechter meldete weiter "ok". Jetzt muss eine Zeile OHNE
        # --dry-run existieren.
        "muster": r"firebase deploy --only firestore:malzime-eu\b(?!.*--dry-run)",
        "warum": (
            "Im Paket mit hosting/functions scheitert der Aufruf an der\n"
            "     Standard-Datenbank, die es hier nicht gibt."
        ),
    },
    {
        "name": "Infrastruktur-Pruefung",
        "muster": r"verify-infrastructure\.sh",
        "warum": "Ohne sie faellt eine Abweichung im Cloud-Zustand erst im Betrieb auf.",
    },
    {
        "name": "Einstellungssatz-Riegel",
        "muster": r"SKIP_SATZ",
        "warum": (
            "Ohne ihn kann eine Fassung live gehen, fuer die kein Einstellungssatz\n"
            "     liegt — die Seite nimmt dann Fotos an, und JEDE Analyse scheitert."
        ),
    },
    {
        "name": "Live-Proben nach der Auslieferung",
        "muster": r"live-smoke\.sh",
        "warum": "Ohne sie merkt niemand, wenn die frisch ausgelieferte Seite kaputt ist.",
    },
]

# Die Notschalter werden AUS DEM SKRIPT gelesen, nicht hier aufgezaehlt —
# siehe die Begruendung weiter unten. Eine Liste an dieser Stelle waere genau
# die Sorte Doppelquelle, die veraltet, sobald jemand einen Schalter zufuegt.


def pruefe_durchsetzung(text, muster, fenster=6):
    """OPS-2026-08-31-18: Ein Riegel ist erst einer, wenn er auch ABBRICHT.

    BEFUND 31.08.2026 (Runde 2): Mehrere Regeln ankerten auf dem MELDUNGSTEXT
    ("FEHLER: Arbeitsbaum nicht sauber"). Ausgefuehrt: die `exit 1` durch `:`
    ersetzt, die echo-Zeilen stehen gelassen — der Waechter meldete weiter
    "Alle Riegel vorhanden", Rueckgabewert 0. Ein so entwaffnetes deploy.sh
    liefert einen schmutzigen Arbeitsbaum mit roten Pflicht-Checks aus.

    Jetzt muss auf den Meldungstext innerhalb weniger Zeilen ein Abbruch
    folgen. `fenster` deckt die uebliche Form ab: ein bis drei echo-Zeilen,
    dann exit.
    """
    zeilen = text.split("\n")
    for i, z in enumerate(zeilen):
        if re.search(muster, z):
            umfeld = zeilen[i : i + fenster]
            if any(re.search(r"\bexit\s+[1-9]", u) for u in umfeld):
                return True
            return False
    return None  # Muster gar nicht gefunden — das meldet die Haupt-Pruefung


def pruefe_anker(text_roh, text_ohne_kommentar):
    """OPS-2026-08-31-17: Jeder Anker muss auf CODE zeigen, nicht auf einen
    Kommentar.

    Anlass: Die Reihenfolge-Regel des Trockenlaufs war von Anfang an tot — ihr
    Anker stand nur in einer Kommentarzeile, und diese Funktion entfernt
    Kommentare vor der Suche. Eine tote Regel verhaelt sich wie eine erfuellte:
    beide schweigen. Deshalb prueft der Waechter jetzt SICH SELBST.
    """
    tote = []
    for r in RIEGEL_DEPLOY:
        # NUR die Hilfsanker pruefen, NICHT das Suchmuster selbst.
        #
        # BEFUND aus der eigenen Selbstpruefung (31.08.2026): Mit "muster" in
        # dieser Liste meldete der Waechter bei einem AUSKOMMENTIERTEN Riegel
        # "eigene Anker tot" (Rueckgabewert 2) statt "FEHLT" (1) — er verwechselte
        # einen schlecht gewaehlten Anker mit dem Schaden, den er finden soll.
        # Ein "muster", das nur im Kommentar steht, IST der Befund; ein "vor"
        # oder "nach", das nur im Kommentar steht, macht die Regel dagegen
        # wirkungslos, ohne dass jemand etwas sieht.
        for feld in ("vor", "nach"):
            if feld not in r:
                continue
            try:
                im_code = re.search(r[feld], text_ohne_kommentar, re.M)
                im_roh = re.search(r[feld], text_roh, re.M)
            except re.error:
                continue
            if im_roh and not im_code:
                tote.append((r["name"], feld, r[feld]))
    return tote


def main():
    if not SKRIPT.exists():
        print(f"  NICHT MESSBAR: {SKRIPT} fehlt.")
        return 2

    roh = SKRIPT.read_text(encoding="utf-8")

    # BEFUND 31.08.2026 (unvorbelastetes Review): Hier wurde im ROHTEXT
    # gesucht, Kommentare eingeschlossen. Ein deploy.sh, das die Riegel nur als
    # Kommentarzeilen enthaelt und sonst nichts tut, bestand die Pruefung —
    # also genau der Zustand, den dieser Waechter aufdecken soll.
    #
    # Deshalb wird jetzt gegen den CODE geprueft: Kommentarzeilen fliegen
    # raus, bevor gesucht wird. Ein Riegel, ueber den nur geschrieben wird,
    # zaehlt nicht als Riegel.
    text = "\n".join(z for z in roh.split("\n") if not z.lstrip().startswith("#"))

    # MESSMITTEL-PROBE: Ein leeres oder abgeschnittenes Skript wuerde jede
    # Pruefung unten scheitern lassen — aber aus dem falschen Grund.
    if len(roh) < 3000:
        print(f"  NICHT MESSBAR: deploy.sh ist nur {len(roh)} Zeichen gross.")
        print("  Abgeschnitten oder ersetzt? Erst das klaeren.")
        return 2

    print("── Sind die Riegel im Auslieferungs-Skript noch da? ──")
    print()

    # OPS-2026-08-31-17: ZUERST die eigenen Anker pruefen. Ein Anker, der nur
    # auf einer Kommentarzeile liegt, findet nach dem Kommentarfilter nichts —
    # die Regel ist dann tot und schweigt wie eine erfuellte. Genau so war die
    # Reihenfolge-Regel des Trockenlaufs von Anfang an wirkungslos.
    tote_anker = pruefe_anker(roh, text)
    if tote_anker:
        print("  ▸ EIGENE ANKER TOT — dieser Waechter kann nicht messen:")
        for name, feld, muster in tote_anker:
            print(f"     {name} ({feld}): '{muster}' steht NUR in einem Kommentar.")
        print("     Anker gehoeren an Code-Zeilen, die niemand entfernen kann,")
        print("     ohne dass die Auslieferung bricht.")
        print()
        return 2

    fehlt = []
    falsch_platziert = []
    ohne_abbruch = []

    for r in RIEGEL_DEPLOY:
        treffer = re.search(r["muster"], text, re.M)
        if treffer and r.get("braucht_abbruch"):
            if pruefe_durchsetzung(text, r["muster"]) is False:
                ohne_abbruch.append(r)
        if not treffer:
            print(f"  FEHLT   {r['name']}")
            fehlt.append(r)
            continue

        # Reihenfolge pruefen, wo sie zaehlt
        lage = "ok   "
        if "vor" in r:
            anderer = re.search(r["vor"], text, re.M)
            if anderer and treffer.start() > anderer.start():
                lage = "FALSCHE STELLE"
                falsch_platziert.append((r, "muss VOR '" + r["vor"] + "' stehen"))
        if "nach" in r:
            anderer = re.search(r["nach"], text, re.M)
            if anderer and treffer.start() < anderer.start():
                lage = "FALSCHE STELLE"
                falsch_platziert.append((r, "muss NACH '" + r["nach"] + "' stehen"))

        print(f"  {lage:15} {r['name']}")

    print()
    print("── Taucht jeder Notschalter in der Schlussbilanz auf? ──")
    bilanz = text[text.find("UEBERSPRUNGEN=") :] if "UEBERSPRUNGEN=" in text else ""
    # Auch die Liste der Schalter kommt aus dem CODE, nicht aus einer
    # handgepflegten Aufzaehlung — sonst fehlt genau der eine, der neu
    # dazugekommen ist. (Befund 31.08.: SKIP_SATZ fehlte in beiden.)
    gefundene_schalter = sorted(set(re.findall(r"\bSKIP_[A-Z_]+\b", text)))
    if not bilanz:
        print("  NICHT MESSBAR: Die Schlussbilanz fehlt ganz.")
        return 2

    # BEFUND 31.08.2026: Hier wurde eine handgepflegte Liste durchgegangen —
    # und ausgerechnet SKIP_SATZ fehlte in ihr UND in der Schlussbilanz. Ein
    # Waechter gegen "Abschaltung mit Tarnkappe", der die eine existierende
    # Tarnkappe nicht kannte.
    #
    # Jetzt kommt die Liste aus dem Skript selbst. Sie kann nicht veralten.
    ohne_bilanz = []
    if not gefundene_schalter:
        print("  NICHT MESSBAR: kein einziger SKIP_-Schalter im Code gefunden.")
        return 2
    for s in gefundene_schalter:
        drin_in_bilanz = re.search(rf'UEBERSPRUNGEN {s}"', bilanz) is not None
        if not drin_in_bilanz:
            print(f"  FEHLT   {s} — wird nicht gemeldet, wenn er gesetzt ist")
            ohne_bilanz.append(s)
        else:
            print(f"  ok      {s}")

    # Die CI-Regel gegen parallele Laeufe
    print()
    print("── Bricht ein neuer Push den vorigen Lauf ab? ──")
    ci_fehlt = False
    if CI.exists():
        ci = CI.read_text(encoding="utf-8")
        if "concurrency:" in ci and "cancel-in-progress" in ci:
            if "refs/heads/main" in ci:
                print("  ok      concurrency gesetzt, main ausgenommen")
            else:
                print("  WARNUNG concurrency gesetzt, aber main NICHT ausgenommen —")
                print("          ein abgebrochener main-Lauf blockiert die Auslieferung")
                ci_fehlt = True
        else:
            print("  FEHLT   Ohne sie laufen bis zu fuenf Pruefdurchgaenge gleichzeitig")
            ci_fehlt = True
    else:
        print("  NICHT MESSBAR: ci.yml fehlt")
        return 2

    print()
    anzahl = len(fehlt) + len(falsch_platziert) + len(ohne_abbruch) + len(ohne_bilanz) + (1 if ci_fehlt else 0)
    if anzahl == 0:
        print("  ERGEBNIS: Alle Riegel vorhanden und richtig platziert.")
        return 0

    print(f"  ERGEBNIS: {anzahl} Befund(e).")
    print()
    for r in fehlt:
        print(f"  ▸ FEHLT: {r['name']}")
        print(f"     {r['warum']}")
        print()
    for r in ohne_abbruch:
        print(f"  ▸ MELDUNG OHNE ABBRUCH: {r['name']}")
        print("     Der Meldungstext steht da, aber kein `exit` dahinter — der Riegel")
        print("     meldet und liefert trotzdem aus.")
        print()
    for r, wo in falsch_platziert:
        print(f"  ▸ FALSCHE STELLE: {r['name']} — {wo}")
        print(f"     {r['warum']}")
        print()
    for s in ohne_bilanz:
        print(f"  ▸ {s} fehlt in der Schlussbilanz.")
        print("     Ein uebersprungener Riegel muss am Ende genannt werden — sonst")
        print("     sieht der Lauf gruen aus, obwohl eine Pruefung ausgefallen ist.")
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
