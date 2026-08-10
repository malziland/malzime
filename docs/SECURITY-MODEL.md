# Sicherheits- und Datenmodell (Skizze)

Referenz für Entwicklung und Audits: Was ist schützenswert, wo verlaufen die
Vertrauensgrenzen, welche Missbrauchsfälle sind bedacht, was wird wie lange
aufbewahrt. Das ist eine Arbeits-Skizze, kein vollständiges Threat Model und keine
Rechtsberatung — die Tiefenprüfung übernehmen die Audits, die für Nutzer maßgebliche
Erklärung ist die [Datenschutzerklärung](../public/datenschutz.html). Technische
Details: [ARCHITECTURE.md](ARCHITECTURE.md) (Abschnitte Sicherheits- und
Privacy-Architektur). Stand: 2026-08-10.

## Schutzgüter (Assets)

- **Hochgeladene Fotos** — potenziell von Kindern und Jugendlichen (Zielgruppe
  Schul-Workshops). Nur transient, siehe Aufbewahrung.
- **Analyse-Ergebnisse** (fiktive Profile) — kurzlebig, ticket-geschützt.
- **Secrets:** `MISTRAL_API_KEY`, `ADMIN_SECRET`, `NTFY_*` — als Firebase Secrets
  hinterlegt, nie im Repository.
- **Verfügbarkeit während Workshops** (Stoßlast von 25+ Uploads in Minuten).
- **Kostenbudget** (jede Analyse kostet echte KI-Tokens).
- **Integrität von Marke und Seite** (öffentliches Repo: MIT-Code, Markenmaterial
  ausgenommen — siehe `TRADEMARKS.md`).

## Rollen

- **Anonyme Nutzer:** keine Konten, keine Cookies, kein Login. Jeder kann hochladen
  (innerhalb der Limits).
- **Inhaber/Admin:** HMAC-Token-geschützte Admin-Endpunkte (Boost, Reset,
  Wartungsmodus) mit Nonce-Bestätigung.
- **CI (GitHub Actions):** nur Test/Lint/Scan; besitzt keine Cloud-Zugänge —
  Deploys laufen ausschließlich lokal durch den Betreiber.
- **Cloud Tasks → `processJob`:** OIDC-geschützter Service-Aufruf, nicht öffentlich
  erreichbar.

## Datenflüsse und Vertrauensgrenzen

| Fluss | Inhalt | Grenze / Regel |
|---|---|---|
| Browser → Functions | komprimiertes Bild (max. 1280 px), Kamera-Make/Model, Sprache | **Kein GPS, kein Aufnahmedatum** — beide verlassen den Browser nie |
| Browser → Nominatim (direkt) | GPS-Koordinaten fürs Reverse-Geocoding | läuft bewusst am eigenen Server vorbei |
| Functions → Mistral AI (Paris, EU-Default) | Bild + Prompts | Modellantworten gelten als **nicht vertrauenswürdig**: JSON-Repair, Schema, Output-Bounds (max. 800 Zeichen/Kategorie), steuern keine Tools |
| Functions → Firestore / Cloud Tasks / GCS (`europe-west1`) | Jobs, Zähler, temporäres Bild | Bucket nur via Admin-SDK, nie browsererreichbar |
| Functions → ntfy | Betriebsmeldungen (Limit, Fehler-Alarm) | ohne personenbezogene Daten |

Wesentliche Grenzen: Client vs. Server · öffentlich vs. OIDC (`processJob`) ·
Nutzer vs. Admin (HMAC + Nonce) · Anwendung vs. Mistral (untrusted Antworten) ·
CI vs. Laufzeit (CI ohne Cloud-Rechte).

## Missbrauchsfälle und Gegenmaßnahmen

| Missbrauchsfall | Gegenmaßnahmen |
|---|---|
| Bot-Massen-Uploads / Kostenexplosion | IP-Rate-Limit (500/10 min), Honeypot + Timing-Check, Stundenlimit 500 (rollend), Cloud-Tasks-Concurrency-Deckel, Budget-Alarm (extern) |
| Prompt-Injection über Bildinhalte/sichtbaren Text | User-Daten in XML-Tags isoliert + `escapeXml()`, JSON-Schema, defensiver JSON-Repair, Output-Bounds; LLM-Ausgaben steuern keine Tools oder Folgeprozesse |
| Upload fremder/heikler Fotos | Datenschutz-Hinweis direkt am Upload-Bereich (neu 2026-07) + Nach-Analyse-Warnung vor ungewollt preisgegebenen Bilddetails (PRIV-002), Kinderschutz-Härtung in den Prompts (DE + EN immer parallel pflegen) + **serverseitiges Netz `minor-safety.js`** vor der Auslieferung, keine Persistenz über 2 h hinaus |
| Ergebnis-Abgriff durch Dritte | Abhol-Ticket (PRIV-003): Job-Status und Ergebnis nur mit Ticket; Ticket lebt im Tab (`sessionStorage`) und stirbt mit ihm |
| Admin-Missbrauch / Replay | HMAC-signierte Tokens, Nonce-Replay-Schutz, GET zeigt nur Bestätigungsseite, erst POST mutiert |
| Scanner / automatisiertes Probing | ungültige Anfragen enden als 4xx ohne Schaden; Einordnungs-Rezept im [RUNBOOK](RUNBOOK.md) |
| Kompromittierte Abhängigkeiten (Supply Chain) | committete Lockfiles, Audit-Gate in CI (`scripts/audit-gate.mjs`, High/Critical blockieren; Ausnahmen nur begründet und mit Ablaufdatum), Dependabot-Alerts + Security-Updates + Auto-Merge nur patch/minor, Actions auf Commit-SHAs gepinnt, gitleaks-Secret-Scan |
| Hochgeladenes Nicht-Bild / manipulierte Datei | MIME- + Magic-Byte-Validierung, Größenlimits |

