# Sicherheitsmodell — malziME

Dieses Dokument beschreibt, **was** malziME schützt, **wovor**, **wodurch** —
und welche Restrisiken das Projekt **bewusst und begründet** trägt. Es ist die
Referenz für Audits und externe Reviews: Wer eine der Abwägungen unten als
„Schwäche" meldet, findet hier die Begründung, gegen die er argumentieren muss.

Rollen der Nachbar-Dokumente: [ARCHITECTURE.md](ARCHITECTURE.md) beschreibt den
Datenfluss, [RUNBOOK.md](RUNBOOK.md) den Betrieb, [VERIFICATION.md](VERIFICATION.md)
die Nachweise. Meldewege für Sicherheitslücken: [../SECURITY.md](../SECURITY.md).

## Schutzgüter (nach Priorität)

1. **Privatsphäre der Teilnehmenden.** Fotos und alles, was sich daraus ableiten
   lässt — das Projekt existiert, um vor genau dieser Ableitung zu warnen, und
   darf sie deshalb selbst nie begehen. Höchste Priorität, auch vor Verfügbarkeit.
2. **Das Kostenbudget.** Eigenfinanziertes Projekt; unkontrollierte KI-Kosten
   wären existenzbedrohend für den Betrieb.
3. **Verfügbarkeit im Workshop.** Stoßlast Mo–Fr vormittags; eine Schulklasse,
   die vor leerem Bildschirm sitzt, ist der teuerste Ausfall.
4. **Glaubwürdigkeit der Aussagen.** Jede öffentliche Zusage (Datenschutzerklärung,
   README) muss der Realität standhalten — ein widerlegtes Versprechen wäre für
   ein Medienkompetenz-Projekt schlimmer als ein technischer Fehler.

## Bedrohungsbild

| Bedrohung | Realistisch? | Hauptgegenmittel |
|---|---|---|
| Neugierige Dritte / Datenabfluss | Kernrisiko | Löschketten, EU-Only, ZDR, keine PII in Logs |
| Kostenangriff (massenhafte Analysen) | möglich | Stundenlimit (global, Firestore), Queue-Tiefen-Bremse, Job-Höchstalter — alle drei im Einstellungssatz, siehe [BETRIEBSPROFILE.md](BETRIEBSPROFILE.md) |
| Störangriff auf einen Workshop | möglich, bisher nie beobachtet | dieselben Limits + Boost/Reset-Hebel; Restrisiko akzeptiert (s. u.) |
| Bots / Scanner-Rauschen | täglich | Honeypot, Timing-Check, IP-Rate-Limit, Magic-Byte-Validierung |
| Prompt Injection über Bildinhalte | strukturell | XML-Isolation, escapeXml, Output-Clamps; LLM-Ausgaben steuern keine Tools |
| Admin-Missbrauch / Replay | gering | HMAC-Token (30 min) + Einmal-Nonce (5 min, fail-closed seit v3.0.4), Bearer-Secret |
| Fehlkonfiguration der Cloud | schleichend | `scripts/verify-infrastructure.sh` vor jedem Deploy (nur lesend, CI-erzwungen) |

## Schutzschichten (Kurzreferenz)

- **Client:** EXIF/GPS bleiben im Browser (Canvas-Recompress entfernt Metadaten);
  Nominatim/OSM ruft der Browser direkt — der Server sieht nie GPS. Foto und
  Analysedaten gehen direkt an die Cloud-Run-Adressen in `europe-west1`, nicht
  über das Auslieferungsnetz von Firebase Hosting (seit 09.09.2026, s. u.).
- **Einlass:** Maintenance-Check → IP-Rate-Limit → Honeypot/Timing → MIME +
  Magic-Bytes → globales Stundenlimit → Queue-Tiefen-Bremse.
- **Verarbeitung:** Worker `processJob` nur per OIDC (nicht öffentlich, per
  Infra-Skript geprüft); Mistral ausschließlich über `api.eu.mistral.ai`
  (per Unit-Test festgenagelt) mit org-weitem Zero Data Retention.
- **Löschketten:** Bild aktiv nach Verarbeitung gelöscht (Lifecycle 1 Tag +
  Soft-Delete 0 als Netz); zugestellte Ergebnisse nach 15 min, Job-Dokumente
  spätestens nach 2 h; Reaper räumt verlassene/hängende/überfällige Jobs.
- **Betrieb:** Test- und Infra-Riegel vor jedem Deploy, Live-Smoke danach,
  Log-Alarm mit zugestelltem E-Mail-Kanal, GCP-Budget-Alarm, 2-min-Rollback.

## Bewusste Restrisiken — mit Begründung

Diese Punkte sind **Entscheidungen, keine Versäumnisse**. Wer sie ändern will,
muss die Begründung entkräften, nicht nur das Risiko benennen.

1. **Stundenzähler ist fail-open.** Schlägt die Firestore-Abfrage des
   Stundenlimits fehl, wird die Analyse erlaubt und parallel ein ERROR-Alarm
   (`counter-fail-open`) ausgelöst, der per E-Mail zugestellt wird.
   *Warum:* Der häufigste Fehlerfall ist Transaktions-Gedränge im
   Workshop-Burst — genau dann würde fail-closed echte Schulklassen aussperren,
   um ein Kostenrisiko abzuwehren, das der Alarm ohnehin überwacht. Geprüft und
   bestätigt in der externen Review 2026-08-12 (der Reviewer zog seine
   fail-closed-Empfehlung nach Gegenrede zurück).
2. **IP-Rate-Limit ist instanzlokal.** Das 500/10-min-Limit lebt im
   Arbeitsspeicher jeder Function-Instanz — bei `enqueue`/`jobstatus` bis zu 10
   Instanzen (gemessen `maxScale`, 2026-08-13), effektiv also ein Mehrfaches der
   genannten Zahl. Ein verteilter Angreifer kann es umgehen. *Warum:* Es ist der Lärmfilter, nicht die Kostenbremse;
   die echten Bremsen (Stundenlimit, Queue-Tiefe) sind global. Die Alternative —
   IP-Ableitungen in Firestore speichern — würde die Kern-Zusage „keine
   persistente IP" schwächen und träfe im Schul-WLAN ganze Klassen hinter einer
   IP. Der mögliche Schaden ist Verfügbarkeit (begrenzt durch 500/h), nie Geld.
3. **Kein Staging-System.** Deploys gehen direkt in die Produktion.
   *Warum:* Ein zweites Firebase-Projekt verdoppelt Pflege, Secrets und
   Fehlerquellen — beim Ein-Personen-Projekt kostet das mehr Sicherheit, als es
   bringt. Ersatz: Test-Riegel (drei Suiten), Infra-Riegel, Emulator-Lasttests,
   automatischer Live-Smoke nach jedem Deploy, Feature-Flags ohne Deploy,
   2-Minuten-Rollback.
4. **Bus-Faktor 1.** Betrieb und Wissen hängen an einer Person.
   *Warum akzeptiert:* strukturell nicht lösbar ohne Team. Abgefedert durch:
   öffentliches Repo mit vollständigem RUNBOOK, Selbstbegrenzung des Systems
   (Limits, Budgets, Alarme) und einen privaten Notfall-Umschlag, mit dem eine
   Vertrauensperson das System geordnet stoppen kann.
5. **Öffentliche `/api/*`-Functions.** enqueue, jobStatus, stats, errors,
   telemetry, admin sind öffentlich aufrufbar (allUsers). *Warum:* Firebase
   Hosting reicht `/api/*` an sie durch; die Absicherung liegt in den Handlern
   (Limits, Validierung, HMAC beim Admin). Das Infra-Skript prüft im Gegenzug,
   dass die Nicht-öffentlichen (`processjob`, `reapjobs`) es auch bleiben.
6. **Durchsatz-Deckel liegt extern.** Mistral-Tier T1 = 0,25 req/s ≈ 7,5
   Analysen/min — die reale Bremse bei Stoßlast. *Status:* bekannt, mit
   Warteschlangen-Ehrlichkeit (Position + ETA) abgefedert; Tier-Hebung ist eine
   bewusste Kostenentscheidung, kein technisches Versäumnis.

7. **Der E2E-Container hängt an einem beweglichen Etikett.**
   (`OSS-2026-08-12-24`) Die Tests laufen im offiziellen Playwright-Image
   `mcr.microsoft.com/playwright:v<Version>-jammy`. Die Version kommt aus dem
   Lockfile, das Etikett selbst wird von Microsoft neu bebildert — derselbe Name
   kann morgen einen anderen Inhalt haben. *Warum kein Digest-Pin:* Das Etikett
   wird aus dem Lockfile **abgeleitet**; ein fest verdrahteter Digest würde bei
   jedem Playwright-Update einen Pflicht-Check brechen, bis jemand von Hand
   nachzieht — ein Riegel, der regelmäßig aus dem falschen Grund rot ist, wird
   ignoriert. *Warum vertretbar:* Der Job hat **kein Geheimnis, kein Token und
   keine Schreibrechte** (`permissions: contents: read`, gemessen 2026-08-13) und
   liefert nichts aus. Das schlimmste Ergebnis eines untergeschobenen Images ist
   ein falsches Testergebnis — kein Zugriff auf Produktion, Daten oder Konten.
   *Neu bewerten,* sobald der E2E-Job ein Geheimnis braucht oder etwas
   veröffentlicht.
8. **Betriebs-Logs liegen seit 09.09.2026 in `europe-west1`** (Rest von
   `PRIV-2026-08-12-12`, erledigt). Googles Standard-Ablage `_Default` ist fest
   auf `global`. Am 12.08. wurde der personenbezogene Teil entfernt
   (Cloud-Run-Request-Logs, einziger IP-Träger, Ausschluss
   `exclude_run_requests_ip`, vom Deploy-Riegel bewacht); der Rest blieb als
   Restrisiko stehen, mit der Begründung, dass `gcloud logging read` nach einem
   Umhängen der Weiche ohne Zusatzangaben nichts mehr fände. Diese Abwägung
   wurde am 09.09.2026 verworfen: Die Zusage „alles auf EU-Servern" gilt ohne
   Ausnahme für alles, was wir steuern können. Seither zeigt die Weiche
   `_Default` auf den eigenen Speicher `betrieb-eu` (europe-west1, 1 Tag); alle
   Rezepte im RUNBOOK nennen den Speicher ausdrücklich, und der Deploy-Riegel
   prüft Ziel, Aufbewahrung und Ausschluss. *Was bleibt und nicht änderbar
   ist:* Googles Pflichtprotokoll `_Required` (global, 400 Tage) mit unseren
   eigenen Verwaltungszugriffen, und die Alarm-Kanäle mit unserer Adresse.
   Keine Nutzerdaten. *Regel daraus:* Jede Abwägung, die eine Zusage nach
   außen berührt, wird als Entscheidung vorgelegt und dort getroffen, nie nur
   hier notiert.
