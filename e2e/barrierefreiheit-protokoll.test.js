/**
 * barrierefreiheit-protokoll.test.js — das MESSWERKZEUG für das Prüfprotokoll.
 *
 * Unterschied zu `a11y.test.js`: Der dortige Lauf ist ein GATE — er bricht bei
 * ernsten Verstößen und deckt zwei Bildschirme ab. Diese Datei misst die
 * BREITE: jeden Bildschirm, jeden Zustand, gegen den ausdrücklich benannten
 * Standard WCAG 2.2 AA, und schreibt das Ergebnis als Datei weg. Aus dieser
 * Datei entsteht das Prüfprotokoll — nicht aus Erinnerung.
 *
 * Sie bricht bewusst NICHT bei Funden. Ein Protokoll, das nur entsteht, wenn
 * alles grün ist, wäre kein Protokoll, sondern eine Behauptung. Gefundene
 * Mängel gehören dokumentiert und dann behoben; erst danach werden sie zu
 * Gate-Prüfungen.
 *
 * Ausführen:  npx playwright test e2e/barrierefreiheit-protokoll.test.js --project=chromium
 * Ergebnis:   e2e/.protokoll/befunde.json
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* Bewusst über das Arbeitsverzeichnis statt über `import.meta.url`: Playwright
   lädt die Testdateien nicht als echte ES-Module, `import.meta` wirft dort. */
const AUSGABE = join(process.cwd(), "e2e", ".protokoll");

/* Genau die Stufe, die wir zusagen — nicht mehr und nicht weniger. Ohne diese
   Marken misst axe auch „best-practice"-Regeln, die zu KEINEM Standard
   gehören; ein Protokoll, das die mitzählt, misst etwas anderes, als es
   behauptet. */

/* Misst die WIRKLICHE Trefferflaeche, nicht die gemalte Box.
   Anlass: Die Sprachknoepfe sind sichtbar 44 x 21 gross, ihre tastbare Flaeche
   ist ueber ein unsichtbares `::after` aber 44 x 44 — genau so, wie es das
   Kriterium meint. Eine Messung an `getBoundingClientRect()` haette sie als
   Mangel gemeldet, obwohl sie erfuellt sind. Getastet wird deshalb mit
   `elementFromPoint` von der Mitte nach aussen: Was auf einen Zeiger reagiert,
   zaehlt — was nur gemalt ist, nicht. */
const TREFFERFLAECHE_JS = `
function trefferflaeche(el) {
  const r = el.getBoundingClientRect();
  const mx = Math.round(r.left + r.width / 2);
  const my = Math.round(r.top + r.height / 2);
  const trifft = (x, y) => {
    const t = document.elementFromPoint(x, y);
    return t === el || (t && (el.contains(t) || t.contains(el)));
  };
  if (!trifft(mx, my)) return { breite: Math.round(r.width), hoehe: Math.round(r.height), getastet: false };
  const tasten = (dx, dy) => {
    let n = 0;
    while (n < 40 && trifft(mx + dx * (n + 1), my + dy * (n + 1))) n++;
    return n;
  };
  return {
    breite: tasten(-1, 0) + tasten(1, 0) + 1,
    hoehe: tasten(0, -1) + tasten(0, 1) + 1,
    getastet: true,
  };
}
`;

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const PROFIL = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre, männlich", confidence: 0.8 },
        herkunft: { label: "Herkunft", value: "Mitteleuropa", confidence: 0.6 },
        interessen: { label: "Interessen", value: "Outdoor, Fotografie", confidence: 0.7 },
      },
      ad_targeting: ["Outdoor-Werbung", "Reise-Angebote"],
      manipulation_triggers: ["FOMO", "Statusvergleich"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre, männlich", confidence: 0.9 },
        herkunft: { label: "Herkunft", value: "Mitteleuropa", confidence: 0.9 },
      },
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Mode-Profil mit deutlicher Sprache.",
    },
  },
  privacyRisks: [{ type: "text", label: "Sichtbarer Text", detail: "Kennzeichen erkennbar" }],
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "protokoll-1", mode: "multimodal", subject: "HUMAN" },
};

/** Alles, was gemessen wurde — wird am Ende als JSON weggeschrieben. */
const befunde = [];

function statsAntwort(zusatz = {}) {
  return {
    current: { count: 10, limit: 500, limitActive: false, retryAfterSeconds: 0 },
    totals: { today: 10, week: 50, month: 200, total: 1000 },
    useQueue: true,
    sprachumschalter: true,
    ...zusatz,
  };
}

