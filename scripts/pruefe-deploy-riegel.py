#!/usr/bin/env python3
"""
pruefe-deploy-riegel.py — Pruefungen an der Auslieferungskette, die Text lesen.

WAS DIESES SKRIPT NICHT (MEHR) TUT: Es prueft KEINE Riegel in `deploy.sh`.

Bis zum 31.08.2026 tat es das ueber Textmuster. Drei Pruefer haben es
unabhaengig ausgehebelt — `exit` durch `:` ersetzt, `echo` stehen gelassen —
und bekamen weiter "Alle Riegel vorhanden". Zwoelf realistische Rueckbauten (einzeln gemessen)
blieben unbemerkt. Ein Textmuster belegt kein Verhalten.

Die Riegel selbst prueft jetzt `functions/src/__tests__/deploy-verhalten.test.js`:
Es fuehrt `deploy.sh` in einem Wegwerf-Klon aus, mit Attrappen fuer firebase,
gh, verify-infrastructure und live-smoke. Rueckbauproben belegen, dass
jeder Fall rot wird, wenn der zugehoerige Riegel faellt.

WAS HIER BLEIBT, sind die Fragen, bei denen es wirklich um Text geht:

  1. Wird jeder Notschalter (SKIP_*) in der Schlussbilanz genannt? Sonst sieht
     ein Lauf gruen aus, obwohl eine Pruefung uebersprungen wurde.
  2. Ist die concurrency-Einstellung der Pipeline richtig? Geprueft wird der
     VERGLEICH, nicht nur das Vorkommen der Woerter.
  3. Bekommt jeder Job die Historie, die er braucht, und jede Action nur
     Eingaben, die sie kennt?
  4. Wird jeder Waechter aufgerufen — aus der Pipeline und vor dem Push?
  5. Entsprechen die Pipeline-Dateien ihrem Vertrag? Alle fuenf Workflows und
     `dependabot.yml` sind per Pruefsumme festgeschrieben; fuer `ci.yml` steht
     dazu je Pflicht-Job, welche Pruefbefehle er ausfuehren muss
     (OPS-2026-10-03-12). Ein Pflicht-Job bleibt gruen, wenn man seinen
     Testlauf streicht — der Zweigschutz und `deploy.sh` sehen nur Name und
     Ergebnis, nicht, was der Job getan hat. Festgelegt ist auch, was HINTER
     einem solchen Schritt steht: der Inhalt der npm-Skripte in beiden
     `package.json` und die Einstellungen der Pruefwerkzeuge. Sonst behielte
     `npm test` seinen Wortlaut und fuehrte `echo ok` aus.

BEKANNTE GRENZE (Runde 4, F-4): Wer `deploy-verhalten.test.js` loescht, faellt
hier nicht auf — dieses Skript kennt die Datei nicht. Der Schutz dagegen liegt
in `pruefe-kopplung.py` ("UNVERZICHTBARE PRUEFUNG FEHLT") und in
`selbstpruefung-waechter.sh` (eine Probe schlaegt fehl); beide gemessen am
01.09.2026 mit geloeschter Datei. `pruefe-mitzieher.py` faengt diesen Fall
NICHT — die urspruengliche Zuschreibung war falsch (Runde 7, K-5).
"""

import fnmatch
import hashlib
import json
import os
import re
import subprocess
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





# ── Vertraege fuer die Sicherheits-Workflows (Befunde H-01, H-02) ──────────────
PRUEFJOBS_NACHTS = {
    "npm-luecken": "node scripts/audit-gate.mjs functions .",
    "mitgelieferte-bibliotheken": "node scripts/pruefe-fremd-meldungen.mjs",
    "abkuendigungen": "node scripts/pruefe-abkuendigungen.mjs",
}
# Pruefsummen der Pipeline-Dateien, VOLLSTAENDIG (Befund J-01, 30.09.2026).
# Die erste Fassung schrieb nur einzelne Jobs fest und liess jede Zeile mit
# "uses:" aus — 23 Veraenderungen bestanden sie, darunter ein geloeschter
# Monats-Zeitplan, Schluessel in Anfuehrungszeichen, Job-env und eine
# Kommentarzeile mitten in einem mehrzeiligen Befehl. Jetzt zaehlt die ganze
# Datei. Normalisiert wird nur, was nachweislich nichts bewirkt:
#   · ganze Zeilen der Form `uses: owner/repo@<40 hex> # vN` — SHA und
#     Kommentar (Dependabot hebt sie an); owner/repo zaehlt weiter,
#   · Kommentar- und Leerzeilen AUSSERHALB von Blockskalaren (| >). Innerhalb
#     eines `run: |` oder `if: >-` zaehlt jede Zeile: Dort kann eine
#     "#"-Zeile einen Befehl zerteilen oder Teil eines Ausdrucks werden,
#   · Leerzeilen am Dateiende, auch im letzten Block (Befund N-03: bei `|`
#     aendern sie den Wert nicht; ein `|+` am Ende waere eine geaenderte
#     Nicht-Kommentarzeile und zaehlt).
# Eine bewusste Aenderung traegt man hier nach:
# `python3 scripts/pruefe-deploy-riegel.py --vertrag-summen`. Die Summe
# schuetzt vor Versehen, nicht vor Absicht — die Aenderung am Workflow steht
# im selben Pull Request sichtbar im Diff.
#
# OPS-2026-10-03-12: Festgeschrieben sind ALLE Dateien, die bestimmen, was die
# Pipeline prueft und was ohne Mensch auf `main` gelangt — nicht nur die beiden
# Sicherheits-Workflows. `ci.yml` ist die Quelle aller sechs Pflicht-Checks;
# `release.yml` und `dependabot-automerge.yml` laufen mit Schreibrechten;
# `dependabot.yml` bestimmt, welche Pakete ueberhaupt Updates bekommen.
VERTRAG_SUMMEN = {
    "sicherheit-nachts.yml": "46e7e74b721601db",
    "libheif-bau.yml": "39f0db0be0a0a3e0",
    "ci.yml": "07cdd01ce0f5073d",
    "release.yml": "1fd803f6e5167738",
    "dependabot-automerge.yml": "1a3aa65db26ff8bd",
    "dependabot.yml": "204892976a7df7e5",
}
# Wo die Dateien liegen: alle unter .github/workflows — bis auf diese.
VERTRAG_ORT = {"dependabot.yml": ".github/dependabot.yml"}
_USES_ZEILE = re.compile(r"^([ ]*(?:- )?uses: )([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)@[0-9a-f]{40} # .*$")

