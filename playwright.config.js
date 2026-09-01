import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  /* OPS-2026-08-21-04: Ohne diese Angabe schaltet Playwright in der Pipeline auf
     EINEN Arbeiter herunter (CI-Erkennung). Die 279 Tests liefen deshalb streng
     nacheinander — rund zehn Minuten je Lauf, und die Kette faehrt zweimal je
     Auslieferung. Am 2026-08-21 hat das an einem Tag ueber eine Stunde reine
     Wartezeit gekostet.
     VIER Arbeiter. Der Weg dorthin ist es wert, festgehalten zu werden, weil
     die naheliegende Erklaerung zweimal falsch war:
     - Vier Arbeiter allein: 6:40 statt 10:29 — aber rot, weil der teuerste Test
       (axe ueber vier Sprach-/Themen-Kombinationen in WebKit) unter der Last die
       30-Sekunden-Grenze riss. Kein Befund, ein Messfehler.
     - Daraufhin auf zwei zurueckgenommen: 10:39, also kein Gewinn. Erst da war
       klar, dass die Arbeiterzahl wirkt und die Reissleine das Problem war.
     Jetzt beides zusammen: vier Arbeiter UND `test.slow()` fuer den teuren Test
     (siehe e2e/sprachumschalter.test.js). Diese Kombination gab es vorher nie.
     Mehr als vier bringt nichts: Der Pipeline-Rechner hat vier Kerne. */
  workers: process.env.CI ? 4 : undefined,
  /* BEFUND 31.08.2026 (Runde 4, F-8): Hier stand nichts zu `retries` —
     Playwright nimmt dann 0. Das Ergebnis war richtig, aber es war keine
     Entscheidung, sondern eine Vorgabe, die niemand geprueft hatte.
     Sie bleibt bei 0, ausdruecklich: Ein Wiederholungslauf macht einen
     flackernden Test gruen, ohne dass jemand erfaehrt, dass er flackert. In
     einem Projekt, das "gruen" nur nach einer Messung gelten laesst, ist das
     die falsche Richtung. Flackern wird an der Ursache behoben — so geschehen
     bei e2e/sprachumschalter.test.js, wo eine zu knappe Reissleine der Grund
     war und nicht der Test.
     Wer das aendert, aendert damit die Aussage von "gruen". */
  retries: 0,
  use: {
    baseURL: "http://localhost:8081",
    headless: true,
    /* BEWEISE BEI FEHLSCHLAG (30.08.2026). Vorher zeichnete der Lauf nichts
       auf: Ein Test, der nur in der Pipeline umfaellt — andere Schriften,
       andere Parallelitaet, anderes Timing — war damit nicht untersuchbar.
       Man konnte nur wiederholen und hoffen. In einer einzigen Nacht hat das
       vier verschiedene Tests betroffen und die Auslieferung fuenfmal
       blockiert, ohne dass je eine Ursache sichtbar wurde.

       Im gruenen Normalfall entsteht nichts, die Laufzeit bleibt gleich. Erst
       der Fehlschlag hinterlaesst Bild und Ablaufprotokoll; die CI laedt sie
       als Artefakt hoch (siehe .github/workflows/ci.yml). */
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
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
    /* OPS-2026-08-21-04: `python3 -m http.server` bedient GENAU EINE Anfrage zur
       Zeit. Bei mehreren Arbeitern (und schon bei einem, wenn eine Seite viele
       Dateien nachlaedt) reisst er Verbindungen ab: "BrokenPipeError" und
       "ConnectionResetError" standen wiederholt im Pipeline-Protokoll, einmal
       hat ein solcher Aussetzer einen Testlauf rot gemacht. Die mehrspurige
       Variante steht in derselben Standardbibliothek und kostet nichts. */
    command:
      "python3 -c \"from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler;import functools,os;os.chdir('public');ThreadingHTTPServer(('',8081),SimpleHTTPRequestHandler).serve_forever()\"",
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