## Aufbewahrung und Löschung

| Datum | Ort | Dauer |
|---|---|---|
| Hochgeladenes Bild (komprimiert) | GCS-Bucket `malzime-queue-uploads` | nur Wartezeit in der Queue; **aktive Löschung direkt nach der Analyse**; Lifecycle-Regel (1 Tag) als Sicherheitsnetz |
| Job-Dokument + Ergebnis | Firestore `jobs` | max. **2 h** (Reaper), ticket-geschützt |
| Zähler / Statistik | Firestore | aggregiert, ohne Personenbezug |
| Infrastruktur-Logs (IP-haltig) | Cloud Logging `_Default` | **1 Tag** (bewusst kurz — nicht verlängern) |
| Anonyme Diagnose-Logs | Cloud Logging `client-diagnostics` | 30 Tage (nur Fehler-/Telemetrie-Klassen, keine PII) |
| Im Browser | `sessionStorage` (Abhol-Ticket) | bis zum Schließen des Tabs; das Foto selbst wird nach einem Neuladen bewusst **nicht** wiederhergestellt |

## Privacy-Notiz (Skizze)

- **Zweck:** Medienkompetenz-Bildung — zeigen, was Algorithmen aus einem Foto
  behaupten könnten. Alle Profile sind fiktiv; nichts davon ist wahr.
- **Datenminimierung:** EXIF wird client-seitig extrahiert; zum Server gehen nur
  komprimiertes Bild + Kamera-Make/Model. Keine Konten, keine Cookies, kein
  Tracking, keine externen Scripts, keine IP-Persistenz in Anwendungs-Logs.
- **Empfänger / Auftragsverarbeitung:** Google Ireland Ltd. (Firebase-Infrastruktur,
  `europe-west1`), Mistral AI SAS (Paris; Sub-Prozessoren siehe Mistral Trust
  Center), OpenStreetMap/Nominatim (nur direkt vom Browser), ntfy (nur
  Betriebsmeldungen).
- **Maßgebliche öffentliche Fassung:** die
  [Datenschutzerklärung](../public/datenschutz.html) (inkl. Rechtsgrundlagen);
  dieses Dokument ist die technische Innensicht dazu.

## Sicherheitsausnahmen

