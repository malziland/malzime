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
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* Bewusst über das Arbeitsverzeichnis statt über `import.meta.url`: Playwright
   lädt die Testdateien nicht als echte ES-Module, `import.meta` wirft dort. */
const AUSGABE = join(process.cwd(), "e2e", ".protokoll");

/* ── Welche Seiten im Messumfang liegen ───────────────────────────────────
   OPS-2026-08-18: Hier stand weiter unten eine feste Liste mit genau den vier
   DEUTSCHEN Rechtsseiten. Am 18.08.2026 kamen vier englische Fassungen unter
   `public/en/` dazu — die Liste kannte sie nicht. Das Protokoll hätte weiter
   behauptet, es messe die Website vollständig, und hätte dabei vier
   ausgelieferte Seiten nie angesehen. Eine Konformitätsaussage, die auf einer
   veralteten Liste steht, ist keine Konformitätsaussage.

   Deshalb wird jetzt das Dateisystem gefragt — dieselbe Ableitung wie in
   `e2e/a11y.test.js`. Jede neue Seite liegt damit ab ihrer Entstehung im
   Messumfang, ohne dass jemand daran denken muss.

   Warum die Ableitung doppelt dasteht statt in einem gemeinsamen Modul: Ein
   Hilfsmodul wäre eine dritte Datei, und die Kopplung zweier Prüfmittel über
   eine gemeinsame Quelle kostet mehr, als die zehn Zeilen wert sind. Was
   beide Dateien teilen müssen, ist das VERFAHREN (frag das Dateisystem), nicht
   der Code.

   Basis ist das Arbeitsverzeichnis, nicht `import.meta.url` — Begründung
   direkt oben bei AUSGABE. */
const PUBLIC = join(process.cwd(), "public");

