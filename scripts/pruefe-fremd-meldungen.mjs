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
 *   FREMD_MELDUNGEN  JSON-Datei statt Netzabfrage
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
    { name: "libheif", zeile: /^libheif (\d+\.\d+\.\d+)\b/m, repo: "strukturag/libheif" },
    { name: "libde265", zeile: /^libde265 (\d+\.\d+\.\d+)\b/m, repo: "strukturag/libde265" },
  ],
};
export const OHNE_CODE = {
  "public/fonts/poppins": "Schriftdateien (woff2), kein ausfuehrbarer Code",
};
const BEREICHE = ["public/lib", "public/fonts"];

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
   Unsere Version gilt als behoben, wenn eine Angabe mit derselben
   Hauptversion kleiner/gleich ist — oder, bei genau einer Angabe, wenn sie
   kleiner/gleich ist. Liefert null, wenn nichts lesbar ist. */
export function behoben(version, behobenText) {
  if (!behobenText || !String(behobenText).trim()) return null;
  const angaben = String(behobenText)
    .split(",")
    .map((t) => zerlege(t.trim().replace(/^>=\s*/, "")))
    .filter(Boolean);
  if (angaben.length === 0) return null;
  if (angaben.length === 1) return vergleiche(version, angaben[0]) >= 0;
  return angaben.some((p) => p[0] === version[0] && vergleiche(version, p) >= 0);
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
      const darunter = verfehlt.some(
        (b) => b.op === ">=" || b.op === ">" || (b.op.startsWith("=") && vergleiche(version, b.version) < 0)
      );
      if (darunter) return "nicht betroffen";
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

class Messfehler extends Error {}

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

async function npmMeldungen(paket, version) {
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

const PFLICHTFELDER = ["ghsa", "bibliothek", "grund", "eingetragen", "pruefen_bis"];

/* ── Lauf ─────────────────────────────────────────────────────────────────── */

async function main() {
  const befunde = [];
  const hinweise = [];

  /* Deckung: jeder Ordner beobachtet oder begruendet ausgenommen. */
  for (const bereich of BEREICHE) {
    const wurzel = join(REPO, bereich);
    if (!existsSync(wurzel)) continue;
    for (const name of readdirSync(wurzel)) {
      const rel = `${bereich}/${name}`;
      if (name.startsWith(".") || !statSync(join(wurzel, name)).isDirectory()) continue;
      if (!BIBLIOTHEKEN[rel] && !OHNE_CODE[rel]) {
        befunde.push(`UNGEDECKT  ${rel}: mitgeliefert, aber von keiner Pruefung beobachtet`);
      }
    }
  }

  const ausnahmen = ausnahmenLesen();
  for (const a of ausnahmen) {
    const fehlt = PFLICHTFELDER.filter((f) => !a[f]);
    if (fehlt.length) {
      befunde.push(`AUSNAHME UNGUELTIG  ${a.ghsa || "?"}: es fehlt ${fehlt.join(", ")}`);
    }
  }
  const gueltigeAusnahme = (ghsa, bibliothek) =>
    ausnahmen.find(
      (a) =>
        a.ghsa === ghsa && a.bibliothek === bibliothek && PFLICHTFELDER.every((f) => a[f]) && a.pruefen_bis >= HEUTE
    );

  let geprueft = 0;
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
      for (const m of await repoMeldungen(teil.repo)) {
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
      geprueft++;
      const offen = [...meldungen.values()].filter((m) => m.urteil !== "nicht betroffen");
      console.log(`${teil.name} ${version}: ${meldungen.size} Meldung(en) gelesen, ${offen.length} offen`);
      for (const m of offen) {
        const ausnahme = gueltigeAusnahme(m.ghsa_id, teil.name);
        const zeile = `${m.urteil.toUpperCase()}  ${teil.name} ${version}  ${m.ghsa_id} (${m.severity})  ${m.summary || ""}`;
        if (ausnahme) {
          hinweise.push(`${zeile}\n      ausgenommen bis ${ausnahme.pruefen_bis}: ${ausnahme.grund}`);
        } else {
          befunde.push(`${zeile}\n      ${m.html_url || ""}`);
        }
      }
    }
  }

  console.log(`\nBeobachtet: ${geprueft} Bibliotheksteile, Stand ${HEUTE}`);
  for (const h of hinweise) console.log(`  [Ausnahme] ${h}`);
  if (befunde.length === 0) {
    console.log("ERGEBNIS: keine offene Sicherheitsmeldung.");
    return 0;
  }
  console.log("");
  for (const b of befunde) console.log(`  ${b}`);
  console.log(
    `\nERGEBNIS: ${befunde.length} offene(r) Punkt(e). Bibliothek neu bauen oder neu kopieren; ` +
      "nur wenn das nachweislich nicht noetig ist, begruendeten Eintrag mit Ablaufdatum in " +
      ".github/fremd-meldungen-ausnahmen.json."
  );
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