async function endpunkteStellen(page, { jobStatus = { status: "done", result: PROFIL } } = {}) {
  await page.route("**/api/stats", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statsAntwort()) })
  );
  await page.route("**/api/enqueue", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "protokoll-job", resultToken: "protokoll-token" }),
    })
  );
  await page.route("**/api/job-status**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jobStatus) })
  );
  await page.route("**/nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.route("**/tile.openstreetmap.org/**", (r) => r.fulfill({ status: 200, body: "" }));
}

/* ── Abstentionen aufloesen ────────────────────────────────────────────────
   axe meldet Kontrast als "unpruefbar", wenn es den Hintergrund nicht
   bestimmen kann — Verlauf, Bild, ueberlappende Schichten, Halbtransparenz.
   Das ist KEIN Bestehen. In der ersten Fassung des Protokolls wurden nur die
   Verstoesse gezaehlt und daraus "0 Verstoesse" gemacht, waehrend 6 bis 13
   Abstentionen je Seite unbeantwortet liegen blieben. Der unabhaengige
   Zweitpruefer meldete genau dort einen Fehler.

   Hier entscheidet die Messung statt der Vermutung: Das Element wird
   fotografiert, das Foto in eine Leinwand gelegt und Bildpunkt fuer Bildpunkt
   ausgelesen. Hellster und dunkelster Punkt sind Hintergrund und Schrift; ihr
   Verhaeltnis ist der Kontrast nach der Formel der WCAG. Antialiasing erzeugt
   Zwischentoene, die zwischen beiden liegen und das Ergebnis nicht verfaelschen
   koennen. */
function leuchtdichte(r, g, b) {
  const k = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
}

async function kontrastAusBildpunkten(page, waehler) {
  const el = page.locator(waehler).first();
  if (!(await el.count())) return null;
  if (!(await el.isVisible().catch(() => false))) return null;

  let png;
  try {
    png = await el.screenshot({ timeout: 5000 });
  } catch {
    return null; /* Element nicht fotografierbar (0 Pixel, ausserhalb) */
  }

  /* Das Foto zurueck in die Seite geben und dort auslesen — so braucht die
     Messung keine zusaetzliche Bibliothek zum Entpacken von PNG. */
  const punkte = await page.evaluate(async (b64) => {
    const bild = new Image();
    bild.src = "data:image/png;base64," + b64;
    await bild.decode();
    const c = document.createElement("canvas");
    c.width = bild.naturalWidth;
    c.height = bild.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bild, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const raus = [];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 250) continue; /* halbtransparente Punkte taugen nicht */
      raus.push([d[i], d[i + 1], d[i + 2]]);
    }
    return raus;
  }, png.toString("base64"));

  if (punkte.length < 4) return null;

  let hell = -1;
  let dunkel = 2;
  for (const [r, g, b] of punkte) {
    const l = leuchtdichte(r, g, b);
    if (l > hell) hell = l;
    if (l < dunkel) dunkel = l;
  }
  return Number(((hell + 0.05) / (dunkel + 0.05)).toFixed(2));
}

/* Schriftgroesse und -staerke entscheiden, welche Schwelle gilt: 3:1 fuer
   grossen Text (ab 24 px, oder ab 18.66 px fett), sonst 4.5:1. */
async function schwelleFuer(page, waehler) {
  return page
    .locator(waehler)
    .first()
    .evaluate((n) => {
      const s = getComputedStyle(n);
      const px = parseFloat(s.fontSize);
      const fett = parseInt(s.fontWeight, 10) >= 700;
      return (fett && px >= 18.66) || px >= 24 ? 3 : 4.5;
    })
    .catch(() => 4.5);
}

/* Benannte Ausnahmen — jede mit Grund, jede einzeln. Bewusst eine Liste im
   Quelltext und keine stille Regel wie "alles mit aria-hidden ueberspringen":
   Wer hier etwas eintraegt, muss eine Begruendung danebenschreiben, und die
   steht dann im Diff. Eine unsichtbare Sammelausnahme waere genau der
   Mechanismus, mit dem ein Protokoll unbemerkt wertlos wird. */
const KONTRAST_AUSNAHMEN = [
  {
    passt: (waehler) => waehler.includes(".footer-sep"),
    grund:
      "Der Mittelpunkt zwischen den Fusszeilen-Links ist reine Zierde: Er traegt keine " +
      "Information — die Links sind eigene Elemente und ohne ihn genauso getrennt — und " +
      "hat keine Funktion. WCAG 1.4.3 nimmt reine Zierde ausdruecklich aus. Im Markup " +
      'als aria-hidden="true" ausgewiesen, damit die Ausnahme dort steht, wo sie gilt, ' +
      "und damit Screenreader nicht zwischen jedem Link einen Punkt vorlesen.",
  },
];

async function abstentionenAufloesen(page, incomplete) {
  const offen = [];
  for (const regel of incomplete) {
    if (regel.id !== "color-contrast") {
      /* Andere Abstentionen sind selten und brauchen ein Augenpaar — sie
         werden benannt, nicht weggerechnet. */
      offen.push({ regel: regel.id, elemente: regel.nodes.length, aufloesung: "Handpruefung noetig" });
      continue;
    }
    for (const knoten of regel.nodes) {
      const waehler = knoten.target.join(" ");
      const ausnahme = KONTRAST_AUSNAHMEN.find((a) => a.passt(waehler));
      if (ausnahme) {
        offen.push({ regel: regel.id, element: waehler, aufloesung: "Ausnahme: " + ausnahme.grund });
        continue;
      }
      const gemessen = await kontrastAusBildpunkten(page, waehler);
      if (gemessen == null) {
        offen.push({ regel: regel.id, element: waehler, aufloesung: "nicht messbar" });
        continue;
      }
      const schwelle = await schwelleFuer(page, waehler);
      if (gemessen + 0.01 < schwelle) {
        offen.push({
          regel: regel.id,
          element: waehler,
          gemessen,
          verlangt: schwelle,
          aufloesung: "VERSTOSS, durch Bildpunkt-Messung bestaetigt",
        });
      }
    }
  }
  return offen;
}

/**
 * Misst EINEN Zustand und legt das Ergebnis ab.
 *
 * Wichtig: Vor jeder Messung laufen alle Animationen zu Ende. Ohne das misst
 * axe mitten in einer Einblendung und meldet Kontrast 1:1 an halbtransparentem
 * Text — Schein-Funde, die schon einmal 19 Stück ausgemacht haben.
 */
