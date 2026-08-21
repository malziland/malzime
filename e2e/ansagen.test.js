import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* Was ein Screenreader sagen wuerde — mitgeschrieben statt gehoert.
 *
 * ANLASS: Vier WCAG-Kriterien gelten als "nur von Hand pruefbar", weil sie
 * einen Screenreader-Durchgang verlangen. Der Nutzer traut sich den nicht zu,
 * und das ist eine berechtigte Ansage: VoiceOver zu bedienen ist eine eigene
 * Faehigkeit.
 *
 * WAS HIER GEHT: VoiceOver liest den Barrierefreiheits-Baum vor — Rolle, Name
 * und Zustand je Element. Und Ansagen waehrend des Betriebs entstehen dadurch,
 * dass sich Text in einem `aria-live`-Bereich aendert. Beides ist auslesbar.
 * Damit laesst sich pruefen, WAS gesprochen wuerde und in welcher Reihenfolge.
 *
 * WAS HIER NICHT GEHT, und das bleibt so: ob Safari und VoiceOver das dann auch
 * wirklich aussprechen (Fehler in deren Zusammenspiel sieht man nur am Geraet),
 * und ob eine Ansage fuer einen Menschen VERSTAENDLICH ist. Das Erste ist ein
 * Restrisiko, das Zweite eine Beurteilung — beides gehoert ehrlich benannt und
 * nicht als "geprueft" ausgegeben.
 */
/**
 * ansagen.test.js — ALLES, was ein Screenreader sagen wuerde.
 *
 * Zusammengelegt am 2026-08-18 aus drei Dateien (ansagen-protokoll,
 * ansagen-haeufigkeit, ansagen-doppelung), die getrennt gewachsen waren und
 * dieselbe Frage aus drei Richtungen stellten. Jede hatte ihre eigene Kopie der
 * Testdaten und ihres Endpunkt-Aufbaus — zwei Kopien, die niemand gegen die
 * dritte haelt, driften gemeinsam ab.
 *
 * Drei Fragen, eine Datei:
 *   1. WAS wird gesagt        — Baum und Live-Bereiche mitschreiben
 *   2. WIE OFT wird es gesagt — Haeufigkeit waehrend der Wartezeit
 *   3. Sagt es sich DOPPELT   — Wortgruppen, die sich im Namen wiederholen
 *
 * Zustaendigkeiten der uebrigen Barrierefreiheits-Dateien:
 *   a11y.test.js                     blockierendes Gate, schnell, wenige Seiten
 *   barrierefreiheit-protokoll.js    breite Messung, schreibt Befunde weg
 *   tastatur-erreichbarkeit.test.js  Struktur der Tastaturbedienung
 */

const AUSGABE = join(process.cwd(), "e2e", ".protokoll");
const mitschrift = { baum: {}, ansagen: [] };

const PROFIL = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.8 },
        interessen: { label: "Interessen", value: "Outdoor", confidence: 0.7 },
      },
      ad_targeting: ["Outdoor-Werbung"],
      manipulation_triggers: ["FOMO"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: { alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.9 } },
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Profil.",
    },
  },
  privacyRisks: [],
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "a-1", mode: "multimodal", subject: "HUMAN" },
};