function alleSeiten(unter = "") {
  const treffer = [];
  for (const e of readdirSync(join(PUBLIC, unter), { withFileTypes: true })) {
    const rel = unter ? `${unter}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (["__tests__", "node_modules", "fonts", "img", "js", "locales"].includes(e.name)) continue;
      treffer.push(...alleSeiten(rel));
    } else if (e.name.endsWith(".html")) {
      treffer.push("/" + rel);
    }
  }
  return treffer.sort();
}

const ALLE_SEITEN = alleSeiten();

/* Die Rechtsseiten: alles außer Startseite und Zahlen-Seite — die beiden haben
   eigene Tests weiter unten, weil sie eine Schnittstelle brauchen. Deutsch UND
   englisch: `/en/privacy.html` trägt dieselbe Verantwortung wie
   `/datenschutz.html` und wird deshalb genauso gemessen. */
const RECHTSSEITEN = ALLE_SEITEN.filter((p) => !/^\/(index|stats)\.html$/.test(p));

/* Adresse ohne Endung -> ausgelieferte Datei, abgeleitet aus derselben Suche.
   Gebraucht von der Rewrite-Attrappe weiter unten; bewusst KEINE zweite feste
   Liste der acht Hosting-Regeln. */
const REWRITES = new Map(ALLE_SEITEN.map((p) => [p.replace(/\.html$/, ""), p]));

/* Ein sprechender Name je Seite fürs Protokoll, ebenfalls abgeleitet:
   "/datenschutz.html" -> "DE Datenschutz", "/en/privacy.html" -> "EN Privacy".
   Die Sprache steht bewusst vorne — im Befundbericht muss auf einen Blick zu
   sehen sein, dass beide Fassungen gemessen wurden. */
function seitenName(pfad) {
  const teile = pfad
    .replace(/^\//, "")
    .replace(/\.html$/, "")
    .split("/");
  const blatt = teile.pop();
  const sprache = (teile.join("/") || "de").toUpperCase();
  return `${sprache} ${blatt.charAt(0).toUpperCase()}${blatt.slice(1)}`;
}

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
 * Stellt die Rewrites von Firebase Hosting nach.
 *
 * WARUM: Der Sprachumschalter verweist auf die sauberen Adressen ohne Endung
 * (`/en/privacy`), weil Hosting sie auf die HTML-Datei umschreibt. Der
 * Testserver ist ein nackter Dateiserver und kennt diese Regel nicht — ein
 * Klick liefe dort in einen 404, und das Protokoll würde den Testserver messen
 * statt den Umschalter. Gleiches Vorgehen wie in
 * `e2e/sprachumschalter-unterseiten.test.js`, nur wird die Zuordnung hier aus
 * der Seitensuche abgeleitet statt noch einmal aufgeschrieben.
 *
 * Die Antwort holt die Attrappe vom Testserver, nicht von der Festplatte —
 * gemessen bleibt damit, was auch ausgeliefert wird.
 */
async function hostingAdressenNachstellen(page) {
  await page.route(
    (url) => REWRITES.has(url.pathname),
    async (route) => {
      const adresse = new URL(route.request().url());
      const antwort = await route.fetch({ url: adresse.origin + REWRITES.get(adresse.pathname) });
      await route.fulfill({ response: antwort });
    }
  );
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

/**
 * Sammelt zu einem gemeldeten Kontrast-Verstoss alles, was ihn spaeter
 * auswertbar macht.
 *
 * ANLASS 2026-08-23: Ein Lauf meldete an einem Fusszeilen-Link Kontrast 1,08
 * statt der gemessenen 5,58 — "durch Bildpunkt-Messung bestaetigt". Weder
 * lokal noch im Wiederholungslauf trat er wieder auf; zwei Erklaerungen
 * (laufender Farbuebergang, andere Browsersprache) liessen sich durch
 * erzwungene Gegenversuche WIDERLEGEN. Der Fund blieb unerklaert.
 *
 * Der Grund dafuer war das Messmittel selbst: Es meldete nur die Zahl. Ob das
 * Element ueberdeckt war, welche Farben tatsaechlich anlagen, ob gerade eine
 * Animation lief — nichts davon stand im Bericht, und ohne das ist ein
 * einmaliger Fund nicht aufloesbar. Ein Pruefmittel, dessen Funde niemand
 * nachvollziehen kann, verliert genau das Vertrauen, das es herstellen soll.
 */
async function verstossDiagnose(page, waehler) {
  return page.evaluate((w) => {
    const el = document.querySelector(w);
    if (!el) return { hinweis: "Element beim Nachsehen nicht mehr da" };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    /* Hintergrund: die erste Elternflaeche, die nicht durchsichtig ist */
    let hinter = null;
    for (let k = el; k; k = k.parentElement) {
      const bg = getComputedStyle(k).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") { hinter = bg; break; }
    }
    const mitte = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      textfarbe: cs.color,
      hintergrund: hinter,
      deckkraft: cs.opacity,
      schriftgroesse: cs.fontSize,
      sichtbar: cs.visibility + "/" + cs.display,
      ueberdecktVon: mitte === el || el.contains(mitte) ? null : (mitte ? mitte.tagName + "." + mitte.className : "nichts"),
      imBild: r.top >= 0 && r.bottom <= innerHeight,
      masse: Math.round(r.width) + "x" + Math.round(r.height) + " bei " + Math.round(r.top),
      laufendeAnimationen: document.getAnimations().length,
      sprache: document.documentElement.lang + " / " + navigator.language,
    };
  }, waehler);
}

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
          /* Ohne diese Angaben ist ein einmaliger Fund nicht aufloesbar —
             siehe Begruendung bei verstossDiagnose. */
          diagnose: await verstossDiagnose(page, waehler),
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
    verstoesse: await Promise.all(
      stabil.map(async (v) => ({
        regel: v.id,
        impact: v.impact,
        beschreibung: v.help,
        kriterium: v.tags.filter((t) => t.startsWith("wcag")).join(" "),
        elemente: v.nodes.map((n) => n.target.join(" ")).slice(0, 8),
        anzahl: v.nodes.length,
        /* Bei Farbkontrast zusaetzlich, was den Fund aufloesbar macht: welche
           Farben tatsaechlich anlagen, ob das Element ueberdeckt war, ob
           Animationen liefen. Siehe Begruendung bei verstossDiagnose. */
        ...(v.id === "color-contrast" ? { diagnose: await verstossDiagnose(page, v.nodes[0].target.join(" ")) } : {}),
      }))
    ),
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
    await animationsRuhe(page);
  }
  /* ANLASS 2026-08-23: Ein CI-Lauf meldete im Zustand "Live-Text/Modell
     schreibt mit" Kontrast 1,08 an einem Fusszeilen-Link, dessen Farbe
     nachweislich 5,58 misst. Weder lokal noch im Wiederholungslauf trat der
     Fund wieder auf, auch nicht bei acht Wiederholungen unter Last.

     Die Luecke: `document.getAnimations()` erfasst CSS-Animationen und
     -Uebergaenge, aber KEINE Aenderungen, die JavaScript am DOM vornimmt.
     Genau das passiert in diesem Zustand — sobald Live-Text eintrifft, wird
     #scanText geleert und der Text nach #liveTextFest umgehaengt. Das
     verschiebt das Layout, und alles darunter wandert mit. Der Test misst
     unmittelbar nach `expect.poll`, also mitten hinein. Auf der langsameren
     CI-Maschine ist dieses Fenster groesser als hier.

     Deshalb wird zusaetzlich auf LAYOUT-Ruhe gewartet: Die Seitenhoehe und die
     Lage der Fusszeile muessen ueber zwei aufeinanderfolgende Bilder gleich
     bleiben. Das faengt jede Bewegung ab, gleich wodurch sie ausgeloest wird. */
  /* Layout-Ruhe abwarten.
     ANLASS 2026-08-23: Ein CI-Lauf meldete im Zustand "Live-Text/Modell
     schreibt mit" Kontrast 1,08 an einem Fusszeilen-Link, dessen Farbe
     nachweislich 5,58 misst. `document.getAnimations()` deckt CSS-Animationen
     und -Uebergaenge ab, aber KEINE Aenderungen, die JavaScript am DOM
     vornimmt — und genau das passiert dort: #scanText wird geleert, der Text
     wandert nach #liveTextFest, alles darunter verschiebt sich.

     EIN Roundtrip, nicht mehrere: Eine erste Fassung mass in einer Schleife
     von aussen und rief page.evaluate bis zu 50-mal je Messung auf. Bei 82
     Zustaenden mal drei Browsern summierte sich das so weit, dass unter Last
     ANDERE Testdateien in ihre Zeitgrenzen liefen — ein Riegel darf die Suite
     nicht kippen, die er schuetzen soll. page.evaluate wartet auf ein
     zurueckgegebenes Promise (anders als waitForFunction mit polling "raf",
     das eine fruehere Fassung wirkungslos machte), also wird innerhalb EINES
     Aufrufs ueber mehrere Bilder gemessen. */
  for (let versuch = 0; versuch < 3; versuch++) {
    const ruhig = await page.evaluate(
      () =>
        new Promise((fertig) => {
          const messen = () => {
            const f = document.querySelector(".site-footer");
            return (
              document.documentElement.scrollHeight + "|" + (f ? Math.round(f.getBoundingClientRect().top) : "-")
            );
          };
          /* Abstand zwischen den Messungen, nicht Bild an Bild: Vier direkt
             aufeinanderfolgende Bilder laufen so schnell durch, dass eine
             langsamere Bewegung dazwischen gar nicht stattfindet — die
             Gegenprobe mit einer wachsenden Seite ging so durch. 50 ms decken
             ein Bild bei 20 Hz ab und kosten je Messung 150 ms. */
          const werte = [];
          const naechstes = () => {
            werte.push(messen());
            if (werte.length < 4) setTimeout(() => requestAnimationFrame(naechstes), 50);
            else fertig(werte.every((w) => w === werte[0]));
          };
          requestAnimationFrame(naechstes);
        })
    );
    if (ruhig) break;
    /* Bleibt die Seite auch nach drei Anlaeufen in Bewegung, wird trotzdem
       gemessen — die Diagnose am Verstoss haelt Lage und Ueberdeckung fest,
       sodass ein Fund aus dieser Ursache erkennbar bleibt. Ein Riegel, der
       hier abbricht, wuerde echte Pruefungen verhindern. */
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


/* Auf Animations-Ruhe warten — ABER nur auf Animationen, die ueberhaupt
   enden koennen.

   ANLASS 2026-08-29: Seit die Kategorie-Karten von Beginn an als unscharfes
   Geruest stehen, laufen waehrend der Analyse 39 Endlos-Animationen
   gleichzeitig (13 Karten * 3 Konfidenz-Punkte, `animation: ... infinite`).
   `a.finished` loest bei einer Endlos-Animation NIE auf. Das Warten auf
   `Promise.all(alle)` blockierte damit bis zum Zeitrahmen des Tests — gemessen
   wurde danach in eine Seite hinein, die noch in Bewegung war.

   Die Folge waren IRREFUEHRENDE Befunde: axe meldete "Kontrast 1 statt 4,5"
   (weiss auf weiss) an einem Knopf, der gerade eingeblendet wurde, und der
   Zustands-Abgleich meldete "82 erwartet, 6 gemessen", weil der Lauf vorher
   abbrach. Beides sah nach Barrierefreiheits-Fehlern aus und war keiner.

   Nachgemessen am 29.08.: 52 Animationen, davon 39 endlos. Warten auf alle =
   nach 5 s noch nicht fertig. Warten auf die endlichen = fertig in 1 ms.

   Endlos-Animationen sind fuer die Messung unproblematisch: Sie veraendern
   Deckkraft oder Position zyklisch, aber das Layout steht. Worauf es ankommt —
   Einblendungen, Uebergaenge, Verschiebungen — sind endliche Animationen, und
   auf die wird unveraendert gewartet. */
async function animationsRuhe(page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => {
          try {
            return a.effect?.getComputedTiming?.().iterations !== Infinity;
          } catch (_e) {
            return true; /* im Zweifel warten */
          }
        })
        .map((a) => a.finished.catch(() => {}))
    )
  );
}
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

/**
 * Der Sprachumschalter auf einer Rechtsseite — WCAG 2.1.1 Tastatur (A),
 * 2.4.7 Fokus sichtbar (AA), 2.5.8 Zielgroesse (AA), 4.1.2 Name/Rolle/Wert (A)
 * und 3.2.3 Konsistente Navigation (AA).
 *
 * OPS-2026-08-18, WAS HIER FRUEHER STAND: eine Messung namens "Sprachhinweis
 * offen". Bis zum 18.08.2026 loeste der EN-Knopf auf den Rechtsseiten keinen
 * Wechsel aus, sondern eine Rueckfrage — `public/js/sprachhinweis.js` oeffnete
 * einen zweisprachigen Dialog ("Diese Seite gibt es nur auf Deutsch"). Der Test
 * klickte darauf und erwartete `.sw-grund[data-modal="unuebersetzt"]`.
 *
 * Diese Uebergangsloesung ist ersatzlos weg: Es gibt vier englische Fassungen,
 * die Skriptdatei ist geloescht, der Umschalter ist ein reiner Link. Der
 * Klick NAVIGIERT jetzt — der alte Zustand ist also nicht "noch gruen", er
 * existiert nicht mehr. Die alte Erwartung stehenzulassen haette den Lauf rot
 * gemacht; sie einfach zu streichen haette das einzige Bedienelement dieser
 * Seiten aus dem Protokoll fallen lassen. Beides waere falsch.
 *
 * WARUM HIER KEIN ZWEITER axe-DURCHLAUF LAEUFT: Ein fokussierter Link sieht
 * fuer axe genauso aus wie ein nicht fokussierter — axe prueft keine
 * Fokusringe. Ein `messen()`-Aufruf haette denselben Zustand ein zweites Mal
 * gezaehlt und im Protokoll einen Zustand behauptet, den es nicht gibt. Genau
 * dieser Fehler steckte in der frueheren Messung "Startseite, leer, dunkel"
 * (Begruendung im Test unten). Gemessen wird deshalb, was den Umschalter
 * ausmacht und was axe NICHT sieht: seine Rollen, seine tastbare Flaeche und
 * sein Fokusring.
 *
 * Gegatet wird nur, was der geloeschte Dialog auch gatete — dass das
 * Bedienelement da ist und tut, was es soll. Die Groessen wandern als Messwert
 * ins Protokoll, nicht in eine Zusicherung: Diese Datei misst, sie richtet
 * nicht (Kopf der Datei).
 */
async function sprachumschalterMessen(page, bildschirm) {
  await beruhigen(page);

  const mess = await page.evaluate((tf) => {
    eval(tf);
    const pille = document.querySelector(".sprach-pille");
    if (!pille) return { pillen: 0 };
    const knoepfe = Array.from(pille.querySelectorAll(".sprach-knopf")).map((el) => {
      /* eslint-disable no-undef */
      const flaeche = trefferflaeche(el);
      /* eslint-enable no-undef */
      const kasten = el.getBoundingClientRect();
      return {
        sprache: el.getAttribute("data-lang"),
        element: el.tagName,
        aktiv: el.classList.contains("aktiv"),
        ariaCurrent: el.getAttribute("aria-current"),
        lang: el.getAttribute("lang"),
        ziel: el.getAttribute("href"),
        tabindex: el.getAttribute("tabindex"),
        name: (el.getAttribute("aria-label") || el.textContent || "").trim(),
        gemalt: { breite: Math.round(kasten.width), hoehe: Math.round(kasten.height) },
        tastbar: flaeche,
      };
    });

    /* Der Fokusring entsteht erst, wenn der Fokus wirklich sitzt:
       `:focus-visible` greift nicht ueber berechnete Stile allein. */
    const verweis = pille.querySelector("a.sprach-knopf[href]");
    let fokus = null;
    if (verweis) {
      verweis.focus();
      const s = getComputedStyle(verweis);
      fokus = {
        angekommen: document.activeElement === verweis,
        umriss: parseFloat(s.outlineWidth) || 0,
        umrissArt: s.outlineStyle,
        schatten: !!(s.boxShadow && s.boxShadow !== "none"),
      };
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }

    return {
      pillen: document.querySelectorAll(".sprach-pille").length,
      knoepfe,
      fokus,
      /* Reste der Uebergangsloesung. Muss 0 sein — sonst liegt totes Markup
         herum, das ein Screenreader trotzdem vorliest. */
      dialogReste: document.querySelectorAll('.sw-grund, .sw-modal, [data-modal="unuebersetzt"]').length,
    };
  }, TREFFERFLAECHE_JS);

  /* POSITIVKONTROLLE: Ohne Pille misst diese Funktion nichts und waere still
     gruen — genau die Falle, in die eine Messung ohne Gegenprobe laeuft. */
  expect(mess.pillen, `keine Umschalter-Pille auf ${bildschirm} gefunden`).toBe(1);
  expect(mess.knoepfe.length, `die Pille auf ${bildschirm} traegt nicht genau zwei Sprachen`).toBe(2);

  const aktiv = mess.knoepfe.filter((k) => k.aktiv);
  const verweise = mess.knoepfe.filter((k) => !k.aktiv);
  expect(aktiv.length, `${bildschirm}: genau eine Sprache muss als aktiv ausgewiesen sein`).toBe(1);
  expect(verweise.length, `${bildschirm}: genau eine Sprache muss verlinkt sein`).toBe(1);

  /* Die Sprache, in der die Seite dasteht, ist kein Bedienelement: Man kann
     sie nicht anklicken, weil man dort schon ist. Als <span> mit
     aria-current="page" sagt ein Screenreader "aktuelle Seite", statt einen
     Link anzubieten, der nirgendwohin fuehrt (WCAG 4.1.2). */
  expect(aktiv[0].element, `${bildschirm}: die aktive Sprache muss ein <span> sein, kein Link`).toBe("SPAN");
  expect(aktiv[0].ariaCurrent, `${bildschirm}: der aktiven Sprache fehlt aria-current="page"`).toBe("page");
  expect(aktiv[0].lang, `${bildschirm}: der aktiven Sprache fehlt das lang-Merkmal`).toBeTruthy();

  /* Die andere Sprache ist ein echter Link. Ohne `lang` spricht ein
     Screenreader "EN" deutsch aus; ohne ausdrueckliches tabindex="0" erreicht
     Safari ihn ohne "Vollzugriff Tastatur" gar nicht (BUG-2026-08-17-08,
     gefunden von einem Nutzer auf der Live-Seite). */
  expect(verweise[0].element, `${bildschirm}: die andere Sprache muss ein echter Link sein`).toBe("A");
  expect(verweise[0].lang, `${bildschirm}: dem Sprachverweis fehlt das lang-Merkmal`).toBeTruthy();
  expect(verweise[0].tabindex, `${bildschirm}: ohne tabindex="0" erreicht Safari den Sprachverweis nicht`).toBe("0");
  expect(verweise[0].name.length, `${bildschirm}: der Sprachverweis traegt keinen Namen`).toBeGreaterThan(1);
  expect(verweise[0].ariaCurrent, `${bildschirm}: nur die Seite, auf der man steht, darf aria-current tragen`).toBe(
    null
  );

  /* Das Ziel muss eine Seite sein, die es wirklich gibt — geprueft an der
     Seitensuche, nicht an einer Liste im Test. Ein Sprachverweis ins Leere
     waere fuer jemanden mit Screenreader nicht als Sackgasse erkennbar. */
  expect(REWRITES.has(verweise[0].ziel), `${bildschirm}: der Sprachverweis ${verweise[0].ziel} fuehrt ins Leere`).toBe(
    true
  );

  expect(mess.dialogReste, `${bildschirm}: Reste des geloeschten Sprachhinweis-Dialogs im Markup`).toBe(0);

  /* WCAG 2.4.7: Der Fokus muss sichtbar sein. "Sichtbar" heisst in diesem
     Projekt: eigener Umriss ab 2 px oder ein Schlagschatten — dieselbe
     Definition wie in `aaaMessen` weiter oben, damit nicht zwei Messungen
     dasselbe verschieden nennen. */
  expect(mess.fokus, `${bildschirm}: der Sprachverweis liess sich nicht fokussieren`).not.toBeNull();
  expect(mess.fokus.angekommen, `${bildschirm}: der Fokus kam am Sprachverweis nicht an`).toBe(true);
  expect(
    mess.fokus.umriss >= 2 || mess.fokus.schatten,
    `${bildschirm}: der Sprachverweis hat mit Tastaturfokus keinen sichtbaren Ring (${JSON.stringify(mess.fokus)})`
  ).toBe(true);

  befunde.push({
    bildschirm,
    zustand: "Sprachumschalter als Link (WCAG 2.1.1 A · 2.4.7 AA · 2.5.8 AA · 4.1.2 A)",
    ...mess,
    /* Nachrichtlich, wie ueberall in dieser Datei: 24 x 24 ist AA, 44 x 44 ist
       AAA und ausdruecklich nicht unser Ziel. Gemessen wird die TASTBARE
       Flaeche — die Sprachknoepfe sind sichtbar flacher als ihre Trefferzone,
       eine Messung an `getBoundingClientRect()` haette sie faelschlich als
       Mangel gemeldet (Begruendung bei TREFFERFLAECHE_JS oben). */
    unter24: mess.knoepfe.filter((k) => k.tastbar.breite < 24 || k.tastbar.hoehe < 24),
    unter44: mess.knoepfe.filter((k) => k.tastbar.breite < 44 || k.tastbar.hoehe < 44),
  });
  return mess;
}

test.describe("Prüfprotokoll WCAG 2.2 AA", () => {
  /* ZEITGRENZE. Diese Prüfungen fotografieren jedes gemessene Element einzeln
     und rechnen den Kontrast Bildpunkt für Bildpunkt nach — das ist langsam und
     soll es sein.

     Am 2026-08-19 lief "Profil, beide Modi, beide Themen" in der Pipeline in
     die Standardgrenze von 30 s. Nachgemessen statt vermutet: Auf dem
     Entwicklungsrechner braucht dieselbe Prüfung 13,7 s, die ganze Datei
     59 s — und zwar vor wie nach der Änderung, die den Ausfall ausgelöst hat.
     Die Arbeitsmenge ist also NICHT gewachsen; der CI-Läufer ist schlicht rund
     dreimal langsamer, und 30 s waren für eine Prüfung, die dutzende Elemente
     einzeln fotografiert, von Anfang an zu knapp bemessen.

     (Meine erste Erklärung lautete "sie misst jetzt mehr". Die Messung hat sie
     widerlegt — deshalb steht hier die Zahl und nicht die Vermutung.) */
  test.setTimeout(180000);

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

  /* Alle Rechtsseiten, deutsch UND englisch, aus dem Dateisystem abgeleitet
     (RECHTSSEITEN oben). Hier stand bis 2026-08-19 eine feste Liste mit den vier
     deutschen Seiten. Sie war beim Zuwachs von public/en/ sofort veraltet — und
     der Pruefbericht haette weiter behauptet, die Stichprobe umfasse die Website
     "vollstaendig". Eine Konformitaetsaussage auf einer veralteten Liste ist keine. */
  for (const pfad of RECHTSSEITEN) {
    const name = seitenName(pfad);
    test(`Rechtsseite: ${name}`, async ({ page }) => {
      /* Der Umschalter verweist auf saubere Adressen (/en/privacy); Firebase
         Hosting schreibt sie auf die HTML-Datei um, der Testserver kann das
         nicht. Die Attrappe bildet genau diese Regeln nach. */
      await hostingAdressenNachstellen(page);
      await page.goto(pfad);
      await expect(page.locator("h1")).toBeVisible();
      await messen(page, name, "hell");
      await zielgroessenMessen(page, name);
      await aaaMessen(page, name);
      await textAnpassungMessen(page, name);

      /* Der Sprachumschalter war bis v3.6.1 ein Dialog und wurde als solcher
         gemessen — Fokus-Kaefig, stillgelegte Umgebung, Escape. Seit es die
         englischen Seiten gibt, ist er ein LINK: keine Rueckfrage, kein Dialog,
         kein JavaScript. Gemessen wird jetzt der Link samt Fokusring,
         Trefferflaeche, Beschriftung — und ausdruecklich, dass vom Dialog
         nichts uebrig ist. */
      await sprachumschalterMessen(page, name);

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
    console.log(`[protokoll] ${befunde.length} Messungen (${browser}) abgelegt in ${AUSGABE}`);

    /* ── Wächter gegen Doku-Drift ──────────────────────────────────────────
       Anlass 2026-08-18: Im Prüfprotokoll stand in einer Tabellenzelle noch
       "15 Zustände, beide Browser", während längst 46 in DREI Browsern
       gemessen wurden. Die Messung war aktuell, der Satz daneben nicht.

       Der Nutzer zog daraus den naheliegenden Schluss: "Dann kannst du es ja
       nicht geprüft haben." Genau das ist der Schaden — eine veraltete Zahl
       entwertet den ganzen Bericht, auch wenn die Messung dahinter stimmt. Wer
       eine falsche Zahl findet, glaubt keiner der übrigen.

       Der Wächter sitzt HIER und nicht in der Unit-Suite: Die Rohdaten unter
       e2e/.protokoll/ sind bewusst nicht versioniert, ein Test anderswo hätte
       sie in der CI nie gesehen und sich still übersprungen. An dieser Stelle
       ist die Zahl gerade entstanden.

       Diese Datei richtet sonst nicht, sie misst — hier aber schon: Eine
       falsche Zahl in einem Prüfbericht ist kein Messergebnis, sondern ein
       Fehler in der Unterlage. */
    /* TEST-2026-08-20-11: Die englische Erklärung fehlte hier — ausgerechnet die
       Fassung, auf die sich Dritte berufen. Sie nennt dieselbe Zahl in eigener
       Formulierung ("70 states"), war aber von keinem Wächter gedeckt. */
    const UNTERLAGEN = [
      "docs/barrierefreiheit/PRUEFBERICHT-WCAG-EM.md",
      "docs/barrierefreiheit/PRUEFPROTOKOLL.md",
      "public/barrierefreiheit.html",
      "public/en/accessibility.html",
    ];
    /* Beide Sprachen. Der Wächter zählt seine Treffer, siehe Positivkontrolle. */
    const ZAHLWORT = /(\d+)\s*(?:Zust(?:ä|&auml;|ae)nde|states)\b/g;
    const falsch = [];
    let gelesen = 0;
    let treffer = 0;
    for (const rel of UNTERLAGEN) {
      const pfad = join(process.cwd(), rel);
      if (!existsSync(pfad)) continue;
      const text = readFileSync(pfad, "utf8");
      gelesen++;
      for (const m of text.matchAll(ZAHLWORT)) {
        treffer++;
        if (Number(m[1]) !== befunde.length) {
          falsch.push({ datei: rel, genannt: Number(m[1]), gemessen: befunde.length });
        }
      }
    }
    /* POSITIVKONTROLLE: Wurde keine Unterlage gelesen, prüft der Wächter
       nichts und wäre still grün. */
    expect(gelesen, "keine Unterlage gefunden — der Drift-Wächter ist blind").toBeGreaterThan(0);
    /* TEST-2026-08-20-11, zweite Positivkontrolle: Bisher genügte es, dass die
       DATEIEN da waren. Ändert jemand die Formulierung ("70 geprüfte Zustände"
       → "70 Prüfschritte"), findet das Muster nichts mehr — und ein Wächter
       ohne Treffer meldet grün, ohne verglichen zu haben. Genau diese
       Fehlerklasse (öffentliche Zahl driftet unbemerkt) war der Anlass, ihn zu
       bauen. Erwartet wird mindestens ein Treffer je Unterlage. */
    expect(
      treffer,
      `der Zahlen-Wächter fand in ${gelesen} Unterlagen keine einzige Zustandszahl — Muster oder Formulierung stimmen nicht mehr überein`
    ).toBeGreaterThanOrEqual(gelesen);
    expect(falsch, `Doku nennt eine andere Zahl von Zuständen als gemessen: ${JSON.stringify(falsch)}`).toEqual([]);

    /* ── Und dasselbe für das Prüfdatum ────────────────────────────────────
       ANLASS 2026-08-19, vom Nutzer gefunden: Nach drei behobenen
       Kontrastfehlern hatte ich die beiden Unterlagen in docs/ nachgezogen,
       die ÖFFENTLICHE Erklärung aber nicht — ausgerechnet die, auf die sich
       ein Dritter beruft. Sie stand danach mit einem Datum da, an dem der
       Befund noch gar nicht bekannt war. Der Nutzer musste daran denken; das
       ist die falsche Person dafür.

       Warum hier und nicht im Fakten-Drift-Wächter: Der liest ausschließlich
       Markdown und Text. Ein Muster für HTML wäre dort still nie angesprungen
       und hätte Sicherheit vorgetäuscht — nachgemessen, nicht vermutet. */
    /* TEST-2026-08-20-12: Die Muster fingen Tag und Jahr, den Monat liessen sie
       unkapturiert (`\w+`). Bei Tag-Gleichheit in verschiedenen Monaten — also
       bei jeder Aktualisierung am selben Kalendertag — haette der Waechter genau
       den Fehler wieder durchgelassen, gegen den er gebaut wurde. Ausserdem
       fehlten zwei englische Datumsstellen (Fusszeile "English version" /
       "German original"). */
    const DATUM_STELLEN = [
      ["public/barrierefreiheit.html", /zuletzt gepr&uuml;ft am (\d{1,2})\.&nbsp;(\w+)&nbsp;(\d{4})/],
      ["public/barrierefreiheit.html", /nicht behauptet &middot; Stand: (\d{1,2})\. (\w+) (\d{4})/],
      ["public/en/accessibility.html", /last reviewed on (\d{1,2})&nbsp;(\w+)&nbsp;(\d{4})/],
      ["public/en/accessibility.html", /English version: (\d{1,2}) (\w+) (\d{4})/],
      ["public/en/accessibility.html", /German original: (\d{1,2}) (\w+) (\d{4})/],
      [
        "docs/barrierefreiheit/PRUEFBERICHT-WCAG-EM.md",
        /\*\*Prüfdatum\*\*\s*\|\s*\d{1,2}\.–(\d{1,2})\.\s*(\w+)\s*(\d{4})/,
      ],
    ];
    /* Deutsche und englische Monatsnamen bezeichnen denselben Monat verschieden
       ("Dezember"/"December"). Ohne Normalisierung meldete der Waechter zwischen
       den Sprachfassungen einen Widerspruch, den es nicht gibt. */
    const MONATE = {
      januar: 1,
      january: 1,
      februar: 2,
      february: 2,
      märz: 3,
      maerz: 3,
      march: 3,
      april: 4,
      mai: 5,
      may: 5,
      juni: 6,
      june: 6,
      juli: 7,
      july: 7,
      august: 8,
      september: 9,
      oktober: 10,
      october: 10,
      november: 11,
      dezember: 12,
      december: 12,
    };
    const monatsNummer = (name) => MONATE[String(name).toLowerCase()] ?? null;
    const daten = [];
    for (const [rel, muster] of DATUM_STELLEN) {
      const pfad = join(process.cwd(), rel);
      if (!existsSync(pfad)) continue;
      const treffer = readFileSync(pfad, "utf8").match(muster);
      const monat = treffer ? monatsNummer(treffer[2]) : null;
      daten.push({
        datei: rel,
        datum: treffer && monat ? `${treffer[1]}.${monat}.${treffer[3]}` : null,
        monatsname: treffer ? treffer[2] : null,
      });
    }
    /* Ein unbekannter Monatsname ist ein Messproblem, kein Gleichstand. */
    expect(
      daten.filter((d) => d.monatsname && d.datum === null).map((d) => `${d.datei}: ${d.monatsname}`),
      "Monatsname nicht erkannt — die Tabelle in diesem Wächter ist unvollständig"
    ).toEqual([]);

    /* POSITIVKONTROLLE: Jede Stelle MUSS treffen. Ein Muster, das ins Leere
       läuft, meldet „kein Widerspruch" und ist damit von einem gesunden
       Ergebnis nicht zu unterscheiden. */
    expect(
      daten.filter((d) => d.datum === null).map((d) => d.datei),
      "Prüfdatum an dieser Stelle nicht gefunden — der Wächter ist dort blind"
    ).toEqual([]);
    expect(daten.length, "keine Unterlage mit Prüfdatum gefunden").toBeGreaterThan(2);

    const verschieden = [...new Set(daten.map((d) => d.datum))];
    expect(
      verschieden.length,
      `Das Datum der letzten Barrierefreiheits-Prüfung steht unterschiedlich da: ${JSON.stringify(daten)}`
    ).toBe(1);
  });
});
