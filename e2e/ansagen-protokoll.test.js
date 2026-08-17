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
    await ansagenMitschreiben(page, "Beast");
    await endpunkte(page, { status: "done", result: PROFIL });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.click('[data-demo="selfie"]');
    await page.waitForSelector(".cat-card", { timeout: 20000 });
    await page.evaluate(() => document.getElementById("biasSwitch").click());
    await page.waitForTimeout(1200);
    const zeilen = await baumLesen(page, "Beast an");
    expect(zeilen.length).toBeGreaterThan(5);
  });

  test("Rechtsseite: Sprachhinweis-Dialog", async ({ page }) => {
    await ansagenMitschreiben(page, "Sprachhinweis");
    await page.goto("/datenschutz.html");
    await page.waitForTimeout(700);
    await page.click('.sprach-knopf[data-lang="en"]');
    await page.waitForTimeout(600);
    const zeilen = await baumLesen(page, "Sprachhinweis offen");
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
