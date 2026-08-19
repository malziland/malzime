import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../en");

/* ── Wächter gegen doppelt geführte Begriffe (2026-08-19) ──────────────────
 *
 * Anlass: Der Nutzer fand auf den englischen Seiten Stellen wie
 *
 *     Registry court: Landesgericht Linz (Regional Court of Linz)
 *
 * und sagte dazu den Satz, der diesen Test ausgelöst hat: "Versteife dich
 * nicht auf das Wort und den Suchbegriff, sondern generell auf die Systematik
 * dahinter. Sonst müssen wir jedes einzelne wieder manuell suchen."
 *
 * Genau das war vorher passiert: Ich hatte einzelne Fundstellen von Hand
 * entfernt, bis der Nutzer die nächste fand. Eine Suche nach "Regional Court"
 * findet einen Fall. Sie findet nicht den nächsten, den jemand morgen
 * schreibt.
 *
 * DIE REGEL, mechanisch:
 *
 *   erlaubt    English label: <span lang="de">Deutscher Name</span>
 *   erlaubt    English name (<span lang="de">Deutsches Kürzel</span>)
 *   VERBOTEN   <span lang="de">Deutscher Name</span> (English gloss)
 *
 * Der Unterschied ist nicht Geschmack, sondern Funktion: Steht der deutsche
 * Begriff IN der Klammer, ist er eine Fundstelle — damit kann man zitieren und
 * nachschlagen. Steht die Klammer HINTER dem deutschen Begriff, ist ihr Inhalt
 * eine Übersetzung — und ein übersetzter Eigenname steht in keinem Register.
 * "Regional Court of Linz" kann niemand nachschlagen.
 *
 * Warum das keine Kosmetik ist: Die gesetzliche Pflicht (ECG §5) erfüllt die
 * DEUTSCHE Seite. Die englische ist eine freiwillige Gefälligkeitsfassung. Sie
 * muss also gar nichts doppelt führen — jede Doppelung ist reiner Ballast, und
 * gemessen hat sie die Zeilen von 61 auf bis zu 114 Zeichen getrieben.
 */

function englischeSeiten() {
  return fs
    .readdirSync(EN_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(EN_DIR, f), "utf8") }));
}

/* Zeilenumbrüche zusammenfassen: Der Formatierer bricht Sätze und sogar
   Elemente um. Eine zeilenweise Suche ist hier blind — das ist mir bei genau
   dieser Sache zweimal passiert, bevor der Test entstand. */
const flach = (s) => s.replace(/\s+/g, " ");

/* Ein deutscher Einschub, unmittelbar gefolgt von einer Klammer. */
const DOPPELUNG = /<span lang="de"\s*>\s*([^<]{1,80}?)\s*<\/span\s*>\s*\(([^)]{1,80})\)/g;

/* Klammern, die KEINE Übersetzung sind, sondern eine Angabe: Registernummern,
   Paragraphen, Datumsangaben, Beträge. Sie dürfen hinter einem deutschen
   Begriff stehen.

   Das Unterscheidungsmerkmal ist eine ZIFFER. Der erste Anlauf zählte erlaubte
   Zeichen einzeln auf und fiel prompt über "(549939 i)" — das i der
   Firmenbuchnummer stand nicht auf der Liste. Übersetzungen von Eigennamen
   enthalten keine Ziffern; Angaben fast immer. Das ist die einfachere und
   verlässlichere Grenze. */
const KEINE_UEBERSETZUNG = (klammer) => /\d/.test(klammer) || /^(?:Art\.|§|no\.|Nr\.)/i.test(klammer.trim());

describe("Englische Seiten: kein Begriff wird doppelt geführt", () => {
  it("Messmittel: es gibt überhaupt englische Seiten mit deutschen Einschüben", () => {
    /* Positivkontrolle. Fände die Suche gar keine lang="de"-Einschübe, wäre der
       Test darunter still grün und wertlos — er prüfte dann nichts. */
    const seiten = englischeSeiten();
    expect(seiten.length).toBeGreaterThanOrEqual(4);
    const mitEinschub = seiten.filter((s) => /<span lang="de"/.test(s.text));
    expect(mitEinschub.length).toBeGreaterThanOrEqual(3);
  });

  it("kein deutscher Begriff trägt eine englische Übersetzung in Klammern hinter sich", () => {
    const funde = [];
    for (const { name, text } of englischeSeiten()) {
      for (const m of flach(text).matchAll(DOPPELUNG)) {
        const [, deutsch, klammer] = m;
        if (KEINE_UEBERSETZUNG(klammer)) continue;
        funde.push(`${name}: „${deutsch}" (${klammer})`);
      }
    }
    expect(
      funde,
      "Deutscher Begriff mit englischer Übersetzung dahinter. Entweder das englische Wort " +
        "als Label VOR den deutschen Begriff setzen, oder die Klammer streichen — ein " +
        "übersetzter Eigenname steht in keinem Register."
    ).toEqual([]);
  });

  it("Rückbauprobe: die Regel erkennt den Fall, der den Test ausgelöst hat", () => {
    /* Belegt, dass der Test rot werden KANN, und zwar genau bei dem Satz, den
       der Nutzer gefunden hat. Ohne diese Probe wüsste niemand, ob die
       Regex je etwas trifft. */
    const beispiel = 'Registry court: <span lang="de">Landesgericht Linz</span> (Regional Court of Linz)';
    const treffer = [...flach(beispiel).matchAll(DOPPELUNG)];
    expect(treffer).toHaveLength(1);
    expect(treffer[0][2]).toBe("Regional Court of Linz");
  });

  it("Rückbauprobe: die erlaubte Form löst NICHT aus", () => {
    /* Sonst wäre der Test übergriffig und die Gesetzeskürzel müssten weichen,
       obwohl sie zum Zitieren gebraucht werden. */
    const erlaubt = [
      'the Austrian Consumer Protection Act (<span lang="de">Konsumentenschutzgesetz, KSchG</span>) applies',
      'Registry court: <span lang="de">Landesgericht Linz</span>',
      '<span lang="de">GISA</span>: 33320410',
      '<span lang="de">FN</span> (549939 i)',
    ];
    for (const zeile of erlaubt) {
      const treffer = [...flach(zeile).matchAll(DOPPELUNG)].filter((m) => !KEINE_UEBERSETZUNG(m[2]));
      expect(treffer, `fälschlich beanstandet: ${zeile}`).toHaveLength(0);
    }
  });
});
