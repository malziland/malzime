/**
 * strukturdaten-bilder.test.js — Bild-Metadaten fuer die Google-Bildersuche
 * (v3.3.1).
 *
 * ANLASS: Die Google Search Console meldete am 17.08.2026 zwei nicht kritische
 * Befunde zum Typ „Bild-Metadaten fuer strukturierte Daten": In den drei
 * ImageObject-Bloecken fehlten `license` und `acquireLicensePage`.
 *
 * Der Rest des Satzes (creator, creditText, copyrightNotice,
 * digitalSourceType) war da — genau deshalb ist eine Dauerpruefung sinnvoll:
 * Ein unvollstaendiger Satz faellt beim Lesen nicht auf, weil er auf den
 * ersten Blick vollstaendig wirkt.
 *
 * Reine Textanalyse der ausgelieferten Seite — kein Netzwerk.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "../index.html");

/** Alle JSON-LD-Bloecke der Seite geparst — ungueltiges JSON faellt hier auf. */
function jsonLdBloecke() {
  const html = readFileSync(INDEX, "utf8");
  const treffer = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return treffer.map((m) => JSON.parse(m[1]));
}

function bildObjekte() {
  return jsonLdBloecke()
    .flatMap((b) => (Array.isArray(b) ? b : [b]))
    .filter((e) => e && e["@type"] === "ImageObject");
}

describe("Strukturdaten der Demo-Bilder", () => {
  it("die Seite enthaelt gueltiges JSON-LD", () => {
    /* Positivkontrolle: Faende der Ausdruck nichts, waeren alle folgenden
       Pruefungen still gruen — eine leere Menge erfuellt jede Allaussage. */
    expect(jsonLdBloecke().length).toBeGreaterThan(0);
  });

  it("es gibt genau drei Demo-Bilder mit Strukturdaten", () => {
    expect(bildObjekte()).toHaveLength(3);
  });

  it.each(["license", "acquireLicensePage", "creator", "creditText", "copyrightNotice", "digitalSourceType"])(
    "jedes Demo-Bild traegt das Feld %s",
    (feld) => {
      for (const bild of bildObjekte()) {
        expect(bild[feld], `${bild.name} ohne ${feld}`).toBeTruthy();
      }
    }
  );

  it("license und acquireLicensePage sind absolute URLs (Google verlangt URLs, keine Texte)", () => {
    for (const bild of bildObjekte()) {
      expect(bild.license).toMatch(/^https:\/\//);
      expect(bild.acquireLicensePage).toMatch(/^https:\/\//);
    }
  });

  it("die Lizenzseite auf eigener Domain existiert auch wirklich", () => {
    /* Ein Verweis auf eine Seite, die es nicht gibt, waere schlimmer als das
       fehlende Feld: Google und Nutzer landen im Nichts. Geprueft wird die
       Datei, nicht nur die Zeichenkette. */
    const seiten = bildObjekte().map((b) => b.acquireLicensePage);
    for (const url of seiten) {
      const pfad = new URL(url).pathname.replace(/^\//, "") || "index";
      const datei = join(dirname(fileURLToPath(import.meta.url)), `../${pfad}.html`);
      expect(() => readFileSync(datei, "utf8"), `${url} zeigt ins Leere`).not.toThrow();
    }
  });

  it("die verlinkte Seite traegt tatsaechlich eine Kontaktmoeglichkeit", () => {
    /* Google verlangt eine Seite, auf der man erfaehrt, wie man eine Lizenz
       bekommt. Ohne erreichbaren Kontakt waere das Feld formal erfuellt und
       inhaltlich eine Leerstelle. Geprueft wird der Inhalt, nicht der Link. */
    const url = bildObjekte()[0].acquireLicensePage;
    const pfad = new URL(url).pathname.replace(/^\//, "");
    const seite = readFileSync(join(dirname(fileURLToPath(import.meta.url)), `../${pfad}.html`), "utf8");
    expect(seite).toMatch(/mailto:/);
  });
});
