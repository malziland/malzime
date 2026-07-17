# Queue-Architektur lokal testen (Firebase-Emulator)

Diese Anleitung beschreibt, wie die Queue-Architektur (v2.0) komplett lokal
läuft — für den Durchklick der Warteschlangen-UX und kostenlose Mock-Lasttests.
Es entstehen **keine Kosten**: Mistral ist im Emulator durch eine Attrappe
ersetzt, es gibt keine echten API-Aufrufe.

## Voraussetzungen

- **Java** (für den Firestore-Emulator) — `java -version` muss etwas ausgeben.
- **firebase-tools** — `firebase --version` muss etwas ausgeben.

## Starten

Im Projekt-Wurzelverzeichnis:

```
npm run emulator
```

Das startet Functions-, Firestore-, Hosting- und Pub/Sub-Emulator. Warten bis
`All emulators ready` erscheint. Adressen:

| Emulator    | Adresse               |
| ----------- | --------------------- |
| Hosting     | http://localhost:5050 |
| Emulator-UI | http://localhost:4000 |
| Functions   | http://localhost:5001 |
| Firestore   | http://localhost:8080 |

## Was im Lokal-Modus anders ist

`functions/.env.local` setzt `QUEUE_LOCAL=1` und `MISTRAL_MOCK=1` (Datei ist
un-getrackt — einmalig anlegen per `cp functions/.env.local.example functions/.env.local`). Damit:

- **Mistral** ist eine Attrappe — vorgefertigte `[MOCK-PROFIL]`-Profile,
  konfigurierbare Verzögerung (`MISTRAL_MOCK_DELAY_MS`). Keine Kosten.
- **Cloud Tasks** (hat keinen Emulator) wird ersetzt: `enqueue` stößt
  `processJob` direkt per HTTP an.
- **Storage** läuft über ein Temp-Verzeichnis statt über den GCS-Bucket.
- Das Feature-Flag `useQueue` gilt als **an** — der Emulator dient ja gerade
  dem Queue-Test.

`firebase deploy` ignoriert `.env.local` — die Produktion ist davon nie betroffen.

## Durchklick (Warteschlangen-UX)

1. Browser öffnen: **http://localhost:5050**
2. Ein Foto hochladen. Bei leerer Queue startet die Analyse sofort; nach der
   Mock-Verzögerung (~8 s) erscheint das Profil.
3. **Crowd simulieren** — in einem zweiten Terminal die Queue füllen:
   ```
   node functions/scripts/queue-emulator-loadtest.js 30
   ```
   Währenddessen im Browser ein Foto hochladen → die Warteschlangen-Anzeige
   zeigt jetzt eine echte **Position** und Restzeit, die herunterzählt.
4. **Abbruch + Wiederkehr testen:** Während des Wartens die Seite neu laden
   (Cmd/Strg+R). Das Polling wird fortgesetzt, das Ergebnis erscheint trotzdem.

## Mock-Lasttest

```
node functions/scripts/queue-emulator-loadtest.js 50
node functions/scripts/queue-emulator-loadtest.js 100
node functions/scripts/queue-emulator-loadtest.js 200
```

Das Skript reiht N Jobs ein, wartet bis alle terminal sind und meldet, ob
einer verloren ging. Kostenlos, beliebig wiederholbar.

## Stoppen

`Strg+C` im Emulator-Terminal.
