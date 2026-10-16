/**
 * Wertet die dauerhaften Zaehler aus (Sammlung `statistik`, functions/src/statistik.js)
 * — NUR LESEND.
 *
 * Aufruf:
 *   node scripts/zaehler-auswerten.js tag 2026-10-16
 *   node scripts/zaehler-auswerten.js bloecke 2026-10-16
 *   node scripts/zaehler-auswerten.js vergleich 2026-10-14 2026-10-15..2026-10-16
 *
 *   tag        ein Wiener Tag: Summen, Klassen, Browser-Fehler, Textmenge der KI
 *   bloecke    die Bloecke eines Tages: aktive 10-Minuten-Fenster, getrennt bei
 *              einer Luecke von MEHR als 30 Minuten (genau 30 Minuten: derselbe Block)
 *   vergleich  zwei Zeitraeume nebeneinander; ein Zeitraum ist ein Tag oder
 *              "von..bis" (beide Tage eingeschlossen)
 *
 * Woher gelesen wird:
 *   ohne Angabe                 die echte Datenbank malzime-eu (gcloud-Anmeldung,
 *                               Application Default Credentials)
 *   FIRESTORE_EMULATOR_HOST=... der Emulator
 *   --datei <json>              eine Liste von Dokumenten [{ "id": ..., ...Felder }]
 *                               (Proben und Tests, ganz ohne Datenbank)
 *
 * Rueckgabe: 0 = ausgewertet · 2 = nicht messbar (Aufruf falsch, Datenbank
 * nicht lesbar). Ein Zeitraum ohne Zaehler ist KEIN Fehler, wird aber
 * ausdruecklich als "keine Zaehler" ausgegeben — leer heisst hier nie "alles gut".
 *
 * Achtung: Auftraege zaehlt der Aufraeumdienst erst, wenn er sie loescht —
 * abgeholte nach rund 15 Minuten, alle anderen nach rund 2 Stunden. Die
 * juengsten zwei Stunden sind deshalb noch unvollstaendig (Hinweis in der Ausgabe).
 */
"use strict";

const pfad = require("path");
const fs = require("fs");

const FENSTER_MS = 10 * 60 * 1000;
const LUECKE_MS = 30 * 60 * 1000;
const UNVOLLSTAENDIG_MS = 2 * 60 * 60 * 1000;
const KLASSEN = ["unter30s", "unter1min", "unter2min", "unter4min", "unter8min", "laenger"];
const KLASSEN_TEXT = {
  unter30s: "< 30 s",
  unter1min: "< 1 min",
  unter2min: "< 2 min",
  unter4min: "< 4 min",
  unter8min: "< 8 min",
  laenger: ">= 8 min",
};

/* ── Wiener Zeit ─────────────────────────────────────────────────────────── */

const TEILE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function wienerTeile(ms) {
  const t = {};
  for (const { type, value } of TEILE.formatToParts(new Date(ms))) t[type] = value;
  return t;
}

/** Abstand Wien minus UTC in ms zum Zeitpunkt `ms`. */
function wienOffsetMs(ms) {
  const t = wienerTeile(ms);
  return Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second) - Math.floor(ms / 1000) * 1000;
}

/** UTC-Zeitpunkt der Wiener Mitternacht am Datum "JJJJ-MM-TT". */
function wienerMitternacht(datum) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) throw new Error(`Datum "${datum}" ist nicht JJJJ-MM-TT`);
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const erst = utc - wienOffsetMs(utc);
  return utc - wienOffsetMs(erst);
}

function naechsterTag(datum) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-16" oder "2026-10-14..2026-10-16" -> { von, bis (ms, ausschliesslich), tage, name } */
function zeitraum(angabe) {
  const [a, b] = String(angabe || "").split("..");
  const erster = a;
  const letzter = b || a;
  if (wienerMitternacht(letzter) < wienerMitternacht(erster))
    throw new Error(`Zeitraum "${angabe}" laeuft rueckwaerts`);
  const tage = [];
  for (let d = erster; d <= letzter; d = naechsterTag(d)) tage.push(d);
  return { von: wienerMitternacht(erster), bis: wienerMitternacht(naechsterTag(letzter)), tage, name: angabe };
}

