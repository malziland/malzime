import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

/* TEST-001 (Audit 2026-08-10) — Regressionsschutz für das Escaping.

   Der gesamte angezeigte Text stammt aus einem Sprachmodell und ist damit
   nicht vertrauenswürdig. Ein Kind kann ein Foto eines handgeschriebenen
   `<img src=x onerror=…>` hochladen; das Modell übernimmt sichtbaren Text in
   die Profiltexte.

   Das Escaping war zum Zeitpunkt des Audits an allen 16 Einfügestellen korrekt
   — aber KEIN Test hätte seinen Wegfall bemerkt: Eine Mutationsprobe, die
   jedes `escapeHtml` aus render.js entfernte, ließ alle 176 Tests grün. Der
   vorhandene escapeHtml-Test prüft die Hilfsfunktion isoliert, nicht ihre
   Anwendung.

   Dieser Test prüft die Anwendung — am DOM, nicht am String. */

/* Je Nutzlast ein Textstueck, das hinterher sichtbar sein MUSS — sonst waere
   der Test auch dann gruen, wenn render.js gar nichts mehr ausgibt. */
const NUTZLASTEN = [
  ['<img src=x onerror="alert(1)">', "alert(1)"],
  ['"><script>alert(1)</script>', "alert(1)"],
  ["<iframe src=javascript:alert(1)>", "alert(1)"],
  ['<a href="javascript:alert(1)">klick</a>', "klick"],
  ['<meta http-equiv="refresh" content="0;url=https://boese.example">', "boese.example"],
];

function ergebnisMit(text) {
  return {
    profiles: {
      normal: {
        categories: { alter_geschlecht: { label: text, value: text, confidence: 0.8 } },
        ad_targeting: [text],
        manipulation_triggers: [text],
        profileText: text,
      },
    },
    privacyRisks: [],
    exif: { make: text, model: text },
    meta: { mode: "multimodal", subject: "HUMAN" },
  };
}

describe("TEST-001 — Modelltext kann im Browser nichts ausführen", () => {
  let renderCurrentMode;

  beforeEach(async () => {
    /* dom.js merkt sich die Elemente beim Import. Da setupDOM den Body pro Test
       neu aufbaut, muessen die Module danach frisch geladen werden — sonst
       schreibt render.js in abgehaengte Knoten und die Pruefung liefe ins Leere. */
    vi.resetModules();
    setupDOM();
    renderCurrentMode = (await import("../js/render.js")).renderCurrentMode;
  });

  it.each(NUTZLASTEN)("neutralisiert %s in allen Textfeldern", (nutzlast, marker) => {
    renderCurrentMode(ergebnisMit(nutzlast));

    /* Alle Bereiche, in die render.js Modelltext schreibt. */
    const bereiche = ["facts", "targeting", "simulation", "dataValue", "privacy"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    expect(bereiche.length).toBeGreaterThan(0);

    for (const bereich of bereiche) {
      /* Kein eingeschleustes Element darf im Dokument gelandet sein ... */
      for (const tag of ["script", "img", "iframe", "meta"]) {
        expect(bereich.querySelectorAll(tag).length, `${tag} aus der Nutzlast`).toBe(0);
      }
      /* ... und kein Inline-Handler. */
      expect(bereich.querySelectorAll("[onerror], [onload], [onclick]").length).toBe(0);
    }

    /* Gegenprobe: Der Text muss trotzdem sichtbar sein — escaped, nicht
       verschluckt. Sonst wäre der Test auch bei kaputtem Rendering grün. */
    const sichtbar = bereiche.map((b) => b.textContent).join(" ");
    expect(sichtbar).toContain(marker);
  });
});
