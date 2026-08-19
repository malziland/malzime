/**
 * echtheit-pruefen.js — rechnet den ausgelieferten Stand im Browser nach.
 *
 * Holt /build-info.json, laedt jede dort genannte Datei von dieser Website und
 * rechnet ihre SHA-256-Pruefsumme neu aus. Alles im Browser, ohne Server,
 * ohne fremde Bibliothek: `crypto.subtle` kann jeder moderne Browser.
 *
 * ZUR OFFENHEIT, und das gehoert offen gesagt: Diese Datei liegt selbst in
 * public/js/ und steht damit selbst im Fingerabdruck. Sie prueft sich also
 * mit — wenn jemand sie austauschen wuerde, faellt es in ihrer eigenen Zeile
 * auf. Was sie NICHT leisten kann: Wer diese Website vollstaendig unter
 * Kontrolle haette, koennte auch ein luegendes Pruefprogramm ausliefern. Genau
 * deshalb steht der Weg ueber die Kommandozeile daneben — der laeuft aus einem
 * frischen Klon des Repositories und ist von dieser Seite unabhaengig.
 *
 * ZUR BARRIEREFREIHEIT: Die Zeilen laufen bewusst NICHT durch einen
 * aria-live-Bereich. Achtzig Ansagen in Folge sind fuer einen Screenreader
 * unbenutzbar — das war am 17.08. ein echter Befund. Angesagt wird nur das
 * Ergebnis, einmal.
 */

const ZIEL = "/build-info.json";
const GLEICHZEITIG = 6;

/* Zweisprachig ohne Sprachdatei: Diese Seiten laden bewusst keine
   Uebersetzungs-Maschine (geprueft in e2e/sprachumschalter-unterseiten.test.js).
   Die Sprache kommt aus dem lang-Attribut der Seite selbst — die deutsche und
   die englische Fassung liegen als eigene Dateien vor. */
const TEXTE = {
  de: {
    unmoeglich: "In diesem Browser nicht möglich",
    holen: "$ Fingerabdruck holen …",
    nichtErreichbar: (m) => "Fingerabdruck nicht erreichbar: " + m,
    keineDateien: "Der Fingerabdruck nennt keine Dateien.",
    gescheitert: "Die Prüfung selbst ist gescheitert — das ist kein bestandener Test.",
    veroeffentlicht: "  Veröffentlicht: ",
    fassung: "  Fassung:        ",
    zuPruefen: "  Zu prüfen:      ",
    dateien: " Dateien",
    pruefe: (a, b) => "Prüfe … " + a + " / " + b,
    nichtLadbar: (p, m) => "  nicht ladbar  " + p + " (" + m + ")",
    abweichung: (p) => "  ABWEICHUNG  " + p,
    ok: (p) => "  ok   " + p,
    messproblemZeile: (n) => "Ergebnis: Messproblem — " + n + " Datei(en) nicht ladbar.",
    messproblemSatz: (n) =>
      "Messproblem: " + n + " Datei(en) konnten nicht geladen werden. Das ist kein bestandener Test.",
    abweichungZeile: (n, g) => "Ergebnis: " + n + " Abweichung(en) bei " + g + " Dateien.",
    abweichungSatz: (n, g) => n + " von " + g + " Dateien weichen ab.",
    gutZeile: (n, g) => "Ergebnis: " + n + " von " + g + " Dateien deckungsgleich.",
    gutSatz: (n, f) => "Alle " + n + " Dateien stimmen mit dem offenen Quelltext überein, Fassung " + f + ".",
    nochmal: "Nochmal prüfen",
  },
  en: {
    unmoeglich: "Not possible in this browser",
    holen: "$ fetching fingerprint …",
    nichtErreichbar: (m) => "Fingerprint not reachable: " + m,
    keineDateien: "The fingerprint lists no files.",
    gescheitert: "The check itself failed — that is not a passed test.",
    veroeffentlicht: "  Published:  ",
    fassung: "  Version:    ",
    zuPruefen: "  To check:   ",
    dateien: " files",
    pruefe: (a, b) => "Checking … " + a + " / " + b,
    nichtLadbar: (p, m) => "  not loadable  " + p + " (" + m + ")",
    abweichung: (p) => "  DISCREPANCY  " + p,
    ok: (p) => "  ok   " + p,
    messproblemZeile: (n) => "Result: measurement problem — " + n + " file(s) not loadable.",
    messproblemSatz: (n) => "Measurement problem: " + n + " file(s) could not be loaded. That is not a passed test.",
    abweichungZeile: (n, g) => "Result: " + n + " discrepancy/discrepancies in " + g + " files.",
    abweichungSatz: (n, g) => n + " of " + g + " files differ.",
    gutZeile: (n, g) => "Result: " + n + " of " + g + " files match.",
    gutSatz: (n, f) => "All " + n + " files match the open source code, version " + f + ".",
    nochmal: "Check again",
  },
};

