# Feature-Flag-Register

Laufzeit-Feature-Flags liegen im Firestore-Dokument **`featureFlags/current`** und
werden von `functions/src/feature-flags.js` gelesen: 30-Sekunden-Cache, fail-safe —
ist das Dokument nicht lesbar, gilt je Flag der Wert aus der Spalte „Fail-safe“.
Umlegen geht **ohne Deploy** über die Firestore-Console (auch vom Handy); Wirkung
nach spätestens ~30 s. Das ist das zentrale Betriebssicherheits-Element (siehe
[RUNBOOK.md](RUNBOOK.md), Rollback-Hebel).

## Firestore-Flags

| Flag | Typ | Soll live | Fail-safe | Owner |
|---|---|---|---|---|
| `useBeastAdsCall` | Zweiter, kleiner Mistral-Aufruf fuer die Beast-Werbung | `true` | `true` | Christoph Krieger |
| `useGemesseneDauer` | Wartezeit und Einlassgrenze aus der gemessenen statt der angenommenen Analysedauer (seit v4.2.0) | `true` | `false` (Dokument nicht lesbar); fehlt nur das Feld: `true` | Christoph Krieger |

> **`useGemesseneDauer` hat zwei Rueckfallwerte.** Fehlt nur das Feld, gilt `true`: Der
> Schalter waehlt zwischen zwei Rechenwegen, der gemessene ist der richtigere, und sein
> schlechtester Fall ist ohnehin `durchschnittsdauerSekunden` aus dem Einstellungssatz. Ist
> das ganze Dokument nicht lesbar, gilt `false` — dann kann auch die Messung nichts lesen,
> und der Fehlerfall soll keine Messung behaupten, die es nicht gibt (Code:
> `feature-flags.js`, catch-Zweig; Test: `feature-flags.test.js`). Bis 10.09.2026 stand
> hier "fail-safe `true`" — das galt nur fuer das fehlende Feld.

> **Stand 2026-08-21 (DOC-2026-08-20-09).** Die Spalte „Soll live" trug zuvor fuer
> `useSprachumschalter` noch `false` — den Stand von der Vorbereitung am 13.08., obwohl
> derselbe Text weiter unten den Umschalter seit v3.3.0 als live beschreibt. `useLiveText`
> und `useBeastAdsCall` fehlten ganz, obwohl `feature-flags.js` sie liest. Ein Register,
> das den Live-Zustand falsch angibt, ist als Wiederherstellungs-Quelle unbrauchbar: Wer
> nach einem Zwischenfall „auf Soll" zuruecksetzt, schaltet damit Funktionen ab.
> Der Live-Zustand ist an der Quelle gemessen (Firestore `featureFlags/current`), nicht
> aus dem Code geschlossen.

### `useQueue` — ENTFERNT mit v2.10

Das Flag schaltete zwischen der Warteschlange und dem synchronen
`/analyze`-Pfad. Mit dem Abbau dieses Pfads ist es gegenstandslos und aus dem
Code entfernt; ein eventuell noch vorhandener Firestore-Eintrag wird nicht mehr
gelesen und kann gelöscht werden.

Das damals notierte Entfernungs-Kriterium — „entfällt, wenn der synchrone Pfad
abgebaut wird" — ist damit erfüllt.

### `useSingleLargeCall` — ENTFERNT (10.09.2026)

Das Flag schaltete zwischen dem Ein-Aufruf-Weg und dem älteren Drei-Aufruf-Weg
(Large beschreibt, `mistral-small` profiliert). Der Drei-Aufruf-Weg ist ausgebaut;
das Flag wird nicht mehr gelesen, ein vorhandener Firestore-Eintrag ist wirkungslos
und wird entfernt.

Das notierte Entfernungs-Kriterium — „entfällt, wenn die 3-Call-Pipeline abgebaut
wird“ — ist damit erfüllt.

### `usePromptCache` — FEST EINGEBAUT (10.09.2026)

