import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* End-to-End-Prüfung des Sprachumschalters (v3.3) im echten Browser.
 *
 * Geprüft wird die Matrix, nach der gefragt wurde: drei Zustände (leer,
 * Analyse läuft, Profil fertig) × zwei Sprachen × zwei Themen (hell/Beast),
 * Rückfrage offen und geschlossen. Dazu die Dinge, die jsdom prinzipiell nicht
 * messen kann: Fokus-Käfig im echten Browser, Ziel-Größen in Pixeln,
 * Farbkontrast und axe.
 *
 * Gemessen wird durchgehend mit reduzierter Bewegung — ohne das erwischt axe
 * Elemente mitten in der Einblendung und meldet Kontrast ~1:1 (Schein-Funde,
 * siehe e2e/a11y.test.js). */

/* Der Testbrowser meldet sonst en-US, und die Seite startet dann englisch —
   die Erwartungen unten gehen aber vom deutschen Ausgangszustand aus. Genau
   dieses Verhalten prueft der Test „Startsprache folgt dem Geraet" gesondert
   mit umgekehrter Einstellung. */
test.use({ locale: "de-AT" });

const PROFIL = {
  profiles: {
    normal: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.8 },
        herkunft: { label: "Herkunft", value: "Mitteleuropa", confidence: 0.6 },
      },
      ad_targeting: ["Outdoor-Werbung"],
      manipulation_triggers: ["FOMO"],
      profileText: "Ein junger Erwachsener mit aktivem Lebensstil.",
    },
    boost: {
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "25-30 Jahre", confidence: 0.9 },
      },
      ad_targeting: ["Premium-Werbung"],
      manipulation_triggers: ["Statusangst"],
      profileText: "Beast-Mode-Profil.",
    },
  },
  privacyRisks: [],
  exif: { make: "Apple", model: "iPhone 15 Pro" },
  meta: { requestId: "sw-test", mode: "multimodal" },
};

/** Baut die Seite mit gestellten Endpunkten. `merkmal` schaltet das Flag. */
async function seiteVorbereiten(page, { merkmal = true, jobHaengt = false } = {}) {
  const zaehler = { enqueue: 0 };

  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 10, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 10, week: 50, month: 200, total: 1000 },
        useQueue: true,
        sprachumschalter: merkmal,
      }),
    })
  );
  await page.route("**/api/enqueue", (route) => {
    zaehler.enqueue += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: `sw-job-${zaehler.enqueue}`, resultToken: "sw-token" }),
    });
  });
  await page.route("**/api/job-status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: jobHaengt
        ? JSON.stringify({ status: "queued", position: 4, etaSeconds: 35 })
        : JSON.stringify({ status: "done", result: PROFIL }),
    })
  );
  await page.route("**/nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  return zaehler;
}

/** Lässt die Seite zwei Bildschirmrahmen weiterlaufen — danach hat der
    Antwort-Empfänger von /api/stats sicher gearbeitet. */
async function settle(page) {
  await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
}

/** Wartet, bis der Umschalter da ist (er entsteht erst nach /api/stats). */
async function warteAufSchalter(page) {
  await expect(page.locator(".sprach-pille")).toBeVisible();
}

async function profilErzeugen(page) {
  await page.click('[data-demo="selfie"]');
  await expect(page.locator(".cat-card").first()).toBeVisible({ timeout: 15000 });
}

/** Wartet, bis keine Animation und kein Farbuebergang mehr laeuft.
    Ohne das misst axe mitten im Themenwechsel und meldet Kontrastfunde an
    Stellen, die im Endzustand einwandfrei sind (so geschehen: 17 Schein-Funde
    an Elementen, die dem Umschalter gar nicht gehoeren). Mit Zeitdeckel,
    damit eine endlose Animation den Lauf nicht anhaelt. */
async function ruhe(page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
      new Promise((fertig) => setTimeout(fertig, 1000)),
    ])
  );
  /* WebKit meldet laufende CSS-Übergänge über getAnimations() NICHT — dort
     misst axe sonst mitten im Themenwechsel und findet Schein-Kontraste an
     Elementen, die mit der Änderung nichts zu tun haben. Der Themenwechsel
     dauert 200 ms; 400 ms sind der sichere Abstand. */
  await page.waitForTimeout(400);
}