function uhrzeit(ms) {
  const t = wienerTeile(ms);
  return `${t.hour}:${t.minute}`;
}

/* ── Rechnen ─────────────────────────────────────────────────────────────── */

function addiereIn(ziel, quelle) {
  for (const [k, v] of Object.entries(quelle || {})) {
    if (k === "art" || k === "beginn" || k === "tag") continue;
    if (typeof v === "number") ziel[k] = (ziel[k] || 0) + v;
    else if (v && typeof v === "object") addiereIn((ziel[k] = ziel[k] || {}), v);
  }
  return ziel;
}

const summe = (obj) => Object.values(obj || {}).reduce((s, v) => s + (typeof v === "number" ? v : summe(v)), 0);

function aktiv(fenster) {
  return (fenster.eingereiht || 0) > 0 || summe(fenster.abgewiesen) > 0;
}

/**
 * Bloecke aus Fenstern: aktive Fenster nach Beginn sortiert; ein neuer Block
 * beginnt, wenn zwischen dem Ende des vorigen und dem Beginn des naechsten
 * aktiven Fensters MEHR als 30 Minuten liegen.
 */
function bloecke(fensterListe) {
  const sortiert = fensterListe.filter(aktiv).sort((a, b) => a.beginn - b.beginn);
  const aus = [];
  for (const f of sortiert) {
    const letzter = aus[aus.length - 1];
    if (letzter && f.beginn - letzter.bis <= LUECKE_MS) {
      letzter.bis = f.beginn + FENSTER_MS;
      letzter.fenster.push(f);
      addiereIn(letzter.summe, f);
    } else {
      aus.push({ von: f.beginn, bis: f.beginn + FENSTER_MS, fenster: [f], summe: addiereIn({}, f) });
    }
  }
  return aus;
}

/* ── Lesen ───────────────────────────────────────────────────────────────── */

async function quelleOeffnen(dateiPfad) {
  if (dateiPfad) {
    const docs = JSON.parse(fs.readFileSync(dateiPfad, "utf8"));
    if (!Array.isArray(docs)) throw new Error("--datei: erwartet eine Liste von Dokumenten");
    return {
      fenster: async (von, bis) =>
        docs.filter((d) => typeof d.beginn === "number" && d.beginn >= von && d.beginn < bis),
      tag: async (datum) => docs.find((d) => d.id === `tag-${datum}`) || null,
    };
  }
  const wurzel = pfad.resolve(__dirname, "..");
  const { createRequire } = require("module");
  const req = createRequire(pfad.join(wurzel, "functions", "package.json"));
  const { initializeApp } = req("firebase-admin/app");
  const { getFirestore } = req("firebase-admin/firestore");
  const { FIRESTORE_DATABASE_ID } = require(pfad.join(wurzel, "functions", "src", "config.js"));
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "malzime" });
  const db = getFirestore(FIRESTORE_DATABASE_ID);
  return {
    fenster: async (von, bis) => {
      const snap = await db.collection("statistik").where("beginn", ">=", von).where("beginn", "<", bis).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    tag: async (datum) => {
      const snap = await db.collection("statistik").doc(`tag-${datum}`).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },
  };
}

async function lies(quelle, z) {
  const fenster = await quelle.fenster(z.von, z.bis);
  const tage = [];
  for (const d of z.tage) {
    const t = await quelle.tag(d);
    if (t) tage.push(t);
  }
  return { fenster, tage };
}

/* ── Ausgabe ─────────────────────────────────────────────────────────────── */

function zeilenGruende(titel, obj) {
  const eintraege = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (eintraege.length === 0) return [`  ${titel}: 0`];
  return [`  ${titel}: ${summe(obj)}`, ...eintraege.map(([k, v]) => `      ${k}: ${v}`)];
}

