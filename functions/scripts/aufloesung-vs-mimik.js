#!/usr/bin/env node
"use strict";

/**
 * aufloesung-vs-mimik.js — Trennt zwei Erklaerungen fuer den Alters-Fehler bei
 * Erwachsenen an EINEM Foto mit bekanntem Alter.
 *
 * ADDITIV / TEST-ONLY. Kein Produktionscode, kein Firestore, kein Deploy.
 *
 * DIE FRAGE:
 * Das Foto zeigt eine 44-jaehrige Person, breit laechelnd, Ganzkoerper. Live
 * schaetzt darauf 32. Zwei Erklaerungen standen im Raum:
 *   A) AUFLOESUNG — das Gesicht ist klein im Bild, nach der Verkleinerung auf
 *      1280 px bleiben zu wenige Pixel fuer feine Linien.
 *   B) MIMIK-REGEL — der Prompt zaehlt Falten nur, wenn sie "auch bei
 *      entspanntem Gesicht" sichtbar sind. Auf Fotos wird aber gelaechelt,
 *      also greift die Regel nie, und das Modell faellt auf "glatte Haut =
 *      28-35" zurueck.
 *
 * Ein Test ueber sieben Fotos bei halber Aufloesung (640 px) aenderte fast
 * nichts — das spricht gegen A. Aber er misst nur nach UNTEN. Dieser Lauf
 * macht die Gegenprobe nach OBEN und kreuzt beide Achsen:
 *
 *            | Prompt live      | Prompt neu (mit Mimik-Regel)
 *   1280 px  | Ausgangslage     | wirkt die Regel?
 *   voll     | wirkt Aufloesung?| beides zusammen
 *
 * So laesst sich zuordnen, welcher Faktor traegt — und ob sie sich addieren.
 *
 * Aufruf:
 *   MISTRAL_API_KEY=<key> node functions/scripts/aufloesung-vs-mimik.js
 *   PFLICHT:  BILD=<datei.jpg> ECHTES_ALTER=<zahl>   Optional: RUNS=3
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { parseSafely } = require("../src/json-repair");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "compare-input");

const BILD = process.env.BILD || "";
const ECHTES_ALTER = Number(process.env.ECHTES_ALTER || 0);
const RUNS = Number(process.env.RUNS || 3);

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-large-2512";

const NEU = require("../src/locales/de/prompts").singleLargePrompt;
const { brandBlocklistBlock } = require("../src/locales/de/prompts");
const { _BRAND_BLOCKLIST_SETS } = require("../src/mistral");

const LIVE = (() => {
  const tmp = path.join(os.tmpdir(), `malzime-live-${process.pid}.js`);
  const quelle = execSync("git show HEAD:functions/src/locales/de/prompts.js", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  fs.writeFileSync(tmp, quelle);
  const m = require(tmp);
  fs.unlinkSync(tmp);
  return m.singleLargePrompt;
})();

function apiKey() {
  if (process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  return (() => { throw new Error("MISTRAL_API_KEY muss ausdruecklich gesetzt werden — dieses Skript holt den Produktivschluessel nicht mehr von selbst (Audit 2026-08-10, OSS-002)."); })().trim();
}

/* Die Produktion verkleinert im Browser auf 1280 px lange Kante bei 82 %
   Qualitaet (public/js/exif.js). "voll" laesst das Original unangetastet. */
function bildDaten(px) {
  const quelle = path.join(INPUT_DIR, BILD);
  if (!px) return fs.readFileSync(quelle).toString("base64");
  const ziel = path.join(os.tmpdir(), `malzime-${px}-${BILD}`);
  execSync(`sips -Z ${px} "${quelle}" --out "${ziel}"`, { stdio: "ignore" });
  return fs.readFileSync(ziel).toString("base64");
}

function leseAlter(text) {
  const s = String(text || "").toLowerCase();
  const p = s.match(/~\s*(\d{1,2})/) || s.match(/etwa\s+(\d{1,2})/);
  if (p) return Number(p[1]);
  const z = (s.match(/\b\d{1,2}\b/g) || []).map(Number).filter((n) => n >= 1 && n <= 100);
  return z.length ? z[0] : null;
}