# ── Was jeder Pflicht-Job der Pipeline ausfuehren MUSS (OPS-2026-10-03-12) ────
#
# Die sechs Jobs sind die Pflicht-Checks des Zweigschutzes, und `deploy.sh`
# verlangt jeden davon gruen (Liste PFLICHT dort). Beide sehen aber nur NAME
# und ERGEBNIS eines Jobs. Streicht jemand beim Ueberarbeiten von `ci.yml` den
# Testlauf aus einem Job, bleibt der Job gruen, der Pull Request geht durch, und
# die Auslieferung auch.
#
# Deshalb steht hier je Job, welche Schritte ihn ausmachen. Gemessen werden die
# tatsaechlichen Schritte des Jobs, nicht ein Vorkommen im Text: Der Kommentar
# ueber einem Schritt nennt meist genau den Namen, um den es geht. Ein Eintrag
# ist ein `run:`-Befehl im Wortlaut; "uses: owner/repo" verlangt eine Action.
#
# Die Liste nennt, was einen Job AUSMACHT — nicht alles, was in ihm steht
# (Einrichtung, weitere Waechter). Jeden Schritt in seiner Reihenfolge haelt
# SCHRITTFOLGE_CI weiter unten fest; dass kein Aufruf eines Waechters verloren
# geht, prueft der Abschnitt "Wird jeder Waechter auch aufgerufen?"; alles
# Uebrige an der Datei haelt die Pruefsumme oben. Beide Listen bleiben auch
# dann rot, wenn jemand die Summe nachtraegt.
PFLICHTJOBS_CI = {
    "test-backend": [
        "node ../scripts/audit-gate.mjs functions .",
        "npm run lint",
        "npm run format:check",
        "npm test",
        "sh scripts/pruefe-zeitzuender.sh . --nur backend",
    ],
    "test-frontend": [
        "npm run lint:frontend",
        "npm run format:frontend:check",
        "npm run test:frontend",
        "sh scripts/pruefe-zeitzuender.sh . --nur frontend",
    ],
    "test-e2e": ["npm run test:e2e"],
    "secret-scan": ["uses: gitleaks/gitleaks-action"],
    "playwright-version": ["sh scripts/nur-nachtrag.sh"],
    "pruefungen": [
        "sh scripts/pruefungen/selbstpruefung.sh",
        "python3 scripts/pruefungen/checks/aussentext.py .",
        "python3 scripts/pruefungen/checks/fakten-drift.py .",
        "python3 scripts/pruefungen/checks/stiller-fehlschlag.py .",
        "python3 scripts/pruefungen/checks/stiller-fehlschlag.py .github",
        "python3 scripts/pruefungen/checks/test-blind.py .",
        "bash scripts/selbstpruefung-waechter.sh",
    ],
}
# Die einzige Bedingung, unter der ein Pflicht-Job entfallen darf: Der
# Browser-Test bei einem reinen Auslieferungs-Nachtrag (docs/SECURITY-MODEL.md,
# "Nachtrag ohne Browser-Test"). Er steht dann auf "skipped", und `deploy.sh`
# wertet das nie als bestanden.
JOB_BEDINGUNG_CI = {"test-e2e": "needs.playwright-version.outputs.nur_nachtrag != 'ja'"}

# ── Unter welchen Umstaenden ein Pflichtbefehl laeuft (OPS-2026-10-03-12) ─────
#
# Der Wortlaut eines Schritts sagt nicht, OB er laeuft und WAS er dabei
# ausfuehrt. Mit `if: false` behaelt `- run: npm test` seinen Wortlaut und laeuft
# nie. Ein anderer Arbeitsordner laesst denselben Wortlaut eine andere
# `package.json` meinen, eine andere Shell fuehrt ihn gar nicht aus, und ueber
# die Umgebung laesst sich npm ebenso umlenken wie die Shell.
#
# Deshalb gilt fuer jeden Schritt mit einem Pflichtbefehl: Die Schluessel aus
# SCHRITT_SCHLUESSEL stehen dort nur mit dem Wert, der hier festgelegt ist —
# sonst gar nicht. Auf der Ebene des Jobs gilt dasselbe fuer `defaults` (der
# Arbeitsordner aller Schritte) und `env`; ganz oben in der Datei steht keins
# von beiden. `continue-on-error` ist im ganzen Job verboten, siehe `vertrag_ci`.
#
# Ein Wert ist die Liste seiner Zeilen: der Text hinter dem Doppelpunkt, dann
# die tiefer eingerueckten Zeilen darunter, jeweils ohne Einzug.
SCHRITT_SCHLUESSEL = ("if", "shell", "working-directory", "env")
SCHRITT_FESTLEGUNG_CI = {
    # Der Job laeuft in functions/, dieses eine Skript in der Wurzel.
    ("test-backend", "sh scripts/pruefe-zeitzuender.sh . --nur backend"): {"working-directory": ["."]},
    ("secret-scan", "uses: gitleaks/gitleaks-action"): {"env": ["GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}"]},
    ("playwright-version", "sh scripts/nur-nachtrag.sh"): {
        "env": ["BASIS: ${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || '' }}"]
    },
}
JOB_ORDNER_CI = {"test-backend": "functions"}
JOB_UMGEBUNG_CI = {"test-e2e": ["HOME: /root"]}

