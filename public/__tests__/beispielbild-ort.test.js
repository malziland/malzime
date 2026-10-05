/**
 * beispielbild-ort.test.js — bei einem Beispielbild fragt der Browser nichts
 * nach aussen (PRIV-2026-10-03-38).
 *
 * Die Beispielbilder tragen absichtlich erfundene Ortsdaten, damit die
 * Ergebnis-Seite zeigen kann, was ein Foto verraet. Adresse und
 * Kartenausschnitt dieser Orte liefert die Seite selbst mit; die
 * Ortsaufloesung (Nominatim) und die Kartenkacheln werden dafuer nicht
 * angefragt. Fuer ein eigenes Foto mit Ortsdaten bleibt alles, wie es war.
 *
 * Geprueft wird hier der Programmweg in seinen Teilen — und vor allem, woran
 * ein Beispielbild erkannt wird: an der Datei, nicht an den Koordinaten und
 * nicht an einem Schalter, der am naechsten Foto kleben koennte. Den ganzen
 * Ablauf im Browser, mit gezaehlten Anfragen, prueft
 * e2e/beispielbild-ohne-ortsabfrage.test.js.
 *
 * Hier laeuft das ECHTE Leaflet aus dem Repo, und die Texte kommen aus den
 * ECHTEN Sprachdateien — fehlt dort ein Schluessel, wird dieser Test rot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupDOM } from "./setup.js";

const sprachen = vi.hoisted(() => ({ aktiv: "de", texte: { de: {}, en: {} } }));

vi.mock("../js/i18n.js", () => ({
  t: (key) => {
    const wert = sprachen.texte[sprachen.aktiv][key];
    return wert === undefined ? key : wert;
  },
  getLanguage: () => sprachen.aktiv,
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));
vi.mock("../js/error-logger.js", () => ({ logClientError: vi.fn() }));
/* js/demo.js stoesst nach dem Laden des Bildes die Analyse an — die gehoert
   nicht in diesen Test (und zoege die halbe Seite herein). */
vi.mock("../js/api.js", () => ({ analyzeImage: vi.fn() }));
vi.mock("../js/klang.js", () => ({ klangAktivieren: vi.fn() }));

const HIER = dirname(fileURLToPath(import.meta.url));
for (const sprache of ["de", "en"]) {
  sprachen.texte[sprache] = JSON.parse(readFileSync(join(HIER, "..", "locales", `${sprache}.json`), "utf8"));
}
/* Fuer welche Orte Kartenausschnitte hergestellt sind und wie die Dateien
   heissen (gepflegt in beispielbild-karten.test.js). */
const TABELLE = JSON.parse(readFileSync(join(HIER, "fixtures", "beispiel-karten.json"), "utf8"));

/* Die Ortsdaten des Beispielbilds „selfie" — ein eigenes Foto kann zufaellig
   dieselben tragen. */
const LAT = 48.2082;
const LNG = 16.3738;

function foto(name = "foto.jpg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: "image/jpeg" });
}

function ergebnisMit(exif) {
  return {
    profiles: { normal: { categories: {}, profileText: "Test" }, boost: null },
    privacyRisks: [],
    exif,
    meta: { requestId: "t", mode: "multimodal" },
  };
}

async function ladeLeaflet() {
  if (!globalThis.L) await import("../lib/leaflet/leaflet.js");
  return globalThis.L;
}

