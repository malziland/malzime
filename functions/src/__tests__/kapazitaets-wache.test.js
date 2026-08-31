/**
 * kapazitaets-wache.test.js — Merkt die Wache, wenn Code und Warteschlange
 * auseinanderlaufen?
 *
 * HINTERGRUND: Die Zahl "wie viele Analysen gleichzeitig" steht an ZWEI
 * Stellen — im Code und in der Cloud-Tasks-Warteschlange bei Google. Dass es
 * drei Umstell-Skripte gibt (concurrency-3/7/10), zeigt: Die Kopplung ist
 * Handarbeit, und wer eine Seite vergisst, merkt es an nichts.
 *
 * Geprueft wird vor allem, dass die Wache SCHWEIGT, wo sie schweigen muss —
 * eine Wache, die bei jedem Netzwerkfehler meldet, wird nach zwei Wochen
 * ignoriert.
 */

const { _bewerte, _baueMeldung } = require("../kapazitaets-wache");

describe("Abgleich Code gegen echte Warteschlange", () => {
  test("gleiche Werte sind unauffaellig", () => {
    const b = _bewerte(7, 7);
    expect(b.auffaellig).toBe(false);
    expect(b.grund).toBe("stimmt-ueberein");
  });

  test("Code verspricht mehr, als die Warteschlange zulaesst", () => {
    /* Der gefaehrliche Fall: Wartezeit-Ansage und Einlassgrenze rechnen mit 7,
       Google laesst 3 durch. Wer hinten einreiht, wartet umsonst. */
    const b = _bewerte(7, 3);
    expect(b.auffaellig).toBe(true);
    expect(b.grund).toBe("code-verspricht-zu-viel");
    expect(_baueMeldung(b)).toContain("zu optimistisch");
    /* Die Meldung muss den Weg zur Abhilfe nennen, sonst steht der Leser da. */
    expect(_baueMeldung(b)).toContain("cloudtasks-concurrency-7.sh");
  });

  /* OPS-2026-08-31: Frueher hiess dieser Fall "kapazitaet-verschenkt" und die
     Meldung empfahl, den Einstellungssatz an die Warteschlange anzupassen. Der
     Vorfall vom 31.08. hat gezeigt, dass das die GEFAEHRLICHE Richtung ist:
     Ein Testlauf hatte die Warteschlange auf vierfaches Tempo gestellt, die
     Wache haette empfohlen, das festzuschreiben. Es gehen dann mehr Aufrufe an
     die KI, als ihre Stufe zulaesst — echte Nutzer sehen Ueberlastmeldungen. */
  test("Warteschlange laeuft schneller als der Einstellungssatz", () => {
    const b = _bewerte(3, 10);
    expect(b.auffaellig).toBe(true);
    expect(b.grund).toBe("queue-laeuft-zu-schnell");
    expect(_baueMeldung(b)).toContain("SCHNELLER als eingestellt");
    /* Die Abhilfe muss die Warteschlange nachziehen, NICHT den Satz anheben. */
    expect(_baueMeldung(b)).toContain("warteschlange-pruefen.sh --setzen");
    expect(_baueMeldung(b)).toContain("NICHT den Satz anheben");
  });

  test("nicht messbar ist KEIN Befund", () => {
    /* Netzwerkfehler, fehlende Berechtigung, lokaler Modus: Die Wache darf
       daraus keine Fehlkonfiguration machen. Sonst meldet sie Stoerungen als
       Befund und verliert ihre Glaubwuerdigkeit. */
    expect(_bewerte(7, null).auffaellig).toBe(false);
    expect(_bewerte(7, null).grund).toBe("nicht-messbar");
    expect(_bewerte(7, undefined).auffaellig).toBe(false);
  });

  test("die Meldung nennt beide Zahlen im Klartext", () => {
    /* Eine Meldung ohne Zahlen zwingt zum Nachsehen an zwei Stellen — genau
       das, was die Wache ersparen soll. */
    const m = _baueMeldung(_bewerte(7, 3));
    expect(m).toContain("7");
    expect(m).toContain("3");
  });
});

describe("Lesen der echten Warteschlange", () => {
  test("ein Lesefehler wird zu 'nicht messbar', nicht zu einem Befund", async () => {
    jest.resetModules();
    const wache = require("../kapazitaets-wache");
    wache.setClientForTest({
      queuePath: () => "projects/x/locations/y/queues/z",
      getQueue: async () => {
        throw new Error("PERMISSION_DENIED");
      },
    });
    process.env.GCLOUD_PROJECT = "malzime-test";
    expect(await wache.echteParallelitaet()).toBeNull();
  });

  test("der gelesene Wert kommt aus rateLimits.maxConcurrentDispatches", async () => {
    jest.resetModules();
    const wache = require("../kapazitaets-wache");
    wache.setClientForTest({
      queuePath: () => "projects/x/locations/y/queues/z",
      getQueue: async () => [{ rateLimits: { maxConcurrentDispatches: 10 } }],
    });
    process.env.GCLOUD_PROJECT = "malzime-test";
    expect(await wache.echteParallelitaet()).toBe(10);
  });

  test("eine Antwort ohne die Zahl gilt als nicht messbar", async () => {
    jest.resetModules();
    const wache = require("../kapazitaets-wache");
    wache.setClientForTest({
      queuePath: () => "projects/x/locations/y/queues/z",
      getQueue: async () => [{ rateLimits: {} }],
    });
    process.env.GCLOUD_PROJECT = "malzime-test";
    expect(await wache.echteParallelitaet()).toBeNull();
  });
});