async function messen(page, bildschirm, zustand) {
  await beruhigen(page);
  /* ZWEIMAL messen und nur uebernehmen, was BEIDE Male auftritt.
     Grund: Der erste Aufbau meldete 17 Kontrast-Verstoesse, die in einem
     sauberen Einzellauf nicht reproduzierbar waren — axe erwischte Elemente in
     einem Zwischenzustand. Ein Protokoll mit Schein-Funden ist schlimmer als
     keines: Es kostet Vertrauen und Arbeitszeit an Stellen, die in Ordnung
     sind. Was nur einmal auftritt, wandert nach `wackelig` statt in die
     Befundliste. */
  const lauf1 = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  await beruhigen(page);
  const lauf2 = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();

  const schluessel = (v) =>
    v.id +
    "|" +
    v.nodes
      .map((n) => n.target.join(" "))
      .sort()
      .join(";");
  const zweite = new Set(lauf2.violations.map(schluessel));
  const stabil = lauf1.violations.filter((v) => zweite.has(schluessel(v)));
  const wackelig = lauf1.violations
    .filter((v) => !zweite.has(schluessel(v)))
    .concat(lauf2.violations.filter((v) => !new Set(lauf1.violations.map(schluessel)).has(schluessel(v))));

  const eintrag = {
    bildschirm,
    zustand,
    geprueft: lauf1.passes.length,
    unpruefbar: lauf1.incomplete.map((v) => ({ regel: v.id, elemente: v.nodes.length })),
    /* Jede Abstention einzeln aufgeloest — leer heisst: alle geklaert. */
    abstentionOffen: await abstentionenAufloesen(page, lauf1.incomplete),
    wackelig: wackelig.map((v) => ({ regel: v.id, anzahl: v.nodes.length })),
    verstoesse: stabil.map((v) => ({
      regel: v.id,
      impact: v.impact,
      beschreibung: v.help,
      kriterium: v.tags.filter((t) => t.startsWith("wcag")).join(" "),
      elemente: v.nodes.map((n) => n.target.join(" ")).slice(0, 8),
      anzahl: v.nodes.length,
    })),
  };
  /* POSITIVKONTROLLE, kein Formalismus: Liefert axe null geprueffte Regeln,
     ist die Messung gescheitert — und ein leeres Ergebnis sieht genau aus wie
     "keine Verstoesse". Ohne diese Zeile waere ein kaputter Lauf ein
     Musterprotokoll. */
  expect(eintrag.geprueft, `axe hat auf ${bildschirm}/${zustand} nichts geprueft`).toBeGreaterThan(0);
  /* Eine Abstention, die sich als Verstoss herausstellt, ist ein Verstoss —
     und muss den Lauf rot machen, sonst haette der Auflöser keine Wirkung. */
  const bestaetigt = eintrag.abstentionOffen.filter((a) => a.aufloesung.startsWith("VERSTOSS"));
  expect(bestaetigt, `Kontrast zu schwach auf ${bildschirm}/${zustand}: ${JSON.stringify(bestaetigt)}`).toEqual([]);
  befunde.push(eintrag);
  return eintrag;
}

/**
 * Wartet, bis wirklich nichts mehr in Bewegung ist.
 *
 * `document.getAnimations()` allein genuegt nicht: Eine Animation, die erst im
 * naechsten Bildschirmrahmen beginnt, steht dort noch nicht drin. Deshalb zwei
 * Rahmen abwarten, DANN auf alle laufenden warten, und das Ganze zweimal.
 */
async function beruhigen(page) {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f))));
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  }
}

/**
 * WCAG 2.2, 2.5.8 Zielgroesse (Minimum), Stufe AA: mindestens 24 x 24
 * CSS-Pixel — MIT den Ausnahmen des Kriteriums. Die erste Fassung dieser
 * Messung liess sie weg und meldete dutzende Textlinks als Maengel. Das ist
 * kein Detail: Ein Pruefmittel, das Fehlalarm schlaegt, wird abgeschaltet.
 *
 * Umgesetzte Ausnahmen:
 *   - INLINE: Das Ziel steht in einem Satz oder seine Groesse ist durch die
 *     Zeilenhoehe des umgebenden Textes bestimmt. Erkannt daran, dass der
 *     Elternknoten neben dem Link noch eigenen Text traegt oder der Link ueber
 *     mehrere Zeilen umbricht.
 *   - ABSTAND: Ein Kreis von 24 px Durchmesser um die Mitte des Ziels
 *     ueberschneidet keinen solchen Kreis eines anderen Ziels.
 *
 * Nicht umgesetzt (und deshalb im Protokoll als Vorbehalt genannt): die
 * Ausnahmen "gleichwertige Alternative" und "wesentlich" — beide lassen sich
 * nicht maschinell entscheiden.
 */
