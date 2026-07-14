# Feature-Flag-Register

Laufzeit-Feature-Flags liegen im Firestore-Dokument **`featureFlags/current`** und
werden von `functions/src/feature-flags.js` gelesen: 30-Sekunden-Cache, fail-safe —
ist das Dokument nicht lesbar, gelten alle Flags als `false` (der bewährte Pfad).
Umlegen geht **ohne Deploy** über die Firestore-Console (auch vom Handy); Wirkung
nach spätestens ~30 s. Das ist das zentrale Betriebssicherheits-Element (siehe
[RUNBOOK.md](RUNBOOK.md), Rollback-Hebel).

## Firestore-Flags

| Flag | Typ | Soll live | Fail-safe | Owner |
|---|---|---|---|---|
| `useQueue` | Operations-/Kill-Switch | `true` | `false` | Christoph Krieger |
| `useSingleLargeCall` | Architektur-Schalter (Kill-Switch-Funktion) | `true` | `false` | Christoph Krieger |

### `useQueue` (seit v2.0)

Schaltet zwischen der Queue-Architektur (`true`: Upload → Cloud Tasks → dosierte
Verarbeitung) und dem synchronen `/analyze`-Pfad (`false`). Der synchrone Pfad
bleibt bewusst als Rückfall im Code.
**Entfernungs-Kriterium:** entfällt erst, wenn der synchrone Pfad abgebaut wird
(„Phase 6" — nur mit ausdrücklicher Freigabe des Inhabers). Bis dahin ist das ein
gewollter Dauer-Betriebsschalter, kein abgelaufenes Flag.

### `useSingleLargeCall` (seit v2.2)

Schaltet innerhalb der Queue-Pipeline zwischen Single-Large-Call (`true`: ein Aufruf
an `mistral-large` liefert Beschreibung + beide Profile) und der 3-Call-Pipeline
(`false`: Large beschreibt, `mistral-small` profiliert). Wird nur ausgewertet, wenn
die Queue an ist.

> ⚠️ **Nie allein umlegen!** Die 3-Call-Pipeline verträgt wegen des knappen
> Small-Modell-Limits (100K Tokens/min) nur Cloud-Tasks-Concurrency 3. Beim
> Zurückschalten immer das 3-Schritt-Rezept aus dem
> [RUNBOOK](RUNBOOK.md#3-single-large-call-aus--immer-alle-drei-schritte) befolgen
> (Flag + `cloudtasks-concurrency-3.sh` + `config.js`-Werte).

**Entfernungs-Kriterium:** entfällt erst, wenn die 3-Call-Pipeline abgebaut wird
(„Phase 6" — nur mit ausdrücklicher Freigabe des Inhabers).

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
- Abgelaufene Flags gelten im Audit als Finding. Die beiden Firestore-Flags oben
  sind davon ausgenommen, solange ihr jeweiliger Fallback-Pfad bewusst im Code
  bleibt (Entscheidung siehe [ADR-0001](adr/0001-grundentscheidungen.md)).
- Feature-Flags sind kein Ersatz für Autorisierung und kein Versteck für Secrets.
