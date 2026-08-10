#!/usr/bin/env node
"use strict";

/**
 * beast-ads-secondcall-prototype.js — Prototyp fuer einen zweiten, kleinen
 * Aufruf, der NUR die Beast-Werbung erzeugt.
 *
 * TEST-ONLY / ADDITIV. Kein Produktionscode, keine Pipeline-Aenderung.
 *
 * WARUM: Fuenf A/B-Messungen haben gezeigt, dass der gemeinsame Aufruf die
 * Aufgabe nicht loest. Die Beast-Werbung bleibt in der Produktwelt des Fotos —
 * beim Rad-Foto kommen Fahrradteile mit "Abo" dran, statt Anti-Aging oder
 * Vorsorge, obwohl der Beast-Text "kaempft gegen die Zeit" sagt. Das Bild liegt
 * vor dem Modell und ueberstrahlt jede Textanweisung.
 *
 * IDEE: Ein zweiter Aufruf bekommt KEIN Bild, sondern nur den fertigen
 * Beast-Text. Die Ablenkung existiert dort nicht.
 *
 * METHODE: Gepaarter Vergleich gegen vorhandene Daten. Aus den Rohdaten des
 * letzten A/B-Laufs werden die LIVE-Profile genommen (also das, was der
 * Produktionsprompt heute erzeugt) und deren Verletzlichkeits-Text durch den
 * Mini-Aufruf geschickt. Alte und neue Werbung stehen damit fuer exakt dieselbe
 * Person nebeneinander — ohne Streuung durch neue Bildanalysen.
 *
 * Aufruf:
 *   MISTRAL_API_KEY=<key> node functions/scripts/beast-ads-secondcall-prototype.js
 *   Optional: MODEL=mistral-small-2603  (Default: mistral-large-2512)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { parseSafely } = require("../src/json-repair");

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT = path.join(REPO_ROOT, "ab-test-v4-vuln-results.json");
const OUTPUT = path.join(REPO_ROOT, "secondcall-prototype-report.md");

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MODEL = process.env.MODEL || "mistral-large-2512";
const TIMEOUT_MS = 60_000;

function loadApiKey() {
  if (process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  const key = execSync("firebase functions:secrets:access MISTRAL_API_KEY --project=malzime", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!key || key.length < 10) throw new Error("Kein MISTRAL_API_KEY");
  return key;
}

/* Der komplette Prompt des Zweitaufrufs — bewusst kurz. Er hat genau EINE
   Aufgabe und keine Konkurrenz durch 13 Karten, Altersschaetzung und Bild. */
function buildPrompt(profil) {
  return `Du bist der Werbe-Algorithmus eines Tech-Konzerns. Du bekommst ein fertiges Profil einer Person und erzeugst daraus die Werbeliste, die ihre Schwachstelle ausnutzt.

═══ DAS PROFIL ═══

Alter/Geschlecht: ${profil.alter}
Verletzlichkeit: ${profil.verletzlichkeit}
Gesundheit: ${profil.gesundheit}
Kaufkraft: ${profil.kaufkraft}

Zusammenfassung: ${profil.profileText}

Diese Werbung bekommt die Person bereits im neutralen Modus — sie zeigt den sichtbaren Lebensstil:
${profil.standardAds.join(", ")}

═══ DEINE AUFGABE ═══

Erzeuge 6-8 Werbeeinträge, die an der VERLETZLICHKEIT ansetzen, nicht am Hobby.

- Lies den Verletzlichkeits-Satz. Genau dort setzt du an.
  Steht dort „kämpft gegen das Altern": Anti-Aging, Regeneration, Vorsorge, Nahrungsergänzung.
  Steht dort „Statusdruck": Statussymbole über Budget, Ratenzahlung, Premium-Mitgliedschaften.
  Steht dort „Bestätigungssucht" oder „Einsamkeit": Dating-Abos, Coaching, Selbstoptimierung.
  Steht dort „Suchtanfälligkeit": Lootboxen, Sammelzwang, Micro-Transactions.
- MINDESTENS 5 Einträge kommen aus einer ANDEREN Branche als die neutrale Liste oben. Wenn dort Sportartikel stehen, kommen hier Pharma, Versicherung, Finanz, Beauty oder Coaching.
- KEINE Marke aus der neutralen Liste oben wiederverwenden.
- Je 1-3 Wörter. Echte Marken aus dem mitteleuropäischen Markt. Keine Preisangaben.
- Bei Minderjährigen KEINE Angebote zu Alkohol, Glücksspiel, Kredit, Diät oder Schönheitskorrektur — stattdessen In-App-Käufe, Lootboxen, Gaming-Abos, Sammelkarten, Influencer-Merch.

Antworte NUR mit JSON: {"ad_targeting": ["...", "..."]}`;
}