# ── Die ganze Schrittfolge jedes Pflicht-Jobs (OPS-2026-10-04-27) ─────────────
#
# PFLICHTJOBS_CI nennt die Befehle, die einen Job ausmachen. Das genuegt nicht:
# Ein Schritt, der DAZUKOMMT, laeuft im selben Job und in derselben Arbeitskopie
# — vor oder zwischen den Pruefungen. Er kann ein npm-Skript erst im Lauf
# ueberschreiben oder Testdateien entfernen; `package.json` und jeder
# Pflichtbefehl lauten dann weiter wie festgelegt, und geprueft wird nichts.
# Dasselbe leistet ein vorhandener Einrichtungsschritt mit einer eigenen Shell,
# einem angehaengten Befehl oder einem anderen Stand beim Auschecken.
#
# Deshalb steht hier je Pflicht-Job JEDER Schritt in seiner Reihenfolge, als
# eine Zeile im Wortlaut (Schreibweise: `_schritt_wortlaut`). Kommentarzeilen
# und die Versionskennung hinter einer Action zaehlen nicht. Wer einen Schritt
# bewusst einfuegt oder aendert, traegt ihn hier nach — lesbar im selben Diff,
# nicht als Pruefsumme. Die heutige Folge im passenden Format:
#     python3 scripts/pruefe-deploy-riegel.py --vertrag-schritte
SCHRITTFOLGE_CI = {
    "test-backend": [
        "uses: actions/checkout | with: fetch-depth: 0",
        "uses: actions/setup-node | with: node-version: \"24\" / cache: npm / cache-dependency-path: functions/package-lock.json",
        "uses: actions/setup-python | with: python-version: \"3.12\"",
        "run: npm ci",
        "run: node ../scripts/audit-gate.mjs functions .",
        "run: npm run lint",
        "run: npm run format:check",
        "run: npm test",
        "run: sh scripts/pruefe-zeitzuender.sh . --nur backend | working-directory: .",
    ],
    "test-frontend": [
        "uses: actions/checkout",
        "uses: actions/setup-node | with: node-version: \"24\" / cache: npm / cache-dependency-path: package-lock.json",
        "uses: actions/setup-python | with: python-version: \"3.12\"",
        "run: npm ci",
        "run: npm run lint:frontend",
        "run: npm run format:frontend:check",
        "run: npm run test:frontend",
        "run: sh scripts/pruefe-zeitzuender.sh . --nur frontend",
    ],
    "test-e2e": [
        "uses: actions/checkout",
        "uses: actions/setup-node | with: node-version: \"24\" / cache: npm / cache-dependency-path: package-lock.json",
        "run: npm ci",
        "run: npm run test:e2e",
        "name: Fehlerbilder und Aufzeichnungen sichern | if: failure() | uses: actions/upload-artifact | with: name: playwright-fehler / path: | / test-results/ / playwright-report/ / retention-days: 7 / if-no-files-found: ignore",
    ],
    "secret-scan": [
        "uses: actions/checkout | with: fetch-depth: 0",
        "uses: gitleaks/gitleaks-action | env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    ],
    "playwright-version": [
        "uses: actions/checkout | with: fetch-depth: 0",
        "id: lesen | run: | / VERSION=$(node -p \"require('./package-lock.json').packages['node_modules/@playwright/test'].version\") / echo \"Playwright laut Lockfile: $VERSION\" / echo \"version=$VERSION\" >> \"$GITHUB_OUTPUT\"",
        "id: nachtrag | env: BASIS: ${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || '' }} | run: sh scripts/nur-nachtrag.sh",
    ],
    "pruefungen": [
        "uses: actions/checkout | with: fetch-depth: 0",
        "uses: actions/setup-node | with: node-version: \"24\"",
        "uses: actions/setup-python | with: python-version: \"3.12\"",
        "run: npm ci",
        "run: npm ci --prefix functions",
        "run: sh scripts/pruefungen/selbstpruefung.sh",
        "run: python3 scripts/pruefungen/checks/aussentext.py .",
        "run: python3 scripts/pruefungen/checks/fakten-drift.py .",
        "run: python3 scripts/pruefungen/checks/stiller-fehlschlag.py .",
        "run: python3 scripts/pruefungen/checks/stiller-fehlschlag.py .github",
        "run: python3 scripts/pruefungen/checks/test-blind.py .",
        "run: python3 scripts/pruefe-i18n-fallbacks.py",
        "run: python3 scripts/pruefe-tote-geduld.py",
        "run: sh scripts/pruefe-commit-nachrichten.sh",
        "run: python3 scripts/pruefe-doppelte-werte.py",
        "run: python3 scripts/pruefe-mitzieher.py",
        "run: python3 scripts/pruefe-kopplung.py",
        "run: python3 scripts/pruefe-deploy-riegel.py",
        "run: node scripts/pruefe-workflows-gueltig.mjs",
        "run: bash scripts/selbstpruefung-waechter.sh",
        "run: node scripts/pruefe-fremddateien.mjs",
        "run: node scripts/pruefe-fremd-meldungen.mjs --nur-deckung",
        "run: node scripts/pruefe-auslieferbare-reste.mjs",
        "run: node scripts/pruefe-vendorierung.mjs",
    ],
}

# ── Was HINTER den Pflicht-Schritten steht (OPS-2026-10-03-12) ────────────────
#
# `ci.yml` haelt den Wortlaut fest: `npm test`. Was dieses Skript ausfuehrt,
# steht in `package.json`. Ersetzt jemand dort den Inhalt durch `echo ok`,
# bleibt der Schritt wortgleich und gruen — und geprueft wird nichts mehr.
#
# Deshalb steht hier je Datei, was die Skripte tun, die ein Pflicht-Schritt
# aufruft, und dazu die Sammelbefehle, die diese Skripte ihrerseits aufrufen:
# `deploy.sh` nimmt sie fuer seine Ersatzlaeufe, `pruefstand.sh` fuer die
# Zahlen in docs/VERIFICATION.md. Zu keinem dieser Skripte gibt es ein
# `pre…` oder `post…`, das npm ungefragt mitlaufen liesse.
NPM_SKRIPTE = {
    "functions/package.json": {
        "test": "jest --forceExit --detectOpenHandles",
        "lint": "eslint --max-warnings=0 src/",
        "format:check": "prettier --check src/",
    },
    "package.json": {
        "test:frontend": "vitest run",
        "test:e2e": "playwright test",
        "lint:frontend": "eslint --max-warnings=0 public/js/ public/app.js public/__tests__/",
        "format:frontend:check": "prettier --check public/js/ public/app.js public/__tests__/",
        "test": "npm run test:backend && npm run test:frontend",
        "test:backend": "npm test --prefix functions",
        "lint": "npm run lint:frontend && npm run lint --prefix functions",
        "format:check": "npm run format:frontend:check && npm run format:check --prefix functions",
    },
}
# Pakete, die ein eigenes Skript LAEDT, stehen in der genannten package.json
# als eigene Abhaengigkeit (OSS-2026-10-04-13). Der Paket-Waechter braucht
# minimatch; bis 07.10.2026 kam es nur als Mitbringsel von eslint herein und
# waere mit dessen naechstem Umbau verschwunden — der Waechter haette dann
# "nicht messbar" gemeldet, ohne dass hier jemand etwas geaendert haette.
SKRIPT_PAKETE = {
    "package.json": {"minimatch": "scripts/pruefe-auslieferbare-reste.mjs"},
}
# Dasselbe eine Ebene tiefer: Auch bei wortgleichem Skript entscheidet die
# Einstellung des Werkzeugs, WELCHE Dateien es ansieht. Gemessen am 04.10.2026:
# Mit einer geaenderten Einstellung meldete jeder der drei Testlaeufer "gruen",
# ohne eine Testdatei auszufuehren, und Prettier liess ganze Ordner aus.
#
# Jest liest seine Einstellung aus `functions/package.json`; sie steht hier im
# Wortlaut. Die uebrigen Dateien sind per Pruefsumme festgeschrieben — ueber
# jedes Byte, ohne Ausnahme fuer Kommentare (anders als bei den Workflows gibt
# es hier keine Zeile, die Dependabot aendert).
#
# Dazu gehoert die Vorbereitungsdatei, die Jest vor jeder Testdatei ausfuehrt
# (`functions/jest.setup.js`, in JEST_EINSTELLUNG genannt): Sie ist Programm,
# keine Liste — eine einzige Zeile darin kann `test` durch eine Fassung
# ersetzen, die jeden Test ueberspringt, und der Lauf endet gruen.
JEST_EINSTELLUNG = {
    "testPathIgnorePatterns": ["/node_modules/", "/__tests__/hilfen/"],
    "setupFilesAfterEnv": ["<rootDir>/jest.setup.js"],
}
EINSTELLUNG_SUMMEN = {
    "vitest.config.js": "1851f0fc6e40147a",
    "playwright.config.js": "794814e3b370477b",
    "eslint.config.mjs": "e4f7e95827ef01ba",
    "functions/eslint.config.js": "ca9536911333625f",
    ".prettierignore": "ee7c566a5bcc22f7",
    "functions/jest.setup.js": "bb2f276fb49ed0f0",
}
# Dateien, die es NICHT gibt und nicht geben darf, ohne dass sie hier stehen:
# Ein Werkzeug liest sie vor oder neben der festgeschriebenen Einstellung
# (`vitest.config.ts` hat Vorrang vor `vitest.config.js`), und eine `.npmrc`
# kann jedes npm-Skript ins Leere laufen lassen (`script-shell`). Je Ordner die
# Muster der Dateinamen; was in EINSTELLUNG_SUMMEN steht, ist ausgenommen.
EINSTELLUNG_FREMD = {
    "": ("vitest.config.*", "vite.config.*", "vitest.workspace.*", "playwright.config.*", "eslint.config.*", ".npmrc"),
    "functions": ("jest.config.*", "eslint.config.*", ".prettierignore", ".npmrc"),
}


def _ohne_kommentarzeilen(text):
    return "\n".join(z for z in text.split("\n") if not z.lstrip().startswith("#"))


def _jobbloecke(text):
    if "\njobs:\n" not in text:
        return {}
    teil = text.split("\njobs:\n", 1)[1]
    bloecke = {}
    for b in re.split(r"(?m)^  (?=[A-Za-z0-9_-]+:\s*$)", teil)[1:]:
        bloecke[b.split(":", 1)[0]] = b
    return bloecke


def _summe(text):
    """Pruefsumme einer Workflow-Datei, blockbewusst normalisiert (siehe oben)."""
    import hashlib

    # Befunde K-01 (Runde 4) und N-01 (Runde 5): Als Leerraum gilt NUR das
    # Leerzeichen. Pythons strip() nahm auch das geschuetzte Leerzeichen
    # (U+00A0) dafuer, das YAML als Inhalt liest; und einen Tab vor einem
    # Kommentar lehnt GitHubs Leser ab, obwohl YAML 1.2 ihn erlaubt. Eine
    # Kommentarzeile beendet keinen Block: Mit zu wenig Einzug macht sie die
    # Datei ungueltig, sie muss also mitzaehlen. Leerzeilen am Dateiende
    # zaehlen nicht (sonst Fehlalarm, Befund N-03).
    raus = []
    block = None
    for zeile in text.rstrip("\n").split("\n"):
        kern = zeile.strip(" ")
        einzug = len(zeile) - len(zeile.lstrip(" "))
        if block is not None and kern and not kern.startswith("#") and einzug <= block:
            block = None
        if block is None:
            if not kern or kern.startswith("#"):
                continue
            m = _USES_ZEILE.match(zeile)
            raus.append(m.group(1) + m.group(2) + "@SHA # K" if m else zeile)
            k = re.match(r"""^([ ]*)(?:- )?[A-Za-z0-9_"'-]+:\s*[|>][-+0-9]*\s*(#.*)?$""", zeile)
            if k:
                block = len(k.group(1)) + (2 if zeile.lstrip(" ").startswith("- ") else 0)
        else:
            raus.append(zeile)
    return hashlib.sha256("\n".join(raus).encode("utf-8")).hexdigest()[:16]


def _kopfteil_maengel(text, name):
    maengel = []
    kopf = text.split("\njobs:\n", 1)[0]
    if re.search(r"""(?m)^["']?(env|defaults)["']?\s*:""", kopf):
        maengel.append(f"{name}: env/defaults auf oberster Ebene — koennte jede Pruefung umlenken")
    return maengel


def vertrag_nachts(text):
    if _summe(text) != VERTRAG_SUMMEN["sicherheit-nachts.yml"]:
        return ["sicherheit-nachts.yml weicht vom festgeschriebenen Stand ab (Pruefsumme der ganzen Datei)"] + (
            _vertrag_nachts_einzeln(text)
        )
    return _vertrag_nachts_einzeln(text)


def _vertrag_nachts_einzeln(text):
    t = _ohne_kommentarzeilen(text)
    m = _kopfteil_maengel(t, "sicherheit-nachts.yml")
    if not re.search(r'(?m)^    - cron: "\d{1,2} \d{1,2} \* \* \*"(?:\s+#.*)?$', t):
        m.append("sicherheit-nachts.yml: kein taeglicher Zeitplan — der Nachtlauf liefe nie von selbst")
    bloecke = _jobbloecke(t)
    if set(bloecke) != set(PRUEFJOBS_NACHTS) | {"alarm"}:
        m.append(f"sicherheit-nachts.yml: Jobliste {sorted(bloecke)} statt {sorted(set(PRUEFJOBS_NACHTS) | {'alarm'})}")
    for job, befehl in PRUEFJOBS_NACHTS.items():
        b = bloecke.get(job, "")
        laeufe = re.findall(r"(?m)^\s+(?:- )?run:\s*(.*)$", b)
        if laeufe != [befehl]:
            m.append(f"sicherheit-nachts.yml: Job {job} hat run {laeufe!r} statt genau {befehl!r}")
        for verboten in ("if:", "continue-on-error", "timeout-minutes", "shell:", "working-directory"):
            if re.search(rf"(?m)^\s+(?:- )?{verboten}", b):
                m.append(f"sicherheit-nachts.yml: Job {job} traegt '{verboten}' — er koennte still entfallen")
        fremd = [e for e in re.findall(r"(?m)^\s{10}([A-Za-z_][A-Za-z0-9_]*):", b) if e != "GITHUB_TOKEN"]
        if fremd:
            m.append(f"sicherheit-nachts.yml: Job {job} setzt {fremd} — die Pruefung liesse sich umlenken")
    return m


def vertrag_libheif_bau():
    datei = WURZEL / ".github" / "workflows" / "libheif-bau.yml"
    if not datei.exists():
        return ["libheif-bau.yml fehlt — der Deploy-Riegel verlangt seinen Lauf"]
    roh = datei.read_text(encoding="utf-8")
    t = _ohne_kommentarzeilen(roh)
    m = _kopfteil_maengel(t, "libheif-bau.yml")
    if _summe(roh) != VERTRAG_SUMMEN["libheif-bau.yml"]:
        m.append("libheif-bau.yml weicht vom festgeschriebenen Stand ab (Pruefsumme der ganzen Datei)")
    bloecke = _jobbloecke(t)
    if set(bloecke) != {"bauen", "kontrollbau"}:
        m.append(f"libheif-bau.yml: Jobliste {sorted(bloecke)} statt ['bauen', 'kontrollbau']")
    return m


def _vertragsdatei(name):
    return WURZEL / VERTRAG_ORT.get(name, f".github/workflows/{name}")


def vertrag_weitere_summen():
    """Die Pipeline-Dateien, fuer die es ueber die Pruefsumme hinaus keinen
    eigenen Vertrag gibt (und `ci.yml`, deren inhaltlicher Teil in
    `vertrag_ci` steht)."""
    m = []
    for name in VERTRAG_SUMMEN:
        if name in ("sicherheit-nachts.yml", "libheif-bau.yml"):
            continue  # haben ihren eigenen Vertrag samt Summe, siehe oben
        datei = _vertragsdatei(name)
        if not datei.exists():
            m.append(f"{name} fehlt — die Datei gehoert zum festgeschriebenen Stand der Pipeline")
            continue
        if _summe(datei.read_text(encoding="utf-8")) != VERTRAG_SUMMEN[name]:
            m.append(f"{name} weicht vom festgeschriebenen Stand ab (Pruefsumme der ganzen Datei)")
    return m


def _schritte(block):
    """Die Schritte eines Job-Blocks: jeder `run:`-Befehl im Wortlaut, jede
    Action als "uses: owner/repo" (ohne Versionskennung)."""
    laeufe = [befehl.strip() for befehl in re.findall(r"(?m)^\s+(?:- )?run:\s*(.*)$", block)]
    actions = ["uses: " + a for a in re.findall(r"(?m)^\s+(?:- )?uses:\s*([^@\s]+)", block)]
    return laeufe + actions


def _ebene(zeilen, einzug):
    """Die Schluessel einer YAML-Ebene mit ihrem Wert (Liste der Zeilen: Text
    hinter dem Doppelpunkt, dann die tiefer eingerueckten Zeilen darunter).
    Ein Schluessel in Anfuehrungszeichen zaehlt wie einer ohne. Eine Zeile, die
    auf dieser Ebene kein Schluessel ist, landet unter "?" — der Vertrag wertet
    das als Mangel, statt etwas zu uebersehen, das er nicht lesen kann."""
    muster = re.compile(r"""^ {%d}["']?([A-Za-z][A-Za-z0-9_-]*)["']?\s*:(?:\s+(.*))?$""" % einzug)
    werte = {}
    aktuell = None
    for zeile in zeilen:
        if not zeile.strip(" "):
            continue
        treffer = muster.match(zeile)
        if treffer:
            aktuell = treffer.group(1)
            werte.setdefault(aktuell, [])
            if (treffer.group(2) or "").strip(" "):
                werte[aktuell].append(treffer.group(2).strip(" "))
        elif aktuell is not None and zeile.startswith(" " * (einzug + 1)):
            werte[aktuell].append(zeile.strip(" "))
        else:
            werte.setdefault("?", []).append(zeile.strip(" "))
    return werte


def _schrittbloecke(block):
    """Die Schritte eines Job-Blocks in der ueblichen Schreibweise (`steps:`
    mit vier Leerzeichen Einzug, jeder Schritt beginnt mit `      - `): je
    Schritt seine Schluessel wie in `_ebene`. None, wenn `steps:` so nicht
    dasteht."""
    zeilen = block.split("\n")
    anfang = next((i for i, z in enumerate(zeilen) if re.match(r"^    steps:\s*$", z)), None)
    if anfang is None:
        return None
    schritte = []
    for zeile in zeilen[anfang + 1 :]:
        if not zeile.strip(" "):
            continue
        if zeile.startswith("      - "):
            # Der Strich steht fuer zwei Leerzeichen: Danach liegen alle
            # Schluessel des Schritts auf derselben Ebene.
            schritte.append(["        " + zeile[8:]])
        elif zeile.startswith("        ") and schritte:
            schritte[-1].append(zeile)
        else:
            break
    return [_ebene(schritt, 8) for schritt in schritte]


def _befehl(schritt):
    """Der Befehl eines Schritts in der Schreibweise von PFLICHTJOBS_CI."""
    if schritt.get("run"):
        return schritt["run"][0]
    if schritt.get("uses"):
        return "uses: " + schritt["uses"][0].split("@", 1)[0]
    return None


def _schritt_wortlaut(schritt):
    """Ein Schritt als EINE Zeile, in der Schreibweise von SCHRITTFOLGE_CI: seine
    Schluessel in der Reihenfolge der Datei, je `schluessel: wert`, getrennt
    mit " | "; die Zeilen eines mehrzeiligen Werts getrennt mit " / ". Bei
    `uses` zaehlt nur "owner/repo" — die Versionskennung aendert Dependabot."""
    teile = []
    for schluessel, wert in schritt.items():
        if schluessel == "uses" and wert:
            wert = [wert[0].split("@", 1)[0]] + wert[1:]
        teile.append(f"{schluessel}: " + " / ".join(wert))
    return " | ".join(teile)


def _schrittfolgen(ci_text):
    """Je Pflicht-Job die Schrittfolge, wie sie in `ci.yml` steht — oder None,
    wenn der Job fehlt oder nicht in der ueblichen Schreibweise dasteht."""
    bloecke = _jobbloecke(_ohne_kommentarzeilen(ci_text))
    folgen = {}
    for job in PFLICHTJOBS_CI:
        schritte = _schrittbloecke(bloecke[job]) if job in bloecke else None
        folgen[job] = None if schritte is None else [_schritt_wortlaut(s) for s in schritte]
    return folgen


def vertrag_schritte_ausgeben():
    """Die Schrittfolgen aus `ci.yml` in der Schreibweise der Liste oben — zum
    Nachtragen nach einer bewussten Aenderung an einem Pflicht-Job."""
    import json

    print("SCHRITTFOLGE_CI = {")
    for job, folge in _schrittfolgen(CI.read_text(encoding="utf-8")).items():
        print(f'    "{job}": [')
        for wortlaut in folge or []:
            print(f"        {json.dumps(wortlaut, ensure_ascii=False)},")
        print("    ],")
    print("}")


def _npm_skript(befehl):
    """Name des npm-Skripts, das ein Pflichtbefehl aufruft — sonst None."""
    if befehl == "npm test":
        return "test"
    treffer = re.fullmatch(r"npm run ([A-Za-z][A-Za-z0-9:_-]*)", befehl)
    return treffer.group(1) if treffer else None


def vertrag_ci(ci_text, deploy_text):
    """Der inhaltliche Vertrag fuer `ci.yml`: Was jeder Pflicht-Job tun muss.
    `deploy_text` ist deploy.sh ohne Kommentarzeilen — von dort kommt die Liste
    der Pflicht-Checks, die die Auslieferung verlangt."""
    t = _ohne_kommentarzeilen(ci_text)
    m = []

    # Die Pflicht-Jobs hier und die Pflicht-Checks in deploy.sh muessen dieselben
    # sein. Sonst verlangt die Auslieferung einen Check, dessen Inhalt niemand
    # festhaelt — oder dieser Vertrag einen, den die Auslieferung nicht verlangt.
    treffer = re.search(r'(?m)^\s*PFLICHT="([^"]*)"', deploy_text)
    if not treffer:
        m.append("deploy.sh nennt keine Liste PFLICHT — welche Pflicht-Checks die Auslieferung verlangt, ist nicht lesbar")
    elif set(treffer.group(1).split()) != set(PFLICHTJOBS_CI):
        m.append(
            f"deploy.sh verlangt die Pflicht-Checks {sorted(treffer.group(1).split())}, "
            f"der Vertrag der Pipeline nennt {sorted(PFLICHTJOBS_CI)} — beide Listen muessen gleich sein"
        )

    # Rechte des Pipeline-Tokens: nur lesen, und kein Job hebt das fuer sich auf.
    kopf = t.split("\njobs:\n", 1)[0]
    rechte = re.search(r"(?m)^permissions:[ ]*\n((?:[ ]+\S.*\n?)+)", kopf)
    if not rechte or [z.strip() for z in rechte.group(1).splitlines()] != ["contents: read"]:
        m.append("ci.yml: Rechte des Pipeline-Tokens sind nicht genau 'permissions: contents: read'")

    # Ganz oben in der Datei steht weder `env` noch `defaults`: Beides gaelte
    # fuer jeden Schritt jedes Jobs.
    m.extend(_kopfteil_maengel(t, "ci.yml"))

    bloecke = _jobbloecke(t)
    for job, befehle in PFLICHTJOBS_CI.items():
        if job not in bloecke:
            m.append(f"ci.yml: Pflicht-Job {job} fehlt")
            continue
        b = bloecke[job]
        vorhanden = _schritte(b)
        for befehl in befehle:
            if befehl not in vorhanden:
                m.append(f"ci.yml: Job {job} fuehrt '{befehl}' nicht mehr als eigenen Schritt aus")
            # Ein npm-Skript hinter einem Pflichtbefehl braucht seine Festlegung
            # in NPM_SKRIPTE — in der package.json des Ordners, in dem der
            # Schritt laeuft.
            skript = _npm_skript(befehl)
            if skript:
                ordner = SCHRITT_FESTLEGUNG_CI.get((job, befehl), {}).get("working-directory", [JOB_ORDNER_CI.get(job, ".")])[0]
                paket = "package.json" if ordner == "." else f"{ordner}/package.json"
                if skript not in NPM_SKRIPTE.get(paket, {}):
                    m.append(
                        f"ci.yml: Job {job} ruft das npm-Skript '{skript}' aus {paket} auf — "
                        "was es tut, ist nicht festgelegt (NPM_SKRIPTE)"
                    )
        if re.search(r"""(?m)^\s+(?:- )?["']?continue-on-error["']?\s*:""", b):
            m.append(f"ci.yml: Job {job} traegt 'continue-on-error' — ein roter Schritt zaehlte als gruen")
        if re.search(r"""(?m)^\s+["']?permissions["']?\s*:""", b):
            m.append(f"ci.yml: Job {job} setzt eigene Rechte ('permissions')")

        # Ab hier werden die Schluessel des Jobs (vier Leerzeichen Einzug) und
        # die seiner Schritte gelesen. Was sich so nicht lesen laesst, ist ein
        # Mangel — sonst reichte eine andere Einrueckung, um eine Bedingung an
        # diesem Vertrag vorbeizufuehren.
        kopf = _ebene(b.split("\n")[1:], 4)
        schritte = _schrittbloecke(b)
        if "?" in kopf or schritte is None or any("?" in schritt for schritt in schritte):
            m.append(
                f"ci.yml: Job {job} steht nicht in der ueblichen Schreibweise — "
                "der Vertrag kann seine Schluessel nicht lesen"
            )
            continue
        # OPS-2026-10-04-27: Die ganze Schrittfolge des Jobs, Wort fuer Wort.
        ist_folge = [_schritt_wortlaut(schritt) for schritt in schritte]
        soll_folge = SCHRITTFOLGE_CI.get(job, [])
        if ist_folge != soll_folge:
            unbekannt = [w for w in ist_folge if w not in soll_folge]
            fehlend = [w for w in soll_folge if w not in ist_folge]
            for wortlaut in unbekannt:
                m.append(
                    f"ci.yml: Job {job} enthaelt einen Schritt, den der Vertrag nicht kennt: '{wortlaut}' — "
                    "er liefe im Pflicht-Job mit und koennte die Arbeitskopie umbauen, bevor geprueft wird "
                    "(SCHRITTFOLGE_CI)"
                )
            for wortlaut in fehlend:
                m.append(f"ci.yml: Job {job}: der Schritt '{wortlaut}' aus dem Vertrag steht so nicht mehr da (SCHRITTFOLGE_CI)")
            if not unbekannt and not fehlend:
                m.append(
                    f"ci.yml: Job {job}: die Schritte stehen in anderer Reihenfolge oder Anzahl als im Vertrag "
                    "(SCHRITTFOLGE_CI)"
                )
        bedingungen = kopf.get("if")
        erlaubt = [JOB_BEDINGUNG_CI[job]] if job in JOB_BEDINGUNG_CI else None
        if bedingungen is not None and bedingungen != erlaubt:
            m.append(f"ci.yml: Job {job} traegt die Bedingung {bedingungen!r} — er koennte still entfallen")
        ordner = JOB_ORDNER_CI.get(job)
        soll = ["run:", f"working-directory: {ordner}"] if ordner else None
        if kopf.get("defaults") != soll:
            m.append(
                f"ci.yml: Job {job} traegt 'defaults' {kopf.get('defaults')!r} statt {soll!r} — "
                "Arbeitsordner oder Shell seiner Schritte waeren andere"
            )
        if kopf.get("env") != JOB_UMGEBUNG_CI.get(job):
            m.append(
                f"ci.yml: Job {job} setzt die Umgebung {kopf.get('env')!r} statt {JOB_UMGEBUNG_CI.get(job)!r} — "
                "darueber liessen sich npm und die Shell umlenken"
            )
        for befehl in befehle:
            if befehl not in vorhanden:
                continue
            treffer = [schritt for schritt in schritte if _befehl(schritt) == befehl]
            if not treffer:
                # Der Wortlaut kommt im Job vor, aber kein Schritt fuehrt ihn
                # aus: etwa als Umgebungswert `run: npm test` unter `env:` oder
                # als Textzeile in einem mehrzeiligen Befehl.
                m.append(
                    f"ci.yml: Job {job}: '{befehl}' steht im Job, aber nicht als Befehl eines eigenen Schritts — "
                    "ausgefuehrt wird er so nicht"
                )
            festgelegt = SCHRITT_FESTLEGUNG_CI.get((job, befehl), {})
            for schritt in treffer:
                for schluessel in SCHRITT_SCHLUESSEL:
                    ist = schritt.get(schluessel)
                    if ist == festgelegt.get(schluessel):
                        continue
                    statt = f" statt {festgelegt[schluessel]!r}" if schluessel in festgelegt else ""
                    m.append(
                        f"ci.yml: Job {job}: der Schritt '{befehl}' traegt '{schluessel}' {ist!r}{statt} — "
                        + _SCHRITT_FOLGE[schluessel]
                    )
    return m


_SCHRITT_FOLGE = {
    "if": "er koennte still entfallen",
    "shell": "derselbe Wortlaut fuehrte etwas anderes aus",
    "working-directory": "derselbe Wortlaut liefe in einem anderen Ordner",
    "env": "darueber liessen sich npm und die Shell umlenken",
}


def vertrag_npm():
    """Was die npm-Skripte hinter den Pflicht-Schritten tun, und womit Jest
    eingestellt ist (NPM_SKRIPTE, JEST_EINSTELLUNG)."""
    m = []
    for pfad, soll in NPM_SKRIPTE.items():
        datei = WURZEL / pfad
        if not datei.is_file():
            m.append(f"{pfad} fehlt — dort stehen die npm-Skripte, die die Pflicht-Schritte aufrufen")
            continue
        try:
            daten = json.loads(datei.read_text(encoding="utf-8"))
        except ValueError:
            daten = None
        skripte = daten.get("scripts") if isinstance(daten, dict) else None
        if not isinstance(skripte, dict):
            m.append(f"{pfad} ist nicht lesbar oder nennt keine npm-Skripte")
            continue
        for name, befehl in soll.items():
            if skripte.get(name) != befehl:
                m.append(
                    f"{pfad}: npm-Skript '{name}' lautet {skripte.get(name)!r} statt {befehl!r} — "
                    "der Schritt, der es aufruft, pruefte etwas anderes"
                )
            for vorsilbe in ("pre", "post"):
                if vorsilbe + name in skripte:
                    m.append(
                        f"{pfad}: npm-Skript '{vorsilbe}{name}' — npm fuehrt es ungefragt mit '{name}' aus; "
                        "es koennte den Lauf veraendern, ohne dass sich dessen Wortlaut aendert"
                    )
        eigene = {**(daten.get("dependencies") or {}), **(daten.get("devDependencies") or {})}
        for paket, skript in SKRIPT_PAKETE.get(pfad, {}).items():
            if paket not in eigene:
                m.append(
                    f"{pfad}: '{paket}' steht nicht als eigene Abhaengigkeit da — {skript} laedt es; "
                    "als Mitbringsel eines anderen Pakets kann es jederzeit wegfallen"
                )
        if pfad == "functions/package.json" and daten.get("jest") != JEST_EINSTELLUNG:
            m.append(
                f"{pfad}: die Jest-Einstellung lautet {daten.get('jest')!r} statt {JEST_EINSTELLUNG!r} — "
                "sie bestimmt, welche Testdateien 'npm test' ausfuehrt"
            )
    return m


def _summe_roh(pfad):
    return hashlib.sha256((WURZEL / pfad).read_bytes()).hexdigest()[:16]


def vertrag_einstellungen():
    """Die Einstellungsdateien der Pruefwerkzeuge (EINSTELLUNG_SUMMEN) und die
    Dateien, die es daneben nicht geben darf (EINSTELLUNG_FREMD)."""
    m = []
    for pfad, soll in EINSTELLUNG_SUMMEN.items():
        if not (WURZEL / pfad).is_file():
            m.append(f"{pfad} fehlt — die Datei bestimmt, was ein Pflicht-Schritt prueft")
        elif _summe_roh(pfad) != soll:
            m.append(f"{pfad} weicht vom festgeschriebenen Stand ab (Pruefsumme der ganzen Datei)")
    for ordner, muster in EINSTELLUNG_FREMD.items():
        verzeichnis = WURZEL / ordner if ordner else WURZEL
        if not verzeichnis.is_dir():
            continue
        for eintrag in sorted(verzeichnis.iterdir()):
            pfad = f"{ordner}/{eintrag.name}" if ordner else eintrag.name
            if pfad not in EINSTELLUNG_SUMMEN and any(fnmatch.fnmatchcase(eintrag.name, mu) for mu in muster):
                m.append(
                    f"{pfad} ist nicht vorgesehen — die Datei stellt ein Pruefwerkzeug um, "
                    "ohne dass sich die festgeschriebene Einstellung aendert"
                )
    return m


def vertrag_gitignore():
    """Keine eingecheckte Datei ist zugleich von `.gitignore` erfasst. Prettier
    laesst aus, was `.gitignore` nennt: Ein Eintrag dort naehme die Dateien aus
    der Format-Pruefung, ohne dass sich an Skript oder Einstellung etwas
    aendert. Liefert (Maengel, gemessen) — ausserhalb eines git-Repositorys
    (entpackte Kopie) ist die Frage nicht messbar."""
    # Gefragt sind die `.gitignore`-Dateien DIESES Ordners, nicht die
    # persoenliche Ausschlussliste des Rechners — und das Repository, in dem
    # dieses Skript liegt, auch wenn ein git-Hook ein anderes vorgibt.
    umgebung = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")}
    try:
        lauf = subprocess.run(
            ["git", "-C", str(WURZEL), "ls-files", "-z", "--cached", "--ignored", "--exclude-per-directory=.gitignore"],
            capture_output=True,
            timeout=60,
            env=umgebung,
        )
    except (OSError, subprocess.SubprocessError):
        return [], False
    if lauf.returncode != 0:
        return [], False
    namen = [n for n in lauf.stdout.decode("utf-8", "replace").split("\0") if n]
    if not namen:
        return [], True
    return [
        f".gitignore erfasst {len(namen)} eingecheckte Datei(en), zuerst {namen[0]} — "
        "Prettier laesst solche Dateien stillschweigend aus"
    ], True


def vertrag_actions():
    """Jede fremde Action ist per Commit-Kennung (40 Zeichen) festgenagelt —
    in allen Workflows. Ein Etikett (`@v7`) oder ein Zweig (`@master`) kann
    morgen anderen Code bezeichnen; GitHub erzwingt das Festnageln nicht."""
    m = []
    for datei in sorted((WURZEL / ".github" / "workflows").glob("*.y*ml")):
        t = _ohne_kommentarzeilen(datei.read_text(encoding="utf-8"))
        for wert in re.findall(r"(?m)^\s+(?:- )?uses:\s*(\S+)", t):
            if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}", wert):
                m.append(f"{datei.name}: Action '{wert}' ist nicht per Commit-Kennung (40 Zeichen) festgenagelt")
    return m


