import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* ── Die Seite in ihren FEHLERZUSTÄNDEN ansehen ──────────────────────────────
 *
 * ANLASS (2026-08-21): Das TIEF-Audit vom 20.08. hat 52 Befunde gefunden, aber
 * zwei sichtbare Fehler auf öffentlichen Seiten übersehen — den springenden
 * Seitenkopf der Zahlen-Seite und die hakelige Tastatur-Rückgabe. Beide saßen
 * in Zuständen, die im Normalbetrieb nie auftreten. Die nachträgliche Messung
 * war eindeutig: 26 von 45 Fehler- und Blockade-Meldungen der Oberfläche kamen
 * in KEINER Prüfung vor.
 *
 * Der gemeinsame Nenner: Der Audit hat gelesen, nicht bedient. Ein Fehlerbild,
 * das nie jemand angesehen hat, ist nicht geprüft — auch wenn der Code, der es
 * erzeugt, gelesen wurde.
 *
 * WAS HIER GEPRÜFT WIRD, je Fehlerbild:
 *   1. Es erscheint überhaupt (sonst prüft der Rest nichts).
 *   2. Der Seitenkopf springt nicht — genau der Fehler von BUG-2026-08-21-03.
 *   3. Kein Text läuft aus seinem Kasten heraus.
 *   4. axe findet keinen Verstoß — Fehlermeldungen sind für Menschen in Not,
 *      die brauchen die Barrierefreiheit am dringendsten.
 *
 * Die Zustände werden über gefälschte Server-Antworten ausgelöst, nicht durch
 * Aufruf interner Funktionen: Nur so ist belegt, dass der Weg vom Server bis
 * zum Bildschirm wirklich zu diesem Bild führt.
 */

const HANDY = { width: 390, height: 844 };

/* Die Zuordnung stammt aus public/js/api.js:755-773 — dort verzweigt der Code
   die Server-Antwort auf das Fehlerbild. Ändert sich die Verzweigung, muss diese
   Tabelle mitgehen; der Test schlägt dann an, weil das Bild ausbleibt. */
const FEHLERBILDER = [
  {
    name: "Stundenlimit erreicht",
    antwort: { status: 429, body: { blocked: "limit", retryAfterSeconds: 600 } },
    sichtbar: "#limitBanner",
    /* Erscheint NUR bei Andrang, also im Workshop und bei der Presse-Welle —
       der am schlechtesten geprüfte und am schlechtesten zu erwischende Fall. */
  },
  {
    name: "Warteschlange voll",
    antwort: { status: 429, body: { blocked: "queueFull", retryAfterSeconds: 120 } },
    sichtbar: "#status",
  },
  {
    name: "Wartungsmodus",
    antwort: { status: 503, body: { maintenance: true, message: "Kurze Wartung, gleich wieder da." } },
    sichtbar: ".maintenance-modal, #maintenanceModal, [role='dialog']",
  },
  {
    name: "Bild zu groß",
    antwort: { status: 413, body: {} },
    sichtbar: "#status",
  },
  {
    name: "Format nicht lesbar",
    antwort: { status: 400, body: {} },
    sichtbar: "#status",
  },
  {
    name: "Server überlastet",
    antwort: { status: 500, body: {} },
    sichtbar: "#status",
  },
  {
    /* NEU 30.08.2026: Seit dem Firestore-Umbau kann eine Analyse daran
       scheitern, dass der Einstellungssatz fehlt oder abgelehnt wurde. Der
       Fall lief bis hierher durch KEINE Prüfung am Bildschirm — der Schlüssel
       stand in beiden Sprachdateien, das Backend sendete ihn, und ob der Satz
       je bei einem Menschen ankommt, hatte niemand gemessen.

       Er läuft anders als die sechs darüber: nicht als HTTP-Fehler beim
       Einlass, sondern als Ergebnis eines FERTIGEN Auftrags. Der Weg über den
       Statusabruf ist deshalb eigens nachgebildet. */
    name: "Einstellungssatz fehlt",
    antwort: { status: 200, body: { jobId: "probe-config", resultToken: "tok-config" } },
    /* Die Form ist NICHT geraten, sondern an handle-job-status.js und
       render.js abgelesen: Der Statusabruf liefert { status, result }, und
       `result` ist genau das Objekt, das renderCurrentMode() bekommt. Fehlt
       darin `profiles`, zeigt render.js den uebersetzten `blockedReason` in
       #simulation. Ein geratener Mock (result.mode statt result.meta.mode)
       liess den Test zuerst rot laufen — er haette dann nie geprueft, was er
       soll. */
    jobStatus: {
      status: "done",
      result: {
        meta: { mode: "blocked" },
        blockedReason: "blocked.configMissing",
        profiles: null,
      },
    },
    sichtbar: "#simulation",
    /* Der Text muss dem Teilnehmer sagen, dass es NICHT an ihm liegt —
       in BEIDEN Sprachen. Getrennt geprueft, siehe unten. */
    erwarteterText: { de: /liegt nicht an dir/i, en: /not your fault/i },
  },
];

