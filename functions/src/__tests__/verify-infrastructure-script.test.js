const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Wächter für scripts/verify-infrastructure.sh (Codex-Review 2026-08-12).
 *
 * Das Skript verspricht in seinem Kopf: AUSSCHLIESSLICH LESEND. Dieses
 * Versprechen ist sicherheitskritisch — es läuft vor jedem Deploy und mit
 * den vollen Rechten des angemeldeten gcloud-Kontos. Würde jemand später
 * ein `update`/`delete`/`set-iam-policy` hineinbauen, wäre aus dem Prüf-
 * ein Eingriffs-Skript geworden, ohne dass es jemandem auffällt.
 *
 * Darum erzwingt dieser Test statisch: Jede Zeile, die gcloud oder gsutil
 * aufruft, muss ein bekanntes Lese-Kommando sein. Kein Netzwerk, keine
 * Cloud-Aufrufe — reine Textanalyse plus Bash-Syntaxprüfung.
 */

const SCRIPT = path.join(__dirname, "../../../scripts/verify-infrastructure.sh");
const DEPLOY = path.join(__dirname, "../../../scripts/deploy.sh");

/* Lese-Kommandos, die das Prüfskript benutzen darf. Bewusst eng gefasst:
   Wer ein neues braucht, erweitert die Liste hier im selben Commit —
   dann sieht der Review die Erweiterung. */
const ERLAUBTE_LESE_MUSTER = [
  /gcloud (tasks queues|storage buckets|firestore databases|functions|run services|logging sinks) (describe|list|get-iam-policy)\b/,
  /gcloud auth list\b/,
  /command -v gcloud/,
  /* OPS-2026-08-12-09: Waechter ueber den Alarmweg. Beides reine list-Abfragen —
     `policies list` und `channels list` lesen nur, sie schalten nichts. */
  /gcloud alpha monitoring (policies|channels) list\b/,
  /* OPS-2026-08-13-33: die zwei Netze unter der Loeschzusage. `ttls list` und
     `scheduler jobs describe` lesen nur. */
  /gcloud firestore fields ttls list\b/,
  /gcloud scheduler jobs describe\b/,
  /* SEC-2026-08-30-13: Waechter ueber die Firestore-Sicherheitsregeln. Der
     gesamte Firestore-Umbau setzt voraus, dass niemand von aussen an
     `config/betriebsprofil` kommt — diese Voraussetzung war ungeprueft.
     `auth print-access-token` gibt nur ein Lese-Token aus und aendert nichts;
     die Regeln selbst werden ueber die REST-Schnittstelle GELESEN (curl ohne
     -X, also GET). */
  /gcloud auth print-access-token\b/,
  /* OPS-2026-08-31-02: Messung am ECHTEN Bildspeicher. Am 30.08. lagen 4.056
     Testbilder im Bucket, waehrend alle Tests gruen meldeten — sie prueften
     den Code, der das Loeschen verspricht, nie den Speicher selbst. `gsutil
     ls -l` listet nur auf und veraendert nichts. */
  /gsutil ls -l\b/,
  /* 09.09.2026 (EU-Umzug): Log-Weiche, Log-Speicher und Secrets. `buckets
     describe` liest Aufbewahrung und Standort; `secrets describe` liest nur
     die Replikationsrichtlinie, `secrets versions list` nur Versionsnamen und
     Zustand — nie den Wert. */
  /gcloud logging buckets describe\b/,
  /gcloud secrets (describe|versions list)\b/,
];