async function zielgroessenMessen(page, bildschirm) {
  await beruhigen(page);
  const ergebnis = await page.evaluate((tf) => {
    eval(tf);
    const els = Array.from(document.querySelectorAll("a, button, input, [role='button'], label")).filter((el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
    });
    const mitten = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    function istInline(el) {
      if (el.getClientRects().length > 1) return true;
      if (getComputedStyle(el).display !== "inline") return false;
      const p = el.parentElement;
      if (!p) return false;
      return (p.textContent || "").trim().length > (el.textContent || "").trim().length + 2;
    }
    function abstandReicht(i) {
      const a = mitten[i];
      return !mitten.some((b, j) => j !== i && Math.hypot(a.x - b.x, a.y - b.y) < 24);
    }
    const zuKlein = [];
    const ausgenommen = [];
    els.forEach((el, i) => {
      /* eslint-disable no-undef */
      const t = trefferflaeche(el);
      /* eslint-enable no-undef */
      if (t.breite >= 24 && t.hoehe >= 24) return;
      const wer =
        (el.id ? "#" + el.id : "") +
        (typeof el.className === "string" && el.className
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : el.tagName.toLowerCase());
      const eintrag = { wer, ...t, text: (el.textContent || "").trim().slice(0, 30) };
      if (istInline(el)) ausgenommen.push({ ...eintrag, grund: "inline im Fliesstext" });
      else if (abstandReicht(i)) ausgenommen.push({ ...eintrag, grund: "Abstand >= 24 px" });
      else zuKlein.push(eintrag);
    });
    return { zuKlein, ausgenommen, geprueft: els.length };
  }, TREFFERFLAECHE_JS);
  /* Dieselbe Logik: Keine gefundenen Ziele heisst kaputte Messung, nicht
     "alles gross genug". */
  expect(ergebnis.geprueft, `keine Bedienelemente auf ${bildschirm} gefunden`).toBeGreaterThan(0);
  befunde.push({ bildschirm, zustand: "Zielgroessen (WCAG 2.2 · 2.5.8 AA)", ...ergebnis });
  return ergebnis;
}

/**
 * WCAG 1.4.10 Reflow, Stufe AA: bedienbar bei 320 CSS-Pixel Breite ohne
 * waagrechtes Scrollen.
 *
 * Die ueberstehenden Elemente werden nur dann gemeldet, wenn das Dokument
 * TATSAECHLICH breiter ist als das Fenster. Ein randbeschnittenes Zierelement
 * ragt rechnerisch hinaus, erzeugt aber keine Scrollleiste — es als Befund zu
 * fuehren waere Fehlalarm.
 */
async function umbruchMessen(page, bildschirm) {
  const vorher = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 800 });
  await beruhigen(page);
  const mass = await page.evaluate(() => {
    const scrollt = document.documentElement.scrollWidth > window.innerWidth + 1;
    return {
      dokument: document.documentElement.scrollWidth,
      fenster: window.innerWidth,
      waagrechtesScrollen: scrollt,
      ueberstehende: scrollt
        ? Array.from(document.querySelectorAll("body *"))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const s = getComputedStyle(el);
              return r.right > window.innerWidth + 1 && s.position !== "fixed" && s.visibility !== "hidden";
            })
            .slice(0, 8)
            .map((el) => ({
              wer:
                (el.id ? "#" + el.id : "") +
                (typeof el.className === "string" && el.className
                  ? "." + el.className.trim().split(/\s+/).join(".")
                  : el.tagName.toLowerCase()),
              rechts: Math.round(el.getBoundingClientRect().right),
            }))
        : [],
    };
  });
  /* Ein Fenster, das nicht auf 320 px gesetzt wurde, misst etwas anderes. */
  expect(mass.fenster, "Fensterbreite nicht auf 320 px gesetzt").toBe(320);
  befunde.push({ bildschirm, zustand: "Reflow bei 320 px (WCAG 1.4.10 AA)", ...mass });
  if (vorher) await page.setViewportSize(vorher);
  return mass;
}

/* ── Stufe AAA ────────────────────────────────────────────────────────────
   AAA ist ausdruecklich NICHT unser Ziel — das W3C empfiehlt es nicht als
   Anforderung fuer ganze Websites, weil es sich fuer manche Inhalte
   grundsaetzlich nicht erfuellen laesst. Gemessen wird es trotzdem, aus einem
   einzigen Grund: Was wir nebenbei erfuellen, ist im Foerderantrag ein
   ehrlicher Zusatz — und was wir nicht erfuellen, gehoert mit Begruendung
   dokumentiert statt verschwiegen. */
const WCAG_AAA = ["wcag2aaa", "wcag21aaa", "wcag22aaa"];