/* Ein winziges, gültiges JPEG — der Upload-Weg soll echt durchlaufen werden,
   damit die Antwort auch wirklich am Fehlerpfad ankommt. */
const MINI_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

async function seiteVorbereiten(page, antwort, jobStatus) {
  await page.route("**/api/stats", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 12, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 12, week: 60, month: 300, total: 2000 },
      }),
    })
  );
  await page.route("**/api/enqueue", (r) =>
    r.fulfill({
      status: antwort.status,
      contentType: "application/json",
      body: JSON.stringify(antwort.body),
    })
  );
  /* Fehlerberichte ins Leere laufen lassen: Sie gehören nicht zum Prüfgegenstand
     und würden den Lauf nur verlangsamen. */
  await page.route("**/api/errors**", (r) => r.fulfill({ status: 204, body: "" }));
  /* Nur für Fehlerbilder, die über den Statusabruf kommen (siehe
     "Einstellungssatz fehlt"). Ohne diese Route pollt der Client ins Leere,
     der Test liefe in einen Zeitablauf und sagte nichts über den Text. */
  if (jobStatus) {
    await page.route("**/api/job-status**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jobStatus) })
    );
    await page.route("**/api/jobStatus**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jobStatus) })
    );
  }
}

async function kopfHoehe(page) {
  /* Position im DOKUMENT, nicht im sichtbaren Fenster. Der erste Anlauf maß
     `getBoundingClientRect().top` — der ist scroll-abhängig, und die Seite
     springt beim Fehler nach unten zum Hinweis. Alle sechs Prüfungen meldeten
     dadurch einen „Sprung" von 99 auf -431, obwohl sich am Layout nichts
     geändert hatte. Ein Messwert, der auf Scrollen reagiert, taugt nicht zur
     Aussage über das Layout. */
  return page.evaluate(() => {
    const h1 = document.querySelector("h1, .hero-title, .stats-hero__title");
    if (!h1) return -1;
    return Math.round(h1.getBoundingClientRect().top + window.scrollY);
  });
}

async function fehlerAusloesen(page) {
  await page.setInputFiles("#fileInput", {
    name: "probe.jpg",
    mimeType: "image/jpeg",
    buffer: MINI_JPEG,
  });
  const knopf = page.locator("#analyzeBtn, button[type='submit'], .upload-btn").first();
  if (await knopf.isVisible().catch(() => false)) {
    await knopf.click().catch(() => {});
  }
}

/* DIE SPRACHE WIRD AUSDRUECKLICH GESETZT (30.08.2026).
   Vorher erbte die Suite die Sprache des Browsers. Gemessen wurde damit, was
   die Umgebung zufaellig vorgab — lokal und im CI moeglicherweise
   Verschiedenes. Der deutsche Fehlertext, den die Workshop-Teilnehmer sehen,
   war dadurch von KEINEM E2E-Test je geprueft.

   Die sechs Standard-Fehlerbilder laufen auf Deutsch (die Sprache der
   Workshops). Der Fall mit ausformuliertem Erwartungstext laeuft zusaetzlich
   auf Englisch — dort haengt die Aussage am Wortlaut, nicht nur am Kasten. */
const SPRACHEN = ["de", "en"];

for (const bild of FEHLERBILDER) {
  for (const sprache of SPRACHEN) {
    if (sprache === "en" && !bild.erwarteterText) continue;
    testFuerSprache(bild, sprache);
  }
}

