#!/usr/bin/env node
/**
 * pruefe-fremd-meldungen.mjs — gleicht die mitgelieferten Bibliotheken unter
 * public/lib mit den veroeffentlichten Sicherheitsmeldungen ihrer Hersteller ab.
 *
 * WARUM (Befund OSS-2026-09-30-01): Dependabot und npm audit kennen nur die
 * Paketlisten (package-lock.json). Was als Datei unter public/lib liegt, sieht
 * keiner von beiden. So lag der HEIC-Dekoder wochenlang mit veroeffentlichten
 * Sicherheitsmeldungen im Auslieferungsstand, ohne dass irgendetwas anschlug —
 * die Meldungen standen nur im Repository des Herstellers, nicht beim
 * npm-Paket, ueber das er eingebunden war.
 *
 * QUELLEN je Bibliothek:
 *   · die Sicherheitsmeldungen im GitHub-Repository des Herstellers
 *   · bei Bibliotheken, die es auch als npm-Paket gibt, zusaetzlich die
 *     GitHub-Advisory-Datenbank (Abfrage "betrifft <paket>@<version>")
 *
 * EIN-QUELLEN-REGEL: Die Version jeder Bibliothek steht nur in ihrer
 * VERSION-Datei. Dieses Skript weiss nur, in welcher Zeile sie steht.
 *
 * BEWERTUNG einer Meldung gegen unsere Version:
 *   betroffen        — der angegebene Bereich schliesst unsere Version ein
 *   nicht betroffen  — Bereich oder behobene Version schliessen sie aus
 *   unklar           — beides nicht auswertbar (die Hersteller schreiben die
 *                      Bereiche sehr uneinheitlich). Unklar zaehlt wie
 *                      betroffen: Ein Fehlschlag der Auswertung darf nie wie
 *                      "sauber" aussehen (KERN 5c).
 * Jeder Schweregrad zaehlt. Fuer eine mitgelieferte Datei heisst Beheben
 * "neu bauen oder neu kopieren" — das lohnt sich auch bei "low".
 *
 * AUSWEG fuer begruendete Faelle: .github/fremd-meldungen-ausnahmen.json, je
 * Eintrag mit Begruendung und Ablaufdatum. Ausnahmen werden bei jedem Lauf
 * mit ausgegeben; nach dem Ablaufdatum zaehlt die Meldung wieder.
 *
 * SELBST BETRIEBENE DIENSTE (SEC-2026-10-03-14): Der Benachrichtigungs-Server
 * ntfy laeuft als eigener Dienst; seine Fassung steht gespiegelt in
 * .github/fremd-dienste/ntfy/VERSION. Sein Hersteller fuehrt keine
 * Sicherheitsmeldungen — Korrekturen stehen nur in den Versionshinweisen.
 * Deshalb gilt fuer Eintraege mit `aktuell: true` zusaetzlich: Gibt es seit mehr
 * als FRIST_VERALTET_TAGE eine neuere Fassung, ist das ein offener Punkt
 * (Kennung FASSUNG-<juengste Fassung>, in der Ausnahmeliste wie eine Meldung
 * zurueckstellbar). Gezaehlt wird ab der AELTESTEN Fassung, die neuer ist als
 * unsere; dafuer liest der Lauf alle veroeffentlichten Fassungen.
 *
 * DECKUNG: Jeder Ordner unter public/lib und public/fonts muss hier entweder
 * beobachtet oder mit Grund als "kein ausfuehrbarer Code" gefuehrt sein. Ein
 * neuer Ordner ohne Eintrag ist ein Befund — sonst waere die naechste
 * mitgelieferte Bibliothek wieder unsichtbar.
 *
 * Rueckgabewerte: 0 keine offene Meldung, 1 offene Meldung oder Deckungsluecke,
 * 2 Messung nicht durchfuehrbar (kein Netz, API-Fehler, Datei unlesbar).
 *
 * Einspeisepunkte fuer Tests (im Betrieb nicht gesetzt):
 *   FREMD_BASIS      Repository-Wurzel
 *   FREMD_MELDUNGEN  JSON-Datei statt Netzabfrage (Schluessel repo:…, npm:…,
 *                    npm-paket:…, fassungen:… als Liste)
 *   FREMD_AUSNAHMEN  Ausnahmedatei
 *   FREMD_HEUTE      Datum JJJJ-MM-TT statt der Systemuhr
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(process.env.FREMD_BASIS || dirname(fileURLToPath(import.meta.url)) + "/..");
const AUSNAHMEN_DATEI = resolve(process.env.FREMD_AUSNAHMEN || join(REPO, ".github/fremd-meldungen-ausnahmen.json"));
const HEUTE = process.env.FREMD_HEUTE || new Date().toISOString().slice(0, 10);

/* Was beobachtet wird. Die Zeilenmuster lesen die Version aus der VERSION-Datei;
   passt ein Muster nicht mehr, bricht der Lauf mit 2 ab statt still zu raten. */