function zeilenKlassen(titel, obj) {
  const gesamt = summe(obj);
  if (!gesamt) return [`  ${titel}: keine Werte`];
  return [
    `  ${titel} (${gesamt} Werte):`,
    ...KLASSEN.map((k) => {
      const n = (obj && obj[k]) || 0;
      return `      ${KLASSEN_TEXT[k].padEnd(9)} ${String(n).padStart(5)}  ${String(Math.round((n / gesamt) * 100)).padStart(3)} %`;
    }),
  ];
}

function zeilenSumme(s) {
  return [
    `  eingereiht: ${s.eingereiht || 0}`,
    `  fertig: ${s.fertig || 0}`,
    ...zeilenGruende("gescheitert", s.gescheitert),
    `  in der Schlange verworfen: ${s.verworfen || 0}`,
    ...zeilenGruende("abgewiesen", s.abgewiesen),
    `  abgeholt: ${s.abgeholt || 0} · nie abgeholt: ${s.nieAbgeholt || 0}`,
    ...zeilenKlassen("Wartezeit (Einreihen bis Start)", s.wartezeit),
    ...zeilenKlassen("Gesamtzeit (Einreihen bis fertig)", s.gesamtzeit),
    ...zeilenKlassen("KI-Dauer", s.kiDauer),
    `  KI-Wiederholungen: ${s.kiWiederholungen || 0}`,
  ];
}

function zeilenTag(tagSumme) {
  const z = [];
  const bf = tagSumme.browserFehler || {};
  if (Object.keys(bf).length === 0) z.push("  Browser-Fehler: 0");
  else {
    z.push(`  Browser-Fehler: ${summe(bf)}`);
    for (const [phase, fam] of Object.entries(bf).sort((a, b) => summe(b[1]) - summe(a[1]))) {
      const teile = Object.entries(fam)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      z.push(`      ${phase}: ${summe(fam)} (${teile})`);
    }
  }
  const t = tagSumme.kiText || {};
  z.push(
    `  Textmenge der KI: Eingabe ${t.eingabe || 0} (davon Zwischenspeicher ${t.zwischenspeicher || 0}), Ausgabe ${t.ausgabe || 0}`
  );
  return z;
}

function hinweisUnvollstaendig(z, jetzt) {
  return z.bis > jetzt - UNVOLLSTAENDIG_MS
    ? [
        "  HINWEIS: Der Zeitraum reicht in die juengsten zwei Stunden — Auftraege daraus sind teils noch nicht gezaehlt.",
      ]
    : [];
}

function berichtTag(z, daten, jetzt) {
  const s = daten.fenster.reduce((acc, f) => addiereIn(acc, f), {});
  const t = daten.tage.reduce((acc, d) => addiereIn(acc, d), {});
  const kopf = `Zaehler ${z.name} (Wiener Zeit): ${daten.fenster.length} Fenster mit Werten, ${daten.tage.length} Tagesdokument(e)`;
  if (daten.fenster.length === 0 && daten.tage.length === 0) return [kopf, "  keine Zaehler in diesem Zeitraum"];
  return [kopf, ...hinweisUnvollstaendig(z, jetzt), ...zeilenSumme(s), ...zeilenTag(t)];
}

function berichtBloecke(z, daten, jetzt) {
  const b = bloecke(daten.fenster);
  const kopf = `Bloecke am ${z.name} (Luecke > 30 min trennt): ${b.length}`;
  if (b.length === 0) return [kopf, "  keine aktiven Fenster"];
  const z2 = [kopf, ...hinweisUnvollstaendig(z, jetzt)];
  b.forEach((block, i) => {
    const s = block.summe;
    z2.push(
      `  Block ${i + 1}: ${uhrzeit(block.von)}–${uhrzeit(block.bis)} · eingereiht ${s.eingereiht || 0} · fertig ${s.fertig || 0} · ` +
        `gescheitert ${summe(s.gescheitert)} · verworfen ${s.verworfen || 0} · abgewiesen ${summe(s.abgewiesen)} · ` +
        `Wartezeit >= 4 min: ${((s.wartezeit || {}).unter8min || 0) + ((s.wartezeit || {}).laenger || 0)}`
    );
  });
  return z2;
}

