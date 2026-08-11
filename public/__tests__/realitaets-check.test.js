import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import { setupDOM } from "./setup.js";

/* i18n mocken — Schlüssel statt Texte; Parameter werden angehängt, damit
   Prozentwerte in Ansagen prüfbar bleiben. */
vi.mock("../js/i18n.js", () => ({
  t: (key, params) => (params ? key + "|" + Object.values(params).join(",") : key),
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

/* Klang nur als Spione — die Ton-Erzeugung selbst prüft klang.test.js. */
vi.mock("../js/klang.js", () => ({
  klangAktivieren: vi.fn(),
  tippTon: vi.fn(),
  popTon: vi.fn(),
}));

/* Der Modus kommt sonst aus ui.js (Beast-Schalter) — hier direkt steuerbar. */
const modusRef = vi.hoisted(() => ({ wert: "normal" }));
vi.mock("../js/ui.js", () => ({
  getBiasMode: () => modusRef.wert,
}));

/* Telemetrie als Spion — geprüft wird, WAS gesendet würde, nicht das Netz. */
vi.mock("../js/telemetry-logger.js", () => ({
  logTelemetry: vi.fn(),
  logRealitaetsCheck: vi.fn(),
}));

const __dirname2 = dirname(fileURLToPath(import.meta.url));

/* Ein echtes Menschen-Profil wie aus der Analyse. */
function menschDaten(ueberschreiben = {}) {
  return {
    profiles: {
      normal: {
        profileText: "Profiltext normal",
        categories: {
          alter_geschlecht: {
            label: "Alter & Geschlecht",
            value: "weiblich, ~24 Jahre (Spanne 22-26)",
            confidence: 0.8,
          },
          interessen: { label: "Interessen", value: "Reisen, Fotografie, Kaffee-Kultur", confidence: 0.7 },
          charakterzuege: { label: "Charakter", value: "diszipliniert im Alltag, impulsiv am Abend", confidence: 0.6 },
        },
        ad_targeting: ["Reise-Angebote", "Kaffee-Abo", "Foto-Kurs", "Rucksack-Sale"],
        manipulation_triggers: ["Countdown-Angebote wirken am Abend", "Zweiter Trigger"],
      },
      boost: {
        profileText: "Profiltext beast",
        categories: {
          alter_geschlecht: { label: "Alter & Geschlecht", value: "weiblich, ~24 - beste Zielgruppe", confidence: 0.9 },
          interessen: { label: "Interessen", value: "Beast-Interessen", confidence: 0.9 },
          charakterzuege: { label: "Charakter", value: "Beast-Charakter", confidence: 0.9 },
        },
        ad_targeting: ["Sofortkredit", "Diaet-Shake"],
        manipulation_triggers: ["Beast-Trigger"],
      },
    },
    meta: { mode: "multimodal" },
    ...ueberschreiben,
  };
}

describe("Realitäts-Check (v3.1)", () => {
  let rc, elements, state, telemetrie;
  let echteMatchMedia;
  /* Der Absenden-Knopf lebt (wie alle dom.js-Referenzen) über die Tests
     hinweg — der Klick-Listener darf nur EINMAL verdrahtet werden. */
  let verdrahtet = false;

  beforeEach(async () => {
    setupDOM();
    rc = await import("../js/realitaets-check.js");
    ({ elements } = await import("../js/dom.js"));
    ({ state } = await import("../js/state.js"));
    telemetrie = await import("../js/telemetry-logger.js");

    /* Geteilte Referenzen zwischen den Tests sauber zurücksetzen. */
    rc.zuruecksetzen();
    elements.srAnnounce.textContent = "";
    modusRef.wert = "normal";
    state.statsDaten = null;
    echteMatchMedia = window.matchMedia;
    /* Standard: reduzierte Bewegung — Ring/Balken stehen sofort auf dem
       Endwert, die Tests bleiben deterministisch. */
    window.matchMedia = () => ({ matches: true });
    if (!verdrahtet) {
      rc.initRealitaetsCheck();
      verdrahtet = true;
    }
  });

  afterEach(() => {
    rc.zuruecksetzen();
    window.matchMedia = echteMatchMedia;
    vi.clearAllMocks();
  });

  /* Hilfen: Zeilen und Knöpfe aus dem gebauten DOM greifen. */
  function zeilen() {
    return Array.from(elements.rcZeilen.querySelectorAll(".rc-zeile"));
  }
  function knoepfe(zeile) {
    return Array.from(zeile.querySelectorAll(".rc-knopf"));
  }
  function beantworteAlle(wahlProZeile) {
    zeilen().forEach((zeile, i) => {
      const wahl = Array.isArray(wahlProZeile) ? wahlProZeile[i] : wahlProZeile;
      knoepfe(zeile)[wahl].click();
    });
  }

  /* ── Erscheinen ──────────────────────────────────────────────────────── */

  it("erscheint bei einem echten Menschen-Profil mit 6 Zeilen samt Zitaten", () => {
    rc.neuesErgebnis(menschDaten());
    expect(elements.realCheck.hidden).toBe(false);
    expect(zeilen()).toHaveLength(6);
    /* Zitat aus dem aktiven Modus (normal), gekürzt auf ~70 Zeichen. */
    const erstesZitat = zeilen()[0].querySelector(".rc-zitat");
    expect(erstesZitat.textContent).toContain("weiblich, ~24 Jahre");
    zeilen().forEach((z) => {
      const zitat = z.querySelector(".rc-zitat");
      if (zitat) expect(zitat.textContent.length).toBeLessThanOrEqual(70);
    });
  });

  it("bleibt bei Tier-Profil, blocked und leerem Profil verborgen", () => {
    rc.neuesErgebnis(menschDaten({ meta: { mode: "animal" } }));
    expect(elements.realCheck.hidden).toBe(true);

    rc.neuesErgebnis({ blockedReason: "blocked.generic" });
    expect(elements.realCheck.hidden).toBe(true);

    rc.neuesErgebnis({ profiles: { normal: { profileText: "  ", categories: {} } } });
    expect(elements.realCheck.hidden).toBe(true);
  });

  it("die Geschlecht-Zeile entfällt bei „nicht eindeutig“ — der Score kommt aus 5 Zeilen", () => {
    const daten = menschDaten();
    daten.profiles.normal.categories.alter_geschlecht.value = "Geschlecht nicht eindeutig erkennbar, ~24 Jahre";
    rc.neuesErgebnis(daten);
    expect(zeilen()).toHaveLength(5);
    /* 4× Getroffen (1) + 1× Knapp (0,5) = 4,5 / 5 → 90 % */
    beantworteAlle([0, 0, 0, 0, 1]);
    elements.rcAbsenden.click();
    expect(elements.rcProzent.textContent).toBe("90");
  });

  /* ── Scoring ─────────────────────────────────────────────────────────── */

  it("Geschlecht ist binär: zwei Knöpfe, Daneben sitzt in Spalte 3", () => {
    rc.neuesErgebnis(menschDaten());
    const geschlechtZeile = zeilen()[1];
    const k = knoepfe(geschlechtZeile);
    expect(k).toHaveLength(2);
    expect(k[1].className).toContain("spalte3");
  });

  it("rechnet den Score über alle Stufen (inkl. binärer Geschlecht-Zeile)", () => {
    rc.neuesErgebnis(menschDaten());
    /* alter=1, geschlecht=0 (Knopf 2 der Binär-Zeile), interessen=0,5,
       charakter=0,5, werbung=1, manipulation=0 → 3,0 / 6 → 50 % */
    const z = zeilen();
    knoepfe(z[0])[0].click();
    knoepfe(z[1])[1].click();
    knoepfe(z[2])[1].click();
    knoepfe(z[3])[1].click();
    knoepfe(z[4])[0].click();
    knoepfe(z[5])[2].click();
    elements.rcAbsenden.click();
    expect(elements.rcProzent.textContent).toBe("50");
    /* Und der anonyme Zähler bekommt AUSSCHLIESSLICH die Stufen. */
    expect(telemetrie.logRealitaetsCheck).toHaveBeenCalledTimes(1);
    expect(telemetrie.logRealitaetsCheck).toHaveBeenCalledWith({
      alter: 1,
      geschlecht: 0,
      interessen: 0.5,
      charakter: 0.5,
      werbung: 1,
      manipulation: 0,
    });
  });

  it("volle Trefferquote: 6× Getroffen ergibt 100 % samt einmaliger Ansage", () => {
    rc.neuesErgebnis(menschDaten());
    beantworteAlle(0);
    elements.rcAbsenden.click();
    expect(elements.rcProzent.textContent).toBe("100");
    /* A11y: die EINE Ansage nach der Auswertung enthält die Prozentzahl. */
    expect(elements.srAnnounce.textContent).toBe("rc.srErgebnis|100");
  });

  /* ── Absenden-Sperre ─────────────────────────────────────────────────── */

  it("der Absenden-Knopf wird erst mit einer Antwort in JEDER Zeile aktiv", () => {
    rc.neuesErgebnis(menschDaten());
    expect(elements.rcAbsenden.disabled).toBe(true);
    const z = zeilen();
    for (let i = 0; i < z.length - 1; i++) knoepfe(z[i])[0].click();
    expect(elements.rcAbsenden.disabled).toBe(true);
    knoepfe(z[z.length - 1])[0].click();
    expect(elements.rcAbsenden.disabled).toBe(false);
  });

  it("vor dem Absenden sind Antworten änderbar, danach eingefroren", () => {
    rc.neuesErgebnis(menschDaten());
    const ersteZeile = zeilen()[0];
    const [getroffen, knapp] = knoepfe(ersteZeile);

    /* Vorher: Umentscheiden wirkt (aria-pressed wandert mit). */
    getroffen.click();
    expect(getroffen.getAttribute("aria-pressed")).toBe("true");
    knapp.click();
    expect(getroffen.getAttribute("aria-pressed")).toBe("false");
    expect(knapp.getAttribute("aria-pressed")).toBe("true");

    /* Alle übrigen beantworten und absenden. */
    zeilen()
      .slice(1)
      .forEach((zeile) => knoepfe(zeile)[0].click());
    elements.rcAbsenden.click();
    expect(elements.realCheck.classList.contains("rc-gesperrt")).toBe(true);
    expect(elements.rcAbsenden.hidden).toBe(true);

    /* Nachher: eingefroren — kein Klick ändert mehr etwas, und es wird
       nichts erneut gesendet (Statistik-Schutz). */
    getroffen.click();
    expect(getroffen.getAttribute("aria-pressed")).toBe("false");
    expect(knapp.getAttribute("aria-pressed")).toBe("true");
    expect(telemetrie.logRealitaetsCheck).toHaveBeenCalledTimes(1);
  });

  it("ein unvollständiger Check lässt sich nicht absenden (kein Ergebnis, keine Telemetrie)", () => {
    rc.neuesErgebnis(menschDaten());
    knoepfe(zeilen()[0])[0].click();
    elements.rcAbsenden.click();
    expect(elements.rcErgebnis.hidden).toBe(true);
    expect(telemetrie.logRealitaetsCheck).not.toHaveBeenCalled();
  });

  /* ── Moduswechsel ────────────────────────────────────────────────────── */

  it("vor dem Absenden folgen die Zitate dem neuen Modus, die Antworten bleiben", () => {
    const daten = menschDaten();
    rc.neuesErgebnis(daten);
    knoepfe(zeilen()[0])[0].click();
    expect(zeilen()[0].querySelector(".rc-zitat").textContent).toContain("Spanne 22-26");

    modusRef.wert = "boost";
    rc.modusGewechselt(daten);
    expect(zeilen()[0].querySelector(".rc-zitat").textContent).toContain("beste Zielgruppe");
    /* Die gegebene Antwort hat den Wechsel überlebt. */
    expect(knoepfe(zeilen()[0])[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("nach dem Absenden ändert der Moduswechsel die Zitate NICHT mehr (eingefroren)", () => {
    const daten = menschDaten();
    rc.neuesErgebnis(daten);
    beantworteAlle(0);
    elements.rcAbsenden.click();

    modusRef.wert = "boost";
    rc.modusGewechselt(daten);
    expect(zeilen()[0].querySelector(".rc-zitat").textContent).toContain("Spanne 22-26");
  });

  /* ── Reset ───────────────────────────────────────────────────────────── */

  it("ein neues Ergebnis setzt alles zurück: Antworten, Sperre, Ergebnis, Knopf", () => {
    rc.neuesErgebnis(menschDaten());
    beantworteAlle(0);
    elements.rcAbsenden.click();
    expect(elements.rcErgebnis.hidden).toBe(false);

    rc.neuesErgebnis(menschDaten());
    expect(elements.realCheck.hidden).toBe(false);
    expect(elements.realCheck.classList.contains("rc-gesperrt")).toBe(false);
    expect(elements.realCheck.classList.contains("rc-abgesendet")).toBe(false);
    expect(elements.rcErgebnis.hidden).toBe(true);
    expect(elements.rcAbsenden.hidden).toBe(false);
    expect(elements.rcAbsenden.disabled).toBe(true);
    expect(elements.rcZeilen.querySelectorAll(".rc-knopf.gewaehlt")).toHaveLength(0);
    expect(elements.rcProzent.textContent).toBe("0");
  });

  /* ── 100-Eingaben-Regel ──────────────────────────────────────────────── */

  it("unter 100 Eingaben erscheint der Hinweis-Satz statt des Vergleichsbalkens", () => {
    state.statsDaten = { realitaetsCheck: { eingaben: 99, mittelProzent: 58 } };
    rc.neuesErgebnis(menschDaten());
    beantworteAlle(0);
    elements.rcAbsenden.click();
    expect(elements.rcWenige.hidden).toBe(false);
    expect(elements.rcVergleich.hidden).toBe(true);
  });

  it("ab 100 Eingaben erscheint der Vergleichsbalken mit dem Durchschnitt", () => {
    state.statsDaten = { realitaetsCheck: { eingaben: 100, mittelProzent: 58 } };
    rc.neuesErgebnis(menschDaten());
    beantworteAlle(0);
    elements.rcAbsenden.click();
    expect(elements.rcVergleich.hidden).toBe(false);
    expect(elements.rcWenige.hidden).toBe(true);
    expect(elements.rcBalkenAndere.style.width).toBe("58%");
    expect(elements.rcAndereWert.textContent).toBe("rc.andereWert|58");
    expect(elements.rcDuWert.textContent).toBe("rc.duWert|100");
  });

  /* ── Zitat-Escaping ──────────────────────────────────────────────────── */

  it("eine XSS-Nutzlast im Profilwert bleibt reiner Text im Zitat", () => {
    const daten = menschDaten();
    daten.profiles.normal.categories.interessen.value = '<img src=x onerror="window.xssTreffer=1">';
    rc.neuesErgebnis(daten);
    /* Kein <img> im DOM — die Nutzlast steht wortwörtlich als Text da. */
    expect(elements.rcZeilen.querySelector("img")).toBeNull();
    const zitat = zeilen()[2].querySelector(".rc-zitat");
    expect(zitat.textContent).toContain("<img src=x");
    expect(window.xssTreffer).toBeUndefined();
  });

  /* ── Print ───────────────────────────────────────────────────────────── */

  it("Print: die Karte erhält rc-abgesendet erst mit dem Absenden, und styles.css blendet Unabgesendetes im Druck aus", () => {
    rc.neuesErgebnis(menschDaten());
    expect(elements.realCheck.classList.contains("rc-abgesendet")).toBe(false);
    beantworteAlle(0);
    elements.rcAbsenden.click();
    expect(elements.realCheck.classList.contains("rc-abgesendet")).toBe(true);

    /* Die Druckregel selbst: nur die abgesendete Karte darf ins PDF. */
    const css = readFileSync(resolve(__dirname2, "../styles.css"), "utf-8");
    const printBlock = css.slice(css.indexOf("@media print"));
    expect(printBlock).toContain(".rc-karte:not(.rc-abgesendet)");
  });
});
