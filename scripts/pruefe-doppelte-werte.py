#!/usr/bin/env python3
"""
Waechter gegen doppelte Betriebswerte.

WARUM ES DIESEN WAECHTER GIBT (30.08.2026):
Beim Umbau auf den Firestore-Einstellungssatz wurde geprueft, ob die Werte im
Satz sauber sind — statt zu fragen, welche Zahlen der Code ueberhaupt enthaelt.
Das ist die falsche Richtung: Eine Pruefung gegen die eigene Liste kann nur
bestaetigen, was schon drin ist. Dreizehn Werte standen danach an ZWEI Orten,
und welcher galt, hing vom Aufrufweg ab.

Der Waechter dreht die Richtung um. Er geht vom CODE aus und verlangt fuer jede
Zahlenkonstante eine von zwei Antworten:

  1. Sie steht im Einstellungssatz  ->  dann darf sie hier nicht nochmal stehen
  2. Sie traegt eine Begruendung    ->  Kommentar "BLEIBT IM CODE — <Grund>"

Alles andere ist ein Fund. Kein Urteil daruber, ob die Zahl richtig ist —
nur die Frage, ob jemand bewusst entschieden hat, wo sie wohnt.
"""
import re, sys, pathlib

WURZEL = pathlib.Path(__file__).resolve().parent.parent
SRC = WURZEL / "functions" / "src"

# --- 1. Welche Felder traegt der Einstellungssatz? ---
# BEFUND 01.09.2026 (Runde 7, L-7): Fehlte betriebsprofil.js, endete dieser
# Waechter mit einem FileNotFoundError-Traceback und Rueckgabewert 1 — also
# derselben Antwort wie "ich habe Doppelungen gefunden". Die README sagt seit
# jeher, jeder Waechter melde "nicht messbar" statt eines Ergebnisses, wenn
# seine Grundlage fehlt; hier stimmte das nicht. Rueckgabewert 2 ist genau
# dieser dritte Zustand: nicht gruen, aber auch kein Fund. Die Pipeline bricht
# bei 2 unveraendert ab — es geht kein Schutz verloren, nur das Etikett stimmt.
try:
    profil = (SRC / "betriebsprofil.js").read_text()
except OSError as fehler:
    print(f"NICHT MESSBAR: {SRC / 'betriebsprofil.js'} nicht lesbar ({fehler.strerror}).")
    print("               Ohne die Feldliste des Einstellungssatzes gibt es")
    print("               nichts, wogegen die Werte im Code zu pruefen waeren.")
    sys.exit(2)
block = re.search(r"const FELDER = \{(.*?)\n\};", profil, re.S)
if not block:
    print("NICHT MESSBAR: Feldliste in betriebsprofil.js nicht gefunden.")
    print("               Der Waechter kann ohne sie nichts pruefen — das ist")
    print("               kein gruenes Ergebnis. (Wurde die Datei umgebaut?)")
    sys.exit(2)
satzfelder = set(re.findall(r"^\s+(\w+):", block.group(1), re.M))
if len(satzfelder) < 5:
    print(f"NICHT MESSBAR: nur {len(satzfelder)} Satzfelder erkannt — das Messmittel greift nicht.")
    sys.exit(2)

# --- 2. Namensbruecke: Konstante im Code  ->  Feld im Satz ---
#    Ein Wert kann anders heissen; diese Tabelle macht die Gleichheit sichtbar.
BRUECKE = {
    "RATE_LIMIT": "adressLimit", "RATE_WINDOW_MS": "adressfensterMs",
    "MISTRAL_DESCRIBE_MAX_TOKENS": "describeMaxTokens",
    "MISTRAL_PROFILE_MAX_TOKENS": "profileMaxTokens",
    "MISTRAL_TIMEOUT_MS": "mistralTimeoutMs",
    "MISTRAL_SINGLE_LARGE_TIMEOUT_MS": "singleLargeTimeoutMs",
    "MISTRAL_SINGLE_LARGE_MAX_TOKENS": "singleLargeMaxTokens",
    "HOURLY_LIMIT": "stundenlimit", "HOURLY_WINDOW_MINUTES": "stundenfensterMinuten",
    "REQUEST_BUDGET_MS": "requestBudgetMs", "LIVENESS_GRACE_MS": "livenessGnadenfristMs",
    "QUEUE_AVG_JOB_SECONDS": "durchschnittsdauerSekunden",
    "QUEUE_DISPATCH_CONCURRENCY": "parallelitaet", "MAX_QUEUE_DEPTH": "warteschlangeTiefe",
    "JOB_RETENTION_MS": "jobAufbewahrungMs", "ZUSTELLUNG_AUFBEWAHRUNG_MS": "zustellfensterMs",
    "PROCESSING_TIMEOUT_MS": "verarbeitungsZeitlimitMs",
    "MAX_QUEUED_AGE_MS": "wartendesHoechstalterMs", "REAP_BATCH_LIMIT": "aufraeumStapel",
    "DEFAULT_TTL_MS": "ticketGueltigkeitMs", "DEFAULT_MAX_CONCURRENT": "drosselMaxParallel",
    "DEFAULT_QUEUE_TIMEOUT_MS": "drosselWartelimitMs",
    "LARGE_TOKEN_INTERVAL_MS": "tokenAbstandGrossMs",
    "SMALL_TOKEN_INTERVAL_MS": "tokenAbstandKleinMs",
    "BOOST_FRIST_MS": "boostFristMs", "BOOST_OBERGRENZE": "boostFaktor",
}