Seit v2.5 schickt der Analyse-Aufruf einen `prompt_cache_key` mit und stellt dafür
den Nachrichten-Aufbau um: statischer Anweisungstext als `system`-Message, Bild
getrennt in `user`. Reine Kostenmaßnahme — Modell, Ausgabequalität und Laufzeit
bleiben unverändert. Das Entfernungs-Kriterium („dauerhaft > 50 % Treffer") ist
erfüllt (unter Last 59–71 %, 01.09.2026; 77 % am 30.08.2026). Seit 10.09.2026 ist
der Aufbau fest, der Rückfallweg ohne Cache und das Flag sind entfernt; ein Eintrag
im Dokument wirkt nicht mehr.

**Warum der Aufbau so sein muss** (an der echten API gemessen, wechselnde Bilder):

| Aufbau | Cache-Treffer |
|---|---|
| `user[ text, bild ]` (Stand bis v2.4) | 0 % |
| `system(text)` + `user[ bild ]` | 82–100 % |
| `user[ text ]` + `user[ bild ]` | 0 % |

Mistral cacht einen multimodalen `content`-Array nur als Ganzes. Da das Bild pro
Anfrage wechselt, fällt ohne den Rollenwechsel der komplette Präfix aus dem Cache.

**Erfolgskontrolle:** `cachedTokens` in jeder `mistral-single-large`-Logzeile.

### `useLiveText` — FEST EINGEBAUT (10.09.2026)

Seit v3.0 liest der Worker die Mistral-Antwort als Strom mit und legt die bereits
angekommenen Profiltexte ins Job-Dokument, damit der wartende Browser sie zeigt.
Das Flag stand seither dauerhaft an; als Schalter konnte es nur noch bei einer
Datenbank-Störung still auf „aus" springen. Seit 10.09.2026 fest, Flag entfernt. Im
Emulator läuft der Datenstrom ebenfalls immer (`QUEUE_LOCAL_LIVE` entfällt).

## Weitere Betriebsschalter (kein `featureFlags`-Feld)

| Schalter | Ort | Zweck |
|---|---|---|
| Wartungsmodus | Firestore `config/maintenance`, geschaltet über `/api/admin/maintenance` | Kill-Switch: Seite kontrolliert aus dem Betrieb nehmen (Wartungs-Dialog). Normalzustand: aus. |

## Entwicklungs-Schalter (Umgebungsvariablen, niemals in Produktion)

| Variable | Zweck |
|---|---|
| `QUEUE_LOCAL=1` | Emulator-Modus: Shims ersetzen Cloud Tasks (direkter HTTP-Dispatch) und den GCS-Bucket (Dateisystem). Siehe [QUEUE-EMULATOR.md](QUEUE-EMULATOR.md). |
| `QUEUE_LOCAL_CONCURRENCY` | Parallelität im Lokal-Modus (Default 3). |
| `MISTRAL_MOCK=1` | Mistral-Attrappe statt echter API (kostenlose Tests, Emulator-Durchklick). |

## Regeln

- Jedes neue Flag wird **hier registriert** (Name, Typ, Zweck, Owner, Default,
  Entfernungs-Kriterium) — im selben Change, der das Flag einführt.
- Ein Flag, dessen Feature stabil ist und dessen Entfernungs-Kriterium erfüllt ist,
  wird samt totem Code entfernt; das Entfernen ist Teil der Feature-Arbeit.
- Abgelaufene Flags gelten im Audit als Finding (Entscheidung siehe
  [ADR-0001](adr/0001-grundentscheidungen.md)).
- Feature-Flags sind kein Ersatz für Autorisierung und kein Versteck für Secrets.

### `useBeastAdsCall` — Notausschalter fuer den zweiten Mistral-Aufruf

Neu mit dem Audit 2026-08-10 (OPS-009). Seit v2.8 macht jede Analyse **zwei**
Mistral-Aufrufe: die Bildanalyse und einen zweiten, kleinen Aufruf ohne Bild für
die Beast-Werbung. Das verdoppelt die Anfragen pro Minute — und bis zum Audit
gab es keinen Weg, den zweiten Aufruf ohne Deploy stillzulegen.

- **Fehlt das Feld, ist der Aufruf AN.** Das ist der Normalbetrieb.
- **Auf `false` gesetzt** entfällt der Zweitaufruf. Die Werbeliste aus dem
  Hauptaufruf bleibt stehen — die Analyse läuft unverändert, nur die
  Beast-Werbung klebt wieder an der Produktwelt des Fotos statt an der
  Schwachstelle (Überlappung 41 % statt 11 %).
- **Wann ziehen:** wenn die Anfragen pro Minute knapp werden (429-Fehler unter
  Stoßlast). Wirkt nach ~30 s Cache, kein Deploy.
- **Entfernungs-Kriterium:** sobald die Anfragerate dauerhaft unkritisch ist —
  dann Flag und Zweig entfernen.

### `useSprachumschalter` — FEST EINGEBAUT (10.09.2026)

Zeigt auf allen Seiten den DE/EN-Umschalter (rechts oben). Das Flag stand seit
v3.3.0 dauerhaft an; als Schalter konnte es nur noch eines: den Umschalter
verschwinden lassen, wenn `/api/stats` oder die Datenbank kurz nicht antwortet.
Seit 10.09.2026 entsteht er immer, unabhängig von der Server-Antwort; Flag und
das Feld `sprachumschalter` in `/api/stats` sind entfernt. Die englische Fassung
war davon nie abhängig (`?lang=en`, Gerätesprache). Die frühere Erprobungs-Tür
(Adress-Anhängsel, Konsolen-Aufruf, `localStorage`-Spur) ist seit v3.3.1 entfernt.

**Verhalten beim Umschalten:** Auf der leeren Seite sofort. Läuft eine Analyse
oder liegt ein Profil vor, kommt erst eine Rückfrage — in der aktuellen
Sprache, damit „Abbrechen" wirklich nichts hinterlässt. Bestätigt jemand,
startet dieselbe Datei eine neue Analyse (`state.lastFile` liegt noch im
Browser); der alte Auftrag läuft ins Leere und wird vom Aufräumer eingesammelt.
Es gibt bewusst **keinen** Weg, einem laufenden Auftrag nachträglich eine
andere Sprache zu geben — das spart einen Endpunkt samt Ticket-Prüfung,
Transaktion und Missbrauchsdeckel und kostet dafür eine verworfene Analyse.
