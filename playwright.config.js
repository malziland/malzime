import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:8081",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
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