def vertrag_summen_ausgeben():
    print("VERTRAG_SUMMEN = {")
    for name in VERTRAG_SUMMEN:
        text = _vertragsdatei(name).read_text(encoding="utf-8")
        print(f'    "{name}": "{_summe(text)}",')
    print("}")
    print("EINSTELLUNG_SUMMEN = {")
    for pfad in EINSTELLUNG_SUMMEN:
        print(f'    "{pfad}": "{_summe_roh(pfad)}",')
    print("}")

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
    # Ein Merker fuer alle Pruefungen an ci.yml in diesem und den folgenden
    # Abschnitten. Er steht VOR der ersten davon: Wird er weiter unten noch
    # einmal auf False gesetzt, geht ihr Befund verloren — die Zeile "FEHLT"
    # stuende dann da, der Rueckgabewert bliebe 0.
    ci_fehlt = False
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
    # 01.09.2026: Die Mutationsprobe laeuft VORERST NUR LOKAL. Sie hat in drei
    # Laeufen den Pflicht-Check rot gemacht, jedes Mal aus einem Grund der
    # Umgebung (fehlende Pakete, flacher Checkout, abweichendes jest-Verhalten)
    # — nie wegen eines echten Befundes. Ein neues Werkzeug darf die
    # Auslieferung nicht blockieren. Diese Ausnahme ist BEFRISTET: Sie faellt
    # weg, sobald der Lauf in der Pipeline einmal nachweislich durchlief.
    NUR_LOKAL = {
        # In der Pipeline waere sie sinnlos: Dort laeuft das Echte. Ihr Zweck
        # ist, VOR dem Push zu zeigen, was dort scheitern wuerde.
        "pruefe-pipeline-schritte.mjs": "prueft die Pipeline — laeuft deshalb "
        "nur lokal, aufgerufen aus vor-dem-push.sh bei geaenderter ci.yml",
        "pruefe-mutationen.mjs": "laeuft vorerst nur lokal — siehe ci.yml und "
        "docs/WAECHTER.md; kommt zurueck, wenn ein Pipeline-Lauf belegt ist",
    }
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
    # Waechter, die aeussere Quellen lesen (GitHub-API: Sicherheitsmeldungen der
    # Hersteller, Hinweise an den Laeufen auf main). Sie laufen NICHT vor dem
    # Push und NICHT im Pull Request: Eine neue fremde Meldung wuerde sonst
    # jeden unbeteiligten Pull Request blockieren — genau das ist am 2026-07-01
    # mit allen acht Dependabot-PRs passiert. Ihr Ort ist der naechtliche
    # Workflow sicherheit-nachts.yml; dort wird ihr Aufruf genauso verlangt
    # wie bei allen anderen in ci.yml (Befunde OSS-2026-09-30-01,
    # OPS-2026-09-30-03).
    NUR_NACHTS = {
        "pruefe-fremd-meldungen.mjs": "Sicherheitsmeldungen der Hersteller "
        "der mitgelieferten Bibliotheken, liest die GitHub-API",
        "pruefe-abkuendigungen.mjs": "Abkuendigungshinweise an den Laeufen "
        "auf main, liest die GitHub-API",
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
    nachts = WURZEL / ".github" / "workflows" / "sicherheit-nachts.yml"
    if not nachts.exists():
        print("  NICHT MESSBAR: .github/workflows/sicherheit-nachts.yml fehlt")
        return 2
    aus_ci = erreichbar_ab(ci)
    aus_vorab = erreichbar_ab(vorab.read_text(encoding="utf-8"))
    nachts_text = nachts.read_text(encoding="utf-8")
    aus_nachts = erreichbar_ab(nachts_text)
    # Befund G-10/H-01/H-02 (30.09.2026): Dass der Aufruf im Text steht,
    # beweist nicht, dass er etwas bewirkt. Eine Liste verbotener Muster ("kein
    # || true") liess in der Gegenpruefung 14 naheliegende Stilllegungen gruen
    # (|| exit 0, | tee, "- if: false", geloeschter Alarm-Job, priority 3, cron
    # am 31.2., ...). Deshalb ein POSITIVER Vertrag: Beschrieben ist, wie die
    # beiden Workflows aussehen MUESSEN; jede Abweichung ist ein Befund.
    # Frei bleiben nur die `uses:`-Zeilen, damit Dependabot die Actions anheben
    # kann. Der Alarm-Job und die Jobs des Nachbaus sind per Pruefsumme
    # festgeschrieben — eine bewusste Aenderung dort traegt man hier nach
    # (`python3 scripts/pruefe-deploy-riegel.py --vertrag-summen`).
    # OPS-2026-10-03-12: Derselbe Vertrag gilt fuer die uebrigen Pipeline-
    # Dateien; `ci.yml` hat dazu einen inhaltlichen Teil (Pflichtbefehle je
    # Pflicht-Job), und in keinem Workflow steht eine Action ohne Commit-Kennung.
    vertrags_maengel = (
        vertrag_nachts(nachts_text)
        + vertrag_libheif_bau()
        + vertrag_weitere_summen()
        + vertrag_ci(ci, text)
        + vertrag_actions()
        + vertrag_npm()
        + vertrag_einstellungen()
    )
    gitignore_maengel, gitignore_gemessen = vertrag_gitignore()
    vertrags_maengel += gitignore_maengel
    waechter_fehlt = []
    for datei in skripte:
        if datei.name in NUR_LOKAL:
            continue
        if datei.name in NUR_NACHTS:
            if datei.name not in aus_nachts:
                waechter_fehlt.append((datei.name, "sicherheit-nachts.yml"))
            continue
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
    print("── Entsprechen die Pipeline-Dateien ihrem Vertrag? ──")
    if vertrags_maengel:
        for mangel in vertrags_maengel:
            print(f"  FEHLT   Vertrag {mangel}")
        if any("weicht vom festgeschriebenen Stand ab" in mangel for mangel in vertrags_maengel):
            print("          War die Aenderung beabsichtigt? Dann die neue Pruefsumme in")
            print("          VERTRAG_SUMMEN oder EINSTELLUNG_SUMMEN nachtragen — sie steht in der")
            print("          Ausgabe von: python3 scripts/pruefe-deploy-riegel.py --vertrag-summen")
        if any("(SCHRITTFOLGE_CI)" in mangel for mangel in vertrags_maengel):
            print("          War ein neuer oder geaenderter Schritt beabsichtigt? Dann seinen Wortlaut in")
            print("          SCHRITTFOLGE_CI nachtragen — die heutige Folge steht in der Ausgabe von:")
            print("          python3 scripts/pruefe-deploy-riegel.py --vertrag-schritte")
    else:
        print(f"  ok      {len(VERTRAG_SUMMEN)} Dateien entsprechen dem festgeschriebenen Stand;")
        print(f"          jeder der {len(PFLICHTJOBS_CI)} Pflicht-Jobs fuehrt seine Pruefbefehle aus")
        print(f"          und besteht aus genau seinen {sum(len(f) for f in SCHRITTFOLGE_CI.values())} festgelegten Schritten")
        print(
            f"  ok      {sum(len(s) for s in NPM_SKRIPTE.values())} npm-Skripte hinter den Pflicht-Schritten, die Jest-Einstellung"
        )
        print(f"          und {len(EINSTELLUNG_SUMMEN)} Einstellungsdateien der Pruefwerkzeuge lauten wie festgelegt")
    if gitignore_gemessen and not gitignore_maengel:
        print("  ok      keine eingecheckte Datei ist von .gitignore erfasst")
    elif not gitignore_gemessen:
        print("  --      NICHT GEMESSEN: ob .gitignore eingecheckte Dateien erfasst (kein git-Repository)")
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

    anzahl = (
        len(fehlt)
        + len(falsch_platziert)
        + len(ohne_abbruch)
        + len(ohne_bilanz)
        + (1 if ci_fehlt else 0)
        + len(waechter_fehlt)
        + len(vertrags_maengel)
    )
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
    if "--vertrag-summen" in sys.argv:
        vertrag_summen_ausgeben()
        sys.exit(0)
    if "--vertrag-schritte" in sys.argv:
        vertrag_schritte_ausgeben()
        sys.exit(0)
    sys.exit(main())
