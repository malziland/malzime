import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

/* i18n wird nachgebaut, damit der Wechsel ohne Netz prüfbar ist. `t` liefert
   den Schlüssel zurück — das reicht, denn geprüft wird die Mechanik, nicht der
   Wortlaut. setLanguage verhält sich wie das Original: Es meldet false, wenn
   die Zielsprache schon eingestellt ist oder das Laden scheitert. */
let aktuelleSprache = "de";
let ladenScheitert = false;

let statusNeuGeschrieben = 0;
vi.mock("../js/ui.js", () => ({
  statusNeuSchreiben: () => statusNeuGeschrieben++,
}));

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => aktuelleSprache,
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
  setLanguage: async (neu) => {
    if (!neu || neu === aktuelleSprache) return false;
    if (ladenScheitert) return false;
    aktuelleSprache = neu;
    document.documentElement.lang = neu;
    return true;
  },
}));

const { initSprachumschalter, zeigeSprachumschalter, istEingehaengt } = await import("../js/sprachumschalter.js");
const { state } = await import("../js/state.js");

/* Der echte Aufbau hat ein <main id="main">; setup.js kennt es nicht. */
function baueSeite() {
  setupDOM();
  const main = document.createElement("main");
  main.id = "main";
  document.body.insertBefore(main, document.body.firstChild);
}

function pille() {
  return document.querySelector(".sprach-pille");
}
function langKnopf(code) {
  return document.querySelector(`.sprach-knopf[data-lang="${code}"]`);
}
function sichtbaresModal() {
  return Array.from(document.querySelectorAll(".sw-grund")).find((el) => !el.hidden) || null;
}

let analysiert;

beforeEach(() => {
  aktuelleSprache = "de";
  document.documentElement.lang = "de";
  ladenScheitert = false;
  analysiert = [];
  baueSeite();
  state.isAnalyzing = false;
  state.uploadLaeuft = false;
  state.lastData = null;
  state.lastFile = null;
  try {
    sessionStorage.clear();
  } catch {
    /* jsdom ohne Speicher — die Tests dazu prüfen das gesondert */
  }
  initSprachumschalter({ analysiere: (datei) => analysiert.push(datei) });
});

afterEach(() => {
  zeigeSprachumschalter(false);
});

describe("Sprachumschalter — Merkmals-Schloss", () => {
  it("ohne Merkmal entsteht KEIN einziges Element", () => {
    expect(document.querySelectorAll(".sprach-pille, .sw-grund")).toHaveLength(0);
    expect(istEingehaengt()).toBe(false);
  });

  it("Positivkontrolle: mit Merkmal entstehen sie sehr wohl", () => {
    /* Ohne diese Gegenprobe wäre der Test oben auch dann grün, wenn der
       Umschalter überhaupt nicht mehr gebaut werden KANN. */
    zeigeSprachumschalter(true);
    expect(pille()).not.toBeNull();
    expect(document.querySelectorAll(".sw-grund")).toHaveLength(2);
  });

  it("der Schalter ist nie sichtbar-aber-wirkungslos: kein disabled-Zustand", () => {
    zeigeSprachumschalter(true);
    document.querySelectorAll(".sprach-knopf").forEach((b) => {
      expect(b.disabled).toBe(false);
      expect(b.getAttribute("aria-disabled")).toBeNull();
    });
  });

  it("die Konsolen-Tür steht auch ohne Merkmal offen und baut auf Zuruf", () => {
    expect(typeof window.malziME.sprachumschalter).toBe("function");
    window.malziME.sprachumschalter();
    expect(pille()).not.toBeNull();
    window.malziME.sprachumschalter(false);
    expect(pille()).toBeNull();
  });

  it("Aushängen lässt nichts zurück", () => {
    zeigeSprachumschalter(true);
    zeigeSprachumschalter(false);
    expect(document.querySelectorAll(".sprach-pille, .sw-grund, .sprachwahl")).toHaveLength(0);
  });
});