/** Schreibt jede Aenderung in einem aria-live-Bereich mit — das sind die Ansagen. */
async function ansagenMitschreiben(page, wo) {
  await page.exposeFunction("__ansage", (text, quelle) => {
    const sauber = (text || "").trim();
    if (sauber) mitschrift.ansagen.push({ wo, quelle, text: sauber.slice(0, 200) });
  });
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const beobachte = (el) => {
        if (!el) return;
        new MutationObserver(() => {
          window.__ansage(el.textContent, el.id || el.className || el.tagName);
        }).observe(el, { childList: true, subtree: true, characterData: true });
      };
      document.querySelectorAll("[aria-live], [role='status'], [role='alert']").forEach(beobachte);
      /* Spaeter eingehaengte Live-Bereiche mitnehmen. */
      new MutationObserver((m) => {
        for (const e of m) {
          for (const n of e.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.matches?.("[aria-live], [role='status'], [role='alert']")) beobachte(n);
            n.querySelectorAll?.("[aria-live], [role='status'], [role='alert']").forEach(beobachte);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  });
}

/** Der Baum, wie ein Screenreader ihn durchgeht: Rolle und Name je Element.
 *
 * Selbst gebaut statt ueber `page.accessibility` — die API gibt es in dieser
 * Playwright-Version nicht mehr. Rolle und zugaenglicher Name werden nach den
 * ueblichen Regeln ermittelt: ausdrueckliche `role`, sonst nach Element; Name
 * aus `aria-label`, `aria-labelledby`, `alt`, zugehoerigem `label` oder Text.
 * Das ist eine NAEHERUNG an das, was VoiceOver sagt — genau genug, um fehlende
 * oder nichtssagende Namen zu finden, nicht genug, um Aussprache zu beurteilen.
 */
async function baumLesen(page, wo) {
  const zeilen = await page.evaluate(() => {
    const rolleVon = (el) => {
      const r = el.getAttribute("role");
      if (r) return r;
      const t = el.tagName.toLowerCase();
      if (t === "a") return el.hasAttribute("href") ? "link" : "text";
      if (t === "button") return "button";
      if (t === "img") return "img";
      if (/^h[1-6]$/.test(t)) return "heading " + t[1];
      if (t === "input") return "input " + (el.type || "text");
      if (t === "select") return "select";
      if (t === "textarea") return "textarea";
      if (t === "main" || t === "nav" || t === "footer" || t === "header") return t;
      return null;
    };
    const nameVon = (el) => {
      const beschriftet = el.getAttribute("aria-labelledby");
      if (beschriftet) {
        const q = beschriftet
          .split(/\s+/)
          .map((i) => document.getElementById(i))
          .filter(Boolean);
        if (q.length) return q.map((n) => n.textContent.trim()).join(" ");
      }
      const label = el.getAttribute("aria-label");
      if (label) return label;
      if (el.tagName === "IMG") return el.getAttribute("alt") ?? "(kein alt-Text)";
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.textContent.trim();
      }
      return (el.textContent || "").trim();
    };
    const raus = [];
    /* Ein Screenreader liest NICHT, was per display/visibility weg ist — und
       auch nicht, was unter `aria-hidden` oder `inert` liegt, auch nicht in
       einem Elternknoten. Der erste Anlauf pruefte nur die ersten beiden und
       meldete deshalb den Honeypot und zwei geschlossene Dialoge als
       "vorgelesen". Das waren Fehlalarme des Messmittels. */
    const sichtbar = (el) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      let n = el;
      while (n && n !== document.documentElement) {
        if (n.getAttribute?.("aria-hidden") === "true") return false;
        if (n.hasAttribute?.("inert")) return false;
        const ns = getComputedStyle(n);
        if (ns.display === "none" || ns.visibility === "hidden") return false;
        n = n.parentElement;
      }
      return true;
    };
    document.querySelectorAll("body *").forEach((el) => {
      const rolle = rolleVon(el);
      if (!rolle || rolle === "text") return;
      if (!sichtbar(el)) return;
      const name = nameVon(el).replace(/\s+/g, " ").slice(0, 90);
      raus.push({
        rolle,
        name,
        zustand: [
          el.getAttribute("aria-pressed") ? "pressed=" + el.getAttribute("aria-pressed") : "",
          el.checked !== undefined && el.type === "checkbox" ? "checked=" + el.checked : "",
          el.getAttribute("aria-live") ? "live=" + el.getAttribute("aria-live") : "",
          el.disabled ? "disabled" : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    });
    return raus;
  });
  mitschrift.baum[wo] = zeilen;
  return zeilen;
}

async function endpunkte(page, jobStatus) {
  await page.route("**/api/stats", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 1, limit: 500, limitActive: false },
        totals: { today: 1, week: 1, month: 1, total: 1 },
        useQueue: true,
        sprachumschalter: true,
      }),
    })
  );
  await page.route("**/api/enqueue", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "a", resultToken: "t" }) })
  );
  await page.route("**/api/job-status**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jobStatus) })
  );
  await page.route("**/nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
}

