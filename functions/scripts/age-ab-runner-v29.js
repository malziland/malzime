#!/usr/bin/env node
"use strict";

/**
 * age-ab-runner-v29.js — A/B-Test der Altersschätzung: Live-Prompt gegen das
 * Merkmalsraster aus v2.9.0.
 *
 * ADDITIV / TEST-ONLY. Beruehrt keinen Produktionscode, kein Firestore, kein
 * Deploy. Schreibt nur lokale Dateien.
 *
 * WORUM ES GEHT:
 * Der Inhaber beobachtet ueber rund 5000 begleitete Workshop-Analysen ein
 * durchgaengiges Muster: Maedchen werden bis zu sechs Jahre ZU ALT geschaetzt,
 * Jungen eher zu jung. Im Prompt stand die Schulterbreite als PRIMAERE
 * Alters-Achse und eine Zusatzregel nur fuer Maedchen. Beides haengt an der
 * Pubertaet, die bei Maedchen rund zwei Jahre frueher einsetzt — und verzerrt
 * die Geschlechter deshalb gegenlaeufig. v2.9.0 ersetzt das durch Merkmale,
 * die bei beiden gleich schnell laufen (Augenlinie, Zahnstand, Wangenfett,
 * Nasenruecken, Kopf-Koerper-Verhaeltnis).
 *
 * WAS DIESER LAUF EHRLICH KANN — UND WAS NICHT:
 * Das Testset hat 14 Bilder, davon nur 6 Minderjaehrige (3 je Geschlecht).
 * Das reicht NICHT, um die Beobachtung des Inhabers zu bestaetigen oder zu
 * widerlegen. Ein einzelnes Bild kippt den Mittelwert. Diese Messung liefert
 * einen ersten Eindruck und schlaegt Alarm bei grober Verschlechterung — mehr
 * nicht. Belastbare Zahlen kommen erst aus dem Erfassungsblatt im Workshop.
 *
 * BELASTBAR ist dagegen die Begruendungs-Metrik (C): Sie zaehlt, WORAN das
 * Modell seine Schaetzung festmacht, und braucht dafuer keine Wahrheitsliste.
 * Genau darum ging es bei der Aenderung — nicht um einen Ausgleich, sondern um
 * nachvollziehbare Merkmale.
 *
 * MISST:
 *   A) Altersabweichung gegen compare-input/ground-truth.json — getrennt nach
 *      Kind/Erwachsen und nach Geschlecht, MIT Vorzeichen (zu alt / zu jung).
 *      Das Vorzeichen ist der Kern: Es zeigt die Richtung des Musters.
 *   B) Geschlechtstreffer.
 *   C) Begruendungs-Qualitaet: Nennt die Antwort die pubertaetsunabhaengigen
 *      Marker — oder Reife-Woerter wie "Entwicklungsstand", "Schultern"?
 *   D) Streuung ueber die Laeufe je Bild (braucht keine Wahrheitsliste).
 *   E) Breite der ausgegebenen Altersspanne — relevant, weil der
 *      Kinderschutz-Filter seit v2.9.0 auf der UNTERGRENZE arbeitet.
 *
 * WAECHTER: Parse-Fehler, abgeschnittene Antworten, Tokenverbrauch, Kosten.
 *
 * Aufruf:
 *   MISTRAL_API_KEY=<key> node functions/scripts/age-ab-runner-v29.js
 *   Optional: RUNS_PER_IMAGE=3  CONCURRENCY=4  TEST_IMAGES=a.jpg,b.jpg
 *             SCALE_TO=640   (skaliert die Bilder vorher — Auflaesungs-Test)
 *
 * NICHT Mo-Fr 08-14 Uhr starten: konkurriert mit der Produktion um denselben
 * Mistral-Key und dessen TPM-Budget.
 *
 * Output:
 *   ./age-ab-v29-results.json   Rohdaten aller Calls
 *   ./age-ab-v29-report.md      Markdown-Auswertung
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { parseSafely } = require("../src/json-repair");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "compare-input");
const OUTPUT_JSON = path.join(REPO_ROOT, "age-ab-v29-results.json");
const OUTPUT_REPORT = path.join(REPO_ROOT, "age-ab-v29-report.md");

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-large-2512";
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.5;
const TIMEOUT_MS = 180_000;

/* Offizielle Preise Stand 08/2026, mistral-large-2512, USD je 1 Mio Tokens.
   Gecachte Eingabe-Tokens kosten 10 % des normalen Eingabepreises. */