async function beastAn(page) {
  /* Der Schalter liegt unter einer Deko-Flaeche (.toggle-track) — wie in den
     uebrigen E2E-Tests wird er deshalb direkt geklickt. */
  await page.evaluate(() => document.getElementById("biasSwitch").click());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await ruhe(page);
}

/** WCAG-Kontrast zwischen Schrift- und Hintergrundfarbe eines Elements. */
function kontrastImBrowser(waehler) {
  const el = document.querySelector(waehler);
  const leuchte = (farbe) => {
    const [r, g, b] = farbe
      .match(/\d+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const stil = getComputedStyle(el);
  let hintergrund = stil.backgroundColor;
  if (hintergrund === "rgba(0, 0, 0, 0)") {
    const schieber = el.parentElement.querySelector(".sprach-schieber");
    hintergrund = getComputedStyle(schieber || el.parentElement).backgroundColor;
  }
  const [hell, dunkel] = [leuchte(stil.color), leuchte(hintergrund)].sort((a, b) => b - a);
  return (hell + 0.05) / (dunkel + 0.05);
}

async function axePruefen(page, kontext) {
  /* ZWEIMAL messen und nur uebernehmen, was BEIDE Male auftritt.
     Anlass 2026-08-18: Dieser Test wurde im Pruefstand rot mit 18 Kontrast-
     Funden im Zustand "Profil fertig, Beast" — im Wiederholungslauf gruen.
     Ursache ist die Zeitdeckelung in ruhe(): Nach einer Sekunde misst sie
     weiter, auch wenn der Themenwechsel plus Ergebnis-Einblendung auf einer
     ausgelasteten Maschine laenger braucht. axe erwischt dann halbtransparente
     Elemente im Uebergang.
     Ein wackeliger Riegel ist schlimmer als keiner: Er wird irgendwann
     uebergangen, und dann faengt er auch die echten Faelle nicht mehr.
     Ein Uebergangs-Artefakt tritt in zwei getrennten Messungen nicht zweimal
     an derselben Stelle auf, ein echter Verstoss immer. */
  await ruhe(page);
  const lauf1 = (await new AxeBuilder({ page }).analyze()).violations;
  await ruhe(page);
  const lauf2 = (await new AxeBuilder({ page }).analyze()).violations;

  const schluessel = (v) =>
    v.id +
    "|" +
    v.nodes
      .map((n) => n.target.join(" "))
      .sort()
      .join(";");
  const imZweiten = new Set(lauf2.map(schluessel));
  const funde = lauf1.filter((v) => imZweiten.has(schluessel(v)));

  const wackelig = lauf1.filter((v) => !imZweiten.has(schluessel(v)));
  if (wackelig.length) {
    console.log(`[a11y] ${kontext}: ${wackelig.length} Fund(e) nur im ersten Lauf — als Uebergangs-Artefakt verworfen`);
  }
  /* TEST-2026-08-20-25: Das Verwerfen hinterliess nur diese Zeile im Protokoll,
     die kein Gate liest und niemand ansieht. Ein realer, an einen kurzlebigen
     Zustand gebundener Verstoss (aufblitzende Ansage, Lockruf-Scheitel,
     Ladezustand) waere damit fuer immer unsichtbar geblieben — verworfen heisst
     hier "nicht reproduzierbar", nicht "existiert nicht".
     Ein ERNSTER Fund, der nur in einem der beiden Laeufe auftritt, macht deshalb
     jetzt rot. Er ist entweder echt und selten — dann gehoert er behoben — oder
     die Messung ist wacklig, dann gehoert das gesehen. Leichtere Funde
     (minor/moderate) bleiben eine Protokollzeile, wie bisher. */
  const wackeligErnst = wackelig.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    wackeligErnst.map((v) => ({ regel: v.id, wirkung: v.impact, elemente: v.nodes.map((n) => n.target.join(" ")) })),
    `Ernster A11y-Verstoss nur im ERSTEN von zwei Laeufen (${kontext}) — entweder ein seltener echter Fehler oder eine wacklige Messung; beides gehoert angesehen, nicht verworfen`
  ).toEqual([]);

  if (funde.length) {
    console.log(
      `[a11y] ${kontext}: ${funde.length} Fund(e):`,
      funde.map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}`).join(", ")
    );
  }
  const ernst = funde.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    ernst.map((v) => ({ regel: v.id, elemente: v.nodes.map((n) => n.target.join(" ")) })),
    `Ernste A11y-Verstöße: ${kontext}`
  ).toEqual([]);
}

/* ══ Merkmals-Schloss ═══════════════════════════════════════════════════ */

test("Flag aus: der Umschalter existiert nicht im Dokument", async ({ page }) => {
  await seiteVorbereiten(page, { merkmal: false });
  /* Den Wächter VOR dem Laden aufstellen: Wartet man erst danach, ist die
     Antwort oft längst da und das Warten läuft in den Zeitausfall. */
  const antwort = page.waitForResponse("**/api/stats");
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await antwort;
  await settle(page);

  /* „Zählt null" ist für sich genommen schwach — es wäre auch dann erfüllt,
     wenn der Umschalter erst später erschiene. Die Gegenprobe direkt darunter
     zeigt, dass er unter denselben Bedingungen sehr wohl entsteht. */
  await expect(page.locator(".sprach-pille")).toHaveCount(0);
  await expect(page.locator(".sw-grund")).toHaveCount(0);
});

test("Positivkontrolle: mit Flag entsteht er sehr wohl", async ({ page }) => {
  /* Ohne diese Gegenprobe wäre der Test oben auch dann grün, wenn der
     Umschalter überhaupt nicht mehr gebaut werden kann. */
  await seiteVorbereiten(page, { merkmal: true });
  await page.goto("/");
  await warteAufSchalter(page);
  await expect(page.locator(".sw-grund")).toHaveCount(2);
});

test("die Adress-Tür ist entfernt — das Anhängsel wirkt nicht mehr (v3.3.1)", async ({ page }) => {
  /* Bis v3.3.0 blendete `?sprachumschalter=1` den Schalter auch ohne Flag ein
     und hinterliess dafuer eine Spur im localStorage. Der Umschalter ist seit
     v3.3.0 live, die Tuer also ueberfluessig — und ihre Spur widersprach der
     Datenschutzerklaerung. */
  await seiteVorbereiten(page, { merkmal: false });
  const antwort = page.waitForResponse("**/api/stats");
  await page.goto("/?sprachumschalter=1");
  await antwort;
  await settle(page);
  await expect(page.locator(".sprach-pille")).toHaveCount(0);
});

test("die Daumen-Größe stimmt auch am Handy", async ({ page }) => {
  /* Positivkontrolle zum Test darueber: ueber das Merkmals-Schloss entsteht er
     sehr wohl — und ist dort gross genug fuer einen Daumen. */
  await seiteVorbereiten(page, { merkmal: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await warteAufSchalter(page);

  const f = await trefferflaeche(page, '.sprach-knopf[data-lang="en"]');
  expect(f.breite).toBeGreaterThanOrEqual(44);
  expect(f.hoehe).toBeGreaterThanOrEqual(44);
});

test("ein Tippfehler in der Adresse blendet nichts ein", async ({ page }) => {
  await seiteVorbereiten(page, { merkmal: false });
  const antwort = page.waitForResponse("**/api/stats");
  await page.goto("/?sprachumschalter=0");
  await antwort;
  await settle(page);
  await expect(page.locator(".sprach-pille")).toHaveCount(0);
});

test("die Konsolen-Tür ist entfernt, und der Browser bleibt leer (v3.3.1)", async ({ page }) => {
  await seiteVorbereiten(page, { merkmal: true });
  await page.goto("/");
  await warteAufSchalter(page);

  /* Die Tuer gibt es nicht mehr. */
  const tuer = await page.evaluate(() => typeof (window.malziME && window.malziME.sprachumschalter));
  expect(tuer).toBe("undefined");

  /* Und der eigentliche Punkt: Der Umschalter legt nichts Dauerhaftes ab.
     Bis v3.3.0 stand hier `malzime-umschalter-aktiv` — bei JEDEM Besucher,
     waehrend die Datenschutzerklaerung zusagt, keinen localStorage zu nutzen. */
  const speicher = await page.evaluate(() => Object.keys(localStorage));
  expect(speicher).toEqual([]);
});

/* ══ Die drei Zustände ══════════════════════════════════════════════════ */

test("leer: Wechsel ohne Rückfrage, Seite wird englisch", async ({ page }) => {
  await seiteVorbereiten(page);
  await page.goto("/");
  await warteAufSchalter(page);

  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  /* WARTEND lesen (`expect.poll`), nicht einmalig.
     ZWEITER FEHLER, 2026-08-19: Die erste Diagnose-Fassung nutzte
     `expect(await ...evaluateAll(...))`. Das liest GENAU EINMAL — anders als
     `toHaveCount`, das von sich aus wiederholt. Ich hatte die Wiederholung
     entfernt und den Test dadurch WACKLIGER gemacht als vorher. `expect.poll`
     bringt sie zurueck und behaelt die Diagnose.

     Zusicherung unveraendert streng — aber mit Diagnose.
     ANLASS 2026-08-19: Dieser Test fiel in der Pipeline (WebKit, unter Last)
     mit "Received: 1" um und war beim zweiten Lauf DESSELBEN Commits gruen;
     lokal 6 von 6 gruen. `.sw-grund.sichtbar` zaehlt ueber ALLE Dialoge — es
     gibt zwei (`fertig` und `laeuft`). Aus "Received: 1" ist nicht zu erkennen,
     WELCHER haengengeblieben ist, und ohne das laesst sich die Ursache nicht
     suchen. Jetzt nennt die Meldung ihn. */
  await expect
    .poll(() => page.locator(".sw-grund.sichtbar").evaluateAll((els) => els.map((el) => el.dataset.modal || "?")), {
      message: "Dialoge, die noch sichtbar sind",
    })
    .toEqual([]);
  await expect(page.locator("h1")).toContainText("We see more");
  /* Das englische Demo-Bildpaket muss mitziehen. */
  await expect(page.locator('[data-demo="selfie"] img')).toHaveAttribute("src", /-en\.jpg/);
});

test("Profil fertig: Rückfrage in der AKTUELLEN Sprache, Abbrechen ändert nichts", async ({ page }) => {
  await seiteVorbereiten(page);
  await page.goto("/");
  await warteAufSchalter(page);
  await profilErzeugen(page);

  await page.click('.sprach-knopf[data-lang="en"]');
  const modal = page.locator('.sw-grund[data-modal="fertig"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator(".sw-knopf--bleiben")).toHaveText("Abbrechen");

  await modal.locator(".sw-schliessen").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator('.sprach-knopf[data-lang="de"]')).toHaveClass(/aktiv/);

  /* Der am Prototyp gemeldete Fehler: Der zweite Versuch kam auf Englisch,
     obwohl nie gewechselt worden war. */
  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(modal.locator(".sw-knopf--bleiben")).toHaveText("Abbrechen");
});

test("Analyse läuft: bestätigen startet dieselbe Datei neu", async ({ page }) => {
  const zaehler = await seiteVorbereiten(page, { jobHaengt: true });
  await page.goto("/");
  await warteAufSchalter(page);

  await page.click('[data-demo="selfie"]');
  await expect.poll(() => zaehler.enqueue).toBe(1);

  await page.click('.sprach-knopf[data-lang="en"]');
  const modal = page.locator('.sw-grund[data-modal="laeuft"]');
  await expect(modal).toBeVisible();
  await modal.locator(".sw-knopf--wechseln").click();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  /* Zweiter Auftrag — ohne dass jemand das Bild noch einmal auswählen musste. */
  await expect.poll(() => zaehler.enqueue, { timeout: 15000 }).toBe(2);
});

test("die Wahl überlebt das Neuladen im selben Tab", async ({ page }) => {
  await seiteVorbereiten(page);
  await page.goto("/");
  await warteAufSchalter(page);
  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

/* ══ Barrierefreiheit ═══════════════════════════════════════════════════ */

test("Fokus bleibt in der Rückfrage und kehrt danach zurück", async ({ page }) => {
  await seiteVorbereiten(page);
  await page.goto("/");
  await warteAufSchalter(page);
  await profilErzeugen(page);

  const ausloeser = page.locator('.sprach-knopf[data-lang="en"]');
  await ausloeser.focus();
  await ausloeser.click();
  await expect(page.locator('.sw-grund[data-modal="fertig"]')).toBeVisible();

  /* Zehnmal weitertabben — der Fokus darf die Rückfrage nie verlassen. */
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const drin = await page.evaluate(() => !!document.activeElement.closest(".sw-modal"));
    expect(drin, `Fokus nach ${i + 1} Tab-Schritten ausserhalb der Rückfrage`).toBe(true);
  }

  await page.keyboard.press("Escape");
  /* Zusicherung unveraendert streng — aber mit Diagnose.
     ANLASS 2026-08-19: Dieser Test fiel in der Pipeline (WebKit, unter Last)
     mit "Received: 1" um und war beim zweiten Lauf DESSELBEN Commits gruen;
     lokal 6 von 6 gruen. `.sw-grund.sichtbar` zaehlt ueber ALLE Dialoge — es
     gibt zwei (`fertig` und `laeuft`). Aus "Received: 1" ist nicht zu erkennen,
     WELCHER haengengeblieben ist, und ohne das laesst sich die Ursache nicht
     suchen. Jetzt nennt die Meldung ihn. */
  await expect
    .poll(() => page.locator(".sw-grund.sichtbar").evaluateAll((els) => els.map((el) => el.dataset.modal || "?")), {
      message: "Dialoge, die noch sichtbar sind",
    })
    .toEqual([]);
  /* Wartend statt einmalig lesen — und zwar aus einem konkreten Grund:
     `modalSchliessen()` nimmt die Klasse `sichtbar` WEG, BEVOR es den Fokus
     zurueckholt (sprachumschalter.js). Die Zeile darueber ist also schon
     erfuellt, waehrend der Fokus noch unterwegs sein kann. Ein einmaliges
     `document.activeElement` traf diese Luecke unter CI-Last auf WebKit —
     lokal nie, in der Pipeline einmal. Die Zusicherung bleibt exakt dieselbe
     (der EN-Knopf hat den Fokus), sie darf nur darauf warten. */
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const a = document.activeElement;
          return a ? `${a.tagName.toLowerCase()} data-lang="${a.dataset.lang || ""}"` : "gar nichts";
        }),
      {
        /* Standard sind 5 s. Das reichte lokal immer und in der Pipeline fast
           immer — am 2026-08-19 zum zweiten Mal nicht, unter WebKit und CI-Last
           (lokal danach 3 von 3 gruen). Die Zusicherung bleibt wortgleich, sie
           bekommt nur mehr Zeit; ein Fokus, der nach 15 s nicht dort ist, waere
           ein echter Fehler und kein Flackern. */
        timeout: 15000,
        message: "Fokus kehrt nach Escape auf den EN-Knopf zurueck",
      }
    )
    .toBe('button data-lang="en"');
});

/** Misst, was ein Daumen WIRKLICH trifft — nicht, was man sieht.
    Getastet wird mit elementFromPoint vom Mittelpunkt nach aussen; damit zaehlt
    die unsichtbare Erweiterung ueber ::after mit, die genau dafuer da ist. */
async function trefferflaeche(page, waehler) {
  return page.evaluate((w) => {
    const el = document.querySelector(w);
    const r = el.getBoundingClientRect();
    const mx = r.left + r.width / 2;
    const my = r.top + r.height / 2;
    const trifft = (x, y) => {
      const t = document.elementFromPoint(x, y);
      return !!t && (t === el || el.contains(t));
    };
    let oben = 0;
    while (oben < 60 && trifft(mx, my - oben - 1)) oben++;
    let unten = 0;
    while (unten < 60 && trifft(mx, my + unten + 1)) unten++;
    let links = 0;
    while (links < 80 && trifft(mx - links - 1, my)) links++;
    let rechts = 0;
    while (rechts < 80 && trifft(mx + rechts + 1, my)) rechts++;
    /* +1 fuer den Mittelpunkt selbst: Gezaehlt werden die Punkte NEBEN ihm,
       die Flaeche umfasst ihn aber mit. Ohne das misst man 43 statt 44 und
       verwirft eine korrekte Umsetzung. */
    return { breite: links + rechts + 1, hoehe: oben + unten + 1 };
  }, waehler);
}

test("Ziel-Größen erreichen 44 px — tastbar, ohne dass der Schalter aufgeblasen wird", async ({ page }) => {
  await seiteVorbereiten(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await warteAufSchalter(page);
  await profilErzeugen(page);

  /* Nach dem Erzeugen des Profils steht die Seite gescrollt; der Umschalter
     liegt dann ausserhalb des Sichtfelds und elementFromPoint greift ins
     Leere. Im Einzellauf fiel das nie auf, unter Last (sieben E2E-Dateien
     gleichzeitig) schon — ein Messfehler, kein Mangel am Schalter. */
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".sprach-pille")).toBeInViewport();

  for (const waehler of ['.sprach-knopf[data-lang="de"]', '.sprach-knopf[data-lang="en"]']) {
    const f = await trefferflaeche(page, waehler);
    expect(f.breite, `tastbare Breite ${waehler}`).toBeGreaterThanOrEqual(44);
    expect(f.hoehe, `tastbare Höhe ${waehler}`).toBeGreaterThanOrEqual(44);
  }

  /* Und die SICHTBARE Pille bleibt schlank wie der abgenommene Entwurf.
     Der erste Anlauf blies sie auf 108×52 auf — vom Nutzer sofort bemerkt. */
  const pille = await page.locator(".sprach-pille").boundingBox();
  expect(Math.round(pille.height), "sichtbare Höhe der Pille").toBeLessThanOrEqual(40);

  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator('.sw-grund[data-modal="fertig"].sichtbar')).toBeVisible();
  const x = await trefferflaeche(page, '.sw-grund[data-modal="fertig"] .sw-schliessen');
  expect(x.breite, "tastbare Breite des X").toBeGreaterThanOrEqual(44);
  expect(x.hoehe, "tastbare Höhe des X").toBeGreaterThanOrEqual(44);
});

test("Kontrast der gefüllten Flächen reicht in hell UND dunkel", async ({ page }) => {
  await seiteVorbereiten(page);
  await page.goto("/");
  await warteAufSchalter(page);
  await profilErzeugen(page);

  const hell = await page.evaluate(kontrastImBrowser, ".sprach-knopf.aktiv");
  expect(hell, `Kontrast heller Modus: ${hell.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);

  await beastAn(page);
  const dunkel = await page.evaluate(kontrastImBrowser, ".sprach-knopf.aktiv");
  expect(dunkel, `Kontrast Beast-Modus: ${dunkel.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);

  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator('.sw-grund[data-modal="fertig"]')).toBeVisible();
  const knopf = await page.evaluate(kontrastImBrowser, '.sw-grund[data-modal="fertig"] .sw-knopf--bleiben');
  expect(knopf, `Kontrast Hauptknopf im Beast-Modus: ${knopf.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
});

test("axe über die ganze Matrix: 2 Sprachen × 2 Themen, Rückfrage offen und zu", async ({ page }) => {
  // Der mit Abstand teuerste Test der Suite: axe läuft sechs Mal, in WebKit.
  // Allein braucht er rund 13 Sekunden; laufen daneben weitere Browser, wird er
  // langsamer, ohne dass etwas kaputt wäre. Am 21.08. hat er deshalb bei vier
  // gleichzeitigen Arbeitern die 30-Sekunden-Grenze gerissen und die Kette rot
  // gemacht — ein Messfehler, kein Befund. `test.slow()` verdreifacht seine
  // Zeitgrenze; geprüft wird unverändert dasselbe.
  test.slow();
  await seiteVorbereiten(page);
  await page.goto("/");
  await warteAufSchalter(page);
  await axePruefen(page, "Startseite DE, Schalter sichtbar");

  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await axePruefen(page, "Startseite EN");

  await page.click('.sprach-knopf[data-lang="de"]');
  await profilErzeugen(page);
  await axePruefen(page, "Profil fertig, DE");

  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator('.sw-grund[data-modal="fertig"]')).toBeVisible();
  await axePruefen(page, "Rückfrage offen, hell");
  await page.keyboard.press("Escape");
  /* Zusicherung unveraendert streng — aber mit Diagnose.
     ANLASS 2026-08-19: Dieser Test fiel in der Pipeline (WebKit, unter Last)
     mit "Received: 1" um und war beim zweiten Lauf DESSELBEN Commits gruen;
     lokal 6 von 6 gruen. `.sw-grund.sichtbar` zaehlt ueber ALLE Dialoge — es
     gibt zwei (`fertig` und `laeuft`). Aus "Received: 1" ist nicht zu erkennen,
     WELCHER haengengeblieben ist, und ohne das laesst sich die Ursache nicht
     suchen. Jetzt nennt die Meldung ihn. */
  await expect
    .poll(() => page.locator(".sw-grund.sichtbar").evaluateAll((els) => els.map((el) => el.dataset.modal || "?")), {
      message: "Dialoge, die noch sichtbar sind",
    })
    .toEqual([]);

  await beastAn(page);
  await axePruefen(page, "Profil fertig, Beast");

  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator('.sw-grund[data-modal="fertig"]')).toBeVisible();
  await axePruefen(page, "Rückfrage offen, Beast");
});

test("BUG-2026-08-20-19: Wiederoeffnen binnen der Ausblendzeit laesst den Dialog bedienbar", async ({ page }) => {
  /* Schliessen startet einen 200-ms-Zeitgeber, der den Dialog danach `hidden`
     setzt. Wurde binnen dieser Zeit erneut geoeffnet, versteckte der ALTE
     Zeitgeber den frisch geoeffneten Dialog: unsichtbar, aber offen — die Seite
     blieb stillgelegt und reagierte auf keine Taste mehr. Der Fix von v3.9.1
     deckte nur das gleichzeitige Oeffnen und Schliessen ab, nicht diesen Fall. */
  await seiteVorbereiten(page);
  await page.goto("/");
  await warteAufSchalter(page);
  await profilErzeugen(page);

  await page.click('.sprach-knopf[data-lang="en"]');
  const modal = page.locator('.sw-grund[data-modal="fertig"]');
  await expect(modal).toBeVisible();

  /* Schliessen und SOFORT wieder oeffnen — beides im SELBEN Durchlauf, sonst
     liegen zwischen zwei Playwright-Klicks laenger als die 200 ms und der
     Zeitgeber ist bereits abgelaufen. (Der erste Anlauf dieses Tests hatte genau
     diesen Fehler: Er blieb auch ohne den Fix gruen — die Rueckbauprobe hat es
     gezeigt, nicht die Vermutung.) */
  await page.evaluate(() => {
    document.querySelector('.sw-grund[data-modal="fertig"] .sw-schliessen').click();
    document.querySelector('.sprach-knopf[data-lang="en"]').click();
  });

  /* Nach Ablauf des alten Zeitgebers muss der Dialog immer noch dastehen. */
  await page.waitForTimeout(400);
  await expect(modal, "der alte Zeitgeber hat den frisch geoeffneten Dialog versteckt").toBeVisible();

  /* Und er laesst sich normal schliessen — die Seite ist danach bedienbar. */
  await modal.locator(".sw-knopf--bleiben").click();
  await page.waitForTimeout(400);
  await expect(modal).toBeHidden();
});

test.describe("Startsprache folgt dem Gerät", () => {
  test.use({ locale: "en-US" });

  test("englisches Gerät: Seite und Schalter starten englisch", async ({ page }) => {
    await seiteVorbereiten(page);
    await page.goto("/");
    await warteAufSchalter(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('.sprach-knopf[data-lang="en"]')).toHaveClass(/aktiv/);
    /* Und die Rückfrage erscheint dann folgerichtig auf Englisch. */
    await profilErzeugen(page);
    await page.click('.sprach-knopf[data-lang="de"]');
    await expect(page.locator('.sw-grund[data-modal="fertig"] .sw-knopf--bleiben')).toHaveText("Cancel");
  });
});

test("die Sprache reist in einen neuen Tab mit (v3.3.1)", async ({ page }) => {
  /* Die Wahl liegt im sessionStorage — bewusst pro Tab. Ein mit
     target="_blank" geoeffneter Tab bekommt einen LEEREN sessionStorage, und
     alle sechs Links der Startseite oeffnen einen neuen Tab. Ohne Anhaengsel
     landete man von der englischen Startseite ueberall wieder auf Deutsch. */
  await seiteVorbereiten(page, { merkmal: true });
  await page.goto("/");
  await warteAufSchalter(page);

  /* Vorher: deutsch, also traegt der Link auch deutsch. */
  await expect(page.locator('a[href^="/stats"]').first()).toHaveAttribute("href", /lang=de/);

  await page.click('.sprach-knopf[data-lang="en"]');
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  /* Nachher: englisch — und zwar an ALLEN Links in einen neuen Tab. */
  const ziele = await page.$$eval('a[target="_blank"][href^="/"]', (as) => as.map((a) => a.getAttribute("href")));
  expect(ziele.length).toBeGreaterThan(0);
  for (const z of ziele) expect(z).toContain("lang=en");

  /* Und die Probe aufs Exempel: Der neue Tab startet wirklich englisch. */
  const stats = ziele.find((z) => z.startsWith("/stats"));
  await page.goto(stats.replace("/stats", "/stats.html"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