async function callMistral(prompt, apiKey) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        /* Der Anweisungsteil ist bei jedem Aufruf gleich, nur das Profil
           dahinter wechselt — damit ist der Anfang cachebar. */
        prompt_cache_key: `malzime-secondcall-${MODEL}`,
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || "";
    const parsed = parseSafely(text, { requireSchema: false });
    return {
      ads: Array.isArray(parsed?.ad_targeting) ? parsed.ad_targeting : [],
      inTok: json.usage?.prompt_tokens || 0,
      outTok: json.usage?.completion_tokens || 0,
    };
  } catch (err) {
    clearTimeout(t);
    return { error: err.message };
  }
}

/* ── Bewertung: dieselben Massstaebe wie im A/B-Runner ── */
const MECHANIK =
  /\babo\b|abonnement|subscription|membership|mitgliedschaft|raten|finanzierung|kredit|anti.?ag|falten|verj[uü]ng|serum|nahrungserg|supplement|vitamin|kollagen|versicherung|vorsorge|police|berufsunf|rente|lootbox|sammelkart|blind.?box|mystery|[uü]berraschungsei|coaching|kurs|programm|di[aä]t|slim|detox|abnehm|wett|casino|gl[uü]cksspiel|in.?app|premium.?pass/i;

const THEMEN = {
  rad_outdoor:
    /bike|rad|fahrrad|trail|mtb|schwalbe|deuter|vaude|evoc|ortlieb|osprey|assos|endura|mavic|sattel|helm|trikot|outdoor|wander|camping|salomon|haglöfs|gore/i,
  fitness: /fitness|gym|lauf|running|workout|whoop|garmin|polar|foam.?roller|hantel|protein|strava|sufferfest/i,
  beauty: /beauty|kosmetik|make.?up|lippen|mascara|nyx|maybelline|kiko|glossy|nivea|serum|pflege|loreal|l.oréal/i,
  mode: /shein|zara|h&m|primark|zalando|asos|boohoo|temu|c&a|esprit|kleid|shirt|jeans|sneaker/i,
  gaming: /gaming|playstation|xbox|nintendo|switch|roblox|fortnite|steam|minecraft/i,
  spielzeug: /lego|playmobil|barbie|nerf|puppe|spielzeug|schleich|ravensburger|hama/i,
  medien: /netflix|spotify|disney|streaming|kindle|thalia|buch/i,
  finanz: /kredit|versicherung|bank|klarna|raten|vorsorge|allianz|rente|police|generali|uniqa/i,
  pharma: /apotheke|orthomol|doppelherz|centrum|abtei|pharma|vitamin|kollagen/i,
};

function themen(list) {
  const out = new Set();
  for (const e of list) for (const [n, re] of Object.entries(THEMEN)) if (re.test(String(e))) out.add(n);
  return out;
}

function ueberlappung(a, b) {
  if (!a.size && !b.size) return null;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
}