test.describe("Ansage-Protokoll", () => {
  test("Startseite: was beim Durchgehen vorgelesen wird", async ({ page }) => {
    await ansagenMitschreiben(page, "Startseite");
    await endpunkte(page, { status: "done", result: PROFIL });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForTimeout(900);
    const zeilen = await baumLesen(page, "Startseite");
    /* POSITIVKONTROLLE: Ein leerer Baum waere ein perfektes Ergebnis fuer nichts. */
    expect(zeilen.length).toBeGreaterThan(5);
  });

  test("Analyse: welche Ansagen von selbst kommen", async ({ page }) => {
    await ansagenMitschreiben(page, "Analyse");
    await endpunkte(page, { status: "queued", position: 3, etaSeconds: 45 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForTimeout(600);
    await page.click('[data-demo="selfie"]');
    await page.waitForTimeout(5000);

    await page.unroute("**/api/job-status**");
    await page.route("**/api/job-status**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "done", result: PROFIL }),
      })
    );
    await page.waitForTimeout(6000);

    await baumLesen(page, "Profil fertig");
    expect(mitschrift.ansagen.filter((a) => a.wo === "Analyse").length).toBeGreaterThan(0);
  });

  test("Beast-Umschalter: Zustand und Ansage", async ({ page }) => {
    /* OPS-2026-08-21-08: Der Wartewert von 45 s darunter war wirkungslos — das
       Zeitlimit des Tests liegt bei 30 s und greift vorher. Am 21.08. hat genau
       das die Auslieferung blockiert. `test.slow()` verdreifacht das Limit auf
       90 s; erst damit wirkt die Geduld, die hier seit einer frueheren
       Sanierung beabsichtigt war. Geprueft wird unveraendert dasselbe. */
    test.slow();
    await ansagenMitschreiben(page, "Beast");
    await endpunkte(page, { status: "done", result: PROFIL });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.click('[data-demo="selfie"]');
    /* 45 s statt 20: Auf dem Firefox-Laeufer der CI reichten 20 s nicht, der
     Test wurde dort zeitweise rot, obwohl die Seite in Ordnung ist. Die
     Zusicherung darunter bleibt unveraendert — verlaengert wird nur die
     Geduld, nicht die Toleranz. */
    await page.waitForSelector(".cat-card", { timeout: 45000 });
    await page.evaluate(() => document.getElementById("biasSwitch").click());
    await page.waitForTimeout(1200);
    const zeilen = await baumLesen(page, "Beast an");
    expect(zeilen.length).toBeGreaterThan(5);
  });

  test("Rechtsseite: der Sprachumschalter als Link", async ({ page }) => {
    /* Bis v3.6.1 oeffnete der EN-Knopf hier eine Rueckfrage ("Diese Seite gibt
       es nur auf Deutsch"), und dieser Test schrieb mit, was ein Screenreader
       in diesem Dialog vorliest. Seit die englischen Seiten existieren, ist der
       Umschalter ein Link — es gibt nichts mehr zu oeffnen.

       Geprueft wird jetzt, dass der Screenreader die aktive Sprache und das
       Ziel unterscheiden kann: Die aktive Sprache ist kein Link (man steht
       darauf), die andere schon, und beide tragen ihre eigene Sprache als
       Auszeichnung — sonst spricht die Stimme "EN" deutsch aus. */
    await ansagenMitschreiben(page, "Sprachumschalter");
    await page.goto("/datenschutz.html");

    const aktiv = page.locator("span.sprach-knopf.aktiv");
    const verweis = page.locator("a.sprach-knopf");
    await expect(aktiv, "kein aktiver Sprachknopf — Test wuerde nichts pruefen").toHaveCount(1);
    await expect(verweis, "kein Sprachverweis — Test wuerde nichts pruefen").toHaveCount(1);

    await expect(aktiv).toHaveAttribute("aria-current", "page");
    await expect(aktiv).toHaveAttribute("lang", "de");
    await expect(verweis).toHaveAttribute("lang", "en");
    await expect(verweis).toHaveAttribute("aria-label", "English");

    const zeilen = await baumLesen(page, "Sprachumschalter");
    expect(zeilen.length).toBeGreaterThan(3);
  });

  for (const [name, pfad] of [
    ["Zahlen-Seite", "/stats.html"],
    ["Datenschutz", "/datenschutz.html"],
    ["Impressum", "/impressum.html"],
    ["Nutzungsbedingungen", "/nutzungsbedingungen.html"],
    ["Barrierefreiheit", "/barrierefreiheit.html"],
  ]) {
    test(`Vorlese-Reihenfolge: ${name}`, async ({ page }) => {
      await ansagenMitschreiben(page, name);
      await endpunkte(page, { status: "done", result: PROFIL });
      await page.goto(pfad);
      await page.waitForTimeout(800);
      const zeilen = await baumLesen(page, name);
      expect(zeilen.length).toBeGreaterThan(5);
    });
  }

  test.afterAll(() => {
    mkdirSync(AUSGABE, { recursive: true });
    writeFileSync(join(AUSGABE, "ansagen.json"), JSON.stringify(mitschrift, null, 2), "utf8");
    expect(Object.keys(mitschrift.baum).length).toBeGreaterThan(0);
  });
});

