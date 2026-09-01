/**
 * job-pipelines-profile.test.js — wann gilt ein Ergebnis als brauchbar?
 *
 * BEFUND 01.09.2026 (Mutationsprobe): Zwei Zeilen entscheiden darueber, ob ein
 * Kind sein Profil zu sehen bekommt oder eine Fehlermeldung — und beide waren
 * von keinem Test gedeckt. Ihre Operatoren liessen sich umdrehen, ohne dass
 * etwas rot wurde:
 *
 *   job-pipelines.js:126   profileBlocked = !profiles.normal && !profiles.boost
 *   job-pipelines.js:134   hasAnyProfile  = hasCategories(normal) || hasCategories(boost)
 *
 * Die Wirkung eines vertauschten Operators ist nicht theoretisch: Aus `&&`
 * wird `||`, und ein halbes Ergebnis gilt als blockiert — das Kind sieht eine
 * Fehlermeldung, obwohl ein Profil vorliegt. Andersherum wuerde ein leeres
 * Ergebnis als brauchbar durchgehen.
 */

const { SATZ } = require("../test-satz");

/** Ein Profil mit Karten, wie es die KI liefert. */
const mitKarten = (wert = "Beispiel") => ({ categories: { interessen: { value: wert } } });

describe("Wann gilt ein Profil als vorhanden", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  /** Faehrt runPipeline mit vorgegebenen Profilen und liefert das Ergebnis. */
  async function laufMit(profiles) {
    jest.resetModules();
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({ werte: SATZ, quelle: "firestore", grund: null }),
    }));
    jest.doMock("../queue-storage", () => ({
      loadImage: async () => ({ buffer: Buffer.from("x"), mimeType: "image/jpeg" }),
      deleteImage: async () => true,
    }));
    jest.doMock("../mistral", () => ({
      describeImage: async () => "Ein Foto im Freien.",
      generateBothProfiles: async () => profiles,
      runSingleLargeCall: async () => profiles,
    }));
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    const { runPipeline } = require("../job-pipelines");
    const mistral = require("../mistral");
    return runPipeline({
      mistral,
      job: { traceId: "t", imagePath: "queue-uploads/x.jpg", lang: "de", exif: {} },
    }).catch((fehler) => ({ fehler }));
  }

  test("beide Profile vorhanden — das Ergebnis ist brauchbar", async () => {
    const r = await laufMit({ normal: mitKarten(), boost: mitKarten() });
    expect(r.fehler).toBeUndefined();
    expect(r.success).toBe(true);
  });

  test("NUR das normale Profil genuegt — kein blockiertes Ergebnis", async () => {
    /* Deckt `&&` gegen `||` in Zeile 126 ab: Mit `||` gilt schon ein
       fehlendes Boost-Profil als Blockade, und das Kind saehe eine
       Fehlermeldung, obwohl sein Profil da ist. */
    const r = await laufMit({ normal: mitKarten(), boost: null });
    expect(r.fehler).toBeUndefined();
    expect(r.success).toBe(true);
  });

  test("NUR das Boost-Profil genuegt ebenfalls", async () => {
    const r = await laufMit({ normal: null, boost: mitKarten() });
    expect(r.fehler).toBeUndefined();
    expect(r.success).toBe(true);
  });

  test("gar kein Profil ist ein blockiertes Ergebnis, kein leeres", async () => {
    /* Die Gegenrichtung: Ohne jedes Profil darf NICHT "erfolgreich" gemeldet
       werden — sonst sieht das Kind eine leere Seite statt einer Erklaerung. */
    const r = await laufMit({ normal: null, boost: null });
    expect(r.success).toBe(false);
  });

  test("der gemeldete Grund benennt das fehlende Profil, nicht 'irgendein Fehler'", async () => {
    /* `profileBlocked` bestimmt, WELCHEN Grund der Nutzer bekommt. Der
       Unterschied ist nicht kosmetisch: `blocked.generic` schickt Leute in
       ein sinnloses "gleich nochmal versuchen", `blocked.profileBlocked` sagt,
       woran es lag. Genau dieses Feld hat beim Vorfall vom 31.08. gefehlt, als
       niemand sagen konnte, was der Nutzer gesehen hat.

       ANMERKUNG zur Mutationsprobe: Die Zeile
       `profileBlocked = !normal && !boost` laesst sich zu `||` aendern, ohne
       dass ein Test rot wird — und das ist KEIN Testloch. Fehlt nur ein
       Profil, greift der Erfolgszweig und die Variable wird nie gelesen;
       fehlen beide, sind beide Fassungen gleich. Eine aequivalente Mutation.
       Gedeckt wird deshalb die WIRKUNG, nicht die Schreibweise. */
    const r = await laufMit({ normal: null, boost: null });
    expect(r.result.blockedReason).toBe("blocked.profileBlocked");
  });

  test("bei halbem Ergebnis wird gar nicht blockiert", async () => {
    const r = await laufMit({ normal: mitKarten(), boost: null });
    expect(r.result.blockedReason).toBeFalsy();
  });

  test("Profile ohne Karten zaehlen nicht als Ergebnis", async () => {
    /* Deckt `hasCategories` mit ab: Ein Objekt ohne `categories` ist kein
       Profil, auch wenn es nicht null ist. */
    const r = await laufMit({ normal: {}, boost: { categories: {} } });
    expect(r.success).toBe(false);
  });
});