function texte() {
  const l = (document.documentElement.getAttribute("lang") || "de").slice(0, 2).toLowerCase();
  return TEXTE[l] || TEXTE.de;
}

/** Wandelt einen Puffer in die Hex-Schreibweise, wie sie im Fingerabdruck steht. */
async function summeVon(puffer) {
  const roh = await window.crypto.subtle.digest("SHA-256", puffer);
  return (
    "sha256:" +
    Array.from(new Uint8Array(roh))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function initEchtheitspruefung() {
  const knopf = document.getElementById("echtheitKnopf");
  const konsole = document.getElementById("echtheitKonsole");
  const zeilen = document.getElementById("echtheitZeilen");
  const ergebnis = document.getElementById("echtheitErgebnis");
  if (!knopf || !konsole || !zeilen || !ergebnis) return;

  /* Ohne SubtleCrypto geht es nicht — das ehrlich sagen statt still scheitern. */
  if (!window.crypto || !window.crypto.subtle) {
    knopf.disabled = true;
    knopf.textContent = T.unmoeglich;
    return;
  }

  const T = texte();
  const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let laeuft = false;

  function schreibe(text, art) {
    const z = document.createElement("div");
    z.className = "echtheit-zeile" + (art ? " echtheit-zeile--" + art : "");
    z.textContent = text;
    zeilen.appendChild(z);
    /* Nur mitlaufen, wenn niemand reduzierte Bewegung verlangt hat. */
    if (!ruhig) konsole.scrollTop = konsole.scrollHeight;
  }

  async function pruefen() {
    if (laeuft) return;
    laeuft = true;
    knopf.disabled = true;
    knopf.setAttribute("aria-expanded", "true");
    konsole.hidden = false;
    zeilen.textContent = "";
    ergebnis.textContent = "";
    ergebnis.className = "echtheit-ergebnis";

    schreibe(T.holen);
    let info;
    try {
      const antwort = await fetch(ZIEL, { cache: "no-store" });
      if (!antwort.ok) throw new Error("HTTP " + antwort.status);
      info = await antwort.json();
    } catch (err) {
      schreibe(T.nichtErreichbar(err.message), "problem");
      abschluss("messproblem", T.gescheitert);
      return;
    }

    const dateien = Object.entries(info.dateien || {});
    if (!dateien.length) {
      schreibe(T.keineDateien, "problem");
      abschluss("messproblem", T.gescheitert);
      return;
    }

    schreibe(
      T.veroeffentlicht +
        String(info.ausgeliefertAm || "")
          .slice(0, 19)
          .replace("T", " ") +
        " UTC"
    );
    schreibe(T.fassung + (info.commitKurz || "?"));
    schreibe(T.zuPruefen + dateien.length + T.dateien);
    schreibe("");

    let gleich = 0;
    let abweichend = 0;
    let fehler = 0;
    let fertig = 0;

    async function eine([pfad, soll]) {
      try {
        const a = await fetch("/" + pfad, { cache: "no-store" });
        if (!a.ok) throw new Error("HTTP " + a.status);
        const ist = await summeVon(await a.arrayBuffer());
        if (ist === soll) {
          gleich++;
          if (dateien.length <= 12 || fertig % 8 === 0) schreibe(T.ok(pfad));
        } else {
          abweichend++;
          schreibe(T.abweichung(pfad), "problem");
        }
      } catch (err) {
        fehler++;
        schreibe(T.nichtLadbar(pfad, err.message), "problem");
      }
      fertig++;
      knopf.textContent = T.pruefe(fertig, dateien.length);
    }

    /* In kleinen Wellen statt achtzig Anfragen auf einmal. */
    const warteschlange = dateien.slice();
    await Promise.all(
      Array.from({ length: GLEICHZEITIG }, async () => {
        let naechste;
        while ((naechste = warteschlange.shift())) await eine(naechste);
      })
    );

    schreibe("");
    if (fehler > 0) {
      schreibe(T.messproblemZeile(fehler), "problem");
      abschluss("messproblem", T.messproblemSatz(fehler));
    } else if (abweichend > 0) {
      schreibe(T.abweichungZeile(abweichend, dateien.length), "problem");
      abschluss("abweichung", T.abweichungSatz(abweichend, dateien.length));
    } else {
      schreibe(T.gutZeile(gleich, dateien.length), "gut");
      abschluss("gut", T.gutSatz(gleich, info.commitKurz || "?"));
    }
  }

  function abschluss(art, satz) {
    ergebnis.className = "echtheit-ergebnis echtheit-ergebnis--" + art;
    ergebnis.textContent = satz;
    knopf.disabled = false;
    knopf.textContent = T.nochmal;
    laeuft = false;
  }

  knopf.addEventListener("click", pruefen);
}

initEchtheitspruefung();