/* ── 2. WIE OFT wird gesprochen ────────────────────────────────────────────
Wie oft ein Screenreader waehrend der Wartezeit spricht — und dass das Ergebnis
 * einen Namen hat.
 *
 * ANLASS: Ein Nutzer hat mit VoiceOver zugehoert und gesagt, es sei „total
 * nervig, der wiederholt andauernd". Nachgemessen: 19 Ansagen in 30 Sekunden
 * Wartezeit, bei einer vollen Analyse rund 40 — fast immer derselbe Satz.
 * Ursache: `showQueueWaiting` schrieb den Text bei JEDER Statusabfrage neu, also
 * alle 2 Sekunden, auch wenn er sich nicht geaendert hatte. Jede Zuweisung an
 * `textContent` loest in einem `aria-live`-Bereich eine neue Ansage aus.
 *
 * Dazu kamen die rotierenden Zier-Meldungen („Analysiere Pixel…"), die sich
 * tatsaechlich aendern und deshalb ebenfalls vorgelesen wurden.
 *
 * WARUM KEIN TEST DAS FAND: Die Pruefungen sahen, DASS angesagt wird — nicht WIE
 * OFT. Eine Seite, die sich alle zwei Sekunden selbst wiederholt, ist fuer blinde
 * Nutzer unbenutzbar, waehrend jede Messung gruen bleibt.
 *
 * MASSSTAB: Waehrend einer Wartezeit gehoeren die Zustandswechsel angesagt —
 * „Foto unterwegs", „Analyse gestartet", die Warteschlangen-Position — und sonst
 * nichts. Drei bis vier pro Minute. Die Grenze hier ist bewusst grosszuegig
 * gesetzt (5 in 30 Sekunden), damit sie echte Rueckfaelle faengt und nicht bei
 * jeder Textaenderung anschlaegt.
*/