export const BIBLIOTHEKEN = {
  "public/lib/leaflet": [
    { name: "Leaflet", zeile: /^Leaflet (\d+\.\d+\.\d+)\s*$/m, repo: "Leaflet/Leaflet", npm: "leaflet" },
  ],
  "public/lib/exifr": [{ name: "exifr", zeile: /^exifr (\d+\.\d+\.\d+)\b/m, repo: "MikeKovarik/exifr", npm: "exifr" }],
  "public/lib/libheif": [
    /* bekannt: eine veroeffentlichte Meldung, die in jeder Antwort stehen muss
       (Befund H-16). Fehlt sie, hat die Abfrage nicht das Erwartete geliefert —
       eine leere Liste hiesse sonst "sauber". Leaflet und exifr haben heute
       keine Meldung; dort ist eine leere Antwort normal (Restrisiko,
       docs/SECURITY-MODEL.md). */
    {
      name: "libheif",
      zeile: /^libheif (\d+\.\d+\.\d+)\b/m,
      repo: "strukturag/libheif",
      bekannt: "GHSA-2jg2-4ch7-h545",
    },
    {
      name: "libde265",
      zeile: /^libde265 (\d+\.\d+\.\d+)\b/m,
      repo: "strukturag/libde265",
      bekannt: "GHSA-g2rg-wj66-w594",
    },
  ],
  /* Kein mitgelieferter Code, sondern ein Dienst, den das Projekt selbst
     betreibt. Die VERSION-Datei spiegelt die laufende Fassung;
     scripts/verify-infrastructure.sh haelt beide gegeneinander. */
  ".github/fremd-dienste/ntfy": [
    { name: "ntfy", zeile: /^ntfy (\d+\.\d+\.\d+)\s*$/m, repo: "binwiederhier/ntfy", aktuell: true },
  ],
};
/* Wie lange eine neuere Fassung eines selbst betriebenen Dienstes liegen darf,
   bevor der Lauf rot wird: MEHR als so viele Tage seit ihrem Erscheinen.
   Erschienen am 27.08., gelesen am 26.09. (30 Tage): noch gruen; am 27.09.
   (31 Tage): rot. Gibt es mehrere neuere Fassungen, zaehlt die AELTESTE von
   ihnen: Seit ihrem Erscheinen gibt es eine neuere als unsere. */
export const FRIST_VERALTET_TAGE = 30;
export const OHNE_CODE = {
  "public/fonts/poppins": "Schriftdateien (woff2), kein ausfuehrbarer Code",
};
/* Eigene Erzeugnisse direkt in den Fremd-Ordnern, kein Fremdcode. */
export const EIGENE_DATEIEN = {
  "public/lib/PRUEFSUMMEN.json": "von scripts/pruefe-fremddateien.mjs erzeugt",
};
const BEREICHE = ["public/lib", "public/fonts"];