9. **Der Upload-Rumpf landet vor jeder App-Prüfung im Speicher.**
   (`SEC-2026-08-13-B`) Die Cloud-Functions-Laufzeit liest den Request-Body
   vollständig als `req.rawBody` ein, bevor `handle-enqueue.js` läuft — eine
   Kopfzeilen-Größenprüfung im Handler kann diese erste Allokation nicht
   verhindern (der frühere Kommentar behauptete das fälschlich, jetzt richtig
   gestellt). *Was schützt:* (1) Cloud Run deckelt den Request-Body bei ~32 MiB,
   ein größerer erreicht die Function gar nicht; (2) die Base64-Längenprüfung vor
   `Buffer.from` verhindert die zweite, dekodierte Allokation. *Verworfene
   Maßnahme:* `MAX_UPLOAD_BYTES` senken — bricht die öffentliche Zusage „max
   25 MB". *Verworfen:* `enqueue`-Concurrency auf einstellig drosseln — würde die
   Workshop-Stoßlast (1000–2000 Analysen/Vormittag) am Einlass ausbremsen, für
   die der Endpunkt bewusst dünn und schnell ist. *Neu bewerten,* falls je ein
   realer Speicher-Erschöpfungs-Vorfall auftritt (bisher keiner beobachtet).

10. **Neun Bau-Protokolle liegen in einem Google-eigenen Speicher ohne
    Regionswahl.** Cloud Build legt Bau-Protokolle standardmäßig in einem
    Google-eigenen Speicher ohne Regionswahl ab. Das betraf bis 09.09.2026 neun
    Protokolle des Push-Servers, ohne Nutzerdaten und ohne Geheimnisse. Seit
    09.09.2026 nutzen alle Bauaufträge unseren Speicher in europe-west1.
    *Beleg:* Löschversuch am 09.09.2026 wurde mit „keine Berechtigung
    storage.objects.delete" abgewiesen; Google beschreibt den Speicher in der
    Cloud-Build-Dokumentation als „Google Cloud-owned bucket", eine
    Löschanleitung gibt es nur für eigene Speicher. Inhalt geprüft: 387 Zeilen
    Bau-Schritte und Versionsnummern, keine Adresse, kein Schlüssel.
    *Betrachtete Alternative:* Löschanfrage an Google. Nicht gestellt, weil
    keine Nutzerdaten betroffen sind und der Aufwand in keinem Verhältnis zum
    Inhalt steht. *Neu bewerten,* sobald Google eine Löschung in Google-eigenen
    Speichern anbietet oder ein Bauauftrag ohne EU-Speicherangabe abgesetzt wird
    (der Infrastruktur-Wächter prüft das nicht; das Skript im malzime-Repo setzt
    die Angabe, das ntfy-Repo braucht sie von Hand).

## Verworfene Maßnahmen

| Maßnahme | Warum verworfen |
|---|---|
| IP-Speicherung (auch gehasht/HMAC) | schwächt die Kern-Zusage „keine persistente IP"; trifft Schul-NAT-Klassen; DSGVO-Pflichten ohne echten Gewinn (Kosten sind global gedeckelt) |
| WAF / Cloud Armor | kein beobachteter Missbrauch; zusätzliche Komplexität und Kosten; erst bei realem Druck neu bewerten |
| Fail-closed am Stundenzähler (pauschal) | würde im häufigsten Fehlerfall (Kontention im Workshop-Burst) echte Nutzer aussperren; differenzierte Betrachtung siehe Restrisiko 1 |

## Pflege

Dieses Dokument wird bei jedem LANGAUDIT und vor jeder Presse-Welle
gegengelesen. Neue bewusste Abwägungen gehören **hier** hinein — im selben
Commit wie die Entscheidung.

## Restrisiko: Der Alarmweg kann sich nicht selbst überwachen (seit 2026-08-12)

**Entscheidung.** Der Fehler-Alarm (Log-Richtlinie → E-Mail + ntfy-Push) wird beim Deploy
auf Existenz, Schärfe und zustellfähige Kanäle geprüft (`verify-infrastructure.sh`), aber
nicht laufend.

**Begründung.** Die Richtlinie ist eine Anwesenheits-Bedingung auf `severity>=ERROR`: Ihr
eigener Ausfall erzeugt keine Logzeile, auf die sie feuern könnte. Ein laufender Wächter
müsste außerhalb des Projekts sitzen und wäre selbst wieder unbewacht — die Kette hat kein
Ende, nur einen Punkt, an dem man sie abschneidet.

**Betrachtete Alternative.** Den ntfy-Dienst in den Alarmfilter aufnehmen. Verworfen: Der
Alarm alarmierte dann über sich selbst, und die Störung vom 2026-08-10 (CPU-Drosselung)
wurde von ntfy mit `severity DEFAULT` geschrieben — sie wäre selbst im Filter nie über die
Schwelle gekommen.

**Bedingung für Neubewertung.** Sobald das Projekt einen zweiten Betreuer hat (Bus-Faktor
> 1) oder ein externer Verfügbarkeitsdienst ohnehin läuft, gehört der Alarmweg dorthin.

## Restrisiko: Kein Eintrag in der HSTS-Preload-Liste (seit 2026-08-21)

**Entscheidung.** Die Seite sendet den HSTS-Kopf inklusive `preload`-Angabe, ist aber
bewusst **nicht** in die fest in Browser eingebaute Preload-Liste eingetragen
(`OPS-2026-08-20-36`; README und SECURITY.md behaupteten das zuvor).

**Begründung.** Der Gewinn ist der allererste Aufruf einer von Hand getippten Adresse ohne
`https://` in einem Browser, der die Domain noch nie gesehen hat — danach greift der
gesendete Kopf ohnehin. Der Preis ist eine praktisch unumkehrbare Bindung: Ein Eintrag wird
mit der Browser-Software ausgeliefert und wirkt über alte Versionen jahrelang nach, für die
gesamte Domain samt aller künftigen Unterdomains. An `malzi.me` hängt auch die E-Mail des
Betriebs; eine Unterdomain, deren Zertifikat einmal klemmt, wäre ohne Ausweg blockiert
(keine Warnseite zum Durchklicken, sondern harte Verweigerung).

**Betrachtete Alternative.** Eintragen. Verworfen für ein Ein-Personen-Projekt mit einer
Domain: dauerhafte Bindung gegen einen Gewinn, den das Publikum dieses Werkzeugs
(Workshop-Teilnehmende mit geteiltem Link, QR-Code oder Lesezeichen) praktisch nie erlebt.

**Marktvergleich, gemessen 2026-08-21** über `hstspreload.org/api/v2/status`:
`github.com` = preloaded; `orf.at`, `saferinternet.at`, `bmbwf.gv.at`, `wien.gv.at` = nicht
gelistet. Bei großen Plattformen üblich, bei österreichischen Medien-, Bildungs- und
Verwaltungsseiten die Ausnahme.

**Bedingung für Neubewertung.** Sobald feststeht, dass keine Unterdomain ohne sichere
Verbindung mehr geplant ist — etwa nach dem Presse-Zug und der 4.0-Auslieferung. Der
Eintrag bleibt jederzeit möglich; der Kopf ist bereits preload-fähig.


## Die Kostenbremse und ihr Netz (30.08.2026)

Das Stundenlimit ist die einzige globale Bremse gegen unerwartete Kosten. Es
war bis zum 30.08.2026 so gebaut, dass es im Zweifel **durchließ**: Wenn die
Datenbank nicht antwortete, wurde eingelassen statt abgewiesen — damit ein
einzelner Datenbankfehler nicht alle Teilnehmer aussperrt.

**Diese Abwägung war falsch, und eine Messung hat es gezeigt.** Sie stimmt für
einen einzelnen Fehler. Sie stimmt nicht für den Fall, der im Lasttest auftrat:

```
170 gleichzeitige Anfragen  ->  225 Sperr-Konflikte
                            ->  206 Ausfälle der Bremse
```

Der Zähler trägt alle Zeitstempel in *ein* Firestore-Dokument ein, und ein
einzelnes Dokument verträgt etwa einen Schreibvorgang pro Sekunde. Die Bremse
fiel damit **systematisch bei Andrang** aus — also genau dann, wenn viele
Analysen laufen und Kosten entstehen. Eine Bremse, die im Stillstand hält und
bei Tempo versagt, ist keine.

### Was daraus wurde

**Ein Netz, das nicht ausfallen kann** (`netzUeberZeitstempel` in `counter.js`):
eine zweite Prüfung, die nichts schreibt und deshalb nicht an derselben
Ursache scheitern kann. Sie liest dasselbe Zähler-Dokument mit einem einfachen
Lesezugriff außerhalb der Transaktion — eine Schreibsperre hält Leser nicht
auf — und wendet dieselben Regeln an wie der Zähler: dasselbe Fenster,
dasselbe wirksame Limit einschließlich eines laufenden Boosts.

*Korrigiert am 01.09.2026 (BIZ-2026-09-01-01):* Die erste Fassung des Netzes
zählte die Auftrags-Dokumente der letzten Stunde. Sie übersah, dass der
Aufräumer zugestellte Aufträge 15 Minuten nach der Zustellung löscht — unter
Andrang sah das Netz nur rund ein Viertel der Stunde und erreichte das Limit
nie; außerdem rechnete es mit dem Grundlimit statt mit dem Boost. Ein
Ersatzweg, der eine andere Menge und eine andere Grenze misst als der
Hauptweg, ist keiner. Der Kostendeckel war in dieser Zeit die
Warteschlangen-Rate (`queueRatePerSekunde`), nicht das Stundenlimit.

**Ein Zeitlimit von zwei Sekunden** um die Transaktion. Ohne das hingen 75 %
der Anfragen 54 Sekunden, weil Firestore selbst sehr lange auf die
Dokumentsperre wartet, bevor es aufgibt.

**Drei getrennte Meldungen**, damit die Alarmierung aussagekräftig bleibt:

| Lage | Protokoll | Alarm |
|---|---|---|
| Zähler läuft | nichts | nein |
| Netz übernimmt, lässt ein | Hinweis | nein |
| Netz übernimmt, blockiert | ERROR | ja |
| Zähler **und** Netz gescheitert | ERROR | ja |
| Nachtrag des Workers gescheitert (seit 11.09.2026, unten) | Hinweis | nein |

Die dritte Zeile ist die Lehre aus einem eigenen Fehler: Nach dem Einbau des
Netzes meldete der Code weiterhin 169 Mal „Kostenbremse inaktiv", obwohl das
Netz jedes Mal korrekt entschieden hatte. Ein Alarm, der im Normalbetrieb
feuert, macht den Ernstfall unauffindbar.

### Was das im Betrieb bedeutet