async function einCall(systemText, base64, runIndex, key) {
  const set = _BRAND_BLOCKLIST_SETS[runIndex % _BRAND_BLOCKLIST_SETS.length];
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt_cache_key: `malzime-aufl-${systemText === LIVE ? "live" : "neu"}`,
      model: MODEL,
      messages: [
        { role: "system", content: systemText },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: `data:image/jpeg;base64,${base64}` },
            { type: "text", text: brandBlocklistBlock(set.join(", ")) },
          ],
        },
      ],
      max_tokens: 8000,
      temperature: 0.5,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return { fehler: `${res.status}: ${(await res.text()).slice(0, 120)}` };

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || "";
  const parsed = parseSafely(text, { requireSchema: false });
  const hf = parsed?.hard_facts?.alter_geschlecht || "";
  const karte = parsed?.standard?.categories?.alter_geschlecht?.value || "";
  return {
    alter: leseAlter(hf || karte),
    begruendung: karte.slice(0, 190),
    promptTokens: json.usage?.prompt_tokens || 0,
  };
}

async function main() {
  const key = apiKey();
  const zellen = [
    { name: "live @1280", prompt: LIVE, px: 1280 },
    { name: "neu  @1280", prompt: NEU, px: 1280 },
    { name: "live @voll", prompt: LIVE, px: 0 },
    { name: "neu  @voll", prompt: NEU, px: 0 },
  ];

  console.log(`Foto: ${BILD}, tatsaechliches Alter: ${ECHTES_ALTER}, ${RUNS} Laeufe je Zelle\n`);
  const ergebnis = [];

  /* Alle Zellen gleichzeitig statt nacheinander. Sequenziell dauerte der Lauf
     ueber zehn Minuten, ohne dass zwischendurch etwas zu sehen war. Zwoelf
     parallele Anfragen liegen unter dem Limit von mistral-large (15/min). */
  const laeufe = zellen.flatMap((z, zi) =>
    Array.from({ length: RUNS }, (_, i) => ({ z, zi, i })),
  );
  const roh = await Promise.all(
    laeufe.map(async ({ z, zi, i }) => {
      const r = await einCall(z.prompt, bildDaten(z.px), i, key);
      if (r.fehler) console.log(`  ${z.name} Lauf ${i + 1}: FEHLER ${r.fehler}`);
      return { zi, ...r };
    }),
  );

  for (let zi = 0; zi < zellen.length; zi++) {
    const z = zellen[zi];
    const meine = roh.filter((r) => r.zi === zi && !r.fehler);
    const alter = meine.map((r) => r.alter).filter(Number.isFinite);
    const tokens = meine.length
      ? Math.round(meine.reduce((a, r) => a + (r.promptTokens || 0), 0) / meine.length)
      : 0;
    const schnitt = alter.length ? alter.reduce((a, b) => a + b, 0) / alter.length : null;
    ergebnis.push({ ...z, schnitt, alter, tokens, beispiel: meine[0]?.begruendung || "" });
    console.log(
      `  ${z.name}: ${schnitt === null ? "—" : schnitt.toFixed(1)} Jahre  ` +
        `(${alter.join(", ")})  ${tokens} Eingabe-Tokens`,
    );
  }

  console.log(`\n${"Zelle".padEnd(12)}${"Schaetzung".padEnd(13)}${"Abweichung".padEnd(13)}Tokens`);
  console.log("-".repeat(52));
  for (const e of ergebnis) {
    const abw = e.schnitt === null ? "—" : (e.schnitt - ECHTES_ALTER).toFixed(1);
    console.log(
      e.name.padEnd(12) +
        (e.schnitt === null ? "—" : e.schnitt.toFixed(1)).padEnd(13) +
        String(abw).padEnd(13) +
        e.tokens,
    );
  }
  console.log("\nBegruendungen:");
  for (const e of ergebnis) console.log(`  ${e.name}: ${e.beispiel}`);
}

main().catch((e) => {
  console.error("Abbruch:", e.message);
  process.exit(1);
});
