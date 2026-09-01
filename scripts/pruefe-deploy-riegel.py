#!/usr/bin/env python3
"""
pruefe-deploy-riegel.py — zwei Pruefungen an der Auslieferungskette.

WAS DIESES SKRIPT NICHT (MEHR) TUT: Es prueft KEINE Riegel in `deploy.sh`.

Bis zum 31.08.2026 tat es das ueber Textmuster. Drei Pruefer haben es
unabhaengig ausgehebelt — `exit` durch `:` ersetzt, `echo` stehen gelassen —
und bekamen weiter "Alle Riegel vorhanden". Zwoelf realistische Rueckbauten (einzeln gemessen)
blieben unbemerkt. Ein Textmuster belegt kein Verhalten.

Die Riegel selbst prueft jetzt `functions/src/__tests__/deploy-verhalten.test.js`:
Es fuehrt `deploy.sh` in einem Wegwerf-Klon aus, mit Attrappen fuer firebase,
gh, verify-infrastructure und live-smoke. Rueckbauproben belegen, dass
jeder Fall rot wird, wenn der zugehoerige Riegel faellt.

WAS HIER BLEIBT, sind die zwei Fragen, bei denen es wirklich um Text geht:

  1. Wird jeder Notschalter (SKIP_*) in der Schlussbilanz genannt? Sonst sieht
     ein Lauf gruen aus, obwohl eine Pruefung uebersprungen wurde.
  2. Ist die concurrency-Einstellung der Pipeline richtig? Geprueft wird der
     VERGLEICH, nicht nur das Vorkommen der Woerter.

BEKANNTE GRENZE (Runde 4, F-4): Wer `deploy-verhalten.test.js` loescht, faellt
hier nicht auf — dieses Skript kennt die Datei nicht. Der Schutz dagegen liegt
in `pruefe-kopplung.py` ("UNVERZICHTBARE PRUEFUNG FEHLT") und in
`selbstpruefung-waechter.sh` (eine Probe schlaegt fehl); beide gemessen am
01.09.2026 mit geloeschter Datei. `pruefe-mitzieher.py` faengt diesen Fall
NICHT — die urspruengliche Zuschreibung war falsch (Runde 7, K-5).
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
# UMGEBAUT 31.08.2026 — dieser Waechter prueft KEIN Verhalten mehr.
#
# Er hatte neun Regeln, die Textmuster in deploy.sh suchten. Drei Pruefer haben
# ihn unabhaengig ausgehebelt: `exit` durch `:` ersetzt, `echo` stehen gelassen
# — er meldete weiter "Alle Riegel vorhanden". Zehn realistische Rueckbauten
# blieben unbemerkt. Ein Textmuster belegt kein Verhalten.
#
# Diese neun Regeln stehen jetzt in
# functions/src/__tests__/deploy-verhalten.test.js. Dort wird deploy.sh in
# einem Wegwerf-Klon AUSGEFUEHRT, mit Attrappen fuer firebase, gh,
# verify-infrastructure und live-smoke. Rueckbauproben belegen, dass jeder
# Fall rot wird, wenn der zugehoerige Riegel faellt.
#
# Was HIER bleibt, sind die zwei Pruefungen, die zu Recht Text lesen, weil es
# um Text geht: Jeder Notschalter (SKIP_*) muss in der Schlussbilanz genannt
# werden, und die concurrency-Einstellung der Pipeline.
RIEGEL_DEPLOY = []

# Die Notschalter werden AUS DEM SKRIPT gelesen, nicht hier aufgezaehlt —
# siehe die Begruendung weiter unten. Eine Liste an dieser Stelle waere genau
# die Sorte Doppelquelle, die veraltet, sobald jemand einen Schalter zufuegt.




def main():
    # BEFUND 01.09.2026: Dreimal an einem Tag scheiterte eine neue Pruefung
    # daran, dass `ci` erst weiter unten gelesen wurde — die Variable gibt es
    # an der Einfuegestelle noch nicht. Jetzt steht sie ganz oben; jede neue
    # Pruefung findet sie vor, egal wo sie eingefuegt wird.
    if not CI.exists():
        print("NICHT MESSBAR: .github/workflows/ci.yml fehlt")
        return 2
    ci = CI.read_text(encoding="utf-8")

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

    print("── Notschalter und Pipeline-Einstellung ──")
    print()

    # OPS-2026-08-31-17: ZUERST die eigenen Anker pruefen. Ein Anker, der nur
    # auf einer Kommentarzeile liegt, findet nach dem Kommentarfilter nichts —
    # die Regel ist dann tot und schweigt wie eine erfuellte. Genau so war die
    # Reihenfolge-Regel des Trockenlaufs von Anfang an wirkungslos.
    fehlt = []
    falsch_platziert = []
    ohne_abbruch = []

    for r in RIEGEL_DEPLOY:
        treffer = re.search(r["muster"], text, re.M)
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
    # BEFUND 01.09.2026 (vierter Pipeline-Lauf): Die Mutationsprobe lief im
    # Job `test-backend`, der FLACH auscheckt — sie fand kein origin/main und
    # meldete "nicht messbar". Sie hat sich richtig verhalten; falsch war der
    # Job. Dieselbe Lehre steht seit Runde 5 im Kopf von
    # deploy-verhalten.test.js und im Job `pruefungen`; beim Verschieben eines
    # Schrittes ist sie wieder herausgefallen.
    #
    # Wer die Historie braucht, muss sie bekommen. Das ist aus dem Aufruf
    # ablesbar — also pruefbar.
    print("── Bekommt jeder Job die Historie, die er braucht? ──")
    BRAUCHT_HISTORIE = ("origin/main", "pruefe-mutationen", "pruefe-mitzieher")
    job_zeilen = ci.split("\n")
    aktueller_job = None
    job_hat_tiefe = {}
    job_braucht = {}
    for zeile in job_zeilen:
        m = re.match(r"^  ([a-z][a-z0-9-]*):\s*$", zeile)
        if m:
            aktueller_job = m.group(1)
            job_hat_tiefe.setdefault(aktueller_job, False)
            continue
        if not aktueller_job:
            continue
        if "fetch-depth:" in zeile and zeile.strip().split(":", 1)[1].strip() == "0":
            job_hat_tiefe[aktueller_job] = True
        if any(w in zeile for w in BRAUCHT_HISTORIE) and "run:" in zeile:
            job_braucht.setdefault(aktueller_job, []).append(zeile.strip()[:52])

    ohne_historie = [
        (job, aufrufe) for job, aufrufe in job_braucht.items() if not job_hat_tiefe.get(job)
    ]
    if ohne_historie:
        for job, aufrufe in ohne_historie:
            print(f"  FEHLT   Job `{job}` braucht die Historie, checkt aber flach aus:")
            for a in aufrufe[:2]:
                print(f"            {a}")
        print("          `fetch-depth: 0` beim checkout ergaenzen. Ohne sie gibt")
        print("          es kein origin/main — der Waechter meldet dann ehrlich")
        print("          'nicht messbar' und der Job wird rot.")
        ci_fehlt = True
    else:
        print(f"  ok      {len(job_braucht)} Job(s) brauchen Historie und bekommen sie")
    print()

    print("── Bricht ein neuer Push den vorigen Lauf ab? ──")
    ci_fehlt = False
    if True:
        # BEFUND 31.08.2026 (Runde 3): Hier wurde nur geprueft, OB die Woerter
        # vorkommen. `cancel-in-progress: true` haette weiter "ok" gemeldet,
        # obwohl damit ein laufender main-Durchgang abgebrochen wuerde. Jetzt
        # wird der WERT gelesen: main muss von beidem ausgenommen sein — vom
        # Abbrechen (cancel-in-progress) und von der gemeinsamen Gruppe
        # (sonst storniert ein dritter Push den zweiten).
        # Kommentarzeilen VOR der Suche entfernen: In ci.yml steht die
        # Begruendung ueber der Einstellung und nennt `cancel-in-progress:
        # false` als Beispiel. re.search nahm den ersten Treffer — den
        # Kommentar. Derselbe Fehler wie beim Riegel-Anker, gleicher Tag.
        ci_ohne_kommentar = "\n".join(
            z for z in ci.split("\n") if not z.lstrip().startswith("#")
        )
        abbruch = re.search(r"cancel-in-progress:\s*(.+)", ci_ohne_kommentar)
        gruppe = re.search(r"group:\s*>?-?\s*\n((?:\s+.+\n)+)", ci_ohne_kommentar)
        abbruch_text = abbruch.group(1).strip() if abbruch else ""
        gruppe_text = gruppe.group(1) if gruppe else ""
        if not abbruch:
            print("  FEHLT   cancel-in-progress ist nicht gesetzt —")
            print("          bis zu fuenf Pruefdurchgaenge laufen gleichzeitig")
            ci_fehlt = True
        # BEFUND 31.08.2026 (Runde 4): Hier stand nur ein Test darauf, OB
        # "refs/heads/main" im Wert vorkommt. Die exakte UMKEHRUNG — `==`
        # statt `!=`, was genau die main-Laeufe abbricht — galt damit als
        # "ok". Der Commit dazu hiess "Waechter pruefen Werte statt Woerter";
        # eingeloest war nur ein Zeichenketten-Test. Jetzt wird der Vergleich
        # selbst gelesen.
        elif "!=" not in abbruch_text:
            print(f"  FEHLT   cancel-in-progress bricht main nicht aus, sondern ein: {abbruch_text}")
            print("          Erwartet ist `github.ref != 'refs/heads/main'`.")
            ci_fehlt = True
        elif "refs/heads/main" not in abbruch_text:
            print(f"  FEHLT   cancel-in-progress nimmt main nicht aus: {abbruch_text}")
            print("          Ein abgebrochener main-Lauf blockiert die Auslieferung.")
            ci_fehlt = True
        elif "github.sha" not in gruppe_text:
            print("  FEHLT   die Gruppe unterscheidet main-Laeufe nicht je Commit —")
            print("          ein dritter Push storniert dann den zweiten wartenden.")
            ci_fehlt = True
        else:
            print("  ok      main ist vom Abbrechen und von der Gruppe ausgenommen")
    else:
        print("  NICHT MESSBAR: ci.yml fehlt")
        return 2

    print()
    # BEFUND 01.09.2026 (Runde 7, K-7): Einen Pruefschritt aus dem Job
    # `pruefungen` zu entfernen fiel durch KEIN Netz — alle Waechter blieben
    # gruen, die volle Suite auch, und weil der Job weiter gleich heisst, war
    # auch die Branch Protection zufrieden. Ein Waechter, den niemand mehr
    # aufruft, ist kein Waechter.
    #
    # Jeder Waechter muss an ZWEI Stellen erreichbar sein: aus der Pipeline
    # und aus der lokalen Vorabpruefung. Erreichbar heisst nicht "steht
    # woertlich drin": pruefe-zeitzuender.py wird von pruefe-zeitzuender.sh
    # aufgerufen, und nur die .sh steht in den Listen. Darum wird der Aufruf
    # verfolgt, bis nichts Neues mehr dazukommt.
    print("── Wird jeder Waechter auch aufgerufen? ──")
    skripte = sorted(
        set(
            list((WURZEL / "scripts").glob("pruefe-*.py"))
            + list((WURZEL / "scripts").glob("pruefe-*.sh"))
            + list((WURZEL / "scripts").glob("pruefe-*.mjs"))
            + [WURZEL / "scripts" / "selbstpruefung-waechter.sh"]
        )
    )
    skripte = [d for d in skripte if d.exists()]
    # Nicht jedes pruefe-* gehoert in die Kette. Wer hier steht, braucht einen
    # Grund; die Liste ist bewusst kurz und muss es bleiben.
    AUSGENOMMEN = {
        "pruefe-live.sh": "Werkzeug fuer Dritte: rechnet den AUSGELIEFERTEN "
        "Stand gegen das Repo nach, braucht Netz und eine Live-Adresse. Vor "
        "dem Deploy gibt es den Stand noch nicht.",
    }
    # Manche Waechter gehoeren in die Pipeline, aber NICHT in die Pruefung vor
    # dem Push: Die dauert heute 13 Sekunden, und dieser Wert ist ihr Zweck —
    # eine Vorabpruefung, die Minuten braucht, wird umgangen. Wer hier steht,
    # muss in ci.yml stehen; vor-dem-push.sh bleibt frei.
    NUR_PIPELINE = {
        "pruefe-mutationen.mjs": "setzt Mutationen und laesst je Mutation Tests "
        "laufen — Sekunden bei Modulen am Rand, ueber anderthalb Minuten je "
        "Mutation bei zentralen Dateien, an denen 18 Testdateien haengen. Er "
        "laeuft im Job `test-backend`, weil er dort installierte Pakete "
        "vorfindet; ohne sie kann er nicht messen und bricht ehrlich ab. Vor "
        "dem Push wuerde er aus 13 Sekunden Minuten machen — eine "
        "Vorabpruefung, die Minuten braucht, wird umgangen. "
        "(Die fruehere Begruendung 'laeuft neben den langen Suiten und kostet "
        "keine zusaetzliche Wartezeit' war sachlich falsch: Er laeuft IN einem "
        "der langen Jobs und verlaengert ihn — Befund M-P3 der Runde 8.)",
    }
    skripte = [d for d in skripte if d.name not in AUSGENOMMEN]

    def ohne_kommentare(text):
        """Kommentarzeilen weg — sonst zaehlt eine blosse Erwaehnung als
        Aufruf. Dieselbe Falle wie beim cancel-in-progress-Anker: Die
        Begruendung ueber einer Zeile nennt genau die Namen, um die es geht.
        Der erste Entwurf dieser Pruefung meldete deshalb alles gruen, auch
        mit entferntem Pruefschritt — die Rueckbauprobe hat es gezeigt."""
        raus = []
        for zeile in text.split("\n"):
            k = zeile.lstrip()
            if k.startswith("#") or k.startswith("//"):
                continue
            raus.append(zeile)
        return "\n".join(raus)

    def aufruf_von(name, text):
        """Wird `name` hier AUFGERUFEN — oder nur genannt? Der Unterschied
        entschied die Rueckbauprobe: pruefe-mitzieher.py nennt
        pruefe-doppelte-werte.py in einer Zeichenkette als Zustaendigen, und
        damit galt der Waechter als aufgerufen, obwohl sein Pipeline-Schritt
        entfernt war. Verlangt wird jetzt ein Interpreter davor."""
        return re.search(
            r"(?:python3?|sh|bash|node)\s+[\"']?[^\s;|&\"']*"
            + re.escape(name)
            + r"(?=[\"'\s]|$)",
            text,
        ) is not None

    def erreichbar_ab(text):
        """Alle Skriptnamen, die von diesem Text aus aufgerufen werden —
        auch ueber Zwischenschritte."""
        gefunden = set()
        offen = [ohne_kommentare(text)]
        while offen:
            jetzt = offen.pop()
            for datei in skripte:
                if datei.name in gefunden or not aufruf_von(datei.name, jetzt):
                    continue
                gefunden.add(datei.name)
                # selbstpruefung-waechter.sh ruft JEDEN Waechter auf — gegen
                # kuenstliche Proben, nicht gegen dieses Repo. Wer nur dort
                # laeuft, wacht ueber nichts. Sie ist deshalb ein Blattknoten:
                # selbst pruefbar, aber kein Weg zu anderen.
                if datei.name == "selbstpruefung-waechter.sh":
                    continue
                try:
                    offen.append(ohne_kommentare(datei.read_text(encoding="utf-8")))
                except OSError:
                    pass  # unlesbar: gilt als Blattknoten, nicht als Fehler
        return gefunden

    vorab = WURZEL / "scripts" / "vor-dem-push.sh"
    if not vorab.exists():
        print("  NICHT MESSBAR: scripts/vor-dem-push.sh fehlt")
        return 2
    aus_ci = erreichbar_ab(ci)
    aus_vorab = erreichbar_ab(vorab.read_text(encoding="utf-8"))
    waechter_fehlt = []
    for datei in skripte:
        listen = [("ci.yml", aus_ci)]
        if datei.name not in NUR_PIPELINE:
            listen.append(("vor-dem-push.sh", aus_vorab))
        wo = [n for n, m in listen if datei.name not in m]
        if wo:
            waechter_fehlt.append((datei.name, ", ".join(wo)))
    # Und steht jeder Waechter in der Uebersicht? Eine Pruefschicht, deren
    # Zusammenhang nur einer kennt, ist unwartbar — unabhaengig davon, wie gut
    # die einzelnen Teile sind. docs/WAECHTER.md beantwortet je Waechter:
    # wovor schuetzt er, welcher Vorfall hat ihn ausgeloest, was kostet er,
    # welche Ausnahmen kennt er. Ein Eintrag ist Pflicht, damit die Seite
    # nicht so veraltet wie jede andere Doku.
    uebersicht = WURZEL / "docs" / "WAECHTER.md"
    if not uebersicht.exists():
        print("  NICHT MESSBAR: docs/WAECHTER.md fehlt.")
        return 2
    text_uebersicht = uebersicht.read_text(encoding="utf-8")
    undokumentiert = [d.name for d in skripte if d.name not in text_uebersicht]
    if undokumentiert:
        for name in undokumentiert:
            print(f"  FEHLT   {name} steht nicht in docs/WAECHTER.md")
        print("          Wer einen Waechter baut, traegt ihn dort ein — sonst")
        print("          weiss in vier Wochen niemand mehr, wovor er schuetzt.")
        waechter_fehlt.extend((n, "docs/WAECHTER.md") for n in undokumentiert)

    if waechter_fehlt:
        for name, wo in waechter_fehlt:
            if wo == "docs/WAECHTER.md":
                continue
            print(f"  FEHLT   {name} wird nicht aufgerufen aus: {wo}")
        print("          Ein Waechter, den niemand aufruft, ist kein Waechter.")
    else:
        print(f"  ok      alle {len(skripte)} Waechter sind aus beiden Listen erreichbar")
    print()
    # BEFUND 01.09.2026 (erster echter Pipeline-Lauf): VIER Fehler derselben
    # Bauart an einem Tag. Beim Einfuegen neuer Schritte in ci.yml sind Zeilen
    # unter den FALSCHEN Schritt gerutscht: `cache: npm` zweimal,
    # `cache-dependency-path` zweimal, `working-directory` einmal. Das YAML
    # bleibt dabei gueltig, alle 1353 Tests bleiben gruen — es faellt erst auf,
    # wenn GitHub die Datei ausfuehrt ("Caching for 'npm' is not supported",
    # "cannot open scripts/pruefe-zeitzuender.sh"). Drei Pipeline-Laeufe und
    # rund vierzig Minuten Wartezeit gingen dafuer drauf.
    #
    # Diese Pruefung faengt genau das ab: Jede Action kennt eine feste Menge
    # von Eingaben. Steht dort etwas anderes, ist es verrutscht.
    print("── Bekommt jede Action nur Eingaben, die sie kennt? ──")
    ERLAUBT = {
        "actions/setup-node": {
            "node-version", "node-version-file", "architecture", "check-latest",
            "registry-url", "scope", "token", "cache", "cache-dependency-path",
            "always-auth", "mirror", "mirror-token",
        },
        "actions/setup-python": {
            "python-version", "python-version-file", "cache", "architecture",
            "check-latest", "token", "cache-dependency-path",
            "update-environment", "allow-prereleases", "freethreaded",
        },
        "actions/checkout": {
            "repository", "ref", "token", "ssh-key", "ssh-known-hosts",
            "ssh-strict", "ssh-user", "persist-credentials", "path", "clean",
            "filter", "sparse-checkout", "sparse-checkout-cone-mode",
            "fetch-depth", "fetch-tags", "show-progress", "lfs", "submodules",
            "set-safe-directory", "github-server-url",
        },
    }
    # `cache: npm` bei setup-python waere gueltiges YAML und formal erlaubt
    # (setup-python KENNT cache) — aber nur mit pip/poetry/pipenv als Wert.
    WERTE = {("actions/setup-python", "cache"): {"pip", "poetry", "pipenv"}}
    # `cache-dependency-path` KENNEN beide Actions — nur zeigt es bei
    # setup-python auf Python-Dateien. Ein `package-lock.json` dort ist
    # formal gueltig und trotzdem verrutscht; genau so ist es heute zweimal
    # passiert. Deshalb wird hier der WERT gelesen, nicht nur der Schluessel.
    MUSTER = {
        ("actions/setup-python", "cache-dependency-path"): (
            r"(requirements.*\.txt|pyproject\.toml|Pipfile|setup\.py|\.python-version)",
            "erwartet eine Python-Datei (requirements.txt, pyproject.toml, …)",
        ),
        ("actions/setup-node", "cache-dependency-path"): (
            r"(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)",
            "erwartet eine npm-Datei (package-lock.json, yarn.lock, …)",
        ),
    }

    verrutscht = []
    aktuelle_action = None
    in_with = False
    for nr, zeile in enumerate(ci.split("\n"), 1):
        kern = zeile.strip()
        if kern.startswith("- uses:"):
            name = kern.split("uses:", 1)[1].strip().split("@")[0]
            aktuelle_action = name if name in ERLAUBT else None
            in_with = False
            continue
        if kern.startswith("- ") or (zeile and not zeile.startswith(" ")):
            aktuelle_action = None
            in_with = False
            continue
        if aktuelle_action and kern == "with:":
            in_with = True
            continue
        if not (aktuelle_action and in_with) or not kern or kern.startswith("#"):
            continue
        if ":" not in kern:
            continue
        schluessel = kern.split(":", 1)[0].strip()
        wert = kern.split(":", 1)[1].strip().strip('"').strip("'")
        if schluessel not in ERLAUBT[aktuelle_action]:
            verrutscht.append((nr, aktuelle_action, schluessel, "kennt diese Eingabe nicht"))
        elif (aktuelle_action, schluessel) in WERTE and wert not in WERTE[(aktuelle_action, schluessel)]:
            erlaubt = ", ".join(sorted(WERTE[(aktuelle_action, schluessel)]))
            verrutscht.append((nr, aktuelle_action, schluessel, f"Wert '{wert}' — erlaubt: {erlaubt}"))
        elif (aktuelle_action, schluessel) in MUSTER:
            muster, erklaerung = MUSTER[(aktuelle_action, schluessel)]
            if not re.search(muster, wert):
                verrutscht.append((nr, aktuelle_action, schluessel, f"Wert '{wert}' — {erklaerung}"))

    if verrutscht:
        for nr, action, schluessel, grund in verrutscht:
            print(f"  FEHLT   ci.yml:{nr}  {action} → '{schluessel}': {grund}")
        print("          Beim Einfuegen verrutscht? Das YAML bleibt dabei gueltig.")
        ci_fehlt = True
    else:
        print("  ok      jede Action bekommt nur Eingaben, die sie kennt")
    print()

    print()

    anzahl = len(fehlt) + len(falsch_platziert) + len(ohne_abbruch) + len(ohne_bilanz) + (1 if ci_fehlt else 0) + len(waechter_fehlt)
    if anzahl == 0:
        print("  ERGEBNIS: Notschalter vollstaendig gemeldet, Pipeline-Einstellung ok.")
        print("  (Die Riegel SELBST prueft deploy-verhalten.test.js — ausgefuehrt, nicht gelesen.)")
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