describe("Sprachumschalter — wann gefragt wird", () => {
  beforeEach(() => zeigeSprachumschalter(true));

  it("leere Seite: sofortiger Wechsel ohne Rückfrage", async () => {
    langKnopf("en").click();
    await vi.waitFor(() => expect(aktuelleSprache).toBe("en"));
    expect(sichtbaresModal()).toBeNull();
    expect(analysiert).toHaveLength(0);
  });

  it("laufende Analyse: Rückfrage statt Wechsel", () => {
    state.isAnalyzing = true;
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    expect(sichtbaresModal().dataset.modal).toBe("laeuft");
    expect(aktuelleSprache).toBe("de");
  });

  it("fertiges Profil: die Rückfrage ist als die folgenschwere erkennbar", () => {
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    const modal = sichtbaresModal();
    expect(modal.dataset.modal).toBe("fertig");
    /* Beide Rückfragen sahen gleich aus, deshalb las sie niemand. Die
       löschende trägt jetzt eine eigene Markierung. */
    expect(modal.querySelector(".sw-modal--fertig")).not.toBeNull();
    expect(modal.querySelector(".sw-modal--laeuft")).toBeNull();
  });

  it("laufender Upload zählt wie eine laufende Analyse", () => {
    state.uploadLaeuft = true;
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    expect(sichtbaresModal().dataset.modal).toBe("laeuft");
  });

  it("auch der Rückweg fragt, solange etwas auf dem Spiel steht", async () => {
    /* Nach dem Wechsel läuft eine Analyse auf Englisch. Zurück auf Deutsch
       würde sie genauso verwerfen wie der Hinweg — also wird wieder gefragt.
       Die Rückfrage erscheint jetzt englisch, weil das die aktuelle
       Oberflächensprache ist. */
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--wechseln").click();
    await vi.waitFor(() => expect(aktuelleSprache).toBe("en"));

    state.isAnalyzing = true;
    langKnopf("de").click();
    expect(sichtbaresModal()).not.toBeNull();
    expect(aktuelleSprache).toBe("en");
  });

  it("Klick auf die bereits eingestellte Sprache tut nichts", () => {
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    langKnopf("de").click();
    expect(sichtbaresModal()).toBeNull();
    expect(aktuelleSprache).toBe("de");
  });
});

describe("Sprachumschalter — Abbrechen hinterlässt nichts", () => {
  beforeEach(() => {
    zeigeSprachumschalter(true);
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
  });

  it("Abbrechen ändert weder Sprache noch Schalterstellung", () => {
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--bleiben").click();
    expect(aktuelleSprache).toBe("de");
    expect(langKnopf("de").classList.contains("aktiv")).toBe(true);
    expect(analysiert).toHaveLength(0);
  });

  it("das X schließt genauso", () => {
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-schliessen").click();
    expect(aktuelleSprache).toBe("de");
  });

  it("Escape schließt genauso", () => {
    langKnopf("en").click();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(aktuelleSprache).toBe("de");
  });

  it("der zweite Versuch fragt WIEDER in der aktuellen Sprache", () => {
    /* Der vom Nutzer gemeldete Fehler am Prototyp: Nach einem Abbruch kam die
       Rückfrage beim nächsten Mal auf Englisch, obwohl nie gewechselt wurde. */
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--bleiben").click();
    langKnopf("en").click();
    expect(aktuelleSprache).toBe("de");
    expect(document.documentElement.lang).not.toBe("en");
  });
});