function testFuerSprache(bild, sprache) {
  const zusatz = bild.erwarteterText ? ` [${sprache}]` : "";
  test(`Fehlerbild „${bild.name}"${zusatz}: erscheint, verschiebt den Kopf nicht, ist barrierefrei`, async ({
    page,
  }) => {
    await page.setViewportSize(HANDY);
    await page.addInitScript((s) => {
      /* Die Anwendung liest die Sprache aus ?lang= oder dem Browser. Hier
         wird sie fest vorgegeben, damit der Lauf nicht von der Umgebung
         abhaengt. */
      Object.defineProperty(navigator, "language", { get: () => (s === "de" ? "de-AT" : "en-US") });
      Object.defineProperty(navigator, "languages", {
        get: () => (s === "de" ? ["de-AT", "de"] : ["en-US", "en"]),
      });
    }, sprache);
    await seiteVorbereiten(page, bild.antwort, bild.jobStatus);
    await page.goto(`/?lang=${sprache}`);
    await page.waitForLoadState("networkidle");

    const kopfVorher = await kopfHoehe(page);
    expect(kopfVorher, "Überschrift muss vor dem Fehler auffindbar sein").toBeGreaterThan(-1);

    await fehlerAusloesen(page);

    /* ── 1. Das Bild erscheint überhaupt ── */
    const ziel = page.locator(bild.sichtbar).first();
    await expect(ziel, `„${bild.name}" muss sichtbar werden — sonst prüft der Rest nichts`).toBeVisible({
      timeout: 15000,
    });

    /* ── 1b. Der Text sagt das Richtige ── */
    if (bild.erwarteterText) {
      const muster = bild.erwarteterText[sprache] || bild.erwarteterText;
      /* Ein sichtbarer Kasten allein genuegt nicht: Beim Fehlerbild
         "Einstellungssatz fehlt" kommt es genau darauf an, dass der
         Teilnehmer liest, dass es NICHT an ihm liegt. Ein leerer oder
         generischer Kasten waere schlimmer als keiner. */
      await expect(
        ziel,
        `„${bild.name}" zeigt einen Kasten, aber nicht den erwarteten Text. ` +
          `Der Teilnehmer muss erfahren, woran es liegt.`
      ).toHaveText(muster, { timeout: 15000 });
    }

    /* ── 2. Der Seitenkopf springt nicht (BUG-2026-08-21-03) ── */
    const kopfNachher = await kopfHoehe(page);
    expect(
      Math.abs(kopfNachher - kopfVorher),
      `Der Seitenkopf ist beim Fehlerbild „${bild.name}" von ${kopfVorher} auf ${kopfNachher} gesprungen. ` +
        `Ein Hinweis darf sich nicht ÜBER die Überschrift schieben — genau das war BUG-2026-08-21-03.`
    ).toBeLessThanOrEqual(4);

    /* ── 3. Kein Text läuft aus seinem Kasten ── */
    const ueberlauf = await page.evaluate((wahl) => {
      const kasten = document.querySelector(wahl);
      if (!kasten) return null;
      const aussen = kasten.getBoundingClientRect();
      for (const kind of kasten.querySelectorAll("p, span, a, h1, h2")) {
        const innen = kind.getBoundingClientRect();
        if (innen.width === 0) continue;
        if (innen.right > aussen.right + 2 || innen.left < aussen.left - 2) {
          return {
            text: (kind.textContent || "").trim().slice(0, 60),
            innen: Math.round(innen.right),
            aussen: Math.round(aussen.right),
          };
        }
      }
      return null;
    }, bild.sichtbar);
    expect(
      ueberlauf,
      ueberlauf ? `Text läuft aus dem Kasten: „${ueberlauf.text}" (${ueberlauf.innen} px > ${ueberlauf.aussen} px)` : ""
    ).toBeNull();

    /* ── 4. Barrierefrei ──

       ZUERST die Einblendung abwarten. Die Fehlerbilder erscheinen mit
       `animation: fadeUp 0.4s` — `toBeVisible()` wartet aber nur darauf, dass
       das Element ANGEZEIGT wird, nicht darauf, dass die Animation durch ist.

       Wer mittendrin misst, misst die Zwischenfarben des Übergangs. Genau das
       ist am 29.08.2026 passiert: Der Lauf meldete sechs Kontrastverstöße im
       Fehlerbild „Stundenlimit erreicht" (`.limit-banner__title` mit 1,51 statt
       4,5), reproduzierbar NUR im vollen Lauf — bei ausgelasteter Maschine
       kommt der Test früher an als die Animation. Allein lief dieselbe Datei
       grün. Nachgemessen: eine laufende Animation zum Messzeitpunkt,
       Vordergrundfarbe `#ddc4ba` statt des echten Werts.

       Das ist keine Lockerung der Prüfung, sondern ihre Bedingung: Geprüft
       gehört der Zustand, den ein Mensch sieht — und der steht erst nach der
       Einblendung. */
    await ziel.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

    const ergebnis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const verstoesse = ergebnis.violations.map((v) => `${v.id} (${v.nodes.length}×): ${v.help}`);
    expect(verstoesse, `axe-Verstöße im Fehlerbild „${bild.name}"`).toEqual([]);
  });
}