Die Kostenbremse hält auch unter Last, weil Zähler und Netz denselben Stand
lesen. Was jeder Betreiber trotzdem wissen muss: Die **erste** Grenze gegen
Kosten ist die Warteschlangen-Rate (`queueRatePerSekunde`; Wert und Rechnung
in `functions/src/produktiv-satz.js`) — sie liegt unter dem Stundenlimit. Wer die Rate anhebt, hebt diesen Deckel mit an und macht das
Stundenlimit zur einzigen Bremse. Fällt die Bremse *doch* einmal komplett
aus — Zähler und Netz zugleich —, kommt eine Meldung auf beiden Kanälen
(`alert: notbremse-fehlgeschlagen`, Text „Weder Zaehler noch Notbremse
verfuegbar — KEINE Kostenbremse aktiv"). Im Netz-Fall geht die
Push-Nachricht mit dem Boost-Knopf je Instanz höchstens einmal je fünf
Minuten hinaus; bei bis zu zehn Einlass-Instanzen sind das bis zu zehn
Nachrichten je fünf Minuten.

Messwerte nach der Reparatur vom 30.08.2026 (Emulator, 170 gleichzeitige
Anfragen, Stand vor dem Netz-Umbau vom 01.09.; mit dem neuen Netz nicht
nachgemessen):

```
Ausfälle der Bremse      206  ->  0
Sperr-Konflikte          225  ->  0
Antwortdauer (75 %)   54.000 ms -> 6.800 ms
abgerissene Verbindungen  94  ->  0
```

### Jeder eingelassene Auftrag zählt genau einmal (seit 11.09.2026)

**Der Befund.** Im Netz-Fall schrieb niemand den Eintrag des eingelassenen
Auftrags. Er stand nur dann im Fenster, wenn die hängende Transaktion nach dem
Zeitlimit doch noch durchkam. Gemessen im echten Betrieb (11.09.2026, Lasttest mit
30 gleichzeitigen Analysen gegen malzi.me): 9 Netz-Fälle in derselben Sekunde
(`netz-hat-uebernommen`, Grund `zeitlimit-kein-retry`). 8 der 9 Transaktionen
schrieben später noch, eine nie. Die Statusseite zeigte 35 Analysen in der letzten
Stunde bei 36 fertigen.

**Die Abhilfe** (`counter.js`, Abschnitt „GENAU EINMAL IM FENSTER“). Jeder Einlass
hat eine eigene Marke (`zaehlerStempel` im Auftrag), und sein Eintrag im Fenster
ist diese Marke. Lässt das Netz ein, trägt der Worker die Marke zu Beginn der
Analyse per `arrayUnion` nach (`zaehlerNachtragen`). Das geschieht ohne
Transaktion, also ohne Lesesperre, und ohne Doppelung, denn `arrayUnion` trägt
einen vorhandenen Wert nicht ein zweites Mal ein. Die nachlaufende Transaktion
prüft ihrerseits, ob die Marke schon drinsteht. Nach einer Abweisung, nach einer
Freigabe und später als 60 Sekunden nach dem Start trägt sie gar nichts mehr ein.
Eine Freigabe (abgebrochener Auftrag) nimmt genau den eigenen Eintrag heraus, nicht
mehr den jüngsten.

Warum der Worker den Nachtrag schreibt und nicht der Einlass: Der Einlass antwortet
nach Sekunden, danach drosselt die Plattform die Instanz, und was dann noch läuft,
kommt vielleicht nie an. Der Worker läuft ohnehin rund 40 Sekunden; der Nachtrag
läuft neben der Analyse her und wird vor der Antwort abgewartet. Die frühere Sorge,
ein Schreiben ohne Transaktion erhöhe die Kontention, trifft den Einlass nicht:
Der Nachtrag kommt nur im Netz-Fall, einmal je Auftrag, und erst beim Start der
Analyse.

**Gemessen im Simulator** (11.09.2026, 30 gleichzeitige Aufträge,
`functions/scripts/stundenzaehler-emulator-messung.js`): 29 der 30 Einlässe liefen
über das Netz; direkt nach dem Einlass stand ein einziger Eintrag im Fenster. Als
alle 30 Analysen fertig waren, standen genau 30 Einträge im Fenster, alle
verschieden, jeder Auftrag mit seiner eigenen Marke; 29 Nachträge, keiner
gescheitert. Der Simulator drosselt seine Instanzen nach der Antwort nicht. Den
einen Eintrag, der im echten Betrieb nie ankam, stellt deshalb der Test
`zaehler-genau-einmal.test.js` nach (Transaktion schreibt nie, schreibt spät, schreibt
im Augenblick des Zeitlimits).

**Was bleibt:**

- Während einer Andrangswelle sieht das Netz zu wenig. Es fehlen die Aufträge,
  deren Analyse noch nicht begonnen hat und deren Transaktion noch nicht schrieb,
  also höchstens so viele, wie gerade warten. Das Netz blockiert dann entsprechend
  später. Die erste Grenze gegen Kosten bleibt die Warteschlangen-Rate (oben).
- Scheitert der Nachtrag in beiden Versuchen, fehlt der eine Auftrag weiter. Das
  steht im Protokoll (`zaehler-nachtrag`, `warning: fehlgeschlagen`).
- Eine Marke ist die Millisekunde plus ein Zufallsbruchteil, rund 4000 Werte je
  Millisekunde. Treffen zwei Netz-Fälle auf denselben Wert, zählt einer nicht.
- Kommt der Schreibvorgang einer Transaktion genau in dem Augenblick an, in dem das
  Zeitlimit abläuft, und wird der Auftrag danach abgewiesen oder freigegeben,
  bleibt sein Eintrag stehen: ein Strich zu viel.

## Ein Ausrutscher der Datenbank ist kein Alarm (07.09.2026)

**Entscheidung.** Kann eine Function den Einstellungssatz (`config/betriebsprofil`)
gerade nicht lesen — Zeitlimit, Verbindung, kurze Störung —, protokolliert
`betriebsprofil.js` das als WARNING, nicht als ERROR. Der Aufräumer, der jede
Minute liest, alarmiert erst, wenn fünf Läufe hintereinander ohne Betriebswerte
bleiben (07.–10.09.2026: zwei). Ein fehlendes, unbenanntes oder abgelehntes
Dokument bleibt sofort ERROR.

**Begründung.** Am 07.09.2026 um 17:37 löste ein einzelner träger Zugriff zwei
Alarme aus (E-Mail und Push), obwohl der Lauf eine Minute später gesund war und
kein Mensch betroffen. Ein Alarm, der nichts bedeutet, kostet das Vertrauen in die
Alarme, die etwas bedeuten — und in einem Workshop entscheidet dieses Vertrauen,
ob jemand hinschaut. Ein Lesefehler heilt sich beim nächsten Aufruf von selbst
(der Cache hält Fehlschläge nicht fest); ein kaputtes Dokument nicht — deshalb
die Trennung nach Grund, nicht nach Ort.

**Nachschärfung 10.09.2026: fünf statt zwei Läufe.** Um 11:18 und 11:19 Wien
blieben zwei Läufe direkt hintereinander ohne Betriebswerte, der dritte war
gesund, niemand betroffen — wieder Alarm. Firestore beantwortete in diesen
Minuten laut Googles Messwerten jede Anfrage in höchstens 0,15 s; die zwei
Sekunden gingen zwischen Function und Datenbank verloren. Fünf Minuten
Verzögerung sind für diesen Alarm unschädlich, weil er nur die Reserve ist:
Jede Analyse ohne Betriebswerte meldet sich sofort selbst.

**Betrachtete Alternative.** Das Zeitlimit von zwei Sekunden anheben. Verworfen:
Das Limit sitzt im Analysepfad, und jede Sekunde mehr wäre eine Sekunde, die
JEDE Analyse im Störungsfall länger hängt. Ein eigener zweiter Leseversuch je
Abfrage: verworfen — jede der fünf Abfragen eines Aufräumer-Laufs liest ohnehin
neu (der Cache hält Fehlschläge nicht fest), ein träger Lauf kostet also schon
bis zu fünfmal zwei Sekunden; ein weiterer Versuch verlängerte nur das, und der
nächste Lauf kommt ohnehin 60 Sekunden später.

**Was weiterhin alarmiert.** Jede Analyse, die ohne Betriebswerte abbricht
(`kein-einstellungssatz` in `handle-process-job.js`) — sofort; fünf
Aufräumer-Läufe in Folge (`betriebswerte-wiederholt-nicht-lesbar`); jedes
kaputte Dokument. Ein Dauerausfall von Firestore fällt damit sofort auf, wenn
jemand analysiert, und sonst spätestens nach fünf Minuten.

**Bedingung für Neubewertung.** Warnungen `reap-query-ohne-betriebswerte` in
mehr als drei verschiedenen Minuten eines Tages, also in mehr als drei Läufen
(Abfrage im RUNBOOK; ein einzelner träger Lauf erzeugt bis zu fünf Warnungen
in derselben Minute und zählt einmal) — dann ist es kein Ausrutscher mehr,
sondern ein Muster, und die Ursache gehört gesucht, nicht die Schwelle
verschoben. Stand 01.10.2026, 13:00 Wien: drei Minuten an diesem Tag (10:52,
11:30, 12:57) — an der Grenze, nicht darüber, wie am 10.09.2026. Seit 01.10.2026 protokolliert
`betriebsprofil.js` zusätzlich, wie lange ein zu später Zugriff tatsächlich
brauchte, sobald die Antwort doch noch kommt (`status: "spaete-antwort"`, nur
`dauerMs`) — bisher stand dort nur „länger als 2000 ms“.

## Verbindungsabriss zu Mistral: einmal neu fragen (01.10.2026)

**Entscheidung.** Reißt die Verbindung zu Mistral während einer Analyse ab
(Node.js meldet „terminated“ oder „fetch failed“, Grund in `err.cause`), wird
zuerst ein schon im Strom angekommener Text gerettet wie beim Zeitlimit; reicht
er nicht, fragt `mistral.js` EINMAL neu, ohne Live-Text, mit dem Restbudget. Der
erste Abriss ist eine Warnung (`abbruch-neuversuch`), erst ein gescheiterter
Neuversuch schreibt die Fehlerzeile mit Alarm. Antworten von Mistral
(HTTP-Fehler) und unser eigenes Zeitlimit sind kein Abriss. Scheitert nur die
Nachfrage nach fehlenden Karten und trägt das erste Ergebnis schon Karten
(dasselbe Merkmal, nach dem die Verarbeitung entscheidet), ist die Analyse geliefert — das ist eine Warnung (`nachfrage-gescheitert`), kein
Alarm; trägt es keines, bleibt es die Fehlerzeile mit Alarm
(`attempt: retry-ohne-ergebnis`). Gehäufte Abrisse zählt die
log-basierte Metrik `ki_verbindungsabriss`; mehr als drei in 24 Stunden lösen den
Alarm „KI-Verbindung bricht gehäuft ab“ aus — auch wenn jeder Neuversuch gelang.

**Begründung.** Am 01.10.2026 scheiterten 2 von 30 Analysen eines Workshops an
einem Abriss; beide Kinder sahen sofort die Fehlermeldung. Ein Neuversuch kostet
höchstens einen KI-Aufruf mehr je Abriss. Wie oft die Fehlerart früher vorkam,
ist nur eingeschränkt belegbar: Der 30-Tage-Speicher enthält Fehlerzeilen der KI
nur aus der Zeit vor der Umstellung des Diagnose-Speichers (Abschnitt
„Diagnose-Speicher: nur, was der Datenschutztext nennt“) — darin kein Abriss,
gefunden wurden nur Überlastungen (429) und ein 503 am 07./08.09.2026; seither
bleiben Fehlerzeilen nur einen Tag.

**Datenschutz.** Ins technische Protokoll kommt der Grund nur als
`ursache: { code, text }`: der Fehlercode als feste Kennung (z. B.
`UND_ERR_SOCKET`) und ein Kurztext NUR, wenn er wörtlich einer festen Meldung aus
einer Positivliste entspricht (z. B. „other side closed“) — sonst `null`. Eine
Maskierung nach Mustern wurde verworfen, weil sie nicht jede Adress-Schreibweise
erwischte. Die Verbindungsdaten, die Node.js anhängt (Adressen und Ports beider
Seiten), werden nie geschrieben (`verbindungsfehler.js`, geprüft in
`mistral-verbindungsabbruch.test.js` an jeder Zeile, auch gegen halbe Adressen).
Das entspricht dem, was die Datenschutzerklärung für das technische Protokoll
nennt: ob ein Schritt geklappt hat — keine IP-Adresse. Dass das Foto beim
Neuversuch ein zweites Mal an Mistral geht, deckt die Erklärung (sie nennt den
Zweck, keine Anzahl).

**Offen: Live-Text bleibt beim Neuversuch stehen.** Der Neuversuch läuft ohne
Live-Text. Bis sein Ergebnis da ist, sieht das Kind den Text, der vor dem Abriss
ankam; das Ergebnis kommt dann aus einer anderen Modellantwort und ersetzt ihn.
Das Ergebnis selbst ist richtig. Eine Behebung (den Live-Text im Auftrag
zurücksetzen und im Browser sichtbar neu anfangen) braucht eine Änderung an der
Live-Anzeige; ob sie gebaut wird, entscheidet Christoph (vorgelegt 01.10.2026).

**Betrachtete Alternative.** Mehrere Neuversuche oder Pausen wie bei der
Überlastung (429): verworfen — ein Abriss ist kein Zeichen von Überlast, und jeder
weitere Versuch verlängert die Wartezeit des Kindes.

**Bedingung für Neubewertung.** Der Alarm „KI-Verbindung bricht gehäuft ab“
(mehr als drei Abrisse in 24 Stunden) oder ein Neuversuch, der selbst scheitert —
dann liegt die Ursache außerhalb eines Einzelfalls, und `ursache.code` zeigt, wo.

## Foto direkt laden statt über den Download-Weg der Speicher-Bibliothek (01.10.2026)

**Entscheidung.** `queue-storage.js` lädt das Foto mit EINER Anfrage an dieselbe
Adresse, die `@google-cloud/storage` benutzt (`…/storage/v1/b/<Fach>/o/<Objekt>?alt=media`),
mit der Anmeldung der Bibliothek, ihrer Prüfsumme (crc32c aus `x-goog-hash`, mit
ihrem Prüfsummen-Erzeuger) und ihren Wiederholungsregeln (`retryOptions`;
wiederholt bei 408/429/5xx, Verbindungsabriss, Zeitüberschreitung und falscher
Prüfsumme; Pause wie in `retry-request`). Je Versuch gilt ein Zeitlimit, ein Foto
ist klein. Den Bildtyp liefert die Antwort selbst; die zweite Anfrage nach den
Metadaten entfällt.

**Begründung, gemessen.** Seit 4.13.0 schrieb jede Analyse
„MaxListenersExceededWarning … PassThrough“ ins Protokoll: Der Download-Weg der
Bibliothek hängt über ihr Hilfspaket teeny-request (`index.js:194`) dieselben
Zuhörer mehrfach an einen Strom, ab etwa 64 KB; mit 7.22 nie. Die unabhängige
Prüfung fand an derselben Stelle den schwereren Fehler: Antwortet der Speicher
mit 429 oder 5xx, wirft dieser Weg einen ungefangenen Fehler
(`ERR_STREAM_UNABLE_TO_PIPE`) und reißt den ganzen Prozess mit — gemessen am
lokalen Schein-Speicher mit 8.2.0 UND 7.22.0, also auch in den ausgelieferten
Fassungen bis 4.13.0. Eine reparierte Fassung gab es nicht. Datenweg unverändert:
unser Server liest unser Fach.

**Scheitert das Laden endgültig** (nach allen Wiederholungen, oder 401/403/404),
schreibt `queue-storage.js` eine Fehlerzeile `foto-laden-gescheitert` (nur
Fehlerart und Grund-Code, kein Pfad, keine Kennung); sie löst die Nachricht
„Analyse gescheitert“ aus. Vorher war dieser Fall nur laut, weil der Prozess
abstürzte.

**Bewusste Abweichung bei der Prüfsumme.** Fehlt die Angabe `x-goog-hash` in
der Antwort, wird das Foto ohne Vergleich angenommen (die Bibliothek würde
abbrechen); Google sendet sie bei jedem Download. Mit `Content-Encoding: gzip`
gespeicherte Objekte vergleicht der direkte Weg nicht entpackt — `storeImage`
speichert nie so.

**Betrachtete Alternativen.** Die Speicher-Bibliothek auf 7.22 zurückstellen:
verworfen — firebase-admin 14.5 verlangt 8, und 7.22 stürzt bei 429/5xx genauso
ab. Die Warnung abschalten: verworfen, das ließe den Absturz stehen und
verdeckte die Fehlerklasse, für die es die Warnung gibt.

**Bedingung für Neubewertung.** Eine Fassung von teeny-request oder der
Speicher-Bibliothek, die BEIDES behebt — die Warnung und den Absturz bei 429/5xx.
Geprüft wird das mit `functions/src/__tests__/hilfen/foto-laden-probe.cjs` bei
abgeschaltetem direktem Weg, auch mit einer Antwortfolge „429, dann 200“
(`PROBE_STATUS=429,200`).

## HEIC-Fotos im Browser öffnen: WebAssembly und LGPL (08.09.2026)

**Anlass.** Am 08.09.2026 scheiterten in einer Klasse 3 von 31 Versuchen daran, dass
Android-Browser HEIC-Fotos nicht öffnen können — das Standardformat vieler
Samsung-Handys. Das Kind sah „Format nicht unterstützt". Ein Fehler, den der Nutzer
sieht, ist unser Fehler, egal wo die technische Ursache liegt.

**Was seitdem gilt.** Kann der Browser ein HEIC-Foto nicht selbst öffnen, wandelt es
der Dekoder libheif (mit libde265) als WebAssembly-Baustein im Browser um. Danach
nimmt das Bild exakt denselben Weg wie jedes andere: EXIF und GPS werden im Browser
gelesen, das Bild wird verkleinert und neu kodiert, Metadaten bleiben zurück, erst
dann geht es zum Server. Die Zusage „GPS erreicht nie unsere Server" bleibt
wörtlich wahr; `e2e/problemfaelle.test.js` prüft am abgefangenen Upload, dass keine
Koordinaten mitgehen.

**Bewusste Lockerung der Sicherheitsrichtlinie.** `script-src` trägt zusätzlich
`'wasm-unsafe-eval'`. Ohne diesen Eintrag lässt kein Browser WebAssembly
instanziieren, auch nicht von der eigenen Adresse. Der Eintrag erlaubt **nur**
WebAssembly, kein `eval`, keine Inline-Skripte, keine fremden Hosts — `script-src`
bleibt sonst `'self'`. Das Binary kommt von unserem Server, ist per Prüfsumme
festgeschrieben (`public/lib/PRUEFSUMMEN.json`) und wird erst geladen, wenn ein
HEIC-Foto ausgewählt wurde und der Browser es nicht selbst konnte (rund 1,5 MB,
einmal je Seite). Für JPEG-Fotos ändert sich nichts, kein zusätzlicher Abruf.

**Lizenz.** libheif und libde265 stehen unter LGPL 3.0. Das ist mit der MIT-Lizenz
dieses Projekts vereinbar, weil die Bibliothek als getrennte, unveränderte und
austauschbare Datei vorliegt und nur über ihre öffentliche Schnittstelle benutzt
wird. Lizenztext, Version und Herkunft: `public/lib/libheif/`, Übersicht in
`THIRD-PARTY.md`, sichtbar auf der Website im Impressum („Verwendete Open-Source-Software").

**Rückweg.** Rückweg ohne Deploy: keiner — der Baustein ist Teil der Auslieferung;
Rückweg mit Deploy: Ordner `public/lib/libheif/` und den HEIC-Zweig in
`public/js/exif.js` entfernen, CSP-Eintrag zurücknehmen. Seit 30.09.2026 verlangt
`scripts/deploy.sh` für den Dekoder einen grünen Herkunftsnachweis; fehlt der
Ordner, gibt es nichts nachzuweisen — der Deploy meldet das als Hinweis und geht
weiter, ohne Notschalter.

## HEIC-Dekoder aus den Hersteller-Quellen, Nachtlauf Sicherheit (30.09.2026)

**Was war.** Der Dekoder kam als Fertigpaket eines Dritten (npm `libheif-js` 1.23.2).
Darin steckten libheif 1.23.2 und libde265 1.0.15, für die es veröffentlichte
Sicherheitsmeldungen gab; die Reparaturen gab es beim Hersteller (libheif 1.23.5,
libde265 1.1.3), im Fertigpaket nicht. Aufgefallen ist das keiner Prüfung: Dependabot
und `npm audit` kennen nur die Paketlisten, nicht die Dateien unter `public/lib`.
Befund OSS-2026-09-30-01.

**Entscheidung: selbst bauen.** `scripts/libheif-bauen.sh` baut beide Bibliotheken aus
den per Prüfsumme festgenagelten Original-Quellen, mit dem unveränderten Bauskript des
Herstellers und der Emscripten-Version, mit der der Hersteller testet. Der Workflow
`libheif-Bau` führt das auf GitHub aus und vergleicht Byte für Byte mit den
ausgelieferten Dateien; der Deploy verlangt den Lauf dieses Workflows (Vergleich und
Kontrollbau) grün für den jüngsten Commit, der Dekoder, Rezept oder Workflow
geändert hat (`scripts/deploy.sh`). Mehrere Läufe auf getrennten Runnern ergaben
identische Dateien — mit demselben Runner-Abbild und denselben Downloads; eine
unabhängige zweite Bauumgebung ist das nicht.
*Betrachtete Alternativen:* auf ein neues Fertigpaket warten (kein Termin; auch dessen
Bauweg stellt libde265 1.0.15 ein) und den Dekoder abschalten (Samsung-Fotos scheitern
wieder, 3 von 31 Versuchen am 08.09.).
*Neu bewerten, wenn* der Hersteller selbst fertige WebAssembly-Dateien mit aktueller
libde265 veröffentlicht.

**Bewusste Abweichungen vom Herstellerweg.**
- libde265 ab 1.1 baut nur noch mit cmake, das Herstellerskript kennt nur den
  älteren Weg. Das Rezept baut libde265 deshalb vorab und legt das Ergebnis dort ab,
  wo das Skript es erwartet. Dass wirklich die neue libde265 im Ergebnis steckt,
  prüft das Rezept an der Versionsnummer in der WebAssembly-Datei; ein Test hält
  Rezept, VERSION-Datei und diese Versionsnummer zusammen.
- libde265 wird ohne `NDEBUG` gebaut, die internen Prüfungen (`assert`) bleiben aktiv —
  wie beim bisherigen Herstellerweg. Damit ihre Dateinamen keinen Bauordner tragen,
  werden die Pfade umgeschrieben (`-ffile-prefix-map`); das Rezept bricht ab, wenn der
  Bauordner doch im Ergebnis steht.
- `libheif.js` wird nicht mehr nachträglich mit esbuild umgeschrieben (das tat das
  Fertigpaket für ältere Node-Versionen); ausgeliefert wird die Ausgabe von Emscripten.
  Sie setzt etwas neuere Browser voraus (Emscripten-Vorgabe: Chrome 85, Firefox 79,
  Safari 14.1). Die Seite selbst braucht schon Chrome 85; neu ausgeschlossen sind nur
  Firefox 77–78 und Safari 13.1–14.0, und nur beim Umwandeln eines HEIC-Fotos — dort
  erscheint dann die Meldung, dass das Foto nicht geöffnet werden konnte.

**Was der Kontrollbau belegt — und was nicht.** Er baut die frühere Fassung
(libheif 1.23.2, libde265 1.0.15) auf dem autotools-Weg nach. Seine `libheif.wasm` ist
Byte für Byte gleich der des Fertigpakets: Der Emscripten-Teil des Rezepts arbeitet
wie der des Zulieferers. Den neuen cmake-Weg für libde265 durchläuft er nicht; der ist
durch die Versionsnummer im Ergebnis, den Byte-Vergleich zweier Bauten und die
Browser-Tests mit echten HEIC-Fotos abgesichert. Für `libheif.js` gibt es keine
Vergleichsdatei vom Zulieferer (seine war mit esbuild umgeschrieben); die Summe des
Kontrollbaus ist deshalb nur ein Driftmelder für die Bauumgebung.

**Restrisiken.**
- Emscripten lädt seine Werkzeuge beim Bau selbst herunter und prüft sie nicht per
  Prüfsumme. Eine Änderung dort zeigen der Byte-Vergleich des Kontrollbaus
  (`libheif.wasm`) und sein Driftmelder (`libheif.js`) an — eine Garantie, dass die
  Werkzeuge unverändert sind, ist das nicht.
- Der Nachtlauf liest die Sicherheitsmeldungen im GitHub-Repository der Hersteller und
  die geprüften Einträge der GitHub-Datenbank für npm-Pakete. Meldungen, die nur in der
  NVD oder bei OSV stehen, sieht er nicht. Stichprobe 30.09.2026: Zu libde265 stehen
  in der NVD zwei Einträge ohne Herstellermeldung (CVE-2025-61147, CVE-2026-88373);
  die dort genannten Reparatur-Commits 8b17e09 und f8d3249 sind in 1.1.3 enthalten
  (GitHub-Vergleich mit dem Tag v1.1.3).

**Nachtlauf.** `.github/workflows/sicherheit-nachts.yml` prüft täglich: npm-Lücken in
beiden Bäumen einschließlich der Werkzeuge (der PR-Riegel prüfte bis 30.09.2026 den
Wurzelbaum nicht, Befund OSS-2026-09-30-06), die Herstellermeldungen zu jeder
Bibliothek und jeder einzelnen Datei unter `public/lib` und die Abkündigungshinweise
von GitHub an den jüngsten Läufen jedes Workflows. Die Prüfungen mit fremden Quellen
laufen bewusst nicht im Pull Request: Eine neue fremde Meldung dürfte nicht jeden
unbeteiligten PR blockieren (2026-07-01). Der netzfreie Teil — ist jede Bibliothek
überhaupt beobachtet? — läuft dagegen in jedem Pull Request und vor dem Push.
Ausnahmen gibt es nur begründet, mit Ablaufdatum in der Form JJJJ-MM-TT und — bei
Herstellermeldungen — für genau eine Version; jede steht in jeder Ausgabe.

*Alarm:* Ist auf `main` einer der Prüf-Jobs nicht erfolgreich — rot, abgebrochen
oder übersprungen —, geht ein ntfy-Push mit Stufe „urgent" aufs Handy (Adresse als
GitHub-Secret). Die Mail von GitHub genügt nicht, sie wird beim Empfänger
automatisch gelöscht. Am 1. jedes Monats kommt eine sichtbare Probe; bleibt sie aus,
ist der Alarmweg gestört. Ist in einem Probelauf eine Prüfung nicht grün, meldet
der Push „ROT", nicht „PROBE".

*Festgeschrieben:* Die beiden Sicherheits-Workflows sind im Deploy-Riegel
(`scripts/pruefe-deploy-riegel.py`) VOLLSTÄNDIG per Prüfsumme festgeschrieben. Frei
bleiben nur, was nachweislich nichts bewirkt: die Versionskennungen der Actions
(`uses: owner/repo@<SHA> # vN` — SHA und Kommentar; Dependabot hebt sie an),
Kommentar- und Leerzeilen außerhalb mehrzeiliger Befehle und Ausdrücke sowie
Leerzeilen am Dateiende. Als Leerraum zählt dabei nur das Leerzeichen — einen Tab
vor einem Kommentar lehnt GitHub ab, er macht die Summe deshalb rot. Jede andere
Änderung macht den Riegel rot; eine bewusste Änderung trägt man dort nach
(`--vertrag-summen`). Zusätzlich prüft er inhaltlich: genau ein festgelegter Befehl
je Prüf-Job, kein `if`, kein `continue-on-error`, keine umlenkenden Umgebungswerte,
ein täglicher Zeitplan.
*Lesbarkeit:* Eine Workflow-Datei, die GitHub nicht lesen kann, läuft nie — und der
Pull Request zeigt den Fehllauf nicht an. `scripts/pruefe-workflows-gueltig.mjs` prüft
im Pull Request und vor dem Push jede Datei unter `.github/workflows` in zwei Schritten:
zuerst Zeichen und Größe, die GitHubs Server-Leser ablehnt, obwohl YAML sie erlaubt
(Tab, NUL, die Zeilentrenner U+0085/U+2028/U+2029, mehr als 1.048.576 Zeichen —
gemessen mit GitHubs eigenem Leser aus `actions/runner`), dann die YAML-Syntax samt
Grundgerüst (`on`, Jobs mit `runs-on` oder `uses`); beides mit Positivkontrolle.
*Grenze:* Die Prüfsumme schützt vor versehentlichem Stilllegen, nicht vor Absicht —
wer den Workflow ändert, kann die Summe mitändern; beides steht dann im selben Pull
Request im Diff. Eine reine SHA-Änderung an einer Action bleibt zulässig. Weitere
Stellen, an denen GitHubs Server strenger liest als diese Prüfung, sieht sie nicht;
das fängt der Deploy auf (nächster Absatz).

*Restrisiken:*
- Ob GitHub den Nachtlauf tatsächlich ausführt, sieht der Vertrag nicht (60-Tage-
  Abschaltung, verworfene Läufe, eine Datei, die GitHubs Server anders liest).
  Aufgefangen beim nächsten Deploy: `deploy.sh` verlangt einen Nachtlauf auf `main`,
  der wirklich gelaufen ist — nach Zeitplan oder von Hand gestartet, mit Ergebnis
  „success" oder „failure", mit genau der ausgelieferten Fassung von
  `sicherheit-nachts.yml` und nicht älter als die Grenze `NACHT_GRENZE_MINUTEN` in
  `scripts/deploy.sh`. Die roten Läufe ohne Jobs, die GitHub bei einer unlesbaren
  Datei je Push anlegt, zählen damit nicht. Nach jeder Änderung am Nachtlauf muss er
  deshalb einmal laufen, bevor ausgeliefert wird. Zwischen zwei Deploys fällt ein
  ausbleibender Nachtlauf nur durch die ausbleibende Monatsprobe auf.
- Der Alarm-Job kann seinen eigenen Fehlschlag nicht melden (fehlendes Secret,
  ntfy nicht erreichbar); „200" vom ntfy-Server heißt nur „angenommen". Auch das
  zeigt erst die ausbleibende Monatsprobe.
- Die ntfy-Zugangsdaten stehen an zwei Stellen (Secret Manager und GitHub-Secrets);
  wer sie an einer ändert, muss die andere nachziehen (`docs/ERROR-ALERTING.md`).

## Kinderschutz-Filter: Anzahl und Diagnose (09.09.2026)

**Was war.** Der Werbe-Aufruf lieferte sechs bis acht Einträge, der Filter
strich bei erkennbar Minderjährigen einzelne davon. Ein Kind mit zwei
gestrichenen Einträgen sah sechs Werbeideen, ein Erwachsener acht. Und die
Kinderschutz-Zeile im Log nannte nur einen Zähler und die Stufe („minor"),
nicht das Feld und nicht das Wort. Am 08. und 09.09. stand bei 8 von 19
Analysen mit Minderjährigen ein Treffer im Fließtext, und niemand konnte sagen,
ob das „Cocktail-Bar" in einer Beschreibung war oder eine Wett-Werbung für ein
Kind. Die Zeile war zudem nach einem Tag gelöscht.

**Entscheidung.**

1. Der Werbe-Aufruf fordert zehn Einträge an, gezeigt werden höchstens acht
   (`WERBE_ANFORDERUNG`, `WERBE_ANZAHL` in `functions/src/minor-safety.js`,
   die Prompts lesen die Zahl von dort). Gekappt wird erst nach dem Filter,
   nur die Werbung, nie die Manipulations-Trigger. Nachgefüllt wird nichts.
2. Je Treffer standen im Log das Feld (`boost.ad_targeting`,
   `normal.profileText`, `boost.categories.kaufkraft`) und das getroffene
   Stichwort aus der festen Sperrliste, klein geschrieben, höchstens 30
   Zeichen. Dazu die Anzahl der Werbeeinträge je Modus nach Filter und Kappung.
   Feld und Stichwort sind seit 27.09.2026 wieder aus der Zeile, weil der
   Datenschutztext nur nennt, ob ein Wort vorkam (Abschnitt „Diagnose-Speicher:
   nur, was der Datenschutztext nennt“); der Bericht des Filters kennt sie
   weiterhin, geloggt werden Anzahl und Grund.
3. Die Zeile bleibt 30 Tage im Diagnose-Speicher `client-diagnostics`
   (europe-west1), gesetzt über `scripts/log-sink-analyse-zeilen.sh`.

**Warum kein Personenbezug.** Das Stichwort ist ein Wort aus unserer eigenen
Liste, nicht aus dem Text über die Person. Der Test
`minor-safety-diagnose.test.js` prüft, dass weder der Werbetext noch der Satz
im Log landet. Das geschätzte Alter stand schon vorher in der Zeile.

**Betrachtete Alternativen.** Nachfüllen aus einer festen Ersatzliste:
verworfen, das wären erfundene Einträge in einer Anwendung, deren Kernaussage
ist, dass die KI wirklich analysiert. Ein zweiter KI-Aufruf zum Nachfüllen:
verworfen, kostet Zeit und Geld für einen Fall, den zwei Reserve-Einträge
abdecken. Einen Satzausschnitt um das Stichwort loggen: verworfen, der
Ausschnitt könnte eine Beschreibung der Person enthalten.

**Bewusst getragene Folge.** Werden bei einem Kind mehr als zwei Einträge
gestrichen, sieht es weniger als acht. Das Log zeigt das (`werbung` unter 8).

**Neubewertung.** Die geplante Auswertung nach 30 Tagen (harmlose Wörter
oder Werbebegriffe?) geht seit 27.09.2026 nicht mehr aus dem Protokoll; sie
wird mit eigenen Fotos nachgestellt.

## Kinderschutz-Filter: Schutzgrenze mit Puffer (17.09.2026)

**Was war.** Stufe 2 des Filters (Kredit, Wetten, Alkohol, Tabak,
Schönheits-OP, Diät) griff, wenn die Untergrenze der geschätzten Altersspanne
18 oder darunter war — ohne Abstand (Entscheidung vom 11.08.2026). In zwei
Workshops mit Schulklassen hatten zwischen 7 und 12 Uhr 31 von 186 (16.09.) und
50 von 143 (17.09.) Analysen eine Untergrenze von 19 oder mehr; bei diesen
Analysen griff Stufe 2 nicht, auch wenn die Person minderjährig war. 24 der 31
und 40 der 50 Werte lagen auf genau 19 oder 25, kein einziger zwischen 20 und
24. Im Prompt standen die Überschrift „19-25“, die Regel „22-28, nicht jünger“
und das Beispiel „~38 (Spanne 35-42)“ samt „Mann Mitte dreißig“. Belegt ist die
Übereinstimmung der Zahlen, nicht die Ursache: Das Log enthält nur die
Untergrenze.

**Entscheidung.**

1. Stufe 2 greift, solange die Untergrenze 25 oder darunter ist
   (`SCHUTZ_BIS` in `functions/src/minor-safety.js`, dort auch die Beispiele).
2. Die genannten Zahlen-Anker sind aus dem Prompt entfernt. Das Formatbeispiel
   nennt kein Alter, weder in Ziffern noch in Worten; die Altersangabe zeigt nur
   den Platzhalter „‹Zahl›“. `age-markers.test.js` prüft das und legt per
   Positivliste fest, welche Spannen im Altersteil noch stehen dürfen (die
   Merkmals-Tabellen).
3. Ist das Alter nicht lesbar — abgeschriebene Vorlage in beliebiger Klammer,
   oder ein Altersversuch ohne jede Zahl —, zeigt die Alterskarte einen festen
   Satz aus der Sprachdatei, auch die Live-Anzeige zeigt die Karte vorher
   nicht. Der Filter lässt Stufe 2 greifen; `mistral.js` bestimmt das (Erkennung
   in `alters-lesbarkeit.js`) aus den
   Rohwerten der KI-Antwort, bevor eine Karte umgeschrieben wird. Die
   Kinderschutz-Zeile meldet es als `alterUnlesbar: true`, das Ergebnis trägt
   `meta.alterUnlesbar`, und der Realitäts-Check fragt das Alter dann nicht
   ab; der Server nimmt dessen Bewertung deshalb auch ohne Alter an
   (`handle-telemetry.js`). Als Altersangabe einer Karte zählt nur ihr erster
   Satz — Zahlen im Beleg-Satz („Trikot mit der Nummer acht“) sind kein
   Alter. Zahlwörter („etwa dreizehn“, „Mitte vierzig“, „in her teens“) und
   Kategoriewörter („Teenager“, „Schulkind“) gelten als lesbar und werden für
   die Altersauslese in Zahlen übersetzt, Kategorien nur, wenn keine Zahl
   dasteht; „13jährig“ und „dreizehnjährig“ werden ebenfalls gelesen. Eine
   Antwort ohne jeden Altersversuch („Keine klaren Bildsignale.“) bleibt wie
   bisher ungefiltert.
4. Der zweite Werbe-Aufruf nennt dieselbe Grenze; sein Text liest sie aus
   `minor-safety.js` (`SCHUTZ_ALTER`), steht also nur an einer Stelle.

**Warum.** Das US-Normungsinstitut NIST nennt für die Grenze 18 einen Puffer von
sieben Jahren (Schwelle 25) als üblich (NIST IR 8525, dort bezogen auf den
Schätzwert; die Regel hier nimmt die Untergrenze und ist damit strenger).
Allgemeine Bild-Sprachmodelle schätzen 16 bis 29 % der Minderjährigen als
erwachsen (Ren u. a. 2026, arXiv 2602.07815). Dass Zahlen im Prompt die
Antwort anziehen und Ermahnungen dagegen nicht genügen, zeigen Lou & Sun 2024
(arXiv 2412.06593). Mit Puffer wären an den beiden Tagen bei gleichen
Schätzungen 7 statt 31 und 10 statt 50 Analysen ohne Stufe 2 geblieben.

**Getragene Folge.** Erwachsene, deren Spanne bei 25 oder darunter beginnt,
sehen diese Werbeideen nicht. Das Feld `minderjaehrig` in der
Kinderschutz-Zeile heißt weiter so, bedeutet ab dieser Auslieferung aber
„Stufe 2 greift“. Stufe 1 (Pornografie, Waffen, Extremismus) gilt unverändert
für alle.

**Betrachtete Alternativen.** Stufe 2 für alle: verworfen (Entscheidung vom
16.09.2026) — Kredit- und Wett-Werbung ist bei Erwachsenen Teil der
Aufklärung. Mehrfache Schätzung und den niedrigsten Wert nehmen: für
Altersschätzung nicht belegt und doppelt so teuer. Ein eigener Altersschätzer
im Browser: bei Kindern nicht nachweislich besser als das Sprachmodell. Bei
nicht lesbarem Alter ein zweiter KI-Aufruf: verworfen, er kostet einen Platz
im Mistral-Kontingent, während die Klasse wartet; die Häufigkeit zeigt das Feld
`alterUnlesbar`. Den Platzhalter aus dem Text herausschneiden statt eines
festen Satzes: verworfen, die zweite Gegenprüfung fand Reste und zerstörte
Sätze.

**Rückweg.** Nur mit Deploy: `PUFFER_JAHRE` in `minor-safety.js` ändern. Die
Schwellen-Tests in `minor-safety.test.js` pinnen den Wert und müssen
mitgeändert werden; der Werbe-Prompt zieht automatisch nach.

**Offen, bewusst nach der nächsten Messung.** Die Werberegel im Haupt-Prompt
nennt den Puffer noch nicht (der Server streicht trotzdem); die Beispiel-Belege
der Alterskarte sind allgemein formuliert — ob die KI dadurch seltener ein
konkretes Merkmal nennt, zeigt der Vortest (Kennzahl „Begründung konkret“).

## Kinderschutz-Zeile: oberes Ende der Altersschätzung (25.09.2026)

**Was war.** Die Kinderschutz-Zeile hielt nur die Untergrenze der geschätzten
Altersspanne fest (`alter`). In Workshops mit Schulklassen begann die Spanne
bei einem großen Teil der Kinder deutlich unter dem Alter der Klasse. Ob das
eine falsche Schätzung ist oder nur eine breite Spanne, die das echte Alter
einschließt, ließ sich damit nicht auswerten: „8–13“ und „8–9“ ergeben
dieselbe Zeile.

**Entscheidung.** Die Zeile trägt zusätzlich `alterBis`: das obere Ende der
geschätzten Spanne (`obereAltersgrenze` in `functions/src/alters-lesbarkeit.js`,
Regeln und Beispiele dort). Gelesen wird zuerst eine erkannte Spanne oder
Plus-Minus-Angabe, sonst eine Zahl mit Altersbezug. Fremdzahlen wie
Körpergröße oder Uhrzeit zählen nicht — anders als bei der Untergrenze, wo sie
bewusst Richtung Schutz ziehen. Ohne oberes Ende (Kategoriewort, Jahrzehnt wie
„Ende zwanzig“, kein Altersversuch, abgeschriebene Vorlage) steht `null`. Das
Feld entscheidet über nichts: Stufe 2 hängt wie bisher an Untergrenze und
lesbarem Alter. `alters-obergrenze.test.js` prüft das über ein Raster aller
Spannen und schreibt die Feldmenge der Zeile fest.

**Zweck und Datenart.** Der Zweck ist derselbe wie beim ganzen Eintrag: prüfen,
ob der Kinderschutz zuverlässig wirkt. Stufe 2 hängt an der Altersschätzung.
Liegt sie bei Kindern zu tief, wäre die naheliegende Korrektur ein Umbau des
Alters-Prompts, und ein solcher Umbau kann Kinder über die Schutzgrenze
schieben. Das obere Ende zeigt vorher, ob die Spannen das Alter ohnehin
einschließen und ein Umbau überhaupt nötig ist. Die Datenschutzerklärung nennt
für diesen Eintrag, „auf welches Alter die KI ungefähr getippt hat“; das deckt
beide Enden der Spanne. Neu ist keine Art von Angabe, sondern das zweite Ende
derselben Schätzung; die Zeile trägt weiterhin keinen Text aus dem Profil.

**Betrachtete Alternativen.** Den Punktwert (`~14`) statt des oberen Endes
loggen: verworfen, er sagt nicht, ob die Spanne ein bekanntes Alter
einschließt. Den ganzen Alterssatz loggen: verworfen, er kann eine
Beschreibung der Person enthalten. Die größte Zahl der Angabe nehmen:
verworfen, eine Körpergröße („1,60 m“) oder Uhrzeit würde die Spanne
künstlich breit machen. Die Beispielfotos der Startseite im Log kennzeichnen:
zurückgestellt.

**Rückweg.** Nur mit Deploy: das Feld in `loggeMinorSafety`
(`functions/src/job-helfer.js`) weglassen. Am Filter ändert das nichts.
Bereits geschriebene Werte bleiben bis zum Ende ihrer Aufbewahrung im
Diagnose-Speicher (RUNBOOK, „Logs und Aufbewahrung“).

**Neubewertung.** Zeigen Workshops mit bekanntem Klassenalter, dass die
Spannen das Alter überwiegend einschließen, ist „zu jung“ Breite und kein
Schätzfehler; am Alters-Prompt ändert sich dann nichts. Verfehlen sie es
überwiegend, wird der Alters-Prompt überarbeitet und vor der Auslieferung
daraufhin geprüft, dass keine Kinder über die Schutzgrenze rutschen.

## Erfolgsweg eines Auftrags ohne Kennung im Log (26./27.09.2026)

**Warum.** Die Kinderschutz-Zeile trägt keine Vorgangskennung
(PRIV-2026-09-10-02), damit sich die Altersschätzung nicht mit den
Geräteangaben verbinden lässt, die der Browser unter dieser Kennung in
Fehlermeldungen schickt. Zwei Wege hätten sie trotzdem verbunden: Das Label
`execution_id` steht an jeder Logzeile eines Aufrufs (die Laufzeit schreibt es,
firebase-tools schaltet es beim Deploy ein). Und die Dauern in den Zeilen von
Analyse und Abholung ergeben Anlage- und Fertigzeitpunkt eines Auftrags
millisekundengenau; der Fertigzeitpunkt liegt Millisekunden neben der
Kinderschutz-Zeile. Jede Kennung irgendwo auf diesem Weg hätte deshalb
genügt.

**Entscheidung.** Kein Aufruf, in dem eine Analyse läuft, und weder Annahme
noch Abholung eines erfolgreichen Auftrags schreiben Auftrags- oder
Vorgangskennung ins Log:

- nicht die Zeilen des Einlasses bis zur Annahme
  (`functions/src/handle-enqueue.js`);
- keine Zeile des Analyse-Aufrufs ab dem Claim, auch nicht dessen Fehler- und
  Alarmzeilen (`functions/src/handle-process-job.js`, Kommentar „AB HIER KEINE
  KENNUNG IM LOG“); `loggeMinorSafety` nimmt keine Kennung entgegen;
- keine Zeile der Abholung, auch nicht die Warnung bei gescheitertem
  Abhol-Vermerk (`functions/src/handle-job-status.js`);
- keine Fehlerzeile des Aufräumdienstes (`functions/src/handle-reap.js`): Er
  fasst Aufträge nach festen Fristen an, eine jobId dort ließe sich darüber
  minutengenau der Abschlusszeile der Analyse zuordnen.

Firestore- und Speicher-Meldungen zu einem Auftrag können dessen Dokument- oder
Bildpfad enthalten. Deshalb:

- Nur Fehlercode und -art nennen die Fehlerzeilen des Aufräumdienstes je
  Auftrag, die Warnung bei gescheitertem Abhol-Vermerk, die Fehlerzeile bei
  gescheiterter Platzbestätigung im Einlass und die Löschfehler-Zeile im
  Speichermodul. Die beiden Löschfehler-Zeilen (Speichermodul, liegengebliebenes
  Bild) nennen auch den Bildpfad nicht; er ist je Auftrag eindeutig, und das
  Bild räumt die Lifecycle-Regel ohnehin.
- Die Fehlerzeilen im Analyse-Aufruf von `handle-process-job.js` (Abbruch mit
  `status: error`, `completeJob-error`, Zähler- und Dauer-Warnung) behalten den
  Fehlertext, weil er die Fehlersuche trägt, aber ohne jobId, traceId,
  Bildpfad und Firestore-Pfad (`ohneKennung`).
- Übrige Fehlerzeilen auf diesen Wegen nennen den Fehlertext unverändert. Sie
  betreffen keinen einzelnen Auftrag in Firestore (Suchabfragen, Zähler und
  Statistik, Einstellungen, Lebenszeichen des Aufräumdienstes,
  Benachrichtigungsdienst) oder melden Fehler der KI. Die Fehlerzeilen eines
  gescheiterten Einlasses tragen ohnehin Kennungen (siehe unten).

Die Dauern bleiben.

Kennungen tragen nur noch Wege, auf denen der jeweilige Aufruf keine Analyse
macht: Zeilen des Analyse-Aufrufs vor dem Claim und Fehlerzeilen eines
gescheiterten Einlasses (dort einmal beide Kennungen zusammen). Auftrag und
Antwort an den Browser tragen die Vorgangskennung weiter. Geprüft werden
jeweils ALLE Ausgaben eines Aufrufs nach den Werten der Kennungen, mit
Positivkontrolle: `analyse-aufruf-ohne-kennung.test.js` (Erfolgs- und
Fehlerwege der Analyse, auch mit Firestore-Fehlertexten, die die Kennungen
enthalten), `handle-enqueue.test.js` (Annahme, auch über die
Warnwege, nach denen der Einlass weiterläuft), `handle-job-status.test.js`
(Abholung, auch mit gescheitertem Abhol-Vermerk), `handle-reap.test.js` (jeder
Fehlerweg des Aufräumdienstes je Auftrag, mit Fehlertexten, die die jobId
enthalten).

**Getragene Folge.** Eine vom Browser gemeldete Vorgangsnummer findet bei einem
erfolgreichen Auftrag im Server-Log nichts mehr. „Nie abgeholt“ lässt sich ohne
Kennung nur nähern: Anzahl `process-job` mit `status` done, blocked oder error,
minus Anzahl der Warnungen `completeJob-error` (Ergebnis nie gespeichert),
minus Anzahl `job-delivered` (auch gesperrte Ergebnisse werden abgeholt). Ungenau
bleibt: Eine erneute Abholung, bevor der Abhol-Vermerk steht, zählt doppelt; und
scheitert im Fehlerweg das Speichern still, weil der Auftrag schon abgeschlossen
war, zählt der Lauf als nie abgeholt. Diese Stelle ist die einzige Quelle der
Regel; die Code-Kommentare verweisen hierher. Zeitliche
Nähe bleibt: Fehlermeldungen des Browsers tragen Geräteangaben und liegen, wenn
es zu einer Analyse eine gibt, Sekunden neben ihrer Kinderschutz-Zeile. Sie
sind für die Fehlersuche nötig; eine Nummer, die beide verbindet, gibt es
nicht.

**Betrachtete Alternativen.** Das Label abschalten: nicht möglich, firebase-tools
setzt es nach den eigenen Umgebungsvariablen. Die Dauern auf Sekunden runden:
verworfen, der Fertigzeitpunkt folgt auch aus der Abholzeile und liegt ohnehin
neben der Kinderschutz-Zeile. Nur die Abschlusszeile ändern: verworfen, die
Zeilen von Einlass und Abholung hätten dieselbe Verbindung hergestellt.

**Rückweg.** Nur mit Deploy. Eine Kennung in einer der geprüften Ausgaben lässt
die Tests rot werden — das ist gewollt.

**Neubewertung.** Braucht eine Zeile auf diesem Weg eine Kennung, wird vorher
geklärt, wie sie ohne Verbindung zur Kinderschutz-Zeile auskommt.

## Diagnose-Speicher: nur, was der Datenschutztext nennt (26.09.2026)

**Warum.** Der Datenschutztext ist die Vorgabe, das Programm folgt ihm. Er
nennt für den 30-Tage-Speicher bei der Kinderschutz-Auswertung zwei Einträge
je Analyse (daneben liegen dort die Browser-Meldungen): bei der KI nur, wie
lange sie gebraucht hat, und beim Kinderschutz das geschätzte Alter, die
Filterentscheidung und ob ein Wort der Sperrliste vorkam. Die Erfolgsmeldung des Browsers kommt zudem Sekunden nach
der Kinderschutz-Zeile an; trug sie Geräteangaben, ließ sich die
Altersschätzung über die Uhrzeit einem Gerät zuordnen.

**Entscheidung.**
1. Die Erfolgsmeldung (`analyze-success`) trägt weder Browsertyp noch
   Geräteangaben noch Art oder Tempo der Verbindung noch Vorgangskennung
   noch Wake-Lock-Zustand. Der Browser schickt sie nicht
   (`public/js/telemetry-logger.js`), der Server verwirft sie auch von
   älteren Seiten (`functions/src/handle-telemetry.js`). Übrig bleiben
   Dauern, Modus, Motiv, Sprache der Oberfläche, die aufgerufene Seite (nur
   der Pfad, etwa „/“ oder „/en/“) und zwei Ja/Nein-Werte (Browser online,
   Seite sichtbar). Geräteangaben bleiben in den Fehlermeldungen, wie der
   Datenschutztext beschreibt, für die Fehlersuche.
2. `mistral-single-large` trägt nur Dauer und Wiederholungen und entsteht
   höchstens einmal je Analyse (seit 27.09.2026): Fragt der Server die KI
   nach, weil Karten fehlten, stehen die Versuche, die eine Antwort lieferten,
   addiert in dieser einen Zeile (`loggeKiDauer` in
   `functions/src/mistral.js`). Sie entsteht nur, wenn mindestens ein Versuch
   eine Antwort der KI erhalten hat; ein abgebrochener Versuch zählt nicht,
   auch wenn aus seinem Teiltext gerettet wird. Modell, Status,
   Token-Zahlen, Reparaturstufen und der Versuch stehen je Versuch in
   `mistral-single-large-details`, die nicht in den 30-Tage-Speicher geht
   (Filter vergleicht `step` exakt).
3. Die Kinderschutz-Zeile trägt keine Sprache mehr und seit 27.09.2026 weder
   das getroffene Wort der Sperrliste noch das Feld, in dem es stand — nur
   Anzahl und Grund („immer“ oder „minor“) der Treffer.
4. `public/__tests__/datenschutz-deckung.test.js` prüft jetzt auch die Felder
   der beiden Server-Zeilen einzeln gegen den Text (DE und EN), ohne
   Sammelbegriff; `alters-obergrenze.test.js` und `ki-zeile-ohne-tokens.test.js`
   halten fest, dass die echten Zeilen genau diese Felder haben.

**Getragene Folge.** Mit welchen Geräten erfolgreich analysiert wurde, lässt
sich nicht mehr auswerten. Welches Wort der Sperrliste in welchem Feld stand,
zeigt das Protokoll nicht mehr; ob die Sperrliste zu grob ist, lässt sich nur
noch mit eigenen Fotos nachstellen, nicht aus 30 Tagen Betrieb ablesen. Status, Modell, Token-Zahlen und Scheitern der
KI-Aufrufe gibt es nur noch einen Tag; das Herausrechnen der Beispielfotos
über die Token-Zahlen geht nur innerhalb dieses Tages. Die Kinderschutz-Zeile
nennt keine Sprache mehr; ein Ausfall nur einer Sprache ist darin nicht mehr
getrennt zu sehen.

**Betrachtete Alternativen.** Die Zeit der Kinderschutz-Zeile vergröbern:
verworfen, Cloud Logging speichert zusätzlich den Empfangszeitpunkt
sekundengenau. Geräteangaben auch aus den Fehlermeldungen nehmen: verworfen,
sie sind der Zweck dieser Meldungen (Lesefehler je Browser und System). Den
Datenschutztext an die Zeilen anpassen: verworfen, der Text ist die Vorgabe.

**Rückweg.** Nur mit Deploy. Ein zusätzliches Feld in einer der Zeilen lässt
die Feldmengen-Tests rot werden; wer es braucht, prüft zuerst, ob der
Datenschutztext es deckt.

## Schnittstellen direkt am EU-Server, nicht über das Auslieferungsnetz (09.09.2026)

**Was war.** Alle Aufrufe des Browsers an `/api/…` liefen über Firebase Hosting.
Hosting ist ein weltweites Auslieferungsnetz (Fastly); der Standort-Inventar-Lauf
vom 09.09.2026 maß den Transit über einen Knoten in Wien. Damit passierte auch
das komprimierte Foto einen Knoten dieses Netzes, bevor es den Server in Belgien
erreichte — ohne Speicherung (`cache-control: no-cache`), aber als Umweg, den
die Zusage „alles auf EU-Servern" nicht kennt. Entscheidung vom 09.09.2026:
kein Umweg.

**Entscheidung.** Der Browser ruft `enqueue`, `job-status`, `stats`, `errors`
und `telemetry` im Betrieb direkt unter ihren Cloud-Run-Adressen in
`europe-west1` auf. Die eine Quelle dafür ist `public/js/api-basis.js`. Nur
die Seite selbst (HTML, JS, CSS, Bilder, Fonts) kommt weiter aus dem
Auslieferungsnetz — sie enthält keine Nutzerdaten. Lokal, im Emulator und in
den Tests bleibt der Pfad relativ.

**Zwei Schutzschichten ändern sich dafür bewusst:**

1. **CSP `connect-src`** nennt die fünf Cloud-Run-Adressen einzeln, keinen
   Platzhalter wie `*.run.app` (der würde jeden fremden Cloud-Run-Dienst
   erlauben). Die Liste in `firebase.json` und die in `api-basis.js` werden vom
   Test `public/__tests__/api-basis.test.js` gegeneinander geprüft: fehlt eine
   Adresse, blockt der Browser den Upload; steht eine zu viel, weiß niemand
   mehr, wofür.
2. **CORS** auf den öffentlichen Functions war schon vorher gesetzt
   (`cors: ALLOWED_ORIGINS` in `functions/src/index.js`, Liste in
   `functions/src/domains.js`): Zustimmung nur für `malzi.me`, `www.malzi.me`
   und die beiden Firebase-Hostnamen. Gemessen am 09.09.2026: Vorab-Anfrage mit
   `Origin: https://malzi.me` → `204` mit `access-control-allow-origin:
   https://malzi.me`; mit einem fremden Ursprung → `204` **ohne** diesen Header,
   der Browser blockt. Die Live-Smoke-Probe „Direktweg" misst beides nach jedem
   Deploy.

**Was gleich bleibt.** Die Bremsen am Einlass (IP-Rate-Limit, Stundenlimit,
Honeypot, Bot-Heuristik über `Origin`/`Referer`) laufen im Dienst selbst und
sehen den Aufruf genauso wie vorher; beide Wege enden am selben Google-Front-End
vor Cloud Run, `req.ip` ändert sich dadurch nicht. Die Hosting-Umleitungen für
`/api/…` bleiben als Rückweg bestehen (RUNBOOK Hebel 5a) — und weil Browser mit
einer alten `app.js` im Zwischenspeicher weiter `/api/…` rufen, bricht für sie
nach dem Deploy nichts.

**Betrachtete Alternative.** Eine eigene Adresse `api.malzi.me` vor Cloud Run:
sauberer im Namen, aber ein DNS-Eintrag plus Zertifikat mehr — und der Abbau
genau dieser Adresse hat am 10.08.2026 die Website eine halbe Stunde lahmgelegt.
Verworfen zugunsten der nackten Cloud-Run-Adressen, die Google selbst mit
Zertifikat betreibt.

**Bewusst getragene Folge.** Die Cloud-Run-Adressen enthalten eine
Projekt-Kennung (`5ymhpdpqcq`); sie stehen jetzt lesbar in der Seite. Sie waren
schon vorher öffentlich erreichbar (`invoker: public`), neu ist nur die
Sichtbarkeit. Die Zugangsschutzschichten hängen nicht am Verstecken der Adresse.

**Neubewertung.** Wenn Firebase Hosting eine regionale Auslieferung ohne
weltweites Netz anbietet, oder wenn der Direktweg messbar langsamer ist als der
Hosting-Weg (Telemetrie `enqueueMs`, Vergleich 30 Tage vor/nach dem Deploy).

## Ein Einstellungswert wird ausgebaut: befristete Duldung im Abgleich (10.09.2026)

**Lage.** Der Abgleich vor dem Deploy (`scripts/betriebsprofil-vergleichen.js`)
verlangt, dass der Einstellungssatz in der Datenbank Feld für Feld dem Repo
entspricht. Entfernt eine Fassung Pflichtfelder, liest die noch laufende
Fassung sie weiter: Vor dem Deploy löschen hieße, die laufende Seite
lahmzulegen (die satzWache schlägt Alarm, keine Analyse läuft); nicht löschen
hieße, der Abgleich bricht die Auslieferung ab.

**Entscheidung.** `AUSGEMUSTERT` in `functions/src/produktiv-satz.js` nennt die
Reste mit Stichtag. Der Abgleich duldet genau diese — und zeigt sie bei jedem
Lauf als HINWEIS —, alles andere bleibt eine Abweichung; nach dem Stichtag
gelten auch die genannten wieder als Abweichung, und
`ausgemustert-uebergang.test.js` wird rot. Nach dem Deploy wird der Satz neu
geschrieben und die Liste geleert.

**Betrachtete Alternativen.** Die Felder im Code weiterführen (tote
Pflichtwerte, die niemand mehr braucht); den Riegel per Notschalter
überspringen (verdeckt jede andere Abweichung im selben Lauf).

**Erstmals genutzt** beim Ausbau des Drei-Aufruf-Wegs (4.9.0): drei Felder und
der Satz `t1-drei-call`, geleert am 10.09.2026 nach dem Deploy.

**Neubewertung**, wenn der Abgleich künftig mehr als die Pflichtfelder prüfen
soll (z. B. Wertebereiche je Satz) — dann gilt die Duldung auch dort.

## Nachtrag ohne Browser-Test (16.09.2026)

**Lage.** Nach jeder Auslieferung folgt ein Nachtrag-PR: neue Cache-Kennung in
den Seiten, `public/build-info.json`, Versionszeile im CHANGELOG,
Prüfstand-Stempel. Sein Inhalt ist zu diesem Zeitpunkt schon live und mit
`scripts/pruefe-live.sh` gegen den Quelltext nachgerechnet. Der Browser-Test
lief trotzdem voll — gut zehn Minuten über Dateien, die sich von der geprüften
Fassung nur in Cache-Kennungen unterscheiden.

**Entscheidung.** `scripts/nur-nachtrag.sh` erkennt einen solchen PR im
Pflicht-Job `playwright-version`; der Job `test-e2e` entfällt dann als Ganzes
und steht auf „skipped“. „Ja“ nur, wenn jede geänderte Datei eine geänderte
gewöhnliche Datei ist (Status M, Modus 100644 vorher und nachher) und eine von
vier Arten: CHANGELOG, `docs/VERIFICATION.md`, ein Fingerabdruck mit allen
Pflichtfeldern, der nur vorhandene Dateien nennt, oder eine Seite aus der
Kennungs-Liste von `deploy.sh`, die sich ausschließlich in `?v=<10 Ziffern>"`
unterscheidet. Alles andere ist „nein“; ein technischer Fehler (Basis fehlt,
git scheitert) lässt den Pflicht-Job scheitern und blockiert den PR.
`test-backend`, `test-frontend`, `pruefungen` und `secret-scan` laufen
unverändert, auf `main` und im Zeitplan auch der Browser-Test.

**Warum „skipped“ und nicht „success“.** Der Branch-Schutz lässt einen
übersprungenen Pflicht-Check durch. `scripts/deploy.sh` und die Baum-Regel
verlangen dagegen wörtlich `success` — ein übersprungener Browser-Test kann so
nie als bestanden in eine Auslieferung einfließen. Die erste Fassung übersprang
nur die Schritte und meldete `success`; die unabhängige Prüfung hat das
gefunden.

**Betrachtete Alternativen.** Pfadfilter in `on: pull_request` (prüft nicht,
ob sich in einer Seite mehr als die Kennung ändert); den Nachtrag direkt auf
`main` schreiben (der Hauptzweig ist geschützt, auch für Verwaltende); die
Versionszeile vor dem Deploy in den Feature-PR nehmen (der Auto-Release würde
eine Fassung verkünden, die noch nicht live ist).

**Geprüft durch** `functions/src/__tests__/nur-nachtrag-script.test.js`
(25 Fälle in Wegwerf-Repositorys, darunter Submodul-Zeiger, auch ein per
`.gitmodules` ausgeblendeter, Symlink, Rechte-Änderung, Dateiname mit
Zeilenumbruch, Ziffern hinter `?v=` im Code, unvollständiger Fingerabdruck;
Driftwächter gegen die Kennungs-Liste in `deploy.sh`). Rückbauprobe
16.09.2026 je Prüfung rot (Modus 3, Kennungsform 3, Dateiliste des
Fingerabdrucks 1, ausgeblendete Submodule 1, Auslieferungszeit 1).
Unabhängige Prüfung am selben Tag: drei mittlere Befunde (übersprungener Test
als `success`, von einer Pipe verschluckte git-Fehler, Ziffern hinter `?v=` als
Code) und kleinere, alle vor dem Merge behoben und nachgeprüft.

**Neubewertung**, wenn der Nachtrag weitere Dateiarten bekommt, wenn eine Seite
die Cache-Kennung anders als über `?v=<10 Ziffern>"` trägt, wenn GitHub
übersprungene Pflicht-Checks anders behandelt, oder wenn ein Fehler auftritt,
den nur der Browser-Test in einem Nachtrag gefunden hätte.