describe("Sprachumschalter — Bestätigen", () => {
  beforeEach(() => {
    zeigeSprachumschalter(true);
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "foto.jpg" };
  });

  it("wechselt die Sprache und startet dieselbe Datei neu", async () => {
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--wechseln").click();
    await vi.waitFor(() => expect(aktuelleSprache).toBe("en"));
    expect(analysiert).toEqual([{ name: "foto.jpg" }]);
  });

  it("Rückfragen bleiben kurz — höchstens ein Satz Text", () => {
    /* Nutzer-Ansage 2026-08-13: „Das lässt sich niemals jemand durch." Ein
       Grenzwert im Test hält das fest, sonst wächst der Text unbemerkt wieder. */
    for (const art of ["fertig", "laeuft"]) {
      state.lastFile = { name: "a.jpg" };
      state.isAnalyzing = art === "laeuft";
      state.lastData = art === "fertig" ? { profileText: "x" } : null;
      langKnopf("en").click();
      const modal = sichtbaresModal();
      const absaetze = modal.querySelectorAll(".sw-modal p");
      expect(absaetze.length, `${art}: Anzahl Absätze`).toBeLessThanOrEqual(1);
      modal.querySelector(".sw-knopf--bleiben").click();
    }
  });

  it("scheitert das Laden der Sprachdatei, bleibt alles beim Alten", async () => {
    ladenScheitert = true;
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--wechseln").click();
    await vi.waitFor(() => expect(sichtbaresModal()).toBeNull());
    expect(aktuelleSprache).toBe("de");
    expect(analysiert).toHaveLength(0);
  });

  it("merkt die Wahl für das Neuladen im selben Tab", async () => {
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--wechseln").click();
    await vi.waitFor(() => expect(sessionStorage.getItem("malzime-sprache")).toBe("en"));
  });
});

describe("Sprachumschalter — Barrierefreiheit", () => {
  beforeEach(() => zeigeSprachumschalter(true));

  it("jeder Knopf trägt seine eigene Sprache als lang-Attribut", () => {
    expect(langKnopf("de").getAttribute("lang")).toBe("de");
    expect(langKnopf("en").getAttribute("lang")).toBe("en");
  });

  it("jeder Knopf hat eine Beschriftung, die nicht nur das Kürzel ist", () => {
    document.querySelectorAll(".sprach-knopf").forEach((b) => {
      const label = b.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label).not.toBe(b.textContent);
    });
  });

  it("die Gruppe ist benannt", () => {
    expect(pille().getAttribute("role")).toBe("group");
    expect(pille().getAttribute("aria-label")).toBeTruthy();
  });

  it("der Dialog ist als solcher ausgewiesen und beschriftet", () => {
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    const kasten = sichtbaresModal().querySelector(".sw-modal");
    expect(kasten.getAttribute("role")).toBe("dialog");
    expect(kasten.getAttribute("aria-modal")).toBe("true");
    const beschriftetVon = kasten.getAttribute("aria-labelledby");
    expect(document.getElementById(beschriftetVon)).not.toBeNull();
  });

  it("während der Rückfrage ist alles andere stillgelegt", () => {
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    const offen = sichtbaresModal();
    const andere = Array.from(document.body.children).filter((el) => el !== offen);
    expect(andere.length).toBeGreaterThan(0);
    andere.forEach((el) => expect(el.hasAttribute("inert")).toBe(true));
  });

  it("nach dem Schließen ist die Stilllegung restlos zurückgenommen", () => {
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--bleiben").click();
    Array.from(document.body.children).forEach((el) => {
      expect(el.hasAttribute("inert")).toBe(false);
    });
  });

  it("der Fokus landet im Dialog und kehrt danach auf den Schalter zurück", () => {
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    const ausloeser = langKnopf("en");
    ausloeser.focus();
    ausloeser.click();
    expect(sichtbaresModal().contains(document.activeElement)).toBe(true);
    sichtbaresModal().querySelector(".sw-knopf--bleiben").click();
    expect(document.activeElement).toBe(ausloeser);
  });

  it("der gemeldete Wechsel wird angesagt", async () => {
    langKnopf("en").click();
    await vi.waitFor(() => {
      const bereich = document.querySelector('[aria-live="polite"].sr-only');
      expect(bereich).not.toBeNull();
      expect(bereich.textContent).toBeTruthy();
    });
  });
});

