#!/usr/bin/env node
/**
 * test-subject.js — Testet die v1.6.0-Tiererkennung gegen echte Bilder.
 *
 * Ruft GENAU den v1.6.0-Code-Pfad auf, ohne Deploy:
 *   mistral.describeImage()  → Mistral Large 3 Bildbeschreibung (mit SUBJECT-Kopfzeile)
 *   classifyDescription()    → parst die SUBJECT-Zeile, entscheidet Mensch/Tier
 *   extractVisibleText()     → die "Sichtbarer Text:"-Zeile
 *
 * Damit lässt sich prüfen, OB Mistral die SUBJECT-Kopfzeile zuverlässig liefert,
 * bevor v1.6.0 live geht. Mehrere Durchläufe zeigen die Run-to-Run-Varianz.
 *
 * Bild wird wie im Live-Frontend auf 1280px/JPEG 82% verkleinert (macOS sips).
 *
 * Aufruf (aus dem Projekt-Root):
 *   MISTRAL_API_KEY=<key> node functions/scripts/test-subject.js <pfad-zum-bild> [anzahl-durchlaeufe]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const mistral = require("../src/mistral");
const { classifyDescription } = require("../src/animal");
const { extractVisibleText } = require("../src/privacy");

function detectMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    }[ext] || "image/jpeg"
  );
}

/* Bild wie das Live-Frontend verkleinern: 1280px max, JPEG 82%. Nur auf macOS
   (sips). Auf anderen Systemen wird das Original genutzt — mit Hinweis. */
function maybeResize(buffer, filePath) {
  if (process.platform !== "darwin") {
    console.log("  ⚠ Kein macOS — Bild wird NICHT verkleinert (Live-Frontend macht 1280px/82%).");
    return { buffer, mimeType: detectMime(filePath) };
  }
  const tmpIn = path.join(os.tmpdir(), `subj-in-${Date.now()}.jpg`);
  const tmpOut = path.join(os.tmpdir(), `subj-out-${Date.now()}.jpg`);
  try {
    fs.writeFileSync(tmpIn, buffer);
    execSync(`sips -Z 1280 -s format jpeg -s formatOptions 82 "${tmpIn}" --out "${tmpOut}"`, { stdio: "ignore" });
    return { buffer: fs.readFileSync(tmpOut), mimeType: "image/jpeg" };
  } finally {
    try {
      fs.unlinkSync(tmpIn);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Aufruf: MISTRAL_API_KEY=<key> node functions/scripts/test-subject.js <pfad-zum-bild> [anzahl]");
    process.exit(1);
  }
  if (!process.env.MISTRAL_API_KEY) {
    console.error("✗ MISTRAL_API_KEY ist nicht gesetzt.");
    process.exit(1);
  }

  const imagePath = args[0].replace(/^['"]|['"]$/g, "").replace(/\\ /g, " ");
  const runs = Math.max(1, parseInt(args[1], 10) || 1);
  if (!fs.existsSync(imagePath)) {
    console.error(`Datei nicht gefunden: ${imagePath}`);
    process.exit(1);
  }

  const original = fs.readFileSync(imagePath);
  console.log(`\n📷 Bild: ${imagePath} (${(original.length / 1024).toFixed(0)} KB original)`);
  const { buffer, mimeType } = maybeResize(original, imagePath);
  console.log(`   → an Mistral: ${(buffer.length / 1024).toFixed(0)} KB, ${mimeType}`);
  console.log(`   → Durchläufe: ${runs}\n`);

  const tally = {};
  for (let i = 1; i <= runs; i++) {
    let description;
    try {
      description = await mistral.describeImage(buffer, mimeType, undefined, "de");
    } catch (err) {
      console.log(`Lauf ${i}: ✗ FEHLER (code=${err.code || "?"}) — ${err.message}\n`);
      tally.ERROR = (tally.ERROR || 0) + 1;
      continue;
    }
    if (!description) {
      console.log(`Lauf ${i}: describeImage → null (Mistral lieferte leeren Text)\n`);
      tally.NULL = (tally.NULL || 0) + 1;
      continue;
    }

    const subjectMatch = description.match(/^SUBJECT:.*$/im);
    const subjectLine = subjectMatch ? subjectMatch[0].trim() : "‼ KEINE SUBJECT-Zeile geliefert";
    const cls = classifyDescription(description);
    const visibleText = extractVisibleText(description);
    tally[cls.subject] = (tally[cls.subject] || 0) + 1;

    console.log(`Lauf ${i}: ${subjectLine}`);
    console.log(
      `         classify → subject=${cls.subject}  hasPerson=${cls.hasPerson}  hasAnimal=${cls.hasAnimal}  animalType=${cls.animalType || "-"}`
    );
    console.log(`         sichtbarer Text: ${visibleText || "(keiner)"}`);
    console.log(
      `         Beschreibung (${description.length} Z.): ${description.slice(0, 220).replace(/\s+/g, " ").trim()}…\n`
    );
  }

  console.log("─".repeat(60));
  console.log("Verteilung über alle Durchläufe:");
  for (const [key, count] of Object.entries(tally)) {
    console.log(`  ${key.padEnd(12)} ${count}× (${((count / runs) * 100).toFixed(0)} %)`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("\n✗ Abbruch:", err.message);
  process.exit(1);
});
