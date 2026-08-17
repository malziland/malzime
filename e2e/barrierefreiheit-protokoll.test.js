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
    await page.waitForTimeout(4000);
    /* POSITIVKONTROLLE: Ohne sie koennte dieser Test eine leere Seite messen
       und "keine Verstoesse" melden — der Wartezustand muss nachweislich da
       sein, sonst ist das Protokoll an dieser Stelle wertlos. */
    await expect(page.locator("#scanText")).not.toBeEmpty();
    await messen(page, "Warteschlange", "wartend mit Position und Restzeit");

    await page.unroute("**/api/job-status**");
    await page.route("**/api/job-status**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "processing", liveText: "Du bist vermutlich Mitte zwanzig und " }),
      })
    );
    await page.waitForTimeout(4000);
    await expect(page.locator("#liveTextFest, #scanText").first()).not.toBeEmpty();
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
