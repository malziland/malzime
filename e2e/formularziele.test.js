/**
 * formularziele.test.js — haelt der Browser ein Formular auf, das an eine
 * fremde Adresse senden will? (SEC-2026-10-03-08)
 *
 * Die Sicherheitsrichtlinie in firebase.json nennt Formularziele:
 * `form-action 'self'`. Auf der Seite selbst steht kein Formular; die Regel
 * schuetzt fuer den Fall, dass eines hineingeraet (eingeschleustes Markup).
 * Dass die Regel im Text der Richtlinie steht, prueft ein Modul-Test
 * (public/__tests__/api-basis.test.js). Hier wird gemessen, was der BROWSER
 * daraus macht — mit einem Formular, das der Test selbst einsetzt.
 *
 * Nichts verlaesst den Testlauf: Das fremde Ziel liegt unter der reservierten
 * Endung `.example`, und jede Anfrage an einen fremden Rechner wird abgebrochen
 * und mitgeschrieben. Griffe die Richtlinie nicht, stuende das Ziel in dieser
 * Liste.
 */
import { test, expect } from "@playwright/test";
import { URL } from "node:url";

const FREMDES_ZIEL = "https://formularziel.example/sammeln";

/** Startseite laden; alles Fremde abbrechen und mitschreiben. */
async function startseite(page) {
  const fremd = [];
  const konsole = [];
  page.on("console", (meldung) => konsole.push(meldung.text()));
  await page.route(
    (url) => /^https?:$/.test(url.protocol) && url.hostname !== "localhost",
    (route) => {
      fremd.push(route.request().url());
      return route.abort();
    }
  );
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: { count: 1, limit: 500, limitActive: false, retryAfterSeconds: 0 },
        totals: { today: 1, week: 1, month: 1, total: 1 },
      }),
    })
  );
  const antwort = await page.goto("/");
  /* Voraussetzung der Messung: Der Testserver liefert die Richtlinie der
     Produktion aus, und sie nennt Formularziele. Ohne sie waere "nicht
     blockiert" kein Befund ueber den Browser, sondern ueber den Aufbau. */
  const richtlinie = antwort.headers()["content-security-policy"] || "";
  expect(richtlinie, "die Startseite kommt mit einer Sicherheitsrichtlinie").toContain("default-src");
  return { fremd, konsole, richtlinie };
}

/** Setzt ein Formular in die Seite, schickt es ab und meldet, ob der Browser
 *  einen Verstoss gegen die Richtlinie gemeldet hat (sonst nach 4 s: null). */
function formularAbschicken(page, ziel, methode) {
  return page.evaluate(
    /* eslint-disable no-undef -- laeuft im Browser */
    ({ ziel, methode }) =>
      new Promise((fertig) => {
        document.addEventListener(
          "securitypolicyviolation",
          (e) =>
            fertig({
              violatedDirective: e.violatedDirective,
              effectiveDirective: e.effectiveDirective,
              blockedURI: e.blockedURI,
              disposition: e.disposition,
            }),
          { once: true }
        );
        const formular = document.createElement("form");
        formular.method = methode;
        formular.action = ziel;
        const feld = document.createElement("input");
        feld.name = "probe";
        feld.value = "1";
        formular.appendChild(feld);
        document.body.appendChild(formular);
        formular.submit();
        setTimeout(() => fertig(null), 4000);
      }),
    /* eslint-enable no-undef */
    { ziel, methode }
  );
}

test("die Richtlinie der Startseite laesst Formulare nur an die eigene Adresse senden", async ({ page }) => {
  const { richtlinie } = await startseite(page);
  expect(richtlinie).toMatch(/(^|;)\s*form-action 'self'\s*(;|$)/);
});

test("ein Formular mit fremdem Ziel wird aufgehalten: Verstoss gemeldet, nichts gesendet, die Seite bleibt", async ({
  page,
}) => {
  const { fremd, konsole } = await startseite(page);
  const vorher = page.url();

  const verstoss = await formularAbschicken(page, FREMDES_ZIEL, "POST");

  /* Der Browser meldet den Verstoss — und zwar gegen genau diese Regel. */
  expect(verstoss, "der Browser muss einen Verstoss gegen die Richtlinie melden").not.toBeNull();
  expect(verstoss.violatedDirective).toBe("form-action");
  expect(verstoss.effectiveDirective).toBe("form-action");
  expect(verstoss.disposition).toBe("enforce");
  expect(new URL(verstoss.blockedURI).hostname).toBe("formularziel.example");
  /* Gesendet wurde nichts: Keine Anfrage hat den Browser in Richtung des
     fremden Ziels verlassen (sie stuende sonst im Fangnetz). */
  expect(fremd).toEqual([]);
  /* Und die Seite ist, wo sie war — mit ihrem Inhalt. Im Browser selbst
     nachgesehen: Playwright haelt die aufgehaltene Formular-Navigation fuer
     noch laufend, ein wartender Locator kaeme hier nie zurueck. */
  expect(page.url()).toBe(vorher);
  const seite = await page.evaluate(
    /* eslint-disable-next-line no-undef -- laeuft im Browser */
    () => ({ adresse: location.href, dateiauswahl: Boolean(document.querySelector("#fileInput")) })
  );
  expect(seite).toEqual({ adresse: vorher, dateiauswahl: true });
  /* Zweite, unabhaengige Spur: die Meldung des Browsers in der Konsole. */
  expect(konsole.some((text) => /form-action/.test(text))).toBe(true);
});

test("Gegenprobe: ein Formular mit Ziel auf der eigenen Seite wird nicht aufgehalten", async ({ page }) => {
  /* Ein Riegel, der jedes Formular aufhielte, waere kein Beleg fuer die Regel
     — und er sperrte das Bestaetigungs-Formular der Verwaltungsseite aus, das
     auf die eigene Adresse zielt. */
  const { fremd, konsole } = await startseite(page);
  const [, verstoss] = await Promise.all([
    page.waitForURL(/\/stats\.html\?probe=1$/, { timeout: 15000 }),
    /* Die Seite wird verlassen, waehrend der Aufruf noch wartet — das ist hier
       der Erfolgsfall und kein Fehler. */
    formularAbschicken(page, "/stats.html", "GET").catch(() => "seite verlassen"),
  ]);
  expect(verstoss).toBe("seite verlassen");
  expect(new URL(page.url()).pathname).toBe("/stats.html");
  await expect(page.locator("h1")).toBeVisible();
  expect(konsole.filter((text) => /form-action/.test(text))).toEqual([]);
  expect(fremd).toEqual([]);
});