test("Wartezeit: hoechstens fuenf Ansagen in 30 Sekunden", async ({ page }) => {
  test.setTimeout(90000);
  const ansagen = [];
  await page.exposeFunction("__ansage", (t) => ansagen.push((t || "").trim()));
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll("[aria-live]:not([aria-live='off']), [role='status'], [role='alert']").forEach((el) => {
        new MutationObserver(() => window.__ansage(el.textContent)).observe(el, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
    });
  });

  await endpunkte(page, { status: "queued", position: 3, etaSeconds: 45 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForTimeout(500);
  const vorher = ansagen.length;
  await page.click('[data-demo="selfie"]');
  await page.waitForTimeout(30000);
  const waehrend = ansagen.slice(vorher).filter(Boolean);

  /* POSITIVKONTROLLE: Null Ansagen waeren kein Erfolg, sondern eine kaputte
     Messung — oder eine Seite, die blinden Nutzern gar nichts sagt. */
  expect(waehrend.length).toBeGreaterThan(0);
  expect(waehrend.length).toBeLessThanOrEqual(5);
});

test("Nach der Analyse traegt der Ergebnisbereich einen Namen", async ({ page }) => {
  /* Der zweite Fund desselben Nutzers: „Analyse beendet" kam, danach nichts.
     Der Fokus sprang auf einen <section> ohne Rolle und ohne Namen — VoiceOver
     landet dort und hat nichts zu sagen. */
  /* OPS-2026-08-21-08: siehe oben — ohne test.slow() war der Wartewert von
     45 s wirkungslos, weil das Zeitlimit des Tests bei 30 s liegt. */
  test.slow();
  await endpunkte(page, { status: "done", result: PROFIL });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.click('[data-demo="selfie"]');
  await page.waitForSelector(".cat-card", { timeout: 45000 });
  await page.waitForTimeout(1200);

  const fokus = await page.evaluate(() => {
    const a = document.activeElement;
    return { id: a?.id, rolle: a?.getAttribute("role"), name: a?.getAttribute("aria-label") };
  });
  expect(fokus.id).toBe("resultsPanel");
  expect(fokus.rolle).toBe("region");
  expect(fokus.name).toBeTruthy();
});

/* ── 3. Sagt sich eine Ansage DOPPELT ──────────────────────────────────────
 * ansagen-doppelung.test.js — Wächter gegen doppelte Wörter in einer Ansage.
 *
 * Anlass 2026-08-18: Die Knöpfe der Beispielbilder trugen ihren Namen
 * zweimal — einmal aus dem Alternativtext des Bildes, einmal aus der
 * sichtbaren Bildunterschrift darunter. Beides landet im zugänglichen Namen
 * des Knopfes, also sagte VoiceOver „Selfie am Stephansplatz. Zeigt keine
 * reale Person. Selfie am Stephansplatz".
 *
 * Kein Verstoß gegen ein Erfolgskriterium — kein Kriterium verbietet
 * Wiederholung. Aber genau diese Sorte Doppelung war die Beschwerde beim
 * ersten Zuhören: „er wiederholt andauernd". Formal richtig und trotzdem
 * mühsam ist der Zustand, den Messungen am leichtesten übersehen.
 *
 * Gefunden wurde es nicht durch Messen, sondern durch AUSLESEN, was ein
 * Screenreader an dieser Stelle vorfindet. Das ist der Grund für diese Datei:
 * Der Name jedes Bedienelements wird gelesen, nicht nur auf Vorhandensein
 * geprüft.
 */

/* Zerlegt einen Namen in Wortgruppen und sucht Gruppen, die sich wortwörtlich
   wiederholen. Einzelne Wörter zählen nicht — „der" darf mehrfach vorkommen. */
function doppelteGruppen(name) {
  const woerter = name
    .toLowerCase()
    .replace(/[.,:;!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const treffer = [];
  for (let laenge = 3; laenge <= Math.floor(woerter.length / 2); laenge++) {
    for (let i = 0; i + laenge * 2 <= woerter.length + laenge; i++) {
      const gruppe = woerter.slice(i, i + laenge).join(" ");
      const rest = woerter.slice(i + laenge).join(" ");
      if (rest.includes(gruppe)) treffer.push(gruppe);
    }
  }
  return [...new Set(treffer)];
}

test.describe("Ansagen wiederholen sich nicht in sich selbst", () => {
  test("Rückbauprobe: die Suche findet eine Doppelung, wenn es eine gibt", () => {
    /* Ohne diese Zeile wäre ein kaputter Vergleich still grün. */
    expect(doppelteGruppen("Selfie am Stephansplatz zeigt niemanden Selfie am Stephansplatz").length).toBeGreaterThan(
      0
    );
    expect(doppelteGruppen("Foto auswählen oder hierhin ziehen")).toEqual([]);
  });

  test("kein Bedienelement sagt seinen Namen zweimal", async ({ page }) => {
    await page.route("**/api/stats", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          current: { count: 1, limit: 500, limitActive: false, retryAfterSeconds: 0 },
          totals: { today: 1, week: 1, month: 1, total: 1 },
          useQueue: true,
          sprachumschalter: true,
        }),
      })
    );
    await page.goto("/");

    const bedienbar = page.locator("button, a[href], [role='button'], input, select");
    const anzahl = await bedienbar.count();
    /* POSITIVKONTROLLE: Findet die Suche keine Bedienelemente, ist der Test
       blind und nicht die Seite sauber. */
    expect(anzahl).toBeGreaterThan(8);

    const gefunden = [];
    for (let i = 0; i < anzahl; i++) {
      const el = bedienbar.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const name = (
        await el.evaluate((n) => (n.textContent || "") + " " + (n.getAttribute("aria-label") || ""))
      ).trim();
      const voll = await el.evaluate((n) => {
        /* So, wie ein Screenreader den Namen zusammensetzt: aria-label
           schlägt alles, sonst Inhalt inklusive Alternativtexten. */
        const label = n.getAttribute("aria-label");
        if (label) return label;
        const teile = [];
        n.querySelectorAll("img[alt]").forEach((b) => {
          if (b.getAttribute("aria-hidden") !== "true") teile.push(b.alt);
        });
        n.childNodes.forEach((k) => {
          if (k.nodeType === 3) teile.push(k.textContent);
          else if (k.nodeType === 1 && k.getAttribute("aria-hidden") !== "true" && k.tagName !== "IMG")
            teile.push(k.textContent);
        });
        return teile.join(" ").replace(/\s+/g, " ").trim();
      });
      if (!voll || voll.length < 12) continue;
      const doppel = doppelteGruppen(voll);
      if (doppel.length) gefunden.push({ name: voll.slice(0, 90), doppelt: doppel[0] });
      void name;
    }

    expect(gefunden, `Diese Ansagen enthalten sich selbst doppelt: ${JSON.stringify(gefunden, null, 1)}`).toEqual([]);
  });
});