/* Eine Messung, die nicht durchfuehrbar war. Wird am Ende als Rueckgabewert 2
   gemeldet — nie als bestandener Lauf. */
export class Messfehler extends Error {}

/* ── Versionen vergleichen ────────────────────────────────────────────────── */

export function zerlege(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(text).trim());
  if (!m) return null;
  return [m[1], m[2], m[3], m[4]].map((x) => Number(x || 0));
}

export function vergleiche(a, b) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/* Ist unsere Fassung veraltet? `fassungen` ist die Liste der veroeffentlichten
   Fassungen des Herstellers ({ tag_name, published_at }), ohne Entwuerfe und
   Vorab-Fassungen. Gezaehlt wird ab dem Erscheinen der AELTESTEN Fassung, die
   neuer ist als unsere — seit diesem Tag gibt es eine neuere. Das Alter der
   juengsten zu messen, liesse die Frist mit jeder weiteren Fassung von vorn
   beginnen: Bei einem Hersteller, der oefter als alle 30 Tage veroeffentlicht,
   wuerde der Lauf nie rot. Liefert null (aktuell, oder noch innerhalb der
   Frist) oder { neu, seit, tage }: `seit` ist die aelteste neuere Fassung,
   `neu` die juengste. Eine unlesbare Angabe ist ein Messfehler (wirft) — sie
   darf nie wie "aktuell" aussehen; das gilt fuer JEDE Fassung der Liste. */