describe("Sprachumschalter — Tür über die Adresse", () => {
  /* jsdom laesst window.location nicht ohne Weiteres umschreiben; die Adresse
     wird deshalb ueber history.replaceState gesetzt — genau das liest
     URLSearchParams. */
  function adresse(suche) {
    window.history.replaceState({}, "", suche || "/");
  }

  afterEach(() => {
    adresse("/");
    try {
      localStorage.removeItem("malzime-tuer-sprachumschalter");
    } catch {
      /* jsdom ohne Speicher */
    }
  });

  it("?sprachumschalter=1 blendet ihn ein, ohne Merkmal und ohne Konsole", () => {
    adresse("/?sprachumschalter=1");
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).not.toBeNull();
  });

  it("die Tür bleibt offen — auch ohne Anhängsel und in einem neuen Tab", () => {
    /* Der eigentliche Grund für den geräteweiten Speicher: Die Rechtsseiten
       öffnen mit target="_blank" rel="noopener" (index.html:348), und ein so
       geöffneter Tab bekommt einen LEEREN sessionStorage. Die erste Fassung
       legte die Spur dort ab — sie kam nie an. */
    adresse("/?sprachumschalter=1");
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).not.toBeNull();

    zeigeSprachumschalter(false);
    baueSeite();
    adresse("/");
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).toBeNull(); // aushängen schliesst die Tür ausdrücklich
  });

  it("?sprachumschalter=0 schliesst die Tür wieder", () => {
    adresse("/?sprachumschalter=1");
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).not.toBeNull();

    baueSeite();
    adresse("/?sprachumschalter=0");
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).toBeNull();
  });

  it("einmal geöffnet, gilt sie auch beim nächsten Aufruf ohne Anhängsel", async () => {
    adresse("/?sprachumschalter=1");
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).not.toBeNull();

    /* Ein echter neuer Seitenaufruf: frisches Modul, frisches DOM, kein
       Anhängsel mehr in der Adresse. Ohne vi.resetModules() glaubt das Modul,
       es sei noch eingehängt, und der Test bewiese nichts. */
    vi.resetModules();
    baueSeite();
    adresse("/datenschutz");
    const frisch = await import("../js/sprachumschalter.js");
    frisch.initSprachumschalter({ analysiere: () => {} });

    /* Der Schalter muss da sein — sonst ist er beim ersten Klick in die
       Fußleiste wieder weg, und genau das war der gemeldete Fehler. */
    expect(pille()).not.toBeNull();
  });

  it.each([
    ["0", "/?sprachumschalter=0"],
    ["false", "/?sprachumschalter=false"],
    ["leer", "/?sprachumschalter="],
    ["ganz ohne", "/"],
  ])("der Wert %s blendet ihn NICHT ein", (_name, suche) => {
    /* Streng, damit ein Tippfehler in einem herumgereichten Link kein
         Bedienelement vor ein Workshop-Publikum stellt. */
    adresse(suche);
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).toBeNull();
  });

  it("die Adresse verträgt sich mit ?lang=en", () => {
    adresse("/?lang=en&sprachumschalter=1");
    initSprachumschalter({ analysiere: () => {} });
    expect(pille()).not.toBeNull();
  });
});

