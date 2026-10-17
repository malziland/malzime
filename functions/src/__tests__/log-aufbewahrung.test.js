"use strict";

/* Aufbewahrung des Log-Speichers betrieb-eu (16.10.2026: 30 statt 1 Tag).

   Drei Dinge muessen zusammenpassen, sonst ist eine Zusage falsch:
     1. der Sollwert im Riegel vor dem Deploy (verify-infrastructure.sh,
        LOG_AUFBEWAHRUNG_TAGE) — und der Riegel muss rot werden koennen;
     2. der Text der Datenschutzerklaerung, deutsch und englisch;
     3. das Skript, das die Einstellung bei Google umstellt
        (log-aufbewahrung-umstellen.sh) — es liest den Sollwert vom Riegel.

   Kein echtes gcloud: Attrappen im PATH. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const WURZEL = path.join(__dirname, "../../..");
const RIEGEL = path.join(WURZEL, "scripts/verify-infrastructure.sh");
const UMSTELLEN = path.join(WURZEL, "scripts/log-aufbewahrung-umstellen.sh");
const FARBCODES = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex

const sollImRiegel = () => {
  const m = fs.readFileSync(RIEGEL, "utf8").match(/^LOG_AUFBEWAHRUNG_TAGE=(\d+)$/m);
  return m ? Number(m[1]) : null;
};

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-aufbewahrung-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("Riegel vor dem Deploy: Sollwert und Negativprobe", () => {
  function riegel(inhalt) {
    const bin = path.join(dir, "bin-riegel");
    if (!fs.existsSync(bin)) {
      fs.mkdirSync(bin);
      for (const w of ["gcloud", "gsutil", "curl", "gh"]) {
        fs.writeFileSync(path.join(bin, w), `#!/bin/sh\necho "ATTRAPPE ${w}" >&2\nexit 1\n`);
        fs.chmodSync(path.join(bin, w), 0o755);
      }
    }
    const datei = path.join(dir, `aufbewahrung-${Math.random()}.txt`);
    fs.writeFileSync(datei, inhalt);
    let aus;
    try {
      aus = execFileSync("bash", [RIEGEL], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INFRA_PROBE_LOG_AUFBEWAHRUNG: datei },
      });
    } catch (e) {
      aus = (e.stdout || "") + (e.stderr || "");
    }
    return aus
      .replace(FARBCODES, "")
      .split("\n")
      .filter((z) => z.includes("betrieb-eu: Aufbewahrung"));
  }

  test("Sollwert ist 30", () => {
    expect(sollImRiegel()).toBe(30);
  });

  test("NEGATIVPROBE: live steht noch 1 -> rot, mit Hinweis auf das Umstell-Skript", () => {
    expect(riegel("1")).toEqual([
      expect.stringContaining(
        "✗ betrieb-eu: Aufbewahrung ist 1 Tage, Zusage sagt 30 (Umstellen: sh scripts/log-aufbewahrung-umstellen.sh)"
      ),
    ]);
  });

  test("30 -> gruen", () => {
    expect(riegel("30")).toEqual([expect.stringContaining("✓ betrieb-eu: Aufbewahrung 30 Tage")]);
  });

  test("nicht messbar ist rot, nicht gruen", () => {
    expect(riegel("")).toEqual([expect.stringContaining("✗ betrieb-eu: Aufbewahrung NICHT MESSBAR")]);
  });
});

describe("Sollwert = Datenschutzerklaerung (deutsch und englisch)", () => {
  test.each([
    [
      "public/datenschutz.html",
      /<h3>Technisches Protokoll <span class="dauer-plakette">(\d+)&nbsp;Tage?<\/span><\/h3>\s*<p>[^\n]*<\/p>\s*<p><strong>Wie lange:<\/strong> (\d+)&nbsp;Tage?\.<\/p>/,
    ],
    [
      "public/en/privacy.html",
      /<h3>Technical log <span class="dauer-plakette">(\d+)&nbsp;days?<\/span><\/h3>\s*<p>[^\n]*<\/p>\s*<p><strong>How long:<\/strong> (\d+)&nbsp;days?\.<\/p>/,
    ],
  ])("%s: Plakette und „Wie lange“ nennen den Sollwert", (datei, muster) => {
    const m = fs.readFileSync(path.join(WURZEL, datei), "utf8").match(muster);
    expect(m).not.toBeNull();
    expect([Number(m[1]), Number(m[2])]).toEqual([sollImRiegel(), sollImRiegel()]);
  });
});

describe("Umstell-Skript (gcloud-Attrappe)", () => {
  /* Die Attrappe antwortet auf describe mit dem Inhalt von $STAND und schreibt
     jeden Aufruf in $AUFRUFE; update setzt $STAND auf den neuen Wert, ausser
     $UPDATE_WIRKT_NICHT ist gesetzt. */
  function umstellen(stand, args = [], extraEnv = {}) {
    const bin = path.join(dir, `bin-${Math.random()}`);
    fs.mkdirSync(bin);
    const standDatei = path.join(bin, "stand");
    const aufrufe = path.join(bin, "aufrufe");
    fs.writeFileSync(standDatei, stand);
    fs.writeFileSync(aufrufe, "");
    fs.writeFileSync(
      path.join(bin, "gcloud"),
      [
        "#!/bin/sh",
        'echo "$*" >> "$AUFRUFE"',
        'case "$*" in',
        '  *"buckets describe"*) cat "$STAND" ;;',
        '  *"buckets update"*)',
        '    [ -n "${UPDATE_WIRKT_NICHT:-}" ] && exit 0',
        '    for a in "$@"; do case "$a" in --retention-days=*) echo "${a#--retention-days=}" > "$STAND" ;; esac; done ;;',
        "  *) exit 1 ;;",
        "esac",
        "",
      ].join("\n")
    );
    fs.chmodSync(path.join(bin, "gcloud"), 0o755);
    let rc = 0;
    let aus;
    try {
      aus = execFileSync("sh", [UMSTELLEN, ...args], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STAND: standDatei, AUFRUFE: aufrufe, ...extraEnv },
      });
    } catch (e) {
      rc = e.status;
      aus = (e.stdout || "") + (e.stderr || "");
    }
    return { rc, aus, aufrufe: fs.readFileSync(aufrufe, "utf8"), stand: fs.readFileSync(standDatei, "utf8").trim() };
  }

  test("ohne Schalter: zeigt nur, aendert nichts, Rueckgabe 1", () => {
    const r = umstellen("1\n");
    expect(r.rc).toBe(1);
    expect(r.aus).toContain("IST 1 Tage, SOLL 30 Tage");
    expect(r.aufrufe).not.toMatch(/update/);
    expect(r.stand).toBe("1");
  });

  test("mit --ausfuehren: stellt auf den Sollwert und misst nach, Rueckgabe 0", () => {
    const r = umstellen("1\n", ["--ausfuehren"]);
    expect(r.rc).toBe(0);
    expect(r.aufrufe).toMatch(
      /logging buckets update betrieb-eu --location=europe-west1 --project=malzime --retention-days=30/
    );
    expect(r.aus).toContain("OK: betrieb-eu haelt jetzt 30 Tage.");
    expect(r.stand).toBe("30");
  });

  test("wiederholbar: steht der Sollwert schon, kein update, Rueckgabe 0", () => {
    const r = umstellen("30\n", ["--ausfuehren"]);
    expect(r.rc).toBe(0);
    expect(r.aufrufe).not.toMatch(/update/);
  });

  test("Umstellen meldet Erfolg, wirkt aber nicht: Nachmessung macht es rot, Rueckgabe 1", () => {
    const r = umstellen("1\n", ["--ausfuehren"], { UPDATE_WIRKT_NICHT: "1" });
    expect(r.rc).toBe(1);
    expect(r.aus).toContain("ABWEICHUNG: erwartet 30, gemessen 1.");
  });

  test("nicht lesbar (keine Anmeldung): Rueckgabe 2, kein update", () => {
    const r = umstellen("", ["--ausfuehren"]);
    expect(r.rc).toBe(2);
    expect(r.aufrufe).not.toMatch(/update/);
  });
});
