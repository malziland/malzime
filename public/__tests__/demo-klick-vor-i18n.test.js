/**
 * demo-klick-vor-i18n.test.js — ein frueher Klick auf ein Demo-Foto verpufft
 * nicht mehr.
 *
 * BELEG (Pipeline-Lauf 34149354681, 07.09.2026): Der Barrierefreiheits-Test
 * klickte das Demo-Foto 0,68 s BEVOR `locales/en.json` geladen war. Die
 * Klick-Handler kamen erst danach (`initDemo()` stand hinter
 * `await initI18n()`), der Klick tat nichts, und 15 Sekunden lang blieb die
 * Seite leer. Auf einer langsamen Maschine ist das die Pipeline — im
 * Schul-WLAN ist es ein Kind, das auf ein Foto tippt und nichts sieht.
 *
 * Seitdem werden die Knoepfe SOFORT verdrahtet; ein Klick, der vor dem Ende
 * der Uebersetzung kommt, wartet auf sie und laeuft dann durch.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));
vi.mock("../js/api.js", () => ({ analyzeImage: vi.fn() }));
vi.mock("../js/klang.js", () => ({ klangAktivieren: vi.fn() }));
vi.mock("../js/ui.js", () => ({ setStatus: vi.fn(), stopScanAnim: vi.fn() }));
vi.mock("../js/error-logger.js", () => ({ logClientError: vi.fn() }));

function demoKnopf() {
  const knopf = document.createElement("button");
  knopf.className = "demo-thumb";
  knopf.dataset.demo = "selfie";
  document.body.appendChild(knopf);
  return knopf;
}

describe("Demo-Klick vor dem Ende der Uebersetzung (07.09.2026)", () => {
  let fetchSpion;

  beforeEach(() => {
    vi.resetModules();
    /* resetModules laedt die Module neu, die Attrappen oben bleiben aber
       dieselben — ohne Zuruecksetzen zaehlte klangAktivieren die Klicks der
       vorigen Tests mit, und der erste Test war nur in dieser Reihenfolge gruen. */
    vi.clearAllMocks();
    setupDOM();
    fetchSpion = vi.fn(async () => ({ blob: async () => new Blob([new Uint8Array([0xff, 0xd8])]) }));
    globalThis.fetch = fetchSpion;
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  test("der Klick wartet auf die Uebersetzung und laeuft dann durch", async () => {
    let freigeben;
    const bereit = new Promise((r) => (freigeben = r));
    const { initDemo } = await import("../js/demo.js");
    const { klangAktivieren } = await import("../js/klang.js");
    const knopf = demoKnopf();
    initDemo(bereit);

    knopf.click();
    await new Promise((r) => setTimeout(r, 0));
    /* Der Klang haengt an der Nutzer-Geste und darf NICHT warten. */
    expect(klangAktivieren).toHaveBeenCalledTimes(1);
    /* Das Bild darf noch nicht geladen sein — die Uebersetzung laeuft noch. */
    expect(fetchSpion).not.toHaveBeenCalled();

    freigeben();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpion).toHaveBeenCalledTimes(1);
    /* t() liefert im Test den Schluessel zurueck; demoBildPfad faellt dann auf
       die deutsche Fassung zurueck — genau das Bild, das der Klick meinte. */
    expect(String(fetchSpion.mock.calls[0][0])).toContain("demo-selfie.jpg");
  });

  test("ohne uebergebenes Bereit-Signal verhaelt sich der Klick wie bisher: sofort", async () => {
    const { initDemo } = await import("../js/demo.js");
    const knopf = demoKnopf();
    initDemo();
    knopf.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpion).toHaveBeenCalledTimes(1);
  });

  test("Positivkontrolle: ein Klick NACH der Uebersetzung laeuft sofort", async () => {
    const { initDemo } = await import("../js/demo.js");
    const knopf = demoKnopf();
    initDemo(Promise.resolve());
    knopf.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpion).toHaveBeenCalledTimes(1);
  });
});
