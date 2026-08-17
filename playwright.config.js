import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:8081",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    /* WebKit ist die Maschine hinter Safari auf iPhone und iPad — dort laufen
       die Workshops. Am 2026-08-13 hat genau dieser Lauf einen Fehler gezeigt,
       den Chromium nicht zeigte: Safari setzt den Fokus ohne „Vollzugriff
       Tastatur" nicht auf Knoepfe; wer den Dialog per Tab verliess, kam nicht
       mehr zurueck. Nur die Umschalter-Tests, damit die Pipeline nicht
       unnoetig waechst — das offizielle Playwright-Abbild bringt WebKit ohne
       Zusatzinstallation mit. */
    {
      name: "webkit-sprachumschalter",
      use: { browserName: "webkit", viewport: { width: 390, height: 844 } },
      /* Auch das Barrierefreiheits-Protokoll laeuft hier: Die Workshops finden
         auf iPhones statt, also auf WebKit. Am 2026-08-17 hat genau dieser
         Unterschied einen echten Fehler gezeigt, den Chromium nicht zeigte —
         nur in einem Browser zu messen und "geprueft" zu sagen, waere eine
         halbe Pruefung. */
      testMatch: /(sprachumschalter|barrierefreiheit-protokoll).*\.test\.js/,
    },
    /* Firefox — Nutzer-Ansage 2026-08-17: Die Workshops laufen NICHT nur auf
       iPhone und Mac. Schulen und Schueler bringen mit, was sie haben; darauf
       haben wir keinen Einfluss. Die Accessibility-Support-Baseline ist damit
       breit, und eine Pruefung, die nur Chromium und WebKit kennt, deckt sie
       nicht ab. Gecko ist die dritte Maschine im Feld — und Firefox mit NVDA
       unter Windows eine der haeufigsten Kombinationen ueberhaupt.
       Nur die Barrierefreiheits-Pruefungen, damit die Pipeline nicht unnoetig
       waechst. */
    {
      name: "firefox-barrierefreiheit",
      use: { browserName: "firefox" },
      testMatch: /(a11y|tastatur-erreichbarkeit|barrierefreiheit-protokoll|ansagen)/,
    },
  ],
  webServer: {
    command: "python3 -m http.server 8081 --directory public",
    port: 8081,
    // TEST-2026-08-13-K6: Standardmäßig NICHT wiederverwenden. Vorher teilten
    // sich zwei gleichzeitige Läufe Port 8081 — der zweite bekam einen fremden
    // oder halb toten Server, und der Prüfstand stempelte die dabei entstandene
    // Zahl in docs/VERIFICATION.md. Jetzt scheitert ein Lauf bei belegtem Port
    // laut, statt still gegen etwas Fremdes zu messen. Wer bewusst einen schon
    // laufenden Dev-Server nutzen will, setzt PW_REUSE=1.
    reuseExistingServer: process.env.PW_REUSE === "1",
  },
});