async function aaaMessen(page, bildschirm) {
  await beruhigen(page);
  const axeAaa = await new AxeBuilder({ page }).withTags(WCAG_AAA).analyze();

  const mess = await page.evaluate((tf) => {
    eval(tf);
    const sichtbar = (el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
    };

    /* 2.5.5 Zielgroesse (erweitert), AAA: 44 x 44 — gemessen an der tastbaren
       Flaeche, nicht an der gemalten Box. AAA kennt die Abstands-Ausnahme
       NICHT, nur inline / gleichwertig / wesentlich. */
    const zuKlein44 = [];
    document.querySelectorAll("a, button, input, [role='button']").forEach((el) => {
      if (!sichtbar(el)) return;
      if (el.getClientRects().length > 1) return;
      const s = getComputedStyle(el);
      if (s.display === "inline" && el.parentElement) {
        const eigen = (el.textContent || "").trim();
        if ((el.parentElement.textContent || "").trim().length > eigen.length + 2) return;
      }
      /* eslint-disable no-undef */
      const t = trefferflaeche(el);
      /* eslint-enable no-undef */
      if (t.breite < 44 || t.hoehe < 44) {
        zuKlein44.push({
          wer: el.id ? "#" + el.id : String(el.className || el.tagName.toLowerCase()).slice(0, 40),
          ...t,
        });
      }
    });

    /* 1.4.8 Visuelle Praesentation, AAA */
    const absaetze = Array.from(document.querySelectorAll("p, li")).filter(sichtbar).slice(0, 60);
    let blocksatz = 0,
      engerZeilenabstand = 0,
      langeZeilen = 0,
      maxZeichen = 0;
    for (const el of absaetze) {
      const s = getComputedStyle(el);
      if (s.textAlign === "justify") blocksatz++;
      const groesse = parseFloat(s.fontSize) || 16;
      const hoehe = parseFloat(s.lineHeight);
      if (hoehe && hoehe / groesse < 1.5) engerZeilenabstand++;
      const zeichen = Math.round(el.getBoundingClientRect().width / (groesse * 0.5));
      maxZeichen = Math.max(maxZeichen, zeichen);
      if (zeichen > 80) langeZeilen++;
    }

    /* 2.4.9 Linkzweck (nur Link), AAA */
    const leerformeln = ["hier", "mehr", "weiterlesen", "klicken", "link", "here", "more", "read more"];
    const schwacheLinks = [];
    document.querySelectorAll("a").forEach((el) => {
      if (!sichtbar(el)) return;
      const t = (el.textContent || "").trim().toLowerCase();
      if (t && leerformeln.includes(t)) schwacheLinks.push({ text: t, ziel: el.getAttribute("href") });
    });

    /* 2.4.10 Abschnittsueberschriften, AAA: Ueberschriften vorhanden und ohne
       uebersprungene Ebene. Ein Sprung von h1 auf h3 laesst Screenreader-Nutzer
       raten, ob ein Abschnitt fehlt. */
    const ebenen = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .filter(sichtbar)
      .map((h) => Number(h.tagName[1]));
    const spruenge = [];
    for (let i = 1; i < ebenen.length; i++) {
      if (ebenen[i] - ebenen[i - 1] > 1) spruenge.push(`h${ebenen[i - 1]} -> h${ebenen[i]}`);
    }

    /* 3.1.4 Abkuerzungen, AAA: Fuer jede Abkuerzung muss die Langform
       erreichbar sein — ueber <abbr title> oder eine Erklaerung im Text. */
    const text = document.body.innerText;
    const kandidaten = ["EXIF", "GPS", "DSGVO", "KI", "PDF", "URL", "IP", "WCAG", "OSM"];
    const abbrTags = new Set(Array.from(document.querySelectorAll("abbr[title]")).map((a) => a.textContent.trim()));
    const abkuerzungenOhneErklaerung = kandidaten.filter((k) => {
      if (!new RegExp("\\b" + k + "\\b").test(text)) return false;
      if (abbrTags.has(k)) return false;
      /* Als erklaert gilt auch, wenn die Langform in Klammern daneben steht. */
      return !new RegExp(k + "\\s*\\(").test(text);
    });

    return {
      zuKlein44,
      blocksatz,
      engerZeilenabstand,
      langeZeilen,
      maxZeichen,
      absaetze: absaetze.length,
      schwacheLinks,
      ueberschriftenSpruenge: spruenge,
      ueberschriften: ebenen.length,
      abkuerzungenOhneErklaerung,
    };
  }, TREFFERFLAECHE_JS);

  /* 2.4.13 Fokus-Erscheinung und 2.4.12 Fokus nicht verdeckt (beide AAA):
     Jedes fokussierbare Element wird tatsaechlich fokussiert und dann
     gemessen — Umriss-Staerke und ob es hinter der geklebten Leiste
     verschwindet. Computed styles allein reichen nicht: `:focus-visible`
     greift erst, wenn der Fokus wirklich sitzt. */
  const fokus = await page.evaluate(() => {
    const ziele = Array.from(document.querySelectorAll("a, button, input, [tabindex='0']")).filter((el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
    });
    const ohneUmriss = [];
    const verdeckt = [];
    const kleber = document.querySelector(".bias-toggle-wrap.is-stuck");
    const kleberKasten = kleber ? kleber.getBoundingClientRect() : null;
    for (const el of ziele.slice(0, 40)) {
      el.focus();
      const s = getComputedStyle(el);
      const staerke = parseFloat(s.outlineWidth) || 0;
      const schatten = s.boxShadow && s.boxShadow !== "none";
      if (staerke < 2 && !schatten) {
        ohneUmriss.push({ wer: el.id ? "#" + el.id : String(el.className || el.tagName).slice(0, 35), staerke });
      }
      if (kleberKasten) {
        const r = el.getBoundingClientRect();
        if (r.top < kleberKasten.bottom && r.bottom > kleberKasten.top) {
          verdeckt.push(el.id ? "#" + el.id : String(el.className || el.tagName).slice(0, 35));
        }
      }
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return { geprueft: Math.min(ziele.length, 40), ohneUmriss, verdeckt };
  });

  expect(
    axeAaa.passes.length + axeAaa.violations.length,
    `keine AAA-Regel auf ${bildschirm} angewandt`
  ).toBeGreaterThan(0);
  expect(fokus.geprueft, `keine fokussierbaren Elemente auf ${bildschirm}`).toBeGreaterThan(0);
  befunde.push({
    bildschirm,
    zustand: "Stufe AAA (nachrichtlich)",
    axeAaaVerstoesse: axeAaa.violations.map((v) => ({
      regel: v.id,
      impact: v.impact,
      kriterium: v.tags.filter((t) => t.startsWith("wcag")).join(" "),
      beschreibung: v.help,
      anzahl: v.nodes.length,
    })),
    axeAaaGeprueft: axeAaa.passes.length,
    fokus,
    ...mess,
  });
  return mess;
}

/**
 * WCAG 1.4.4 Textgroesse aendern (AA) und 1.4.12 Textabstaende (AA).
 *
 * Beide betreffen Menschen, die die Darstellung selbst hochschrauben — bei
 * Sehschwaeche oder Legasthenie. Und beide fehlten in meinem ersten Lauf, was
 * genau der Fehler war: aus dem Gedaechtnis pruefen statt eine Liste abarbeiten.
 *
 * 1.4.4: Der Text muss auf 200 % wachsen koennen. Umgesetzt ueber die
 * Wurzel-Schriftgroesse (16 -> 32 px); die Seite rechnet in rem, damit skaliert
 * alles mit. Geprueft wird auf waagrechtes Scrollen und auf abgeschnittenen
 * Inhalt.
 *
 * 1.4.12: Der Nutzer erhoeht Zeilenhoehe auf 1,5, Absatzabstand auf 2 em,
 * Buchstabenabstand auf 0,12 em und Wortabstand auf 0,16 em. Danach darf nichts
 * ueberlappen oder verschwinden. Die Werte stehen so im Kriterium.
 */
async function textAnpassungMessen(page, bildschirm) {
  const ergebnisse = {};

  for (const [name, css] of [
    ["1.4.4 Textgroesse 200 %", "html { font-size: 32px !important; }"],
    [
      "1.4.12 Textabstaende",
      `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
       p, li { margin-bottom: 2em !important; }`,
    ],
  ]) {
    const kennung = await page.addStyleTag({ content: css });
    await beruhigen(page);
    const mass = await page.evaluate(() => {
      const abgeschnitten = [];
      /* Abgeschnitten heisst: Der Kasten verbirgt Inhalt, der nicht
         hineinpasst — und zwar OHNE dass man scrollen koennte. Ein bewusst
         scrollbarer Bereich (Karte, Codeblock) ist kein Mangel. */
      document.querySelectorAll("body *").forEach((el) => {
        const s = getComputedStyle(el);
        if (s.overflow !== "hidden" && s.overflowY !== "hidden") return;
        if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
          abgeschnitten.push({
            wer:
              (el.id ? "#" + el.id : "") +
              (typeof el.className === "string" && el.className
                ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
                : el.tagName.toLowerCase()),
            sichtbar: el.clientHeight,
            inhalt: el.scrollHeight,
          });
        }
      });
      return {
        dokument: document.documentElement.scrollWidth,
        fenster: window.innerWidth,
        waagrechtesScrollen: document.documentElement.scrollWidth > window.innerWidth + 1,
        abgeschnitten: abgeschnitten.slice(0, 8),
      };
    });
    ergebnisse[name] = mass;
    await page.evaluate((k) => {
      const el = document.querySelector(`style[data-pw="${k}"]`) || document.head.lastElementChild;
      if (el && el.tagName === "STYLE") el.remove();
    }, kennung);
    await beruhigen(page);
  }

  befunde.push({ bildschirm, zustand: "Text vergroessern und Abstaende (AA)", ...ergebnisse });
  /* Positivkontrolle: Ohne gemessene Fensterbreite ist die Aussage wertlos. */
  expect(ergebnisse["1.4.4 Textgroesse 200 %"].fenster, "Fensterbreite nicht gemessen").toBeGreaterThan(0);
  return ergebnisse;
}

