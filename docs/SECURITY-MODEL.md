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
| Kostenangriff (massenhafte Analysen) | möglich | Stundenlimit 500/h (global, Firestore), Queue-Tiefe 155, 35-min-Job-Höchstalter |
| Störangriff auf einen Workshop | möglich, bisher nie beobachtet | dieselben Limits + Boost/Reset-Hebel; Restrisiko akzeptiert (s. u.) |
| Bots / Scanner-Rauschen | täglich | Honeypot, Timing-Check, IP-Rate-Limit, Magic-Byte-Validierung |
| Prompt Injection über Bildinhalte | strukturell | XML-Isolation, escapeXml, Output-Clamps; LLM-Ausgaben steuern keine Tools |
| Admin-Missbrauch / Replay | gering | HMAC-Token (30 min) + Einmal-Nonce (5 min, fail-closed seit v3.0.4), Bearer-Secret |
| Fehlkonfiguration der Cloud | schleichend | `scripts/verify-infrastructure.sh` vor jedem Deploy (nur lesend, CI-erzwungen) |

## Schutzschichten (Kurzreferenz)

- **Client:** EXIF/GPS bleiben im Browser (Canvas-Recompress entfernt Metadaten);
  Nominatim/OSM ruft der Browser direkt — der Server sieht nie GPS.
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
   Kostenentscheidung des Inhabers, kein technisches Versäumnis.

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
