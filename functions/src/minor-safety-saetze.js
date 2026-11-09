/* minor-safety-saetze.js — ganze Saetze mit einem Wort der harten Liste
   entfernen (Kinderschutz, 09.11.2026). Die Wortpruefung kommt von
   minor-safety.js herein (hart), damit hier keine zweite Wortliste entsteht. */

module.exports = function saetzeFilter(hart) {
  /* SATZ ENTFERNEN (09.11.2026, Entscheidung des Inhabers): Steht im Text eines
     moeglicherweise minderjaehrigen Profils ein Wort der harten Liste, faellt der
     GANZE Satz weg — kein Halbsatz (die fruehere Sorge in SEC-001 war ein
     unlesbarer Rest). Anlass: drei solche Treffer am 09.11.2026 in Beast-Karten,
     live nicht nachstellbar; das Wort selbst wird bewusst nicht protokolliert.
     Satzgrenze: . ! ? oder … (samt schliessendem Anfuehrungszeichen). Bleibt der
     Treffer ueber eine Satzgrenze hinweg bestehen, faellt der ganze Text. */
  /* Satzgrenze nur, wo nach . ! ? … ein Leerraum und ein Grossbuchstabe (oder
     ein oeffnendes Zeichen) folgt — und nicht nach einer Abkuerzung oder einem
     einzelnen Buchstaben ("z. B. Netflix", "Dr. Kim"). So bleibt ein Wort mit
     Punkt (eis.de) und eine Zahl (3.5) im Satz (Befund der Pruefung, 09.11.). */
  const GRENZE =
    /(?<=[.!?…]["“”»«')]*)(?<!(?:^|[\s(„"])(?:\p{L}|[Cc]a|[Bb]zw|[Uu]sw|[Ee]tc|[Vv]gl|[Ee]vtl|[Gg]gf|[Bb]spw|[Ii]nkl|[Ss]td|[Mm]in|Nr|Dr|St|Mio|Mrd|[Vv]s|[Zz]\.\s?B|[Dd]\.\s?h|[Uu]\.\s?a|[Ee]\.g|[Ii]\.e)\.)\s+(?=[„"“»(\p{Lu}])/u;
  const inSaetze = (text) => text.split(GRENZE);

  function ohneHarteSaetze(text) {
    const saetze = inSaetze(text);
    const rest = saetze
      .filter((satz) => !hart(satz))
      .join(" ")
      .trim();
    return !hart(rest) ? rest : "";
  }

  /* LIVE (09.11.2026): Waehrend der Analyse erscheinen Karten und Fazit, bevor der
     Filter am Ende laeuft — und bevor das Alter feststeht. Eine Karte mit einem
     Wort der harten Liste erscheint deshalb live NICHT (sie kommt am Ende, dann
     bei moeglicherweise Minderjaehrigen ohne den Satz); vom Fazit zeigt die Live-
     Anzeige nur die Saetze VOR dem ersten Treffer. Fuer Erwachsene aendert sich
     am Ende nichts. */
  function liveOhneHarteWoerter(live) {
    if (!live || typeof live !== "object") return live;
    const fazit = (text) => {
      if (typeof text !== "string" || !hart(text)) return text;
      const saetze = inSaetze(text);
      const vorher = [];
      for (const satz of saetze) {
        if (hart(satz)) break;
        vorher.push(satz);
      }
      /* Zur Sicherheit noch einmal als Ganzes pruefen (Wort ueber eine
         Satzgrenze hinweg): dann lieber nichts zeigen. */
      const bis = vorher.join(" ").trim();
      return hart(bis) ? "" : bis;
    };
    const karten = (liste) => (Array.isArray(liste) ? liste.filter((k) => !k || !hart(String(k.wert || ""))) : liste);
    return {
      ...live,
      standard: fazit(live.standard),
      beast: fazit(live.beast),
      kartenStandard: karten(live.kartenStandard),
      kartenBeast: karten(live.kartenBeast),
    };
  }

  return { ohneHarteSaetze, liveOhneHarteWoerter };
};