function marke(s) {
  return String(s || "").toLowerCase().replace(/[„""».,()]/g, " ").trim().split(/\s+/)[0] || "";
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`FEHLER: ${INPUT} nicht gefunden — erst einen A/B-Lauf fahren.`);
    process.exit(1);
  }
  const apiKey = loadApiKey();
  const daten = JSON.parse(fs.readFileSync(INPUT, "utf8"));

  /* Pro Bild EIN Live-Profil (das, was die Produktion heute erzeugt) */
  const proBild = new Map();
  for (const r of daten.results) {
    if (r.variant !== "live" || !r.parsed?.beast?.categories) continue;
    if (proBild.has(r.image)) continue;
    const b = r.parsed.beast;
    const top = Array.isArray(r.parsed.ad_targeting) ? r.parsed.ad_targeting : [];
    proBild.set(r.image, {
      image: r.image,
      alter: r.parsed.hard_facts?.alter_geschlecht || "",
      verletzlichkeit: b.categories.verletzlichkeit?.value || "",
      gesundheit: b.categories.gesundheit?.value || "",
      kaufkraft: b.categories.kaufkraft?.value || "",
      profileText: (b.profileText || "").slice(0, 700),
      standardAds: Array.isArray(r.parsed.standard?.ad_targeting) ? r.parsed.standard.ad_targeting : top,
      alteBeastAds: Array.isArray(b.ad_targeting) ? b.ad_targeting : top,
    });
  }

  const profile = [...proBild.values()];
  console.log(`${profile.length} Live-Profile geladen. Modell: ${MODEL}\n`);

  let zeilen = [];
  let mechAlt = 0,
    mechNeu = 0,
    nAlt = 0,
    nNeu = 0;
  let ovAlt = [],
    ovNeu = [];
  let inTok = 0,
    outTok = 0;

  for (const p of profile) {
    const r = await callMistral(buildPrompt(p), apiKey);
    if (r.error) {
      console.log(`${p.image} — FEHLER ${r.error}`);
      continue;
    }
    inTok += r.inTok;
    outTok += r.outTok;

    const tStd = themen(p.standardAds);
    const oAlt = ueberlappung(tStd, themen(p.alteBeastAds));
    const oNeu = ueberlappung(tStd, themen(r.ads));
    if (oAlt !== null) ovAlt.push(oAlt);
    if (oNeu !== null) ovNeu.push(oNeu);

    mechAlt += p.alteBeastAds.filter((e) => MECHANIK.test(String(e))).length;
    nAlt += p.alteBeastAds.length;
    mechNeu += r.ads.filter((e) => MECHANIK.test(String(e))).length;
    nNeu += r.ads.length;

    /* Markenwiederverwendung gegen die neutrale Liste */
    const stdMarken = new Set(p.standardAds.map(marke));
    const wieder = r.ads.filter((e) => stdMarken.has(marke(e))).length;

    console.log(`${p.image}`);
    console.log(`  alt : ${p.alteBeastAds.join(" | ")}`);
    console.log(`  NEU : ${r.ads.join(" | ")}`);
    console.log(`  Mechanik ${r.ads.filter((e) => MECHANIK.test(String(e))).length}/${r.ads.length}  Marken-Wiederverwendung ${wieder}\n`);

    zeilen.push({ image: p.image, alt: p.alteBeastAds, neu: r.ads, wieder, verletzlichkeit: p.verletzlichkeit });
  }

  const mid = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const pct = (v) => (v === null ? "n/a" : (v * 100).toFixed(1) + "%");
  const kosten = ((inTok / 1e6) * 2 + (outTok / 1e6) * 6) * 0.92;

  const report = `# Prototyp: zweiter Aufruf nur fuer die Beast-Werbung

Modell ${MODEL} · ${zeilen.length} Profile · max. ${kosten.toFixed(3)} EUR (real ~halb so viel)

Gepaarter Vergleich: dieselben Live-Profile, einmal die Werbung aus dem
gemeinsamen Aufruf (alt), einmal aus dem separaten Aufruf ohne Bild (NEU).

| Messwert | alt (ein Aufruf) | NEU (zweiter Aufruf) |
|---|---|---|
| Eintraege mit Verwertungsmechanik | ${pct(nAlt ? mechAlt / nAlt : null)} | **${pct(nNeu ? mechNeu / nNeu : null)}** |
| Produktwelt-Ueberlappung mit der neutralen Liste | ${pct(mid(ovAlt))} | **${pct(mid(ovNeu))}** |
| Marken-Wiederverwendung aus der neutralen Liste | – | ${zeilen.reduce((a, z) => a + z.wieder, 0)} von ${nNeu} |
| Ø Tokens je Aufruf | – | ${Math.round((inTok + outTok) / Math.max(1, zeilen.length))} |

Die Produktwelt-Ueberlappung ist hier die entscheidende Zeile: Sie zeigt, ob die
Beast-Werbung die Welt des Fotos verlaesst. Genau daran ist der gemeinsame
Aufruf in fuenf Messungen gescheitert.

---

## Einzelvergleiche

${zeilen
  .map(
    (z) => `### ${z.image}
*Verletzlichkeit:* ${z.verletzlichkeit}

- **alt:** ${z.alt.join(" | ")}
- **NEU:** ${z.neu.join(" | ")}`,
  )
  .join("\n\n")}
`;

  fs.writeFileSync(OUTPUT, report);
  console.log(`\nReport: ${OUTPUT}`);
  console.log(`Mechanik  alt ${pct(nAlt ? mechAlt / nAlt : null)} -> NEU ${pct(nNeu ? mechNeu / nNeu : null)}`);
  console.log(`Produktwelt-Ueberlappung  alt ${pct(mid(ovAlt))} -> NEU ${pct(mid(ovNeu))}`);
}

main().catch((err) => {
  console.error("Unerwarteter Fehler:", err);
  process.exit(1);
});