export function veraltet(unsereVersion, fassungen, heute, fristTage = FRIST_VERALTET_TAGE) {
  const unsere = zerlege(unsereVersion);
  if (!unsere) throw new Messfehler(`Fassung nicht lesbar: unsere "${unsereVersion}"`);
  if (!Array.isArray(fassungen) || fassungen.length === 0) {
    throw new Messfehler("keine veroeffentlichte Fassung des Herstellers gelesen");
  }
  if (!datumGueltig(heute)) throw new Messfehler(`Datum nicht lesbar: heute "${heute}"`);
  const neuere = [];
  for (const fassung of fassungen) {
    const stand = zerlege(fassung && fassung.tag_name);
    if (!stand) throw new Messfehler(`Fassung nicht lesbar: Hersteller "${fassung && fassung.tag_name}"`);
    if (vergleiche(stand, unsere) <= 0) continue;
    const erschienen = String(fassung.published_at || "").slice(0, 10);
    if (!datumGueltig(erschienen)) {
      throw new Messfehler(`Datum nicht lesbar: erschienen "${fassung.published_at}" (${fassung.tag_name})`);
    }
    neuere.push({ stand, erschienen, name: String(fassung.tag_name).trim().replace(/^v/, "") });
  }
  if (neuere.length === 0) return null;
  const aelteste = neuere.reduce((a, b) => (b.erschienen < a.erschienen ? b : a));
  const juengste = neuere.reduce((a, b) => (vergleiche(b.stand, a.stand) > 0 ? b : a));
  const tage = Math.round(
    (Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${aelteste.erschienen}T00:00:00Z`)) / 86400000
  );
  return tage > fristTage ? { neu: juengste.name, seit: aelteste.name, tage } : null;
}

/* Bereich wie "<= 1.23.2", "<=1.1.1", ">= 1.0.16, <= 1.1.2", "< 1.18.2".
   Liefert eine Liste von Bedingungen oder null, wenn ein Teil unlesbar ist. */
export function bereichLesen(bereich) {
  if (!bereich || !String(bereich).trim()) return null;
  const teile = String(bereich)
    .split(",")
    .map((t) => t.trim());
  const bedingungen = [];
  for (const teil of teile) {
    const m = /^(<=|<|>=|>|==|=)?\s*(v?\d+(?:\.\d+){0,3})$/.exec(teil);
    if (!m) return null;
    const version = zerlege(m[2]);
    if (!version) return null;
    bedingungen.push({ op: m[1] || "=", version });
  }
  return bedingungen;
}

function erfuellt(version, { op, version: grenze }) {
  const c = vergleiche(version, grenze);
  return { "<": c < 0, "<=": c <= 0, ">": c > 0, ">=": c >= 0, "=": c === 0, "==": c === 0 }[op];
}

/* Behobene Versionen wie "1.23.3", "v1.22.0", ">= 1.0.17", "2.1.7, 5.0.12".
   Bei genau einer Angabe: behoben, wenn unsere Version darauf oder darueber
   liegt. Bei mehreren (Reparatur in mehreren Versionslinien) zaehlt nur die
   Angabe derselben Linie, also gleiche Haupt- UND Nebenversion — bei libheif
   und libde265 ist alles 1.x, die Hauptversion allein unterscheidet nichts
   (Befund G-03, 30.09.2026). Gibt es keine Angabe unserer Linie, ist das
   unklar (null). Liefert null auch, wenn nichts lesbar ist. */
export function behoben(version, behobenText) {
  if (!behobenText || !String(behobenText).trim()) return null;
  const angaben = String(behobenText)
    .split(",")
    .map((t) => zerlege(t.trim().replace(/^>=\s*/, "")))
    .filter(Boolean);
  if (angaben.length === 0) return null;
  if (angaben.length === 1) return vergleiche(version, angaben[0]) >= 0;
  const linie = angaben.filter((p) => p[0] === version[0] && p[1] === version[1]);
  if (linie.length === 0) return null;
  return linie.some((p) => vergleiche(version, p) >= 0);
}

/* Ein Eintrag einer Meldung (Bereich + behobene Version) gegen unsere Version. */
export function bewerte(versionText, bereich, behobenText) {
  const version = zerlege(versionText);
  if (!version) return "unklar";
  const bedingungen = bereichLesen(bereich);
  const istBehoben = behoben(version, behobenText);
  if (bedingungen) {
    const verfehlt = bedingungen.filter((b) => !erfuellt(version, b));
    if (verfehlt.length) {
      /* Liegt unsere Version UNTER dem Bereich (eine Untergrenze greift nicht),
         gab es den Fehler bei uns noch nicht — etwa libde265 "ab 1.0.16" bei
         1.0.15. Das ist eindeutig. */
      /* Nur eine Untergrenze (>=, >) kann sagen "gab es bei uns noch nicht". Eine
         nackte Version darueber meint "gefunden in" — ob der Fehler aelter ist,
         sagt sie nicht (Befund H-05); sie laeuft weiter unten als "unklar". */
      const darunter = verfehlt.some((b) => b.op === ">=" || b.op === ">");
      if (darunter) return "nicht betroffen";
      /* Eine einzelne nackte Version ("1.17.0") meint bei libheif "gefunden in",
         nicht "nur dort". Liegt unsere Version darueber und ist keine Reparatur
         genannt, laesst sich nichts ausschliessen (Befund G-03). */
      /* Auch eine Liste nackter Versionen ("1.17.0, 1.18.0") meint "gefunden in"
         — dieselbe Bedeutung, dasselbe Urteil (Befund J-12). */
      if (bedingungen.every((b) => b.op.startsWith("=")) && istBehoben !== true) {
        return "unklar";
      }
      /* Liegt sie DARUEBER, die Reparatur aber noch hoeher, widersprechen sich
         die Angaben (bei libheif mehrfach so gemeldet, etwa Bereich "1.17.0",
         repariert in 1.23.3). Welche stimmt, kann das Skript nicht wissen; ein
         Widerspruch ist deshalb nie "sauber". */
      return istBehoben === false ? "unklar" : "nicht betroffen";
    }
    /* Der Bereich schliesst uns ein. Manche Hersteller geben nur eine
       Untergrenze an (">= 1.20.0") und nennen die Reparatur getrennt — liegt
       unsere Version auf oder ueber der Reparatur, sind wir nicht betroffen. */
    return istBehoben === true ? "nicht betroffen" : "betroffen";
  }
  if (istBehoben === true) return "nicht betroffen";
  if (istBehoben === false) return "betroffen";
  return "unklar";
}

/* Eine ganze Meldung: betroffen, sobald ein Eintrag betroffen ist; unklar,
   wenn keiner betroffen, aber einer unklar ist. Ohne Eintraege: unklar. */
export function bewerteMeldung(versionText, meldung) {
  const eintraege = meldung.vulnerabilities || [];
  if (eintraege.length === 0) return "unklar";
  const urteile = eintraege.map((e) => bewerte(versionText, e.vulnerable_version_range, e.patched_versions));
  if (urteile.includes("betroffen")) return "betroffen";
  if (urteile.includes("unklar")) return "unklar";
  return "nicht betroffen";
}

/* ── Quellen ──────────────────────────────────────────────────────────────── */

/* Einspeisepunkt fuer Tests des ECHTEN Netzwegs (Befund H-12): FETCH_ATTRAPPE
   nennt eine JSON-Datei { "<url>": { "status": 200, "body": [...], "link": "..." } }.
   Eine nicht hinterlegte Adresse ist ein Netzfehler — sie faellt also auf. */
if (process.env.FETCH_ATTRAPPE) {
  const karte = JSON.parse(readFileSync(process.env.FETCH_ATTRAPPE, "utf8"));
  globalThis.fetch = async (url) => {
    const eintrag = karte[String(url)];
    if (!eintrag) throw new Error(`Attrappe kennt ${url} nicht`);
    return {
      ok: (eintrag.status || 200) < 400,
      status: eintrag.status || 200,
      headers: { get: (n) => (n.toLowerCase() === "link" ? eintrag.link || null : null) },
      json: async () => eintrag.body,
    };
  };
}

let festeMeldungen = null;
if (process.env.FREMD_MELDUNGEN) {
  try {
    festeMeldungen = JSON.parse(readFileSync(process.env.FREMD_MELDUNGEN, "utf8"));
  } catch (fehler) {
    console.error(`FEHLER: ${process.env.FREMD_MELDUNGEN} unlesbar: ${fehler.message}`);
    process.exit(2);
  }
}

async function github(pfad) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const kopf = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) kopf.Authorization = `Bearer ${token}`;
  const alle = [];
  let url = `https://api.github.com${pfad}`;
  while (url) {
    let antwort;
    try {
      antwort = await fetch(url, { headers: kopf });
    } catch (fehler) {
      throw new Messfehler(`Netzfehler bei ${url}: ${fehler.message}`);
    }
    if (!antwort.ok) {
      throw new Messfehler(`GitHub antwortete ${antwort.status} auf ${url}`);
    }
    const daten = await antwort.json();
    if (!Array.isArray(daten)) throw new Messfehler(`Unerwartete Antwort von ${url}`);
    alle.push(...daten);
    const naechste = /<([^>]+)>;\s*rel="next"/.exec(antwort.headers.get("link") || "");
    url = naechste ? naechste[1] : null;
  }
  return alle;
}

async function repoMeldungen(repo) {
  if (festeMeldungen) {
    const eintrag = festeMeldungen[`repo:${repo}`];
    if (!Array.isArray(eintrag)) throw new Messfehler(`keine Testdaten fuer repo:${repo}`);
    return eintrag;
  }
  return github(`/repos/${repo}/security-advisories?state=published&per_page=100`);
}

/* Alle veroeffentlichten Fassungen des Herstellers, ohne Entwuerfe und
   Vorab-Fassungen. Die ganze Liste, nicht nur die juengste: `veraltet` zaehlt
   ab der aeltesten Fassung, die neuer ist als unsere. */
async function fassungen(repo) {
  let liste;
  if (festeMeldungen) {
    liste = festeMeldungen[`fassungen:${repo}`];
    if (!Array.isArray(liste)) throw new Messfehler(`keine Testdaten fuer fassungen:${repo}`);
  } else {
    liste = await github(`/repos/${repo}/releases?per_page=100`);
  }
  if (liste.some((f) => !f || typeof f !== "object")) {
    throw new Messfehler(`Unerwartete Antwort zu den Fassungen von ${repo}`);
  }
  return liste.filter((f) => f.draft !== true && f.prerelease !== true);
}

/* Die Advisory-Datenbank antwortet auf ein Paket, das es gar nicht gibt
   (Tippfehler, umbenannt), genauso mit einer leeren Liste wie auf ein sauberes.
   Deshalb vorher die Existenz pruefen — leer darf nur "keine Meldung" heissen
   (Befund G-09). */
async function npmPaketExistiert(paket) {
  if (festeMeldungen) {
    const eintrag = festeMeldungen[`npm-paket:${paket}`];
    if (typeof eintrag !== "boolean") throw new Messfehler(`keine Testdaten fuer npm-paket:${paket}`);
    return eintrag;
  }
  let antwort;
  try {
    antwort = await fetch(`https://registry.npmjs.org/${encodeURIComponent(paket)}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });
  } catch (fehler) {
    throw new Messfehler(`Netzfehler bei der npm-Registry (${paket}): ${fehler.message}`);
  }
  if (antwort.status === 404) return false;
  if (!antwort.ok) throw new Messfehler(`npm-Registry antwortete ${antwort.status} fuer ${paket}`);
  return true;
}

async function npmMeldungen(paket, version) {
  if (!(await npmPaketExistiert(paket))) {
    throw new Messfehler(`npm-Paket "${paket}" gibt es nicht — die Abfrage waere leer, ohne etwas zu pruefen`);
  }
  if (festeMeldungen) {
    const eintrag = festeMeldungen[`npm:${paket}@${version}`];
    if (!Array.isArray(eintrag)) throw new Messfehler(`keine Testdaten fuer npm:${paket}@${version}`);
    return eintrag;
  }
  return github(`/advisories?ecosystem=npm&affects=${encodeURIComponent(`${paket}@${version}`)}&per_page=100`);
}

/* ── Ausnahmen ────────────────────────────────────────────────────────────── */

function ausnahmenLesen() {
  if (!existsSync(AUSNAHMEN_DATEI)) return [];
  let daten;
  try {
    daten = JSON.parse(readFileSync(AUSNAHMEN_DATEI, "utf8"));
  } catch (fehler) {
    console.error(`FEHLER: ${AUSNAHMEN_DATEI} unlesbar: ${fehler.message}`);
    process.exit(2);
  }
  return Array.isArray(daten.ausnahmen) ? daten.ausnahmen : [];
}

/* "version": Eine Ausnahme ist am Quelltext EINER Version begruendet und gilt
   nur fuer sie (Befund G-12). Nach einem Neubau mit anderer Version zaehlt die
   Meldung wieder, bis jemand sie an der neuen Version geprueft hat. */
const PFLICHTFELDER = ["ghsa", "bibliothek", "version", "grund", "eingetragen", "pruefen_bis"];

/* Befund G-04 (30.09.2026), dieselbe Fehlerklasse wie OSS-2026-08-12-21 im
   Audit-Gate: Das Ablaufdatum wird als Zeichenkette verglichen. "31.12.2026"
   waere als Text groesser als jedes "20xx-"-Datum und liefe nie ab. Deshalb
   Form und Gueltigkeit pruefen; ein fehlerhafter Eintrag ist ungueltig. */
export function datumGueltig(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ""))) return false;
  const wert = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(wert.getTime()) && wert.toISOString().slice(0, 10) === text;
}

/* ── Lauf ─────────────────────────────────────────────────────────────────── */

async function main() {
  const befunde = [];
  const hinweise = [];
  /* --nur-deckung (Befund H-11): nur die Deckungspruefung, ohne Netz. Laeuft
     in jedem Pull Request und vor dem Push, damit eine neue, unbeobachtete
     Bibliothek gar nicht erst ausgeliefert wird — nicht erst nachts auffaellt. */
  const nurDeckung = process.argv.includes("--nur-deckung");

  /* Deckung: jeder Ordner beobachtet oder begruendet ausgenommen. */
  for (const bereich of BEREICHE) {
    const wurzel = join(REPO, bereich);
    if (!existsSync(wurzel)) continue;
    for (const name of readdirSync(wurzel)) {
      const rel = `${bereich}/${name}`;
      if (name.startsWith(".") || EIGENE_DATEIEN[rel]) continue;
      /* Auch eine einzeln abgelegte Datei (public/lib/irgendwas.min.js) ist
         mitgelieferter Fremdcode und braucht eine Beobachtung (Befund G-13). */
      if (!BIBLIOTHEKEN[rel] && !OHNE_CODE[rel]) {
        const art = statSync(join(wurzel, name)).isDirectory() ? "Ordner" : "Datei";
        befunde.push(`UNGEDECKT  ${rel}: mitgelieferte(r) ${art}, aber von keiner Pruefung beobachtet`);
      }
    }
  }

  if (nurDeckung) {
    for (const b of befunde) console.log(`  ${b}`);
    console.log(
      befunde.length
        ? `ERGEBNIS: ${befunde.length} ungedeckte(r) Bestandteil(e) unter public/lib bzw. public/fonts.`
        : "ERGEBNIS: jeder Bestandteil unter public/lib und public/fonts wird beobachtet."
    );
    return befunde.length ? 1 : 0;
  }

  const ausnahmen = ausnahmenLesen();
  const brauchbar = (a) => PFLICHTFELDER.every((f) => a[f]) && datumGueltig(a.pruefen_bis);
  for (const a of ausnahmen) {
    const fehlt = PFLICHTFELDER.filter((f) => !a[f]);
    if (fehlt.length) {
      befunde.push(`AUSNAHME UNGUELTIG  ${a.ghsa || "?"}: es fehlt ${fehlt.join(", ")}`);
    } else if (!datumGueltig(a.pruefen_bis)) {
      befunde.push(
        `AUSNAHME UNGUELTIG  ${a.ghsa}: pruefen_bis "${a.pruefen_bis}" ist kein Datum der Form JJJJ-MM-TT ` +
          "(andere Schreibweisen liefen im Zeichenkettenvergleich nie ab)"
      );
    }
  }
  const gueltigeAusnahme = (ghsa, bibliothek, version) =>
    ausnahmen.find(
      (a) =>
        a.ghsa === ghsa &&
        a.bibliothek === bibliothek &&
        a.version === version &&
        brauchbar(a) &&
        a.pruefen_bis >= HEUTE
    );

  let geprueft = 0;
  let dienste = 0;
  for (const [ordner, teile] of Object.entries(BIBLIOTHEKEN)) {
    const versionsDatei = join(REPO, ordner, "VERSION");
    if (!existsSync(versionsDatei)) {
      throw new Messfehler(`${ordner}/VERSION fehlt — ohne Version keine Aussage`);
    }
    const text = readFileSync(versionsDatei, "utf8");
    for (const teil of teile) {
      const treffer = teil.zeile.exec(text);
      if (!treffer) {
        throw new Messfehler(`${ordner}/VERSION: keine Zeile fuer ${teil.name} (Muster ${teil.zeile})`);
      }
      const version = treffer[1];
      const meldungen = new Map();
      const ausDemRepo = await repoMeldungen(teil.repo);
      if (teil.bekannt && !ausDemRepo.some((m) => m.ghsa_id === teil.bekannt)) {
        throw new Messfehler(
          `${teil.repo}: die bekannte Meldung ${teil.bekannt} fehlt in der Antwort (${ausDemRepo.length} gelesen) — ` +
            "die Abfrage hat nicht das Erwartete geliefert"
        );
      }
      for (const m of ausDemRepo) {
        if (m.withdrawn_at) continue;
        meldungen.set(m.ghsa_id, { ...m, urteil: bewerteMeldung(version, m) });
      }
      if (teil.npm) {
        /* Die Datenbank filtert selbst auf unsere Version: Was sie liefert, betrifft uns. */
        for (const m of await npmMeldungen(teil.npm, version)) {
          if (m.withdrawn_at) continue;
          meldungen.set(m.ghsa_id, { ...m, urteil: "betroffen" });
        }
      }
      if (teil.aktuell) dienste++;
      else geprueft++;
      const offen = [...meldungen.values()].filter((m) => m.urteil !== "nicht betroffen");
      console.log(`${teil.name} ${version}: ${meldungen.size} Meldung(en) gelesen, ${offen.length} offen`);
      for (const m of offen) {
        const ausnahme = gueltigeAusnahme(m.ghsa_id, teil.name, version);
        const zeile = `${m.urteil.toUpperCase()}  ${teil.name} ${version}  ${m.ghsa_id} (${m.severity})  ${m.summary || ""}`;
        if (ausnahme) {
          hinweise.push(`${zeile}\n      ausgenommen bis ${ausnahme.pruefen_bis}: ${ausnahme.grund}`);
        } else {
          befunde.push(`${zeile}\n      ${m.html_url || ""}`);
        }
      }
      if (teil.aktuell) {
        const stand = veraltet(version, await fassungen(teil.repo), HEUTE);
        if (!stand) {
          console.log(`${teil.name} ${version}: keine neuere Fassung, die aelter als ${FRIST_VERALTET_TAGE} Tage ist`);
        } else {
          const inzwischen = stand.neu === stand.seit ? "" : `, inzwischen ${stand.neu}`;
          const zeile =
            `VERALTET  ${teil.name} ${version}  seit ${stand.tage} Tagen gibt es ${stand.seit}${inzwischen} ` +
            `(Frist ${FRIST_VERALTET_TAGE} Tage)`;
          const ausnahme = gueltigeAusnahme(`FASSUNG-${stand.neu}`, teil.name, version);
          if (ausnahme) {
            hinweise.push(`${zeile}\n      ausgenommen bis ${ausnahme.pruefen_bis}: ${ausnahme.grund}`);
          } else {
            befunde.push(`${zeile}\n      https://github.com/${teil.repo}/releases`);
          }
        }
      }
    }
  }

  console.log(
    `\nBeobachtet: ${geprueft} Bibliotheksteile` +
      (dienste ? ` und ${dienste} selbst betriebene(r) Dienst(e)` : "") +
      `, Stand ${HEUTE}`
  );
  for (const h of hinweise) console.log(`  [Ausnahme] ${h}`);
  if (befunde.length === 0) {
    console.log("ERGEBNIS: keine offene Sicherheitsmeldung, keine veraltete Fassung.");
    return 0;
  }
  console.log("");
  for (const b of befunde) console.log(`  ${b}`);
  console.log(
    `\nERGEBNIS: ${befunde.length} offene(r) Punkt(e). Bibliothek neu bauen oder neu kopieren; ` +
      "nur wenn das nachweislich nicht noetig ist, begruendeten Eintrag mit Ablaufdatum in " +
      ".github/fremd-meldungen-ausnahmen.json."
  );
  if (befunde.some((b) => b.startsWith("VERALTET"))) {
    console.log(
      "Veraltete Fassung eines Dienstes: Dienst auf die neue Fassung heben und die VERSION-Datei nachziehen " +
        "(docs/RUNBOOK.md, Abschnitt zum Nachtlauf); zurueckstellen nur mit begruendetem Eintrag FASSUNG-<Fassung>."
    );
  }
  return 1;
}

/* Nur als Programm laufen, nicht beim Import durch Tests. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (fehler) => {
      if (fehler instanceof Messfehler) {
        console.error(`MESSUNG NICHT DURCHFUEHRBAR: ${fehler.message}`);
        console.error("Das ist kein bestandener Lauf.");
        process.exit(2);
      }
      console.error(fehler);
      process.exit(2);
    }
  );
}
