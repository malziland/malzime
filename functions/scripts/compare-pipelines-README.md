# Pipeline-Vergleichstool (Forschung)

Lokales Skript zum Vergleich der aktuellen Live-Pipeline mit zwei
neuen V2-Architektur-Varianten — **ohne Production anzufassen**.

## Was es macht

Schickt jedes Bild aus `compare-input/` durch drei Pipelines parallel:

| Spalte | Pipeline | Karten-Modell |
|---|---|---|
| **A** | Heute live (1× Describe Large + 2× Profile Small) | mistral-small-2603 (im Profile-Call) |
| **B** | Neu V2 (1× Large-Bundle + 2× Karten + 2× profileText) | **mistral-small-2506** |
| **C** | Neu V2, Fallback-Variante | mistral-small-2603 |

Schreibt `compare-result.html` (in `.gitignore`) mit Side-by-Side-Output,
Token-/Kosten-Statistik pro Spalte und einer leeren Bewertungstabelle
(1–5) zum Selbst-Ausfüllen.

## Isolation gegenüber Production

- Nichts unter `functions/src/` wird verändert
- Keine Cloud-Functions, keine Firebase-Deploys, keine Firestore-Schreibungen
- Skript läuft rein lokal mit `node`
- Test-Prompts in `test-prompts-v2.js` sind komplett separat von den Live-Prompts in `functions/src/locales/de/prompts.js`
- Production-Pfad lädt `compare-pipelines.js` und `test-prompts-v2.js` **nicht**
- Rückbau: `git rm functions/scripts/compare-pipelines.js functions/scripts/test-prompts-v2.js compare-pipelines-README.md`

## Verwendung

### 1. Mistral-API-Key bereitstellen

```bash
export MISTRAL_API_KEY="..."
```

Oder direkt beim Aufruf inline.

Den Key findest du in Firebase Console → Project Settings → Service Accounts → Secret Manager → `MISTRAL_API_KEY`.

### 2. Testbilder ablegen

```bash
mkdir -p compare-input/
cp <bild1.jpg> <bild2.jpg> ... compare-input/
```

Empfohlene Auswahl (~8–10 Bilder, Workshop-typische Streuung):
- 2 Kinder (~6 und ~13 Jahre, beide Geschlechter)
- 2 Jugendliche (~16–19)
- 2 junge Erwachsene (~25–35)
- 2 mittlere Erwachsene (~40–55)
- davon mindestens 2 mit sichtbaren Logos/Marken

Unterstützte Formate: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`.

### 3. Starten

```bash
MISTRAL_API_KEY="..." node functions/scripts/compare-pipelines.js
```

Output:
- Console: pro Bild eine Zeile mit Tokens/Kosten je Pipeline
- `compare-result.html` im Repo-Root

### 4. Auswerten

```bash
open compare-result.html
```

Pro Bild siehst du:
- Beschreibungen aller drei Pipelines nebeneinander
- Mode "NORMAL" und Mode "BEAST" je in 3 Spalten
- Token-/Kosten-Statistik pro Spalte
- Eine leere Bewertungstabelle für die 10 Kriterien

Beim Lesen achte besonders auf:

| Kriterium | Was bedeutet "konsistent"? |
|---|---|
| Alter zwischen Normal/Beast | Bei B/C sollte das **identisch** sein (Hard-Facts-Anker greift); bei A darf es leicht abweichen |
| Marken zwischen Normal/Beast | Bei B/C **identisch** (kommen aus Large); bei A je Profile-Call neu generiert |
| Trigger zwischen Normal/Beast | Bei B/C **identisch**; bei A je Profile-Call neu |
| profileText konsistent mit Karten | Bei B/C: profileText kennt die Karten *nicht* — passt es trotzdem? |

### Kosten pro Lauf

Pro Bild ~3 Cent gesamt für alle drei Pipelines zusammen. Bei 10 Bildern also ~30 Cent. Vernachlässigbar.

### Wiederholtes Iterieren

Wenn die Test-Prompts in `test-prompts-v2.js` angepasst wurden, das Skript einfach noch mal starten. Schreibt `compare-result.html` neu.

## Was das Skript nicht macht

- Keine Bild-Komprimierung (lege Bilder ≤ 1 MB rein, sonst kann Mistral 413 werfen)
- Keine EXIF-Extraktion (Test läuft ohne Kameradaten-Kontext)
- Kein Caching — jeder Lauf zahlt voll
- Keine Statistik über mehrere Läufe (Single-Shot pro Bild)

## Rückbau, falls Forschung beendet

```bash
git rm functions/scripts/compare-pipelines.js
git rm functions/scripts/test-prompts-v2.js
git rm functions/scripts/compare-pipelines-README.md
rm -rf compare-input/ compare-result.html
git commit -m "Forschung: Pipeline-Vergleichstool entfernt"
```

Production bleibt unverändert.