test.describe("Prüfprotokoll WCAG 2.2 AA", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("Startseite, leer", async ({ page }) => {
    await endpunkteStellen(page);
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
    await messen(page, "Startseite", "leer, hell");
    await zielgroessenMessen(page, "Startseite");
    await aaaMessen(page, "Startseite");
    await textAnpassungMessen(page, "Startseite");

    /* Frueher stand hier eine Messung "leer, dunkel" ueber
       `emulateMedia({ colorScheme: "dark" })`. Die war wertlos: malziME kennt
       kein `prefers-color-scheme` — das dunkle Erscheinungsbild entsteht allein
       ueber den Beast-Schalter. Die Messung hat also zweimal dasselbe gemessen
       und im Protokoll einen Zustand behauptet, den es nicht gibt. Das dunkle
       Thema wird dort geprueft, wo es existiert: im Zustand "Profil, Beast". */

    await umbruchMessen(page, "Startseite");
  });

  test("Warteschlange und Live-Text", async ({ page }) => {
    await endpunkteStellen(page, {
      jobStatus: { status: "queued", position: 3, etaSeconds: 45 },
    });
    await page.goto("/");
    await page.click('[data-demo="selfie"]');
    /* POSITIVKONTROLLE: Ohne sie koennte dieser Test eine leere Seite messen
       und "keine Verstoesse" melden — der Wartezustand muss nachweislich da
       sein, sonst ist das Protokoll an dieser Stelle wertlos.
       Gewartet wird auf die Bedingung, nicht auf die Uhr: Eine feste Frist ist
       auf einem langsamen Laufer zu kurz und auf einem schnellen verschenkte
       Zeit. */
    await expect(page.locator("#scanText")).not.toBeEmpty({ timeout: 20000 });
    await messen(page, "Warteschlange", "wartend mit Position und Restzeit");

    await page.unroute("**/api/job-status**");
    await page.route("**/api/job-status**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "processing", liveText: "Du bist vermutlich Mitte zwanzig und " }),
      })
    );
    /* NICHT `locator("#a, #b").first()` — das waehlt nach Reihenfolge im
       Dokument, nicht nach "das mit Inhalt". Sobald die Verarbeitung beginnt,
       wird #scanText geleert und der Text steht in #liveTextFest; .first()
       prueft dann das leere Element. Auf Firefox trat genau diese Reihenfolge
       ein — der Riegel war dort rot, obwohl die Seite in Ordnung war.
       Ein wackeliger Riegel ist schlimmer als keiner: Er wird irgendwann
       uebergangen, und dann faengt er auch die echten Faelle nicht mehr.
       Geprueft wird deshalb, ob IRGENDWO Live-Text steht, und mit Warten auf
       die Bedingung statt auf die Uhr. */
    await expect
      .poll(
        async () =>
          (await page.locator("#liveTextFest, #scanText").allTextContents()).join("").replace(/\s+/g, "").length,
        { timeout: 20000, message: "Weder #liveTextFest noch #scanText tragen Live-Text" }
      )
      .toBeGreaterThan(0);
    await messen(page, "Live-Text", "Modell schreibt mit");
  });

  test("Profil, beide Modi, beide Themen", async ({ page }) => {
    await endpunkteStellen(page);
    await page.goto("/");
    await page.click('[data-demo="selfie"]');
    await expect(page.locator(".cat-card").first()).toBeVisible({ timeout: 20000 });

    await messen(page, "Profil", "seriös, hell");
    await zielgroessenMessen(page, "Profil");
    await aaaMessen(page, "Profil");
    await textAnpassungMessen(page, "Profil");

    await page.evaluate(() => document.getElementById("biasSwitch").click());
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await messen(page, "Profil", "Beast, dunkel");

    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(300);
    await messen(page, "Profil", "Beast, Umschalter geklebt");

    await umbruchMessen(page, "Profil");
  });

  /* WCAG-EM Schritt 3.3 verlangt VOLLSTAENDIGE Prozesse, nicht Einzelzustaende.
     Diese drei Schritte der Analyse fehlten: Bildvorbereitung, Realitaets-Check
     und PDF-Export. Ein Prozess gilt erst als geprueft, wenn alle Schritte es
     sind. */
  /* RUECKBAUPROBE fuer den Auflöser selbst. Ein Pruefmittel, das nicht rot
     werden kann, belegt nichts. Hier wird absichtlich zu schwacher Kontrast
     erzeugt und gemessen — findet die Bildpunkt-Messung ihn nicht, ist sie
     kaputt, nicht die Seite. */
  test("Rueckbauprobe: die Bildpunkt-Messung erkennt zu schwachen Kontrast", async ({ page }) => {
    await endpunkteStellen(page);
    await page.goto("/");
    await page.evaluate(() => {
      const d = document.createElement("p");
      d.id = "kontrast-probe";
      d.textContent = "Absichtlich zu blass";
      /* 4.06:1 auf Weiss — deutlich unter den verlangten 4.5:1, aber nah genug,
         dass nur eine echte Messung den Unterschied sieht. */
      d.style.cssText = "color:#8a8a8a;background:#ffffff;font-size:16px;padding:8px;position:relative;z-index:9999";
      document.body.prepend(d);
    });
    const gemessen = await kontrastAusBildpunkten(page, "#kontrast-probe");
    expect(gemessen).not.toBeNull();
    expect(gemessen).toBeLessThan(4.5);

    /* Gegenprobe in dieselbe Richtung: Reicht der Kontrast, darf die Messung
       NICHT anschlagen. Sonst wuerde sie alles rot faerben und waere ebenso
       wertlos wie eine, die nie anschlaegt. */
    await page.evaluate(() => {
      document.getElementById("kontrast-probe").style.color = "#1a1a1a";
    });
    const gut = await kontrastAusBildpunkten(page, "#kontrast-probe");
    expect(gut).toBeGreaterThan(4.5);
  });

  test("Prozess-Schritt: Foto gewaehlt, Vorbereitung laeuft", async ({ page }) => {
    await endpunkteStellen(page, { jobStatus: { status: "queued", position: 1, etaSeconds: 20 } });
    await page.goto("/");
    /* Der Zustand zwischen Klick und Einreihung: Der Browser verkleinert das
       Bild und liest die Metadaten. Kurz, aber sichtbar — und fuer jemanden mit
       Screenreader der Moment, in dem etwas passieren muss. */
    await page.click('[data-demo="selfie"]');
    await page.waitForTimeout(1200);
    await messen(page, "Analyse-Prozess", "Schritt 2: Bildvorbereitung");

    /* Die eigentliche Zusicherung dieses Schritts, und der Grund, warum er in
       der Prozessliste steht: Zwischen Klick und Warteschlange vergeht Zeit, in
       der auf dem Bildschirm etwas passiert. Wer nicht sieht, erfaehrt davon
       nur ueber einen Live-Bereich. Bleibt der leer, sitzt jemand vor einer
       Seite, die scheinbar nichts tut — formal fehlerfrei, praktisch kaputt.
       (WCAG 4.1.3 Statusmeldungen, Stufe AA) */
    const lebend = page.locator('[aria-live="polite"], [aria-live="assertive"], [role="status"]');
    await expect(lebend.first()).toHaveCount(1);
    const gesagt = (await lebend.allTextContents()).join(" ").trim();
    expect(gesagt.length, "Bildvorbereitung laeuft, aber kein Live-Bereich sagt etwas").toBeGreaterThan(0);
  });

  test("Prozess-Schritt: Realitaets-Check ausfuellen", async ({ page }) => {
    await endpunkteStellen(page);
    await page.goto("/");
    await page.click('[data-demo="selfie"]');
    await expect(page.locator(".cat-card").first()).toBeVisible({ timeout: 20000 });
    const rc = page.locator(".rc-knopf").first();
    if (await rc.count()) {
      await rc.click();
      await page.waitForTimeout(400);
    }
    await messen(page, "Analyse-Prozess", "Schritt 8: Realitaets-Check");
    await zielgroessenMessen(page, "Realitaets-Check");
  });

  test("Prozess-Schritt: PDF-Export", async ({ page }) => {
    await endpunkteStellen(page);
    await page.goto("/");
    await page.click('[data-demo="selfie"]');
    await expect(page.locator(".cat-card").first()).toBeVisible({ timeout: 20000 });
    /* Nur den Knopf pruefen, nicht die erzeugte Datei: Ein PDF ist ein eigenes
       Format mit eigenen Barrierefreiheits-Regeln (PDF/UA) und gehoert nicht in
       eine HTML-Pruefung. Was hier zaehlt: Ist der Weg dorthin bedienbar und
       benannt? */
    /* `toHaveCount(1)` auf einem .first()-Waehler ist fast immer wahr und
       belegt nichts — es genuegt IRGENDEIN Treffer, auch der falsche.
       Geprueft wird deshalb, was der Schritt wirklich braucht: Der Knopf ist
       sichtbar, mit der Tastatur erreichbar und traegt einen Namen. Ein
       Bedienelement ohne Namen ist fuer einen Screenreader nicht vorhanden. */
    const knopf = page.getByRole("button", { name: /pdf|export|herunterladen|speichern/i }).first();
    await expect(knopf).toBeVisible({ timeout: 20000 });
    const name = (await knopf.evaluate((n) => n.getAttribute("aria-label") || n.textContent || "")).trim();
    expect(name.length, "Der PDF-Knopf traegt keinen Namen").toBeGreaterThan(2);
    await expect(knopf).toHaveAttribute("tabindex", "0");
    await messen(page, "Analyse-Prozess", "Schritt 9: PDF-Export erreichbar");
  });

  test("Fehlermeldungen", async ({ page }) => {
    await endpunkteStellen(page, { jobStatus: { status: "failed", errorReason: "blocked.apiError" } });
    await page.goto("/");
    await page.click('[data-demo="selfie"]');
    await page.waitForTimeout(6000);
    /* POSITIVKONTROLLE: Die Fehlermeldung muss wirklich dastehen. Sonst
       messen wir die unveraenderte Startseite und nennen sie "Fehlermeldung". */
    await expect(page.locator("#status")).not.toBeEmpty();
    await messen(page, "Fehlermeldung", "Analyse fehlgeschlagen");
  });

  test("Zahlen-Seite", async ({ page }) => {
    await endpunkteStellen(page);
    await page.goto("/stats.html");
    await expect(page.locator("h1")).toBeVisible();
    await messen(page, "Zahlen-Seite", "hell");
    await zielgroessenMessen(page, "Zahlen-Seite");
    await umbruchMessen(page, "Zahlen-Seite");
  });

  for (const [name, pfad] of [
    ["Datenschutz", "/datenschutz.html"],
    ["Impressum", "/impressum.html"],
    ["Nutzungsbedingungen", "/nutzungsbedingungen.html"],
    ["Barrierefreiheit", "/barrierefreiheit.html"],
  ]) {
    test(`Rechtsseite: ${name}`, async ({ page }) => {
      await page.goto(pfad);
      await expect(page.locator("h1")).toBeVisible();
      await messen(page, name, "hell");
      await zielgroessenMessen(page, name);
      await aaaMessen(page, name);
      await textAnpassungMessen(page, name);

      /* Der Sprachhinweis ist ein Dialog — offene Dialoge werden eigens
         gemessen, weil sie den Fokus fangen und die Umgebung stilllegen. */
      const en = page.locator('.sprach-knopf[data-lang="en"]');
      if (await en.count()) {
        await en.click();
        await expect(page.locator('.sw-grund[data-modal="unuebersetzt"]')).toBeVisible();
        await messen(page, name, "Sprachhinweis offen");
      }
      await umbruchMessen(page, name);
    });
  }

  test.afterAll(() => {
    expect(befunde.length, "keine einzige Messung abgelegt").toBeGreaterThan(0);
    mkdirSync(AUSGABE, { recursive: true });
    /* Je Browser eine eigene Datei. Vorher schrieben Chromium und WebKit in
       dieselbe — wer zuletzt fertig wurde, ueberschrieb den anderen, und am
       Ergebnis war nicht mehr zu erkennen, welcher Browser gemessen hatte. Ein
       Protokoll, das seine eigene Quelle nicht nennen kann, ist kein Protokoll. */
    const browser = test.info().project.name || "unbekannt";
    writeFileSync(join(AUSGABE, `befunde-${browser}.json`), JSON.stringify(befunde, null, 2), "utf8");
    /* Bewusst kein `expect` hier: Diese Datei misst, sie richtet nicht. */
    console.log(`[protokoll] ${befunde.length} Messungen (${browser}) abgelegt in ${AUSGABE}`);
  });
});
