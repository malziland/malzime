const config = require("../config");

describe("config", () => {
  test("exports expected constants", () => {
    expect(config.MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(config.RATE_LIMIT).toBe(500);
    expect(config.RATE_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(config.ALLOWED_MIME).toEqual(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  });

  test("no legacy Google AI/Vision constants present (Mistral-only seit v1.6.0)", () => {
    expect(config.DESCRIBE_MODELS).toBeUndefined();
    expect(config.PROFILE_MODELS).toBeUndefined();
  });

  test("legacy API_TIMEOUT_MS removed (Mistral-only seit v1.6.0)", () => {
    expect(config.API_TIMEOUT_MS).toBeUndefined();
  });

  test("Mistral constants are set", () => {
    expect(config.MISTRAL_DESCRIBE_MODEL).toBe("mistral-large-2512");
    expect(config.MISTRAL_PROFILE_MODEL).toBe("mistral-small-2603");
    expect(config.MISTRAL_FALLBACK_MODEL).toBe("mistral-large-2512");
    /* v3.0.4: EU-Regional-Endpunkt — vertragliche EU/EFTA-Garantie. Diese
       Probe wird ROT, wenn jemand versehentlich auf den globalen Endpunkt
       zurueckfaellt. */
    expect(config.MISTRAL_ENDPOINT).toMatch(/^https:\/\/api\.eu\.mistral\.ai/);
  });

  /* PRIV-2026-08-20-32: Der Produktivcode war festgenagelt, die zehn Mess- und
     Vergleichswerkzeuge in functions/scripts/ nicht — sie zeigten alle auf den
     globalen Endpunkt. Wer damit misst, schickt echte Fotos an einen Nicht-EU-
     Eingang, waehrend die Datenschutzerklaerung den EU-Regional-Endpunkt zusagt.
     Der Waechter prueft die FLAECHE, nicht eine Liste bekannter Dateien. */
  test("kein Werkzeug im Repository ruft einen Nicht-EU-Mistral-Endpunkt", () => {
    const fs = require("fs");
    const path = require("path");
    const wurzel = path.join(__dirname, "../..");
    const treffer = [];
    let geprueft = 0;

    const durchgehen = (verzeichnis) => {
      for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
        if (eintrag.name === "node_modules" || eintrag.name.startsWith(".")) continue;
        const voll = path.join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) {
          durchgehen(voll);
          continue;
        }
        if (!/\.(js|mjs|cjs)$/.test(eintrag.name)) continue;
        geprueft += 1;
        const inhalt = fs.readFileSync(voll, "utf8");
        /* Nur der globale Eingang ist gemeint; api.eu.mistral.ai enthaelt
           dieselbe Zeichenfolge nicht. */
        for (const zeile of inhalt.split("\n")) {
          if (/https:\/\/api\.mistral\.ai/.test(zeile)) {
            treffer.push(path.relative(wurzel, voll));
            break;
          }
        }
      }
    };
    durchgehen(wurzel);

    /* Positivkontrolle: Findet die Suche gar keine Dateien, waere "keine
       Treffer" kein Ergebnis, sondern ein leeres Blatt. */
    expect(geprueft).toBeGreaterThan(20);
    expect(treffer).toEqual([]);
    expect(config.MISTRAL_DESCRIBE_MAX_TOKENS).toBeGreaterThan(0);
    expect(config.MISTRAL_PROFILE_MAX_TOKENS).toBeGreaterThan(5000);
    expect(config.MISTRAL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
