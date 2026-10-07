// @vitest-environment jsdom
/* Geraeteangaben der Fehlermeldungen: nur, was der Datenschutztext nennt
   (PRIV-2026-10-03-39).

   Die Deckungspruefung (datenschutz-deckung.test.js) laesst fuer Felder der
   Browser-Meldungen den Sammelsatz "grobe Angaben wie" gelten. Fuer Angaben
   ueber das GERAET ist das zu grosszuegig: Arbeitsspeicher und Prozessorkerne
   liefen unter dem Sammelsatz mit, die Pixeldichte unter dem Stichwort
   "Bildschirmgroesse" — genannt hat der Text keine der drei.

   Deshalb zwei Pruefungen:
   (1) Am Browser: `collectClientContext()` sammelt die drei Angaben nicht,
       auch wenn der Browser sie anbietet. Was der Text nennt (Groessenklasse
       des Bildschirms, Sprache, Netz), sammelt es weiter.
   (2) An der Zuordnungstabelle: Jede Geraete- oder Netzangabe der
       Fehlermeldungen (`client.…`) traegt ein EIGENES Stichwort, das im
       deutschen und im englischen Text steht. Der Sammelsatz gilt dort nicht;
       die eine Ausnahme steht mit Begruendung unten. */
import { describe, test, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { collectClientContext } from "../js/client-context.js";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lies = (pfad) => readFileSync(join(WURZEL, pfad), "utf8");
const glatt = (text) => text.replace(/\s+/g, " ").trim();
const seitentext = (pfad) => glatt(new JSDOM(lies(pfad)).window.document.body.textContent);
const klartext = (stichwort) => glatt(JSDOM.fragment(stichwort).textContent);

const NICHT_IM_TEXT = ["deviceMemoryGb", "hardwareConcurrency", "dpr"];

describe("(1) Der Browser sammelt die drei Angaben nicht", () => {
  /* Bietet dem Modul einen Wert an und nimmt ihn nach dem Test wieder weg —
     so, wie er vorher da war (eigene Eigenschaft oder geerbt). */
  const gesetzt = [];
  function biete(objekt, name, wert) {
    gesetzt.push([objekt, name, Object.getOwnPropertyDescriptor(objekt, name)]);
    Object.defineProperty(objekt, name, { value: wert, configurable: true });
  }
  afterEach(() => {
    for (const [objekt, name, vorher] of gesetzt.splice(0).reverse()) {
      if (vorher) Object.defineProperty(objekt, name, vorher);
      else delete objekt[name];
    }
  });

  test("auch wenn der Browser Arbeitsspeicher, Kerne und Pixeldichte anbietet", () => {
    biete(navigator, "deviceMemory", 8);
    biete(navigator, "hardwareConcurrency", 8);
    biete(window, "devicePixelRatio", 2.625);
    const ctx = collectClientContext();
    for (const feld of NICHT_IM_TEXT) expect(ctx).not.toHaveProperty(feld);
    expect(JSON.stringify(ctx)).not.toContain("2.6");
  });

  test("was der Text nennt, sammelt er weiter: Groessenklasse, Sprache, Netz", () => {
    biete(navigator, "language", "de-AT");
    biete(navigator, "connection", { effectiveType: "4g", downlink: 9.5, rtt: 100, saveData: false });
    biete(window.screen, "width", 390);
    biete(window.screen, "height", 844);
    expect(collectClientContext()).toMatchObject({
      language: "de-AT",
      effectiveType: "4g",
      downlinkMbps: 9.5,
      rttMs: 100,
      saveData: false,
      screen: "small",
    });
  });
});

describe("(2) Zuordnungstabelle: jede Geraeteangabe der Fehlermeldungen hat ihr eigenes Stichwort", () => {
  const DECKUNG = JSON.parse(lies("public/__tests__/fixtures/datenschutz-deckung.json"));
  const TEXT_DE = seitentext("public/datenschutz.html");
  const TEXT_EN = seitentext("public/en/privacy.html");
  const GERAET = Object.entries(DECKUNG.felder["handle-errors"]).filter(([feld]) => feld.startsWith("client."));

  /* Kein Merkmal des Geraets, sondern ein Ja/Nein, ob ein Test-Browser die
     Seite aufruft (navigator.webdriver, 07.09.2026). Bleibt unter dem
     Sammelsatz. Eine weitere Ausnahme braucht hier eine Zeile mit Grund. */
  const UNTER_DEM_SAMMELSATZ = ["client.automatisiert"];

  test("die Tabelle nennt Geraeteangaben (Messmittel-Kontrolle)", () => {
    expect(GERAET.map(([feld]) => feld)).toEqual(expect.arrayContaining(["client.screen", "client.language"]));
    expect(TEXT_DE).toContain("Datenschutz");
  });

  test("Arbeitsspeicher, Prozessorkerne und Pixeldichte stehen nicht mehr in der Tabelle", () => {
    const felder = GERAET.map(([feld]) => feld);
    for (const feld of NICHT_IM_TEXT) expect(felder).not.toContain(`client.${feld}`);
  });

  test.each(GERAET)("%s: eigenes Stichwort im deutschen und englischen Text", (feld, stichwort) => {
    if (UNTER_DEM_SAMMELSATZ.includes(feld)) {
      expect(stichwort).toBe("zusammengefasst");
      return;
    }
    expect(stichwort, `${feld}: der Sammelsatz gilt fuer Geraeteangaben nicht`).not.toBe("zusammengefasst");
    expect(TEXT_DE.includes(klartext(stichwort)), `fehlt in datenschutz.html: ${klartext(stichwort)}`).toBe(true);
    const en = DECKUNG.stichwortEn?.[stichwort];
    expect(en, `Uebersetzung fuer "${stichwort}" fehlt`).toBeTruthy();
    expect(TEXT_EN.includes(klartext(en)), `fehlt in en/privacy.html: ${en}`).toBe(true);
  });
});