describe("Beispielbild: Ort ohne Abfrage (PRIV-2026-10-03-38)", () => {
  let state, elements, geo, render, L, fetchSpion, kachelSpion;

  beforeEach(async () => {
    /* dom.js bindet seine Elemente beim ersten Import — ohne frisches Laden
       zeigte es nach dem naechsten setupDOM auf verwaiste Knoten (Begruendung
       in render-gps-nan.test.js). */
    vi.resetModules();
    setupDOM();
    sprachen.aktiv = "de";
    L = await ladeLeaflet();
    state = (await import("../js/state.js")).state;
    elements = (await import("../js/dom.js")).elements;
    geo = await import("../js/geocoding.js");
    render = await import("../js/render.js");
    state.lastFile = null;
    state.pendingGeocode = null;
    state.geocodeCache = null;
    state.geocodeAbortController = null;
    state.gpsMapInstance = null;
    fetchSpion = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ display_name: "Adresse aus der Abfrage" }),
    });
    kachelSpion = vi.spyOn(L, "tileLayer");
  });

  afterEach(() => {
    if (state.geocodeAbortController) state.geocodeAbortController.abort();
    if (state.gpsMapInstance) state.gpsMapInstance.remove();
    state.gpsMapInstance = null;
    vi.restoreAllMocks();
  });

  /** Baut den Ortsbereich so auf, wie es die Ergebnis-Seite tut. */
  async function ortsbereichAufbauen(exif = { gpsLatitude: LAT, gpsLongitude: LNG }) {
    render.renderCurrentMode(ergebnisMit(exif));
    /* Die bewegliche Karte wartet auf die Ortsaufloesung — ein Takt reicht. */
    await new Promise((r) => setTimeout(r, 0));
  }

  describe("woran ein Beispielbild erkannt wird", () => {
    it("an der Datei, die als Beispielbild gemerkt wurde", () => {
      const datei = foto("demo-selfie.jpg");
      geo.merkeBeispielbild(datei, "selfie");
      expect(geo.beispielOrt(datei)).toMatchObject({ schluessel: "selfie" });
    });

    it("nicht am Namen und nicht am Inhalt: eine andere Datei ist kein Beispielbild", () => {
      geo.merkeBeispielbild(foto("demo-selfie.jpg"), "selfie");
      /* Gleicher Name, gleiche Bytes — aber eine andere Datei, so wie ein
         eigenes Foto immer eine andere Datei ist. */
      expect(geo.beispielOrt(foto("demo-selfie.jpg"))).toBeNull();
    });

    it("nur die drei bekannten Beispielbilder lassen sich merken", () => {
      const datei = foto();
      geo.merkeBeispielbild(datei, "unbekannt");
      expect(geo.beispielOrt(datei)).toBeNull();
      /* Auch keine geerbten Namen wie "constructor" oder "toString". */
      geo.merkeBeispielbild(datei, "constructor");
      expect(geo.beispielOrt(datei)).toBeNull();
    });

    it.each([null, undefined, "demo-selfie.jpg", 42])("%p ist kein Beispielbild und wirft nicht", (wert) => {
      expect(() => geo.merkeBeispielbild(wert, "selfie")).not.toThrow();
      expect(geo.beispielOrt(wert)).toBeNull();
    });

    it("Positivkontrolle: alle drei Schluessel werden gemerkt", () => {
      for (const schluessel of ["selfie", "cafe", "hiker"]) {
        const datei = foto();
        geo.merkeBeispielbild(datei, schluessel);
        expect(geo.beispielOrt(datei).schluessel).toBe(schluessel);
      }
    });
  });

  describe("das Programm und die Prueftabelle der Kartenausschnitte", () => {
    it("fuehren dieselben Beispielbilder", () => {
      /* Die Liste im Programm ist die EINE Liste: js/demo.js laedt nur, was
         darin steht. Ein Beispielbild ohne hergestellten Ausschnitt — oder
         ein Ausschnitt ohne Beispielbild — faellt hier auf. */
      expect(geo.BEISPIEL_SCHLUESSEL.length).toBeGreaterThan(0);
      expect([...geo.BEISPIEL_SCHLUESSEL].sort()).toEqual(Object.keys(TABELLE.orte).sort());
    });

    it("js/demo.js fuehrt keine zweite Liste", () => {
      const quelltext = readFileSync(join(HIER, "..", "js", "demo.js"), "utf8");
      expect(quelltext).toContain("const DEMO_KEYS = BEISPIEL_SCHLUESSEL;");
    });

    it.each(Object.keys(TABELLE.orte))(
      "%s: eingesetzt werden genau die Dateien der Tabelle, und sie liegen da",
      (ort) => {
        const datei = foto();
        geo.merkeBeispielbild(datei, ort);
        const gefunden = geo.beispielOrt(datei);
        const erwartet = Object.keys(TABELLE.karten).filter((name) => TABELLE.karten[name].ort === ort);
        expect([gefunden.bild, gefunden.bild2x].map((pfad) => pfad.replace("./img/demo/", "")).sort()).toEqual(
          erwartet.sort()
        );
        for (const verweis of [gefunden.bild, gefunden.bild2x]) {
          expect(existsSync(join(HIER, "..", verweis)), `${verweis} zeigt ins Leere`).toBe(true);
        }
      }
    );
  });

  describe("feste Adresse und fester Kartenausschnitt", () => {
    it.each(["selfie", "cafe", "hiker"])(
      "%s: Adresse je Sprache, Bild in zwei Dichten, Textalternative",
      (schluessel) => {
        const datei = foto();
        geo.merkeBeispielbild(datei, schluessel);

        const de = geo.beispielOrt(datei);
        expect(de.adresse).toBe(sprachen.texte.de[`demo.place.${schluessel}`]);
        expect(de.adresse).toMatch(/Österreich$/);
        expect(de.alt).toBe(sprachen.texte.de[`demo.mapAlt.${schluessel}`]);
        expect(de.alt.length).toBeGreaterThan(20);
        expect(de.bild).toBe(`./img/demo/karte-${schluessel}.webp`);
        expect(de.bild2x).toBe(`./img/demo/karte-${schluessel}-2x.webp`);

        sprachen.aktiv = "en";
        const en = geo.beispielOrt(datei);
        expect(en.adresse).toBe(sprachen.texte.en[`demo.place.${schluessel}`]);
        expect(en.adresse).toMatch(/Austria$/);
        expect(en.alt).toBe(sprachen.texte.en[`demo.mapAlt.${schluessel}`]);
        /* Die Ortsaufloesung antwortet je Sprache anders — der feste Text auch. */
        expect(en.adresse).not.toBe(de.adresse);
        expect(en.alt).not.toBe(de.alt);
      }
    );

    it("fehlt der Text in der Sprachdatei, steht kein Schluesselname auf dem Bildschirm", async () => {
      const original = sprachen.texte.de;
      const ohne = { ...original };
      delete ohne["demo.place.selfie"];
      delete ohne["demo.mapAlt.selfie"];
      sprachen.texte.de = ohne;
      try {
        const datei = foto();
        geo.merkeBeispielbild(datei, "selfie");
        state.lastFile = datei;
        expect(geo.beispielOrt(datei).adresse).toBe("");

        await ortsbereichAufbauen();
        /* Dann stehen die Koordinaten da — wie bei einer ausgefallenen Abfrage. */
        expect(elements.gpsMap.querySelector(".gps-address").textContent).toBe("48.20820, 16.37380");
        expect(elements.gpsMap.innerHTML).not.toContain("demo.place.");
        expect(elements.gpsMap.innerHTML).not.toContain("demo.mapAlt.");
        expect(fetchSpion).not.toHaveBeenCalled();
      } finally {
        sprachen.texte.de = original;
      }
    });
  });

  describe("die Ortsaufloesung", () => {
    it("fragt bei einem Beispielbild nichts an", () => {
      const datei = foto();
      geo.merkeBeispielbild(datei, "selfie");
      state.lastFile = datei;

      geo.startGeocoding(LAT, LNG);

      expect(fetchSpion).not.toHaveBeenCalled();
      expect(state.pendingGeocode).toBeNull();
      expect(state.geocodeAbortController).toBeNull();
    });

    it("Positivkontrolle: ein eigenes Foto mit DENSELBEN Koordinaten wird angefragt", async () => {
      state.lastFile = foto("urlaub.jpg");

      geo.startGeocoding(LAT, LNG);

      expect(fetchSpion).toHaveBeenCalledTimes(1);
      const adresse = String(fetchSpion.mock.calls[0][0]);
      expect(adresse).toContain("https://nominatim.openstreetmap.org/reverse");
      expect(adresse).toContain(`lat=${LAT}`);
      expect(adresse).toContain(`lon=${LNG}`);
      expect(await state.pendingGeocode).toBe("Adresse aus der Abfrage");
    });

    it("das Merkmal klebt nicht: Beispielbild → eigenes Foto → Beispielbild", () => {
      const beispiel = foto("demo-selfie.jpg");
      geo.merkeBeispielbild(beispiel, "selfie");

      state.lastFile = beispiel;
      geo.startGeocoding(LAT, LNG);
      expect(fetchSpion).toHaveBeenCalledTimes(0);

      /* Nichts wird zurueckgesetzt — das naechste Foto ist einfach eine andere
         Datei, so wie es js/app.js beim Hochladen setzt. */
      state.lastFile = foto("eigenes.jpg");
      geo.startGeocoding(LAT, LNG);
      expect(fetchSpion).toHaveBeenCalledTimes(1);

      const naechstes = foto("demo-cafe.jpg");
      geo.merkeBeispielbild(naechstes, "cafe");
      state.lastFile = naechstes;
      geo.startGeocoding(47.8005, 13.044);
      expect(fetchSpion).toHaveBeenCalledTimes(1);
    });

    it("Sprachwechsel: dieselbe Datei wird neu analysiert und bleibt ein Beispielbild", () => {
      const datei = foto("demo-selfie.jpg");
      geo.merkeBeispielbild(datei, "selfie");
      state.lastFile = datei;
      geo.startGeocoding(LAT, LNG);

      /* js/sprachumschalter.js ruft nach dem Wechsel den Weg fuer ein neues
         Foto mit `state.lastFile` auf — dieselbe Datei, neue Sprache. */
      sprachen.aktiv = "en";
      state.lastFile = datei;
      state.pendingGeocode = null;
      state.geocodeCache = null;
      geo.startGeocoding(LAT, LNG);

      expect(fetchSpion).not.toHaveBeenCalled();
      expect(geo.beispielOrt(datei).adresse).toMatch(/Austria$/);
    });

    it("eine noch laufende Abfrage des vorigen eigenen Fotos wird abgebrochen", () => {
      state.lastFile = foto("eigenes.jpg");
      geo.startGeocoding(LAT, LNG);
      const laufend = state.geocodeAbortController;
      expect(laufend.signal.aborted).toBe(false);

      const beispiel = foto();
      geo.merkeBeispielbild(beispiel, "hiker");
      state.lastFile = beispiel;
      geo.startGeocoding(47.5622, 13.6493);

      expect(laufend.signal.aborted).toBe(true);
      expect(fetchSpion).toHaveBeenCalledTimes(1);
    });
  });

  describe("der Ortsbereich der Ergebnis-Seite", () => {
    it("Beispielbild: fester Kartenausschnitt mit Zeiger, Adresse und Quellenangabe — keine Kachel, keine Abfrage", async () => {
      const datei = foto();
      geo.merkeBeispielbild(datei, "selfie");
      state.lastFile = datei;

      await ortsbereichAufbauen();

      const bereich = elements.gpsMap;
      expect(bereich.querySelector(".gps-address").textContent).toBe(sprachen.texte.de["demo.place.selfie"]);

      const bild = bereich.querySelector(".gps-festkarte img");
      expect(bild).not.toBeNull();
      expect(bild.getAttribute("src")).toBe("./img/demo/karte-selfie.webp");
      expect(bild.getAttribute("srcset")).toBe("./img/demo/karte-selfie.webp 1x, ./img/demo/karte-selfie-2x.webp 2x");
      expect(bild.getAttribute("width")).toBe("640");
      expect(bild.getAttribute("height")).toBe("238");
      expect(bild.getAttribute("alt")).toBe(sprachen.texte.de["demo.mapAlt.selfie"]);

      /* Der Zeiger ist Zierde zum Bild — die Textalternative nennt ihn. */
      const zeiger = bereich.querySelector(".gps-festkarte .gps-zeiger");
      expect(zeiger.getAttribute("aria-hidden")).toBe("true");
      expect(zeiger.querySelector("svg path").getAttribute("fill")).toBe("#9c4e36");

      /* Quellenangabe MIT Verweis auf die Lizenzseite, in einem neuen Tab. */
      const quelle = bereich.querySelector('.gps-festkarte-quelle a[href="https://www.openstreetmap.org/copyright"]');
      expect(quelle).not.toBeNull();
      expect(quelle.textContent).toBe("OpenStreetMap");
      expect(quelle.getAttribute("target")).toBe("_blank");
      expect(quelle.getAttribute("rel")).toContain("noopener");
      expect(bereich.querySelector(".gps-festkarte-quelle").textContent).toContain("Mitwirkende");

      /* Der Hinweis passt zur festen Karte, nicht zur beweglichen. */
      expect(bereich.querySelector(".gps-hinweis").textContent).toBe(sprachen.texte.de["gps.fixedHint"]);

      /* Nichts davon ging nach aussen. */
      expect(bereich.querySelector("#gpsMapLeaflet")).toBeNull();
      expect(bereich.querySelector(".leaflet-container")).toBeNull();
      expect(kachelSpion).not.toHaveBeenCalled();
      expect(fetchSpion).not.toHaveBeenCalled();
      expect(state.gpsMapInstance).toBeNull();
      /* Die Sicherheitsrichtlinie der Seite erlaubt keine style-Attribute. */
      expect(bereich.innerHTML).not.toMatch(/\sstyle\s*=/);
    });

    it("Positivkontrolle: ein eigenes Foto mit denselben Koordinaten bekommt die bewegliche Karte mit Kacheln", async () => {
      state.lastFile = foto("urlaub.jpg");

      await ortsbereichAufbauen();

      expect(elements.gpsMap.querySelector("#gpsMapLeaflet")).not.toBeNull();
      expect(elements.gpsMap.querySelector(".gps-festkarte")).toBeNull();
      expect(kachelSpion).toHaveBeenCalledTimes(1);
      expect(kachelSpion.mock.calls[0][0]).toContain("tile.openstreetmap.org");
      expect(elements.gpsMap.querySelector(".gps-hinweis").textContent).toBe(sprachen.texte.de["gps.zoomHint"]);
    });

    it("Wechsel zwischen den Ansichten: auch der zweite und dritte Aufbau bleiben ohne Kachel und Abfrage", async () => {
      const datei = foto();
      geo.merkeBeispielbild(datei, "cafe");
      state.lastFile = datei;

      for (let aufbau = 0; aufbau < 3; aufbau++) {
        await ortsbereichAufbauen({ gpsLatitude: 47.8005, gpsLongitude: 13.044 });
        expect(elements.gpsMap.querySelectorAll(".gps-festkarte img")).toHaveLength(1);
        expect(elements.gpsMap.querySelector(".gps-address").textContent).toBe(sprachen.texte.de["demo.place.cafe"]);
      }
      expect(kachelSpion).not.toHaveBeenCalled();
      expect(fetchSpion).not.toHaveBeenCalled();
    });

    it("englische Seite: Adresse und Textalternative auf Englisch", async () => {
      const datei = foto();
      geo.merkeBeispielbild(datei, "hiker");
      state.lastFile = datei;
      sprachen.aktiv = "en";

      await ortsbereichAufbauen({ gpsLatitude: 47.5622, gpsLongitude: 13.6493 });

      expect(elements.gpsMap.querySelector(".gps-address").textContent).toBe(sprachen.texte.en["demo.place.hiker"]);
      expect(elements.gpsMap.querySelector(".gps-festkarte img").getAttribute("alt")).toBe(
        sprachen.texte.en["demo.mapAlt.hiker"]
      );
      expect(elements.gpsMap.querySelector(".gps-festkarte-quelle").textContent).toContain("contributors");
    });

    it("der feste Ausschnitt braucht die Karten-Bibliothek nicht", async () => {
      const datei = foto();
      geo.merkeBeispielbild(datei, "selfie");
      state.lastFile = datei;
      const leaflet = globalThis.L;
      delete globalThis.L;
      try {
        await ortsbereichAufbauen();
        expect(elements.gpsMap.querySelector(".gps-festkarte img")).not.toBeNull();
      } finally {
        globalThis.L = leaflet;
      }
    });

    it("ohne lesbare Ortsdaten erscheint auch bei einem Beispielbild kein Ortsbereich", async () => {
      const datei = foto();
      geo.merkeBeispielbild(datei, "selfie");
      state.lastFile = datei;

      await ortsbereichAufbauen({ make: "Apple" });

      expect(elements.gpsMap.innerHTML).toBe("");
    });

    it("eigenes Foto → Beispielbild: die bewegliche Karte wird abgebaut", async () => {
      state.lastFile = foto("urlaub.jpg");
      await ortsbereichAufbauen();
      const bewegliche = state.gpsMapInstance;
      expect(bewegliche).not.toBeNull();
      const abbau = vi.spyOn(bewegliche, "remove");

      const beispiel = foto();
      geo.merkeBeispielbild(beispiel, "selfie");
      state.lastFile = beispiel;
      await ortsbereichAufbauen();

      expect(abbau).toHaveBeenCalledTimes(1);
      expect(state.gpsMapInstance).toBeNull();
      expect(elements.gpsMap.querySelector("#gpsMapLeaflet")).toBeNull();
      expect(elements.gpsMap.querySelector(".gps-festkarte img")).not.toBeNull();
      /* Die eine Kachel-Schicht gehoert zum eigenen Foto davor. */
      expect(kachelSpion).toHaveBeenCalledTimes(1);
    });
  });

  describe("Klick auf ein Beispielbild (js/demo.js)", () => {
    const takt = () => new Promise((r) => setTimeout(r, 0));

    function demoKnopf(schluessel) {
      const knopf = document.createElement("button");
      knopf.className = "demo-thumb";
      knopf.dataset.demo = schluessel;
      document.body.appendChild(knopf);
      return knopf;
    }

    beforeEach(() => {
      globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
      globalThis.URL.revokeObjectURL = vi.fn();
      /* Das Beispielbild kommt von der eigenen Seite; eine Abfrage bei
         Nominatim haengt, bis sie abgebrochen wird — wie eine langsame
         Verbindung. */
      fetchSpion.mockImplementation((adresse, optionen = {}) => {
        if (String(adresse).includes("nominatim.openstreetmap.org")) {
          return new Promise((_, ablehnen) => {
            optionen.signal?.addEventListener("abort", () => ablehnen(new DOMException("Aborted", "AbortError")));
          });
        }
        return Promise.resolve({ blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]) });
      });
    });

    it.each(["selfie", "cafe", "hiker"])("%s: die geladene Datei ist als Beispielbild gemerkt", async (schluessel) => {
      const { initDemo } = await import("../js/demo.js");
      const { analyzeImage } = await import("../js/api.js");
      analyzeImage.mockClear();
      /* Erst der Knopf, dann das Verdrahten — initDemo erfasst, was da ist. */
      const knopf = demoKnopf(schluessel);
      initDemo();

      knopf.click();
      await takt();
      await takt();

      expect(analyzeImage).toHaveBeenCalledTimes(1);
      expect(state.lastFile).toBeInstanceOf(File);
      expect(geo.beispielOrt(state.lastFile)).toMatchObject({ schluessel });
      /* Geladen wurde nur das Bild von der eigenen Seite. */
      expect(fetchSpion.mock.calls.map((aufruf) => String(aufruf[0])).filter((a) => /^https?:/.test(a))).toEqual([]);
    });

    it("ein noch wartender Aufbau der beweglichen Karte zeichnet nach dem Klick nichts mehr", async () => {
      /* Eigenes Foto: Die Ergebnis-Seite baut den Ortsbereich auf und wartet
         dabei auf die Ortsaufloesung, die gerade haengt. */
      state.lastFile = foto("urlaub.jpg");
      geo.startGeocoding(48.30694, 14.28583);
      render.renderCurrentMode(ergebnisMit({ gpsLatitude: 48.30694, gpsLongitude: 14.28583 }));
      await takt();
      /* POSITIVKONTROLLE: Der Aufbau wartet wirklich noch — sonst pruefte der
         Rest einen Aufbau, der laengst fertig ist. */
      expect(elements.gpsMap.innerHTML).toBe("");
      expect(kachelSpion).not.toHaveBeenCalled();
      expect(fetchSpion).toHaveBeenCalledTimes(1);

      /* Jetzt tippt jemand auf ein Beispielbild. Die haengende Abfrage wird
         abgebrochen; der wartende Aufbau laeuft dadurch weiter — und darf
         jetzt keine bewegliche Karte mehr aufbauen, sonst gingen nach der Wahl
         eines Beispielbilds noch Kachel-Anfragen hinaus. */
      const { initDemo } = await import("../js/demo.js");
      const knopf = demoKnopf("selfie");
      initDemo();
      knopf.click();
      await takt();
      await takt();
      await takt();

      expect(geo.beispielOrt(state.lastFile)).toMatchObject({ schluessel: "selfie" });
      expect(kachelSpion).not.toHaveBeenCalled();
      expect(elements.gpsMap.querySelector("#gpsMapLeaflet")).toBeNull();
      expect(state.gpsMapInstance).toBeNull();
    });

    it("eine fertige bewegliche Karte des vorigen Fotos wird beim Klick sofort abgebaut", async () => {
      state.lastFile = foto("urlaub.jpg");
      await ortsbereichAufbauen();
      const bewegliche = state.gpsMapInstance;
      expect(bewegliche).not.toBeNull();
      const abbau = vi.spyOn(bewegliche, "remove");

      const { initDemo } = await import("../js/demo.js");
      const knopf = demoKnopf("cafe");
      initDemo();
      knopf.click();
      /* Sofort — nicht erst, wenn das Ergebnis des Beispielbilds gezeichnet
         wird: Bis dahin koennte die alte Karte noch Kacheln nachladen. */
      await takt();

      expect(abbau).toHaveBeenCalledTimes(1);
      expect(state.gpsMapInstance).toBeNull();
      expect(elements.gpsMap.innerHTML).toBe("");
    });
  });
});