Bewusst akzeptierte Restrisiken sind in [SECURITY.md](../SECURITY.md) (Abschnitt
„Known Accepted Risks") dokumentiert — z. B. In-Memory-Rate-Limit pro Instanz und
Fail-open des Zählers bei Firestore-Ausfällen. Darüber hinaus gibt es derzeit
**keine** offenen Verifikations-Ausnahmen. Neue Ausnahmen nur dokumentiert mit
Begründung, Owner und Ablaufdatum — hier eingetragen und im nächsten Audit geprüft.

## Externe Kontrollen (außerhalb des Repos)

Branch Protection mit Pflicht-Checks, aktivierte Dependabot-Alerts, GCP-Budget-Alarm
und der ntfy-Fehleralarm liegen außerhalb des Repositories. Sie werden hier nur
benannt; ob sie tatsächlich greifen, ist im Audit extern zu verifizieren (nicht aus
dem Repo-Inhalt ableitbar).


## Serverseitige Netze über der Modellausgabe

Ergänzt 2026-08-10 (Audit, DOC-001). Beide Netze fehlten hier bislang — mit der
Folge, dass ein späterer Umbau sie hätte entfernen können, ohne dass ein
Dokument widerspricht.

### `minor-safety.js` — unzulässige Werbung

Prüft das fertige Profil, bevor irgendetwas ausgeliefert wird. Zwei Stufen:

- **Immer entfernt, unabhängig vom geschätzten Alter:** Pornografie und
  Sexarbeit, Waffen und Munition, Extremismus. Begründung: Die Altersschätzung
  ist unzuverlässig, und in einem Werkzeug fürs Klassenzimmer haben diese
  Inhalte auch bei Erwachsenen nichts verloren.
- **Nur bei erkennbar Minderjährigen:** Glücksspiel, Kredit, Alkohol und Tabak,
  Schönheitskorrektur, Diätmittel. Bei Erwachsenen sind sie legitimer
  Lerninhalt — wie diese Branchen Menschen adressieren, IST das Thema.

Maßgeblich ist die **Untergrenze** der Altersspanne plus drei Jahre
Sicherheitsabstand (`SCHUTZ_BIS`), nicht der Punktwert. Grund: Mädchen werden in
der Praxis bis zu sechs Jahre zu alt geschätzt; eine harte 18er-Grenze nahm
ausgerechnet ihnen den Schutz.

**Grenzen, ehrlich benannt (Stand 2026-08-10):**

- Auf `profileText` und die Kategorie-Karten wird **nur protokolliert, nicht
  entfernt**. Ein herausgeschnittener Halbsatz macht den Text unlesbar, und der
  Profiltext ist die Stelle, an der die Aufklärung stattfindet. Treffer
  erscheinen als `durchgerutscht` in der Logzeile `step:"minor-safety"`.
- Auf die `manipulation_triggers` wirkt **nur** die harte Stufe. Die
  altersabhängige Liste würde dort genau die Aufklärung wegschneiden, um die es
  geht („Lootboxen arbeiten mit denselben Mechaniken wie Glücksspiel").
- Die Wortlisten sind zweisprachig, aber nicht vollständig. Sie fangen, was
  unzweifelhaft nicht zu Kindern gehört — nicht jede Umschreibung.
- Ist im Alterstext keine Zahl erkennbar, gilt die Person **nicht** als
  minderjährig (die harte Stufe greift trotzdem). Die Logzeile mit `alter: null`
  ist der Hinweis darauf.

Die Logzeile entsteht bei **jeder** Analyse, auch ohne Treffer — sonst wäre ein
systematischer Ausfall von „alles sauber" nicht zu unterscheiden.

### Entferntes Netz gegen „Tier als Mensch"

`pruefeTierWiderspruch` prüfte, ob das Modell `HUMAN` meldet und zugleich
Tiermerkmale beschreibt. Es ist am 2026-08-10 **ersatzlos entfernt** worden: Im
aktiven Pfad bekam es nicht die Bildbeschreibung zu sehen, sondern den daraus
erzeugten Profiltext — dadurch machte „Apex Legends" aus einem Jugendlichen ein
Tier, während es beim eigentlichen Anlassfall (Affenbild → Kleinkindprofil) nie
ansprang. Der Schutz liegt jetzt allein in der Prompt-Regel „Primaten sind immer
`ANIMAL_ONLY`", die in **beiden** Pfaden und **beiden** Sprachen steht und durch
`primaten-regel.test.js` festgehalten wird.

### Prompt-Injektion über Bildinhalt

Sichtbarer Text im Bild ist Bildinhalt, keine Anweisung. Der aktive
Single-Large-Prompt sagt das seit 2026-08-10 ausdrücklich (vorher stand die
Warnung nur im 3-Call-Pfad). Die Ausgabe-Netze greifen unabhängig davon.

### OFFEN: anonymes Schreiben am ntfy-Dienst (Audit SEC-005)

**Status: offen, nicht entschieden.** Wartet auf eine Angabe, die nur der
Inhaber machen kann.

Gemessen am 2026-08-10 gegen den laufenden Dienst:

| | Ergebnis |
|---|---|
| anonym lesen | HTTP 403 — verboten |
| anonym schreiben | HTTP 200 — erlaubt |
| `notify.js` | veröffentlicht ohne Anmeldedaten |

**Das Risiko:** Wer den Topic-Namen kennt, kann gefälschte Benachrichtigungen
mit eigenem Titel, Text und eigenen Aktions-Knöpfen schicken. Die echten
Meldungen enthalten Knöpfe („+100 Analysen") mit signierten Links — der Inhaber
ist also darauf trainiert, in einer ntfy-Nachricht auf einen Knopf zu tippen.
Mitlesen kann niemand; die ausgehenden Links sind nicht einsehbar. Die echten
Admin-Funktionen sind durch HMAC und Einmal-Nonce geschützt: Ein Klick auf einen
gefälschten Link führt woandershin, löst bei malziME aber nichts aus.

**Warum es noch nicht behoben ist:** Der ntfy-Dienst wird von mehreren Projekten
des Inhabers geteilt. `NTFY_AUTH_DEFAULT_ACCESS=deny-all` plus
Veröffentlichungs-Token würde jedes dieser Projekte betreffen — und welche das
sind, ist derzeit **nicht bekannt** (Stand 2026-08-10, auf Nachfrage). Eine
Umstellung ins Blinde würde deren Benachrichtigungen still verstummen lassen,
und eine ausbleibende Benachrichtigung sieht genauso aus wie „keine Fehler".

**Was zur Behebung fehlt:** die Liste der Projekte, die auf diesen Server
veröffentlichen. Danach: Token anlegen, überall nachtragen, jedes Projekt
einzeln testen, erst dann `deny-all` setzen.

**Zwischenzeitliche Entschärfung:** Das Topic ist seit der Rotation vom
2026-07-17 ein 30-stelliger Zufallswert. Die Erratbarkeit, die den Befund
ursprünglich begründet hat, ist damit weg — bleibt das Risiko, dass der Name
irgendwo durchsickert.
