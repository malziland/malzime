/* jest.setup.js — Riegel gegen echte Cloud-Dienste in Tests.
 *
 * BEFUND 31.08.2026 (Pruefrunde 3): `functions/src/db.js` hatte als einziger
 * der drei Produktionsdienste keinen Riegel. Ausgefuehrt: Unter Jest lieferte
 * `datenbank()` ein Handle auf die echte Datenbank `malzime-eu` — den Ort, an
 * dem der Einstellungssatz liegt, der die laufende Anwendung steuert.
 *
 * Ein Riegel IN db.js scheitert: Die Tests ersetzen `firebase-admin/firestore`
 * durch Attrappen, und ein Wurf in der Funktion griffe DAVOR — am 31.08.
 * ausprobiert, zwoelf Tests fielen, wieder zurueckgenommen.
 *
 * Deshalb hier, eine Ebene tiefer: `getFirestore` wird global ersetzt. Wer die
 * echte Verbindung braucht, hebt es in seiner Datei auf (jest.unmock oder ein
 * eigener jest.mock). Der Weg bleibt offen — er ist nur nicht mehr der
 * Standard, den man versehentlich nimmt.
 */
jest.mock("firebase-admin/firestore", () => {
  const echt = jest.requireActual("firebase-admin/firestore");
  return {
    ...echt,
    getFirestore: () => {
      throw new Error(
        "Zugriff auf die echte Firestore-Datenbank aus einem Test. " +
          "Entweder das benutzende Modul mocken oder getFirestore in dieser " +
          "Testdatei gezielt ersetzen (siehe functions/jest.setup.js)."
      );
    },
  };
});

/* ZWEITER RIEGEL (07.10.2026): der KI-Dienst.
 *
 * `mistral-http.js` liest den Zugangsschluessel aus der Umgebung. Steht dort
 * ein echter (etwa nach einer Messung in derselben Sitzung), haette ein Test
 * ohne Netz-Attrappe damit eine bezahlte Analyse gestartet — der Dienst war in
 * Tests nur zu, solange zufaellig kein Schluessel gesetzt war.
 *
 * Deshalb gibt es in Tests keinen Schluessel: Beide Namen werden entfernt, bevor
 * eine Testdatei laeuft. Wer einen braucht, setzt in seiner Datei einen
 * erfundenen (wie bisher). Den Wert liest diese Datei nie. */
delete process.env.MISTRAL_API_KEY_EU;
delete process.env.MISTRAL_API_KEY;
