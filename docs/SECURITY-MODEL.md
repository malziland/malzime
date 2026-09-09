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
8. **Nicht-personenbezogene Logs liegen weiter auf Standort `global`.**
   (Rest von `PRIV-2026-08-12-12`) Die Standard-Log-Ablage von Google Cloud
   (`_Default`) ist fest auf `global` und lässt sich nicht nach Europa
   verschieben. Behoben ist der personenbezogene Teil: Cloud-Run-Request-Logs
   sind der einzige Träger von Client-IP-Adressen und werden vollständig
   ausgeschlossen (`exclude_run_requests_ip`, vom Deploy-Riegel bewacht, inkl.
   Filterinhalt). *Was bleibt:* Programmausgaben der Functions und
   Zeitplan-Läufe, ohne Personenbezug, **eine** Aufbewahrungstag lang.
   *Verworfene Alternative:* die `_Default`-Senke auf einen EU-Speicher
   umhängen — dann findet `gcloud logging read` ohne zusätzliche Angaben nichts
   mehr, und jedes Störungsrezept im RUNBOOK liefert stillschweigend eine leere
   Antwort statt eines Fehlers. Genau die Ausfallform, gegen die dieses Projekt
   sonst überall anschreibt.
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

Die dritte Zeile ist die Lehre aus einem eigenen Fehler: Nach dem Einbau des
Netzes meldete der Code weiterhin 169 Mal „Kostenbremse inaktiv", obwohl das
Netz jedes Mal korrekt entschieden hatte. Ein Alarm, der im Normalbetrieb
feuert, macht den Ernstfall unauffindbar.

### Was das im Betrieb bedeutet

Die Kostenbremse hält auch unter Last, weil Zähler und Netz denselben Stand
lesen. Was jeder Betreiber trotzdem wissen muss: Die **erste** Grenze gegen
Kosten ist die Warteschlangen-Rate (`queueRatePerSekunde`, heute 0,125
Aufträge je Sekunde ≈ 450 Analysen je Stunde) — sie liegt unter dem
Stundenlimit. Wer die Rate anhebt, hebt diesen Deckel mit an und macht das
Stundenlimit zur einzigen Bremse. Fällt die Bremse *doch* einmal komplett
aus — Zähler und Netz zugleich —, kommt eine Meldung auf beiden Kanälen
(`alert: notbremse-fehlgeschlagen`, Text „Weder Zaehler noch Notbremse
verfuegbar — KEINE Kostenbremse aktiv"). Im Netz-Fall geht die
Push-Nachricht mit dem Boost-Knopf je Instanz höchstens einmal je fünf
Minuten hinaus; bei bis zu zehn Einlass-Instanzen sind das bis zu zehn
Nachrichten je fünf Minuten.

**Restrisiko, das bleibt:** Im Netz-Fall schreibt niemand den Zeitstempel
des eingelassenen Auftrags — die Transaktion ist ja gerade gescheitert. Jeder
Netz-Fall fehlt damit im Fenster, und zwar kumulativ: Klemmt der Zähler über
eine ganze Andrangswelle, zählt das Fenster nur die Aufträge, deren
Transaktion durchkam. Das Netz blockiert dann später, als es sollte. Wie groß
diese Lücke im echten Betrieb ist, steht nach dem nächsten Workshop im Log
(`netz-hat-uebernommen` zählen). Ein nachträgliches Schreiben ohne
Transaktion wäre die Abhilfe, erhöht aber die Kontention auf demselben
Dokument — nur mit Simulator-Messung einbauen.

Messwerte nach der Reparatur vom 30.08.2026 (Emulator, 170 gleichzeitige
Anfragen, Stand vor dem Netz-Umbau vom 01.09.; mit dem neuen Netz nicht
nachgemessen):

```
Ausfälle der Bremse      206  ->  0
Sperr-Konflikte          225  ->  0
Antwortdauer (75 %)   54.000 ms -> 6.800 ms
abgerissene Verbindungen  94  ->  0
```

## Ein Ausrutscher der Datenbank ist kein Alarm (07.09.2026)

**Entscheidung.** Kann eine Function den Einstellungssatz (`config/betriebsprofil`)
gerade nicht lesen — Zeitlimit, Verbindung, kurze Störung —, protokolliert
`betriebsprofil.js` das als WARNING, nicht als ERROR. Der Aufräumer, der jede
Minute liest, alarmiert erst, wenn zwei Läufe hintereinander ohne Betriebswerte
bleiben. Ein fehlendes, unbenanntes oder abgelehntes Dokument bleibt sofort ERROR.

**Begründung.** Am 07.09.2026 um 17:37 löste ein einzelner träger Zugriff zwei
Alarme aus (E-Mail und Push), obwohl der Lauf eine Minute später gesund war und
kein Mensch betroffen. Ein Alarm, der nichts bedeutet, kostet das Vertrauen in die
Alarme, die etwas bedeuten — und in einem Workshop entscheidet dieses Vertrauen,
ob jemand hinschaut. Ein Lesefehler heilt sich beim nächsten Aufruf von selbst
(der Cache hält Fehlschläge nicht fest); ein kaputtes Dokument nicht — deshalb
die Trennung nach Grund, nicht nach Ort.

**Betrachtete Alternative.** Das Zeitlimit von zwei Sekunden anheben. Verworfen:
Das Limit sitzt im Analysepfad, und jede Sekunde mehr wäre eine Sekunde, die
JEDE Analyse im Störungsfall länger hängt. Ein eigener zweiter Leseversuch je
Abfrage: verworfen — jede der fünf Abfragen eines Aufräumer-Laufs liest ohnehin
neu (der Cache hält Fehlschläge nicht fest), ein träger Lauf kostet also schon
bis zu fünfmal zwei Sekunden; ein weiterer Versuch verlängerte nur das, und der
nächste Lauf kommt ohnehin 60 Sekunden später.

**Was weiterhin alarmiert.** Jede Analyse, die ohne Betriebswerte abbricht
(`kein-einstellungssatz` in `handle-process-job.js`), zwei Aufräumer-Läufe in
Folge (`betriebswerte-wiederholt-nicht-lesbar`), jedes kaputte Dokument. Ein
Dauerausfall von Firestore fällt damit spätestens nach zwei Minuten auf.

**Bedingung für Neubewertung.** Warnungen `reap-query-ohne-betriebswerte` in
mehr als drei verschiedenen Minuten eines Tages, also in mehr als drei Läufen
(Abfrage im RUNBOOK; ein einzelner träger Lauf erzeugt bis zu fünf Warnungen
in derselben Minute und zählt einmal) — dann ist es kein Ausrutscher mehr,
sondern ein Muster, und die Ursache gehört gesucht, nicht die Schwelle
verschoben.

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
`public/js/exif.js` entfernen, CSP-Eintrag zurücknehmen.

## Schnittstellen direkt am EU-Server, nicht über das Auslieferungsnetz (09.09.2026)

**Was war.** Alle Aufrufe des Browsers an `/api/…` liefen über Firebase Hosting.
Hosting ist ein weltweites Auslieferungsnetz (Fastly); der Standort-Inventar-Lauf
vom 09.09.2026 maß den Transit über einen Knoten in Wien. Damit passierte auch
das komprimierte Foto einen Knoten dieses Netzes, bevor es den Server in Belgien
erreichte — ohne Speicherung (`cache-control: no-cache`), aber als Umweg, den
die Zusage „alles auf EU-Servern" nicht kennt. Der Eigentümer hat entschieden:
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