const PREIS_IN = 0.5;
const PREIS_OUT = 1.5;
const USD_ZU_EUR = 0.92;

const RUNS_PER_IMAGE = Number(process.env.RUNS_PER_IMAGE || 3);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const SCALE_TO = Number(process.env.SCALE_TO || 0);

const NEU_PROMPT = require("../src/locales/de/prompts").singleLargePrompt;
const { brandBlocklistBlock } = require("../src/locales/de/prompts");
const { _BRAND_BLOCKLIST_SETS } = require("../src/mistral");

/* Den Live-Stand aus git holen — so vergleicht der Lauf gegen das, was
   tatsaechlich deployt ist, nicht gegen eine handgepflegte Kopie. */
const LIVE_PROMPT = (() => {
  const tmp = path.join(os.tmpdir(), `malzime-prompts-live-${process.pid}.js`);
  try {
    const quelle = execSync("git show HEAD:functions/src/locales/de/prompts.js", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    fs.writeFileSync(tmp, quelle);
    const modul = require(tmp);
    fs.unlinkSync(tmp);
    return modul.singleLargePrompt;
  } catch (err) {
    console.error("FEHLER: Live-Prompt aus git HEAD nicht ladbar:", err.message);
    console.error("  Der Lauf braucht einen sauberen Vergleichsstand. Abbruch.");
    process.exit(1);
  }
})();

if (LIVE_PROMPT === NEU_PROMPT) {
  console.error("FEHLER: Live- und Kandidaten-Prompt sind identisch.");
  console.error("  Die Aenderung ist offenbar schon committet — dann gibt es nichts zu vergleichen.");
  process.exit(1);
}

const GROUND_TRUTH = (() => {
  const p = path.join(INPUT_DIR, "ground-truth.json");
  if (!fs.existsSync(p)) {
    console.error(`FEHLER: ${p} fehlt — ohne Wahrheitsliste keine Alters-Messung.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
})();

/* ── Begruendungs-Marker ──────────────────────────────────────────────────
   ACHTUNG, hier steckte zuerst ein Messfehler drin: Ich habe im
   nutzersichtbaren Kartentext nach Fachbegriffen wie "Nasenruecken" gesucht —
   den verbietet der Prompt dort aber ausdruecklich ("IMMER mit Alltagsworten,
   NIEMALS mit medizinischen Fachbegriffen"). Die Metrik konnte also gar nicht
   anschlagen. Gemessen wird deshalb, was der Inhaber tatsaechlich verlangt
   hat: ein NACHVOLLZIEHBARES, sichtbares Merkmal statt eines Eindrucks.

   KONKRET: etwas, das man auf dem Foto zeigen kann — im Workshop vorfuehrbar.
   LEERFORMEL: Eindruck ohne Beleg. Genau diese Woerter standen vorher als
   Alters-Achse im Prompt und erzeugen das gegenlaeufige Geschlechtsmuster. */
const MARKER_KONKRET = [
  /z[aä]hne|zahn|gebiss|schneidez/i,
  /wangen|babyspeck/i,
  /\bnase\b|nasen/i,
  /augen|lider|krähenf|krahenf/i,
  /kinn|kiefer|stirn/i,
  /falten|linien|f[aä]ltchen/i,
  /haut(?:textur|bild)?|poren/i,
  /h[aä]nde|handr[uü]cken|hals|venen/i,
  /graue|ergraut|schl[aä]fen/i,
];
const MARKER_LEERFORMEL = [
  /proportion/i,
  /statur|k[oö]rperbau/i,
  /entwicklungsstand|k[oö]rperlich.{0,15}entwicklung|ausgewachsen/i,
  /pubert/i,
  /schulter/i,
  /muskul/i,
  /wirkt (?:jung|reif|erwachsen|jugendlich)/i,
];

/* ────────────────────────────── Infrastruktur ───────────────────────────── */

function loadApiKey() {
  if (process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  try {
    const key = execSync("firebase functions:secrets:access MISTRAL_API_KEY --project=malzime", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!key || key.length < 10) throw new Error("Leerer Secret");
    return key;
  } catch (err) {
    console.error("FEHLER: Kein MISTRAL_API_KEY.", err.message);
    process.exit(1);
  }
}

function loadImages() {
  let files = fs.readdirSync(INPUT_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (process.env.TEST_IMAGES) {
    const wanted = process.env.TEST_IMAGES.split(",").map((s) => s.trim()).filter(Boolean);
    files = files.filter((f) => wanted.includes(f));
  }
  files.sort();

  return files.map((name) => {
    let quelle = path.join(INPUT_DIR, name);

    /* Auflaesungs-Test: per sips verkleinern (macOS-Bordmittel, kein sharp
       noetig). Nur fuer den Richtungstest — die Originale bleiben unberuehrt. */
    if (SCALE_TO > 0) {
      const ziel = path.join(os.tmpdir(), `malzime-${SCALE_TO}-${name}`);
      try {
        execSync(`sips -Z ${SCALE_TO} "${quelle}" --out "${ziel}"`, { stdio: "ignore" });
        quelle = ziel;
      } catch {
        console.warn(`  Warnung: ${name} liess sich nicht skalieren, nehme Original.`);
      }
    }

    const buf = fs.readFileSync(quelle);
    const ext = path.extname(name).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { name, base64: buf.toString("base64"), mime };
  });
}

async function callMistral({ variant, image, runIndex, apiKey }) {
  const dataUrl = `data:${image.mime};base64,${image.base64}`;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /* system/user-Split wie im Live-Cache-Pfad (src/mistral.js). Ohne diesen
     Split liegt die Cache-Quote bei 0 % — der Hebel ist der Split, nicht der
     Schluessel. */
  const systemText = variant === "live" ? LIVE_PROMPT : NEU_PROMPT;
  const set = _BRAND_BLOCKLIST_SETS[runIndex % _BRAND_BLOCKLIST_SETS.length];
  const userContent = [
    { type: "image_url", image_url: dataUrl },
    { type: "text", text: brandBlocklistBlock(set.join(", ")) },
  ];

  const body = {
    /* Je Variante ein eigener Schluessel — ein gemeinsamer wuerde die beiden
       verschiedenen Praefixe gegenseitig aus dem Cache draengen. */
    prompt_cache_key: `malzime-age29-${variant}`,
    model: MODEL,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userContent },
    ],
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    response_format: { type: "json_object" },
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    return { error: `HTTP-Fehler: ${err.message}`, httpMs: Date.now() - start };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return { error: `Mistral ${res.status}: ${errBody.slice(0, 200)}`, httpMs: Date.now() - start };
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const usage = json.usage || {};

  let parsed = null;
  let parseError = null;
  try {
    parsed = parseSafely(text, { requireSchema: false });
    if (!parsed) parseError = "parseSafely lieferte null";
  } catch (err) {
    parseError = err.message;
  }

  return {
    parsed,
    parseError,
    truncated: choice?.finish_reason === "length",
    httpMs: Date.now() - start,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
  };
}

/* ────────────────────────────── Auswertung ──────────────────────────────── */

/* Alle Altersangaben aus dem Text ziehen. Liefert Punktwert UND Spanne —
   die Spanne, weil der Kinderschutz-Filter seit v2.9.0 auf der Untergrenze
   arbeitet und uns deren Breite deshalb interessiert. */
function leseAlter(text) {
  const s = String(text || "").toLowerCase();
  const plausibel = (n) => Number.isFinite(n) && n >= 1 && n <= 100;

  let von = null;
  let bis = null;
  for (const m of s.matchAll(/\b(\d{1,2})\s*(?:[-–—]|bis)\s*(\d{1,2})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (plausibel(a) && plausibel(b) && b >= a) {
      if (von === null || a < von) von = a;
      if (bis === null || b > bis) bis = b;
    }
  }

  const punkt = s.match(/~\s*(\d{1,2})/) || s.match(/etwa\s+(\d{1,2})/);
  let mitte = punkt && plausibel(Number(punkt[1])) ? Number(punkt[1]) : null;
  if (mitte === null && von !== null && bis !== null) mitte = Math.round((von + bis) / 2);
  if (mitte === null) {
    const zahlen = (s.match(/\b\d{1,2}\b/g) || []).map(Number).filter(plausibel);
    mitte = zahlen.length ? zahlen[0] : null;
  }

  return { mitte, von, bis };
}

function leseGeschlecht(text) {
  const s = String(text || "").toLowerCase();
  /* "männlich" enthaelt nicht "weiblich", aber die Reihenfolge zaehlt: Erst
     auf weiblich pruefen, sonst schluckt eine Teilstring-Suche den Fall. */
  if (/\bweiblich|\bm[aä]dchen|\bfrau\b/.test(s)) return "w";
  if (/\bm[aä]nnlich|\bjunge\b|\bmann\b|\bbursche/.test(s)) return "m";
  return null;
}

function zaehleMarker(text, muster) {
  return muster.filter((re) => re.test(String(text || ""))).length;
}

function auswerten(parsed) {
  if (!parsed) return null;
  const hf = parsed.hard_facts?.alter_geschlecht || "";
  const std = parsed.standard?.categories?.alter_geschlecht?.value || "";
  const beast = parsed.beast?.categories?.alter_geschlecht?.value || "";
  /* Begruendungen stehen im hard-facts-Block und im zweiten Satz der Karte —
     beide zusammen sind die Textbasis fuer die Marker-Zaehlung. */
  const begruendung = `${hf} ${std} ${beast}`;

  const alter = leseAlter(`${hf} ${std}`);
  return {
    alter: alter.mitte,
    spanneVon: alter.von,
    spanneBis: alter.bis,
    geschlecht: leseGeschlecht(`${hf} ${std}`),
    markerGut: zaehleMarker(begruendung, MARKER_KONKRET),
    markerReife: zaehleMarker(begruendung, MARKER_LEERFORMEL),
    text: begruendung.slice(0, 400),
  };
}

function mittel(xs) {
  const gefiltert = xs.filter((x) => Number.isFinite(x));
  return gefiltert.length ? gefiltert.reduce((a, b) => a + b, 0) / gefiltert.length : null;
}

function stdabw(xs) {
  const gefiltert = xs.filter((x) => Number.isFinite(x));
  if (gefiltert.length < 2) return null;
  const m = mittel(gefiltert);
  return Math.sqrt(mittel(gefiltert.map((x) => (x - m) ** 2)));
}

function fmt(n, stellen = 1) {
  return Number.isFinite(n) ? n.toFixed(stellen) : "—";
}

/* ────────────────────────────── Ablauf ──────────────────────────────────── */

async function main() {
  const apiKey = loadApiKey();
  const images = loadImages();

  const jobs = [];
  for (const image of images) {
    for (let run = 0; run < RUNS_PER_IMAGE; run++) {
      for (const variant of ["live", "neu"]) {
        jobs.push({ variant, image, runIndex: run });
      }
    }
  }

  console.log(`Bilder: ${images.length}, Laeufe je Bild: ${RUNS_PER_IMAGE}, Calls: ${jobs.length}`);
  if (SCALE_TO > 0) console.log(`AUFLOESUNGS-TEST: alle Bilder auf ${SCALE_TO} px skaliert.`);
  console.log(`Parallel: ${CONCURRENCY}\n`);

  const results = [];
  let fertig = 0;
  let index = 0;

  async function arbeiter() {
    while (index < jobs.length) {
      const job = jobs[index++];
      const antwort = await callMistral({ ...job, apiKey });
      results.push({
        bild: job.image.name,
        variante: job.variant,
        lauf: job.runIndex,
        ...antwort,
        messung: auswerten(antwort.parsed),
      });
      fertig++;
      if (fertig % 5 === 0 || fertig === jobs.length) {
        console.log(`  ${fertig}/${jobs.length} fertig`);
      }
    }
  }

  const start = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, arbeiter));
  const dauerMin = (Date.now() - start) / 60000;

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
  fs.writeFileSync(OUTPUT_REPORT, bauReport(results, dauerMin));
  console.log(`\nFertig in ${fmt(dauerMin)} min.`);
  console.log(`  Rohdaten: ${OUTPUT_JSON}`);
  console.log(`  Bericht:  ${OUTPUT_REPORT}`);
  console.log(`\n${zusammenfassung(results)}`);
}

function proVariante(results, variante) {
  return results.filter((r) => r.variante === variante && r.messung && !r.error);
}

/* Kennzahlen je Variante — hier steckt die eigentliche Auswertung. */
function kennzahlen(results, variante) {
  const rs = proVariante(results, variante);
  const alle = [];
  const kinder = [];
  const erwachsene = [];
  const jungen = [];
  const maedchen = [];
  let geschlechtRichtig = 0;
  let geschlechtGesamt = 0;
  const spannenBreite = [];

  for (const r of rs) {
    const wahr = GROUND_TRUTH[r.bild];
    if (!wahr) continue;
    const m = r.messung;

    if (Number.isFinite(m.alter)) {
      /* MIT Vorzeichen: positiv = zu alt geschaetzt. Genau das ist die Frage. */
      const abw = m.alter - wahr.age;
      alle.push(abw);
      (wahr.age < 18 ? kinder : erwachsene).push(abw);
      if (wahr.age < 18) (wahr.gender === "m" ? jungen : maedchen).push(abw);
    }
    if (m.geschlecht) {
      geschlechtGesamt++;
      if (m.geschlecht === wahr.gender) geschlechtRichtig++;
    }
    if (Number.isFinite(m.spanneVon) && Number.isFinite(m.spanneBis)) {
      spannenBreite.push(m.spanneBis - m.spanneVon);
    }
  }

  /* Streuung: je Bild ueber die Laeufe, dann gemittelt. Braucht keine
     Wahrheitsliste und zeigt, ob die Schaetzung stabiler geworden ist. */
  const proBild = {};
  for (const r of rs) {
    if (!Number.isFinite(r.messung.alter)) continue;
    (proBild[r.bild] ||= []).push(r.messung.alter);
  }
  const streuungen = Object.values(proBild).map(stdabw).filter(Number.isFinite);

  const mitMarkern = rs.filter((r) => r.messung.markerGut > 0).length;
  const mitReife = rs.filter((r) => r.messung.markerReife > 0).length;

  return {
    n: rs.length,
    abwAlle: mittel(alle.map(Math.abs)),
    biasAlle: mittel(alle),
    abwKinder: mittel(kinder.map(Math.abs)),
    biasKinder: mittel(kinder),
    abwErwachsene: mittel(erwachsene.map(Math.abs)),
    biasErwachsene: mittel(erwachsene),
    biasJungen: mittel(jungen),
    biasMaedchen: mittel(maedchen),
    nJungen: jungen.length,
    nMaedchen: maedchen.length,
    geschlechtQuote: geschlechtGesamt ? (geschlechtRichtig / geschlechtGesamt) * 100 : null,
    streuung: mittel(streuungen),
    spanneBreite: mittel(spannenBreite),
    markerQuote: rs.length ? (mitMarkern / rs.length) * 100 : null,
    reifeQuote: rs.length ? (mitReife / rs.length) * 100 : null,
    parseFehler: results.filter((r) => r.variante === variante && (r.parseError || r.error)).length,
    truncated: results.filter((r) => r.variante === variante && r.truncated).length,
    promptTokens: results
      .filter((r) => r.variante === variante)
      .reduce((a, r) => a + (r.promptTokens || 0), 0),
    completionTokens: results
      .filter((r) => r.variante === variante)
      .reduce((a, r) => a + (r.completionTokens || 0), 0),
    cachedTokens: results
      .filter((r) => r.variante === variante)
      .reduce((a, r) => a + (r.cachedTokens || 0), 0),
  };
}

function kostenEuro(k) {
  const ungecacht = Math.max(0, k.promptTokens - k.cachedTokens);
  const usd =
    (ungecacht / 1e6) * PREIS_IN +
    (k.cachedTokens / 1e6) * PREIS_IN * 0.1 +
    (k.completionTokens / 1e6) * PREIS_OUT;
  return usd * USD_ZU_EUR;
}

function zusammenfassung(results) {
  const l = kennzahlen(results, "live");
  const n = kennzahlen(results, "neu");
  return [
    "KURZFASSUNG",
    `  Abweichung Kinder:    live ${fmt(l.abwKinder)} -> neu ${fmt(n.abwKinder)} Jahre`,
    `  Richtung Jungen:      live ${fmt(l.biasJungen)} -> neu ${fmt(n.biasJungen)} (+ = zu alt)`,
    `  Richtung Maedchen:    live ${fmt(l.biasMaedchen)} -> neu ${fmt(n.biasMaedchen)}`,
    `  Gute Marker genannt:  live ${fmt(l.markerQuote, 0)} % -> neu ${fmt(n.markerQuote, 0)} %`,
    `  Reife-Woerter:        live ${fmt(l.reifeQuote, 0)} % -> neu ${fmt(n.reifeQuote, 0)} %`,
  ].join("\n");
}

function bauReport(results, dauerMin) {
  const l = kennzahlen(results, "live");
  const n = kennzahlen(results, "neu");
  const zeile = (name, a, b, einheit = "") =>
    `| ${name} | ${fmt(a)}${einheit} | ${fmt(b)}${einheit} |`;

  return `# Altersschätzung — Live gegen v2.9.0-Merkmalsraster

Lauf über ${fmt(dauerMin)} Minuten, ${RUNS_PER_IMAGE} Läufe je Bild${SCALE_TO ? `, Bilder auf ${SCALE_TO} px skaliert` : ""}.
Modell ${MODEL}. Wahrheitsliste: \`compare-input/ground-truth.json\` (am 2026-08-10 geprüft und korrigiert).

## Wie belastbar ist das hier?

**Die Alterszahlen sind ein erster Eindruck, kein Beweis.** Im Testset stecken
nur 6 Minderjährige, 3 je Geschlecht. Ein einzelnes Bild kippt den Mittelwert.
Die Beobachtung aus rund 5000 Workshop-Analysen — Mädchen zu alt, Jungen zu
jung — lässt sich damit weder bestätigen noch widerlegen. Belastbare Zahlen
liefert erst das Erfassungsblatt aus dem Workshop.

**Belastbar ist die Begründungs-Metrik.** Sie zählt, woran das Modell seine
Schätzung festmacht, und braucht dafür keine Wahrheitsliste. Genau darum ging
es bei der Änderung: nicht um einen Ausgleich, sondern um nachvollziehbare
Merkmale.

## Begründung — die belastbare Größe

| Größe | Live | v2.9.0 |
|---|---|---|
${zeile("Antworten mit konkretem, zeigbarem Merkmal", l.markerQuote, n.markerQuote, " %")}
${zeile("Antworten mit Leerformel", l.reifeQuote, n.reifeQuote, " %")}

**Konkret** heißt: etwas, das man auf dem Foto zeigen kann — Zähne, Wangen,
Nase, Augenpartie, Kinn, Falten, Hautbild, Hände, Hals, graue Schläfen.
**Leerformel** heißt: ein Eindruck ohne Beleg — „ausgewachsene Proportionen",
„jugendliche Statur", „wirkt reif", „fehlende Pubertätsmerkmale".

Das ist die Größe, auf die es ankommt: Der Prompt verlangt in der Ausgabe
ausdrücklich Alltagssprache statt Fachbegriffe, deshalb wird hier nicht nach
„Nasenrücken" gesucht, sondern danach, ob überhaupt etwas Sichtbares benannt
wird. Eine Begründung, die man im Workshop vorlesen und am Bild zeigen kann,
ist auch dann etwas wert, wenn die Zahl daneben liegt.

## Altersabweichung — erster Eindruck

| Größe | Live | v2.9.0 |
|---|---|---|
${zeile("Abweichung gesamt (Betrag)", l.abwAlle, n.abwAlle, " J")}
${zeile("Abweichung Kinder/Jugendliche", l.abwKinder, n.abwKinder, " J")}
${zeile("Abweichung Erwachsene", l.abwErwachsene, n.abwErwachsene, " J")}

### Richtung des Fehlers (+ = zu alt geschätzt, − = zu jung)

| Gruppe | Live | v2.9.0 |
|---|---|---|
${zeile(`Jungen (n=${l.nJungen})`, l.biasJungen, n.biasJungen, " J")}
${zeile(`Mädchen (n=${l.nMaedchen})`, l.biasMaedchen, n.biasMaedchen, " J")}
${zeile("Erwachsene", l.biasErwachsene, n.biasErwachsene, " J")}

Erwartung aus der Praxis: Live sollte bei Mädchen deutlich positiv (zu alt) und
bei Jungen negativ (zu jung) liegen. Wenn v2.9.0 wirkt, rücken beide Richtung
null — **ohne** dass jemand einen Ausgleich in den Prompt geschrieben hätte.

## Weitere Größen

| Größe | Live | v2.9.0 |
|---|---|---|
${zeile("Geschlecht richtig", l.geschlechtQuote, n.geschlechtQuote, " %")}
${zeile("Streuung je Bild über die Läufe", l.streuung, n.streuung, " J")}
${zeile("Breite der Altersspanne", l.spanneBreite, n.spanneBreite, " J")}

Die Spannenbreite zählt seit v2.9.0 doppelt: Der Kinderschutz-Filter arbeitet
auf der **Untergrenze**. Breitere Spannen schützen mehr Kinder — und kosten bei
jungen Erwachsenen ein paar legitime Werbebeispiele.

## Wächter

| Größe | Live | v2.9.0 |
|---|---|---|
| Auswertbare Antworten | ${l.n} | ${n.n} |
| Parse-Fehler | ${l.parseFehler} | ${n.parseFehler} |
| Abgeschnittene Antworten | ${l.truncated} | ${n.truncated} |
| Eingabe-Tokens | ${l.promptTokens} | ${n.promptTokens} |
| davon aus dem Cache | ${l.cachedTokens} | ${n.cachedTokens} |
| Ausgabe-Tokens | ${l.completionTokens} | ${n.completionTokens} |
| Kosten des Laufs | ${fmt(kostenEuro(l), 2)} € | ${fmt(kostenEuro(n), 2)} € |

## Einzelwerte je Bild

| Bild | echt | Live | v2.9.0 |
|---|---|---|---|
${Object.keys(GROUND_TRUTH)
  .filter((k) => !k.startsWith("_"))
  .map((bild) => {
    const w = GROUND_TRUTH[bild];
    const werte = (v) =>
      proVariante(results, v)
        .filter((r) => r.bild === bild && Number.isFinite(r.messung.alter))
        .map((r) => r.messung.alter);
    const a = werte("live");
    const b = werte("neu");
    const g = w.gender === "m" ? "m" : "w";
    return `| ${bild} | ${g}, ${w.age} | ${a.length ? fmt(mittel(a)) : "—"} | ${b.length ? fmt(mittel(b)) : "—"} |`;
  })
  .join("\n")}
`;
}

main().catch((err) => {
  console.error("Abbruch:", err);
  process.exit(1);
});