function anteil(n, gesamt) {
  return gesamt ? `${Math.round((n / gesamt) * 100)} %` : "–";
}

function berichtVergleich(za, da, zb, db, jetzt) {
  const sa = da.fenster.reduce((acc, f) => addiereIn(acc, f), {});
  const sb = db.fenster.reduce((acc, f) => addiereIn(acc, f), {});
  const zeile = (titel, a, b) => `  ${titel.padEnd(34)} ${String(a).padStart(10)} ${String(b).padStart(10)}`;
  const schnell = (s) => ((s.wartezeit || {}).unter30s || 0) + ((s.wartezeit || {}).unter1min || 0);
  return [
    `Vergleich: A = ${za.name}, B = ${zb.name} (Wiener Zeit)`,
    ...hinweisUnvollstaendig(za, jetzt).map((h) => h.replace("Der Zeitraum", "A")),
    ...hinweisUnvollstaendig(zb, jetzt).map((h) => h.replace("Der Zeitraum", "B")),
    zeile("", "A", "B"),
    zeile("eingereiht", sa.eingereiht || 0, sb.eingereiht || 0),
    zeile("fertig", sa.fertig || 0, sb.fertig || 0),
    zeile("  Anteil fertig", anteil(sa.fertig || 0, sa.eingereiht), anteil(sb.fertig || 0, sb.eingereiht)),
    zeile("gescheitert", summe(sa.gescheitert), summe(sb.gescheitert)),
    zeile("in der Schlange verworfen", sa.verworfen || 0, sb.verworfen || 0),
    zeile("abgewiesen", summe(sa.abgewiesen), summe(sb.abgewiesen)),
    zeile("nie abgeholt", sa.nieAbgeholt || 0, sb.nieAbgeholt || 0),
    zeile(
      "Wartezeit unter 1 min (Anteil)",
      anteil(schnell(sa), summe(sa.wartezeit)),
      anteil(schnell(sb), summe(sb.wartezeit))
    ),
    zeile(
      "KI-Dauer unter 1 min (Anteil)",
      anteil(((sa.kiDauer || {}).unter30s || 0) + ((sa.kiDauer || {}).unter1min || 0), summe(sa.kiDauer)),
      anteil(((sb.kiDauer || {}).unter30s || 0) + ((sb.kiDauer || {}).unter1min || 0), summe(sb.kiDauer))
    ),
    zeile("KI-Wiederholungen", sa.kiWiederholungen || 0, sb.kiWiederholungen || 0),
  ];
}

/* ── Ablauf ──────────────────────────────────────────────────────────────── */

async function main(argv, jetzt = Date.now()) {
  const args = argv.slice();
  let datei = null;
  const i = args.indexOf("--datei");
  if (i !== -1) {
    datei = args[i + 1];
    args.splice(i, 2);
  }
  const [befehl, a, b] = args;
  const quelle = await quelleOeffnen(datei);
  if (befehl === "tag" && a) {
    const z = zeitraum(a);
    return berichtTag(z, await lies(quelle, z), jetzt);
  }
  if (befehl === "bloecke" && a && !a.includes("..")) {
    const z = zeitraum(a);
    return berichtBloecke(z, await lies(quelle, z), jetzt);
  }
  if (befehl === "vergleich" && a && b) {
    const za = zeitraum(a);
    const zb = zeitraum(b);
    return berichtVergleich(za, await lies(quelle, za), zb, await lies(quelle, zb), jetzt);
  }
  const fehler = new Error(
    "Aufruf: node scripts/zaehler-auswerten.js tag <JJJJ-MM-TT> | bloecke <JJJJ-MM-TT> | vergleich <Zeitraum> <Zeitraum> [--datei x.json]"
  );
  fehler.aufruf = true;
  throw fehler;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((zeilen) => {
      console.log(zeilen.join("\n"));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.aufruf ? err.message : `NICHT MESSBAR: ${err.message}`);
      process.exit(2);
    });
}

module.exports = { main, bloecke, zeitraum, wienerMitternacht, addiereIn };