describe("Sprachumschalter — nach einem Neuladen ist das Bild weg", () => {
  /* Vom Nutzer gefunden und dreimal nachgebessert:
     1. Die Rückfrage versprach eine Analyse, die nicht stattfinden konnte.
     2. Ein eigener Dialog verhandelte über etwas Unmögliches.
     3. Ohne Dialog blieb ein Profil in der alten Sprache stehen.
     Richtig ist: Das Profil wird gelöscht, man landet auf einer sauberen
     Startseite — dieselbe Rückfrage wie sonst, nur ein anderer Satz. */
  let zurueckgesetzt;

  beforeEach(() => {
    zurueckgesetzt = 0;
    initSprachumschalter({
      analysiere: (datei) => analysiert.push(datei),
      zuruecksetze: () => zurueckgesetzt++,
    });
    zeigeSprachumschalter(true);
    document.getElementById("facts").innerHTML = '<div class="cat-card"></div>';
    state.lastData = { profileText: "x" };
    state.lastFile = null;
  });

  it("es kommt die Löschen-Rückfrage, nicht die mit dem Neuanalyse-Versprechen", () => {
    langKnopf("en").click();
    const modal = sichtbaresModal();
    expect(modal.dataset.modal).toBe("fertig");
    expect(modal.querySelector("p").dataset.swKeyHtml).toBe("sprache.fertig.textOhneBild");
  });

  it("mit Bild steht dort der andere Satz", () => {
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    expect(sichtbaresModal().querySelector("p").dataset.swKeyHtml).toBe("sprache.fertig.text");
  });

  it("bestätigen setzt zurück, statt eine unmögliche Analyse zu starten", async () => {
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--wechseln").click();
    await vi.waitFor(() => expect(zurueckgesetzt).toBe(1));
    expect(analysiert).toHaveLength(0);
  });

  it("abbrechen setzt nichts zurück", () => {
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--bleiben").click();
    expect(zurueckgesetzt).toBe(0);
    expect(aktuelleSprache).toBe("de");
  });

  it("mit Bild wird analysiert und NICHT zurückgesetzt", async () => {
    state.lastFile = { name: "foto.jpg" };
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--wechseln").click();
    await vi.waitFor(() => expect(analysiert).toHaveLength(1));
    expect(zurueckgesetzt).toBe(0);
  });
});

describe("Sprachumschalter — stehende Meldungen wechseln mit", () => {
  /* Gefunden beim Durchgang durch alle Zustände der echten Anwendung
     (2026-08-13): Nach einem Fehlschlag stand die Fehlermeldung weiter auf
     Deutsch, während die Seite auf Englisch umschaltete. Eine einmal gesetzte
     Zeichenkette, die niemand mehr anfasst. */
  beforeEach(() => {
    statusNeuGeschrieben = 0;
    zeigeSprachumschalter(true);
  });

  it("jeder Wechsel schreibt die Statuszeile neu", async () => {
    langKnopf("en").click();
    await vi.waitFor(() => expect(aktuelleSprache).toBe("en"));
    expect(statusNeuGeschrieben).toBe(1);
  });

  it("ein abgebrochener Wechsel schreibt nichts neu", () => {
    state.lastData = { profileText: "x" };
    state.lastFile = { name: "a.jpg" };
    langKnopf("en").click();
    sichtbaresModal().querySelector(".sw-knopf--bleiben").click();
    expect(statusNeuGeschrieben).toBe(0);
  });
});

describe("Sprachumschalter — die Rückfrage handelt vom Sprachwechsel", () => {
  /* Ein Anlauf setzte die Löschwarnung als Überschrift. Vor jemandem, der nur
     die Sprache wechseln wollte, stand damit eine Schreckmeldung ohne
     Zusammenhang — und der Bestätigungsknopf hiess „Neu analysieren", obwohl
     nach einem Neuladen gar nichts analysiert werden kann. */
  const faelle = [
    ["fertig, Bild da", { lastData: { profileText: "x" }, lastFile: { name: "a.jpg" } }],
    ["fertig, Bild weg", { lastData: { profileText: "x" }, lastFile: null }],
    ["Analyse läuft", { isAnalyzing: true, lastFile: { name: "a.jpg" } }],
  ];

  it.each(faelle)("%s: Überschrift und Knöpfe sind dieselben", (_name, zustand) => {
    zeigeSprachumschalter(true);
    Object.assign(state, zustand);
    langKnopf("en").click();
    const modal = sichtbaresModal();
    expect(modal).not.toBeNull();
    expect(modal.querySelector("h2").dataset.swKey).toMatch(/^sprache\.(fertig|laeuft)\.titel$/);
    /* Immer derselbe Bestätigungstext — der Nutzer bestätigt den
       SPRACHWECHSEL, nicht wechselnde Nebenwirkungen. */
    expect(modal.querySelector(".sw-knopf--wechseln").dataset.swKey).toMatch(/^sprache\.(fertig|laeuft)\.wechseln$/);
    expect(modal.querySelector(".sw-knopf--bleiben").dataset.swKey).toMatch(/^sprache\.(fertig|laeuft)\.bleiben$/);
  });
});