function gcloudZeilen(inhalt) {
  /* Nur echte AUFRUFE zählen (Zeilenanfang, `$(...)` oder `command -v`) —
     nicht jede Erwähnung des Wortes in echo-Meldungen oder Strings. */
  const aufruf = /(^\s*|\$\(\s*|command -v )(gcloud|gsutil)\b/;
  return inhalt
    .split("\n")
    .map((zeile, i) => ({ zeile, nr: i + 1 }))
    .filter(({ zeile }) => {
      const ohneKommentar = zeile.replace(/^\s*#.*/, "");
      return aufruf.test(ohneKommentar);
    });
}

describe("verify-infrastructure.sh", () => {
  const inhalt = fs.readFileSync(SCRIPT, "utf8");

  test("existiert und ist ausführbar", () => {
    const stat = fs.statSync(SCRIPT);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  test("Bash-Syntax ist gültig (bash -n)", () => {
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: "pipe", timeout: 15000 })).not.toThrow();
  });

  test("jede gcloud-/gsutil-Zeile ist ein bekanntes LESE-Kommando", () => {
    const verstoesse = gcloudZeilen(inhalt).filter(
      ({ zeile }) => !ERLAUBTE_LESE_MUSTER.some((muster) => muster.test(zeile))
    );
    expect(verstoesse).toEqual([]);
  });

  test("enthält kein einziges bekanntes Schreib-Verb für gcloud/gsutil", () => {
    /* Doppelter Boden zur Allowlist oben: selbst wenn jemand die Allowlist
       aufweicht, schlagen bekannte Schreib-Verben hier separat an. */
    const schreibVerben =
      /\b(update|create|delete|deploy|patch|import|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding|lifecycle set|iam ch|rm|cp|mv|rsync)\b/;
    for (const { zeile, nr } of gcloudZeilen(inhalt)) {
      expect({ nr, schreibt: schreibVerben.test(zeile) }).toEqual({ nr, schreibt: false });
    }
  });

  test("deploy.sh ruft die Infrastruktur-Prüfung mit SKIP_INFRA-Notschalter auf", () => {
    const deploy = fs.readFileSync(DEPLOY, "utf8");
    expect(deploy).toMatch(/SKIP_INFRA/);
    expect(deploy).toMatch(/verify-infrastructure\.sh/);
  });

  /* OPS-2026-08-13-40/41: Der Bucket-Riegel konnte vier Wochen lang nicht rot
     werden (PIPESTATUS[0]=printf statt [1]=python3), und niemand hätte es je
     bemerkt, weil dieser Riegel als einziger keine Negativprobe hatte. Diese
     Tests treiben ihn über die Einspeisepunkte INFRA_PROBE_* rot und grün.
     Attrappen im PATH sorgen dafuer, dass dabei WIRKLICH kein gcloud und kein
     Netz angefasst wird — bis zum 31.08.2026 stimmte dieser Satz nicht. */
  describe("der Bucket-Riegel kann rot werden (OPS-40/41)", () => {
    const os = require("os");
    const { execFileSync } = require("child_process");
    let dir;
    const GUT_BUCKET =
      '{"location":"EUROPE-WEST1","softDeletePolicy":{"retentionDurationSeconds":"0"},"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}}';

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-infra-"));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    function lauf(bucketJson) {
      const bp = path.join(dir, "bucket.json");
      fs.writeFileSync(bp, bucketJson);
      /* Nur der Bucket-Abschnitt wird eingespeist; alle anderen Abschnitte
         fragen echtes gcloud. Ohne Anmeldung enden sie rot — deshalb prüfen
         wir hier NICHT den Gesamt-Exit, sondern die Bucket-Zeilen der Ausgabe. */
      /* BEFUND 31.08.2026 (Runde 4): Hier lief das Skript mit vollem PATH.
         Gemessen wurden 28 echte gcloud- und gsutil-Aufrufe gegen das
         Produktivprojekt JE SUITE-LAUF, dazu zwei curl an firebaserules —
         aus einem Unit-Test heraus. Der Kommentar darueber behauptete "ohne
         gcloud, ohne Netz".
         Jetzt liegen Attrappen im PATH: Sie antworten wie ein nicht
         angemeldetes System. Die uebrigen Abschnitte melden dann rot, das ist
         hier egal — geprueft werden ohnehin nur die Bucket-Zeilen. */
      const attrappen = path.join(dir, "bin");
      if (!fs.existsSync(attrappen)) {
        fs.mkdirSync(attrappen);
        for (const w of ["gcloud", "gsutil", "curl"]) {
          const ziel = path.join(attrappen, w);
          fs.writeFileSync(ziel, "#!/bin/sh\n" + `echo "ATTRAPPE ${w}: kein Zugriff im Test" >&2\n` + "exit 1\n");
          fs.chmodSync(ziel, 0o755);
        }
      }
      try {
        return execFileSync("bash", [SCRIPT], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${attrappen}:${process.env.PATH}`,
            INFRA_PROBE_BUCKET: bp,
          },
        });
      } catch (e) {
        return (e.stdout || "") + (e.stderr || "");
      }
    }

    test("kaputter Bucket (US, Soft-Delete an, kein Lifecycle) → drei ✗", () => {
      const aus = lauf(
        '{"location":"US-CENTRAL1","softDeletePolicy":{"retentionDurationSeconds":"604800"},"lifecycle":{"rule":[]}}'
      );
      expect(aus).toMatch(/Region: SOLL EUROPE-WEST1, IST US-CENTRAL1/);
      expect(aus).toMatch(/Soft-Delete: SOLL 0, IST 604800/);
      expect(aus).toMatch(/Lifecycle: keine Delete-Regel/);
    });

    test("guter Bucket → drei OK, keine Bucket-Abweichung", () => {
      const aus = lauf(GUT_BUCKET);
      expect(aus).toMatch(/Region: EUROPE-WEST1/);
      expect(aus).toMatch(/Soft-Delete: aus/);
      expect(aus).toMatch(/Lifecycle: Delete nach 1 Tag aktiv/);
      expect(aus).not.toMatch(/Region: SOLL EUROPE-WEST1, IST/);
    });
  });

  /* OPS-2026-09-01-02: Der Vergleich Datenbank ↔ Repo kann rot werden. Beide
     Proben laufen ueber den Einspeisepunkt INFRA_PROBE_SATZ; gcloud, gsutil
     und curl sind attrappiert, node ist echt — das Vergleichsskript liest
     dann die Datei statt Firestore. */
  describe("der Einstellungssatz-Riegel kann rot werden (OPS-2026-09-01-02)", () => {
    const os = require("os");
    const { execFileSync } = require("child_process");
    const { PROFILE, AKTIV } = require("../produktiv-satz");
    let dir;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-satz-"));
      const attrappen = path.join(dir, "bin");
      fs.mkdirSync(attrappen);
      for (const w of ["gcloud", "gsutil", "curl"]) {
        const ziel = path.join(attrappen, w);
        fs.writeFileSync(ziel, "#!/bin/sh\n" + `echo "ATTRAPPE ${w}: kein Zugriff im Test" >&2\n` + "exit 1\n");
        fs.chmodSync(ziel, 0o755);
      }
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    function lauf(umgebung) {
      try {
        return execFileSync("bash", [SCRIPT], {
          encoding: "utf8",
          env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, ...umgebung },
        });
      } catch (e) {
        return (e.stdout || "") + (e.stderr || "");
      }
    }

    function mitSatz(dokument) {
      const datei = path.join(dir, "satz.json");
      fs.writeFileSync(datei, JSON.stringify(dokument));
      return lauf({ INFRA_PROBE_SATZ: datei });
    }

    test("Datenbank == Repo → gruen", () => {
      const aus = mitSatz({ aktiv: AKTIV, profile: PROFILE });
      expect(aus).toMatch(/Einstellungssatz: Datenbank und Repo stimmen ueberein/);
      expect(aus).not.toMatch(/Einstellungssatz weicht vom Repo ab/);
    });

    test("ein Feld im Ersatz-Profil weicht ab → rot mit Feldname und beiden Werten", () => {
      const profile = JSON.parse(JSON.stringify(PROFILE));
      const soll = PROFILE["t1-langsam"].parallelitaet;
      profile["t1-langsam"].parallelitaet = soll + 3;
      const aus = mitSatz({ aktiv: AKTIV, profile });
      expect(aus).toMatch(/Einstellungssatz weicht vom Repo ab/);
      expect(aus).toContain(`t1-langsam.parallelitaet: DB=${soll + 3} Repo=${soll}`);
    });

    test("ohne Einspeisepunkt im Probemodus wird NICHT gegen die echte Datenbank verglichen", () => {
      /* Der Bucket-Riegel-Test oben laeuft im Probemodus — er darf keinen
         Datenbankzugriff ausloesen. */
      const bp = path.join(dir, "bucket.json");
      fs.writeFileSync(
        bp,
        '{"location":"EUROPE-WEST1","softDeletePolicy":{"retentionDurationSeconds":"0"},"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}}'
      );
      const aus = lauf({ INFRA_PROBE_BUCKET: bp });
      expect(aus).toMatch(/uebersprungen \(Probemodus ohne INFRA_PROBE_SATZ\)/);
    });
  });

  /* OPS-2026-10-03-11: Der Waechter ueber den Alarmweg sah nur EINE Alarmregel
     (die erste mit severity>=ERROR). Seit es fuenf gibt, konnten vier davon aus,
     geloescht oder ohne Kanal sein, und der Waechter meldete weiter "scharf".
     Jetzt prueft er jede Regel einzeln nach ihrem Namen. Die Proben laufen ueber
     die Einspeisepunkte INFRA_PROBE_ALARMREGELN und INFRA_PROBE_ALARMKANAELE mit
     erfundenen Antworten — keine echte Kennung, keine Adresse. */
  describe("der Alarm-Waechter prueft jede Alarmregel einzeln (OPS-2026-10-03-11)", () => {
    const os = require("os");
    const { execFileSync } = require("child_process");
    let dir;

    const REGELN = [
      "malziME Function Errors",
      "malziME Analyse gescheitert",
      "malziME Kinderschutz-Treffer",
      "malziME Client-Fehler-Haeufung",
      "malziME KI-Verbindung bricht gehäuft ab",
    ];
    /* Farbcodes der Ausgabe (gruen/rot) fuer den Textvergleich entfernen. */
    // eslint-disable-next-line no-control-regex
    const FARBCODES = /\x1b\[[0-9;]*m/g;
    const MAIL = "projects/probe/notificationChannels/1";
    const PUSH = "projects/probe/notificationChannels/2";

    const guteKanaele = () => [
      { name: MAIL, type: "email", enabled: true, displayName: "Probe E-Mail" },
      { name: PUSH, type: "webhook_tokenauth", enabled: true, displayName: "Probe Push" },
    ];
    const guteRegeln = () =>
      REGELN.map((displayName) => ({ displayName, enabled: true, notificationChannels: [MAIL, PUSH] }));
    /** Alle Regeln gut, nur die genannte wird veraendert (oder entfernt, wenn die Aenderung null liefert). */
    const regelnMit = (name, aendere) =>
      guteRegeln()
        .map((regel) => (regel.displayName === name ? aendere(regel) : regel))
        .filter(Boolean);

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-alarm-"));
      const attrappen = path.join(dir, "bin");
      fs.mkdirSync(attrappen);
      for (const w of ["gcloud", "gsutil", "curl"]) {
        const ziel = path.join(attrappen, w);
        fs.writeFileSync(ziel, "#!/bin/sh\n" + `echo "ATTRAPPE ${w}: kein Zugriff im Test" >&2\n` + "exit 1\n");
        fs.chmodSync(ziel, 0o755);
      }
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    /** Laesst das Skript mit den eingespeisten Antworten laufen und liefert die Zeilen des Alarm-Waechters. */
    function lauf(regeln, kanaele) {
      const rp = path.join(dir, "regeln.json");
      const kp = path.join(dir, "kanaele.json");
      fs.writeFileSync(rp, typeof regeln === "string" ? regeln : JSON.stringify(regeln));
      fs.writeFileSync(kp, typeof kanaele === "string" ? kanaele : JSON.stringify(kanaele));
      let aus;
      try {
        aus = execFileSync("bash", [SCRIPT], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
            INFRA_PROBE_ALARMREGELN: rp,
            INFRA_PROBE_ALARMKANAELE: kp,
          },
        });
      } catch (e) {
        aus = (e.stdout || "") + (e.stderr || "");
      }
      const ohneFarbe = aus.replace(FARBCODES, "");
      return ohneFarbe.split("\n").filter((z) => /Alarmregel|Alarmweg NICHT|Benachrichtigungskan|Kanäle NICHT/.test(z));
    }
    const gruen = (name) => `✓ Alarmregel scharf: »${name}«, 2 Kanal/Kanäle, E-Mail dabei`;
    const enthaelt = (zeilen, text) => zeilen.some((z) => z.includes(text));

    test("Erfolgsweg: alle fuenf Regeln scharf → fuenf gruene Zeilen, keine rote", () => {
      const zeilen = lauf(guteRegeln(), guteKanaele());
      for (const name of REGELN) expect(enthaelt(zeilen, gruen(name))).toBe(true);
      expect(zeilen.filter((z) => z.includes("✗"))).toEqual([]);
      expect(enthaelt(zeilen, "✓ Benachrichtigungskanäle aktiv: 2")).toBe(true);
    });

    test.each(REGELN)("»%s« ausgeschaltet → rot, die vier anderen bleiben gruen", (name) => {
      const zeilen = lauf(
        regelnMit(name, (r) => ({ ...r, enabled: false })),
        guteKanaele()
      );
      expect(enthaelt(zeilen, `✗ Alarmregel ist DEAKTIVIERT: »${name}«`)).toBe(true);
      for (const andere of REGELN.filter((n) => n !== name)) expect(enthaelt(zeilen, gruen(andere))).toBe(true);
    });

    test.each(REGELN)("»%s« geloescht → rot", (name) => {
      const zeilen = lauf(
        regelnMit(name, () => null),
        guteKanaele()
      );
      expect(enthaelt(zeilen, `✗ Alarmregel FEHLT: »${name}«`)).toBe(true);
    });

    test.each(REGELN)("»%s« ohne Kanal → rot", (name) => {
      const zeilen = lauf(
        regelnMit(name, (r) => ({ ...r, notificationChannels: [] })),
        guteKanaele()
      );
      expect(enthaelt(zeilen, `✗ Alarmregel hat KEINEN Benachrichtigungskanal: »${name}«`)).toBe(true);
    });

    test.each(REGELN)("»%s« nur mit Push, ohne E-Mail → rot", (name) => {
      const zeilen = lauf(
        regelnMit(name, (r) => ({ ...r, notificationChannels: [PUSH] })),
        guteKanaele()
      );
      expect(enthaelt(zeilen, `✗ Alarmregel hat keinen eingeschalteten E-Mail-Kanal: »${name}«`)).toBe(true);
    });

    test("E-Mail-Kanal abgeschaltet → alle fuenf Regeln rot, und der Kanal wird genannt", () => {
      const kanaele = guteKanaele();
      kanaele[0].enabled = false;
      const zeilen = lauf(guteRegeln(), kanaele);
      for (const name of REGELN) {
        expect(enthaelt(zeilen, `✗ Alarmregel hat keinen eingeschalteten E-Mail-Kanal: »${name}«`)).toBe(true);
      }
      expect(enthaelt(zeilen, "✗ Abgeschaltete Benachrichtigungskanäle: Probe E-Mail")).toBe(true);
    });

    test("eine Regel, die der Waechter nicht kennt → rot (sonst waere die naechste neue Regel unbewacht)", () => {
      const regeln = [
        ...guteRegeln(),
        { displayName: "malziME Neue Regel", enabled: true, notificationChannels: [MAIL] },
      ];
      const zeilen = lauf(regeln, guteKanaele());
      expect(enthaelt(zeilen, "✗ Alarmregel ohne Waechter: »malziME Neue Regel«")).toBe(true);
      for (const name of REGELN) expect(enthaelt(zeilen, gruen(name))).toBe(true);
    });

    test("gleichnamiges, ausgeschaltetes Duplikat macht eine scharfe Regel nicht rot", () => {
      const regeln = [{ displayName: REGELN[0], enabled: false, notificationChannels: [] }, ...guteRegeln()];
      expect(enthaelt(lauf(regeln, guteKanaele()), gruen(REGELN[0]))).toBe(true);
    });

    test.each([
      ["unlesbare Antwort", "das ist kein JSON", "Antwort zu den Alarmregeln nicht lesbar"],
      ["leere Liste", "[]", "keine Alarmregel in der Antwort"],
    ])("Messfehler bei den Regeln (%s) → ungeprueft gilt als nicht bestanden", (_name, antwort, grund) => {
      const zeilen = lauf(antwort, guteKanaele());
      expect(enthaelt(zeilen, `✗ Alarmweg NICHT geprueft (${grund})`)).toBe(true);
      expect(zeilen.filter((z) => z.includes("✓ Alarmregel"))).toEqual([]);
    });

    test("Messfehler bei den Kanaelen → keine Regel gilt als geprueft", () => {
      const zeilen = lauf(guteRegeln(), "das ist kein JSON");
      expect(enthaelt(zeilen, "✗ Alarmweg NICHT geprueft (Liste der Kanaele nicht lesbar")).toBe(true);
      expect(zeilen.filter((z) => z.includes("✓ Alarmregel"))).toEqual([]);
      expect(enthaelt(zeilen, "✗ Kanäle NICHT geprueft")).toBe(true);
    });

    /* Nachlauf zu OPS-2026-10-03-11: Die Pruefung "deckt der Alarmfilter alle
       Dienste ab" nahm die Dienstnamen aus den Filtern ALLER Regeln zusammen. Fehlte
       ein Dienst in einer Regel, stand aber in einer anderen, blieb sie gruen. */
    describe("Abdeckung der Dienste je Regel", () => {
      const DIENSTE = ["admin", "enqueue", "processjob", "errors", "telemetry", "erinnerung", "ntfy"];
      const mitListe = (displayName, dienste) => ({
        displayName,
        enabled: true,
        notificationChannels: [MAIL, PUSH],
        conditions: [
          {
            conditionMatchedLog: {
              filter: `resource.type="cloud_run_revision" AND resource.labels.service_name=(${dienste
                .map((d) => `"${d}"`)
                .join(" OR ")}) AND severity>=ERROR AND NOT jsonPayload.step="processjob"`,
            },
          },
        ],
      });
      const ohneListe = (displayName) => ({
        displayName,
        enabled: true,
        notificationChannels: [MAIL, PUSH],
        conditions: [{ conditionThreshold: { filter: 'metric.type = "logging.googleapis.com/user/probe"' } }],
      });
      const alle = ["admin", "enqueue", "processjob"];
      const regelSatz = (aenderung = {}) => [
        mitListe(REGELN[0], aenderung[REGELN[0]] || alle),
        mitListe(REGELN[1], aenderung[REGELN[1]] || alle),
        mitListe(REGELN[2], aenderung[REGELN[2]] || alle),
        ohneListe(REGELN[3]),
        ohneListe(REGELN[4]),
      ];

      function abdeckung(regeln, dienste = DIENSTE) {
        const rp = path.join(dir, "regeln-abdeckung.json");
        const kp = path.join(dir, "kanaele-abdeckung.json");
        const dp = path.join(dir, "dienste.txt");
        fs.writeFileSync(rp, typeof regeln === "string" ? regeln : JSON.stringify(regeln));
        fs.writeFileSync(kp, JSON.stringify(guteKanaele()));
        fs.writeFileSync(dp, dienste.join("\n") + "\n");
        let aus;
        try {
          aus = execFileSync("bash", [SCRIPT], {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
              INFRA_PROBE_ALARMREGELN: rp,
              INFRA_PROBE_ALARMKANAELE: kp,
              INFRA_PROBE_DIENSTE: dp,
            },
          });
        } catch (e) {
          aus = (e.stdout || "") + (e.stderr || "");
        }
        return aus
          .replace(FARBCODES, "")
          .split("\n")
          .filter((z) => z.includes("Alarm-Abdeckung"));
      }

      test("Erfolgsweg: jede der drei Regeln mit Dienstliste nennt alle Dienste → drei gruene Zeilen", () => {
        const zeilen = abdeckung(regelSatz());
        expect(zeilen).toHaveLength(3);
        for (const name of REGELN.slice(0, 3)) {
          expect(
            enthaelt(zeilen, `✓ Alarm-Abdeckung »${name}«: jeder Dienst ist im Filter oder benannte Ausnahme`)
          ).toBe(true);
        }
      });

      test.each(REGELN.slice(0, 3))(
        "ein Dienst fehlt nur in »%s« → genau diese Regel rot, die zwei anderen gruen",
        (name) => {
          const zeilen = abdeckung(regelSatz({ [name]: ["admin", "enqueue"] }));
          expect(
            enthaelt(
              zeilen,
              `✗ Alarm-Abdeckung »${name}«: Dienste ohne Abdeckung und ohne benannte Ausnahme: processjob`
            )
          ).toBe(true);
          expect(zeilen.filter((z) => z.includes("✓"))).toHaveLength(2);
        }
      );

      test("ein neuer Dienst, den keine Regel nennt → alle drei rot", () => {
        const zeilen = abdeckung(regelSatz(), [...DIENSTE, "neuerdienst"]);
        expect(zeilen.filter((z) => z.includes("✗") && z.includes("neuerdienst"))).toHaveLength(3);
      });

      test("ein Name, der nur ausserhalb der Dienstliste im Filter steht, zaehlt nicht als Abdeckung", () => {
        /* Der Filter nennt "processjob" auch als Wert von jsonPayload.step. */
        const zeilen = abdeckung(regelSatz({ [REGELN[0]]: ["admin", "enqueue"] }));
        expect(enthaelt(zeilen, `✗ Alarm-Abdeckung »${REGELN[0]}«`)).toBe(true);
      });

      test("keine Regel mit Dienstliste → ungeprueft gilt als nicht bestanden", () => {
        const zeilen = abdeckung([ohneListe(REGELN[3]), ohneListe(REGELN[4])]);
        expect(enthaelt(zeilen, "✗ Alarm-Abdeckung NICHT geprueft (keine Alarmregel mit Dienstliste gefunden)")).toBe(
          true
        );
      });

      test("unlesbare Regeln oder unlesbare Dienstliste → ungeprueft gilt als nicht bestanden", () => {
        expect(enthaelt(abdeckung("kein JSON"), "✗ Alarm-Abdeckung NICHT geprueft (Alarmregeln nicht lesbar)")).toBe(
          true
        );
        expect(
          enthaelt(abdeckung(regelSatz(), []), "✗ Alarm-Abdeckung NICHT geprueft (Dienstliste nicht lesbar)")
        ).toBe(true);
      });
    });

    test("die Liste im Skript und die Doku nennen dieselben fuenf Regeln", () => {
      const block = inhalt.match(/ALARM_REGELN='([^']+)'/);
      expect(block).not.toBeNull();
      const imSkript = block[1]
        .split("\n")
        .map((z) => z.trim())
        .filter(Boolean);
      expect([...imSkript].sort()).toEqual([...REGELN].sort());
      const doku = fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "ERROR-ALERTING.md"), "utf8");
      const inDerDoku = [...new Set([...doku.matchAll(/`(malziME [^`]+)`/g)].map((m) => m[1]))];
      expect(inDerDoku.sort()).toEqual([...imSkript].sort());
    });
  });
});