# --- 3. Ausnahmen: Zahlen, die keine Betriebswerte sind ---
#    Bewusst KURZ gehalten. Jede Zeile ist eine Entscheidung, kein Freibrief.
AUSNAHMEN = {
    # Bootstrap: werden gebraucht, UM den Satz zu lesen
    "LESE_ZEITLIMIT_MS", "CACHE_MS", "CACHE_TTL_MS", "FUNCTION_LIMIT_MS",
    # Recht und Zusagen
    "VOLLJAEHRIG_AB", "MAX_UPLOAD_BYTES", "MISTRAL_SLOWEST_TOKENS_PER_SECOND",
    # Datenschutz: Feldlaengen der Fehlererfassung
    "RC_TICKET_MAX_LAENGE", "STRING_BOUND_CATEGORY", "STRING_BOUND_AD_TARGETING",
    "STRING_BOUND_MANIPULATION", "STRING_BOUND_PROFILE_TEXT",
    # Auswertungsregeln der Wachen — keine Stellschrauben des Betriebs
    "TAGE_HISTORIE", "WERTE_JE_TAG", "RING_GROESSE", "MIN_WERTE",
    "PLAUSIBEL_MIN_S", "PLAUSIBEL_MAX_S", "HOECHSTALTER_MS",
    "JUENGSTE_TAGE", "VERGLEICH_TAGE", "MIN_ANALYSEN", "FAKTOR_SCHWELLE",
    "NAH_AN_GRENZE_ANTEIL", "NAH_AN_GRENZE_FAKTOR", "ANHALTEND_TAGE",
    # BLIND_TAGE: wie ANHALTEND_TAGE, nur fuer die Kapazitaets-Wache — ab wie
    # vielen Tagen ohne Messung ihr Ausfall gemeldet wird (Runde 8, N-P3a).
    "BLIND_TAGE",
    "FRIST_TAGE", "VORWARNUNG_TAGE", "REALITAETS_CHECK_MINDEST_EINGABEN",
    # Implementierungsdetails ohne Betriebswirkung
    "CLEANUP_INTERVAL_MS", "MAX_RATE_ENTRIES", "INITIAL_JITTER_MAX_MS",
    "LOCAL_REDISPATCH_MS", "TOUCH_MINDESTABSTAND_MS", "NONCE_TTL_MS",
    "ABRUF_TIMEOUT_MS", "TTL_NETZ_MS", "MAINTENANCE_CACHE_TTL_MS",
    "LEBENSZEICHEN_MAX_ALTER_MS", "SCHUTZ_BIS", "ERINNERUNG_AUSGELIEFERT_MS",
}

funde = []
for datei in sorted(SRC.glob("*.js")):
    text = datei.read_text()
    zeilen = text.split("\n")
    for i, zeile in enumerate(zeilen):
        # Nur REINE Zahlenausdruecke: Ziffern, Rechenzeichen, Klammern.
        # Ohne diese Schaerfe traf das Muster auch "europe-west1", Regexe und
        # Arrays — und ein Waechter, der Fehlalarme streut, wird ignoriert.
        m = re.match(r"^const ([A-Z][A-Z0-9_]+) = ([0-9][0-9_.eE +*/()-]*);", zeile)
        if not m:
            continue
        name = m.group(1)
        if name in AUSNAHMEN:
            continue
        # Traegt sie eine Begruendung in den drei Zeilen darueber?
        davor = "\n".join(zeilen[max(0, i - 12):i])
        if "BLEIBT IM CODE" in davor:
            continue
        feld = BRUECKE.get(name)
        if feld and feld in satzfelder:
            funde.append((datei.name, i + 1, name,
                          f"steht als '{feld}' im Einstellungssatz — zweite Definition"))
        else:
            funde.append((datei.name, i + 1, name,
                          "weder im Einstellungssatz noch als 'BLEIBT IM CODE' begruendet"))

print(f"Einstellungssatz: {len(satzfelder)} Felder · geprueft: {len(list(SRC.glob('*.js')))} Dateien")
if funde:
    print(f"\n{len(funde)} Fund(e):\n")
    for d, z, n, grund in funde:
        print(f"  functions/src/{d}:{z}")
        print(f"    {n} — {grund}\n")
    print("Abhilfe: entweder den Wert in den Einstellungssatz holen, oder ihn mit")
    print("einem Kommentar 'BLEIBT IM CODE — <Grund>' als bewusste Entscheidung")
    print("kennzeichnen. Eine Zahl ohne eine der beiden Antworten ist ein Fund.")
    sys.exit(1)
print("Keine doppelten Betriebswerte.")
