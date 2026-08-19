# Changelog

Alle relevanten Aenderungen an malziME werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

### Behoben

- **Auf iPhones scheiterte das Hochladen ab dem zweiten Bild.** Das erste Foto
  lief durch, das zweite brach mit einer Fehlermeldung ab — für die Person
  davor sah das aus, als sei die Seite kaputt. Gemeldet aus einem Workshop und
  im Protokoll am 19.08. um 07:42 und 07:43 Uhr wiedergefunden.

  Zwei Ursachen, beide behoben. Erstens gab die Seite den Bildtyp fest als JPEG
  an, obwohl der Browser beim zweiten Bild PNG lieferte; die Server-Prüfung,
  die seit August den Inhalt statt der Behauptung bewertet, wies das zu Recht
  ab. Die Seite meldet jetzt den Typ, der tatsächlich entstanden ist,
  Dateiname eingeschlossen. Zweitens wurde der Zeichenbereich nach der
  Umrechnung nicht freigegeben — genau deshalb traf es das zweite Bild und
  nicht das erste. Er wird jetzt sofort geleert.

  Drei Tests halten den Fall fest; ohne die Behebung sind sie rot.

## [3.6.1] — 2026-08-18

### Geändert

- **Der Absatz über die Grenze der Nachprüfbarkeit war zu bescheiden geworden.**
  Er stammte aus der Zeit, als nur die Website mit Prüfsummen belegt war, und
  las sich wie „am Server wissen wir auch nichts". Seit der Server-Code
  ebenfalls Datei für Datei im Fingerabdruck steht, stimmt das nicht mehr.

  Jetzt in drei kurzen Absätzen: Wo wir keinen Zugriff haben. Was wir trotzdem
  zeigen können — nämlich welcher Code dorthin gegeben wurde. Und was niemand
  zeigen kann: dass Googles Rechner genau diesen Code ausführen. Das steht
  ausdrücklich als Stand der Technik da, nicht als übersehene Lücke.

### Hinzugefügt

- **Ein gemeldeter Fehler wird messbar, statt geraten.** Nutzer-Fund: Profil
  laden, Beast-Modus, „PDF speichern", dann im Druckdialog abbrechen — die
  Seite war danach schwarz und leer, erst ein Neuladen half.

  **Der Fehler ließ sich nicht nachstellen** — weder in Chromium noch in
  WebKit, weder über das Druck-Stylesheet noch über den Aufräumweg. Die
  üblichen Verdächtigen scheiden aus: keine hängende Überlagerung, kein
  `backdrop-filter`, keine 3D-Ebene, die klebende Leiste ist unbeteiligt.

  Statt eine Vermutung als Behebung auszuliefern, prüft die Seite nach jedem
  Druckdialog selbst nach, ob der Ergebnisbereich noch sichtbar ist — und
  meldet den Fall mit allen nötigen Angaben, wenn nicht. Beim nächsten
  Auftreten liegt damit ein Befund vor statt einer Beschreibung.

  Dazu ein Wächter, der festhält, was nach dem Abbrechen gelten muss.

## [3.6.0] — 2026-08-18

### Hinzugefügt

- **Die Echtheits-Prüfung läuft jetzt direkt in der Seite.** Ein Klick auf
  „Jetzt hier prüfen" in der Datenschutzerklärung, und der Browser lädt jede
  ausgelieferte Datei, rechnet ihre Prüfsumme neu aus und zeigt das Ergebnis
  Zeile für Zeile in einem kleinen Terminal. Kein Fenster, kein Pop-up, keine
  Installation — und nichts davon wird an uns übertragen. Gemessen: gut eine
  Sekunde für 81 Dateien.

  Das Prüfprogramm liegt selbst im offenen Quelltext und steht selbst im
  Fingerabdruck — es prüft sich mit. Daneben steht offen, warum es den Weg
  über die Kommandozeile trotzdem weiter gibt: Wer diese Website vollständig
  unter Kontrolle hätte, könnte auch ein lügendes Prüfprogramm ausliefern. Der
  Weg aus einer frischen Kopie des Quelltextes ist von dieser Seite unabhängig.

- **Der Fingerabdruck deckt jetzt auch den Server-Code ab.** 80 Website-Dateien
  plus 35 Dateien aus `functions/src/`. Bisher war der Server-Teil nur über den
  Commit benannt — das genügt, solange die Auslieferung an einen
  veröffentlichten Stand gebunden ist, und genau diese Bindung lässt sich mit
  einem Notschalter umgehen. Jetzt ist auch dieser Teil Datei für Datei
  festgenagelt.

- **`build-info.json` erklärt sich selbst.** Wer draufklickt, sah bisher rohe
  Zahlenkolonnen. Jetzt stehen vier Klartext-Felder obenan: was die Datei ist,
  wozu sie dient, wie man selbst nachrechnet, und wo die Grenze liegt.

- **Die Datenschutzerklärung beginnt mit vier Sätzen.** „Das Wichtigste in vier
  Sätzen" — für alle, die schnell eine Antwort brauchen, ohne zehn Abschnitte
  zu lesen. Jede der vier Zusagen ist gegen den Detailteil abgeglichen; eine
  Formulierung war dabei zu vage und wurde nach der strengeren Fassung im
  Detailteil korrigiert.

## [3.5.0] — 2026-08-18

### Behoben

- **Ein wackeliger Prüfriegel.** Der Sprachumschalter-Test wurde im Prüfstand
  rot mit 18 Kontrast-Funden im dunklen Modus — im Wiederholungslauf grün.
  Ursache: Die Warteroutine bricht nach einer Sekunde ab, auch wenn der
  Themenwechsel plus Ergebnis-Einblendung länger braucht; gemessen wurde dann
  mitten im Übergang. Jetzt läuft die Messung doppelt, und nur was beide Male
  auftritt, zählt als Fund. Ein Übergangs-Artefakt schafft das nicht, ein
  echter Verstoß immer.

### Hinzugefügt

- **Die Datenschutzerklärung sagt jetzt, wie man uns überprüft.** Neuer
  Abschnitt „Musst du uns glauben? Nein." — mit dem Link auf den Fingerabdruck
  für alle und den drei Befehlen zum Selbst-Nachrechnen für die, die ein
  Terminal öffnen wollen. Kein Vorwissen, keine Installation.

  Die Grenze steht als eigener, hervorgehobener Absatz und nicht im
  Kleingedruckten: Der letzte Schritt läuft auf Rechnern von Google, und was
  dort im Inneren ausgeführt wird, kann von außen niemand nachrechnen — bei
  keinem Anbieter. Dafür gibt es heute kein Verfahren. Lesbar ist auch dieser
  Teil, er liegt im selben offenen Bauplan.

- **Nachrechenbar, dass live genau das läuft, was offen im Quelltext steht.**
  Bei jeder Auslieferung entsteht `malzi.me/build-info.json`: der Commit, der
  Zeitpunkt und eine Prüfsumme jeder einzelnen Datei, die diese Website
  ausliefert. Welche Dateien das sind, entscheidet nicht das Skript, sondern
  die Ausschlussliste in `firebase.json` — es bricht ab, wenn sie fehlt.

  Nachrechnen geht mit einem Befehl: `sh scripts/pruefe-live.sh` holt den
  Fingerabdruck, prüft ob der genannte Commit im Repository existiert, lädt
  jede gelistete Datei vom Server und vergleicht. Die Rückgabewerte sind
  bewusst getrennt: **0** deckungsgleich, **1** Abweichung gefunden,
  **2** Messproblem. Ein Messfehler darf nie als bestandener Test durchgehen.

  **Was das belegt:** die Seite, die im Browser ankommt. **Was es nicht
  belegt:** was auf den Servern geschieht — deren Software bauen und betreiben
  wir nicht. Das steht so auch in der README, statt einen Beweis zu
  suggerieren, den es nicht gibt.

### Aufgeräumt

- **`queue-prod-test.js` liegt jetzt dort, wo sein eigener Kopf es beschreibt.**
  Das Werkzeug lag in einem eigenen Ordner neben dem Repo, obwohl es seit jeher
  den Aufruf aus dem Repo-Wurzelverzeichnis dokumentierte. Ein Werkzeug, das
  seinen eigenen Ablageort widerlegt, findet niemand wieder.

### Behoben

- **Eine veraltete Zahl im Prüfprotokoll.** In einer Tabellenzelle stand noch
  „15 Zustände, beide Browser", während längst 46 Zustände in drei Browsern
  gemessen wurden. Die Messung war aktuell — der Satz daneben nicht.

  Der Schaden ist größer als die Zahl: Wer in einem Prüfbericht eine falsche
  Angabe findet, glaubt keiner der übrigen. Deshalb prüft jetzt ein Wächter bei
  jedem Testlauf, ob die Zahlen in Bericht, Protokoll und auf der Website mit
  dem übereinstimmen, was tatsächlich gemessen wurde. Er sitzt an der Stelle,
  an der die Zahl entsteht — anderswo hätte er die Rohdaten in der CI nie
  gesehen.

## [3.4.1] — 2026-08-18

### Geändert

- **Die Barrierefreiheitserklärung lädt jetzt ein, statt sich zu entschuldigen.**
  Bisher rechtfertigte sie die fehlenden Hilfsmittel-Durchgänge damit, dass uns
  „diese Geräte nicht zur Verfügung stehen". Jetzt steht dort schlicht, dass
  diese Durchgänge noch nicht abgeschlossen sind — und daneben ein Weg, das zu
  ändern: Rückmeldungen sammeln wir auf GitHub, ohne Konto genügt eine E-Mail.

  Der Aufruf richtet sich an alle, die mit einem Hilfsmittel arbeiten, nicht nur
  an Screenreader-Nutzer — und er stellt keine Bedingungen. Ein erster Entwurf
  hatte von Menschen gesprochen, „die mitreden können"; auf einer Seite über
  Barrierefreiheit ist das genau die falsche Hürde.

- **`/barrierefreiheit` trägt jetzt dieselben Kästen wie alle anderen Seiten**
  (Open Source, Projektunterstützung). Sie war die einzige Seite ohne.

## [3.4.0] — 2026-08-18

Barrierefreiheit: geprüft nach der Methodik des W3C, sechs Mängel behoben.

Der Prüfbericht folgt jetzt **WCAG-EM 2.0** statt einer selbst gewählten Form.
Das ist kein Formalismus — die Methodik verlangt Angaben, die vorher fehlten,
und genau diese Fragen brachten drei ungeprüfte Schritte und einen echten
Kontrastmangel ans Licht.

Die Konformitätsaussage lautet bewusst „weitgehend konform" und nicht
„konform": Alle drei Browser-Maschinen sind geprüft, vier
Hilfsmittel-Kombinationen nicht.

### Behoben — Barrierefreiheit

Sechs Mängel. Zwei fand ein Mensch beim ersten Zuhören mit VoiceOver, zwei fand
ein neu gebautes Messmittel, zwei fielen beim Umbau auf die W3C-Prüfmethodik an.

- **Der Wartezustand wiederholte sich alle zwei Sekunden.** Gemessen: 19 Ansagen
  in 30 Sekunden, bei einer vollen Analyse rund 40 — fast immer derselbe Satz.
  Ursache: Der Wartetext wurde bei **jeder** Statusabfrage neu geschrieben, auch
  unverändert, und jede Zuweisung löst in einem Live-Bereich eine neue Ansage
  aus. Dazu die rotierenden Zier-Meldungen, die sich tatsächlich ändern.

  Jetzt wird nur bei echter Änderung geschrieben, die Rotation ist stumm.
  Gemessen: **19 → 3**.

- **Nach „Analyse abgeschlossen" folgte nichts.** Der Fokus sprang auf den
  Ergebnisbereich — einen Abschnitt ohne Rolle und ohne Namen. Dort hat ein
  Screenreader nichts zu sagen. Jetzt ein benannter Bereich; die Ansage lautet
  „Analyse abgeschlossen · Dein Profil".

- **Die Beispielbilder sagten ihren Ort zweimal.** Der Name des Knopfes setzte
  sich aus dem Alternativtext des Bildes _und_ der sichtbaren Bildunterschrift
  zusammen: „Mit KI erstelltes Beispielbild: Selfie am Stephansplatz. Zeigt keine
  reale Person. Selfie am Stephansplatz." Die Bildunterschrift ist jetzt als
  Zierde ausgezeichnet; sichtbar bleibt sie unverändert.

- **Das Info-Zeichen neben den beiden Profil-Modi war zu blass.** 55 % Deckkraft
  ergaben 2,18 : 1; verlangt sind 4,5 : 1 für den Buchstaben und 3 : 1 für den
  Kreisrand eines Bedienelements. Dass es beim Überfahren mit der Maus voll
  deckend wurde, hilft an Tastatur und Finger nicht. Deckkraft entfernt, die
  Aufhellung läuft über die Farbe: **5,22 : 1** hell, **7,85 : 1** dunkel.

- **Die Trennpunkte in der Fußzeile werden Screenreadern nicht mehr vorgelesen.**
  Sie sind reine Zierde und stehen zwischen Links, die ohnehin getrennt sind.

- **Drei Schritte der Analyse waren nie auf Barrierefreiheit gemessen** —
  Bildvorbereitung, Realitäts-Check und PDF-Ausgabe. Sie laufen jetzt mit.

### Hinzugefügt

- **Prüfbericht nach WCAG-EM 2.0**, der Prüfmethodik des W3C. Sie schreibt vor,
  was ein Bericht enthalten muss: Geltungsbereich, unterstützte Geräte,
  eingesetzte Technologien, begründete Stichprobe und **vollständige Prozesse**
  statt einzelner Zustände. Genau diese Forderung brachte die drei ungeprüften
  Schritte oben ans Licht.

  Die Erklärung auf `/barrierefreiheit` nennt jetzt offen, welche Hilfsmittel
  ungeprüft sind und warum daraus „weitgehend konform" folgt.

- **Wo das Prüfwerkzeug sich enthält, wird nachgemessen.** axe kann manche
  Kontraste nicht beurteilen und meldet sie als „unprüfbar" — das ist kein
  Bestehen. Solche Fälle werden jetzt fotografiert und Bildpunkt für Bildpunkt
  nachgerechnet. Das fand auf Anhieb das zu blasse Info-Zeichen.

- **Vier Wächter gegen genau diese Fehlerklassen:** Häufigkeit der Ansagen,
  Name des Ergebnisbereichs, Kontrast bei Werkzeug-Enthaltung, und Ansagen, die
  sich in sich selbst wiederholen. Jeder mit Positivkontrolle und Rückbauprobe —
  ein Prüfmittel, das nie anschlägt, und eines, das immer anschlägt, sind gleich
  wertlos.

- **Zwei wackelige Prüfungen entwackelt.** Eine Zusicherung wählte über einen
  Komma-Wähler „das erste Element im Dokument" statt „das mit Inhalt" und wurde
  auf Firefox rot, obwohl die Seite in Ordnung war; eine zweite konnte praktisch
  nicht fehlschlagen. Ein wackeliger Riegel ist schlimmer als keiner — er wird
  irgendwann übergangen, und dann fängt er auch die echten Fälle nicht mehr.
  Gewartet wird jetzt auf die Bedingung statt auf die Uhr.

- **Ein Protokoll der Vorlese-Reihenfolge** über alle Seiten und Zustände: jedes
  Element mit Rolle, Name und Zustand, in der Reihenfolge, in der es gesprochen
  würde. Ergebnis: kein Bedienelement ohne Namen, kein Bild ohne Alternativtext.

## [3.3.2] — 2026-08-17

### Hinzugefügt

- **Barrierefreiheitserklärung unter `/barrierefreiheit`.** malziME ist gegen
  WCAG 2.2 Stufe AA geprüft — messend, nicht behauptend. Von 55 Erfolgskriterien
  sind 40 nachgewiesen erfüllt, 11 nicht anwendbar, 4 maschinell erfüllt mit
  offener Handprüfung. Kein Kriterium ist als verletzt festgestellt.

  Die Seite nennt die bekannten Einschränkungen offen: den eingebrannten
  KI-Hinweis in den Demo-Fotos, die nicht angestrebte Stufe AAA, die fremde
  Landkarte. Und sie sagt, was **nicht** eingesetzt wird — kein Overlay, kein
  gekauftes Siegel.

  Drei Rechtsaussagen sind an Primärquellen belegt: die Ausnahme für
  Kleinstunternehmen nach § 6 Abs. 1 BaFG, das Schlichtungsverfahren beim
  Sozialministeriumservice (es betrifft das Behindertengleichstellungsrecht,
  **nicht** das BaFG-Beschwerdeverfahren — die Seite unterscheidet das) und
  Artikel 50 der EU-KI-Verordnung, gültig seit 2. August 2026.

  Nicht öffentlich, aber vorhanden: das vollständige Prüfprotokoll über alle 55
  Kriterien mit Prüfweg und Ergebnis je Zeile.

### Behoben — Bedienung mit der Tastatur

- **Der Sprachumschalter war auf Safari mit der Tastatur nicht erreichbar.**
  WCAG 2.1.1, **Stufe A** — die grundlegendste. Safari springt ohne „Vollzugriff
  Tastatur" nicht auf Knöpfe; im Projekt gilt deshalb die Regel, dass jedes
  Bedienelement ein ausdrückliches `tabindex="0"` braucht. Ein Test erzwingt sie
  seit Langem, aber nur für die statische Startseite. Die Knöpfe des Umschalters
  entstehen im JavaScript und hatten keines — sieben Stück in zwei Dateien.

  **Warum die Tests das nicht fanden:** Der automatische Tastatur-Durchgang war
  grün. Playwrights WebKit springt auf Knöpfe unabhängig von Safaris
  Einstellung — der Test kann diesen Fehler grundsätzlich nicht zeigen. Gefunden
  hat ihn ein Nutzer in einer Minute.

  Der neue Wächter prüft deshalb die **Struktur** statt das Springen: Trägt jedes
  sichtbare Bedienelement `tabindex="0"`, nachdem das JavaScript gelaufen ist?
  Über sechs Seiten, den Umschalter und den geöffneten Dialog.

- **Der Rücksprung zur Startseite war auf allen Unterseiten nicht erreichbar.**
  Derselbe Grund, fünf Seiten betroffen. Diesen Fall fand der neue Wächter
  sofort — niemand hatte ihn bemerkt.

### Behoben — Anzeige und Analyse

- **Kein waagrechtes Scrollen mehr bei 320 Pixel** (WCAG 1.4.10). Die
  Nutzungsbedingungen standen bei 333 Pixel, weil die ODR-Adresse der EU 34
  Zeichen ohne Leerstelle hat und nicht umbrechen konnte; die Profil-Seite bei
  324, weil eine Wert-Plakette die Zeile aufschob. Dahinter lag eine dritte
  Ursache: Die geklebte Umschalt-Leiste zog mit fest verdrahteten 20 Pixeln über
  den Rand, während die Seitenpolsterung bei schmalen Bildschirmen auf 16 fällt.
  Beide Werte kommen jetzt aus **einer** Quelle.

- **Jedes Bedienelement hat einen eigenen Fokus-Rahmen.** Auf den Rechtsseiten
  trugen 7 von 12 bis 20 Elementen nur den Standardrahmen des Browsers. Sichtbar
  war er, aber sein Aussehen entscheidet jeder Browser selbst.

- **Abkürzungen werden vorgelesen.** EXIF, GPS, DSGVO, KI, IP und PDF tragen nun
  ihre Langform für Screenreader. Der sichtbare Text ist dabei byte-identisch
  geblieben — an den Rechtstexten ändert sich optisch nichts.

- **Die eigene KI-Kennzeichnung fließt nicht mehr in die Analyse.** Der Prompt
  verlangte „jeden sichtbaren Text, auch Bildunterschriften" — die in die
  Demo-Fotos gebrannte Pflichtkennzeichnung ist eine solche und landete damit in
  der Profilerstellung. Jetzt zwei Riegel: eine Anweisung im Prompt (deutsch und
  englisch) und ein Eintrag im bestehenden Wasserzeichen-Filter, der bisher nur
  fremde Stockfoto-Wasserzeichen kannte.

### Geändert

- **Der Wächter für Barrierefreiheit sah einen ganzen Bildschirmteil nicht.**
  Sein Testprofil setzte kein `subject`, dadurch erschien der Realitäts-Check
  nie und wurde nie gemessen.

- **Die Dateiliste des Auslieferungs-Skripts wird gegen die Wirklichkeit
  geprüft.** Die neue Seite stand nicht darin — ihr Verweis auf das Stilblatt
  wäre eingefroren, während alle anderen weiterzählen. Zwei feste Listen, die
  niemand vergleicht, driften gemeinsam ab; jetzt fragt der Test das Dateisystem.

## [3.3.1] — 2026-08-17

### Hinzugefügt

- **Der Beweis, dass live läuft, was offen liegt.** Offener Quelltext sagt, was
  laufen _könnte_ — nicht, was läuft. Für das Frontend, auf dem die
  Datenschutz-Zusagen beruhen, ist die Lücke jetzt geschlossen.

  Bei jedem Ausliefern entsteht `/build-info.json` mit Commit, Zeitpunkt,
  Cache-Buster und einer SHA-256-Prüfsumme **jeder** ausgelieferten Datei
  (aktuell 79 Dateien, 11 KB). Wer nachrechnen will, braucht einen Befehl:
  `sh scripts/pruefe-live.sh`.

  Drei Dinge waren dabei wichtiger als die Erzeugung selbst:

  Die **Reihenfolge im Deploy** — der Fingerabdruck entsteht NACH der
  Cache-Buster-Ersetzung. Andersherum stünden dort die Prüfsummen des Zustands
  davor, und jede Nachprüfung meldete Abweichungen, wo keine sind. Ein Beweis,
  der falsch Alarm schlägt, wird nach kurzer Zeit ignoriert.

  Die **Ausschlussliste** wird aus `firebase.json` **gelesen**, nicht
  abgeschrieben. Sonst behauptete der Fingerabdruck etwas über Dateien, die
  Firebase gar nicht ausliefert — Tests, versteckte Dateien, Demo-Originale.

  Die **Trennung von Befund und Messproblem**: `0` deckungsgleich, `1`
  Abweichung, `2` kein Netz. Belegt an einem lokalen Server, alle drei Fälle
  einzeln nachgemessen. Ein Messfehler darf nie als Befund durchgehen.

  Was das nicht beweist, steht ausdrücklich in der README: was auf dem **Server**
  passiert. Die Cloud Functions baut Google; eine nachrechenbare Bestätigung
  dafür gibt es nicht. Der beweisbare Teil ist beweisbar gemacht, der Rest wird
  benannt statt behauptet.

- **`scripts/vor-dem-push.sh` — die Pipeline in wenigen Sekunden vorweggenommen.**
  Am 13. August gingen drei Pipeline-Läufe rot; zwei davon waren reine
  Nachlässigkeit (Format nicht gelaufen, die vendorierte Kopie statt der Quelle
  bearbeitet). Beide hätte dieses Skript gefangen. Es fährt genau die billigen
  Prüfungen der drei Jobs `test-frontend`, `test-backend` und `pruefungen` ab
  und nennt bei jedem Mangel den Job, der ohne ihn rot würde.

  Nachgemessen: **13 Prüfungen in 6 bis 7 Sekunden.** Ein roter Pipeline-Lauf
  kostet dagegen Push, dreieinhalb Minuten Warten, Protokoll lesen, beheben und
  dasselbe noch einmal.

  Die langen Suiten fehlen bewusst — sie laufen lokal so lang wie in der
  Pipeline, weil GitHub sie auf mehrere Maschinen verteilt. Dafür bleibt
  `scripts/pruefstand.sh` der Lauf vor einem Release.

  **Der Wächter dazu ist wichtiger als das Skript:** `vor-dem-push-script.test.js`
  liest die Workflow-Datei und das Skript und meldet jeden Pipeline-Schritt, den
  das Skript nicht kennt. Ohne ihn würde es beim ersten neuen CI-Schritt zur
  Beruhigungspille — „alles grün" für etwas, das es nicht mehr prüft. Jede
  bewusste Auslassung braucht eine Begründung, auch das prüft ein Test.

### Geändert

- **Der Live-Text überlebt jetzt einen Verbindungsabbruch.** Bisher räumte ein
  Abbruch Karte und Text weg und stellte eine Fehlermeldung hin. Aus Nutzersicht
  sah das nach Datenverlust aus, obwohl serverseitig nichts verloren war — das
  Ergebnis liegt rund zwei Stunden bereit. Jetzt wird pausiert statt abgeräumt:
  Der Text bleibt gedämpft stehen, die Begründung trägt die Statuszeile.

  Zwei Zusicherungen dazu stehen als Prüfung, nicht als Vorsatz: **Was schon
  gelesen wurde, wird nie umgeschrieben** (eine Welle wird nur übernommen, wenn
  sie mit dem bereits Getippten beginnt), und **es geht wirklich weiter** — die
  Schleife tippt an derselben Stelle wieder los.

- **„Erscheint automatisch, sobald du wieder online bist" stimmt jetzt.** Diese
  Zusage stand seit Langem in der Fehlermeldung, war aber ungedeckt: Es lauschte
  niemand auf „online", und die Wiederaufnahme setzte den Live-Text zurück und
  fragte ohne ihn weiter. Nachgerüstet sind alle drei Teile — der Lauscher, die
  Fortsetzung des Textes und ein Anker im Zustand, der den offenen Durchgang
  überhaupt erst auffindbar macht.

  Dazu: Ein zweiter Abbruch während der Wiederaufnahme wirft die Job-Nummer
  nicht mehr weg. Sie ist der einzige Weg zurück zu einem fertigen Profil.

- **Die Formulierungs-Sperrliste prüft jetzt auch Englisch.** Sie kannte nur
  deutsche Wendungen — deshalb stand die englische Fassung einer gesperrten
  Zusage seit dem ersten Release unbemerkt da, ein halbes Jahr lang. Vier
  englische Regeln ergänzt; die Rückbauprobe belegt, dass sie den echten Fall
  fangen.

- **Der Fakten-Wächter bewacht 14 statt 4 Fakten.** Vier waren zu wenig: Er
  meldete zuverlässig „kein Drift", und das klang wie eine Aussage über die
  Doku. Es war eine über vier Zeilen.

  Beim Anlegen zeigte sich zweierlei. Zwei Muster trafen ins Leere und wären
  stumme Wächter geblieben — repariert. Zwei weitere meldeten **Historie als
  Drift** (ein alter Vergleichsbericht, die Rückbau-Anweisungen im RUNBOOK, wo
  abweichende Werte richtig sind) und mussten wieder heraus. Lieber vierzehn
  verlässliche Muster als sechzehn mit zwei Lügen.

### Behoben

- **Die Analyse hatte eine Zeitgrenze, die sie gar nicht einhalten konnte.**
  Gemeldet wurden abgebrochene Analysen und lange Wartezeiten. Am
  30-Tage-Diagnose-Bucket nachgemessen: Der KI-Aufruf durfte **8000 Token**
  schreiben, wurde aber nach **90 Sekunden** abgebrochen. Das Modell schreibt
  gemessen mit 47 Token/s (langsamster Lauf 39,4) — 8000 Token brauchen also
  rund 170 Sekunden. Die erlaubte Textmenge passte nie in die erlaubte Zeit.

  Aufgefallen ist es erst jetzt, weil die Grenze bis v3.0.0 gar nicht zubiss:
  Ohne Stream wird die Uhr schon nach den Antwortkopfzeilen abgeräumt, das
  eigentliche Warten lief ungebremst. Der Live-Text hält sie bewusst scharf bis
  zum letzten Zeichen — und schaltete damit eine seit Mai schlafende Grenze zum
  ersten Mal wirksam:

  | Zeitraum                    | Läufe | technische Fehler | Läufe über 90 s            |
  | --------------------------- | ----- | ----------------- | -------------------------- |
  | vor v3.0.0 (19.07.–11.08.)  | 121   | 0                 | 8 — **alle wurden fertig** |
  | nach v3.0.0 (11.08.–16.08.) | 28    | 2 (7,1 %)         | 3                          |

  Jetzt hat der Single-Large-Aufruf ein eigenes, gemessenes Zeitbudget (150 s
  statt 90 s), und die Textmenge ist auf 5000 Token gesetzt — reichlich über dem
  längsten je gemessenen Lauf (4394 Token). Beide Werte stehen nebeneinander in
  `config.js` und werden **gegeneinander gerechnet**: Die Startprüfung wirft, und
  `mistral-zeitbudget.test.js` wird rot, sobald jemand einen der beiden allein
  verschiebt. Genau diese Rechnung hatte gefehlt — einzeln sah jeder Wert
  plausibel aus, und daran sind zwei Audits vorbeigelaufen.

- **Der abgebrochene Lauf schlug keinen Alarm — der Ersatz-Werbeaufruf schon.**
  Die gescheiterte Analyse wurde ohne Severity festgehalten und fiel damit nicht
  unter die aktive Alarm-Richtlinie (`malziME Function Errors`, deckt
  `processjob` ab `severity>=ERROR` ab). Zwei tote Läufe (11.08., 14.08.) haben
  so niemanden erreicht; gefunden wurden sie, weil sich ein Nutzer beschwerte.
  Jetzt `console.error` mit `alert: "single-large-failed"` und dem Fehler-Code,
  der „Modell zu langsam" von „API weg" unterscheidet.

- **Die Meldung über eine abgerissene Verbindung brauchte die abgerissene
  Verbindung.** Client-Fehler gingen per `fetch` raus, und ein Fehlschlag dabei
  wurde still verschluckt. Damit blieb ausgerechnet die häufigste Fehlerklasse
  systematisch unsichtbar: In 30 Tagen lagen **zwei** Client-Fehler im Bucket,
  obwohl mehrere gemeldet wurden.

  Jetzt wartet eine misslungene Meldung in einer Warteschlange und wird beim
  Ereignis „wieder online" sowie ein letztes Mal beim Verlassen der Seite
  nachgeschickt. Ein 4xx wird nicht wiederholt (der Server will sie nicht), ein
  5xx schon. Die Warteschlange liegt **ausschließlich im Arbeitsspeicher** — im
  Browser wird dafür nichts abgelegt, und ein Test hält das fest. Der Preis ist
  ehrlich benannt: Wer den Tab schließt, während das Netz weg ist, dessen
  Meldung ist verloren.

- **Die Karte „technischer Fehler" wurde nirgends als Fehler gezählt.** Ein
  `blocked`-Ergebnis lief ausschließlich als Erfolg durch die Telemetrie. Der
  für den Nutzer sichtbarste Fehler war damit der einzige ohne Fehlermeldung.
  Jetzt löst er eine aus, mit dem Grund im Gepäck.

- **Von der englischen Startseite landete man überall wieder auf Deutsch.** Die
  Sprachwahl liegt im `sessionStorage` — bewusst pro Tab, damit ein
  weitergereichtes Workshop-Gerät wieder in der Gerätesprache startet. Ein mit
  `target="_blank"` geöffneter Tab bekommt aber einen **leeren**
  `sessionStorage`. Gezählt über alle Seiten: **6 interne Links öffnen einen
  neuen Tab — und alle sechs sitzen auf der Startseite**, es sind also genau
  die, die von dort wegführen. Die 28 Links auf den Unterseiten öffnen im selben
  Tab und waren nie betroffen.

  Jetzt hängt die Übersetzungs-Routine die aktuelle Sprache an genau diese Links
  (`/stats?lang=en`). Kein Speicher, keine Schnittstelle — die Sprache reist
  sichtbar in der Adresse mit, und sie schlägt beim Seitenstart alles andere.
  Die kanonischen Adressen bleiben parameterfrei, für Google ändert sich nichts.

- **Bild-Metadaten für strukturierte Daten vervollständigt.** Die Google Search
  Console meldete zwei nicht kritische Befunde: In den drei
  `ImageObject`-Blöcken fehlten `license` und `acquireLicensePage`. Beide sind
  ergänzt — `license` zeigt auf die MIT-Lizenz im Repository, für
  `acquireLicensePage` verlangt Google eine Seite, auf der man erfährt, wie man
  eine Lizenz bekommt: das Impressum mit den Kontaktdaten.
  `strukturdaten-bilder.test.js` prüft dauerhaft, dass alle sechs Felder da
  sind, dass es URLs sind, dass die verlinkte Seite existiert und dass sie
  tatsächlich eine Kontaktmöglichkeit trägt.

- **Die Sicherheitsrichtlinie behauptete zwei Dinge, die nicht stimmten.**
  Aufgefallen, nachdem die Doku als Ganzes in Zweifel gezogen wurde — zu Recht.

  `SECURITY.md` nannte als KI-Anbieter „Large 3 + Small 4". Am Live-Log
  nachgemessen: In den letzten 30 Tagen hat ausschließlich
  `mistral-large-2512` Bilder gesehen; `mistral-small-2603` steckt nur im
  Rückfallpfad hinter einem Merkmals-Schloss und lief kein einziges Mal.

  Schwerer wiegt die zweite Stelle: Dort stand die englische Fassung genau
  jener GPS-Zusage, die in den eigenen Formulierungsregeln gesperrt ist — sie
  behauptete, die Koordinaten blieben im Browser. Sie gehen für die
  Ortsauflösung an OpenStreetMap Nominatim: Sie erreichen unsere Server nie,
  verlassen den Browser aber sehr wohl. Der Wortlaut steht bewusst nicht hier —
  die Sperrliste würde ihn auch im Zitat beanstanden, und das ist richtig so.

### Entfernt

- **Der `localStorage` — die Datenschutzerklärung sagt zu, keinen zu nutzen.**
  Seit v3.3.0 legte der Sprachumschalter bei **jedem** Besucher den Eintrag
  `malzime-umschalter-aktiv` an, damit die Rechtsseiten erfahren, dass der
  DE/EN-Umschalter im Betrieb ist (sie öffnen in einem neuen Tab und bekommen
  einen leeren `sessionStorage`). Live nachgemessen: Das Merkmal ist an, der
  Eintrag entstand also wirklich bei allen. Inhaltlich harmlos — für alle
  Besucher derselbe Wert, keine Kennung, nicht zum Wiedererkennen geeignet —
  aber die Zusage war unzutreffend.

  Behoben wurde der **Code**, nicht der Rechtstext. Mit entfernt sind die beiden
  Türen, mit denen sich der Umschalter vor seiner Freischaltung vorführen ließ:
  das Adress-Anhängsel `?sprachumschalter=1` und der Konsolen-Aufruf
  `malziME.sprachumschalter()`. Sie stammten aus der Zeit vor v3.3.0; seit der
  Umschalter live ist, führen sie an einem offenen Zimmer vorbei.

  Die Rechtsseiten zeigen den Umschalter jetzt schlicht immer — **ohne** dafür
  eine Schnittstelle aufzurufen. Diese Festlegung („eine Rechtsseite macht
  keinen Netzweg auf") bleibt unangetastet; auf Startseite und Zahlen-Seite
  entscheidet weiterhin allein das Merkmals-Schloss.

  Nachgemessen: **null `localStorage`-Zugriffe** im gesamten Frontend
  (Positivkontrolle: dieselbe Suche findet 23 `sessionStorage`-Zugriffe). Drei
  Prüfungen halten das fest — eine im Unit-Test, zwei im E2E-Test, die auf den
  Rechtsseiten beide Speicher als leer nachweisen.

  Nebenbei stimmte `docs/FLAGS.md` nicht mit dem Code überein: Dort stand, die
  Erprobungs-Tür „überlebt kein Neuladen" — der `localStorage` machte daraus
  geräteweit und dauerhaft. Mit dem Rückbau ist auch diese Abweichung weg.

## [3.3.0] — 2026-08-13

**Der Sprachumschalter — sichtbar.**

Nach einem Tag Vorbereitung hinter einem Merkmals-Schloss und vier Runden
Nachbesserung am gemeinsamen Durchspielen ist der DE/EN-Umschalter für alle
Besucher da. Die englische Fassung selbst war schon vorher erreichbar
(`?lang=en`, Gerätesprache) — gefehlt hat das Bedienelement.

Zusätzlich in diesem Zug: alle Seiten auf dieselbe Inhaltsbreite (680 px), der
Umschalter auf einer Linie mit der Kopfzeile, und acht ernste
Barrierefreiheits-Verstöße auf den Rechtsseiten behoben, die nie jemand gesehen
hatte.

### Hinzugefügt

- **Sprachumschalter DE/EN — vollständig vorbereitet, aber noch unsichtbar.**
  Rechts oben auf der Startseite, im malziland-Design. Grundstellung des
  Merkmals `useSprachumschalter` ist **aus**: Dann entsteht das Bedienelement
  gar nicht erst im Dokument — ein sichtbarer, wirkungsloser Schalter wäre
  schlimmer als keiner. Die englische Fassung selbst hängt nicht daran; sie ist
  über `?lang=en` und die Gerätesprache seit jeher erreichbar.

  Zum Erproben auf der echten Seite: `malziME.sprachumschalter()` in der
  Browser-Konsole blendet ihn nur im eigenen Tab ein.

  Verhalten: Auf der leeren Seite wird sofort umgeschaltet. Läuft eine Analyse
  oder liegt ein Profil vor, kommt eine Rückfrage — in der **aktuellen**
  Sprache, damit „Abbrechen" wirklich nichts hinterlässt. Wer bestätigt, startet
  dieselbe Datei neu; das Bild liegt noch im Browser, es muss nichts erneut
  ausgewählt werden. Einen Weg, einem laufenden Auftrag nachträglich eine andere
  Sprache zu geben, gibt es bewusst nicht: Er spart Bruchteile eines Cents und
  kostet einen Endpunkt samt Ticket-Prüfung, Transaktion und Missbrauchsdeckel.

  Die Wahl überlebt ein Neuladen (`sessionStorage`), aber nicht den Tab — wie
  beim Beast-Modus startet jedes weitergereichte Gerät im Workshop wieder in
  der Gerätesprache.

  **Auf jeder Seite.** `stats.html` ist übersetzt und bekommt denselben
  Umschalter. Datenschutzerklärung, Impressum und Nutzungsbedingungen liegen
  bisher nur auf Deutsch — dort steht der Schalter ebenfalls, zeigt aber immer
  DE (er sagt aus, in welcher Sprache das dasteht, was man liest) und öffnet
  beim Klick auf EN einen **zweisprachigen** Hinweis. Zweisprachig, weil wer
  auf EN klickt kein Deutsch liest. Diese Übergangslösung
  (`js/sprachhinweis.js`) verschwindet vollständig, sobald die Texte übersetzt
  sind; ein Test macht ihre Ausnahme im i18n-Wächter ab diesem Tag zum Fehler
  und nennt beim Namen, was zu entfernen ist.

  Die drei Rechtsseiten laden weiterhin **keine** Sprachdatei und rufen **keine**
  Schnittstelle auf — beides ist jetzt eine geprüfte Eigenschaft. Ob der
  Schalter dort erscheint, entscheidet allein die Adresse oder eine Spur, die
  die Startseite im selben Tab hinterlassen hat.

  **Zwei Türen zum Erproben**, beide nur im eigenen Tab: `?sprachumschalter=1`
  in der Adresse und `malziME.sprachumschalter()` in der Konsole. Die Adresse
  ist der wichtigere Weg — auf iPhone und iPad gibt es keine Konsole, und genau
  dort entscheidet sich, ob ein Daumen den Schalter trifft.

  Barrierefreiheit wurde nicht behauptet, sondern gemessen: Fokus-Käfig aus
  `inert` **plus** Umbruch am Listenrand (`inert` allein lässt den Fokus hinter
  dem letzten Knopf in die Browserleiste entkommen), Rücksprung auf den
  auslösenden Schalter, Ziel-Größen 44 px, Kontrast ≥ 4,5:1 in hell **und**
  Beast-Modus, `lang`-Attribut an jedem Knopf (sonst liest ein deutscher
  Screenreader „English" deutsch vor), Ansage des vollzogenen Wechsels.
  Geprüft über die ganze Matrix: 2 Sprachen × 2 Themen, Rückfrage offen und zu.

  Zur Ziel-Größe eine Korrektur am eigenen ersten Entwurf: `min-height: 44px`
  machte aus der schlanken Pille einen 108×52-Klotz, der mit dem abgenommenen
  Entwurf nichts mehr zu tun hatte. Die Regel meint aber die **tastbare**
  Fläche, nicht die sichtbare — ein unsichtbares Feld über dem Knopf bringt den
  Daumen-Treffer, das Aussehen bleibt der Entwurf (sichtbar 50×30, tastbar 44).
  Der Test misst seither mit `elementFromPoint`, was wirklich getroffen wird,
  statt der Kastengröße.

- **Links im Fließtext der Rechtsseiten sind unterstrichen**
  (`A11Y-2026-08-13-01`, WCAG 1.4.1). Sie waren allein an der Farbe erkennbar —
  8 ernste axe-Verstöße, die nie jemand gesehen hat, weil die bestehende
  axe-Prüfung nur die Startseite abdeckt. Gefunden durch die neue Prüfung der
  Unterseiten, nicht durch die Änderung selbst verursacht.

### Behoben

- **Alle Seiten haben dieselbe Inhaltsbreite.** Die Rechtsseiten standen auf
  640 px, Start- und Zahlen-Seite auf 680 px — 40 px Unterschied ohne
  dokumentierten Grund und zu wenig, um typografisch etwas zu bewirken. Jetzt
  überall 680 px, ausgehend von der Startseite.

- **Der Umschalter sitzt auf der Zeile der Rubrik.** Auf den Unterseiten stand
  er über „malziME · Statistik" statt daneben und wirkte wie ein loses Element.
  Rubrik und Umschalter teilen sich jetzt eine Kopfzeile, auf gleicher Mitte.

- **Der Umschalter stand über der Kopfzeile statt darin, und war zu hoch.**
  Gemessen: Das SYSTEM-AKTIV-Abzeichen ist 130 × 28 px, der Umschalter war
  108 × 38 px und saß 42 px darüber — das sah nach zwei verschiedenen Dingen
  aus statt nach einer Kopfzeile. Jetzt 94 × 27 px auf derselben Oberkante, am
  anderen Rand. Tastbar bleiben es 44 × 44 px.

- **Der zweisprachige Hinweis hatte zwei gleichrangige Überschriften.** Deutsch
  und Englisch standen in gleicher Größe und Fettung untereinander und stritten
  optisch um den Rang. Die englische Zeile ist jetzt eine zurückgenommene
  Übersetzung — und der Dialog hat wieder genau eine Überschrift, wie es sich
  gehört.

- **Safari verliert den Fokus aus dem Dialog — und findet nicht zurück**
  (`A11Y-2026-08-13-02`). Gemessen in WebKit 26.5, der Maschine hinter Safari
  auf iPhone und iPad. Safari setzt den Fokus ohne „Vollzugriff Tastatur" gar
  nicht erst auf Knöpfe; wer aus der Rückfrage heraustabbte, landete im Nichts
  und kam nicht mehr hinein. `inert` und der Umbruch am Listenrand allein
  reichen dafür nicht — es braucht ein Netz, das den Fokus zurückholt. In
  Chromium war das Verhalten nicht zu sehen.

  Zweiter WebKit-Fund: Ein Klick fokussiert dort den Knopf nicht, deshalb
  landete auch der Rücksprung nach dem Schließen im Leeren. Der auslösende
  Knopf wird jetzt ausdrücklich gemerkt statt über `document.activeElement`
  erraten.

  **WebKit läuft ab sofort in der Pipeline mit** — als eigener Lauf über die
  Umschalter-Tests. Das offizielle Playwright-Abbild bringt die Maschine ohne
  Zusatzinstallation mit.

- **Nach einem Neuladen versprach der Wechsel eine unmögliche Analyse.** Die
  Seite holt das Ergebnis zurück, die Bilddatei überlebt aber kein Neuladen —
  ein File-Objekt lässt sich nicht speichern. Die Rückfrage sagte trotzdem „die
  KI schaut dein Foto noch einmal an", und der Wechsel lief stillschweigend ins
  Leere. Jetzt wird das Profil gelöscht und man landet auf einer sauberen
  Startseite; der gemerkte Auftrag wird dabei verworfen, sonst holt ihn der
  nächste Seitenaufruf zurück. Vom Betreiber gefunden, nicht von den Tests —
  die hatten das falsche Verhalten sogar festgeschrieben.

- **Stehende Meldungen wechselten die Sprache nicht mit.** Eine Fehlermeldung
  („Die KI ist gerade überlastet…") blieb wortgleich stehen, während die Seite
  auf Englisch umschaltete. `setStatus` merkt sich jetzt den Textschlüssel, und
  jeder Sprachwechsel schreibt die Zeile neu — der Fehlercode bleibt erhalten.
  Gefunden bei einem systematischen Durchgang durch **alle** Zustände der
  echten Anwendung, nicht durch die drei Zustände des Entwurfs.

- **Die Rückfragen waren zu lang und sahen gleich aus.** Zwei Dialoge mit
  demselben Titel und je rund 60 Wörtern — im Workshop liest die niemand. Jetzt
  gilt: Die Überschrift nennt das Vorhaben („Auf Englisch wechseln?"), darunter
  steht **ein** Satz mit der Folge, und der Bestätigungsknopf heißt in allen
  Fällen gleich. Zwei Tests halten Länge und Gleichförmigkeit fest.

  Ein Zwischenstand hatte die Löschwarnung als Überschrift — vor jemandem, der
  nur die Sprache wechseln wollte, stand damit eine Schreckmeldung ohne
  Zusammenhang, und der Knopf hieß „Neu analysieren", obwohl nach einem
  Neuladen gar nichts analysiert werden kann. Die Hervorhebung sitzt jetzt im
  Folgesatz, nicht im Titel.

- **Das Deploy-Skript schrieb in Fließtext hinein** (`OPS-2026-08-13-01`). Der
  Cache-Buster wurde mit dem Muster `?v=` plus beliebig vielen Ziffern ersetzt —
  „beliebig viele" schloss **null** ein. Damit traf die Ersetzung auch ein nacktes
  `?v=` in einem gewöhnlichen Satz. Beim Hosting-Deploy vom 12. August ist genau
  das passiert: Der Kommentar über `DEMO_BUSTER` in `public/js/demo.js` wurde
  stillschweigend verunstaltet. Sichtbar war das nur im Quelltext, nie auf der
  Seite. Das Muster verlangt jetzt mindestens eine Ziffer.

  Der neue Wächter `deploy-buster-script.test.js` liest das Muster **aus der
  echten Skriptdatei** und wendet es mit `sed` an — eine Kopie im Test wäre grün
  geblieben, während das Skript wegdriftet. Er prüft zusätzlich, dass beide
  Plattform-Zweige (GNU und BSD) denselben Ausdruck tragen, und enthält eine
  Rückbauprobe mit dem alten Muster, die den eingetretenen Fehler nachstellt.

### Sonstiges

- Cache-Buster `2026081303` nachgetragen. Er ging beim Deploy vom 12. August live,
  war aber nie eingecheckt: Aus dem Repository allein ließ sich nicht ablesen, was
  online steht.

## [3.2.0] — 2026-08-13

**Der Kurzaudit und das zweite TIEF-Audit — restlos saniert.**

Am selben Tag zwei Prüfungen: zuerst ein Kurzaudit der frischen Nachtarbeit, dann
ein vollständiges TIEF-Audit über den ganzen Bestand.

### Vorlauf — der Kurzaudit (vier Befunde, sofort behoben)

Ein Kurzaudit fand vier P3-Schwächen in den Werkzeugen der Nacht:

- Der Vendorierungs-Wächter sah **neue** Dateien in der Quelle nicht
  (`TEST-2026-08-13-33`) — er verglich nur die bereits gestempelten. Jetzt über die
  Vereinigung beider Seiten.
- `deploy.sh` zählte den Cache-Buster bei **jedem** Aufruf hoch
  (`OPS-2026-08-13-34`) — ein reiner Functions-Deploy veränderte sechs
  Hosting-Dateien, die dann unausgeliefert im Arbeitsbaum lagen. Der Buster läuft
  jetzt nur noch, wenn Hosting im Deploy-Ziel steht.
- Die Verifikationsmatrix ordnete ein Prüfgate dem falschen CI-Job zu (Rückfall
  von `DOC-2026-08-12-07`) — und der frisch geschriebene Test konnte das nicht
  sehen, weil er nur die **Existenz** eines Jobs prüfte, nicht die **Zuordnung**.
  Beides behoben.
- Der Release-Wächter schluckte einen Messfehler bei der Elternstand-Bestimmung
  (`OPS-2026-08-13-35`) und wäre auf Verdacht weitergelaufen. Jetzt bricht er ab.

### Das TIEF-Audit — sieben unabhängige Prüfer, ~48 Befunde

Ein vollständiges TIEF-Audit über die Nachtarbeit des Vortags und den ganzen
Bestand: sieben bereichs-disjunkte Prüfer (Sicherheit/Datenschutz, Korrektheit/Queue,
Betrieb/Observability, Frontend/Verträge, Außenzusagen, Auslieferungskette,
Regressionsfläche), jeder mit Positivkontrollen und Selbstwiderlegung.

**Das Ergebnis in einem Satz:** Die Plattform selbst ist live gesund — jede
Datenschutz-Kernzusage hält, an der Infrastruktur gemessen (GPS erreicht nie den
Server, keine IP-Logs, Firestore nur EU, Löschkette wirkt). Kaputt waren die
**Wächter** darüber und die **Auslieferungskette**.

### Der schwerste Fund (P0)

- Der Deploy-Riegel, der vor jeder Auslieferung die EU-Region und „gelöscht heißt
  gelöscht" des Bild-Buckets prüft, **konnte nicht rot werden** — ein
  Index-Verwechsler (`PIPESTATUS[0]` = printf statt `[1]` = python3) machte den
  Fehlerzweig rechnerisch tot. Behoben; der Riegel hat jetzt eine Negativprobe.

### Die Auslieferungskette (P1)

- **Deploy an keinen geprüften Stand gebunden:** `deploy.sh` lieferte den
  Arbeitsbaum aus und prüfte weniger als die sechs CI-Pflicht-Checks. Jetzt an die
  CI-Freigabe gebunden (sauberer Baum, `HEAD == origin/main`, alle sechs Checks
  grün) — beim ersten echten Deploy sofort wirksam.
- **Live-Smoke liest die ausgelieferte Kennung zurück:** Ein wirkungsloser
  Hosting-Deploy fiel vorher nicht auf; jetzt wird der ausgelieferte Cache-Buster
  gegen den erwarteten geprüft.
- Dazu: TTL- und Reaper-Zeitplan-Riegel, Buster-Lesefehler bricht ab statt still
  auf `01` zu fallen, Schlussbilanz übersprungener Riegel, Fremddatei-Wächter sieht
  neue Dateien, Alarmfilter-Abdeckung, CHANGELOG-Parser kennt Code-Zäune.

### Sicherheit (P2, alle live)

- **Boost-Deckel jetzt atomar** (Transaktion statt offenem get+set) — die einzige
  globale Kostenbremse hält unter gleichzeitigen Aufrufen.
- **Statusabruf drosselt den Schreibzugriff** (~93 % weniger unauthentifizierte
  Firestore-Writes).
- **Upload-Größenbremse ehrlich beschrieben**, Restrisiko als bewusste Abwägung.
- Worker-Tod nach dem Claim löst jetzt einen Alarm aus, statt den Nutzer 9 Minuten
  stumm warten zu lassen; ein verworfenes Ergebnis wird nicht mehr als „fertig"
  gezählt; der Wächter über die Wochen-Erinnerung ist nicht mehr blind.

### Frontend (P2/P3, live)

- **Barrierefreiheit:** vier Bedien-Beschriftungen (Beast-Umschalter, Info,
  Konfidenz-Punkte) sind wieder übersetzbar — ein Rückfall, den ab jetzt ein Test
  verhindert.
- Die Vorverbindung zu OpenStreetMap bei jedem Seitenaufruf ist entfernt (die
  Datenschutzerklärung sagt „nur bei GPS").
- Eine volle Warteschlange bekommt eine ehrliche Meldung statt „wir haben es
  dreimal probiert"; ein fehlgeschlagener Demo-Abruf scheitert nicht mehr lautlos.

### Außentexte (P2/P3, live)

- Formulierungen, die mehr versprachen als das System hält, an ihrem Belegort
  korrigiert: der Analyse-Zähler („Zählwerte je Zeitraum" statt „eine einzige
  Zahl"), die sessionStorage-Ausnahme („einzige" → vier Verwendungen aufgezählt),
  der Realitäts-Check, die Diagnose-Feldliste, die Fehler-Log-Beschreibung. Drei
  neue Sperrlisten-Regeln verhindern den Rückfall.

### Demo-Bilder auf Englisch gekennzeichnet

- Die KI-Kennzeichnung ist in die Bildpixel gebrannt (Pflicht seit 08/2026 — ein
  Etikett per CSS verschwindet, sobald jemand das Bild speichert oder weitergibt).
  Ein gebranntes Zeichen kann aber nicht mitübersetzen: Bei englischer Oberfläche
  stand trotzdem „KI ERSTELLT" im Bild. Jetzt gibt es einen zweiten Dateisatz mit
  „AI GENERATED", und die Seite wählt ihn nach Sprache — samt englischer
  Bildbeschreibung für Screenreader und englischer Metadaten-Kennzeichnung
  (`Credit`, `Source`, `Description`). Die fiktiven Kamera- und GPS-Daten, an denen
  malziME vorführt was in Fotos steckt, bleiben in beiden Fassungen erhalten.
- Das Werkzeug `scripts/ki-wasserzeichen.mjs` kennt dafür jetzt Sprachen
  (`--lang=en`); der bestehende Wächter über die maschinenlesbare Kennzeichnung
  deckt beide Sätze automatisch ab (12 statt 6 Bilder geprüft).

### Weitere Korrekturen

- **Transparenz:** Die Datenschutzerklärung benennt jetzt, dass die KI bewusst
  sensible, dem Aussehen zugeschriebene Merkmale rät (scheinbare Herkunft, Hautton) —
  genau das, was das Werkzeug vorführt.
- **Realitäts-Check-Vergleich** erscheint auch über die API erst ab 100 Eingaben
  (die Oberfläche sagt das zu); GIF wird als Format genannt; die IP-Grenze in den
  Nutzungsbedingungen als Richtwert ehrlich formuliert.
- **Werkzeuge/Tests:** Der Release-Wächter zieht Release-Notizen bei Inhaltszuwachs
  nach und geht den manuellen Reparaturweg korrekt; die Reaper-Test-Attrappe
  behandelt `null` jetzt wie Firestore (verhinderte eine unsichtbare Fehlerklasse);
  ein Wächter hält die 25-MB-Obergrenze an allen fünf Stellen deckungsgleich; der
  CHANGELOG-Parser kennt Code-Zäune.
- **Sprachlich:** Zuschreibungen in dritter Person durchgängig neutral formuliert,
  mit einer Sperrlisten-Regel gegen den Rückfall.

Der vollständige Auditbericht mit allen Befunden liegt unter `docs/audit/`
(bewusst nicht im öffentlichen Repository).

## [3.1.0] — 2026-08-13

**Das TIEF-Audit und seine Sanierung.**

Am 12. August lief das erste vollständige TIEF-Audit dieses Projekts: sechs unabhängige
Prüfer entlang von Prüffragen, ein eigener Widerleger für den schwersten Befund, dazu die
Regressionsfläche des Vorberichts. Ergebnis: **29 Befunde** — 3 schwere, 14 mittlere,
12 leichte. Zehn von elf Befunden des vorigen Audits waren belegt behoben.

**Das Muster hinter fast allem:** Nicht das Projekt war kaputt, sondern seine Wächter.
Vier Prüfungen, die als Riegel gebaut waren, meldeten „in Ordnung", wenn ihre Messung
gescheitert war — darunter der einzige Riegel gegen Sicherheitslücken in Fremdbibliotheken
und die Prüfung, die das EU-Versprechen trägt. Dazu kamen Zusagen, die als verbindlich
beschrieben waren, ohne es zu sein, und eine Löschkette, die ihr eigenes Scheitern nicht
meldete.

**Der einzige von außen erreichbare Befund:** Ein Aufruf mit falsch geformter Job-Nummer
brachte eine Funktion zum Absturz; der Absturz löste die Störungsmeldung aus. Ein Fremder
konnte damit ohne Anmeldung den einzigen Alarmkanal des Projekts unbrauchbar machen —
beliebig oft. Behoben und live belegt.

Vorlauf und Sanierung stehen hier vollständig an einer Stelle. Der vollständige
Auditbericht mit allen 29 Befunden liegt unter `docs/audit/` (bewusst nicht im
öffentlichen Repository).

### Vorlauf — die Sperrliste für Außentexte

Der Anlass für das Audit. Eine Regel, die seit Monaten in `CONTRIBUTING.md` steht, war an
fünf Stellen verletzt — sie stand eben nur als Prosa da und lief nirgends als Prüfung.

- **Formulierungs-Sperrliste als CI-Prüfung.** Alle Texte, die nach außen gehen (README,
  CONTRIBUTING, CHANGELOG, die Seiten unter `public/`, `llms.txt`), laufen gegen eine
  Sperrliste in `.pruefungen/aussentext.txt`. Die Prüfung prüft zuerst sich selbst
  (`scripts/pruefungen/selbstpruefung.sh`), damit ein defekter Prüfer nicht grün meldet,
  ohne etwas geprüft zu haben.
- **Fünf Verstöße korrigiert.** Die Regel „nicht behaupten, GPS verlasse das Gerät nie"
  war verletzt in README (2x), CONTRIBUTING, CHANGELOG (Eintrag v1.0.0) und
  `public/llms.txt`. Letzteres wiegt am schwersten: Diese Datei lesen KI-Crawler, die
  Falschaussage wurde also aktiv weitergetragen. Überall steht jetzt „GPS erreicht nie
  unsere Server" — sachlich richtig, weil der Browser für Karte und Ortsname
  OpenStreetMap und Nominatim sehr wohl direkt aufruft.
- **Firmierung korrigiert:** Ein CHANGELOG-Eintrag führte eine Kurzform der Firma, die es
  nicht gibt. Jetzt vollständig.
- **Zuschreibung in dritter Person entfernt** (`docs/ERROR-ALERTING.md`, 2 Stellen): Die
  Meldung wird sachlich beschrieben, statt sie einer Person zuzuschreiben.
- **Zwei weitere Prüfungen liefen zunächst nur mit** (stille Fehlschläge in Skripten,
  Tests ohne Zusicherung), `fakten-drift` lief gar nicht in der Pipeline. Beides war eine
  Notlösung — genau diese Nachgiebigkeit wurde in Welle 1 zum Befund und ist dort behoben.

### Welle 1 — die Riegel, die nicht rot werden konnten

- **Das Abhängigkeits-Gate meldete grün, ohne gemessen zu haben** (`OPS-2026-08-12-01`,
  P1). Bei einer Registry-Störung schrieb `npm audit` eine Fehlermeldung auf dieselbe
  Ausgabe wie einen Bericht; das Gate las daraus „null Lücken" und ließ durch — in einem
  Pflicht-Check. Jetzt bricht es ab und unterscheidet drei Zustände: 0 sauber, 1 echte
  Funde, 2 Messung gescheitert.
- **Die Regionsprüfung im Deploy-Riegel ebenso** (`OPS-2026-08-12-02`, P2). Fiel `gcloud`
  aus, war die Ausgabe leer — und leer hieß „alle Functions in europe-west1". Sie zählt
  jetzt, was sie gesehen hat, und meldet „nicht durchgeführt" statt grün.
- **Jeder Fremde konnte den Störungsalarm auslösen** (`SEC-2026-08-12-08`, P1). Eine
  Job-Nummer mit ungerader Pfadtiefe (`a/b`) erreichte ungeprüft die Datenbankschicht,
  die dort warf; der unbehandelte Fehler erzeugte eine ERROR-Logzeile, und die
  Alarmrichtlinie schickt bei solchen Zeilen E-Mail und Push. Unauthentifiziert,
  beliebig wiederholbar. `/api/job-status` prüft die Job-Nummer jetzt gegen das echte
  Firestore-Format und antwortet mit 400, **ohne** die Datenbank überhaupt zu befragen.
- **Die Sperrliste traf nur den Wortlaut** (`DOC-2026-08-12-05`, P2). „verlässt NIEMALS
  den Browser" rutschte durch, und `.js`-Dateien wurden gar nicht geprüft — obwohl sie
  ausgeliefert werden. Ein Muster deckt jetzt die Varianten ab, die Suchfläche umfasst
  `.js`, `.mjs`, `.ts`. Damit sichtbar geworden und korrigiert: **drei** weitere Stellen
  in `AGENTS.md`, `docs/ARCHITECTURE.md` und `public/js/api.js`.

**Die Prüfungen prüfen jetzt richtig — und sind deshalb alle vier verbindlich:**

- **Ein Job `pruefungen` statt zwei, alles blockierend.** `continue-on-error` ist weg,
  `fakten-drift` ist zurück in der Pipeline. Vorbedingung war, dass die Prüfungen
  stimmen: Von 15 gemeldeten Fundstellen war **eine echt**, der Rest Fehlalarm der
  Prüfungen selbst.
- **Fünf Fehlalarm-Ursachen behoben**, jede mit eigener Probe in
  `selbstpruefung.sh` (jetzt 18 statt 12): `if … >/dev/null 2>&1; then` ist kein
  verworfener Rückgabewert · eine Zusicherung hinter einem mehrzeiligen Text wird
  gefunden · ein Sammel-Berichter mit eigenem Fehler-Exit braucht kein `set -e` ·
  ein geprüftes Suchergebnis gilt nicht als still gelesen (das Erfolgswort muss in
  einer Meldung stehen, nicht in einem Suchmuster oder einem Shell-Schlüsselwort) ·
  ein Changelog mit alten Zahlen ist Historie, kein Drift.
- **`.pruefungen/fakten.txt` (neu):** Das Projekt legt fest, welche Zahlen genau einen
  Wert haben dürfen. Sobald die Datei existiert, gelten nur ihre Muster — die
  eingebauten halten „30 Tage Aufbewahrung", „7 Tage Karenz" und „183 Tage Frist" für
  denselben Fakt und melden Widersprüche, die keine sind.
- **Der eine echte Fund, behoben:** `cloudtasks-scripts.test.js` erzeugte ohne
  installiertes `gcloud` einen Test mit `expect(true).toBe(true)`. Der zählte als
  bestanden und behauptete eine Abdeckung, die es nicht gab. Jetzt wird er als
  **übersprungen** ausgewiesen — 923 Tests, die alle scheitern können, statt 924, von
  denen einer nicht kann.

### Welle 2 — Löschkette, Sicherheitsnetz, Admin-Zugang, stille Erinnerung

- **Bildlöschung ohne Erfolgsprüfung** (`PRIV-2026-08-12-26`, P2). `deleteImage`
  verschluckte jeden Fehler in eine Logzeile unterhalb der Alarmschwelle und gab nichts
  zurück; der Aufrufer löschte danach das Job-Dokument mitsamt dem einzigen Verweis auf
  die Datei. Gemessen: 11 solcher Fehlschläge in 30 Tagen, alle unbemerkt. Jetzt meldet
  die Funktion Erfolg oder Misserfolg, ein echter Fehler geht mit `severity: ERROR` raus,
  und der Reaper lässt das Dokument stehen, statt den Pfad wegzuwerfen.
- **Kein zweites Netz für die fertigen Profile** (`ARCH-2026-08-12-27`, P2). Räumte der
  Reaper nicht, blieben Job-Dokumente unbegrenzt liegen. Neu: ein Ablauf-Feld je Job und
  eine automatische Löschregel in der Datenbank — bewusst bei 24 Stunden statt bei 2, das
  Netz soll den Ausfall des Reapers fangen und ihm nicht ins Handwerk pfuschen.
  Eingerichtet, während die Sammlung leer war; keine Migration nötig.
- **Nonce und Admin-Token waren kryptografisch dasselbe** (`SEC-2026-08-12-17`, P2). Der
  30-Minuten-Token steht im Klartext in der Push-Mitteilung; wer ihn sah, konnte ihn im
  Nonce-Feld einsetzen und die Bestätigungsseite überspringen. Beide tragen jetzt ihren
  Verwendungszweck in der Signatur. Zusätzlich hat der Boost eine Obergrenze (doppeltes
  Stundenlimit) und lehnt fail-closed ab, wenn die aktuelle Grenze nicht lesbar ist.
- **Die Wochen-Erinnerung schwieg in jedem Fehlerfall** (`OPS-2026-08-12-11`, P2) — und
  bis zum ersten fälligen Push im Februar 2027 wäre ihr Ausfall 180 Tage lang nicht von
  korrektem Verhalten zu unterscheiden gewesen. Sie hinterlässt jetzt bei jedem Lauf ein
  Lebenszeichen; der Reaper liest es jede Minute und meldet laut, wenn es älter als neun
  Tage ist. Der Reaper eignet sich dafür, weil er in der Alarmrichtlinie steht — die
  Erinnerung selbst bleibt bewusst leise. Dazu bekommt die CI einen wöchentlichen
  Zeitplan: Die harte Frist-Bremse lief bisher nur bei Push und Pull-Request, damit waren
  **beide** Schichten ereignisgesteuert und konnten gemeinsam verstummen.

- **Der Prüfer blockiert jetzt wirklich** (`OPS-2026-08-12-04`, P1). Der Job `pruefungen`
  lief zwar bei jedem Pull-Request, stand aber nicht in der Branch Protection — ein roter
  Lauf verhinderte keinen Merge, und bei Dependabot hätte Auto-Merge ihn ohnehin nicht
  abgewartet. In `ci.yml`, README und CHANGELOG stand trotzdem „blockierend". Er ist jetzt
  der sechste Pflicht-Check, eingetragen erst nach fünf grünen Läufen in Folge: Wegen
  `enforce_admins: true` blockiert ein wackliger Pflicht-Check jeden Merge, auch den
  eigenen. Ist-Zustand und Rückweg stehen im RUNBOOK.

- **Der Alarmweg hatte keinen Wächter** (`OPS-2026-08-12-09`, P2). Die Richtlinie ist eine
  Anwesenheits-Bedingung: Ihr eigener Ausfall erzeugt keine Logzeile, ein toter Alarm sieht
  aus wie „keine Störung". Der Deploy-Riegel prüft jetzt vier Ausfallarten — Richtlinie
  fehlt, ist aus, hat keinen Kanal, Kanal abgeschaltet. Die Grenze steht ehrlich dabei:
  Das greift beim Deploy, nicht in der Minute des Ausfalls; der Rest ist als Restrisiko
  in `docs/SECURITY-MODEL.md` festgehalten.

### Welle 3 — Außentexte

**Audit-Sanierung, Welle 3 — vier Sätze, die mehr versprachen als das System hält:**

- **Die Zusage über den Analyse-Zähler** (`PRIV-2026-08-12-13`, P2) war am
  Live-Dokument widerlegbar — sie sprach von genau einem Wert je Zeitraum: Für das rollende Stundenlimit hält der Zähler die Zeitpunkte
  der letzten 60 Minuten. Kein Personenbezug — aber es sind mehrere Werte. Der Satz zählt
  jetzt auf, was wirklich drinsteht.
- **Die Beschreibung der KI-Analyse** (`PRIV-2026-08-12-15`, P3) sprach von einem einzigen
  Arbeitsschritt. Das traf nicht zu:
  Für die Beast-Variante folgt ein zweiter Aufruf an dieselbe KI, der nach Werbe-Kategorien
  fragt. Kein Bild geht dabei mit, wohl aber die eben erzeugten Profilangaben. Steht jetzt
  in der Erklärung.
- **Die Diagnose-Daten** (`PRIV-2026-08-12-14`, P3) enthalten mehr Felder als aufgezählt
  waren — Netzwerk-Geschwindigkeit, Datensparmodus, Sprache, Prozessorkerne,
  Arbeitsspeicher-Klasse, Pixeldichte und die aufgerufene Seite. Alle sind jetzt benannt.
- **Das README** (`DOC-2026-08-12-16`, P3) stellte das Hosting als `europe-west1` dar;
  gemessen antwortet ein weltweites Auslieferungsnetz. Die Datenschutzerklärung sagt es
  richtig — jetzt sagen beide dasselbe.
- **Zwei neue Regeln auf der Sperrliste** fangen genau diese zwei Formulierungen künftig ab.
- **Der Formulierungs-Prüfer achtet jetzt `.gitignore`** (`TEST-2026-08-12-29`, P3). Er
  lief über den Dateibaum und sah damit auch Auditberichte, die verbotene Formulierungen
  zitieren, um sie zu melden — lokal dauerhaft rot, in der CI grün. Jetzt prüft er, was im
  Repository landet: 128 Dateien statt 161, lokal und in der CI dasselbe Ergebnis.

### Welle 4 — die Lieferkette

- **Keine Prüfsumme für die mitgelieferten Fremdbibliotheken** (`OSS-2026-08-12-22`, P2).
  `exifr`, Leaflet und die Schriften liegen im Repository, ohne dass irgendwo stand, wie
  sie auszusehen haben. Eine Änderung an 147 KB minifiziertem Einzeiler zeigt der
  Pull-Request als **eine** Zeile — ausgerechnet `exifr` liest die GPS-Daten, deren
  Nichtweitergabe die Kernzusage dieses Projekts ist. Jetzt hat jede der 19 Dateien eine
  Prüfsumme, geprüft bei jedem Lauf. Der Vollständigkeits-Test fand beim ersten Einsatz
  sofort drei Lücken in der frisch erstellten Liste (beide `VERSION`-Marker, die
  Schriftlizenz `OFL.txt`).
- **Auto-Merge griff auch für Änderungen an der Auslieferung selbst**
  (`OSS-2026-08-12-20`, P2). Gedacht war er für harmlose Bibliotheks-Updates. Er hätte
  aber auch eine Änderung an den Pipeline-Dateien ohne menschlichen Blick durchgewinkt.
  Jetzt misst ein eigener Schritt die geänderten Dateien; berührt ein Pull-Request die
  Auslieferkette, bleibt er liegen. Bei der Umsetzung stellte sich heraus, dass der
  naheliegende Weg (Filter auf die Herkunfts-Angabe des Pakets) **nie** gegriffen hätte —
  bei Actions-Aktualisierungen steht diese Angabe gar nicht drin. Am echten
  Pull-Request #57 nachgesehen statt angenommen.
- **Das Ablaufdatum der Ausnahmeliste war ein Zeichenkettenvergleich**
  (`OSS-2026-08-12-21`, P2). Ein deutsch geschriebenes Datum („12.08.2026") wäre stumm als
  „noch gültig" gelesen worden, eine Ausnahme also unbegrenzt in Kraft geblieben. Jetzt
  werden Pflichtfelder und Datumsform erzwungen; was nicht passt, beendet den Lauf mit
  „Messung gescheitert", nicht mit „in Ordnung".
- **Der Abhängigkeitsbaum des Hauptprojekts wurde von keinem Gate geprüft**
  (`OSS-2026-08-12-23`, P3) — nur der von `functions/`. Jetzt laufen beide.
- **Das Auslieferungswerkzeug war an keine Version gebunden** (`OPS-2026-08-12-25`, P3).
  Die Firebase-CLI ist global installiert; ein beiläufiges Update hätte den Deploy-Weg
  still verändert, und nirgends stand, mit welcher Version je ausgeliefert wurde. Der
  Deploy misst sie jetzt, schreibt sie ins Protokoll und bricht ab, wenn sie unter die
  hinterlegte Untergrenze fällt oder gar nicht ermittelbar ist.
- **Log-Speicher mit IP-Adressen lag auf Standort `global`** (`PRIV-2026-08-12-12`, P2).
  Googles Standard-Log-Ablage ist fest auf `global` und lässt sich nicht nach Europa
  verschieben. Einziger Träger von Client-IP-Adressen sind die Request-Protokolle des
  Servers — die werden jetzt vollständig davon ausgenommen (bisher nur die unterhalb der
  Fehlerschwelle). Live belegt an einem echten Aufruf: Request-Protokoll nicht mehr
  gespeichert, die Programmausgaben desselben Aufrufs unverändert da, Alarmweg unberührt.
  Der Deploy-Riegel bewacht ab jetzt nicht nur, **dass** die Ausnahme existiert, sondern
  auch ihren Inhalt — eine wieder eingebaute Schwelle würde ihn rot machen. Was bewusst
  bleibt, steht in `docs/SECURITY-MODEL.md`.
- **Der E2E-Container hängt an einem beweglichen Etikett** (`OSS-2026-08-12-24`, P3) —
  als bewusste Abwägung festgehalten statt scheinbehoben. Ein fester Digest würde bei
  jedem Playwright-Update einen Pflicht-Check brechen; der Job hat gemessen weder
  Geheimnis noch Token noch Schreibrechte. Begründung und Neubewertungs-Bedingung stehen
  in `docs/SECURITY-MODEL.md`.

### Welle 5 — die Prüfmittel und die Nachweise

- **Die Prüfungen selbst prüfen jetzt genauer, wo sie blind waren:**
  - **„Nichts gefunden" hieß bei einer der vier „in Ordnung"** (`TEST-2026-08-12-03`,
    P3). Lief die Formulierungs-Prüfung über ein Verzeichnis ohne einen einzigen
    Außentext, meldete sie „kein Verstoß gefunden" und ging grün raus. Jetzt heißt das
    „Messung gescheitert" — wie bei den anderen drei. Auch der Sammel-Lauf mahnte eine
    fehlende Suchfläche zwar an, gab aber trotzdem 0 zurück; die Warnung stand in einer
    Ausgabe, die niemand liest, solange das Ergebnis grün ist.
  - **Tabellenform-Tests waren unsichtbar** (`TEST-2026-08-12-06`, P2). Von den 982
    Tests dieses Projekts sah die Prüfung einen erheblichen Teil gar nicht — darunter
    ausgerechnet den Test, der am selben Tag von einer Schein-Zusicherung auf ein
    ehrliches Überspringen umgestellt worden war. Zwei Anläufe nötig: Die erste
    Fassung war am Beispielmaterial grün und am echten Projekt weiter blind.
  - **Ein begründetes Überspringen kann sich jetzt erklären.** Sonst zwingt die
    Prüfung genau zu dem Fehler, gegen den sie antritt: Wer einen Test überspringen
    muss, weil ein Werkzeug fehlt, hätte sonst eine Schein-Zusicherung eingebaut. Die
    Begründung ist Pflicht und wird bei jedem Lauf mit ausgegeben — eine Ausnahme, die
    niemand mehr sieht, ist nach zwei Monaten der Normalzustand.
  - **Und zwei Fehlalarme**, die dabei entstanden: `test.setTimeout(...)` ist
    Konfiguration und kein Test — als Test gezählt, zerschnitt es zusätzlich den echten
    Test darüber, dessen Zusicherung dadurch ungesehen blieb. Ein Fehlalarm, der einen
    zweiten erzeugt.
- **Die einkopierten Prüfungen hatten keinen Wächter — und waren bereits gedriftet**
  (`TEST-2026-08-12-28`, P3). `scripts/pruefungen/` ist eine Kopie aus dem
  Werkzeugkasten der Audit-Familie; die Pipeline sieht nur, was im Repository liegt.
  Beim Kopieren waren die Punktverzeichnisse untergegangen: In einer Beispielprobe
  fehlte dadurch die Regeldatei, und die Prüfung legte sich beim Lauf still eine Vorlage
  an. Die Probe war grün — sie prüfte nur etwas anderes als gedacht. Jetzt hat die Kopie
  eine Herkunftsangabe mit Prüfsummen aller 44 Dateien und einen Wächter, der beide
  Richtungen unterscheidet: „jemand hat die Kopie bearbeitet statt der Quelle" (auch in
  der Pipeline erkennbar) und „die Quelle ist weitergezogen" (nur lokal erkennbar — und
  der Lauf sagt ausdrücklich dazu, wenn er das nicht sehen konnte).
- **Der zweite KI-Aufruf hatte keinen der drei Schutzmechanismen des ersten**
  (`SEC-2026-08-12-18`, P3). Er bekommt kein Bild — aber alles, was er bekommt, ist aus
  dem Bild abgeleitet. Ein Foto mit lesbarem Text kann Sätze ins Profil tragen, die im
  zweiten Aufruf wie Anweisungen aussehen. Jetzt gilt dort dasselbe wie im ersten:
  Warnung voran, Daten in gekennzeichneten Blöcken, Inhalte maskiert.
- **Der erkannte Bildtyp wurde nie gegen den behaupteten geprüft**
  (`SEC-2026-08-12-19`, P3). Ein GIF mit der Behauptung „JPEG" kam durch, und die
  Behauptung reiste ungeprüft weiter bis in die Daten an die KI. Jetzt entscheidet der
  Inhalt. Für das eigene Frontend ändert sich nichts — es erzeugt jedes Bild über den
  Canvas neu und schickt darum immer echtes JPEG.
- **Die Verifikationsmatrix nannte einen CI-Job, den es nie gab**
  (`DOC-2026-08-12-07`, P3), und eine Probenzahl von damals. Beides berichtigt — und
  weil das maschinell entscheidbar ist, entscheidet es ab jetzt eine Maschine: Ein Test
  vergleicht jeden dort genannten Job mit denen, die es wirklich gibt. Die Probenzahl
  steht nur noch an einer Stelle und wird gezählt statt geschrieben.

**Drei neue Funde, die erst die Sanierung zutage gefördert hat:**

- **Der Release-Wächter konnte den Tag einer bereits ausgelieferten Version umhängen**
  (`OPS-2026-08-12-30`, P2). Er suchte die „oberste Version" mit einem Zahlenmuster.
  Steht darüber ein Abschnitt „Unveröffentlicht" — in diesem Projekt der Normalzustand
  zwischen zwei Deploys —, findet er die nächste Nummer weiter unten, und die ist bereits
  ausgeliefert. Aufgefallen, als genau das passieren wollte: Die Rücknahme einer zu früh
  vergebenen Versionsnummer hätte den Tag der vorigen Version von seinem echten
  Deploy-Stand weggezogen. Es ist dieselbe Falle, gegen die diese Datei in vier
  Kommentarblöcken anschreibt — sie kam nur durch eine Tür, die niemand geprüft hatte:
  **Kein einziger Test las je eine Datei unter `.github/workflows`.** Die Auswertung liegt
  jetzt in einem eigenen Skript und entscheidet nach der obersten Überschrift, gleich
  welcher Art. Neun Tests, darunter ein Rückfall-Wächter und ein Lauf gegen das echte
  CHANGELOG.
- **Der Prüfstand-Stempler starb wortlos** (`OPS-2026-08-13-32`, P3). Er liest die
  Testzahlen aus der Ausgabe der Suiten. Seit ein Test bewusst übersprungen wird, lautet
  die Zeile „1 übersprungen, 795 bestanden" — sein Muster erwartete die Zahl unmittelbar
  hinter „Tests:" und griff nicht mehr. Seine eigene Plausibilitätsprüfung hätte genau
  das melden sollen, wurde aber nie erreicht: Eine leere Suche beendet unter den strengen
  Shell-Einstellungen das ganze Skript sofort. Ergebnis: Abbruch ohne ein Wort. Behoben —
  und der übersprungene Test wird jetzt ausgewiesen statt weggerechnet („795/796 grün,
  1 übersprungen").
- **Ein E2E-Test scheitert selten — und sagt beim Scheitern nicht, woran**
  (`TEST-2026-08-13-31`, P3). Im vollen Lauf fiel „Beast Mode überlebt ein Neuladen"
  einmal durch, in drei Einzelläufen danach nicht wieder. Die Meldung lautete, ein
  Attribut sei leer; das heißt in Wahrheit, dass die Seite nach dem Neuladen gar nicht
  fertig geladen hat — aber warum, stand nirgends, und die Beweisdateien waren von den
  Folgeläufen längst überschrieben. **Die Ursache ist damit offen.** Behoben ist nur die
  Blindheit: Der Test sammelt jetzt Browser-Meldungen, fehlgeschlagene Anfragen und
  HTTP-Fehler ein und hängt sie an die Fehlermeldung, und er prüft zuerst, ob die Seite
  überhaupt da ist. Beim nächsten Auftreten steht die Ursache in der Meldung, statt eine
  Stunde zu kosten.

## [3.0.6] — 2026-08-12

**Erinnerung an die ZDR-Nachprüfung — und die Ursache für ausbleibende
Handy-Mitteilungen:**

- **Wochen-Erinnerung (neu):** Eine geplante Funktion schaut montags auf die
  Live-Seite und meldet sich eine Woche bevor die halbjährliche Nachprüfung
  der EU-/Zero-Data-Retention-Zusage fällig wird — per Push aufs Handy, mit
  den nötigen Schritten im Text und einem Knopf direkt ins Mistral-Dashboard.
  Ist die Frist überschritten, meldet sie sich dringlicher. Fällt etwas aus
  (Seite nicht erreichbar, Push-Dienst weg), passiert nichts Schlimmes: Die
  Erinnerung ist so gebaut, dass sie den Betrieb nie stören kann.
- **Zweites Netz:** Bleibt die Erinnerung unbeachtet, schlägt zusätzlich die
  automatische Prüfung beim nächsten Bau an. Beide rechnen mit derselben
  Fristdefinition — die Frist steht nur an einer Stelle im Code.
- **Behoben: iOS-Mitteilungen kamen nie an.** Ein selbst betriebener
  Push-Server kann iPhones nur über den Dienst ntfy.sh erreichen. Diese
  Weiterleitung passiert erst _nach_ der Antwort an den Absender — und genau
  dann entzog die Cloud-Plattform dem Programm standardmäßig die Rechenzeit.
  Die Weiterleitung lief still in eine Zeitüberschreitung: Die Meldung lag auf
  dem Server, aber das Handy erfuhr nichts davon. Mit dauerhaft zugeteilter
  Rechenzeit ist das behoben und die Zustellung bestätigt. Die frühere
  Vermutung, das liege an der App oder an iOS, war damit widerlegt.
- **Sicherheits-Aktualisierung des Push-Servers** auf ntfy 2.27.0 (drei
  übersprungene Versionen mit Sicherheitskorrekturen); der Zugangsschutz —
  senden erlaubt, anonymes Mitlesen gesperrt — ist unverändert und geprüft.

## [3.0.5] — 2026-08-12

**Qualitäts-Zug „Richtung 100" (Konzept vom 2026-08-12; ohne Änderung am
Nutzerpfad):**

- **Prüfstand-Stempler:** `scripts/pruefstand.sh` lässt alle drei Test-Suiten
  laufen und stempelt Anzahl, Commit und Datum selbst in die Verifikationsmatrix —
  bei einer roten Suite wird nichts gestempelt. Von Hand gepflegte Testzahlen
  sind damit abgeschafft.
- **Live-Beweis nach jedem Deploy:** `scripts/live-smoke.sh` prüft automatisch
  vier kostenfreie Proben gegen die Produktion (Upload-Ablehnung inkl. echter
  Validierungs-Meldung, Honeypot, Admin-Zugriffsschutz, Stats); in `deploy.sh`
  verankert (Notschalter `SKIP_SMOKE=1`).
- **Doku-Drift-Wächter in der CI:** README bleibt frei von festen Testzahlen,
  interne Doku-Links müssen existieren, die Prüfstand-Zeilen bleiben datiert.
- **Sicherheitsmodell:** Neues `docs/SECURITY-MODEL.md` macht die bewussten
  Abwägungen des Projekts zitierfähig (fail-open-Stundenzähler mit Alarm,
  instanzlokales IP-Limit als Datenschutz-Entscheidung, kein Staging,
  Bus-Faktor, externer Durchsatz-Deckel) — inklusive der verworfenen
  Maßnahmen und ihrer Gründe.
- **Datenschutzerklärung:** Die EU-/Zero-Data-Retention-Zusagen tragen jetzt
  ein Prüfdatum („zuletzt am 11. August 2026 im Mistral-Dashboard überprüft")
  samt Wiedervorlage-Versprechen — aus einem Versprechen wird ein gepflegter,
  datierter Zustand.
- **Zwei Drift-Korrekturen:** Die README-Beschreibung der Content Security
  Policy nannte noch die abgebaute Subdomain `api.malzi.me` (gegen den echten
  Live-Header korrigiert); die GPS-Formulierung war bereits in v3.0.4
  regelkonform präzisiert worden.

## [3.0.4] — 2026-08-12

**Wartungszug aus der externen Code-Review (Codex, 2026-08-12; drei Punkte im
Konsens beider Prüfungen):**

- **Sicherheit — Nonce-Verbrauch fail-closed:** Ließ sich der Verbrauch einer
  Admin-Nonce nicht in Firestore festhalten, galt sie bisher trotzdem als
  gültig (fail-open) — der Replay-Schutz war genau dann wirkungslos. Jetzt
  gilt sie als nicht einlösbar: 403, keine Mutation. Kostet nichts: Der
  Bearer-Notweg nutzt keine Nonce, und Boost/Reset schreiben selbst in
  Firestore, wären bei einem Ausfall also ohnehin gescheitert.
- **Betrieb — Infrastruktur-Prüfskript:** Neues, ausschließlich lesendes
  `scripts/verify-infrastructure.sh` gleicht vor jedem Deploy den Ist-Zustand
  der Cloud gegen den RUNBOOK-Soll-Zustand ab (Queue-Region+Concurrency,
  Bucket-Region+Lifecycle+Soft-Delete, Firestore nur `malzime-eu`,
  Worker nicht öffentlich, Functions-Regionen, Log-Ausschlüsse). In
  `deploy.sh` verankert (Notschalter `SKIP_INFRA=1`); ein CI-Test erzwingt,
  dass das Skript nie etwas verändern kann (nur Lese-Kommandos erlaubt).
  Erstlauf gegen die echte Infrastruktur: alle Prüfungen grün.
- **Doku — Drift bereinigt:** Feste Testzahlen aus dem README entfernt (der
  verbindliche Stand ist der letzte CI-Lauf), `VERIFICATION.md` ausdrücklich
  als datierter Prüfstand gerahmt und einmalig aktualisiert, der sich selbst
  widersprechende Queue-Absatz in `ARCHITECTURE.md` neu geschrieben
  (Stundenlimit + Tiefen-Bremse + 35-min-Höchstalter), Reaper-Absatz auf die
  fünf realen Aufräum-Zweige gebracht, GPS-Formulierung im README
  regelkonform präzisiert.

## [3.0.3] — 2026-08-11

**Wording-Korrektur:** „Privat finanziert" heißt jetzt überall
**„eigenfinanziert"** (Statistik-Seite, Stundenlimit-Banner, Deutsch und
Englisch). Grund: Die Kosten trägt laut Impressum das Unternehmen
malziland - learning | training | consulting e.U. — „privat" war als Wort
angreifbar, „eigenfinanziert" ist es nicht. An Kostenlosigkeit,
Werbefreiheit und Tracking-Freiheit ändert sich selbstverständlich nichts.

## [3.0.2] — 2026-08-11

Sanierung nach dem Kurzaudit des v3-Tags (unabhängige Prüfung von Code und
Infrastruktur, Prüfstand 79ec393). Kein neues Feature — vier Härtungen und
etwas Feinschliff:

**Der anonyme Realitäts-Check-Zähler ist jetzt flutungssicher**

- Die öffentliche Vergleichszahl („so gut lagen alle anderen") zählt eine
  Stimme nur noch gegen ein Einmal-Ticket, das der Server bei der ersten
  Auslieferung eines echten Ergebnisses ausgibt und beim Zählen entwertet —
  eine echte Analyse, höchstens eine Stimme. Vorher hätte ein simples Skript
  den Wert beliebig verstellen können. An der Anonymität ändert sich nichts:
  Das Ticket ist ein bedeutungsloser Zufallswert, gespeichert wird weiterhin
  ausschließlich die Selbsteinschätzung selbst; in der Datenbank liegt nur
  ein Hash, und geloggt wird das Ticket nie.

**Live-Text: Zuordnung abgesichert**

- Der Live-Text-Strom verlässt sich nicht mehr auf die bloße Reihenfolge
  der Profiltexte in der Modell-Antwort, sondern verankert jeden Text an
  seinem Modus-Block („standard"/„beast"). Selbst wenn das Modell die Blöcke
  je vertauschen sollte, kann der harte Beast-Text nie kurz als normales
  Profil erscheinen.

**Release-Automatik abbruchfest**

- Der Release-Wächter protokolliert vor jedem Umhängen einer wiederverwendeten
  Versionsnummer den alten Tag-Zeiger, löscht in verwechslungssicherer
  Reihenfolge (erst Tag, dann Release), verweigert das Anlegen auf einen
  fremden Tag-Zeiger und lässt keine zwei Läufe mehr parallel zu — ein halber
  Durchlauf kann Tag und CHANGELOG nicht mehr auseinanderreißen.

**Feinschliff**

- Die Einordnung „Die KI-Profile sind erfunden … nichts davon ist wahr oder
  bewiesen" steht am Bildschirm jetzt VOR der Foto-Wahl statt erst darunter
  (im Druck stand sie schon immer oben).
- Die Auge-Nachwache der Blick-Führung ist an ihren Analyse-Lauf gebunden:
  Startet blitzschnell eine neue Analyse, kann keine alte Wache-Kette mehr
  parallel weiterticken.
- Bei Mistral-Überlastantworten (429) wird der ungenutzte Antwortrumpf sofort
  verworfen statt bis zur Speicherbereinigung offen zu bleiben.
- Veraltete „6 Anfragen/Sekunde"-Kommentare (Mai-Stand) im Code durch die
  heutige Tier-Wahrheit ersetzt (Stufen-System, aktuell 0,25 Anfragen/s);
  ein neues Skript legt die Analyse-Messwerte für die September-Auswertungen
  30 Tage statt 1 Tag in den anonymen Diagnose-Speicher.

## [3.0.1] — 2026-08-11

Feinschliff-Sammlung nach den Live-Tests des v3.0-Starts — Dramaturgie,
Blick-Führung und eine deutliche Datenschutz-Härtung:

**Dramaturgie nachgeschärft**

- Vor dem ersten getippten Zeichen sammelt jetzt ein ~25-Sekunden-Anlauf
  Material (die Scan-Animation trägt die Zeit) — dafür tippt der Text danach
  spürbar flotter. Das zähe Kriech-Tempo ist weg.
- Die Live-Karte trägt von Anfang an die Farbe der späteren
  Zusammenfassungs-Box — kein Farbwechsel mehr am Ende.
- Warte-Meldungen erscheinen als das vertraute Augen-Symbol oberhalb der
  Karte statt als eigene Status-Box; die „Analyse abgeschlossen"-Box am Ende
  ist ersatzlos entfernt. Der Score-Ring des Realitäts-Checks ist sauber
  freigestellt (kein Glüh-Quadrat mehr dahinter).
- Die Töne sind etwas lauter, und die Seite springt am Ende nicht mehr nach
  oben.

**Blick-Führung: der Blick ist immer dort, wo etwas passiert**

- Nach der Foto-Wahl wird das Auge ins Bild geholt, beim Tipp-Start die
  Karte, beim Tippen bleibt die letzte Zeile sichtbar, und die Enthüllung
  zentriert jede aufpoppende Box — jeder Pop ist auch zu sehen, nicht nur zu
  hören.
- Dein Finger hat Vorrang: Echtes Wischen (oder Mausrad/Tasten) beendet die
  Führung sofort und dauerhaft; bloßes Antippen — etwa des Beast-Schalters —
  ist erlaubt. Nach einer Übernahme klingen nur noch Boxen, die wirklich im
  Bild sind. Bei „Bewegung reduzieren" scrollt nie etwas automatisch.

**Datenschutz-Härtung (nach unabhängiger Prüfung von Code, Infrastruktur
und Mistral-Verträgen)**

- **KI-Analyse vertraglich in Europa:** malziME nutzt jetzt den
  EU-Regional-Endpunkt von Mistral — die Bildanalyse läuft laut Vertrag in
  Rechenzentren der EU bzw. EFTA (10 % Aufpreis, und jeden Cent wert).
- **Zero Data Retention aktiviert:** Auf unseren Antrag hat Mistral für
  malziME Null-Datenspeicherung freigeschaltet (schriftlich bestätigt) —
  Ein- und Ausgaben, also auch Fotos, werden dort nicht über die
  unmittelbare Verarbeitung hinaus gespeichert oder protokolliert.
- **Fertige Ergebnisse verschwinden am Server wenige Minuten nach der
  Abholung** (vorher: erst nach bis zu zwei Stunden) — deckungsgleich mit
  dem 15-Minuten-Fenster, in dem der Browser ein zugestelltes Ergebnis noch
  einmal anzeigen darf. Nie abgeholte Ergebnisse räumt der Server spätestens
  nach zwei Stunden ab.
- **Datenschutzerklärung präzisiert:** Die GPS-Erklärung sagt jetzt exakt,
  was passiert („erreichen nie unsere Server" — die Orts-Anfrage stellt dein
  Browser direkt an OpenStreetMap), die Hosting-Beschreibung trennt sauber
  zwischen Datenverarbeitung (ausschließlich EU-Region Belgien) und der
  weltweiten Auslieferung der statischen Seiten, und die neuen
  Mistral-Zusagen stehen wörtlich drin.

## [3.0.0] — 2026-08-11

v3.0 — Das Live-Erlebnis.

### Was sich ändert

**Live-Streaming: der KI beim Schreiben zusehen.** Bisher hieß Analyse:
warten, dann alles auf einen Schlag. Jetzt streamt der Server die KI-Antwort
schon während sie entsteht, und die Seite tippt den Profiltext **Buchstabe
für Buchstabe live mit**. Der getippte Text folgt dem gewählten Modus: Wer
den Beast-Schalter umlegt, sieht sofort den Beast-Text an dessen eigenem
Stand weiterlaufen (das Modell schreibt Beast naturgemäß etwas später — die
Karte überbrückt das mit einem ehrlichen Wartestatus).

**Dramaturgie ohne Leerlauf** — von der Foto-Wahl bis zum PDF-Knopf ist
immer sichtbar etwas in Bewegung:

- Die Scan-Animation (Auge + rotierende Meldungen) bleibt, bis das **erste
  Zeichen** wirklich getippt wird — nie eine leere Karte mit blinkendem
  Cursor. Vor dem ersten Zeichen sammelt ein **~10-Sekunden-Anlauf**
  Material, damit das Tippen danach flüssig wirkt statt zäh.
- Getippt wird **im Takt der Analyse**: Das Tempo passt sich laufend an den
  noch wartenden Text an — wenig Nachschub tippt ruhig und gut lesbar,
  viel Nachschub schneller. So trägt das Tippen die Wartezeit, statt nach
  Sekunden fertig zu sein. Meldet der Server „fertig", tippt der Rest im
  Schnellvorlauf aus — und die Seite bleibt dabei, wo du gerade liest,
  statt ans Seiten-Ende oder nach oben zu springen.
- Läuft der Text doch einmal aus, rotieren ehrliche Status-Zeilen
  („Kategorien werden berechnet …") statt eines eingefrorenen Fensters.
- Danach die **Enthüllung Schritt für Schritt**: Foto-Daten, Standort-Karte,
  die Kategorien Karte für Karte, Werbung, Manipulation, Realitäts-Check,
  zuletzt der Datenwert, dessen Betrag vor den Augen hochzählt — und erst
  dann der PDF-Knopf.
- Am Schreibrand dekodiert ein Zeichen-Rauschen den Text; im Beast Mode
  leuchtet es im Matrix-Grün. Dazu dezente Sounds: ein Daten-Puls in
  unregelmäßigem Rhythmus beim Tippen, ein leiser Pop je Enthüllung
  (Lautstärke regelt das Gerät). Wer im System „Bewegung reduzieren"
  eingestellt hat, bekommt alles sofort und ohne Effekte.

**Realitäts-Check: „Wie gut hat dich die KI wirklich getroffen?"** Nach
jedem echten Menschen-Profil erscheint eine Karte mit sechs Fragen: Sie
zitiert, was die KI zu Alter, Geschlecht, Interessen, Charakter, Werbung
und Manipulation behauptet hat, und du antwortest ehrlich mit **Getroffen /
Knapp / Daneben**. Ein animierter, freigestellter Ring zeigt deine
persönliche KI-Trefferquote samt Einordnung — Treffer beweisen die Macht der
Algorithmen, Fehler ihre Gefahr. Dazu der **anonyme Vergleich mit allen
anderen**: Beim Absenden gehen ausschließlich die Antwort-Stufen an den
Server — kein Foto, kein Profil, nichts Verknüpfbares — und der
Durchschnittsbalken erscheint erst ab 100 Eingaben. Die
Datenschutzerklärung erklärt das jetzt in einem eigenen Satz.

**Hinweis-Pop-up entfernt.** Der „Wichtiger Hinweis"-Dialog vor der Analyse
ist ersatzlos gestrichen — die Analyse startet direkt bei der Foto- oder
Demo-Wahl. Die Einordnung „nichts davon ist wahr" steht weiterhin gut
sichtbar auf der Seite, im Ergebnis und im PDF.

### Wie es funktioniert

Der Analyse-Worker liest die Mistral-Antwort als Datenstrom mit und legt den
bereits geschriebenen Profiltext (beide Modi) gedrosselt ins Auftrags-Dokument
— geschützt durch dasselbe Abhol-Ticket wie das Ergebnis. Der Browser holt ihn
über die vorhandene 2-Sekunden-Abfrage und tippt entkoppelt aus einem Puffer:
keine neue Verbindungsart, kein neues Datenschutz-Thema, absturz- und
sperrbildschirmfest. Ein Neuladen mitten im Tippen fällt bewusst auf das
bisherige Verhalten zurück; Tier-Profile, Fehlerfälle und Wiederaufnahme
bleiben unverändert.

Das Streaming hängt am Serverschalter `useLiveText` — ohne ihn wartet die
Seite wie früher bis zum fertigen Ergebnis. Testumfang jetzt 697 / 280 / 17.

## [2.12.3] — 2026-08-11

Sanierung nach dem Kurzaudit vom selben Tag (kein Blocker, ein mittlerer und
acht kleine Befunde) plus zwei bewusste Entscheidungen.

### Kinderschutz-Filter: Schutzgrenze auf die vereinbarte Regel gestellt

Der altersabhängige Teil des Filters (Glücksspiel, Kredit, Alkohol,
Schönheits-OP, Diät) greift jetzt genau dann, wenn die **Untergrenze** der
geschätzten Altersspanne **18 oder darunter** ist: Spanne 17–24 → Filter
greift, Spanne 19–21 → Filter greift nicht. Der bisherige zusätzliche Abstand
von drei Jahren (Schutz bis unter 21) entsprach nicht der Vereinbarung und ist
entfernt. Die harte Stufe (Pornografie, Waffen, Extremismus) bleibt unverändert
**altersunabhängig** für alle.

### Absturz-Wache zählt nur noch echte Abstürze

Bisher zählte jeder Seitenstart — drei schnelle manuelle Neuladungen binnen
einer Minute lösten die Wache aus und verwarfen einen laufenden Auftrag, obwohl
nichts abgestürzt war. Jetzt meldet sich die Seite beim Verlassen sauber ab
(`pagehide`); nur Starts **ohne** diese Abmeldung — also nach Absturz oder
Kill — zählen. Ungeduldiges Neuladen während der Wartezeit ist damit folgenlos.

### Harte Filter-Treffer im Profiltext lösen jetzt den Alarm aus

Taucht ein Begriff der harten Stufe im ausgelieferten Fließtext auf, ist das
kein Zählfall, sondern ein Regelbruch des Modells — das wird jetzt als echter
Fehler geloggt und erreicht damit den bestehenden E-Mail-Alarm. Die milde
Stufe bleibt ein stiller Zähler (sie schlägt regelmäßig auf den Lerninhalt
selbst an) und wird im Log jetzt je Stufe ausgewiesen.

### Weitere Härtungen

- **Ergebnis-Wiederholung befristet:** Ein fertiges Profil bleibt nach der
  ersten Zustellung 15 Minuten per Neuladen wiederholbar, danach wird still
  aufgeräumt — schützt weitergereichte Geräte, deren Tab durchgehend sichtbar
  bleibt (die 3-Minuten-Übergabepause griff dort nicht).
- **Datenbank-Wächter rekursiv:** `db-zentral.test.js` scannt jetzt auch
  Unterordner von `functions/src` — vorher lagen die Sprachdateien außerhalb
  der Prüfung.
- **Cache-Buster vollständig:** `deploy.sh` hebt die Versionsmarken jetzt auch
  in `public/js/demo.js` an (dort hängen die großen Demo-Bilder); der Wert war
  drei Deploys lang stehen geblieben.
- **Release-Wächter präzisiert:** Text-Korrekturen an bereits veröffentlichten
  CHANGELOG-Abschnitten sind ausdrücklich erlaubt und lassen den
  Release-Automaten grün; scharf bleibt er nur, wenn ein Push die oberste
  Versionsnummer ändert.

### Firestore-Umzug abgeschlossen

Die alte Datenbank `(default)` in `nam5` (USA) ist gelöscht — sie enthielt
zuletzt nur eingefrorene Zählerstände, nichts Personenbezogenes. Damit liegt
kein Speicher dieses Projekts mehr außerhalb Europas. Das Umzugs-Skript ist
ausgebaut, `firebase.json` führt nur noch `malzime-eu`, das RUNBOOK hält den
Abschluss samt Beweisregel fest. Neu im RUNBOOK außerdem: das Nachschau-Rezept
für die Absturz-Wache (bewusste Entscheidung: Beobachtung per Log-Abfrage
statt Alarm).

## [2.12.2] — 2026-08-11

Eine Wache gegen einen Fehler, den bisher niemand sehen konnte.

### Der Anlass

Auf einem iPhone erschien wiederholt Safaris Meldung „Auf https://malzi.me/ ist
wiederholt ein Problem aufgetreten". **Sechs Erklärungen wurden geprüft und
alle sechs ausgeschlossen:**

| Vermutung                          | Ergebnis                                             |
| ---------------------------------- | ---------------------------------------------------- |
| 2-Stunden-Frist der Aufträge       | wird sauber abgefangen, stille Aufräumung            |
| Neulade-Schleife am Stundenlimit   | Limit stand bei 0 von 500                            |
| Absturz beim Laden der Sprachdatei | ist abgefangen, läuft mit Ersatztexten weiter        |
| Foto als Speicherfresser           | liegt als Verweis im Fenster, nicht als Zeichenkette |
| Abfrage-Schleife und Wartefunktion | beide sauber begrenzt und aufgeräumt                 |
| DNS-Ausfall desselben Tages        | zeitlich ausgeschlossen                              |

### Warum Raten hier nicht weiterführt

Wenn diese Meldung erscheint, **läuft der eigene Code nicht mehr** — deshalb
kommt auch keine Fehlermeldung an. Das Ereignis ist unsichtbar. Statt eine
siebte Vermutung zu prüfen, wird es jetzt messbar gemacht.

### Die Wache

Startet die Seite **dreimal binnen einer Minute**, ist das kein normales
Verhalten. Dann passiert zweierlei:

1. **Eine** Meldung geht über den vorhandenen Diagnose-Kanal raus — Anzahl der
   Starts, Zeitspanne, ob ein Auftrag offen war und wie weit die Seite zuletzt
   kam. Keine neue Datenart, kein Foto, keine Kennung.
2. Der gemerkte Auftrag wird verworfen. **Hängt der Absturz an genau diesem
   Auftrag, wiederholt er sich sonst bei jedem Start endlos.** Lieber ein
   verlorenes Ergebnis als eine Seite, die sich nicht mehr öffnen lässt.

Zwei Starts lösen bewusst nichts aus — einmal neu laden ist normal. Eine Wache,
die zu früh anschlägt, wird ignoriert und ist damit wertlos.

Zehn Prüfungen, darunter: schweigt im Normalbetrieb, meldet nur einmal, zählt
alte Starts nicht mit, und ein defekter Speicher (privater Safari-Modus) legt
den Seitenstart nicht lahm.

Frontend 219 Tests, E2E 12.

## [2.12.1] — 2026-08-11

Der Beast Mode überlebt jetzt ein Neuladen.

### Behoben

Wer im Beast Mode die Seite neu lud, landete wieder im seriösen Modus — das
Ergebnis wurde zwar wiederhergestellt, aber im falschen Modus, und die
Umschaltung musste von Hand wiederholt werden.

Das war ursprünglich Absicht („Beast startet immer ausgeschaltet"). Die
Regel ist präzisiert, und die Präzisierung trifft den Kern:

> „Beast startet immer ausgeschaltet — das stimmt, aber ein Reload ist kein
> Start."

Die Wahl liegt jetzt im `sessionStorage`: Sie überlebt Neuladen und
Tab-Wechsel, endet aber mit dem Tab. **Der didaktische Einstieg bleibt damit
erhalten** — im Workshop startet jede neue Person und jedes weitergereichte
Gerät wieder im seriösen Modus und stellt den Kontrast selbst her.

Datenschutz unverändert: dieselbe Ablage, die schon die Job-Nummer nutzt,
nichts Personenbezogenes, endet mit dem Tab. Kein `localStorage` — das wird
eigens geprüft, weil ein Wechsel dorthin die didaktische Zusage still
aushebeln würde.

### Prüfungen

- Unit: sechs Fälle, darunter die Unterscheidung „nie gewählt" gegen „bewusst
  seriös gewählt" und ein defekter Speicher (privater Safari-Modus)
- E2E: umschalten → neu laden → weiterhin Beast; und ein **neuer Tab** startet
  wieder seriös
- Rückbauprobe: Fix entfernt → E2E rot mit `Received: "light"`; wieder
  eingebaut → grün

Frontend 209 Tests, E2E 12.

## [2.12.0] — 2026-08-11

**Die Datenbank läuft ab jetzt in Europa.** Damit stimmt die Zusage der
Datenschutzerklärung erstmals auch für die Datenbank — und das Projekt hat
keinen Speicherort mehr ausserhalb der EU.

### Was sich ändert

Der Schalter aus 2.11.2 ist umgelegt: `FIRESTORE_DATABASE_ID = "malzime-eu"`.
Alle Lese- und Schreibvorgänge gehen in die Datenbank in `europe-west1` — dort,
wo auch die Programme und die Fotos liegen. Für Besucher ändert sich nichts;
die Anwendung verhält sich identisch.

Damit endet der Zustand, dass ein Job-Dokument — und darin bis zu zwei Stunden
lang das fertige Profil eines oft minderjährigen Menschen — in den USA lag.
Das war der letzte offene Punkt aus dem Audit vom 2026-08-10 und zugleich der
schwerste: Die Zusage „Daten in Europa" stand drei Audits lang im Dokument,
ohne dass sie an der Infrastruktur geprüft worden wäre.

### Die alte Datenbank bleibt zunächst stehen

Bewusst nicht gelöscht. Solange sie existiert, ist der Rückweg zwei Minuten
weit weg: `scripts/firestore-umzug-sync.mjs --zurueck`, Schalter zurück,
ausrollen. Löschen erst nach ein paar ruhigen Tagen im Betrieb.

### Nachweis

Nicht behauptet, sondern gemessen — Ablauf in
[RUNBOOK](docs/RUNBOOK.md), Abschnitt „Firestore-Umzug".

Backend 618 Tests grün.

## [2.11.2] — 2026-08-11

Vorbereitung des Umzugs **der Datenbank** nach Europa. **Ändert das Verhalten
nicht** — der Schalter steht weiterhin auf der alten Datenbank.

### Worum es geht — und worum ausdrücklich nicht

Betroffen ist **ausschliesslich die Firestore-Datenbank**, nicht die Speicherorte
insgesamt. Zur Klarstellung, weil das leicht verwechselt wird:

|                                     | Standort       | betroffen?                   |
| ----------------------------------- | -------------- | ---------------------------- |
| **Fotos** (`malzime-queue-uploads`) | `europe-west1` | nein — lagen immer in Europa |
| Quellstände der Functions           | `europe-west1` | nein                         |
| **Firestore-Datenbank**             | `nam5` (USA)   | **ja — darum geht es hier**  |

Die hochgeladenen Bilder haben Europa also zu keinem Zeitpunkt verlassen. Das
wurde an der Infrastruktur nachgemessen, nicht aus dem Quelltext geschlossen.

### Warum die Datenbank

Die Datenschutzerklärung verspricht Europa; die Datenbank liegt in `nam5` (USA),
und ein Job-Dokument enthält bis zu zwei Stunden lang das fertige Profil eines
oft minderjährigen Menschen. Der Standort einer Firestore-Datenbank ist
**unveränderlich** — es gibt keinen Umzugsknopf. Der Wechsel läuft deshalb über
eine zweite Datenbank.

### Was in der neuen Datenbank liegt — und was nicht

**Es sind noch keine Nutzerdaten dorthin gelangt.** Kopiert wurden
ausschliesslich drei technische Dokumente: die Schalterstellungen der
Anwendung, der Zählerstand des Stundenlimits und die Gesamtzähler. Kein Foto,
kein Profil, keine Auftragsdaten, nichts Personenbezogenes.

Der Schalter steht unverändert auf der alten Datenbank — der laufende Betrieb
schreibt weiterhin dorthin. Die neue Datenbank ist vorbereitet, aber noch nicht
in Benutzung.

### Vorbereitet

- Datenbank `malzime-eu` in `europe-west1` angelegt — dort liegen auch die
  Functions und der Foto-Bucket. Regeln und Indizes auf beide ausgerollt.
- Die drei dauerhaften Dokumente kopiert und als identisch nachgewiesen.
  `jobs/*` (2 h) und `usedNonces/*` verfallen von selbst und ziehen nicht mit.
- Neue Datei `functions/src/db.js`: `datenbank()` ist die **einzige** Stelle,
  an der eine Firestore-Verbindung entsteht. 22 direkte Aufrufe in vier
  Dateien darauf umgestellt.
- `scripts/firestore-umzug-sync.mjs` überträgt die Dokumente in beide
  Richtungen — der Rückweg ist damit genauso vorbereitet wie der Hinweg.

### Der eigentliche Schutz

Beim Umschalten hätte eine übersehene Stelle **still weiter nach Amerika
geschrieben** — ohne Fehler, ohne Log. Genau so war die Zusage „Daten in
Europa" drei Audits lang unbemerkt falsch. `db-zentral.test.js` verbietet den
Import von `getFirestore` ausserhalb `db.js`, prüft beide Schalterstellungen
und hält fest, worauf der Schalter steht — beim Umschalten wird er absichtlich
rot, als eingebaute Erinnerung, die Dokumentation mitzuziehen.

Backend 618 Tests (611 + 7 neue). Ablauf, Nachweis und Rückweg:
[RUNBOOK](docs/RUNBOOK.md), Abschnitt „Firestore-Umzug".

### Letzter US-Speicher entfernt (Infrastruktur, kein Code)

`malzime_cloudbuild` lag als einziger Speicher in den USA. Inhalt geprüft, bevor
etwas passierte: **7 Dateien, 5 Kilobyte, neueste vom 6. Juni** — die
Bauanleitung des ntfy-Servers (Dockerfile, `entrypoint.sh`, `server.yml`).
**Keine Nutzerdaten, keine Zugangsdaten** (die Passwörter kommen zur Laufzeit
aus Umgebungsvariablen, der Dockerfile hält das ausdrücklich fest), kein
ntfy-Kanalname.

Der Speicher war seit zwei Monaten unbeteiligt: Die Deploys dieses Tages haben
in den EU-Speicher `gcf-v2-sources-…-europe-west1` geschrieben, nicht dorthin.
Die Bauanleitung existierte nirgends sonst und wurde vor dem Löschen ausserhalb
des Repos gesichert.

**Damit liegt kein einziger Speicher des Projekts mehr ausserhalb Europas.**

## [2.11.1] — 2026-08-11

Drei Fehler, die in der Browser-Konsole sichtbar waren, plus der echte Fehler
dahinter. Im laufenden Betrieb aufgefallen.

### Behoben

- **Karten-Bibliothek verwies auf eine Datei, die es nicht gibt.**
  `leaflet.js` endete mit `//# sourceMappingURL=leaflet.js.map`; diese
  Begleitdatei wurde nie mitausgeliefert. Firebase Hosting antwortet für
  unbekannte Pfade mit der **Startseite** (HTTP 200, `text/html`, 20396 Bytes)
  — der Browser wollte JSON parsen und meldete
  `JSON Parse error: Unrecognized token '<'`. Verweis entfernt.
- **Formatierung im HTML, die die eigene Sicherheitsrichtlinie verbietet.**
  `stats.html` setzte die Startbreite der Limit-Anzeige als
  `style="width: 0%"`. Die CSP erlaubt `style-src 'self'` ohne
  `'unsafe-inline'`; der Browser verwarf das Attribut und meldete es bei jedem
  Aufruf. Startbreite nach `styles.css` verschoben. Was JavaScript über die
  CSSOM setzt, war und bleibt erlaubt.
- **Reduzierte Bewegung schaltete nur die Dauer ab, nicht die Verzögerung.**
  Die Profilkarten laufen mit `animation: fadeUp … both` und gestaffelten
  `animation-delay` bis 0,33 s. `both` hält während der Wartezeit den
  Startzustand `opacity: 0`. Wer Animationen ausdrücklich abbestellt hatte, sah
  die Karten also weiterhin nacheinander aufpoppen — nur ohne Bewegung.
  `animation-delay` und `transition-delay` werden jetzt mit zurückgesetzt.

### Neue Dauerprüfungen

- Jeder Source-Map-Verweis im Hosting-Ordner muss auf eine real vorhandene
  Datei zeigen — geprüft am **Dateibestand**, nicht über HTTP. Grund: Ein
  HTTP 200 von diesem Hosting beweist nicht, dass eine Datei existiert.
- Keine `style`-Attribute in den ausgelieferten HTML-Seiten.
- Bei reduzierter Bewegung darf keine Profilkarte unsichtbar bleiben (E2E,
  Prüfung auf die Ursache statt auf das Symptom, dadurch nicht flackernd).

Alle drei mit Rückbauprobe belegt. Frontend 203 Tests, E2E 10.

### Wie der dritte Fehler gefunden wurde

Der A11y-Test meldete im CI 19 ernste Kontrastverstöße im Beast Mode — an
Elementen, die niemand angefasst hatte. Es sah nach einem flackernden Test aus.
Tatsächlich maß axe unsichtbaren Text: Die Karten warteten noch auf ihre
Einblende-Verzögerung. Der Fund war echt, nur nicht dort, wo er zu stehen
schien.

### Betrieb (nicht im Code sichtbar)

- Die Alarm-Richtlinie schickt jetzt zusätzlich an einen **E-Mail-Kanal**. Der
  ntfy-Push war nicht als zugestellt nachweisbar; Priorität, Weiterleitung und
  Kanalzuordnung schieden als Ursache aus. Zustellung der E-Mail mit einem
  Testalarm **belegt**. Rezept in `docs/ERROR-ALERTING.md`.
- Die DNS-Zone von `malzi.me` steht erstmals schriftlich im
  [RUNBOOK](docs/RUNBOOK.md) — samt Prüfbefehlen und einer Vorfallnotiz.
- `api.malzi.me` ist vollständig abgebaut (DNS und Cloud-Run-Zuordnung).

## [2.11.0] — 2026-08-11

Sanierung des LANGAUDIT vom 2026-08-10 (Bericht wird nicht veröffentlicht).
**36 der 38 Befunde geschlossen**, jeder mit einer Prüfung dahinter und einer
Rückbauprobe: Quellcode zurückgedreht, Prüfung behalten, rot gesehen,
wiederhergestellt.

Die beiden übrigen: Der Firestore-Umzug in die EU (PRIV-001) folgt bewusst als
eigener, isolierter Schritt auf einem geprüften Stand. Bei der Alarmierung
(OPS-003) ist die Zustellung an den richtigen Kanal repariert und belegt — dass
die Meldung als Push auf dem Sperrbildschirm ankommt, ist noch offen.

Einer der 36 ist ausdrücklich **verworfen statt behoben**: das anonyme Schreiben
am geteilten ntfy-Dienst (SEC-005). Begründung in `docs/SECURITY-MODEL.md` —
das Topic ist seit der Rotation ein 30-stelliger Zufallswert, und eine Sperre
würde die Benachrichtigungen anderer Projekte brechen, die nicht Teil dieses
Audits sind.

### Behoben

- **Jugendliche bekamen ein Tier-Profil statt ihrer Analyse.** Das Netz gegen
  „Tier wird als Mensch analysiert" prüfte im aktiven Weg nicht die
  Bildbeschreibung, sondern den daraus erzeugten Profiltext — „Apex Legends"
  enthält „ape", „Affekt" enthält „affe". Beim eigentlichen Anlassfall, dem
  Affenbild, sprang es dagegen nie an: Dort schreibt das Modell ein
  Kinderprofil ohne Tierwörter. Es fing also seinen eigenen Anlassfall nie und
  ausschließlich Fehlalarme — deshalb **ersatzlos entfernt** statt die Wortliste
  zu entschärfen. Der Schutz liegt jetzt allein in der Prompt-Regel „Primaten
  sind immer ANIMAL_ONLY", die bisher nur im aktiven Prompt stand und nun in
  **beiden** Pfaden und **beiden** Sprachen steht.
- **Der Kinderschutz-Filter hatte drei Löcher.** Bei englischsprachigen
  Durchgängen rutschten 10 von 12 Werbephrasen durch, darunter Pornografie,
  Schusswaffen und Neonazi-Kleidung — also die Stufe, die altersunabhängig
  greifen soll. Im Deutschen traf `\bkredit` zwar „Kredit", aber weder
  „Sofortkredit" noch „Ratenkredit", also genau die übliche Wortbildung. Und
  geprüft wurden nur zwei von rund fünfzehn Textfeldern: Derselbe Begriff wurde
  aus der Werbeliste entfernt und im Profiltext ausgeliefert. Alles drei
  behoben; im Fließtext wird bewusst nur **gemeldet**, nicht herausgeschnitten.
- **Der Filter war zugleich zu scharf.** Auf die Manipulations-Trigger wirkte
  dieselbe Werbeliste — dadurch verschwand bei Kindern der Satz „Lootboxen
  arbeiten mit denselben Mechaniken wie Glücksspiel, nur ohne Altersgrenze".
  Das ist die Kernaussage des Workshops. Dort greift jetzt nur noch die harte
  Stufe.
- **Das Profil des vorigen Kindes konnte neben dem neuen Foto erscheinen** —
  und das neue Foto wurde dabei nie hochgeladen. Wechselte jemand während des
  Uploads kurz die App, holte die Wiederaufnahme das alte Ergebnis und verdrängte
  den laufenden Durchgang. Außerdem setzte nach einer fertigen Analyse **jeder**
  Tab-Wechsel das Ergebnis neu (Sprung an den Seitenanfang, Fokus-Sprung,
  zusätzlicher Telemetrie-Erfolg).
- **Auf geteilten Tablets blieb das Ergebnis erreichbar**, bis der Tab
  geschlossen wurde — im Klassenzimmer der unwahrscheinlichste Vorgang. Nach
  einer Pause von drei Minuten wird das Abhol-Ticket jetzt fallen gelassen; ein
  kurzer App-Wechsel ändert weiterhin nichts.
- **Der Beleg-Satz auf der Alterskarte kam nie an.** Der Server überschrieb den
  Kartenwert vollständig mit dem kurzen Anker und warf damit den zweiten Satz
  weg — das konkrete, vorführbare Merkmal, das v2.9.0 eingeführt hatte. Er wird
  jetzt vorangestellt statt eingesetzt; Standard- und Beast-Ansicht
  unterscheiden sich an dieser Karte wieder.
- **Un-gekennzeichnete Fassungen der KI-Demo-Fotos waren öffentlich abrufbar.**
  Der Sicherungsordner des Wasserzeichen-Skripts lag innerhalb des
  Hosting-Verzeichnisses und wurde mit ausgeliefert.
- **Ein abreißender Antwort-Rumpf fror die Warteschleife ein.** Der Zeitgeber
  endete, sobald die Kopfzeilen da waren; bricht die Verbindung danach mitten im
  Rumpf ab, kam nie ein Fehler und nie ein Ergebnis.
- **Ein Foto konnte liegen bleiben**, wenn der Worker hart starb: Der Aufräumer
  löschte das Job-Dokument samt Bildpfad, ohne das Bild selbst anzufassen.
- **Die englischen Fehlermeldungen nannten „Google's safety filters".** Seit
  v1.6 läuft ausschließlich Mistral.

### Geändert

- **Der Einlass bremst ab 155 Wartenden.** Seit die Parallelität in v2.8 von 10
  auf 7 sank, schafft die Warteschlange rund 387 Analysen pro Stunde, der
  Einlass lässt aber 500 zu. Wer hinter etwa 190 Wartenden einreiht, läuft
  garantiert in den 30-Minuten-Deckel des Browsers — der Job lebt weiter und
  kostet Geld, der Teilnehmer sieht einen Timeout. Statt das Stundenlimit zu
  senken (das würde einem laufenden Workshop den Hahn zudrehen) lehnt der
  Einlass ab dieser Tiefe ehrlich ab.
- **Zu große Uploads werden an der Türschwelle abgelehnt.** Ein 23-MB-Bild
  kostet als Base64 rund 170 MB Arbeitsspeicher — bei 512 MiB Grenze reichten
  wenige gleichzeitige Uploads, um die Instanz zu töten. Die bisherige Prüfung
  kam zu spät, weil die Laufzeit den Rumpf vorab vollständig einliest.
- **Wer nur pollt, hält seinen Job nicht mehr ewig am Leben.** Jede Abfrage
  erneuerte den Herzschlag; damit ließ sich das gesamte Stundenfenster dauerhaft
  blockieren, ohne dass je ein Platz zurückkam. Nach 35 Minuten wird jetzt
  abgeräumt — der Browser gibt ohnehin nach 30 auf.
- **Sichtbarer Text im Bild gilt ausdrücklich als Bildinhalt, nie als
  Anweisung.** Die Warnung stand bisher nur im inaktiven Rückfall-Prompt.
- **Neues Flag `useBeastAdsCall`** — Notausschalter für den zweiten
  Mistral-Aufruf, ohne Deploy. Er verdoppelt die Anfragen pro Minute; bisher gab
  es keinen Weg, ihn unter Last stillzulegen.
- **Der Prompt-Cache am zweiten Aufruf war wirkungslos.** Alles steckte in einer
  Nachricht, das Profil stand vor den Anweisungen: live 0 % Trefferquote gegen
  87 % beim Hauptaufruf. Jetzt getrennt in konstanten und wechselnden Teil.
- **Ein fehlschlagender zweiter Aufruf löst jetzt Alarm aus.** Vorher war ein
  dauerhafter Ausfall unsichtbar — der Rückfall greift, niemand merkt etwas, und
  jede Analyse liefe still mit der schlechteren Werbung.
- **Der Kinderschutz-Filter protokolliert bei jeder Analyse**, auch ohne
  Treffer. Vorher entstand nur bei einem Treffer eine Zeile; ein systematischer
  Ausfall war von „alles sauber" nicht zu unterscheiden.
- **Beschriftungen für Screenreader sind übersetzbar** (`data-i18n-aria`).

### Betrieb

- **Der Alarm-Kanal zeigte seit dem 17. Juli auf das alte ntfy-Topic.** Die
  Rotation war nur zur Hälfte ausgeführt: Die Functions pushten auf das neue
  Topic, Cloud Monitoring auf das alte. Fehleralarme kamen damit drei Wochen
  lang nirgends an — auch nicht der für die ausgefallene Kostenbremse.
- **Gelöschte Fotos sind nicht mehr sieben Tage wiederherstellbar.** Google hat
  Soft-Delete nachträglich für alle Buckets aktiviert; die Zusage „unmittelbar
  gelöscht" stimmte dadurch nicht.
- **Versionsnummern zeigen wieder auf den Code, den ihr Abschnitt beschreibt.**
  `v2.9.2` zeigte auf einen Stand, der Minuten später zurückgenommen wurde — ein
  Rollback wäre dort gelandet. `release.yml` läuft jetzt rot, wenn eine bereits
  veröffentlichte Nummer wiederverwendet wird, statt still auszusteigen.
- **Die Pflicht-Prüfungen gelten jetzt auch für den Besitzer**
  (`enforce_admins`). Sie existierten, hatten aber eine Ausnahme für genau die
  einzige Person, die etwas hochlädt — vier Veröffentlichungen gingen an einer
  roten Prüfung vorbei. `playwright-version` ist zusätzlich Pflicht-Prüfung,
  damit der E2E-Test nicht stillschweigend übersprungen werden kann.
- **Dependabot führt nichts mehr automatisch zusammen, was `functions/`
  berührt.** Die bisherige Ausnahme prüfte auf einen Einzelwert und lief bei
  gruppierten Sicherheits-Aktualisierungen ins Leere.
- **Verwaister Testdienst `ntfy-authtest` gelöscht** — öffentlich erreichbar,
  seit Juni nicht aktualisiert, im Repo nirgends erwähnt.
- **`api.malzi.me` aus der Sicherheitsrichtlinie entfernt.** Der Host zeigt auf
  eine gelöschte Funktion; der DNS-Eintrag muss vor der Cloud-Run-Zuordnung weg
  (Anleitung im RUNBOOK).

### Tests

- **Das Escaping der Modellausgabe ist jetzt abgesichert.** Es war korrekt, aber
  eine Mutationsprobe zeigte: Entfernt man jedes `escapeHtml` aus `render.js`,
  bleiben alle Tests grün. Fünf Nutzlasten prüfen es jetzt am DOM.
- **Die mit v2.10 verlorenen Upload-Prüfungen sind nachgezogen** — Zeichensatz,
  Größe, MIME-Liste, Kappung der Kamera-Metadaten und die Reihenfolge „Honeypot
  vor Zähler". Letztere hätte gebrochen werden können, ohne dass ein Test rot
  wird; jeder Bot-Aufruf hätte dann einen Platz des Stundenlimits verbrannt.
- **Beast Mode wird auf Barrierefreiheit geprüft** — er wechselt das gesamte
  Farbschema und war nie gemessen. Der Umschalter ist jetzt auch im
  Tastaturtest. Beide Prüfungen finden keine Verstöße.
- 611 Backend-, 193 Frontend- und 10 E2E-Tests.

### Entfernt

- `functions/src/heartbeat.js` — hatte seit v2.10 keinen Aufrufer mehr, wurde
  aber in README und ARCHITECTURE weiter als aktive Komponente geführt.

## [2.10.0] — 2026-08-10

### Entfernt

- **Der synchrone `/analyze`-Pfad ist abgebaut.** Der alte Weg vor der Warteschlange: Browser schickt das Bild, hält die Verbindung 30 bis 60 Sekunden offen, wartet auf die Antwort. Seit Mai 2026 trägt die Warteschlange jeden Upload; der synchrone Weg war nur noch Rückfall über ein Feature-Flag.

  **Warum er weg kann:** Der Notausstieg half gegen die meisten Störungen ohnehin nicht — Mistral langsam oder überlastet, Budget-Stopp, Stundenlimit, Firestore-Störung oder ein Fehler im gemeinsamen Code treffen beide Wege gleich. Nur eine reine Cloud-Tasks-Störung wäre der Fall gewesen, für den er gebaut wurde. Und bei Stoßlast wäre der Rückfall selbst das Problem geworden: Die Warteschlange existiert genau wegen der Fünfundzwanzig-gleichzeitig-Situation, in der lange offene Verbindungen wegbrechen und der Bildschirm-Wachhalter auf iPhones nicht greift. In über 5.000 Analysen seit Mai gab es keine einzige dokumentierte Störung der Warteschlange.

  **Was verschwindet:** `handle-analyze.js` (439 Zeilen), der synchrone Zweig im Frontend (330 Zeilen) samt Auto-Wiederholung, die Route `exports.analyze`, das Feature-Flag `useQueue` und 39 Tests, die nur den alten Weg prüften. Der Nebeneffekt zählt fast mehr als die Zeilen: Solange beide Wege existierten, musste jede Änderung am Profil-Zusammenbau **doppelt** gebaut werden — beim Werbe-Umbau in v2.8 ist das konkret aufgeschlagen.

  **Ersatz für den Rollback-Hebel:** Der Wartungsmodus (Hebel 1 im Betriebshandbuch) übernimmt. Er sagt der Klasse ehrlich „gleich zurück", statt sie auf einen Weg zu schicken, der unter Last auch nicht trägt. Das Betriebshandbuch führt Hebel 2 jetzt als entfallen mit Begründung.

  **Übergang für alte Clients:** `/api/stats` meldet weiterhin `useQueue: true`. Wer die Seite aus dem Zwischenspeicher lädt, prüft dieses Feld und würde ohne es auf einen Weg fallen, den es nicht mehr gibt. Kann in einigen Wochen ersatzlos weg.

### Geändert

- **Dokumentation auf den aktuellen Stand gebracht.** Dreiunddreißig Stellen in zehn Dateien beschrieben noch den synchronen Pfad als aktiven oder rückfallfähigen Weg — README (Schnittstellen-Beschreibung), ARCHITECTURE, FLAGS, RUNBOOK, SETUP, SELF-HOSTING, VERIFICATION, QUEUE-EMULATOR, CONTRIBUTING und AGENTS. In `FLAGS.md` ist damit auch das dort notierte Entfernungs-Kriterium erfüllt und abgehakt.

## [2.9.2] — 2026-08-10

### Geändert

- **Fünf von sieben Abhängigkeits-Ausnahmen entfernt.** Diese `overrides` zwingen ein Paket, eine bestimmte Version einer tief liegenden Abhängigkeit zu nutzen — nötig, solange dort eine Sicherheitslücke steckt, die der Hersteller noch nicht selbst geschlossen hat. Nachgemessen mit entfernten Ausnahmen in einer Arbeitskopie: `glob`, `test-exclude`, `rimraf` und `brace-expansion` (Root **und** functions) melden inzwischen **keine Schwachstelle mehr** — die Pakete haben nachgezogen, die Ausnahmen hielten nur noch Versionen fest, die ohnehin kämen.

  **Übrig bleiben zwei, die wirklich etwas tun:** `uuid ^11.1.1` verhindert allein sieben Meldungen (Puffergrößen-Prüfung, GHSA-w5hq-g745-h8pq; die Kette läuft über Google-Cloud-Storage bis firebase-functions), und die Kopplung `firebase-functions → firebase-admin: $firebase-admin` hält beide auf derselben Version.

  Bewusst in Kauf genommen: Ohne die Ausnahmen zieht npm bei einigen Nebenpaketen wieder ältere Stände (z.B. `cliui` 9.0.0 → 8.0.2). Der Zweck dieser Sonderregeln ist Sicherheit, nicht Aktualität — und ungepflegte Sonderregeln sind selbst eine Fehlerquelle. `npm audit` bleibt in beiden Projekten bei 0/0, mit und ohne Entwicklungspakete. Die Lockfile-Falle wurde geprüft (`npm ci --dry-run` in Root und functions, beide exit 0).

## [2.9.1] — 2026-08-10

### Behoben

- **Das Foto verschwand, wenn die Analyse aus dem Hintergrund zurückkam.** An seiner Stelle stand der Hinweis „Foto gelöscht" — obwohl gar kein Neuladen stattgefunden hatte. Die Wiederaufnahme war ursprünglich nur für den Reload-Fall gebaut, wo das Foto tatsächlich weg ist, und setzte den Hinweis unbesehen. Kommt die Seite dagegen aus dem Hintergrund zurück, lief sie durchgehend und das Bild steht noch im Fenster. Der Hinweis erscheint jetzt nur noch, wenn wirklich kein Foto mehr da ist.

  Datenschutzrechtlich ändert das nichts: Gespeichert wird nach wie vor nirgends etwas, weder im Browser noch serverseitig. Es wird lediglich nicht weggeworfen, was ohnehin schon angezeigt wird. (+2 Tests, Mutationsprobe bestanden)

## [2.9.0] — 2026-08-10

### Hinzugefügt

- **Der Kinderschutz-Filter schneidet nicht mehr bei exakt 18.** Er nimmt jetzt die **Untergrenze** der Altersspanne, die das Modell selbst liefert — wer „16-22" sein könnte, gilt als schutzbedürftig — und darauf drei Jahre Sicherheitsabstand. Anlass: Aus rund 5.000 begleiteten Workshop-Analysen ist bekannt, dass Mädchen bis zu sechs Jahre zu alt geschätzt werden. Mit einer harten 18er-Grenze verlor damit ausgerechnet ein zu alt geschätztes vierzehnjähriges Mädchen den Schutz vor Glücksspiel-, Alkohol-, Kredit- und Diätwerbung — im Klassenzimmer, an die Wand projiziert. Der Preis ist bewusst in Kauf genommen: Ein tatsächlich Neunzehn- bis Einundzwanzigjähriger sieht diese Werbung nicht mehr, obwohl sie dort legitimer Lerninhalt wäre. Die Abwägung ist asymmetrisch — eine Vierzehnjährige mit Glücksspielwerbung ist ein Schaden, einem Neunzehnjährigen fehlt ein Beispiel. (`minor-safety.js`)

- **Altersmerkmale für Kinder und Jugendliche, die bei beiden Geschlechtern gleich schnell laufen.** Vorher war die _primäre_ Alters-Achse die **Schulterbreite**, dazu kam eine Zusatzregel, die nur für Mädchen galt („Mädchen erreichen diese Spanne oft ohne Akne und Bartflaum"). Beides hängt an der Pubertät, und die beginnt zwischen 8 und 14 Jahren, bei Mädchen im Schnitt zwei Jahre früher. Wer daran das Alter misst, schätzt Mädchen zwangsläufig zu alt und Jungen zu jung — das aus der Praxis berichtete Muster stand also wörtlich in der eigenen Anweisung. Neu sind Augenlinie im Kopf, Zahnstand, Wangenfett, Nasenrücken und Kopf-Körper-Verhältnis; Reifemerkmale sind ausdrücklich als untauglich benannt, mit Begründung. **Kein Ausgleich, keine Korrekturzahl** — nur bessere Merkmale. Bei Erwachsenen gelten fehlende Falten nicht mehr als Beleg für Jugend: Bei Mimik, Make-up oder flachem Gegenlicht entscheiden Hals, Hände und Haaransatz, und die Alters-Skala ist neu geeicht (18-30 / 30-42 / 40-52 / 50-62 / 60+).

- **KI-Kennzeichnung auf den drei Demo-Fotos.** Sie sind KI-generiert (`public/img/demo/LICENSE.md`) und fallen unter die seit August 2026 geltende Kennzeichnungspflicht. Sichtbar in die Pixel gebrannt („KI ERSTELLT", rechts unten), maschinenlesbar über `DigitalSourceType = trainedAlgorithmicMedia` (offizieller IPTC-Wert für vollständig algorithmisch erzeugte Bilder) und für Suchmaschinen über strukturierte Daten, alt-Texte und den Hinweis „(mit KI erstellt)" in beiden Sprachen. Bewusst kein reines CSS-Overlay: Das verschwindet, sobald jemand das Bild speichert oder weitergibt. Werkzeug: `scripts/ki-wasserzeichen.mjs`.

  Zwei Punkte, die dabei Arbeit gemacht haben und im Skript dokumentiert sind: **Der Vorgang löscht alle EXIF-Daten** — und die sind bei den Demo-Bildern absichtlich (fiktiv) gesetzt, weil malziME daran vorführt, welche versteckten Daten in einem Foto stecken; sie werden jetzt vom Original übernommen. Und **die Badge-Größe richtet sich nach der Anzeige-, nicht nach der Dateibreite**: Ein Thumbnail erscheint in der Kachel rund 200 px breit, ein Vollbild in der Vorschau rund 360 px — dieselbe Prozentangabe wirkt dort völlig verschieden. Kachel und Vorschau haben deshalb eigene Zielgrößen (7 bzw. 13 px in der Anzeige), und die Thumbnails werden gleich im Kachel-Format 3:2 erzeugt, damit die Kachel sie vollständig zeigt statt die untere Hälfte samt Badge wegzuschneiden.

### Behoben

- **Ein Affenbild wurde als Profil eines afrikanischen Kleinkindes analysiert.** Gemeldet aus einem Workshop. Die Verwechslung Primat/schwarzer Mensch ist ein dokumentiertes Muster in Bildmodellen (Google Photos hat 2015 Schwarze als „Gorillas" einsortiert und das nie behoben, sondern nur die Kategorie entfernt) — kein Zufall dieses einen Bildes.

  **Die vorhandene Tiererkennung hat dabei nicht versagt.** Der Prompt verlangt ein Pflichtfeld `subject`, bei `ANIMAL_ONLY` kommt statt eines Profils das Tier-Easter-Egg, und das läuft in beiden Pipelines. Das Modell hatte schlicht `HUMAN` gemeldet — ab da folgt die Erkennung korrekt einer Einschätzung, die schon falsch war. Eine zusätzliche Vorprüfung „ist ein Mensch im Bild?" würde deshalb nichts ändern; sie existiert bereits und träfe dieselbe Fehlentscheidung. Zwei Änderungen setzen tiefer an: eine Merkmals-Prüfliste im Prompt (Fell statt Haut, Schnauze statt Nase, Pfoten statt Händen) samt der Regel, dass Primaten **immer** `ANIMAL_ONLY` sind, und serverseitig ein Netz (`animal.js` `pruefeTierWiderspruch`), das bei `HUMAN` plus beschriebenen Tiermerkmalen das Tier-Easter-Egg ausliefert statt eines erfundenen Menschenprofils. Bewusst eng gefasst, mit Ausnahmeliste für Pferdeschwanz, Fellweste, Kunstfell und Katzenaugen-Lidstrich. **Grenze:** Beschreibt das Modell durchgehend einen Menschen, findet auch dieses Netz nichts.

- **Die Analyse ging verloren, wenn das Handy zwischendurch gesperrt war.** Es erschien „Netzwerkfehler", und auch ein Neuladen brachte das Ergebnis nicht zurück — obwohl der Job serverseitig weiterlief und rund zwei Stunden bereitlag.

  Die eigentliche Ursache lag nicht bei der Fehlermeldung, sondern eine Zeile weiter: **Bei jedem Fehler wurde die Job-Nummer weggeworfen** (`clearStoredJobId`), auch bei einem bloßen Verbindungsabbruch. Damit war das fertige Profil unerreichbar, denn die Nummer ist der einzige Weg dorthin. Sie bleibt jetzt erhalten, wenn nur die Verbindung weg ist; aufgeräumt wird nur, wenn der Job wirklich weg ist (404, fehlgeschlagen, abgelaufen).

  Dazu setzt der Durchgang sich bei der Rückkehr aus dem Hintergrund **neu auf**, statt auf die alte Schleife zu vertrauen: Beim Sperren friert der Browser nicht nur die Netzwerkanfrage ein, sondern die JavaScript-Ausführung insgesamt — die Schleife kann danach in einem `fetch` feststecken, der nie zurückkommt. Ist seit der letzten erfolgreichen Statusabfrage zu viel Zeit vergangen, wird deshalb neu abgefragt. Ein kurzer Tab-Wechsel löst das nicht aus.

  Die Meldung sagt jetzt außerdem, was Sache ist: „Verbindung unterbrochen. Deine Analyse läuft weiter" statt „Netzwerkfehler".

  **Ein erster Anlauf hatte nur die Fehlerzählung angefasst** — Fehlschläge im Hintergrund nicht mitzählen — und wurde nach kurzer Zeit zurückgenommen: Er beseitigte die Fehlermeldung, hinterließ aber einen stillen toten Zustand ohne Spinner, Status oder Ergebnis. Das ist schlechter als eine falsche Meldung, weil es nicht einmal zum Neuladen auffordert. Der zugehörige Test war grün und bestand die Mutationsprobe, bildete die Realität eines gesperrten Handys aber nicht ab: `document.hidden` zu setzen und Anfragen scheitern zu lassen ist etwas anderes als ein eingefrorener Tab. (+4 Tests, drei Mutationsproben bestanden)

- **Vollbilder der Demo-Fotos wurden mit einem Cache-Buster vom Februar geladen** (`demo.js`) — ein Bildwechsel wäre bei niemandem angekommen, der die Seite schon einmal besucht hat.

### Gemessen

84 Analysen über 14 Fotos, drei Läufe je Bild, gegen die am 2026-08-10 geprüfte und korrigierte Wahrheitsliste:

| Größe                                      | vorher | v2.9.0    |
| ------------------------------------------ | ------ | --------- |
| Abweichung Kinder/Jugendliche              | 0,8 J  | 0,8 J     |
| Abweichung Erwachsene                      | −7,2 J | −6,5 J    |
| Antworten mit konkretem, zeigbarem Merkmal | 95 %   | **100 %** |
| Antworten mit Leerformel                   | 43 %   | **38 %**  |
| Geschlecht richtig                         | 85,7 % | 85,7 %    |
| Parse-Fehler / abgeschnittene Antworten    | 0 / 0  | 0 / 0     |

Der belastbare Gewinn liegt bei den **Begründungen**: statt „kindliche Gesichtszüge und glatte Haut bestätigen diese Altersspanne ohne sichtbare Pubertätsmerkmale" steht dort jetzt „deine Zähne sind bleibend, aber noch etwas groß fürs Gesicht, und die Wangen sind rund ohne sichtbare Wangenknochen". „Schultern" und „Statur" kommen in keiner Antwort mehr vor (vorher in acht). Das ist im Workshop vorlesbar und am Bild zeigbar.

Die Alterszahlen selbst sind **kein Beweis**: Im Testset stecken nur sechs Minderjährige, drei je Geschlecht — ein einzelnes Bild kippt den Mittelwert, und das aus der Praxis berichtete Geschlechtsmuster tritt in diesen sechs Fotos gar nicht auf. Ob die Änderung es behebt, zeigt sich erst im Workshop-Betrieb.

### Untersucht und verworfen

- **Bildauflösung als Ursache des Erwachsenen-Fehlers.** Zwei Gegentests widerlegen den Verdacht: Bei **halber** Auflösung (640 px) landen dieselben Fotos auf die Kommastelle genau wieder bei 28 und 32 — die Zahl stammt aus der Regel, nicht aus dem Bild. Bei **voller** Auflösung (2252×4000 statt 1280) verbessert sich die Schätzung um zwei Jahre, kostet aber das Sechsfache an Upload bei nur vier Prozent mehr Tokens. Die Verkleinerung bleibt wie sie ist.
- **Der Jung-Bias bei Erwachsenen bleibt bestehen** (−6,5 Jahre). Vier der sieben Erwachsenenfotos landen unverändert auf exakt 28. Damit ist zum achten Mal bestätigt, was seit v2.8 im CHANGELOG steht: Alter ist keine Prompt-Frage. Die Neu-Eichung hat einen bekannten Denkfehler — die unterste Stufe wurde auf 18-30 verbreitert und bestätigt damit den 28er-Wert, der das Problem ist. Sie bleibt trotzdem drin, weil sie ein Foto um sechs Jahre verbessert und keines verschlechtert.
- **Ein erster Anlauf gegen den Abbruch im Hintergrund** („Netzwerkfehler", während das Handy in der Tasche liegt) wurde nach kurzer Zeit wieder zurückgenommen: Er beseitigte zwar die Fehlermeldung, hinterließ aber einen stillen toten Zustand — kein Spinner, kein Status, kein Ergebnis. Das ist schlechter als eine falsche Fehlermeldung, weil es nicht einmal zum Neuladen auffordert. Der Test dazu war grün und bestand sogar die Mutationsprobe, bildete die Realität eines gesperrten Handys aber nicht ab. Ursache wird untersucht, bevor ein zweiter Anlauf kommt.

## [2.8.1] — 2026-08-10

### Behoben

- **Umschalten ganz oben auf der Seite sprang zur Ergebnisliste.** Stand man bei der Überschrift und wechselte den Modus, scrollte die Seite nach unten und die Überschrift verschwand — der Einstieg begann plötzlich bei der Foto-Auswahl. Ursache war der Scroll-Anker aus v2.6.0: Er suchte die erste Karte, die unter der geklebten Leiste hervorschaut, und fand dabei auch Karten, die noch gar nicht im Bild waren. Beim Umschalten wurde dann dorthin gescrollt. Jetzt muss die Ankerkarte zusätzlich **innerhalb des Bildschirms beginnen** — steht keine Karte im Bild, ist man nicht in der Liste und es gibt nichts zu verankern. (`public/js/sticky-toggle.js`, +2 Unit-Tests, +1 E2E-Test, Mutationsprobe bestanden)

## [2.8.0] — 2026-08-10

### Hinzugefügt

- **Beast-Werbung entsteht jetzt in einem zweiten, kleinen Aufruf — ohne Bild.** Beim Testen am Live-System fiel auf: Der Beast-Text sagt „du hast die 30 überschritten und kämpfst gegen die Zeit", darunter steht wieder Fahrradzubehör, nur von anderen Herstellern. Ursache ist nicht der Prompt, sondern das Bild: Es liegt dem Modell vor Augen und überstrahlt jede Textanweisung. **Fünf A/B-Varianten im gemeinsamen Aufruf sind daran gescheitert** (siehe „Untersucht und verworfen" unten). Der zweite Aufruf bekommt nur den fertigen Beast-Text mit der benannten Schwachstelle — dort existiert die Ablenkung nicht. **Gemessen: Produktwelt-Überlappung zwischen den Modi 41 % → 11 %, Marken-Wiederverwendung 0.** Beim Rad-Foto (44 J.) kommen jetzt Hyaluron-Kapseln, Lebensversicherung, Coaching, Parship und N26-Kreditkarte statt weiterer Fahrradteile. Fällt der Aufruf aus, bleibt die Liste aus dem Hauptaufruf stehen — eine Analyse scheitert nie daran. (`mistral.js` `generateBeastAds`, `locales/{de,en}/prompts.js` `beastAdsPrompt`, `handle-process-job.js`)
- **Manipulations-Trigger sind ebenfalls getrennt.** Sie stehen im Frontend direkt neben der Werbung (`public/js/render.js:208-210`) — beim Umschalten wechselte bisher die Werbung, die Trigger daneben blieben identisch. Standard bleibt sachlich-aufklärend, Beast beschreibt dieselben Hebel aus Täterperspektive. Bei erkennbar Minderjährigen richtet sich der Zynismus ausdrücklich gegen das System, nicht gegen das Kind. **Gemessen über vier Runden: Wort-Ähnlichkeit zwischen den Modi 100 % → 6,5-14,8 %, ohne jede Nebenwirkung auf Alter, Geschlecht oder Kartenqualität.**
- **Serverseitiges Netz gegen unzulässige Werbeinhalte** (`minor-safety.js`, +20 Tests). Bewusst zweistufig aufgebaut:
  - **Immer entfernt, unabhängig vom geschätzten Alter:** Pornografie, Sexarbeit, Waffen, Munition, Extremismus. Grund: Die Altersschätzung ist unzuverlässig — im Testset wurde eine 14-Jährige für 28 gehalten, dort hätte ein altersabhängiger Filter nicht gegriffen. In einem Werkzeug fürs Klassenzimmer haben diese Inhalte ohnehin nichts verloren.
  - **Nur bei erkennbar Minderjährigen:** Glücksspiel, Kredit, Alkohol, Tabak, Schönheitskorrektur, Diätmittel. Bei Erwachsenen bleiben sie stehen — wie diese Branchen Menschen adressieren, IST der Lerninhalt.
  - **Nicht gefiltert wird die didaktisch gewollte Systemsicht.** „Dating-Apps zielen auf dich" verlangt der Prompt bei Minderjährigen ausdrücklich (Werbedruck zeigen statt persönliche Defizite zuschreiben). Ein eigener Test sichert das ab.
  - Anlass war ein Befund aus dem Modellvergleich: `mistral-medium-latest` schlug zwei 14-Jährigen „OnlyFans Merch Drops" und „Bet365 Live-Wetten Abo" vor — mit dem unveränderten Live-Prompt, der genau das verbietet. Sicherheit darf nicht allein davon abhängen, dass ein Modell sich an eine Textanweisung hält.

### Untersucht und verworfen

- **Fünf Prompt-Varianten für die Verletzlichkeits-Kopplung im gemeinsamen Aufruf**, je 84 Analysen:

  | Variante                  | Alters-Trefferquote | Trigger getrennt | Beast-Mechanik | Marken-Überlappung |
  | ------------------------- | ------------------- | ---------------- | -------------- | ------------------ |
  | Live v2.7.0               | Basis               | nein (100 %)     | ~33 %          | ~6,5 %             |
  | Werbung + Trigger         | −11,9 Pp            | ja (6,5 %)       | 54,1 %         | 40,1 %             |
  | dieselbe, gestrafft       | −11,9 Pp            | ja (6,7 %)       | 48,6 %         | 25,2 %             |
  | nur Trigger               | ±0                  | ja (9,1 %)       | 17,6 %         | 15,8 %             |
  | Trigger + Feldreihenfolge | ±0                  | ja (14,8 %)      | 21,3 %         | 11,2 %             |
  | nur Werbung               | ±0                  | nein             | 53,4 %         | 12,5 %             |

  Drei Befunde: (1) Die **Mindestquote hebelt die Marken-Trennung aus** — auf „mindestens 4 Einträge mit Mechanik" antwortet das Modell mit derselben Marke plus „Abo" („Decathlon Riverside 500 Abo", obwohl Decathlon schon im Standard steht). (2) **Zielkonflikt zwischen Werbung und Triggern:** Trennt man nur die Trigger, halbiert sich die Mechanik in der Werbung — das Modell erfüllt die Ausbeutungslogik dann in den Trigger-Texten. (3) Der scheinbare **Alterseinbruch war ein Messartefakt**: Die Trefferquote ist binär (±2 Jahre bei Minderjährigen), die tatsächliche Abweichung blieb mit ±8,3 Jahren unverändert. Die Feldreihenfolge im Schema (`ad_targeting` stand vor `categories`, das Modell konnte sich also gar nicht auf die Verletzlichkeit beziehen) war ebenfalls nicht der Hebel. **Lehre: Jede zusätzliche Pflichtregel im Prompt wird woanders bezahlt.**

- **Prompt um 14 % kürzen** (Werbung und Trigger komplett raus): verändert weder Grundfakten noch Textqualität. Altersabweichung ±8,3 → ±8,2 Jahre, Geschlecht 64 % → 64 %. **Alter und Geschlecht sind keine Prompt-Frage** — über sechs Messungen konstant, unbeeindruckt von jeder Änderung.
- **Modellwechsel auf Medium 3.5** (vollständiger Lauf, identischer Prompt): 4,6-fache Kosten (19,85 € statt 4,35 € je 1.000 im Workshop), Altersabweichung nur ±7,5 statt ±8,1 Jahre, Geschlecht 66,7 statt 64,3 % — und zwei Kinderschutz-Verstöße, wo Large in 42 Analysen sauber blieb. Textqualität war besser (Hedge-Wörter 2,4 statt 7,1 %), rechtfertigt den Aufpreis aber nicht.
- **Zweiter Aufruf auf `mistral-small-2603`:** liefert Werbesprüche statt Marken („Luxus-Vitamine", „Dein Like-Count ist dein Spiegel") und ignoriert die Anzahlvorgabe (18 statt 6-8 Einträge).

### Hinweise

- **Kosten praktisch unverändert:** Der Hauptaufruf wird kleiner, weil die Werbung dort wegfällt (gemessen 1.522 Eingabe- und 339 Ausgabe-Tokens weniger). Das gleicht den zweiten Aufruf fast aus — **4,44 € statt 4,35 € je 1.000 Analysen** im Workshop-Betrieb.
- **Wartezeit:** Der zweite Aufruf verdoppelt die Anfragen je Analyse. Bei `mistral-large-2512` gilt ein Limit von **15 Anfragen pro Minute** (am 2026-08-10 an der API gemessen; die frühere Notiz „6 Anfragen pro Sekunde" ist überholt). Die Warteschlange erzeugt bei Parallelität 10 und 56 Sekunden je Analyse rund 11 Anfragen pro Minute — mit dem zweiten Aufruf wären es 22. **Die Parallelität muss deshalb von 10 auf 7 gesenkt werden** (`scripts/cloudtasks-concurrency-7.sh`), sonst gibt es 429-Fehler. Folge: eine Klasse mit 25 Schülern ist nach ~3,9 statt ~2,2 Minuten (live nachgemessen im Audit 2026-08-10) durch.
- Kostenformel an der echten Mistral-Abrechnung geeicht (Abweichung < 3 %). Preise Stand 08/2026: Large 0,50/1,50 $, Medium 1,50/7,50 $ je Million Tokens; gecachte Eingabe-Tokens 10 %.

## [2.7.0] — 2026-08-09

### Geändert

- **Beast Mode zeigt jetzt eigene Werbung.** Bisher landete EINE Werbeliste in beiden Modi (`mistral.js`, `ad_targeting: ads`) — der Beast-Text war zynisch und ausbeutend, die Werbung darunter dieselbe brave Liste wie im Standard. Das entwertete genau den Moment, auf den das Tool didaktisch hinarbeitet. Jetzt liefert das Modell **zwei getrennte Listen**: Standard zeigt, was zum sichtbaren Lebensstil passt, Beast zeigt, was die im Beast-Profil benannte Schwachstelle ausbeutet (Abo-Fallen, Ratenzahlung, Statusprodukte über Budget, bei Kindern Sammelzwang- und Quengel-Mechaniken). **Gemessen an 84 Analysen: Marken-Überlappung zwischen den Modi 100 % → 2,8 %, Produkt-Überlappung 100 % → 0,0 %.** Beispiel (14-jähriges Mädchen): Standard „Puma × Stranger Things, Converse Run Star Hike, Spotify Premium Student" — Beast „Zalando Lounge Abo, ASOS Premier Membership, Boohoo Trend-Abo, Wish Mystery Beauty Box". (`locales/de/prompts.js`, `locales/en/prompts.js`, `mistral.js`)
- **Die immer gleichen Marken sind weg.** Ursache war kein Zufall, sondern der Prompt selbst: Er nannte neun Beispielmarken an vier Stellen, inklusive einer fertig ausgefüllten Liste im JSON-Schema. Mistral folgt Beispielen, nicht Regeln — bei einem Radsport-Foto kamen **alle acht** Marken aus der Beispielliste zurück (Garmin Edge 1040, Rapha, Specialized, Komoot, Wahoo, Red Bull, Ortlieb). Die Beispiele sind jetzt **ersatzlos entfernt** (nur noch Format-Platzhalter wie `‹Marke› ‹Modelllinie›`). **Gemessen: Anteil Werbe-Einträge aus den Prompt-Beispielen 7,5 % → 0,9 %, verschiedene Marken über alle Fotos 95 → 270, Top-3-Konzentration 11,9 % → 6,2 %.** Dasselbe Foto liefert jetzt Evoc, Schwalbe, Tubolito, Lezyne, Deuter, Vaude, Endura, Crankbrothers.
  - **Warum das diesmal funktioniert:** Der Vielfalt-Umbau vom 29.05. (v2.3.0-Kandidat) hatte Beispielmarken durch _andere_ Beispielmarken ersetzt und war durchgefallen — „nintendo switch" wurde einfach zum neuen Anker. Der Unterschied jetzt: gar kein Beispiel mehr zum Abschreiben, plus eine rotierende Sperrliste.
- **Rotierende Marken-Sperre** (`BRAND_BLOCKLIST_SETS`, 6 Sets). Sie sitzt bewusst **hinter dem Bild in der user-Message** — dort war nie Cache, die Rotation kostet damit **keinen einzigen Prompt-Cache-Treffer**. Läge sie im `system`-Teil, wechselte der statische Anfang pro Analyse und die Trefferquote fiele auf 0 (die v2.5-Messung ist im Code dokumentiert). Ein Test prüft genau das: gleicher `system`-Inhalt über verschiedene Sperrlisten hinweg. Sichtbare Marken im Foto schlagen die Sperre ausdrücklich. Gemessen: 0 Sperrlisten-Verstöße in 42 Läufen.

### Behoben

- **Größenbegrenzungen greifen wieder im aktiven Pfad.** `applyBounds` prüfte nur die oberste Ebene — im Single-Large-Pfad (live seit v2.2.0) liefen damit **Kartentexte, Profiltexte und Sicherheitswerte aus `standard`/`beast` ungeprüft durch**: 5.000 Zeichen blieben 5.000, ein `confidence: 5` blieb 5. `SECURITY.md` sagt diese Begrenzung aber ausdrücklich zu. Gefunden beim Umbau, weil `ad_targeting` sonst seine letzte Begrenzung verloren hätte. Jetzt wird jede vorhandene Profil-Ebene begrenzt; der 3-Call-Pfad bleibt unverändert. Ohne Feld-Erfindung: Was das Modell nicht geliefert hat, wird nicht angelegt. (+7 Tests, `json-repair.js`)
- Die Grenzwerte sind jetzt mit ihrem Realbezug dokumentiert (längster gemessener Wert je Feld, Faktor zum Grenzwert), damit sie niemand ohne Messung verengt. Sie sind Notbremsen, keine Formatvorgabe — ein mitten im Wort abgeschnittener Kartentext sieht im Workshop schlechter aus als ein etwas zu langer.

### Hinweise

- **Mehrverbrauch:** Eingabe +8,8 %, Ausgabe +7,1 % pro Analyse. Die Eingabe ist zwischenspeicherbar, die Ausgabe nicht — überschlägig **rund 1 bis 1,50 € mehr pro 1.000 Analysen**. Keine abgeschnittenen Antworten in 42 Läufen, `MAX_TOKENS` bleibt bei 8000.
- **Qualität gehalten:** Konkretheit der Marken 97,6 % → 100 %, Geschlechtstreffer unverändert 64,3 %, Alterstreffer 35,7 % → 33,3 % (ein Treffer von 42 = Rauschen). 0 Parse-Fehler, 0 Transport-Fehler.
- **Was die Messung NICHT belegt:** Ob sich bei vielen _ähnlichen_ Fotos (echte Schulklasse) weniger wiederholt. Die 14 Testbilder sind maximal verschieden; dort liegt die Marken-Überlappung zwischen Fotos bei beiden Varianten unter 6 %. Genau diese Einschränkung war schon die Lehre aus dem Test vom 29.05. Belegt ist das Ende des Abschreibens aus dem Prompt und die dreifache Markenvielfalt.
- **Der 3-Call-Fallback-Pfad** (`useSingleLargeCall = false`) liefert weiterhin eine gemeinsame Werbeliste für beide Modi. Er ist Rückfall, nicht aktiver Pfad — bewusst nicht mitgeändert.

## [2.6.0] — 2026-08-09

### Hinzugefügt

- **Sticky-Umschalter zwischen „Seriöse Analyse" und „Beast Mode".** Sobald ein Ergebnis vorliegt, bleibt der Umschalter beim Scrollen oben stehen. Grund ist didaktisch, nicht bequemlichkeitshalber: Der Vergleich derselben Karte in beiden Modi ist der Kern des Tools, bisher musste man dafür hoch, umschalten, wieder runter und die Karte neu suchen. Umgesetzt als **Positionswechsel des bestehenden Schalters** (`position: sticky`), bewusst NICHT als zweite Leiste — ein Duplikat hätte einen zweiten Tab-Stopp erzeugt (der Tastatur-E2E-Test ist CI-Pflicht) und die `position: fixed`-Tooltips ein zweites Mal ausrichten müssen. Auf der Startseite klebt nichts: gesteuert über `html[data-has-result]`, das `renderCurrentMode` nur bei vollständigem Ergebnis setzt. (`public/js/sticky-toggle.js` neu, `public/styles.css`, `public/app.js`, `public/js/render.js`, `public/js/api.js`)
- **Leseposition bleibt beim Moduswechsel erhalten** (`renderKeepingScrollAnchor`). Beast-Texte sind deutlich länger als die sachlichen; ohne Ausgleich rutscht die gerade gelesene Karte um **rund 250 Pixel** weg — gemessen, und per Mutationstest abgesichert (ohne den Anker wird der E2E-Test rot). Die oberste sichtbare Karte wird über ihren `data-key` gemerkt und nach dem Neuaufbau wieder auf dieselbe Bildschirmhöhe geholt. Zwei Fallen, die dabei aufgetreten sind und im Code kommentiert stehen: (1) Während des `innerHTML`-Neuaufbaus ist die Seite kurzzeitig kürzer, der Browser klemmt die Scrollposition ans neue Seitenende — deshalb wird die Höhe von `#resultsPanel` für die Dauer des Renderns festgehalten. (2) Die Korrektur setzt eine **absolute** Zielposition (`scrollTo`) statt eines Deltas (`scrollBy`), weil sich die Scrollposition zwischen Messung und Korrektur selbst verändern kann.
- **Tastatur-Navigation berücksichtigt die geklebte Leiste** (`scroll-padding-top`) — ohne den Abstand springt der Fokus beim Durchtabben der Ergebniskarten hinter die Leiste.
- **Tests:** 9 neue Unit-Tests (`public/__tests__/sticky-toggle.test.js`) für Scroll-Anker und Geklebt-Zustand, 4 neue E2E-Tests (`e2e/sticky-toggle.test.js`) für echtes Layout, echtes Scrollen und `position: sticky` in beiden Modi. Frontend gesamt 174 grün, E2E 9 grün inklusive axe und Tastatur-Smoketest.
- **Messwerkzeug für den Werbe-Umbau** (`functions/scripts/single-large-ab-runner-v3-ads.js`, additiv, TEST-ONLY, kein Produktionscode). Vergleicht Live-Prompt gegen einen Kandidaten mit getrennten Werbelisten je Modus. Misst Marken- und Produkt-Überlappung zwischen Standard und Beast, Anker-Rate (Marken aus den Prompt-Beispielen), Cross-Image-Markenvielfalt, Konkretheit, Ground-Truth-Treffer für Alter/Geschlecht sowie abgeschnittene Antworten. Fährt beide Varianten mit `system`/`user`-Split wie der Live-Cache-Pfad, damit die Messung cache-treu ist.

### Im Druck

- Die geklebte Leiste wird im PDF-Export auf `position: static` zurückgesetzt — sonst wandert sie auf jede Seite.

### Bekannt / offen

- **Werbe-Auftrennung Standard ↔ Beast ist gemessen, aber noch nicht übernommen.** Erste A/B-Messung (14 Bilder × 3 Läufe × 2 Varianten, 84 Calls, 2,99 €) zeigt: Anker-Rate 8,6 % → 0,7 %, verschiedene Marken 88 → 216, Produkt-Überlappung 100 % → 3,1 %, Konkretheit unverändert (99,0 % → 99,8 %), keine abgeschnittenen Antworten. Offen sind zwei Punkte: die **Marken**-Überlappung liegt noch bei 37,9 % (Ziel unter 30 %, Standard und Beast nennen oft dieselbe Marke mit anderem Produkt), und bei einem Kinderfoto kippten die Vorschläge von Spielzeug auf reine Bekleidungsketten. Prompt wird nachgeschärft und erneut gemessen, bevor etwas an den Produktivcode geht.

## [2.5.2] — 2026-08-08

### Behoben

- **`npm audit` wieder 0/0 in beiden Projekten** (Stand seit v2.4.2, war durch neue Advisories gekippt). Im Root fehlte noch dieselbe `brace-expansion`-Lücke wie in `functions/` — ebenfalls reine Entwicklungskette (`eslint → minimatch`), Root hat gar keine Produktiv-Abhängigkeiten. Behoben mit `overrides.brace-expansion: ^5.0.9` in der Wurzel (dort bisher keine overrides; **Rückbau-Bedingung identisch:** entfällt, sobald `eslint`/`minimatch` von sich aus ≥ 5.0.9 ziehen). Frontend-Tests 165 grün. (`package.json`, `package-lock.json`)
- **Letzter offener Dependabot-Alert geschlossen:** `js-yaml` 3.15.0 → 3.15.1 (GHSA quadratic CPU consumption in `!!omap`, high). Kommt über die Testkette `jest → @jest/transform → babel-plugin-istanbul → @istanbuljs/load-nyc-config` und ist damit **development-scope** — das Audit-Gate war deshalb bereits grün, der GitHub-Alert aber offen. **Ohne neuen override gelöst** (`npm update js-yaml` reichte, die 3.x-Linie hat den Fix in 3.15.1) — es bleibt bei 6 overrides. Lockfile-Falle geprüft: `npm ci --dry-run` Root und `functions/` je exit 0, `@emnapi/*` unverändert. Tests 463 grün. (`functions/package-lock.json`)

## [2.5.1] — 2026-08-08

### Behoben

- **Audit-Gate wieder grün** (`main` war nach dem v2.5.0-Push rot). Ursache war kein Fehler in v2.5.0, sondern ein neu veröffentlichtes Advisory: `brace-expansion` < 5.0.9 (GHSA-rgw5-rvv9-x895, high, DoS). Das Paket kommt rein über die Entwicklungskette `eslint → minimatch → brace-expansion` und läuft **nie** in Produktion — `npm audit --omit=dev` filtert transitive Dev-Abhängigkeiten aber nicht zuverlässig heraus, deshalb schlug das Gate an. Behoben mit `overrides.brace-expansion: ^5.0.9` (der zulässige Bereich von `minimatch@10.2.5` ist `^5.0.5`, `npm update` hob es nur nicht von selbst). Keine Allowlist-Ausnahme, weil eine reparierte Version existiert. **Rückbau-Bedingung:** entfällt, sobald `eslint`/`minimatch` von sich aus ≥ 5.0.9 ziehen — damit jetzt 6 overrides in `functions/package.json`. Lockfile-Falle geprüft: `npm ci --dry-run` in Root und `functions/` je exit 0, optionale Einträge (`@emnapi/*`) unverändert. (`functions/package.json`, `functions/package-lock.json`)

## [2.5.0] — 2026-08-08

Kostensenkung im Live-Pfad: Prompt-Caching bei Mistral, gemessen statt geschätzt.

### Hinzugefügt

- **Prompt-Caching bei Mistral, hinter dem Flag `usePromptCache` (Standard: aus).** Der statische Anweisungstext macht ~9.500 der ~11.200 Eingabe-Tokens jeder Analyse aus und wurde bisher bei jedem Upload voll bezahlt. Mit gesetztem `prompt_cache_key` berechnet Mistral ihn wieder und kostet dafür nur 10 % des Eingabepreises. **Gemessen unter Produktionsmuster** (20 Anfragen, Parallelität 10, ohne Pause, wechselnde Bilder): **76,4 % aller Eingabe-Tokens aus dem Cache**, Median pro Anfrage 99,8 %, 16 von 20 Anfragen mit klarem Treffer. Das entspricht ~8,10 € → ~4,80 € pro 1000 Analysen. (`functions/src/mistral.js`, `functions/src/feature-flags.js`, `functions/src/handle-process-job.js`)
  - **Der Nachrichten-Aufbau musste dafür umgestellt werden — das ist der eigentliche Kern der Änderung.** An der echten API gemessen, mit wechselnden Bildern:

    | Aufbau                                | Cache-Treffer |
    | ------------------------------------- | ------------- |
    | `user[ text, bild ]` (Stand bis v2.4) | **0 %**       |
    | `system(text)` + `user[ bild ]`       | **82–100 %**  |
    | `user[ text ]` + `user[ bild ]`       | **0 %**       |

    Mistral cacht einen multimodalen `content`-Array offenbar nur als Ganzes; da das Bild pro Anfrage wechselt, fällt der komplette Präfix aus dem Cache. Blosses Auftrennen genügt nicht — der Rollenwechsel nach `system` ist die Bedingung. Der Parameter allein hätte **nichts** gebracht.

  - **Qualitätsgegenprobe vor der Umstellung:** drei Demo-Fotos, volle Analysen, beide Aufbauten. Identische `hard_facts` (22/28/22 Jahre, gleiche Spannen und Geschlechter), 0 fehlende Karten in beiden Modi, vergleichbare Ausgabelänge. Die Umstellung verändert die Profile nicht.
  - **Trefferquote ist anbieterseitig nicht garantiert** („erhöht die Chance, garantiert sie nicht", Mistral-Doku). Einzelaufrufe mit Pause treffen unzuverlässig (0–9 %); erst Dauerlast hält den Cache warm. Für den Workshop-Betrieb ist das der Normalfall, für vereinzelte Uploads nicht. Ein Fehlschlag kostet exakt den bisherigen Preis — die Maßnahme kann nicht teurer werden als der Ist-Zustand.
  - **Erfolgskontrolle im Protokoll:** `cachedTokens` steht jetzt in jeder `mistral-single-large`-Zeile. Nach dem ersten Workshop lässt sich die reale Ersparnis damit belegen statt schätzen.
  - **Rückfall bitgenau:** Bei ausgeschaltetem Flag wird weder ein Cache-Key gesendet noch der Aufbau geändert — der Pfad ist identisch mit v2.4.4. Umlegen ohne Deploy über `featureFlags/current` (~30 s Cache).
  - Tests: +12 (Backend **463**), darunter der Nachweis, dass der Wiederholungsversuch den Hinweis **unten** anhängt und die `system`-Message bitgleich lässt — sonst bräche der Cache dort unbemerkt weg.

## [2.4.4] — 2026-07-29

Schließt die drei offenen Punkte aus v2.4.3 — statt sie als Notiz stehen zu lassen.

### Behoben

- **Der in README zugesagte multipart-Weg auf `POST /analyze` funktioniert wieder.** Er war in der Produktion faktisch tot: Die Cloud-Functions-Laufzeit liest den Request-Body vorab vollständig aus und legt ihn als `req.rawBody` ab — der Stream ist danach leer, und das bisherige `req.pipe(busboy)` scheiterte zuverlässig mit `Unexpected end of form` (`bad_multipart`). Betroffen war jeder Fremd-Client, der die dokumentierte Schnittstelle nutzt (Self-Hosting, eigene Integrationen); das eigene Frontend nie, weil es ausschließlich JSON mit `imageBase64` schickt. `parseMultipart` füttert busboy jetzt direkt mit `rawBody`, wenn vorhanden — der `pipe`-Zweig bleibt für Umgebungen ohne `rawBody` (blankes Express, Selbst-Hosting hinter eigenem Server). **Nicht gelöscht, sondern repariert:** die Schnittstelle ist öffentlich zugesagt (`README.md`, MIT-Lizenz, Self-Hosting-Anleitung). (`functions/src/upload.js`)

### Hinzugefügt

- **Dauerhafte Web-Schicht-Tests** (`functions/src/__tests__/upload-http.test.js`, +12 Tests, Backend jetzt 451). Sie starten einen echten HTTP-Server mit echtem Express und fahren den echten Projekt-Parser dagegen — in **beiden** Betriebsarten: `pipe` (blankes Express) und `rawBody` (Firebase-Produktion nachgebildet). Abgedeckt: Multipart vollständig und byte-genau, 600-KB-Datei über mehrere Chunks, falscher Content-Type, fehlendes Bild, JSON-Body, `req.query`-Typen.
  - **Warum das nötig war:** Alle übrigen Backend-Tests ersetzen `onRequest` durch eine Attrappe und überspringen die Express-Schicht komplett. Beim Sprung Express 4 → 5 konnte deshalb **kein einziger** der 439 Tests eine Regression dort bemerken; die Prüfung lief über einen Wegwerf-Prüfstand.
  - **Gegenprobe gemacht:** Ohne die `rawBody`-Reparatur fallen genau 3 der 12 neuen Tests durch — der Test misst also wirklich etwas.

### Geändert

- **Auto-Merge schließt Backend-Produktivpakete aus.** Neu zusätzlich zur patch/minor-Regel: PRs in `/functions` mit `dependency-type: direct:production` laufen **nicht** mehr automatisch durch. Anlass ist der Vorfall aus v2.4.3 — Sammel-PR #58 war als `minor` etikettiert (`firebase-functions` 7.2.5 → 7.3.2), transportierte darin aber Express 4 → 5. Die update-type-Prüfung sieht nur das Etikett des äußeren Pakets, nicht den Lockfile darunter. Backend-**Werkzeuge** (eslint, prettier, jest) laufen weiterhin ohne Zutun durch; dafür trennt `dependabot.yml` die Bündel jetzt in `backend-werkzeuge` und `backend-produktiv`. (`.github/workflows/dependabot-automerge.yml`, `.github/dependabot.yml`)

### Aufgeräumt

- Vier veraltete lokale Zweige entfernt (PRs #50–#53, alle per Squash gemergt), Remote-Referenzen bereinigt.

## [2.4.3] — 2026-07-29

Erster Abhängigkeits-Schwung, den die mit v2.4.2 reparierte Automatik selbst erzeugt hat — gebündelt statt einzeln, und einer davon vollständig ohne Zutun durchgelaufen. Der Backend-Anteil enthält einen Major-Sprung im Innenleben (Express 4 → 5), der bewusst geprüft statt automatisch durchgewunken wurde.

### Geändert

- **Backend (PR #58):** `firebase-functions` 7.2.5 → 7.3.2, `firebase-admin` 14.1.0 → 14.2.0, `@google-cloud/tasks` 6.2.3 → 6.3.0, `eslint` 10.7.0 → 10.8.0, `prettier` 3.9.5 → 3.9.6.
  - **Transitiv darin: Express 4.22.2 → 5.2.1** samt `body-parser` 2.x und `path-to-regexp` 8.x. Der Sammel-PR war als `minor` eingestuft — die Auto-Merge-Regel hätte ihn durchgewunken. **Auto-Merge wurde deshalb bewusst deaktiviert und der PR von Hand geprüft.** Befunde:
    - **Live in der Produktion verifiziert (8/8) auf dem tatsächlichen Nutzerpfad:** JSON-Body mit `imageBase64` kommt an, Bild wird dekodiert, MIME-Prüfung greift; Honeypot 403; kaputtes JSON 400; `req.query` in `job-status` 404/400; Betriebswerte unverändert (Limit 500, Queue an). Kostenfrei geprüft — jeder Durchlauf endet vor dem KI-Aufruf.
    - **Multipart-Pfad (`req.pipe(busboy)` in `upload.js`) unter Express 5: 10/10 identisch zu Express 4** — gemessen mit einem echten HTTP-Server gegen den echten Projekt-Parser, inklusive 900-KB-Datei über mehrere Chunks (byte-genau vollständig), Textfelder, MIME-Erkennung und beiden Fehlerpfaden (`unsupported_content_type`, `missing_image`).
    - **Query-Parser** (Express 5 wechselt von `extended` auf `simple`): identische Ausgabe, auch bei Mehrfach-Parametern. Die drei Lesestellen (`handle-job-status.js` 2×, `handle-admin.js` 1×) sind unberührt.
    - **`path-to-regexp` 0.1 → 8** (die riskanteste Express-5-Änderung): **kein Risiko** — der Code definiert keine eigenen Express-Routen, ausschließlich `onRequest`-Handler.
    - **`firebase-functions` 7.3.2 im HTTPS-Provider**: nur CORS-Auflösung als Helfer ausgelagert und Trigger-Typ-Weitergabe — nichts am Body- oder Stream-Handling.
    - **Neue `timeoutSeconds`-Validierung aus 7.3.0** (HTTPS ≤ 3600 s, Ereignis ≤ 540 s): alle 9 Funktionen validiert, kein Verstoß.
- **Frontend-Werkzeuge (PR #59):** `@playwright/test` 1.61.1 → 1.62.0, `eslint` 10.6.0 → 10.8.0, `prettier` 3.9.4 → 3.9.6.
  - **Bewährungsprobe für die v2.4.2-Automatik bestanden:** Der CI-Job `playwright-version` hat den Container-Tag selbstständig auf `v1.62.0-jammy` nachgezogen, `test-e2e` lief grün. Unter der alten Doppelpflege hätte genau dieser PR zwangsläufig scheitern müssen.
- **Test-Werkzeug (PR #60):** `jsdom` 29.1.1 → 30.0.1. Einziger Breaking Change ist die angehobene Node-Mindestversion (`^22.22.2 || ^24.15.0 || >=26`) — Projekt läuft auf Node 24.
- **CI (PR #57):** `actions/setup-node` 6.4.0 → 7.0.0 (SHA-gepinnt). Breaking Changes sind der ESM-Umbau und der Wegfall eines npm-Publish-Tokens, den dieses Repo nicht nutzt; die CI dieses PRs lief bereits mit v7 vollständig grün.
- **PR #56** (`actions/checkout` 7.0.0 → 7.0.1, gebündelt) ist **ohne jeden Handgriff auto-gemergt** — der erste Durchlauf der reparierten Kette.

### Erkenntnisse

- **Ein `minor`-Update eines Wrapper-Pakets kann einen `major`-Sprung seines Innenlebens transportieren.** Die Auto-Merge-Regel (patch + minor) sieht nur das Etikett. Bei Sammel-PRs, die Backend-Produktivpakete anfassen, lohnt ein Blick in den Lockfile-Diff, bevor man sie laufen lässt.
- **Der Multipart-Pfad ist tot — das Frontend nutzt ihn nirgends.** `public/js/api.js` schickt an `/api/enqueue` ausschließlich **JSON mit `imageBase64`** (`Content-Type: application/json`); im gesamten Frontend kommt weder `FormData` noch `multipart` vor. `parseMultipart` in `upload.js` wird zwar von `handle-enqueue.js` und `handle-analyze.js` weiterhin angeboten, aber von keinem echten Client angesprochen. → offener Punkt: entweder abräumen oder bewusst als Fremd-Client-Schnittstelle dokumentieren.
- **`bad_multipart` in der Produktion ist KEINE Störung, sondern der Normalzustand dieses toten Pfads.** Multipart scheitert dort mit `Unexpected end of form`, weil der Functions-Runtime den Request-Body vorab ausliest und `req.pipe(busboy)` nur einen abgeschnittenen Strom bekommt — **auf v2.4.1 mit Express 4 exakt genauso wie auf v2.4.3 mit Express 5** (durch Rollback-Gegenprobe belegt). Der Functions-Emulator verhält sich identisch; der Durchklick aus `docs/QUEUE-EMULATOR.md` ist für den Upload also ohnehin nicht aussagekräftig.
  - **Teure Lektion:** Ein Live-Smoke, der den Multipart-Pfad prüft, misst etwas, das nie ein Nutzer benutzt — und sieht dabei aus wie ein kaputter Upload. Ein Funktionsrollback wurde deshalb kurzzeitig unnötig ausgelöst (ohne Nutzerauswirkung, der alte Stand lief ebenso). **Regel für künftige Smokes: zuerst im Frontend nachsehen, welchen Pfad der echte Client nimmt, und genau den messen.**
- **Die Backend-Unit-Tests decken die Express-Schicht nicht ab** — sie ersetzen `onRequest` durch eine Attrappe und treffen die Handler direkt. Die 439 grünen Tests sagen über Multipart-Streaming, Query-Parsing und Body-Handling nichts aus. Für diese Schicht gibt es derzeit **keinen dauerhaften Test**; die Prüfung oben lief über einen eigens gebauten Prüfstand. → offener Punkt.

## [2.4.2] — 2026-07-29

Zwei blockierte Pflicht-Checks gelöst und die Dependabot-Automatik entschärft. Ausgangspunkt war die Beobachtung, dass laufend Dependabot-Mails eintrudeln: Ursache war nicht Dependabot selbst, sondern zwei dauerhaft rote CI-Tore, an denen jeder Update-PR hängenblieb — die Auto-Merge-Automatik funktionierte, kam aber nie zum Zug.

### Behoben

- **Barrierefreiheits-Regression aus v2.4.1 (macht auch die CI wieder grün).** Der Datenschutz-Link im Upload-Hinweis war seit v2.4.1 nur noch an seiner Farbe zu erkennen (`text-decoration: none`), hat gegen die `--muted`-Farbe des umgebenden Absatzes aber nur **1,19:1** Kontrast — axe meldet das als ernsten Verstoß `link-in-text-block` (WCAG 1.4.1 „Use of Color"). Der Pflicht-Check `test-e2e` war dadurch seit dem v2.4.1-Deploy dauerhaft rot und blockierte jeden Pull Request. Der Link ist jetzt permanent unterstrichen (`text-underline-offset: 2px`, Hover verdickt die Linie); das CI-Petrol bleibt unverändert. E2E wieder 5/5 grün. (`public/styles.css`, Cache-Buster 2026072901)
- **Alle bekannten Sicherheitsmeldungen restlos geschlossen — `npm audit` meldet in beiden Projekten 0, inklusive Entwicklungswerkzeuge.** Vorher: 27 Meldungen (functions produktiv 5, functions mit dev 21, Root 1), die sich aber allesamt auf **zwei** echte Lücken zurückführen ließen.
  - **`fast-xml-parser` 5.10.0 → 5.10.1** (Alert vom 2026-07-24, „high": wiederholte DOCTYPE-Deklarationen setzen die Grenze für Entity-Expansion zurück). Transitiv über `firebase-admin` → `@google-cloud/storage`. Zieht `@nodable/entities` 2.2.0 → 3.0.0 mit, weil 5.10.1 das verlangt.
  - **`brace-expansion` → 5.0.8** (`GHSA-mh99-v99m-4gvg`, „high": Speicherfresser-DoS über sehr große Klammer-Muster). Die Lücke erschien über drei getrennte Stränge. Ein direktes `overrides`-Erzwingen von 5.0.8 ist **nachgemessen unmöglich** — dessen CommonJS-Export ist ein Objekt statt einer Funktion, `minimatch` und `glob` brechen damit zur Laufzeit (`glob FAIL: (0, brace_expansion_1.default) is not a function`). Ein Rückport auf die Linien 1.x/2.x existiert nicht (`<= 5.0.7` ist verwundbar, repariert erst 5.0.8). Gelöst wurde deshalb über die **Nutzer** der alten Linien:
    - `google-gax` → `rimraf` auf `^6.0.1` übersteuert (5.0.10 → 6.1.3; zieht `glob` 11 → `minimatch` 10 → `brace-expansion` 5 nach). **Rückbau, sobald `google-gax` selbst auf `rimraf` ≥ 6 geht** (`npm view google-gax dependencies.rimraf`).
    - `glob` auf `^11.1.0` übersteuert (10.5.0 → 11.1.0) — beseitigt die `minimatch@9`-Instanzen in mehreren `jest`-Unterpaketen auf einen Schlag statt einzeln. **Rückbau, sobald `jest` selbst `glob` ≥ 11 anfordert** (`npm ls glob --prefix functions`).
    - `test-exclude` auf `^7.0.1` übersteuert (6.0.0 → 7.0.2, dev) — 6.x hing an `minimatch@3` → `brace-expansion@1`. **Rückbau, sobald `babel-plugin-istanbul` in der installierten `jest`-Version `test-exclude` ≥ 7 anfordert.**
    - Die verbleibende Instanz unter `eslint` (`minimatch@10.2.5` → `brace-expansion@5.0.7`) brauchte keine Übersteuerung — 5.0.8 liegt in deren erlaubtem Bereich.
  - **Produktiv-Oberfläche bewusst unangetastet:** `firebase-functions` (7.2.5), `firebase-admin` (14.1.0), `express` (4.22.2), `google-gax` (5.0.7) und die `@google-cloud/*`-Pakete bleiben exakt auf dem Live-Stand. Ein vollständiger Lockfile-Neuaufbau hätte nebenbei `firebase-functions` 7.3.2 und damit **Express 4 → 5** in den Produktiv-Backend gezogen — eine Verhaltensänderung, die in einen bewusst freigegebenen eigenen Schritt gehört und nicht als Nebenwirkung hier hinein. Stattdessen minimal-invasiv: `npm install` gegen das bestehende Lockfile (ändert nur, was die Übersteuerungen erzwingen) plus gezielte Handkorrektur der drei Versionseinträge.
  - **macOS-Lockfile-Falle erneut bestätigt und diesmal sauber umschifft:** `npm audit fix`, `npm update --package-lock-only` _und_ `npm install` schneiden auf macOS die optionalen Einträge `@emnapi/core`, `@emnapi/runtime` und `@pkgjs/parseargs` aus dem Lockfile — die Linux-CI bricht daraufhin mit `npm ci`-EUSAGE ab (genau so geschehen im ersten Anlauf dieses Zweigs). Die Einträge wurden nach dem Eingriff gezielt zurückgeschrieben. **Verlässliche Vorabprüfung ist `npm ci --dry-run`** — reproduziert den CI-Fehler lokal; eine Textsuche nach „linux" im Lockfile tut das nicht (die betroffenen Pakete tragen kein „linux" im Namen). (`package.json`, `functions/package.json`, beide Lockfiles)

### Geändert

- **Audit-Gate mit begründeter, ablaufender Ausnahmeliste** (`scripts/audit-gate.mjs` + `.github/audit-allowlist.json`) ersetzt das nackte `npm audit --omit=dev --audit-level=high` im CI-Job `test-backend`. Grund: Das alte Gate war ein Alles-oder-nichts-Schalter — erschien irgendwo tief in einer fremden Abhängigkeitskette ein High-Advisory ohne verfügbare Reparatur, blockierte es **jeden** PR. Genau daran sind am 2026-07-01 alle acht Dependabot-PRs gescheitert (#30–#37, alle an `test-backend`), die deshalb von Hand weggeräumt werden mussten. Neu: High/Critical blockieren weiterhin, eine Ausnahme braucht Begründung **und** Ablaufdatum, danach fällt das Gate von selbst wieder auf rot; ein neues Advisory ist nie automatisch ausgenommen. Das Gate fasst außerdem Ketten korrekt zusammen (6 npm-Meldungen = 1 echte Lücke). Verhalten in allen vier Fällen gemessen: ungedeckt → rot, abgelaufen → rot, gedeckt → grün, verwaist → Hinweis.
  - **Die Ausnahmeliste ist leer und soll es bleiben.** Sie ist das Ventil für den Fall, dass eine Fremd-Lücke wirklich weder reparierbar noch übersteuerbar ist — nicht der bequeme Weg. Der aktuelle Fall (`brace-expansion`) wurde bewusst _gelöst_ statt eingetragen.
- **Playwright-Container-Tag kommt jetzt aus dem Lockfile** (neuer CI-Job `playwright-version`, `test-e2e` hängt daran). Vorher stand die Version an zwei Stellen (`package.json` und Image-Tag in `ci.yml`) und musste von Hand synchron gehalten werden — jedes Dependabot-Playwright-Update musste dadurch zwangsläufig scheitern. Von Hand zu pflegen bleibt nur noch der Basis-Name `-jammy`. Ergibt heute unverändert `v1.61.1-jammy`. (`.github/workflows/ci.yml`)
- **Dependabot bündelt Updates je Bereich zu einem PR** statt einen pro Paket (`applies-to: version-updates`, nur `minor` + `patch`). Am 2026-07-01 waren es acht einzelne PRs — gebündelt wären es drei gewesen, die mit dem bestehenden Auto-Merge ohne Zutun durchlaufen. Major-Updates bleiben bewusst einzeln, weil sie ohnehin eine manuelle Freigabe brauchen und in einem Sammel-PR untergehen würden. (`.github/dependabot.yml`)
- **Dependabot Security-Updates aktiviert** (Repo-Einstellung, war aus). Bisher meldete Dependabot eine Lücke nur per Mail, ohne einen Reparatur-PR zu öffnen — Nörgeln statt Reparieren, jede Lücke musste von Hand gehoben werden. Security-PRs sind zusätzlich je Bereich gebündelt.

### Dokumentation

- RUNBOOK: neues Störungs-Rezept „Audit-Gate rot / Dependabot-PRs bleiben liegen" (was tun bei reparierbar, bei upstream-unrepariert, bei abgelaufener Ausnahme).
- VERIFICATION: Audit-Zeile auf das neue Gate umgestellt; Security-Updates-Status ergänzt. SECURITY-MODEL, README und ADR-0001 (Playwright-Kopplung) nachgezogen.

## [2.4.1] — 2026-07-17

Visueller Feinschliff: Der Datenschutz-Link im neuen Upload-Hinweis (2.4.0) erschien im Browser-Standardblau statt in der Markenfarbe.

### Behoben

- **Datenschutz-Link im Upload-Hinweis in CI-Petrol** (`var(--teal-text)`) statt Browser-Blau — konsistent mit den übrigen Inline-Links (Rechtstexte, Footer). Umgesetzt über den Kontext-Selektor `.disclaimer__workshop a` (`public/styles.css`); HTML und Sprachdateien unverändert. Cache-Buster 2026071703.

## [2.4.0] — 2026-07-17

Umfassende Sanierung nach dem LANGAUDIT vom 2026-07-17 (Release-Gate-Audit auf v2.3.4, Multi-Agent, read-only): drei Robustheits-Lücken im Queue-Pfad geschlossen, Diagnose-Daten weiter anonymisiert, eine latente Secret-Falle entschärft, die CI gehärtet und die gesamte Doku auf den tatsächlichen Live-Stand gebracht. Keine Verhaltensänderung im Normalpfad — der Live-Betrieb (u. a. das globale Stundenlimit von 500/h) lief durchgehend stabil weiter.

### Behoben

- **Stundenlimit konsistent auf 500/h verankert.** Der durchgesetzte Wert kommt aus Firestore `stats/current.limit` (= 500, rollendes 60-Minuten-Fenster); die Code-Konstante `HOURLY_LIMIT` (Fallback + Reset-Wert) wurde auf **500** angeglichen (`functions/src/config.js`), damit ein Admin-„Reset" das Limit nicht ungewollt verändert. In ARCHITECTURE zusätzlich die Einlass-Politik geschärft: 500/h liegt knapp unter dem Verarbeitungs-Durchsatz (~550/h), sodass sich gar kein Rückstau bilden kann (ARCH-001 entschärft).
- **Reaper/Worker-Race:** Reaper und Worker löschten das zwischengespeicherte Bild auch dann, wenn ihr `abandonJob`-Übergang das Race verloren hatte (Job inzwischen von einem Worker geclaimt) — der laufende Job fand sein Bild nicht mehr und endete als `blocked.apiError`. Aufräumen (Bild + Stunden-Slot) passiert jetzt nur noch nach **erfolgreichem** Statusübergang (`handle-reap.js`, `handle-process-job.js`; je ein neuer Race-Test).
- **Stunden-Slot-Leck im Enqueue-Fehlerpfad:** Scheiterte `storeImage`/`createJob` NACH dem Ziehen des Stunden-Slots, blieb der Slot bis zu 60 min belegt und ein ggf. schon abgelegtes Bild bis zur 1-Tag-Lifecycle-Regel liegen. Jetzt wird analog zum bestehenden `enqueueJob`-Fehlerpfad aufgeräumt (Slot zurück + Bild weg, neuer Fehlercode `store_failed`; zwei neue Tests).
- **Queue-Fetches ohne Timeout:** `enqueue`- und Poll-Fetch konnten bei nie settelnden Verbindungen (Mobilfunk-Blackhole) den Wartefluss einfrieren — der Sync-Pfad hatte längst einen Timeout. Jetzt `fetchWithTimeout` (Enqueue 90 s, Poll 30 s; Client gibt nie vor dem Server auf, Timeouts laufen in die bestehende 5-Fehler-Toleranz).

### Geändert

- **Diagnose-Daten weiter vergröbert (Privacy):** Die Fehler-/Telemetrie-Logger senden statt des vollen User-Agent-Strings nur noch die grobe Form „Browser Hauptversion / OS" (`coarseUserAgent()`), statt der exakten Bildschirmauflösung nur noch eine Größenklasse (small/medium/large). Serverseitig `userAgent`-Längenlimit 250 → 80 als zweites Netz. Damit deckt der Code die Zusage „vollständig anonym, Geräteklasse" aus der Datenschutzerklärung wieder wortgenau.
- **Job-Abholung fail-closed:** Der tote Abwärtskompatibilitäts-Zweig „Alt-Jobs ohne Abhol-Ticket bleiben offen" ist entfernt — jeder Job trägt seit v2.2.3 (PRIV-003) ein Ticket (`createJob` setzt es unkonditional); fehlt es wider Erwarten, wird nie ausgeliefert.

### Sicherheit / CI

- **`functions/.env.local` enttrackt** (war seit v2.0.0-rc3 im öffentlichen Repo, enthielt nie Secrets — nur Emulator-Flags) + `.gitignore` deckt jetzt `.env.local`; getrackte Vorlage neu als `functions/.env.local.example`.
- **ci.yml:** `permissions: contents: read` festgeschrieben (Repo-Default war bereits read); Lighthouse-Job läuft nur noch auf `push` — er misst die Live-Domain, auf PRs war ein grünes Ergebnis irreführend.

### Dokumentation

- **Zahlen-Drift korrigiert** (LANGAUDIT DOC-001): IP-Rate-Limit überall 500/10 min (Code seit v1.10.6; RUNBOOK, ARCHITECTURE, SECURITY-MODEL, AGENTS.md, Nutzungsbedingungen), Stundenlimit überall 500/h (README, SELF-HOSTING, Nutzungsbedingungen — konsistent zum Live-Wert, siehe „Behoben"), Job-Aufbewahrung ~2 h statt 24 h (SECURITY.md), Testzahlen 439/165/5, Emulator-Port 5050; Kostentabellen in SETUP/SELF-HOSTING als 3-Call-**Fallback** gerahmt (aktiv: Single-Large).
- **Architektur-Kommentare und -Tabellen auf den Live-Stand Queue + Single-Large** (DOC-002): „dormant"/„heutige 3-Call-Architektur"-Formulierungen ersetzt (`feature-flags.js`, `index.js`, `config.js`, `handle-reap.js`, `scripts/cloudtasks-concurrency-3.sh`), Komponententabellen um `handle-errors.js`/`handle-telemetry.js`/`heartbeat.js` bzw. `error-logger.js`/`telemetry-logger.js`/`client-context.js` ergänzt, CSP-Beschreibung um `api.malzi.me`; AGENTS.md auf Poppins/Design-System/en.json aktualisiert.
- **Datenschutz-Hinweis am Upload-Bereich + PRIV-002-Korrektur** (DOC-003): neue Hinweiszeile unter der Dropzone (i18n-Key `upload.privacyHint`, DE + EN) — Foto wird nach der Analyse sofort gelöscht, Link auf die Datenschutzerklärung; SECURITY-MODEL beschreibt PRIV-002 jetzt korrekt als Nach-Analyse-Warnung. Datenschutzerklärung präzisiert die Diagnose-Datenfelder (grobe Browser-/OS-Klasse, Bildschirm-Größenklasse, Netzwerk-Klasse) passend zum vergröberten Logging.
- **deploy.sh auf Konvention + Test-Guard** (OPS-002): Cache-Buster im Format `?v=YYYYMMDDNN` (gleicher Tag → Nummer +1) statt sekundengenauem Zeitstempel, `nutzungsbedingungen.html` in der HTML-Liste, Lint + Unit-Tests laufen vor der Deploy-Bestätigung (`SKIP_TESTS=1` als dokumentierte Notfall-Ausnahme mit Warnung).
- **Marken-Hinweis in SELF-HOSTING** (OSS-002) und **Demo-Foto-Herkunft dokumentiert** (OSS-001): eigene Instanzen müssen die Brand-Assets ersetzen (MIT gilt für Code, nicht für Logo/Marke); neue `public/img/demo/LICENSE.md` — die drei Demo-Fotos sind KI-generiert, zeigen keine realen Personen, EXIF bewusst fiktiv; „Stock-Fotos"-Formulierungen entsprechend ersetzt (README, ARCHITECTURE, sichtbare Seiten).
- **Einlass-Politik der Queue als bewusste Entscheidung dokumentiert** (ARCH-001, ARCHITECTURE.md) und **ERROR-ALERTING auf den erweiterten Live-Filter** aktualisiert (OPS-001: alle sieben Functions, `errors`/`telemetry` bewusst ausgespart); VERIFICATION.md auf CI-Run 29562535095 (2026-07-17) + Queue-Emulator-Lasttest (100/100 done) aufgefrischt.

### Betrieb (außerhalb des Repos, 2026-07-17)

- **Fehler-Alarm-Policy erweitert** (LANGAUDIT OPS-001): Filter deckt jetzt auch `enqueue`, `processjob`, `jobstatus`, `reapjobs` ab — der Live-Analysepfad war seit der Queue-Umstellung (v2.0) ohne ntfy-Alarm. `errors`/`telemetry` bewusst ausgespart (Client-Fehlerberichte loggen als ERROR → wären Alarm-Spam). Backfill-Release v2.2.1 nachgetragen; gitleaks-Voll-Historien-Scan lokal: 0 Funde.
- **ntfy-Alarm-Topic rotiert:** Der Benachrichtigungs-Kanal lag auf einem kurzen, erratbaren Namen (nur Geheimhaltung schützt ein ntfy-Topic). Neuer langer Zufalls-Kanal als Secret-Version gesetzt, Functions ziehen ihn seit dem Deploy; Zustellung auf dem eigenen Gerät verifiziert.

## [2.3.4] — 2026-07-16

Auffindbarkeit für Suchmaschinen und KI-Systeme: malziME wird maschinenlesbar mit malziland und Christoph Krieger verknüpft — an der sichtbaren Seite ändert sich nichts. Bewusst KEIN Link auf malziland.at (Seite im Relaunch, Stand 2026-07-16). Nur-Hosting-Deploy, keine Funktionsänderung.

### Hinzugefügt

- **`llms.txt`:** maschinenlesbare Kurzbeschreibung für KI-Crawler — was malziME ist, wer dahinter steht (malziland - learning | training | consulting e.U., Inhaber Christoph Krieger), Datenschutz-Kernpunkte, Seitenübersicht, Zitierhinweis mit Fiktiv-Klarstellung. (`public/llms.txt`)
- **Strukturierte Betreiber-Daten im Impressum:** schema.org-Organization mit Anschrift, UID, Gründer Christoph Krieger (inkl. LinkedIn-Verweis) und GitHub-Profil. (`public/impressum.html`)
- **Urheber in den strukturierten Daten der Startseite:** Christoph Krieger als `creator` und als Gründer der Betreiber-Organisation, Verweis aufs GitHub-Repository (`sameAs`); Autor-Meta-Tag nennt jetzt Person + Firma. (`public/index.html`)
- **Alternativtexte fürs Teilen-Vorschaubild** (`og:image:alt`, `twitter:image:alt`). (`public/index.html`)

### Geändert

- **Impressum-Seitentitel korrigiert:** nannte bisher eine nicht existierende Kurz-Firmierung — jetzt „Impressum — malziME by malziland". Die Firma heißt überall vollständig „malziland - learning | training | consulting e.U." (Schreibweise laut Impressum). (`public/impressum.html`)
- **Sitemap-Änderungsdaten aktualisiert** (standen seit Februar unverändert). (`public/sitemap.xml`)
- **README-Attribution:** am Seitenende um Christoph Krieger (LinkedIn) und den Live-Link malzi.me ergänzt. (`README.md`)

## [2.3.3] — 2026-07-14

Restlose Barrierefreiheit im geprüften Nutzerfluss: die letzten drei (moderaten) axe-Hinweise behoben und der Tastatur-Durchlauf als dauerhafter Test verankert — der Wächter meldet jetzt **null Funde über alle Schweregrade**. Nur-Hosting-Deploy. 165 Frontend- + 435 Backend-Tests, 5 E2E, Lint und Format grün.

### Geändert

- **Landmarken vervollständigt:** GitHub-Hinweis und Unterstützungs-Box lagen zwischen `</main>` und `<footer>` außerhalb jeder Landmarke — für die Screenreader-Schnellnavigation unsichtbar. Beide sitzen jetzt in einem `<aside>`; optisch unverändert. (`public/index.html`)
- **Überschriften-Reihenfolge im Ergebnis:** Die Verdict-Überschrift war ein `h3` direkt nach dem `h1` (übersprungene Ebene) — jetzt `h2`, mit explizit fixiertem Abstand pixelgleich zum bisherigen Aussehen. (`public/js/render.js`, `public/styles.css`)

### Hinzugefügt

- **Tastatur-Smoketest als dauerhafter E2E-Test** (`e2e/keyboard.test.js`, CI-Pflicht-Check): kompletter Weg Demo-Foto → Disclaimer → Profil nur mit Tab + Enter, inklusive Prüfung, dass die Fokus-Markierung sichtbar ist. Damit ist der letzte offene Punkt der Verifikationsmatrix geschlossen — statt eines einmaligen manuellen Durchklicks wird die Tastatur-Bedienbarkeit jetzt bei jedem PR bewiesen. (`e2e/keyboard.test.js`, `docs/VERIFICATION.md`)

## [2.3.2] — 2026-07-14

Barrierefreiheits-Feinschliff nach dem ersten Lauf des neuen axe-Wächters plus Governance-Nachrüstung (Phasen 1–3: Betriebs-Doku, Verifikationsmatrix, A11y-Gate, Sammel-Scripts). Nur-Hosting-Deploy — Functions unberührt. 165 Frontend- + 435 Backend-Tests, 4 E2E (A11y-Gate ohne Ausnahmen), Lint und Format grün.

### Geändert

- **Barrierefreiheit: Nebentexte auf „Warmgrau-Textstufe" `#6e675e`** (Field Decision im malziland Design System, 2026-07-14). Das Marken-Warmgrau `#82796e` verfehlte als Textfarbe die WCAG-Norm 4,5:1 auf allen hellen Flächen knapp (4,0:1 auf Papier / 4,3:1 auf Weiß / 3,6:1 im Hinweis-Kasten des Foto-Dialogs) — 22 Stellen, gefunden vom neuen A11y-Gate. Die Textstufe behält den identischen Farbton (33°/8 %) und ist nur so dunkel wie nötig (jetzt 5,2 / 5,6 / 4,7). Linien, Rahmen, Flächen und der Gruppenakzent behalten den Vollton; gilt auch für die Druck-Stile. Analog zu den bestehenden Dark-Theme-Textstufen (`#4698b9`/`#c17d67`) — die CI-Lücke betraf alle malziland-Dokumente, nicht nur malziME. (`public/styles.css`)
- **Barrierefreiheit, zwei Kleinigkeiten:** Die Konfidenz-Punkte neben den Profil-Kategorien tragen jetzt `role="img"` — damit ist das vorhandene `aria-label` für Screenreader technisch gültig (vorher wurde es ignoriert). Der OpenStreetMap-Quellenhinweis unter der GPS-Karte ist als Link unterstrichen (war nur an der Farbe erkennbar). (`public/js/render.js`, `public/styles.css`)
- **A11y-Gate voll scharf:** Der Wächter misst jetzt mit reduzierter Bewegung — vorher erwischte axe Elemente mitten in der Einblend-Animation, was ~60 Schein-Funde mit Kontrast ~1:1 erzeugte. Die Bestands-Ausnahmeliste aus dem ersten Wurf ist komplett entfernt: Jeder ernste Verstoß (serious/critical) bricht ab sofort die CI. (`e2e/a11y.test.js`)
- **Doku-Drift korrigiert:** AGENTS.md nannte das Stundenlimit noch mit 500 (Code: 1500) und ließ `release.yml` unerwähnt; `docs/ARCHITECTURE.md` nannte das Limit ebenfalls mit 500 und die Liveness-Karenz mit 3 min (Code: 8 min seit v2.2.3/UX-001). (`AGENTS.md`, `docs/ARCHITECTURE.md`)

### Hinzugefügt

- **Betriebs- und Governance-Doku:** `docs/RUNBOOK.md` (Deploy-Ablauf, alle fünf Rollback-Hebel vom Wartungsmodus bis zum Hosting-Rollback, Störungs-Rezepte inkl. Scanner-Rauschen und `error.readFailed`, Log-Aufbewahrung), `docs/FLAGS.md` (Feature-Flag-Register mit Entfernungs-Kriterien und der 3-Schritt-Warnung für `useSingleLargeCall`), `docs/SECURITY-MODEL.md` (Schutzgüter, Rollen, Vertrauensgrenzen, Missbrauchsfälle mit Gegenmaßnahmen, Aufbewahrungs-Tabelle, Privacy-Notiz) und `docs/adr/0001-grundentscheidungen.md` (nachträglich dokumentierte Grundentscheidungen inkl. bewusster Abweichungen: keine Pre-commit-Hooks, Deutsch statt Englisch, leichtgewichtige Tags). README verlinkt das Runbook.
- **Toolchain-Kleindateien:** `.nvmrc` (Node 24, gleicht Editor/Terminal an `functions/engines` und CI an), `.editorconfig`, `.gitattributes` (LF-Zeilenenden, Binärdatei-Markierung).
- **Barrierefreiheits-Gate im E2E** (Phase 3): neuer Playwright-Test `e2e/a11y.test.js` prüft Startseite + fertige Profil-Ansicht mit axe-core (`@axe-core/playwright`, dev-only). Jeder **neue** ernste Verstoß (serious/critical) bricht ab jetzt die CI. Die drei beim ersten Lauf gefundenen Bestands-Punkte des Designs wurden noch im selben Release behoben (siehe „Barrierefreiheit" unter Geändert). (`e2e/a11y.test.js`, `package.json`)
- **Sammel-Befehle im Root** (Phase 3): `npm run setup` / `npm test` / `npm run lint` / `npm run format:check` decken jetzt Frontend + Backend in einem Aufruf ab (reine Aliasse auf die bestehenden Einzel-Scripts). (`package.json`, `AGENTS.md`)
- **Verifikationsmatrix `docs/VERIFICATION.md`** (Phase 2): Welche Anforderung ist wodurch belegt — Tests, Secret-Scan, Dependency-Audit, Lighthouse, Profilpflichten (inkl. zweier ehrlich als offen ausgewiesener Punkte: automatisierter A11y-Check, dokumentierter Tastatur-Smoketest) und externe Kontrollen. Dazu die **erste dokumentierte Rollback-Probe**: Tag `v2.3.1` in temporärem worktree ausgecheckt, `npm ci` + beide Test-Suiten grün (435 + 165) — der Rücksprung auf den letzten Release-Stand ist damit nachgewiesen, nicht nur beschrieben. (`docs/VERIFICATION.md`, `docs/RUNBOOK.md`)

## [2.3.1] — 2026-07-13

Nachzügler zum Redesign: die Markenflächen außerhalb der Seiten (Icons, Teilen-Bild, README-Screenshots) plus ein Sicherheitsupdate im Backend. Hosting- + Functions-Deploy. 165 Frontend- + 435 Backend-Tests, E2E, Lint und Format grün.

### Geändert

- **Alle Marken-Bildflächen auf das malziland-Design gebracht.** Neues Favicon-Set als m-Medaillon nach Farbleitfaden (weißes m auf Teal-Kreis: `favicon.svg`, `favicon.ico`, 192/512-px-Icons; Apple-Touch-Icon als Teal-Kachel), neues Teilen-Vorschaubild `og-image.png` (1200×630, Papier-Look mit Wasserzeichen und m-Medaillon — das sehen Empfänger in WhatsApp/Signal/Teams), PWA-Manifest-Farben auf Teal/Warmweiß, neue `theme-color`-Meta auf allen Seiten (mobile Browser-Farbleiste folgt jetzt auch dem Beast-Modus). README-Screenshots erneuert: Desktop hell + Mobil im Beast-Dunkel. (`public/favicon*`, `public/apple-touch-icon.png`, `public/og-image.png`, `public/site.webmanifest`, alle HTML-Seiten, `public/app.js`, `docs/screenshots/`)

### Sicherheit

- **`uuid` 9.0.1 → 11.1.1 im Backend** (Dependabot-Meldung „medium": fehlende Puffer-Grenzenprüfung in v3/v5/v6 bei übergebenem `buf`). uuid kommt transitiv über `firebase-admin` → `@google-cloud/storage`, deren Versionsbereiche noch auf 9.x zeigen — daher per `overrides`-Eintrag in `functions/package.json` angehoben (gleiches Muster wie der bestehende firebase-admin-Override; zurückbauen, sobald die Google-Pakete uuid ≥ 11 selbst anfordern). Lockfile sauber neu aufgebaut, `npm audit`: 0 Meldungen, alle 435 Backend-Tests grün. (`functions/package.json`, `functions/package-lock.json`)

## [2.3.0] — 2026-07-13

Komplettes Redesign auf das malziland Design System (Corporate-Identity-Farbleitfaden 2026): heller Papier-Look mit Beast-Mode-Dunkel-Kopplung, Unterseiten im Dokument-Stil, Poppins statt Inter/JetBrains Mono, Marken-Lizenz-Ausnahme im Repo. Über Firebase-Preview-Channel am Gerät getestet und freigegeben. Reiner Hosting-Deploy — Backend/Functions unberührt. 165 Frontend- + 435 Backend-Tests, E2E, Lint und Format grün.

### Geändert

- **Neues Erscheinungsbild nach dem malziland Design System — heller Papier-Look statt dunkler „AI-Stalker"-Ästhetik.** Grundfläche Warmweiß `#f9f7f4` mit weißen Karten (Warmgrau-Haarlinie, weiche Schatten, 10-px-Radius), Markenfarben nach Leitfaden-Rollen: Teal `#156480` als konstante Stimme (Überschriften-Labels, Buttons, Links, Trennlinien), Rost `#9c4e36` als Signal (Verdict, Manipulation, GPS-Warnung, Limit-Banner, Wartungs-Dialog), Gold-Gelb `#bfb542` ausschließlich für Zahlen/Zähler/Marker. Die vier Kategorie-Gruppen tragen die vier Markenfarben (Wer-du-bist=Teal, Was-dich-ausmacht=Warmgrau, Was-du-kaufst=Gold, Verwundbar=Rost). Schrift: selbst gehostete **Poppins** (OFL; offizieller Ersatz der Hausschrift Como lt. Design-System) ersetzt Inter + JetBrains Mono; Mono-Labels wurden zu versalen Eyebrow-Labels des Design-Systems. Statt der Scan-Linien liegt das m-Monogramm als dezentes Wasserzeichen auf der Seite (Leitfaden Kap. 07: max. 1×/Fläche, 4–6 % hell / 7–9 % dunkel). Endlos-Animationen (Puls-Punkt, Toggle-Wackeln, Disclaimer-Pulsieren, Modal-Glühen) entfernt — die Scan-Animation während der Analyse bleibt als funktionaler Fortschritt. (`public/styles.css`, `public/index.html`)
- **Beast-Mode-Theme-Kopplung: Seriöse Analyse = Hell, Beast Mode = Dunkel.** Der Modus-Schalter kippt jetzt zugleich das Erscheinungsbild — das dunkle Theme folgt exakt Leitfaden Kap. 11 (Flächen/Balken/Buttons behalten die echten Markenfarben; farbiger Text nur in den definierten helleren Stufen `#4698b9`/`#c17d67`; Überschriften bleiben hell). Es gibt bewusst keinen separaten Hell/Dunkel-Schalter und keine Speicherung: Beast startet immer ausgeschaltet (Datenschutz + Pädagogik). Druck/PDF-Export bleibt unabhängig vom Modus immer im hellen Marken-Look; das Wasserzeichen erscheint nie im Druck (Leitfaden-Regel). (`public/app.js`, `public/styles.css`)
- **Unterseiten (Impressum, Datenschutz, Nutzungsbedingungen, Stats) im Dokument-Look.** Briefpapier-Kopf (klickbare Wortmarke „malziME" als Heimweg + Teal-Verlaufslinie), jeder Abschnitt als Karte, Gold-Nummern für nummerierte Abschnitte und Schrittlisten, Teal-Aufzählungspunkte, „Startseite" als erster Footer-Eintrag. Der „Zurück zur Startseite"-Link entfällt: Die Startseite öffnet die Unterseiten jetzt in einem neuen Tab, damit laufende Analysen (Schalterstellung, Ergebnis) unangetastet bleiben. Unterseiten sind bewusst immer hell — Dunkel bleibt exklusiv die Beast-Bühne der Analyse-Seite. Neuer i18n-Key `stats.eyebrow` (DE `Statistik` / EN `Statistics`); der vorhandene Key `footer.startseite` wird jetzt genutzt, `stats.backLink` ist stillgelegt. (`public/impressum.html`, `public/datenschutz.html`, `public/nutzungsbedingungen.html`, `public/stats.html`, `public/locales/de.json`, `public/locales/en.json`)
- **Barrierefreiheit: Gold-Zahlen als Plaketten statt Gold-Text.** Gold-Gelb als kleiner Text auf Weiß hätte nur ~1,9:1 Kontrast (WCAG-Durchfaller, relevant für Beamer/Sehschwächen). Alle Gold-Zahlen (Ø-Werte, Datenwert-Beträge, Abschnittsnummern, Countdown) sitzen deshalb auf einer Gold-Fläche (40 %) mit Anthrazit-Schrift; im dunklen Theme Gold-Text auf Gold-Tint (dort kontraststark). Bewegungs-Reduktion (`prefers-reduced-motion`) bleibt vollständig respektiert. (`public/styles.css`)

- **Datenschutzerklärung präzisiert (Nachtrag am selben Tag, Version bleibt 2.3.0):** Die Aussage „kein sessionStorage" stimmte seit dem Abhol-Ticket aus v2.2.6 nicht mehr wörtlich. Neu wird das anonyme Abhol-Ticket ehrlich erklärt (Zufallsnummer im Tab, überlebt ein versehentliches Neuladen, keine persönlichen Daten, löscht sich beim Schließen des Tabs); Stand-Datum aktualisiert. Zusätzlich liegt die Markenzeichen-Ausnahme jetzt als eigene, zweisprachige `TRADEMARKS.md` im Stammverzeichnis (Profi-Standard wie bei Rust/Docker/Mozilla) — die LICENSE bleibt rein MIT, damit GitHub und Lizenz-Scanner sie automatisch erkennen. (`public/datenschutz.html`, `TRADEMARKS.md`, `README.md`)

### Hinzugefügt

- **Marken-Ordner `public/img/brand/` mit Lizenz-Ausnahme.** Das m-Monogramm (petrol + weiß) liegt im Repo, ist aber ausdrücklich **nicht** MIT-lizenziert — Klarstellung in `public/img/brand/LICENSE.md` (DE/EN, alle Rechte vorbehalten) und im README-Lizenzabschnitt. Begründung: Verstecken schützt nicht (die Live-Seite ist öffentlich), die Lizenz schützt; ein Weglassen aus dem Repo hätte zudem CI-Tests gebrochen und Repo ≠ Live gemacht. (`public/img/brand/`, `README.md`)
- **Schriftlizenz dokumentiert:** SIL-OFL-1.1-Text für Poppins (`public/fonts/poppins/OFL.txt`).

### Entfernt

- **Inter + JetBrains Mono** (`public/fonts/inter/`, `public/fonts/jetbrains-mono/`) — nach dem Umbau ungenutzt; über die git-Historie jederzeit wiederherstellbar. README-Angaben zu Schriften und Design entsprechend aktualisiert.

## [2.2.8] — 2026-07-06

Reaktion auf den Workshop-Vorfall vom selben Vormittag: Foto-Einlesen abgehärtet, irreführende Fehlermeldung ersetzt, Fehler-Diagnose erweitert und anonyme Diagnose-Logs 30 Tage aufbewahrt (bisher war jede Häufigkeits-Analyse nach 1 Tag blind). Hosting- + Functions-Deploy. 165 Frontend- + 435 Backend-Tests grün.

### Behoben

- **„Dieses Bild konnte nicht geöffnet werden" auf einzelnen Android-Handys — Foto-Einlesen grundlegend robuster gemacht (Workshop-Vorfall 2026-07-06).** Manche Geräte übergeben der Webseite eine Foto-Referenz, deren Inhalt der Browser gar nicht lesen kann (z.&nbsp;B. nach Speicherdruck, bei Cloud-only-Fotos oder defekter Galerie-App) — dann scheiterte bisher erst der Bild-Decoder, und die Fehlermeldung riet fälschlich zu „JPEG oder PNG", was betroffenen Nutzern nicht helfen konnte (auch ein Screenshot scheiterte identisch). Drei Änderungen: (1)&nbsp;Das Foto wird jetzt sofort nach der Auswahl einmal komplett in den Speicher der Seite kopiert, mit automatischem zweitem Versuch — alle weiteren Schritte (EXIF, Verkleinern) arbeiten auf dieser Kopie, die nicht mehr kaputtgehen kann; ein Teil der Fälle (kurzzeitige Aussetzer des Geräts) wird damit ganz verhindert. (2)&nbsp;Kann das Gerät die Datei endgültig nicht liefern, kommt eine ehrliche, eigene Fehlermeldung mit Tipps, die wirklich helfen (Browser neu starten, Speicherplatz prüfen, Foto lokal speichern, anderes Gerät) statt des irreführenden Format-Hinweises — zweisprachig DE/EN. (3)&nbsp;Die anonyme Fehler-Diagnose überträgt jetzt zusätzlich den genauen technischen Fehlergrund (`errorDetail`, z.&nbsp;B. `NotReadableError`) und die Dateigröße (`fileSizeKb`), damit künftige Fälle in den Logs eindeutig zuzuordnen sind — weiterhin ohne Dateinamen oder Bildinhalt. (`public/js/exif.js`, `public/js/api.js`, `public/js/error-logger.js`, `functions/src/handle-errors.js`, `public/locales/de.json`, `public/locales/en.json`)

### Geändert

- **Anonyme Diagnose-Daten werden jetzt 30 Tage aufbewahrt (bisher 1 Tag) — personenbezogene Infrastruktur-Logs weiterhin nur 1 Tag.** Hintergrund: Die gesamte Log-Aufbewahrung stand auf 1 Tag; damit war keinerlei Aussage möglich, wie oft ein Fehler über mehrere Workshops hinweg auftritt. Umsetzung datenschutzkonform über einen separaten Log-Speicher (`client-diagnostics`, EU-Region `europe-west1`, 30 Tage), in den ausschließlich die vollständig anonymen Client-Diagnose-Einträge (`client-error`/`client-telemetry` — Fehler-Typ, Geräteklasse, Dauer; keine IP-Adressen, keine Bilder, keine Dateinamen) gespiegelt werden. Der Standard-Log-Speicher mit Googles Infrastruktur-Fehlerlogs (enthalten IPs) bleibt unverändert bei 1 Tag — das Versprechen der Datenschutzerklärung gilt weiter. Die Datenschutzerklärung wurde um die 30-Tage-Aufbewahrung der anonymen Diagnose-Daten ergänzt (Stand-Datum aktualisiert). (Cloud-Logging-Konfiguration, `public/datenschutz.html`)

## [2.2.7] — 2026-07-05

Wartungs- und Sicherheits-Release: Backend-Grundbibliothek `firebase-admin` auf Version 14 (schließt alle 3 hohen bekannten Sicherheitslücken), gesammelte Werkzeug- und CI-Updates, Mistral-2506-Aufräumen. Reiner Functions-Deploy, keine Frontend-Änderung. 432 Backend- + 157 Frontend-Tests grün, E2E in der CI grün.

### Gewartet

- **Veraltetes Mistral-Modell `mistral-small-2506` aus Kommentaren und Forschungs-Skripten als „retired" markiert.** Mistral zieht das Modell zum 31.07.2026 endgültig zurück; der Live-Pfad nutzt es seit langem nicht mehr (aktiv: `mistral-large-2512` = Large 3 und `mistral-small-2603` = Small 4 — beides die aktuellen Modelle). Der historische Kommentarblock in `functions/src/config.js` wurde neu gefasst (er behauptete u.a. fälschlich, 2603 sei „derzeit nicht im Einsatz"); die Forschungs-Skripte `compare-pipelines.js`, `test-prompts-v2.js`, `rebuild-compare-html.js` und deren README tragen jetzt einen Retirement-Hinweis (Pipeline B dort ist ab 31.07. nicht mehr lauffähig, die Skripte bleiben als historische Referenz im Repo). Reine Kommentar-/Doku-Änderung, kein Laufzeit-Code berührt; 432 Backend-Tests grün.

- **Entwicklungs-Werkzeuge gesammelt aktualisiert** (nichts davon läuft im ausgelieferten Produkt): `@playwright/test` 1.59.1 → 1.61.1 (E2E-Container-Image in der CI im selben Schritt auf `v1.61.1-jammy` gezogen — Pflicht-Gleichlauf), `prettier` 3.8.3 → 3.9.4 (Root + functions; formatiert im Bestand nichts um, verifiziert), `vitest` + `@vitest/coverage-v8` 4.1.x → 4.1.9, `eslint` 10.4.1 → 10.6.0 (Root + functions, keine neuen Meldungen). GitHub-Actions-Pins gehoben: `actions/checkout` v6 → v7.0.0 (einziger Breaking Change betrifft nur Fork-PR-Checkouts in `pull_request_target`-Workflows — hier nicht genutzt), `dependabot/fetch-metadata` v2 → v3.1.0 (nur Node-24-Runtime; genutzter Output `update-type` unverändert), beide SHA-gepinnt und dreifach gegen die offiziellen Release-Tags verifiziert. Lockfile-Neuaufbau im Root zieht `undici` 7.28.0 und schließt damit alle 7 offenen undici-Advisories im Test-Werkzeug (`npm audit` Root: 0 Meldungen). Ersetzt die Dependabot-PRs #30, #31, #33–#37. (`package.json`, `functions/package.json`, `.github/workflows/*`)

### Sicherheit

- **Backend-Grundbibliothek `firebase-admin` von Version 13 auf 14 angehoben** (dazu `@google-cloud/tasks` 6.2.2 → 6.2.3, Fehlerkorrektur-Update). Damit sind alle 3 hohen und mehrere mittlere bekannte Sicherheitslücken geschlossen, die über veraltete Unterbibliotheken (`uuid`, `google-gax`, Firestore-Client 7) hereinkamen; der Firestore-Client springt auf Version 8. Übrig bleiben 7 mittlere Meldungen in Googles Storage-Unterbau, die erst Google selbst beheben kann (unterhalb der CI-Gate-Schwelle „hoch"). Der eigene Backend-Code brauchte **keine** Änderung — er nutzt seit jeher ausschließlich den modernen modularen Import-Stil, den Version 14 voraussetzt; alle 432 Backend-Tests grün. Technische Notiz: `firebase-functions` 7.2.5 erlaubt `firebase-admin` 14 formal noch nicht als Peer-Abhängigkeit — per `overrides`-Eintrag in `functions/package.json` aufgelöst (etabliertes npm-Muster; die tatsächliche Berührungsfläche der beiden Bibliotheken ist in diesem Projekt praktisch null). Nebenwirkung behoben: Das npm-audit-Sicherheits-Gate im CI (`test-backend`) war wegen dieser Lücken seit Ende Juni rot und blockierte jeden Pull Request — es ist jetzt wieder grün. (`functions/package.json`, `functions/package-lock.json`)

## [2.2.6] — 2026-06-07

Weiterer Feinschliff der Reload-Erfahrung (zwei Punkte aus dem Live-Test auf dem iPhone). Reiner Hosting-Release, keine Server-Änderung. 432 Backend- + 157 Frontend-Tests grün.

### Behoben

- **Der „Nichts davon ist wahr"-Hinweis erscheint beim Reload nicht erneut.** Hat man ihn beim ersten Ergebnis bereits bestätigt (weggeklickt), wird er beim Neuladen übersprungen — pro Job gemerkt, überlebt den Reload. Beim allerersten Anzeigen und bei jedem neuen Upload erscheint er wie gehabt. (`public/js/api.js`)

### Geändert (bewusste Datenschutz-Entscheidung)

- **Das hochgeladene Foto wird nach einem Reload bewusst NICHT wiederhergestellt — und das wird zum sichtbaren Datenschutz-Lerneffekt.** Das Foto wird unmittelbar nach der Analyse gelöscht und absichtlich nirgends — auch nicht im Browser — zwischengespeichert. An die Stelle, wo das Foto war, tritt nach dem Reload ein kurzer, positiver Hinweis: „Dein Foto ist schon gelöscht — gut für deine Privatsphäre." Zweisprachig (DE/EN), als Klasse `photo-deleted-note`. Das passt zur Bildungs-Mission des Tools: Datensparsamkeit sichtbar machen statt verstecken. (`public/js/api.js`, `public/styles.css`, `public/locales/de.json`, `public/locales/en.json`)

## [2.2.5] — 2026-06-07

Feinschliff der Reload-Wiederherstellung aus v2.2.4 (zwei UX-Reparaturen nach Live-Test auf dem iPhone). Reiner Hosting-Release, keine Server-Änderung. 432 Backend- + 155 Frontend-Tests grün.

### Behoben

- **Kein langer „Nachdenk"-Balken mehr beim Reload.** `resumeQueueJob` fragt den Job-Status jetzt sofort ab (ohne den 2-Sekunden-Vorlauf des regulären Poll-Takts) — ein bereits fertiges Ergebnis erscheint in ~0,3 s statt nach 2 s, die Scan-Animation blitzt nur noch kurz auf. (`public/js/api.js`)
- **Kein blauer „Auswahl"-Rahmen mehr um das Ergebnis.** Das Ergebnis-Panel bekommt aus Barrierefreiheits-Gründen nach dem Hinweis-Dialog programmatisch den Fokus; der sichtbare Standard-Fokusrahmen ums ganze Panel (sah wie eine versehentliche Auswahl aus) wird jetzt unterdrückt — die Screenreader-Fokusansage bleibt erhalten. (`public/styles.css`)

### Hinweis

- Das hochgeladene Foto erscheint nach einem Reload bewusst NICHT wieder: Es wird aus Datenschutzgründen sofort gelöscht und nirgends zwischengespeichert. Das Ergebnis-Profil (serverseitig bis 2 h, ticket-geschützt) kommt zurück, das Foto nicht; das leere Vorschau-Feld kollabiert sauber.

## [2.2.4] — 2026-06-07

Frontend-Reparatur (Reload-Wiederherstellung) plus Gleichlauf der Rechtstexte und der Doku mit dem aktuellen Stand (Single-Large-Pipeline, 2-h-Aufbewahrung aus v2.2.3). Reiner Hosting-/Doku-Release, keine Server-Änderung. 432 Backend- + 155 Frontend-Tests grün.

### Behoben

- **Queue-Ergebnis überlebt jetzt einen Seiten-Reload.** Bisher warf der Browser das Abhol-Ticket (PRIV-003) sofort nach dem Rendern weg — ein Reload konnte das (serverseitig noch bis zu 2 h vorhandene) Profil nicht mehr abholen, es war „weg". Jetzt bleibt das Ticket im Tab erhalten: Ein Reload holt das Ergebnis ticket-geschützt erneut ab. Aufgeräumt wird beim nächsten Upload, bei Fehler/Abbruch oder wenn der Job serverseitig abgelaufen ist; der Resume beim Seitenstart ist still (kein Fehler-Banner bei bereits gelöschtem Job). Zwei neue Frontend-Tests decken das ab. (`public/js/api.js`, `public/__tests__/queue.test.js`)

### Geändert

- **Datenschutz + Nutzungsbedingungen aktualisiert.** Aufbewahrung des Job-Dokuments „spätestens nach 24 Stunden" → „spätestens nach rund 2 Stunden" (Gleichlauf mit PRIV-004 aus v2.2.3 — stärkere Datensparsamkeit). Modell-Beschreibung von der alten 3-Call-Darstellung („Large 3 + Small 4") auf die aktive Single-Large-Pipeline umgestellt. Stand-Datum beider Rechtsseiten auf den 7. Juni 2026 gesetzt. (`public/datenschutz.html`, `public/nutzungsbedingungen.html`)

### Doku (DOC-Rest)

- **Single-Large-Architektur beschrieben** in `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md` (aktiver Single-Call vs. dokumentierter 3-Call-Fallback, umschaltbar über `featureFlags/current.useSingleLargeCall`).
- **Test-Zahlen aktualisiert** auf real 432 Backend / 155 Frontend; alle verbliebenen „24 h"-Aufbewahrungsangaben in der Doku auf 2 h korrigiert.

## [2.2.3] — 2026-06-07

Fünf kleinere Reparaturen aus dem Audit (alle P3) an der Queue-/Reliability-Schicht. Vorab gegen den Firestore-Emulator end-to-end getestet (Abhol-Ticket-Flow + voller Job-Lebenszyklus); 432 Backend- + 153 Frontend-Tests grün.

### Behoben / Geändert

- **PRIV-003 — Abhol-Ticket fürs Ergebnis.** `enqueue` erzeugt pro Auftrag ein zufälliges Ticket (UUID), gibt es an den Browser zurück und speichert es am Job; `job-status` liefert das fertige Profil nur noch an den Browser mit dem passenden Ticket (`safeCompare`). Zweites Schloss zusätzlich zur unerratbaren jobId — schützt die abgeleiteten Profile (oft Minderjähriger) gegen Zugriff über eine geleakte jobId. Alt-Jobs ohne Ticket bleiben abwärtskompatibel. (`handle-enqueue.js`, `jobs.js`, `handle-job-status.js`, `public/js/api.js`)
- **BUG-001 — saubere Job-Zustandsübergänge.** `completeJob`/`failJob`/`abandonJob` sind jetzt bedingte Firestore-Transaktionen (nur aus dem erwarteten Vorzustand) — ein nachlaufender Worker überschreibt keinen bereits gereapten Terminalzustand mehr. `PROCESSING_TIMEOUT_MS` 600s → 540s (= Cloud-Function-Timeout): hängende Aufträge brechen bis zu 60s früher sauber ab. (`jobs.js`)
- **PRIV-004 — kürzere Aufbewahrung.** Job-Dokumente (mit dem fertigen Profil) werden statt nach 24 h schon nach 2 h gelöscht. Datensparsamkeit; deckt jedes realistische Reload-Fenster großzügig ab. (`config.js`)
- **UX-001 — mehr Geduld bei weggelegtem Handy.** Karenz-Fenster für „verlassene" wartende Aufträge 3 → 8 Minuten. Schüler:innen verlieren ihren Auftrag nicht mehr, wenn sie das Handy in der Pause kurz weglegen. (`config.js`)
- **BIZ-001 — Kostenbremse zählt nur echte Analysen.** Der Stundenzähler wird beim Upload gezogen; abgebrochene Aufträge (abandoned / enqueue_failed) geben ihren Slot jetzt wieder frei (`counter.releaseHourlySlot`), damit „Phantom-Analysen" echte Nutzer nicht früher als nötig aussperren. (`counter.js`, `handle-reap.js`, `handle-process-job.js`, `handle-enqueue.js`)

### Validiert

- Emulator-Rundlauf (echte Firestore, Mock-KI): Upload → Ticket → done; Ergebnis nur mit korrektem Ticket, ohne/falsches Ticket gesperrt; voller Queue-Lebenszyklus mit den neuen Zustandsübergängen.

### Hinweis

- e2e-CI-Check repariert (Playwright-Install-Hänger + hartes Job-Timeout). Der veraltete Disclaimer-Smoke-Test ist als `test.fixme` markiert — er testet den abgelösten synchronen Pfad; Rewrite auf den Queue-Pfad bleibt offen.

## [2.2.2] — 2026-06-06

Ergebnis eines vollständigen Read-only-Audits (Sicherheit, Datenschutz, Zuverlässigkeit, Architektur, OSS, Lieferkette) mit Multi-Agent-Prüfung, adversarialer Gegenprüfung und Live-Verifikation gegen die echten Cloud-Dienste. **Keine ausnutzbare Sicherheitslücke (0× P0).** Die Codebasis ist solide; dieser Release bündelt eine funktionale Reparatur (PRIV-002, deployt) und mehrere Härtungen in Repository, CI/CD und Doku.

### Behoben

- **PRIV-002 — Datenschutz-Warnung + Tier-Easter-Egg im aktiven Single-Large-Pfad reaktiviert (deployt).** Der seit v2.2.0 live laufende Single-Large-Pfad speiste die OCR-Datenschutzwarnung („das hast du ungewollt verraten" — Adresse/Telefon) und die Tier-Erkennung aus `buildPseudoDescription`, das keine `SUBJECT:`-/`Sichtbarer Text:`-Marker enthält — die Warnung feuerte daher **nie**, das Tier-Easter-Egg war tot. Fix (rein additiv, fallback-sicher): zwei Pflichtfelder `subject` + `visible_text` im `singleLargePrompt` (DE + EN), `runSingleLargeCall` liest sie aus, `handle-process-job` verdrahtet sie zu den erwarteten Markern. Live gegen Mistral verifiziert (Felder kommen durch, Profile bleiben vollständig); neuer Regressions-Test `handle-process-job-priv002.test.js`. Rollback: `featureFlags/current.useSingleLargeCall=false`.
- **PRIV-001 — `.gitignore`-Lücke geschlossen.** Ungetrackte Test-Artefakte (`ab-test-*`, `single-large-call-*-rc*`, `compare-prototype-home.html`) mit aus echten Testbildern abgeleiteten Profilen (inkl. Minderjähriger) waren von keinem Ignore-Muster erfasst — ein `git add -A` hätte sie ins öffentliche Repo committet. Breite Schutzmuster ergänzt, Profil-Ausgaben aus dem Repo entfernt (lokal gesichert), Forschungs-Skripte bewusst ignoriert.
- **NTFY-001 — selbst-gehosteter `ntfy`-Benachrichtigungs-Server abgesichert + aktualisiert.** War öffentlich erreichbar und anonym lesbar (Image v2.22.0, außerhalb des Repos) → die Limit-Benachrichtigungen mit Admin-Aktionslinks waren für Fremde mitlesbar. Jetzt: eigenes Image auf **ntfy v2.24.0** (via Cloud Build), Passwortschutz (`NTFY_AUTH_DEFAULT_ACCESS=write-only` — die App sendet weiterhin ohne Änderung, Lesen nur mit Konto `malzime` + Passwort aus Secret `ntfy-owner-pass`), iPhone-Push über die Apple-Weiterleitung (`upstream-base-url` + `base-url`) live verifiziert. Rollback: Server-Env auf `read-write`.

### Geändert (Härtung)

- **OPS-003 — GitHub-Actions auf Commit-SHA gepinnt** (`ci.yml`: checkout, setup-node, gitleaks, lighthouse; `dependabot-automerge.yml`: fetch-metadata). Schutz gegen Tag-Repointing auf Schadcode.
- **gitleaks-action auf v3.0.0 aktualisiert** (SHA-gepinnt). v3 läuft nativ auf Node 24 — der frühere `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`-Workaround entfällt; v2 wird mit der Node-20-Abschaltung im September 2026 unbrauchbar. (Erledigt PR #24.)
- **OPS-002 — Dependabot-Auto-Merge auf semver patch+minor begrenzt** (fetch-metadata-Gate). Major-Updates brauchen jetzt manuelle Freigabe.
- **OPS-001 — GCS-Lifecycle-Setup in `deploy.sh` dokumentiert** (wird von `firebase deploy` nicht ausgerollt; Bucket-Regel als aktiv verifiziert).
- **DOC — Doku-Drift korrigiert:** `throttle.js` in README/AGENTS als AKTIV beschrieben (war fälschlich „nicht angebunden"); Rate-Limit 200 → 500; Sprachstatus DE+EN; `config.js`-Modell-Kommentar an aktiven Stand (`mistral-small-2603`); LICENSE-Copyright auf aktuellen Firmennamen; `deploy.yml`-Verweis → `dependabot-automerge.yml`.

### Validiert (Live-Verifikation, read-only)

- `processJob` nicht öffentlich (IAM korrekt, kein `allUsers`); GCS-Löschregel aktiv (Bilder zusätzlich sofort nach Analyse gelöscht — die 24 h betreffen nur das Text-Profil-Dokument, nicht das Foto); Branch-Protection aktiv (Pflicht-Checks + `strict`); alle Firestore-Indizes `READY`; 24-h-Reaper räumt zuverlässig.
- 428 Backend-Tests grün, Lint + Prettier grün.

### Offen (für einen Folge-Lauf)

- **BUG-001 / PRIV-003 / PRIV-004 / UX-001 / BIZ-001 (P3):** Job-Zustandsmaschine + Timeout, jobStatus-Abruf-Token, kürzere Profil-Retention, iOS-Liveness-Fenster, Stundenzähler beim Erfolg statt beim Upload.
- **DOC-Rest:** Single-Large-Architektur in README/ARCHITECTURE/SETUP beschreiben; Test-Zahlen aktualisieren (Backend real 428).
- **Dependabot-PRs #25–#29** (patch/minor) mergen per Auto-Merge selbst durch; #24 (gitleaks v3) wurde manuell übernommen (s. o.).

## [2.2.1] — 2026-05-29

Kinderschutz im `singleLargePrompt` gehärtet (beide Locales, DE + EN). Reine Sicherheits-Ergänzung im Minderjährigen-Abschnitt — keine Struktur-/Schema-Änderung, kostenneutral.

### Geändert

- **Erweiterte Schutzklausel für erkennbar Minderjährige** (`singleLargePrompt` in `de` und `en`). Zusätzlich zur bestehenden Zeile gegen sexualisierte Zuschreibungen: keine persönliche Abwertung von Körper/Gewicht/Haut, keine Zuschreibung von Sucht/Alkohol/Substanzen/Untreue/Beziehungsversagen als Charakterurteil. Die Karten `beziehungsstatus`, `verletzlichkeit` und `gesundheit` werden bei Kindern/Teens stattdessen auf die System-Ebene gelenkt (Werbedruck, Plattform-Mechanik, Peer-Pressure, In-App-Käufe, Körperbild-Industrie) — also wie die Person ausgewertet wird, nicht auf persönliche Defizite. Hintergrund: Der aktive Single-Large-Pfad unterdrückt für Minderjährige keine Karten server-seitig; die Schärfe der Beast-Pools traf bisher nur eine einzige Schutzzeile.

### Hinweis

- Die Klausel ist eine Prompt-Regel; ihre Wirksamkeit wurde nicht eigens gemessen (kein Kinder-Sicherheits-Metrik im A/B-Runner). Sie ist rein schützend und additiv — Downside-frei. Der dormant 3-Call-Fallback (`systemNormal`/`systemBoost`) wurde nicht angefasst.

## [2.2.0] — 2026-05-28

Finale stabile Version der Single-Large-Call-Pipeline. Die RC-Phase (rc1–rc3) ist damit abgeschlossen — die seit rc3 live laufende Architektur (Single-Large hinter Feature-Flag, Cloud-Tasks-Concurrency 10) wird unverändert zur stabilen Version erklärt. Zusätzlich zwei kleine Verbesserungen aus dem Betrieb: lesbarere Altersbeschreibungen und gehärtete Diagnose-Endpunkte.

### Geändert

- **Alterszeichen jetzt in Alltagssprache statt Fachbegriffen** (`singleLargePrompt` in beiden Locales). Neue Regel „ALTERSZEICHEN IN ALLTAGSSPRACHE" für beide Modi + entschärfte Few-Shot-Beispiele (profileText und Alterskarten in Standard und Beast): „Nasolabialfalten" → „die Falten von der Nase zu den Mundwinkeln", „Krähenfüße" → „feine Fältchen um die Augen" usw. **Die Alterskalibrierung selbst bleibt unangetastet** — die KI rechnet intern weiter mit den biometrischen Merkmalen, gibt sie aber laienverständlich aus. Hintergrund: im Live-Betrieb erschienen medizinische Fachbegriffe in den sichtbaren Profiltexten, die im Workshop-Kontext kaum lesbar waren.
- **Speicherlimit `telemetry` und `errors` von 128 MiB auf 256 MiB** (`functions/src/index.js`). Am 2026-05-28 riss `telemetry` das 128-MiB-Limit (132 MiB genutzt) und stürzte mitten in einer Anfrage ab — dabei gehen Diagnose-Beacons still verloren. 256 MiB gibt Puffer über dem Node-24-/firebase-admin-Grundbedarf (gleiches Muster wie bei `jobStatus` bereits angewendet). Kostenneutral (bleibt im dauerhaft kostenlosen Kontingent).

### Validiert

- **Erster Werktag-Vormittag unter rc3** (2026-05-28, Do): 27 Jobs, alle `done` beim 1. Versuch, 0 Mistral-429, 0 Retries, Job-Median ~50 s (P95 67 s). Echte Gleichzeitigkeit im Burst 08:02–08:14 CEST (~24 Uploads in ~12 Min) ohne Überlast. Damit ist das zuvor offene Werktags-Verhalten der Single-Large-Pipeline bestätigt.

## [2.2.0-rc3] — 2026-05-27

Konsolidierter Single-Large-Prompt mit Sicherheits- und Qualitäts-Härtungen. Verhalten der Live-Pipeline (Single-Large hinter Feature-Flag) bleibt strukturell gleich; Prompt wurde gegen den RC2-Stand A/B-getestet (15 Bilder × 3 Läufe = 90 Mistral-Calls) und an den zwei messbaren Schwachpunkten nachgeschärft.

### Geändert

- **`singleLargePrompt` in beiden Locales (`functions/src/locales/de/prompts.js` UND `functions/src/locales/en/prompts.js`) konsolidiert.** Bisher ein Template-Literal aus den 3-Call-Bausteinen (`systemNormal`/`systemBoost`/`AGE_ANCHOR`/`GENDER_ANCHOR`); jetzt ein eigenständiger Prompt mit gemeinsamen Regeln (GEMEINSAME REGELN-Block für beide Modi), geteilten Charakter-Pools (8 Bereiche mit STANDARD-Stärken, STANDARD-Schwächen und BEAST-Schwächen pro Bereich) und konsistenter „keine klaren Bildsignale"-Phrase als einheitlichem Ausweg für nicht-beurteilbare Felder. Die 3-Call-Pipeline-Bausteine bleiben in beiden Locales unverändert; nur Single-Large hat ab rc3 einen getrennten Prompt-Text (Pflege-Notiz im Header beider Dateien — DE und EN sind ab jetzt parallel zu pflegen).
- **Sicherheits-Klausel ergänzt:** Explizites Verbot sexualisierter Zuschreibungen bei Minderjährigen (war im Live-Prompt zuvor nicht codifiziert, sondern nur durch Mistrals Eigenvorsicht abgedeckt). Zentrale Schutzregel für Workshop-Tool mit Schüler:innen.
- **Anti-Halluzinations-Härtungen:** „Erfinde KEINE Markennamen — nur real existierende Marken aus dem mitteleuropäischen Markt" in AD_TARGETING; expliziter Anti-Leakage-Block vor dem JSON-Schema („Übernimm NIEMALS die konkreten Beispiel-Inhalte wie Bikepacking oder Garmin Edge 1040, wenn das Foto sie nicht hergibt").
- **Konsistenz-Pflicht zwischen Modi geschärft:** `hard_facts.alter_geschlecht` und `hard_facts.herkunft` müssen jetzt wortgenau in die jeweiligen Karten-Values übernommen werden (Satzanfang). A/B-Test zeigte: Substring-strikte Konsistenz 0 % → 100 %.
- **Confidence-Differenzierung explizit gefordert:** Bei klarem Bildbeleg 0,75–0,95, bei „keine klaren Bildsignale" deutlich niedriger (typisch unter 0,60). A/B-Test zeigte: Confidence-Streuung 0,104 → 0,143 (ehrlicher differenziert).
- **Karten-Wort-Untergrenze hart:** „MINDESTENS 15 Wörter pro Karte, MAXIMAL 25, 2 vollständige Sätze. Karten unter 15 Wörtern sind unvollständig und gelten als Fehler." Exemplar-Test mit den zwei A/B-Worst-Performern reduzierte zu-kurze Karten von ~26 % auf ~8 %.
- **Anti-Stichwort-Listen-Regel mit Negativ-Beispiel** in GEMEINSAME REGELN hochgezogen: „FALSCH: 'unsicher, ängstlich, perfektionistisch.' RICHTIG: 'Du bist unsicher und perfektionistisch. Die hochgezogenen Schultern und der angespannte Kiefer verraten Anpassungsdruck.'" Exemplar-Test eliminierte Stichwort-Listen vollständig (vorher 6 in 3 Läufen, nachher 0).
- **Beast-Variations-Pool** für korporative Stimme: Liste mit zehn Wir-Formulierungen („Wir wissen", „Wir verkaufen dir", „Wir kalkulieren", „Algorithmen sehen dich als", „Versicherer rechnen dich als", …), Empfehlung zur Variation gegen monotone Wiederholungen.
- **Multi-Person-Regel:** Falls das Bild mehrere Personen zeigt, wird die Person im Vordergrund/in der Bildmitte analysiert.
- **Marken-Spezifik gefördert:** „möglichst mit Modellnummer/Linie" in AD_TARGETING. Test zeigte spezifischere Werbe-Vorschläge wie „L'Oréal Paris True Match Foundation", „Nike Phantom GX 2 Elite", „L.O.L. Surprise! O.M.G. Fashion Dolls" (statt nur „L'Oréal", „Nike", „L.O.L. Surprise!").

### Hinzugefügt (Test-Infrastruktur)

- **`functions/scripts/single-large-ab-runner.js`** — generischer A/B-Test-Runner: fährt alle Bilder aus `compare-input/` mehrfach gegen Live- und Kandidat-Prompt, bewertet 7 automatische Metriken (Karten-Wort-Bereich, Stichwort-Listen, Confidence-Streuung, Leakage-Hits, Hard-Facts-Konsistenz, Beast-Opener-Wiederholungen, ad_targeting-Plausibilität), schreibt Markdown-Report. Wiederverwendbar für künftige Prompt-Iterationen.
- **`functions/scripts/prompts-v2.2.1-rc1.js`** — Snapshot des in rc3 deployten Prompts, separat als Test-Referenz für spätere A/B-Läufe gegen die dann-aktuelle Live-Version.
- **`PROMPT_VARIANT=rc1` ENV-Schalter in `functions/scripts/single-large-call-test.js`** — erlaubt schnellen Vergleich zwischen Live-Locale und Kandidat-Datei ohne Anpassung am Test-Skript.

### Validiert

- **A/B-Test 15 Bilder × 3 Läufe × 2 Varianten = 90 Calls** (kostete 2,69 EUR, dauerte 16,5 Min). Korrigierte Befunde nach Bereinigung um Mess-Artefakte (HTTP-Timeouts bei 2 Bildern und defekte „inventedBrands"-Heuristik): 6–7 echte Verbesserungen, 2 marginale Verschlechterungen im statistischen Rauschen. Wichtigste Verbesserungen: Hard-Facts-Konsistenz 0 % → 100 %, Confidence-Streuung 0,104 → 0,143, Marken spezifischer mit Modellbezeichnung, Karten näher am 15–25-Wort-Korridor.
- **Exemplar-Stresstest** an den zwei A/B-Worst-Performern (`IMG_0378.jpg`, `IMG_0584.jpg`) mit den zwei Polituren (harte Wort-Untergrenze + Anti-Stichwort-Liste in GEMEINSAME REGELN): zu-kurze Karten von ~26 % auf ~8 % gefallen, Stichwort-Listen vollständig eliminiert.
- **Tagesbilanz Live-Workshop 2026-05-27 vor Deploy:** 56 Jobs auf Single-Large-Pipeline, alle `done` beim 1. Versuch, 0 Mistral-429, 0 Retries, Server-Median ~57 s, Client-End-to-End ~59 s. Zwei stille Verluste (deliveredAt=null) — bekannter offener Punkt zum Auslieferungs-Loch, unverändert; Datenschutz-Entscheidung bleibt: kein `localStorage` (geteilte Schul-Geräte).

### Nicht geändert

- **3-Call-Pipeline-Bausteine** (`systemNormal`, `systemBoost`, `AGE_ANCHOR`, `GENDER_ANCHOR`) in beiden Locales unverändert — Fallback bei Rückschalten des Feature-Flags `useSingleLargeCall` auf `false` verhält sich identisch zu rc2.

### Hinweis zur EN-Variante

EN-Locale wurde strukturell parallel zur DE-Variante übersetzt (nicht separat A/B-getestet, da Live-Traffic >95 % de-DE/de-AT). Sollte EN-Traffic in Zukunft wachsen, wäre ein eigenständiger EN-A/B-Test gegen einen englischsprachigen Bilder-Pool sinnvoll. Beide Locales sind ab jetzt parallel zu pflegen.

## [2.2.0-rc2] — 2026-05-24

Kleinere Anpassungen am RC, bleibt prerelease. Single-Large-Pipeline weiterhin live aktiv hinter Feature-Flag.

### Geändert

- **Firmenname aktualisiert** auf „malziland - learning | training | consulting e.U." (vorher „malziland – digitale Wissensgestaltung e.U.") in Impressum, Datenschutz, Nutzungsbedingungen, JSON-LD schema.org und Meta-Tags. Inhaber-Name, Adresse, GISA, UID, FN unverändert.
- **`QUEUE_DISPATCH_CONCURRENCY` 3 → 10** und **`QUEUE_AVG_JOB_SECONDS` 100 → 65** in `functions/src/config.js` an die Realwerte aus dem Single-Large-Lasttest angepasst. Frontend-ETA zeigt jetzt realistische Wartezeit-Schätzungen für User — vorher rechnete sie noch mit den Werten der alten 3-Call-Pipeline und überschätzte die Wartezeit ~3×.
- **Cache-Buster aller HTML-Dateien** auf `v=2026052401` angehoben. `impressum.html` war noch auf `v=2026022106` (Februar) — überfällig.

### Validiert

- Zweiter Lasttest gegen Produktion (35 Jobs gegen Single-Large, Cloud-Tasks-Concurrency 10): 35/35 done, 0 Fehler, 0 × 429, 0 Retries. Mistral-Latenz Median 60 s, P95 69 s. Interner Throttle-Wait Median 0 ms. Bestätigt die Stabilität aus dem ersten Lasttest am 23.05. abends.
- Sonntag-Vormittag (24.05. seit 00:00): 5 echte User-Jobs, alle 5 done über Single-Large-Pipeline, 0 Fehler. Median 51 s pro Job, Median 13.130 Tokens.

## [2.2.0-rc1] — 2026-05-23

**Architektur-Experiment „Single-Large-Call" eingebaut, dormant hinter Feature-Flag.** Live-Pipeline läuft weiterhin auf der bewährten 3-Call-Architektur (Describe Large + 2× Profile Small 2603). Erst wenn `featureFlags/current.useSingleLargeCall` in Firestore manuell auf `true` gesetzt wird, schaltet die Queue-Pipeline für jeden neuen Job auf einen einzigen `mistral-large-2512`-Aufruf um, der Bild-Beschreibung, Standard-Profil und Beast-Profil in einer Antwort liefert. **Release Candidate** — Workshop-Validierung steht aus, daher RC-Status. Diese Release ändert für Endnutzer mit deaktiviertem Flag NICHTS.

### Hinzugefügt

- **Feature-Flag `useSingleLargeCall` in Firestore (`featureFlags/current.useSingleLargeCall`)** — schaltet ohne Deploy zwischen den zwei Pipelines. Default `false`; im Lokal-Modus (`QUEUE_LOCAL=1`) immer `false`, damit Emulator-Klicks die bewährte Pipeline treffen. Cache-TTL 30 s wie beim bestehenden `useQueue`-Flag. Fail-safe: jeder Firestore-Lesefehler → 3-Call-Pipeline.
- **Neue Funktion `runSingleLargeCall(buffer, mimeType, remainingBudget, lang)` in `functions/src/mistral.js`** — einziger `mistral-large-2512`-Call mit Bild + zusammengeführtem Prompt + großem JSON-Schema. Liefert dasselbe `{ normal, boost }`-Shape wie `generateBothProfiles`, damit `handle-process-job.js` nichts anderes anpassen muss als den Pipeline-Branch. Inklusive: Vollständigkeits-Check (alle 13 Karten pro Modus), gezielter Retry mit Hinweis auf fehlende Karten, Hard-Facts-Konsistenz server-seitig (`alter_geschlecht` + `herkunft` werden wortgenau in beide Modi überschrieben), zentrale Übernahme von `ad_targeting` + `manipulation_triggers` in beide Modi — analog zum v2.1-Konsistenz-Anker, nur in einer Antwort statt aus dem Describe-Footer.
- **Single-Large-Pipeline in `handle-process-job.js` (`runPipelineSingleLarge`)** — kompletter Branch der Queue-Pipeline. Tier-Easter-Egg (reine Tier-Bilder bekommen vordefinierte Profile) und Privacy-Risks bleiben funktionsfähig: weil der Single-Call kein separates Description-Feld liefert, baut die Funktion eine Pseudo-Beschreibung aus `profileText` + allen Karten-Werten zusammen — reicht für die Schlüsselwort-Heuristiken (Hund, Katze, sichtbarer Text). Tracking-Meta-Feld `meta.pipeline = "single-large"` zur späteren Log-Auswertung.
- **Wechsel-Scripts `scripts/cloudtasks-concurrency-3.sh` und `scripts/cloudtasks-concurrency-10.sh`** — passen die Cloud-Tasks-Queue-Drossel an die jeweilige Pipeline an. 3 für die bewährte 3-Call-Pipeline (Small-2603-TPM-Decke), 10 für Single-Large (Large-2M-TPM-Decke entlastet komplett). Cloud-Tasks-Konfiguration ist nicht runtime-toggle-bar, daher zwei separate gcloud-Befehle. Workflow im Script-Header dokumentiert: erst Flag in Firestore umlegen, dann Concurrency-Script ausführen.
- **Forschungs-Tool `functions/scripts/single-large-call-test.js`** — eigenständiger Test gegen die Mistral-Produktion (kein Live-Deploy, kein Firestore-Schreibzugriff). Wählt 3 zufällige Bilder aus `compare-input/` (oder feste über `TEST_IMAGES=...`), misst Tokens + Latenz + Vollständigkeit, generiert HTML-Vergleich + JSON-Rohdaten. Lädt jetzt den Live-`singleLargePrompt` direkt — Drift zwischen Test und Production kann strukturell nicht passieren.
- **Locale-Schlüssel `singleLargePrompt` in `functions/src/locales/de/prompts.js` und `en/prompts.js`** — als Template-Literal nach `module.exports` aus den bestehenden Live-Bausteinen (`systemNormal` + `systemBoost` + `AGE_ANCHOR` + `GENDER_ANCHOR`) zusammengesetzt. Single-Source-of-Truth: Verbesserungen an einem Live-Baustein wirken automatisch auf BEIDE Pipelines (3-Call + Single-Large). Damit gelten die vollen Live-Standards: kein „wahrscheinlich"/„könnte" im Standard, 8-Kategorien-Charakter-Katalog, FORCED-MAPPING-Altersregel (Nasolabialfalten → MINIMUM 38 Jahre), Gender-First-Aus-Gesichtsmerkmalen-Regel, Manipulation-Trigger-Pool mit 20+ Optionen, KEINE-Preisangaben-Verbot in `ad_targeting`/`werbeprofil`/`kaufkraft`. Single-Call-spezifisch sind nur die Einleitung (Modell sieht das Bild SELBST, beide Profile in einer Antwort), das JSON-Schema mit `standard`/`beast`-Sub-Objekten, sowie 13 konkrete „Aussage + Beleg"-Beispiele pro Modus (15-25 Wörter, „Du bist X. Bildbeleg Y."), die Mistral Karte für Karte imitiert. EN-Lokalisierung ist eine vollständige Übersetzung.

### Geändert

- **`feature-flags.js` liefert jetzt zwei Flags statt einem** — `{ useQueue, useSingleLargeCall }`. Bestehender Aufruf-Code (`isQueueEnabled`) unverändert, neue Funktion `isSingleLargeCallEnabled` analog. Caller in `handle-process-job.js` nutzt den Safe-Wrapper `isSingleLargeCallEnabledSafe`, damit ein Firestore-Fehler die Pipeline nicht blockiert.
- **Reale Token- und Latenz-Werte des Single-Large-Pfads (1 Bild, Live-API-Messung vor Deploy):** 13.180 Tokens pro Analyse, 60,6 s Latenz. Vergleich zur heutigen 3-Call-Pipeline: **-38 % Tokens**, aber **+60 % langsamere Einzel-Latenz** (60 s vs 38 s). Hard-Facts identisch in beiden Modi, Beast-Profil substanziell (10-12 Sätze, ~150 Wörter, schockierend mit Bildbeleg), konkrete Marken (Garmin Edge 1040, GOREWEAR, Specialized) statt generischer Branchen, vielfältige Trigger, Karten im „Du bist X. Bildbeleg Y."-Format (16-23 Wörter).
- **Architektur-Wert ehrlich:** der primäre Gewinn der Single-Large-Architektur ist NICHT die Einzelanalyse-Latenz, sondern die **vollständige Befreiung vom 2603-TPM-Bottleneck**. Alle Tokens landen im Large 2512 (2M TPM statt 100K) — Workshop-Concurrency kann auf 10+ ohne 429-Risiko. Bei einem 40er-Workshop bedeutet das rechnerisch: ~6 min Total-Zeit (Single-Large + Concurrency 10) statt ~13 min (heute Concurrency 3). Kostenseitig: ~3,2 ct pro Analyse statt 1,7 ct heute (+88 %). Lasttest steht aus.

### Geprüft (aber nicht umgesetzt)

- **Concurrency-Erhöhung der bestehenden 3-Call-Pipeline von 3 auf 4:** Mit den exakten Token-Werten aus den Live-Logs neu gerechnet — heutige Pipeline liegt mit Concurrency 3 bei ~95 % der 2603-TPM-Decke. Concurrency 4 würde uns rechnerisch ~27 % über die Decke heben. Verworfen. Sauberere Lösung ist der Single-Large-Call-Branch oben, der das 2603-Konto komplett entlastet.

## [2.1.0] — 2026-05-23

Großer Konsistenz- und UX-Sprung. Standard- und Beast-Modus zeigen jetzt
identische Grundfakten (Alter, Geschlecht, Herkunft) und identische Marken-
und Trigger-Listen — nur die algorithmische Bewertung (Einkommen, Persönlich-
keit, Verletzlichkeiten usw.) und der erzählende Verdict-Text unterscheiden
sich noch je nach Modus. Die Karten sind kürzer, scanbarer und thematisch
gruppiert. Token-Last auf dem engen `mistral-small-2603`-Konto sinkt um
rund 12 %, Job-Latenz um rund 17 %.

### Behoben

- **Profile in Standard und Beast haben jetzt garantiert dieselben Grundfakten:** Alter, Geschlecht und Herkunft stimmen in beiden Modi überein. Vorher würfelte Mistral pro Profile-Call neu und wich bei knapp jedem zweiten Bild ab — der gleiche Algorithmus „sah" denselben Menschen einmal 35 und einmal 42 Jahre alt, was im Workshop die Botschaft „so kategorisieren dich Algorithmen wirklich" verwässert hat. Die zwei Werte werden jetzt vom Large-Modell in einem strukturierten Footer-Block am Ende der Bildbeschreibung festgehalten und server-seitig in beide Profile-Calls hineingezwungen, damit kein zweites Würfeln entstehen kann.
- **Werbemarken und Manipulations-Trigger sind in beiden Modi identisch:** Die zwei Listen werden jetzt nur einmal vom Large-Modell generiert (im selben Footer-Block) und dann modus-übergreifend übernommen. Vorher generierte jeder Profile-Call seine eigene Marken-/Trigger-Liste, was inhaltliche Widersprüche zwischen Modi erzeugte — was nicht die Realität echter Datenbroker abbildet (Algorithmen sehen dich gleich, egal mit welchem Tonfall sie es dir erklären).
- **Beast-Profil bricht nicht mehr mitten im JSON ab:** Mistral hatte sich im Beast-Modus gelegentlich selbst entschieden, früh aufzuhören — `finishReason: "stop"` bei nur 7 von 13 gelieferten Karten und ohne Verdict-Text. Drei Maßnahmen zusammen lösen das: (1) Antwort-Budget pro Profile-Call von 8.000 auf 16.000 Tokens erhöht (Sicherheitsdeckel, kostenneutral), (2) Im JSON-Output kommt der Verdict-Text jetzt zuerst, dann die Karten — falls Mistral doch früh stoppt, ist wenigstens der Verdict da, (3) Server-seitige Vollständigkeitsprüfung: liefert Mistral weniger als 13 Karten, wird automatisch ein gezielter Retry-Call ausgelöst, der die fehlenden Felder explizit anfordert.
- **Profil-Karte „Werbeprofil" fehlt nicht mehr im Standard-Modus:** Mistral hatte die letzte Karte gelegentlich weggelassen, vermutlich weil sie ganz am Ende des Schemas stand. Mit der Vollständigkeitsprüfung (siehe oben) und der neuen JSON-Reihenfolge gibt das System keine unvollständigen Profile mehr aus.
- **Bei „im Bild nicht eindeutig erkennbar"-Fällen wird jetzt eine kurze Begründung mitgeliefert** statt abrupt zu enden. Vorher war „Im Bild nicht erkennbar." ein hartes Ende, das den Lesefluss zerriss; jetzt steht z. B. „Im Bild keine klaren Signale — weder Ehering noch Begleitung sichtbar." Der Workshop-Teilnehmer versteht, _warum_ keine Aussage möglich ist.

### Geändert

- **Profil-Karten sind jetzt im „Aussage + Beleg"-Format, 15–25 Wörter:** Statt 3–5-Satz-Fließtexten (50–80 Wörter) liefert jede Karte einen Satz mit der Klassifikation und einen zweiten Satz mit dem konkreten Bildbezug. Workshop-Teilnehmer können das Profil in 5–10 Sekunden überfliegen statt 2–3 Minuten zu lesen, ohne dass die wesentliche Aussage verloren geht. Die Inspiration war direktes Workshop-Feedback („gerade lange Fließtexte werden überflogen") und die Optik echter Datenbroker-Profile bei Acxiom oder Oracle Data Cloud, die ebenfalls knappe Datenbank-Einträge sind, keine Fließtexte. Marken werden nicht mehr namentlich in den Karten-Text geschrieben — die landen in der separaten Marken-Tag-Cloud und im Verdict-Text, was Doppelungen vermeidet.
- **Beast-Karten kürzer und disziplinierter:** Im Beast-Modus halten sich die Karten an dieselbe Längen-Vorgabe wie Standard (max 12 Wörter pro Karte in den Schema-Beispielen vorgegeben, damit Mistral die Länge imitiert). Der zynisch-konzern-pose-Ton bleibt erhalten — er entsteht aus dem System-Prompt, nicht aus der Karten-Länge. Begleitend wurde die Beast-Temperatur von 1.0 auf 0.8 gesenkt: bei hoher Temperatur ignoriert Mistral Längen-Vorgaben stärker, bei 0.8 bleibt der Würfel-Spielraum für den Wort-Stil erhalten, aber die strukturelle Disziplin steigt deutlich.
- **Karten-Anzeige neu gegliedert in vier farbcodierte Themengruppen:** „Wer du bist" (blau, Alter/Herkunft/Beziehung), „Was dich ausmacht" (grün, Bildung/Persönlichkeit/Charakter/Interessen), „Was du kaufst" (gelb, Einkommen/Kaufkraft/Werbeprofil), „Wo du verwundbar bist" (rot, Verletzlichkeit/Gesundheit/Politik). Die Gruppierung macht die 13 Karten visuell verdaubar — das Auge findet die thematische Sektion sofort, ohne jede Karte lesen zu müssen. Akzent-Linie links an jeder Karte in der Gruppen-Farbe, Mini-Überschriften vor jeder Sektion.
- **Konfidenz als drei farbige Punkte statt Prozent + Balken:** Prozente wie „72 %" oder „85 %" suggerieren Schein-Präzision, die Mistral so gar nicht liefert. Drei Punkte sind intuitiver („sicher", „wahrscheinlich", „vermutet") und passen besser zum Datenbroker-Look. Die Farbe entspricht der Themengruppen-Farbe.
- **Schlüsselbegriffe in den Karten-Werten werden automatisch fett markiert:** Eurobeträge („€ 45.000–60.000") und Personal-Anrede-Phrasen („Du bist diszipliniert") werden im Frontend hervorgehoben, damit beim Überfliegen die zentrale Aussage ins Auge springt.
- **Beschreibungs-Würfeln minimiert:** Temperatur beim Bildbeschreibungs-Call von 0.2 auf 0.1 gesenkt. Reduziert Run-to-Run-Schwankungen bei der Alters- und Geschlechts-Schätzung leicht — kostet keine Tokens, ändert keine Inhalte. Diese Schwankung ist laut Mistral selbst modellbedingt und nicht völlig eliminierbar; die niedrigere Temperatur ist der größtmögliche Hebel im aktuellen Setup.

### Verworfen (was wir bewusst nicht gemacht haben)

- **Architektur-Wechsel auf `mistral-small-2506` für die Karten-Klassifikation:** Hätte die Last auf dem engen 2603-Konto strukturell halbiert. Wurde verworfen, weil `mistral-small-2506` bei Mistral als deprecated markiert ist und am 31. Juli 2026 retired wird (Quelle: docs.mistral.ai). Eine Architektur-Investition mit zehn Wochen Lebensdauer macht keinen Sinn. Test-Infrastruktur (`functions/scripts/compare-pipelines.js`) bleibt für künftige Modellvergleiche im Repo.
- **Zusätzlicher Large-Text-only-Call zur Verdichtung der Beschreibung:** Wurde im Test geprüft (siehe Forschungsphase) und brachte keine messbare Bildqualitätsverbesserung bei Kindern, kostete dafür extra Tokens und Latenz. Verworfen.
- **Bias-Hebel im Live-Prompt** (positive Marker für Buben/Mädchen + Anti-Bias-Klausel + Few-Shot-Beispiele): destabilisierten im ersten Test die Live-Bildklassifikation. Bei einem Bild wurde aus „Mädchen 6–8" plötzlich „männlich". Rückgängig gemacht. Wird nur mit striktem A/B-Test wieder angefasst.

## [2.0.3] — 2026-05-23

Konsistenz im UI und Messbarkeit auf der Mistral-Seite: Die Profil-Karten erscheinen jetzt in beiden Modi in derselben festen Reihenfolge, und jeder Mistral-Call protokolliert Token-Verbrauch und Wartezeit getrennt.

### Behoben

- **Reihenfolge der Profil-Kategorien stabil:** Die Karten erscheinen jetzt immer in der gleichen, sinnvollen Reihenfolge (vom Demografischen über die soziale Verortung und Persönlichkeit bis zu Kaufkraft, Verletzlichkeiten und Werbeprofil am Ende) — egal ob Standard- oder Beast-Modus. Vorher entschied Mistral die Reihenfolge je Antwort selbst, weshalb dieselbe Person im Standard- und Beast-Profil unterschiedlich sortierte Karten hatte und auch zwei Aufrufe nacheinander voneinander abweichen konnten. Behoben durch eine feste, im Frontend hinterlegte Reihenfolge.

### Hinzugefügt

- **Pro-Call-Forensik für Mistral:** Jede `mistral-describe`- und `mistral-profile-*`-Log-Zeile trägt jetzt `promptTokens`, `outputTokens`, `httpMs` (reiner Mistral-Roundtrip) und `waitMs` (Wartezeit auf Semaphore-Slot + Token-Bucket). Beantwortet nach dem nächsten Workshop die Frage, ob die Mistral-TPM-Decke, die RPS-Decke oder die eigene Drossel die Wartezeit erzeugt — die Werte kamen schon vorher in jeder Mistral-Antwort, wurden aber verworfen.

## [2.0.2] — 2026-05-22

Robustheit und Messbarkeit der Warteschlange: Das fertige Ergebnis erreicht zurückkehrende Nutzer schneller, und die vier Phasen einer Analyse — Upload → Warteschlange → Verarbeitung → Auslieferung — sind ab jetzt einzeln im Log messbar.

### Hinzugefügt

- **Sofort-Nachfrage beim Zurückkehren in den Vordergrund:** Wird der Browser-Tab während der Warteschlangen-Wartezeit in den Hintergrund geschoben (Handy gesperrt, App gewechselt), drosseln Browser das Status-Pollen stark — bis hin zum Einfrieren. Das fertige Ergebnis wurde dadurch verzögert abgeholt. Der Poll-Loop weckt jetzt über das `visibilitychange`-Ereignis sofort auf, sobald der Tab wieder sichtbar wird, und holt das (meist längst fertige) Ergebnis ohne Wartezeit.
- **Auslieferungs-Messung:** Beim ersten Ausliefern eines fertigen Jobs hält `jobStatus` den Zeitpunkt fest (`deliveredAt`) und loggt eine `job-delivered`-Zeile mit `deliveryGapMs` (fertig gerechnet → beim Client angekommen) und `totalMs` (erstellt → ausgeliefert). Das trennt „fertig" von „tatsächlich abgeholt" — unabhängig von der best-effort Client-Telemetrie.
- **Warteschlangen-Wartezeit im Log:** Die `process-job`-Erfolgsmeldung enthält jetzt zusätzlich `queueWaitMs` — die Zeit zwischen Einreihen und Verarbeitungsbeginn.

### Geändert

- Die client-seitig gemessene Upload-Dauer (`enqueueMs`) wird in der Erfolgs-Telemetrie nicht mehr verworfen — sie fehlte bisher auf der Server-Whitelist und ist jetzt mitgeloggt.

## [2.0.1] — 2026-05-21

### Behoben

- Speicher der Warteschlangen-Statusabfrage (`jobStatus`) von 128 auf 256 MB angehoben. 128 MB hatte keinen Puffer über dem firebase-admin-Grundbedarf und lief beim Workshop am 21.05. unter Poll-Last in einen Speicherüberlauf.

### Geändert

- Die Fehlermeldung bei nicht lesbaren Bildern benennt jetzt beide möglichen Ursachen — nicht unterstütztes Format oder beschädigte Datei — statt nur das Format.

### Hinzugefügt

- Diagnose-Logging: Scheitert das Öffnen eines Bildes im Browser, wird die Formatklasse der Datei (an den ersten Bytes erkannt, etwa `heic` oder `tiff`) anonym mitgeloggt — kein Dateiname, kein Bildinhalt, nur die Format-Art.

## [2.0.0] — 2026-05-20

**Release: Queue-Architektur.** Jeder Upload läuft jetzt über eine Google-Cloud-Tasks-Warteschlange statt über eine lange offene Verbindung. Das fängt Workshop-Lastspitzen strukturell ab: Statt unter Stoßlast in eine 429-Fehlerkaskade zu laufen, werden Uploads dosiert und in fairer Reihenfolge abgearbeitet — kein verlorener Job, keine harten Fehler. Gesteuert über das Firestore-Feature-Flag `useQueue`; der synchrone `/analyze`-Pfad bleibt als sofortiger Rückfall erhalten (Flag umlegen, kein Deploy).

Diese Version fasst die fünf Entwicklungsphasen rc1–rc5 zusammen.

### Hinzugefügt

- **Backend-Warteschlange:** vier neue Functions — `enqueue` (nimmt den Upload an, reiht ihn ein, antwortet sofort mit einer `jobId`), `processJob` (Worker, nur über Cloud Tasks erreichbar, nicht öffentlich), `jobStatus` (leichtgewichtiger Polling-Endpunkt) und `reapJobs` (geplanter Aufräumlauf im Minutentakt). Neue Module: `jobs.js`, `cloud-tasks.js`, `queue-storage.js`, `feature-flags.js`, `handle-enqueue.js`, `handle-process-job.js`, `handle-job-status.js`, `handle-reap.js`.
- **Frontend-Warteschlange:** Der Browser reicht das Bild bei `/api/enqueue` ein und pollt `/api/job-status` im 2-Sekunden-Takt. Während der Wartezeit zeigt die Oberfläche Position und geschätzte Restzeit. Nach einem Seiten-Neuladen holt `resumeQueueJob()` ein laufendes oder fertiges Ergebnis nach — kein „Geister-Durchlauf" mehr.
- **Client-Liveness:** Jeder Poll ist zugleich ein Herzschlag. Pollt der Browser eines wartenden Jobs länger als 3 Minuten nicht mehr, setzt `reapJobs` den Job auf `abandoned`, gibt seinen Warteschlangen-Platz frei und löscht sein Bild — kein Mistral-Call für längst abgewanderte Nutzer.
- **Infrastruktur:** Cloud-Tasks-Queue `analyze-queue` (`europe-west1`, `maxConcurrentDispatches` 3), dedizierter nicht-öffentlicher Storage-Bucket `malzime-queue-uploads`, zwei zusammengesetzte Firestore-Indizes auf der `jobs`-Collection.
- **Feature-Flag** `useQueue` (Firestore `featureFlags/current`, 30 s Cache, fail-safe auf `false`); `/api/stats` liefert es an das Frontend aus.
- Lokale Emulator-Testumgebung für Entwicklung und Mock-Lasttests (`QUEUE_LOCAL`, `mistral-mock.js`, `docs/QUEUE-EMULATOR.md`).

### Geändert

- **Datensparsamkeit:** Das komprimierte Bild liegt nur für die kurze Wartezeit auf einem EU-Server und wird unmittelbar nach der Analyse gelöscht; `reapJobs` entfernt zusätzlich jedes Job-Dokument, das älter als 24 Stunden ist. Datenschutzerklärung, Nutzungsbedingungen, Impressum und Startseite benennen die kurze Zwischenspeicherung jetzt ehrlich.
- Warteschlangen-ETA-Schätzung auf 100 s justiert — echte Messungen zeigen ~65–100 s reine Verarbeitung pro Job.
- Dokumentation (README, ARCHITECTURE, SETUP, SELF-HOSTING, CONTRIBUTING, SECURITY) auf die Queue-Architektur aktualisiert.

### Behoben

- **Routing-Race:** Ein sehr schneller Upload konnte sich für den synchronen Pfad entscheiden, bevor das `useQueue`-Flag geladen war — `analyzeImage` wartet jetzt darauf (mit hartem Timeout).
- **CSP-Verstoß in der Ergebnis-Anzeige (betraf auch die Live-Seite):** Die Balken in `render.js` setzten ihre Breite per inline-`style` und wurden von der strikten Content-Security-Policy blockiert — jetzt CSP-konform per CSSOM gesetzt.
- `pollJob` bricht nach 30 Minuten sauber ab, falls ein Job dauerhaft hängt; `reapJobs` räumt auch in `processing` hängende Jobs ohne pollenden Client auf.

### Tests & Validierung

- End-to-End-Lauf mit 20 echten Analysen über die deployte Queue: 20/20 erfolgreich, null 429er — die Cloud-Tasks-Drosselung verhindert die Mistral-Überlast strukturell.
- Cloud-Tasks-Parallelität eingemessen: 3 ist das Maximum, das die aktuellen Mistral-Limits sauber hergeben (bei 6 kommt die Hälfte der Jobs als `blocked.overloaded` zurück).
- Umfangreiche neue Tests für alle Queue-Module (Backend + Frontend), inklusive Client-Liveness und gemocktem Polling.

## [1.10.9] — 2026-05-20

### Behoben — Wake-Lock wird wieder im User-Gesture-Kontext angefordert

Die v1.10.8-Wake-Lock-Telemetrie lieferte sofort ein klares Ergebnis: Auf einem iPhone (voller Akku, KEIN Stromsparmodus) kam `wakeLock: "denied:NotAllowedError"`, auf einem Mac `"acquired"`.

Ursache: `navigator.wakeLock.request("screen")` wurde tief in der asynchronen `analyzeImage`-Pipeline aufgerufen — nach mehreren `await`-Punkten (u.a. der `MIN_INTERACTION_MS`-Wartepause). iOS Safari erlaubt die Wake-Lock-Anfrage aber nur, solange noch **transiente User-Aktivierung** besteht — also unmittelbar nach dem Tippen, vor jedem `await`. Desktop-Safari ist hier lax (→ „acquired"), iOS streng (→ `NotAllowedError`). Es war also kein Geräte-Problem, sondern ein Reihenfolge-Bug bei uns.

**Fix:**

- **`public/app.js`**: `handleNewFile()` ruft `acquireWakeLock()` jetzt synchron als ALLERERSTES auf — direkt im `change`/`drop`-Event-Handler, bevor irgendein `await` läuft. Damit ist die User-Aktivierung noch „live", wenn die Wake-Lock-Anfrage rausgeht.
- **`public/js/api.js`**: `acquireWakeLock` exportiert + Guard `wakeLockRequested` ergänzt — ein zweiter (post-`await`) Aufruf aus `analyzeImage` würde sonst auf iOS scheitern und den bereits gewonnenen Status überschreiben. `releaseWakeLock` setzt den Guard zurück. Der `analyzeImage`-Aufruf bleibt als Fallback für Pfade ohne `handleNewFile` (Demo-Bilder). Der nicht mehr funktionsfähige `visibilitychange`-Re-Acquire-Listener wurde entfernt (durch den Guard ohnehin wirkungslos, und Re-Acquire ohne Gesture scheitert auf iOS sowieso).

Erwartung: Auf iPhones sollte aus `denied:NotAllowedError` künftig `acquired` werden — verifizierbar in den Telemetrie-Logs ab dem nächsten Workshop. Wichtig bleibt die Einordnung aus v1.10.8: Ein funktionierender Wake-Lock behebt nur die Bildschirm-Auto-Sperre, nicht das Tab-Einfrieren oder App-Wechsel.

### Tests

- Frontend 143/143 grün. Backend unverändert (298/298).

### Sonstiges

- Cache-Buster auf `?v=2026052002`.

## [1.10.8] — 2026-05-20

### Behoben — modell-bewusster Token-Bucket + Wake-Lock-Diagnose

Nach Auswertung des Workshop-Vormittags (2026-05-20): Der Server lief stabil (keine 429er, keine Mistral-Hänger), aber einzelne Schüler warteten bis ~110 s, und manche mussten mehrfach hochladen. Drei Ursachen-Maßnahmen:

- **`functions/src/throttle.js` — modell-bewusster Token-Bucket.** Bisher drosselte EIN gemeinsamer Token-Bucket alle Mistral-Calls auf 1,6 RPS — orientiert am langsamsten Modell (`mistral-small-2603`, 1,67 RPS). Damit wurden auch die `describe`-Calls über `mistral-large-2512` (Limit 6 RPS) unnötig auf 1,6 RPS gebremst. Jetzt zwei getrennte Buckets: Large 800 ms/Instanz (= ~5 RPS gesamt bei 4 Instanzen, unter 6-RPS-Limit), Small 2500 ms/Instanz (= ~1,6 RPS, unter 1,67-Limit). Die Bildbeschreibung läuft damit ~3× schneller → kürzerer Wartezeit-Tail unter Workshop-Last. `withMistralSlot` bekommt einen `modelClass`-Parameter; `mistral.js` leitet `large`/`small` aus dem Modellnamen ab.
- **`public/js/api.js` — Wake-Lock-Telemetrie.** Das `acquireWakeLock()`-`catch` verschluckte bisher jeden Fehler stumm — wir hatten null Daten, warum der Bildschirm-Wachhalter auf keinem Gerät zu greifen scheint. Jetzt wird der Status erfasst (`not-attempted` / `unsupported` / `acquired` / `denied:<FehlerName>`) und in Success-Telemetrie (`meta.wakeLock`) sowie Client-Error-Logs (`wakeLock`) mitgeschickt. Ab dem nächsten Workshop liefern die Logs echte Daten.
- **`public/locales/de.json` + `en.json` — `error.suspended` neutral formuliert.** Die alte Meldung behauptete fälschlich „Gerät ging in Ruhezustand". Das stützte sich auf `document.hidden`, das aber aus vielen Gründen `true` wird (App-Wechsel, Benachrichtigungs-Leiste, Browser-Energiesparmodus — speziell Samsung Internet friert Tabs bei eingeschaltetem Bildschirm ein). Neue Meldung: „Die Analyse wurde unterbrochen. Bitte versuch es nochmal und lass die Seite dabei geöffnet im Vordergrund." — keine falsche Ursachen-Behauptung mehr.

### Begleitende Whitelist-Erweiterungen

- `functions/src/handle-telemetry.js`: `wakeLock` (max 40 Zeichen) in `META_STRING_KEYS`.
- `functions/src/handle-errors.js`: `wakeLock` (max 40 Zeichen) in `STRING_FIELDS`.
- `public/js/error-logger.js`: reicht `context.wakeLock` in den Error-Payload durch.

### Tests

- Backend 298/298 grün (3 neue Tests für die modell-bewussten Token-Buckets).
- Frontend 143/143 grün.

### Sonstiges

- Cache-Buster auf `?v=2026052001`.

## [1.10.7] — 2026-05-19 (Abend)

### Behoben — Modell-Limits korrekt erfasst, Token-Bucket entsprechend kalibriert

Spaeter Abend nach v1.10.6-Deploy zeigten sich anhaltende Mistral-429er-Probleme und 3-Minuten-Hänger. Diagnose ueber das Mistral-Account-Dashboard offenbarte den eigentlichen Fehler: Unsere `throttle.js`-Annahme „Mistral-Scale-Tier hat 6 RPS" stammte aus einem alten Audit und war fuer das aktuelle Modell falsch.

**Tatsaechliche Account-Limits (Dashboard 2026-05-19):**

- `mistral-small-2603` (unser Profile-Modell): **100K TPM, 1.67 RPS**
- `mistral-small-2506` (deprecated, aelter): 5M TPM, 20.83 RPS
- `mistral-large-2512` (Describe + Fallback): 2M TPM, 6 RPS
- `mistral-large-2411` (aelter): 600K TPM, 1.67 RPS

Mistral hat fuer die neueste Small-Variante (-2603) auffaellig restriktive Limits gesetzt — vermutlich gestaffelte Freischaltung neuer Modelle. Mit unseren v1.10.6-Werten (`maxInstances=4 × 1500ms-Token-Bucket = 2.67 RPS`) lagen wir strukturell ueber dem Small-Limit.

**Aenderungen:**

- **`functions/src/throttle.js`**: `TOKEN_INTERVAL_MS: 1500 → 2500` ms. Damit ergibt sich `4 × 0.4 = 1.6 RPS` gesamt, sicher unter dem 1.67-RPS-Limit von -2603. Kostet ~1 s extra Queue-Wartezeit pro Mistral-Call unter Last, eliminiert aber die strukturelle 429-Quelle.
- **`functions/src/config.js`**: Large-Modelle fest gepinnt — `MISTRAL_DESCRIBE_MODEL` und `MISTRAL_FALLBACK_MODEL` von `mistral-large-latest` auf `mistral-large-2512` (verifizierte gute Limits: 2M TPM, 6 RPS). Verhindert dass Mistral uns ueber den `-latest`-Alias auf ein moeglicherweise restriktiv limitiertes Nachfolge-Modell umschiebt.
- **`functions/src/config.js`**: Erweiterte Kommentar-Doku mit den verifizierten Limits zu jedem Modell, damit Folge-Audits nicht wieder auf falschen Annahmen aufbauen.

### Nicht uebernommen — Modell-Wechsel auf Small 3.2

Zwischenzeitlich testweise ausprobiert: `MISTRAL_PROFILE_MODEL` auf `mistral-small-2506` umgestellt. Limits 50× besser, aber **Live-Test zeigte 30-80 % Qualitaetsregression beim `ad_targeting`** (kaum noch echte Markennamen, generische Targeting-Begriffe). Didaktischer Wert des Tools haengt aber an konkreten Marken — daher sofortiger Revert zurueck auf `mistral-small-2603`.

Lesson learned: Versions-Sprung Small 3.2 → Small 4 ist bei spezifischen Fähigkeiten (Brand-Knowledge) substanziell, nicht nur „3-8 % Benchmark-Verbesserung" wie meine Schätzung vorher.

### Folge-Lessons aus dem Abend

- **Vor Architektur-Entscheidungen immer das Account-Dashboard pruefen**, nicht den Code-Kommentar oder die generische Doku.
- **Modell-spezifische Limits sind nicht uniform** — neueste Versionen koennen drastisch restriktiver sein als deprecated Vorgaenger.
- **-latest-Aliase fuer Modelle vermeiden** — Versions-Pinning gibt uns Kontrolle.

### Tests

- Backend 295/295 gruen (Test-Konstanten an neue Modell-IDs angepasst).
- Frontend 143/143 gruen (unveraendert).

## [1.10.6] — 2026-05-19

### Behoben — Workshop-Tauglichkeit fuer 25-50 gleichzeitige Teilnehmer

Heutiger 13:00-15:00-Workshop hat die Pipeline gerissen: ab ~15 Geraeten gleichzeitig kamen reihenweise "Server-Fehler" und Abbrueche. Logs zeigten Throttle-Queue-Timeouts, Mistral-429-Kaskaden und Analysen, die statt 60-90 s plötzlich 250-328 s dauerten.

**Wurzelursache** war nicht Mistral selbst, sondern eine Kette von Config-Schwaechen, die sich gegenseitig verstaerkt haben:

1. Cloud-Run-`concurrency: 20` packte alle eingehenden Requests auf eine einzelne Instanz, statt horizontal zu skalieren.
2. Die Per-Instance-Drossel (`throttle.js`, 6 Slots) staute sich dadurch sofort.
3. Auf 429-Antworten von Mistral versuchte der Code 2× Retry mit kurzem Backoff — drei Wellen Anfragen gegen ein bereits ueberlastetes Rate-Limit verstaerkten den Stau exponentiell.
4. Der Throttle-Queue-Timeout (90 s) feuerte unter Last reihenweise → Anfragen schlugen fehl, ohne dass Mistral je wirklich angesprochen wurde.
5. Frontend hatte keine Auto-Retry-Logik fuer transienten Server-Druck → User sah einen einzigen generischen Fehler nach 60-180 s.

**Fixes** (zusammen wirksam):

- **`functions/src/index.js`**: `concurrency: 20 → 8`, `maxInstances: 10 → 4`, `timeoutSeconds: 180 → 540` (Cloud-Run-Maximum). Mit `concurrency=8` zwingt Cloud Run das Hochfahren neuer Instanzen, statt eine zu fluten. `maxInstances=4` × 6 Throttle-Slots ergibt einen echten globalen Cap von 24 parallelen Mistral-Calls (~2,7 RPS sustained mit Token-Bucket), weit unter Mistrals 6-RPS-Limit.
- **`functions/src/throttle.js`**: `DEFAULT_QUEUE_TIMEOUT_MS: 90 000 → 360 000` (6 Minuten). Mistral braucht 60-90 s pro Call, ein Slot wird also nur alle ~15 s frei. Mit kurzem Timeout lief eine Anfrage in Queue-Position 3+ schon mitten im Anstehen ins Out. 6 Minuten Warte-Spielraum + 540 s Function-Timeout = praktisch kein Throttle-Failure mehr im Normalbetrieb.
- **`functions/src/mistral.js`**: 429-Retry-Backoffs `[1000, 3000] → [2000]` (1 statt 2 Retries). `isRateLimitError` erkennt jetzt auch `throttle_timeout` als Ueberlast-Signal. `runProfile`/`tryProfileCall` schlucken Rate-Limit-Fehler nicht mehr, sondern propagieren sie sauber zu `handle-analyze.js` (→ `blocked.overloaded` im Response-Body → Frontend retried). Per-Call-Timeout via `Math.min(timeoutMs || MISTRAL_TIMEOUT_MS, MISTRAL_TIMEOUT_MS)` gecappt — verhindert, dass das gestiegene `REQUEST_BUDGET_MS` einen einzelnen Mistral-Call ueber 90 s laufen laesst (Outer-Budget gilt fuer die Pipeline, nicht fuer Einzelaufrufe).
- **`functions/src/throttle.js`**: **Token-Bucket-Rate-Limiter + Initial-Jitter.** Die bisherige Semaphore limitierte nur PARALLELITAET (max 6 in-flight) — nicht die RATE. Lasttests mit 20 parallelen Anfragen haben das aufgedeckt: Slots wurden gleichzeitig frei, neue Calls bursteten in derselben Millisekunde gegen Mistral, × N Cloud-Run-Instanzen = bis zu 36 RPS Instant-Burst (Limit: 6 RPS). Resultat: 40 % HTTP 429. Token-Bucket erlaubt jetzt max 1 Mistral-Call alle 1500 ms pro Instanz (= 0,67 RPS); bei `maxInstances=4` ergibt das ~2,7 RPS gesamt, sicher unter Mistrals 6-RPS-Limit. **Initial-Jitter 0-2000 ms** beim allerersten Token-Acquire pro Instanz verhindert, dass mehrere frisch geboorene Cold-Start-Instanzen ihren ersten Call in derselben Millisekunde feuern.
- **`functions/src/counter.js`**: Eigene 2-Retry-Schleife auf `runTransaction` bei Firestore-ABORTED-Kontention. Das SDK retried intern 5×, das reichte unter Workshop-Burst nicht — die `counter-fail-open`-Alarme bei meinen Lasttests waren genau diese Kontention, kein echter DB-Ausfall. Jetzt 2 Retries mit 80–240 ms Backoff+Jitter VOR dem ERROR-Pfad; nur wenn auch die noch versagen, wird der Alarm ausgeloest. Routinemaessige Workshop-Last triggert keinen Alarm mehr; echte Firestore-Ausfaelle alarmieren weiter sauber.
- **`functions/src/config.js`**: `HOURLY_LIMIT: 500 → 1500` (Puffer fuer mehrere Workshops kurz hintereinander + Auto-Retry-Volumen), `REQUEST_BUDGET_MS: 120 000 → 480 000` (matched neues Function-Timeout, gibt Mistral auch nach langer Queue-Wartezeit volle 90 s), `RATE_LIMIT: 200 → 500` pro 10 Minuten (Schul-WLAN teilt sich eine IP — bei 25 Geraeten mit Auto-Retries war 200 zu knapp).
- **`public/js/api.js`**: Auto-Retry-Loop um den Fetch-Block. Max 3 Retries (4 Versuche total), 8 s Basis-Wartezeit mit ±2 s Jitter, retried bei HTTP 429/503 ohne `blocked:"limit"`/`maintenance`-Body und bei `blockedReason: "blocked.overloaded"` im 200er-Body (Heartbeat-Pfad). `FETCH_TIMEOUT_MS: 180 000 → 540 000` matched das neue Backend-Timeout. Jitter zwischen Retries verhindert synchrone Retry-Wellen aller Workshop-Geraete.
- **`public/locales/de.json` + `en.json`**: Neue Keys `error.serverBusy` ("System gerade stark belastet, bitte ein bis zwei Minuten warten") und `status.serverBusyRetrying` ("Sehr viele Anfragen gerade — versuche es automatisch nochmal …") fuer die Auto-Retry-UX.

### Erwartete Kapazitaet nach diesen Aenderungen

| Workshop-Groesse | Verhalten                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| 15-25            | Sauber, alle in 1-2 Minuten fertig, kein User-sichtbarer Fehler                                    |
| 25-50            | Sauber, alle in 2-4 Minuten, vereinzelt Auto-Retry mit „versuche es automatisch nochmal …"-Meldung |
| 50-100           | Mit Auto-Retry meistens sauber; einzelne sehen evtl. die Server-Busy-Meldung                       |
| 100+             | Knapp bis enger Engpass — fuer 200 braucht es die echte Queue-Architektur (separater Plan)         |

### Was bewusst NICHT angefasst wurde

- **`MISTRAL_PROFILE_MAX_TOKENS` bleibt 8000.** Erste Idee war 4500, aber Live-Beobachtung im Workshop zeigte abgeschnittene Profile — die kamen von Timeout-Truncation, nicht vom Token-Cap. Eine Reduktion haette die Truncations verschlimmert statt verbessert.
- **Heartbeat-Pattern (v1.10.4) bleibt unangetastet.** Wird erst mit v2.0-Streaming obsolet.

### Tests

- Backend 293/293 gruen (3 Tests fuer geaenderte Konstanten angepasst, 1 neuer Test fuer `isRateLimitError` mit `throttle_timeout`, 1 neuer Test fuer Einzel-Call-Timeout-Cap, 1 neuer Test fuer Token-Bucket-Rate-Limiter).
- Frontend 143/143 gruen (1 bestehender 429-Test auf Hard-Limit-Pfad umgestellt, 2 neue Tests fuer Auto-Retry-Verhalten: 503-Retry-mit-Success und blocked.overloaded-mit-Exhaustion).
- Lint + Prettier auf allen geaenderten Files gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051910`.

## [1.10.5] — 2026-05-15

### Behoben — Spinner verschwand mid-Pipeline mit Heartbeat

Direkt nach v1.10.4-Deploy gemeldet: Spinner verschwand nach wenigen Sekunden, dann ~1 Minute leere UI, dann ploetzlich das Ergebnis. Ursache: `await fetch(...)` returnt bei chunked transfer **sofort sobald Headers da sind** (statt erst beim kompletten Body wie bei `Content-Length`-Response). `stopScanAnim()` lief deshalb mid-Pipeline statt erst beim fertigen JSON.

- **`public/js/api.js`**: `stopScanAnim()` aus dem fetch-Direct-Path entfernt. Stopp jetzt entweder im 4xx-Block oder nach `await response.json()` — dann ist der Body wirklich da und der User sieht den Wechsel von Spinner zu Ergebnis ohne Lücke.

### Tests

- Frontend 141/141 gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051509`.

## [1.10.4] — 2026-05-15

### Behoben — Safari/WebKit kappt fetch nach ~47 s ("Load failed")

Akutes Problem: Im Workshop-Setup auf macOS + iOS Safari brach jede Analyse mit `TypeError: Load failed` ab, sobald die Pipeline laenger als ~45 s lief. Cloud Logging zeigte: Backend antwortete sauber mit `status:ok` in 50-120 s, der Browser kappte aber bereits nach 46-47 s. Brave/Chrome (Chromium-Engine) waren nicht betroffen, also engine-spezifisches Verhalten — WebKit killt idle fetch-Streams ohne Server-Bytes.

**Fix: Heartbeat-Pattern.**

- **Neu — `functions/src/heartbeat.js`**: Streaming-Helper, der den Status auf 200 committed und alle 5 s ein Whitespace-Byte ueber chunked transfer sendet. `JSON.parse` toleriert leading whitespace, deshalb keine Client-Anpassung noetig.
- **`functions/src/handle-analyze.js`**: Heartbeat startet NACH allen 4xx-Pfaden (Validation, Counter), direkt vor dem ersten Mistral-Call. Alle `res.json(...)` in der Pipeline durch `heartbeat.finish(...)` ersetzt. Outer catch signalisiert Fehler als `blocked.apiError` im 200er-Body, da Status nach Heartbeat-Start nicht mehr aenderbar ist.
- **`public/js/api.js`**: Fehlklassifizierung „Geraet im Ruhestand" entfernt. Sticky-Flag `pageHiddenDuringRequest` raus — pruefte den falschen Zeitpunkt und feuerte auch bei Safari-Display-Dimm. Stattdessen wird `document.hidden` zum tatsaechlichen Fehler-Zeitpunkt geprueft.
- **`functions/eslint.config.js`**: `setInterval`/`clearInterval` als Globals (fuer Heartbeat-Timer).
- **`eslint.config.mjs`**: `screen` als Browser-Global ergaenzt (war v1.10.0-Lint-Schuld in `client-context.js`).

### Tests

- Backend 290/290 gruen. Heartbeat-Helper enthaelt graceful Test-Fallback: wenn `res.flushHeaders` im Mock fehlt, fungiert er als `res.status(200).json(body)` — alle bestehenden `index.test.js`-Tests laufen unveraendert.
- Frontend 141/141 gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051508`.

## [1.10.3] — 2026-05-15

### Geaendert — Hosting-Fallback-Pfade entfernt

Nach erfolgreicher Verifikation von `api.malzi.me` (v1.10.2) jetzt die beiden Fallbacks aufgeraeumt, die als Sicherheitsnetz waehrend des Uebergangs drin waren:

- **`firebase.json` CSP `connect-src`**: alte Cloud-Run-URL `https://analyze-5ymhpdpqcq-ew.a.run.app` entfernt. Nur noch `api.malzi.me` (+ Nominatim) erlaubt — engerer Schutz, kein Bypass mehr ueber die alte URL moeglich.
- **`firebase.json` rewrites**: `/analyze → function analyze` entfernt. War der urspruengliche Hosting-Rewrite mit dem 60s-Edge-Timeout-Bug — wird vom aktuellen Frontend nicht mehr aufgerufen, und Clients mit gecachtem alten Frontend laufen nach Cache-Buster-Update (`?v=2026051507`) automatisch auf die neue api.js mit `api.malzi.me`.

Cloud-Run-Services bleiben unveraendert; nur Frontend-Hosting-Konfig.

### Tests

- Bestandstests laufen weiter, keine Logik-Aenderung.

### Sonstiges

- Cache-Buster auf `?v=2026051507`.

## [1.10.2] — 2026-05-15

### Geaendert — Analyze-Endpoint nutzt jetzt `api.malzi.me`

Custom Domain `api.malzi.me` ist via Cloud Run Domain Mapping eingerichtet (CNAME → `ghs.googlehosted.com`, SSL automatisch ueber Lets Encrypt). Damit weg von der unschoenen `.run.app`-URL und in DevTools/Network-Tab sauber unter eigener Domain sichtbar. Funktional identisch zur direkten Cloud-Run-URL — Edge-Timeout-Falle bleibt umgangen.

- **`public/js/api.js`**: `ANALYZE_URL` auf `https://api.malzi.me`
- **`firebase.json`**: CSP `connect-src` um `https://api.malzi.me` ergaenzt; alte `analyze-5ymhpdpqcq-ew.a.run.app` bleibt vorerst als Fallback drin fuer User mit gecachtem alten Frontend-Build
- DNS-/SSL-/CORS-Setup live verifiziert (HTTP 405 / 204 Preflight, `server: Google Frontend`, `access-control-allow-origin: https://malzi.me`)

### Tests

- Bestandstests laufen weiter, keine Logik-Aenderung.

### Sonstiges

- Cache-Buster auf `?v=2026051506`.

## [1.10.1] — 2026-05-15

### Geaendert — Trace-ID standardmaessig in Fehlermeldungen

`?debug=1`-Toggle entfernt — der Diagnose-Code (Trace-ID) wird jetzt bei **jedem** Fehler dezent als zweite Zeile unter der User-Meldung angezeigt. So kann jeder Workshop-Teilnehmer im Fehlerfall den Code an den Support weitergeben, ohne dass URL-Tricks noetig sind. Der Code bleibt anonym (keine PII), zeigt nur die Quittungsnummer fuer das zugehoerige Cloud-Logging-Bundle.

- **`public/js/ui.js`**: `setStatus(text, traceId)` nimmt jetzt eine optionale Trace-ID. Trace-Anzeige als eigenes `<small class="status__trace">`-Element (XSS-sicher via createElement/textContent).
- **`public/styles.css`**: Neue Klasse `.status__trace` — kleiner, dezent grau, monospace, mit `user-select: text` damit der Code per Maus markierbar ist.
- **`public/js/api.js`**: Alle Fehler-`setStatus`-Aufrufe (catch-Block + HTTP-Error + Rate-Limit) reichen `traceId` mit. `appendTraceIdInDebug` + `isDebugMode`-Aufruf entfernt.
- **`public/js/client-context.js`**: `isDebugMode()`-Export entfernt (nicht mehr benoetigt).
- **`public/__tests__/api.test.js`**: 7 Tests von `toBe(...)` auf `toContain(...)` umgestellt, weil `textContent` jetzt auch die Trace-Zeile enthaelt.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051505`.

## [1.10.0] — 2026-05-15

### Neu — State-of-the-Art Logging-Pipeline (anonym, DSGVO-konform)

Das v1.9.0-Logging deckte nur Fehler ab und liess Frontend ↔ Backend unverbunden. v1.10.0 macht daraus eine richtige Telemetrie-Pipeline: pro Analyse eine durchgaengige Trace-ID, alle Pipeline-Schritte mit Timings, Erfolge und Fehler beide strukturiert, mit Hardware-/Netzwerk-Kontext fuer Diagnose von Mobile-Issues.

- **Trace-ID-Korrelation Frontend ↔ Backend** (`public/js/client-context.js` neu): Frontend generiert pro Analyse-Lauf eine 16-Zeichen-Trace-ID, sendet sie im `analyze`-Body mit. Backend (`handle-analyze.js`) validiert sie (Regex-Whitelist), nimmt sie in alle Log-Eintraege auf und setzt sie als `X-Trace-Id`-Response-Header. Damit ist jeder Frontend-Error einem konkreten Backend-Request zuordenbar.
- **Strukturierte Pipeline-Timings im Backend** (`handle-analyze.js`): Jeder Mistral-Schritt loggt `durationMs`. Final-Log enthaelt `totalMs`, `describeMs`, `profilesMs` — kein Zusammenrechnen aus Timestamps mehr noetig. Auch Blocked- und Error-Pfade enthalten `totalMs`.
- **Neuer `/api/telemetry`-Endpoint** (`functions/src/handle-telemetry.js`, `firebase.json`): Spiegel zu `/api/errors`, aber `console.log` (severity INFO) statt `console.error` (ERROR) — Success-Events bleiben getrennt von Fehlern im Cloud Logging. Whitelist + Laengenlimits identisch zur Errors-Function.
- **Anonymer Hardware-/Netzwerk-Kontext** (`public/js/client-context.js`): `collectClientContext()` sammelt `effectiveType` (`4g`/`3g`), `downlinkMbps`, `rttMs`, `saveData`, `deviceMemoryGb`, `hardwareConcurrency`, `language`, `screen` (BxH), `dpr`. KEINE IP, KEINE Cookies, keine UUIDs persistent — nur grobe Klassen fuer Performance-/Mobile-Diagnose.
- **Telemetrie-Logger Frontend** (`public/js/telemetry-logger.js` neu): `logTelemetry(eventType, context)` sendet anonymisierte Performance-Daten. `keepalive: true` fuer Beacons beim Tab-Schliessen.
- **Phase-Timings im Frontend** (`public/js/api.js`): Misst und meldet `prepareImageMs`, `fetchMs`, `parseMs`, `renderMs`, `totalMs`. Bei Success: `logTelemetry("analyze-success", ...)`. Bei Fehler: vorhandene Timings landen mit im Error-Report.
- **Error-Logger erweitert** (`public/js/error-logger.js`, `handle-errors.js`): `traceId`, `httpStatus`, `timings`, `client` zusaetzlich akzeptiert + validiert.
- **`?debug=1` URL-Parameter** (`public/js/client-context.js`): Aktiviert Trace-ID-Anzeige in der Status-Zeile bei Fehlern — User kann die ID einfach an Support weitergeben.
- **Trace-ID im State** (`public/js/state.js`): `state.lastTraceId` fuer Wiederverwendung.

### DSGVO-Bilanz

Geloggt: Fehler-Typ + -Message (gekuerzt), Phase, Dauer, gekuerzter User-Agent, anonyme Hardware-Klassen (Memory-Stufe / CPU-Cores / grobe Bandbreite), Trace-ID (ephemer, kein Profil), URL-Pfad. Nicht geloggt: IP persistent, Cookies, Bilder, EXIF, GPS, exakte Browser-Versionen, Timezones. Daten liegen ausschliesslich in Cloud Logging mit projektweiter Retention.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051504`.

## [1.9.1] — 2026-05-15

### Geaendert — Upload-Limit von 6 MB auf 25 MB hochgesetzt

Frontend verkleinert das Bild ohnehin per Canvas-Resize (`exif.js`), bevor es an die API gesendet wird. Das alte 6-MB-Hardlimit blockierte aber bereits die Rohdatei — typische Handy-Originale (iPhone, iPad, Pixel) liegen oft bei 4–10 MB und scheiterten daran ohne Grund. Neues 25-MB-Limit laesst alle ueblichen Handy-Fotos durch, schuetzt aber weiterhin vor versehentlich hochgeladenen RAW-Dateien oder Videos.

- **`functions/src/config.js`**: `MAX_UPLOAD_BYTES` von 6 auf 25 MiB
- **`public/js/api.js`**: Client-seitige Pre-Check-Grenze von 6 auf 25 MB
- **`public/locales/de.json` + `en.json`**: Hint + Fehlermeldung („max 6 MB" → „max 25 MB")
- **`public/index.html`**: drop-hint Text
- Tests angepasst: `config.test.js`, `api.test.js` (Oversize-Test von 21 auf 30 MB), `index.test.js` (Base64-Oversize-Test von 15 auf 40 MB).

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051503`.

## [1.9.0] — 2026-05-15

### Neu — Anonymes Client-Error-Logging (DSGVO-konform)

Bisher waren Frontend-Fehler nur als pauschale UI-Meldung sichtbar (z.B. „Server-Fehler", „Verbindung fehlgeschlagen") — ohne Hinweis auf Fehler-Typ, Phase oder Dauer. Reproduktion und Diagnose von Reports waren reine Vermutungssache. Jetzt landet jeder Frontend-Fehler strukturiert in Cloud Logging.

- **`functions/src/handle-errors.js`** (neu): nimmt POST mit JSON-Body, validiert Felder gegen eine Whitelist mit Laengenlimits, schreibt strukturierten Eintrag mit `console.error` (severity ERROR in Cloud Logging). DSGVO: keine PII, keine IP-Speicherung (nur Rate-Limit-Bucket), keine Cookies, keine persistente Speicherung — Daten liegen ausschliesslich in Cloud Logging mit der projektweiten Retention.
- **`functions/src/index.js`**: neue `errors`-Function (europe-west1, 128 MiB, 3 max instances, 10s timeout, public CORS auf `ALLOWED_ORIGINS`).
- **`firebase.json`**: Hosting-Rewrite `/api/errors` → function `errors` (Same-Origin → keine CSP-Aenderung noetig).
- **`public/js/error-logger.js`** (neu): `logClientError(error, context)` sendet anonymisierte Fehler-Metadaten an `/api/errors`. `keepalive:true` damit der Beacon auch beim Tab-Schliessen durchgeht. Fehler des Loggers selbst werden still geschluckt — der User-Flow haengt nie davon ab.
- **`public/js/api.js`**: catch-Block setzt jetzt eine eindeutige `phase` (`image-read` / `image-decode` / `page-hidden` / `client-timeout` / `offline` / `network` / `fetch`) und ruft `logClientError(err, { phase, durationMs, requestId })`. Auch HTTP-Fehler-Responses (>=400) werden mit Phase `http-error` geloggt. UI-Meldungen bleiben identisch.

### Datenfelder (Whitelist, alles optional)

- `errorName` (max 100), `errorMessage` (max 500), `phase` (max 50), `url` Pfad-Teil (max 200), `userAgent` gekuerzt (max 250), `requestId` (max 50)
- `durationMs` (0–600000), `online`, `hidden`

Was NICHT geloggt wird: IPs persistent, Cookies, Bilder, EXIF, GPS, beliebige Header.

### Tests

- Bestandstests werden vor Deploy ausgefuehrt.

### Sonstiges

- Cache-Buster auf `?v=2026051502`.

## [1.8.0] — 2026-05-15

### Behoben — Hosting-Edge-Timeout umgangen

Beobachtet: Bei langsameren Mistral-Antworten (z.B. heute Vormittag um ~30 % erhoehte Latenz) reisst die komplette Pipeline (describe + 2x profile) die 60-Sekunden-Grenze des Firebase-Hosting-Rewrite-Edges. Symptom im Browser: „Server-Fehler" nach ~60–70 s, obwohl die Cloud Function selber sauber mit `status:"ok"` antwortet — der Hosting-Proxy davor kappt die Antwort.

- **`public/js/api.js`**: `ANALYZE_URL` zeigt jetzt direkt auf die Cloud-Run-URL der `analyze`-Function (`https://analyze-5ymhpdpqcq-ew.a.run.app`) statt auf den `/analyze`-Rewrite. Damit greift der Cloud-Run-Function-Timeout (180 s laut `index.js`) statt des Hosting-Edge-Timeouts (~60 s).
- **`firebase.json`**: CSP `connect-src` um die Cloud-Run-URL erweitert, damit der Browser den Cross-Origin-Fetch zulaesst.
- **`e2e/smoke.test.js`**: Route-Pattern auf `**/analyze*` erweitert, damit der Mock weiter greift.
- **CORS** regelt `firebase-functions/v2` bereits automatisch via `cors: ALLOWED_ORIGINS` (`functions/src/index.js`) — keine Anpassung am Backend noetig.

Der bisherige `/analyze`-Rewrite in `firebase.json` bleibt als sanfter Fallback erhalten (wird vom Frontend nicht mehr genutzt). Eine eigene Subdomain `api.malzi.me` statt der unschoenen `.run.app`-URL ist als naechster Schritt vorgemerkt — DNS-Mapping erfolgt direkt von Cloud Run auf IONOS (NICHT ueber Firebase Hosting, sonst zurueck in den Edge-Timeout).

### Tests

- Bestandstests laufen weiter; Smoke-Test-Pattern auf neue URL angepasst.

### Sonstiges

- Cache-Buster auf `?v=2026051501`.

## [1.7.2] — 2026-05-14

### Aufgeraeumt — Gemini-Aera-Reste entfernt

Nach der Pure-Mistral-Umstellung (v1.6.0) waren in Doku und Kommentaren noch veraltete Verweise auf Google Gemini / Vertex AI / Cloud Vision uebrig — teils schlicht falsch (z.B. „faellt automatisch auf Gemini-Fallback zurueck", obwohl es seit v1.6.0 keinen Fallback-Anbieter mehr gibt). Bereinigt:

- **`CONTRIBUTING.md`, `SECURITY.md`, `docs/SETUP.md`, `docs/SELF-HOSTING.md`, `AGENTS.md`** — falsche Multi-Provider-/Fallback-/Vision-API-Aussagen korrigiert. `SECURITY.md`: obsolete `@google-cloud/vision`-Vulnerability-Zeile + Vertex-AI-Vendor-Zeile entfernt, veraltete „Throttle nicht aktiviert"-Notiz auf den v1.7.0-Stand gebracht. Test-Zahlen in `SETUP.md` auf 290 Backend / 141 Frontend aktualisiert.
- **`functions/.env.example`** — verwies auf `VERTEX_LOCATION` / `GCLOUD_PROJECT`, jetzt auf `MISTRAL_API_KEY`.
- **`functions/src/locales/de/prompts.js` + `en/prompts.js`** — Header-Kommentare („Gemini-Prompts", „aus gemini.js") korrigiert; toter Locale-Key `labelVisionLabels` entfernt (wurde seit v1.6.0 nirgends mehr genutzt).
- **`functions/src/__tests__/i18n-guardian.test.js`** — `vision.js` aus der Ausschlussliste entfernt (Datei existiert seit v1.6.0 nicht mehr).
- Verwaiste lokale Artefakte geloescht (`compare-result.html`, `compare-failed-*.txt`, diverse `.DS_Store`).

`CHANGELOG.md` bleibt bewusst unangetastet — alte Eintraege sind historisches Protokoll.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen. Reine Doku-/Kommentar-Bereinigung, keine Funktionsaenderung.

## [1.7.1] — 2026-05-14

### Behoben / Verbessert

- **Wake-Lock gegen Analyse-Abbruch** (`public/js/api.js` + Locales): Eine Analyse kann bis ~3 min dauern. Ging das Geraet in der Zeit in Standby, fror der Browser die Seite ein und die laufende fetch-Anfrage starb — der User sah beim Aufwachen einen Fehler, obwohl der Server fertig gerechnet hatte. Jetzt fordert der Browser waehrend der Analyse einen Screen-Wake-Lock an (Bildschirm bleibt an) und gibt ihn danach wieder frei. Best-Effort: nicht jedes Geraet unterstuetzt die API, und ein manueller Power-Knopf-Druck sperrt weiterhin.
- **Treffende Fehlermeldung bei Standby-Abbruch**: Ging die Seite waehrend des Requests doch in den Hintergrund, zeigt malziME jetzt "Die Analyse wurde unterbrochen, weil das Geraet in den Ruhezustand ging..." (neuer Locale-Key `error.suspended`, de + en) statt eines generischen Netzwerkfehlers.

### Tests

- 290 Backend-Tests + 141 Frontend-Tests gruen.

### Sonstiges

- Cache-Buster auf `?v=2026051404`.

## [1.7.0] — 2026-05-14

### Sicherheit & Stabilitaet — Audit-Massnahmen

Dieses Release setzt die Befunde eines internen Security-, Privacy- und Reliability-Audits (Stand Commit f6d1a47) um. Vier Befunde wurden im Code behoben, jeweils mit Test:

- **REL-01 — Burst-Bremse aktiviert** (`mistral.js` + `throttle.js`): Die Per-Instance-Semaphore aus `throttle.js` war fertig implementiert und getestet, aber nirgends in die Pipeline eingebunden. Jeder Mistral-HTTP-Call laeuft jetzt durch `withMistralSlot` — bei einem Workshop-Burst (viele gleichzeitige Uploads, je 3 Mistral-Calls) warten ueberzaehlige Calls geordnet auf einen freien Slot, statt Mistrals RPS-Limit zu reissen und als `blocked.overloaded` fehlzuschlagen.
- **SEC-02 — XSS-Haertung beim Ergebnis-Rendering** (`public/js/dom.js` + `json-repair.js`): `escapeHtml` escaped jetzt auch Anfuehrungszeichen (`"` / `'`) — die Funktion wird in `render.js` im Attribut-Kontext (`data-key="..."`) verwendet, wo ein nicht-escaptes `"` einen Attribut-Breakout erlaubt haette. Zusaetzlich filtert `applyBounds` Kategorie-Keys serverseitig gegen eine Whitelist (`[a-zA-Z0-9_]`), damit ein prompt-injizierter Modell-Output keinen Key mit Sonderzeichen ins DOM bringen kann (Defense-in-depth).
- **SEC-01 — Admin-Token konstantzeitig vergleichen** (`auth.js` + `handle-admin.js`): Der Bearer-Token-Vergleich nutzte `===` (timing-anfaellig), waehrend der HMAC-Pfad bereits `crypto.timingSafeEqual` verwendete. Neue zentrale `safeCompare`-Funktion in `auth.js`, im Admin-Handler eingesetzt — kein Timing-Seitenkanal mehr aufs Admin-Secret.
- **REL-02 — Kostenbremse-Ausfall wird alarmiert** (`counter.js`): Faellt der Firestore-Stundenzaehler aus, laeuft das System bewusst fail-open weiter — der Zaehler ist aber die einzige globale Kostenbremse fuer Mistral-Calls. Der Fehlerfall wird jetzt als `console.error` mit `alert: "counter-fail-open"`-Marker (statt stillem `console.log`) eskaliert, sodass ein Log-basierter Alert in Cloud Logging anschlagen kann.

Nicht-Code-Befunde des Audits: Das Mistral-Ausgabenlimit (100 EUR/Monat, harte Notbremse) deckt die Kostenseite von REL-02 extern ab. Branch Protection (`enforce_admins=false`) bleibt als bewusster Solo-Entwickler-Trade-off bestehen.

### Tests

- 290 Backend-Tests + 140 Frontend-Tests gruen (neue Tests fuer alle vier Befunde).

### Sonstiges

- Cache-Buster auf `?v=2026051403`.

## [1.6.2] — 2026-05-14

### Behoben

- **Alter inkonsistent zwischen Normal- und Beast-Modus** (Prompts de + en): Bisher nannte die Bildbeschreibung absichtlich kein Alter — sie beschrieb nur die Merkmale, und beide Profil-Anfragen legten das Alter danach jeweils selbst fest. Dadurch kamen sie auf unterschiedliche Werte. Jetzt legt die bildsehende Stufe (Mistral Large 3) die Altersspanne EINMAL fest, beide Profile (Normal + Beast) uebernehmen sie unveraendert. Umgesetzt ueber `describePrompt` + `describeFallback` (Alter wird jetzt explizit geschaetzt) plus neue `ALTER`-Regel in `SCHEMA_RULES`. `AGE_ANCHOR`-Kalibrierung unveraendert. Reiner Prompt-Eingriff, keine zusaetzliche API-Anfrage.

## [1.6.1.1] — 2026-05-14

### Behoben

- **Geschlecht inkonsistent zwischen Normal- und Beast-Modus** (`SCHEMA_RULES` in de + en `prompts.js`): Beide Profile bekommen dieselbe Bildbeschreibung von Large 3 — aber der Beast-Modus (hoehere Temperatur + konfrontativer System-Prompt) interpretierte das Geschlecht teils neu, statt es zu uebernehmen. Neue Regel in `SCHEMA_RULES`: Das Geschlecht steht in der Bildbeschreibung und wird exakt uebernommen — keine Neuinterpretation, keine Aenderung zur dramatischen Wirkung. Greift fuer Normal + Beast. Reiner Prompt-Eingriff, keine zusaetzliche API-Anfrage.

## [1.6.1] — 2026-05-14

### Behoben / Verbessert

Erste Live-Uploads nach dem v1.6.0-Deploy zeigten drei Genauigkeitsschwaechen — alle drei adressiert:

- **Tierart-Erkennung** (`animal.js` + Prompts): Eine orange Langhaarkatze wurde als Hund eingestuft. Zwei Ursachen behoben:
  - `detectAnimalType` nimmt jetzt das **haeufigste** Tier-Stichwort im Beschreibungstext statt des erstbesten in fester Reihenfolge — ein einzeln erwaehnter "Hund" verliert gegen eine mehrfach genannte "Katze".
  - `mistralDescribeAddendum` (de + en) bekam eine Merkmals-Checkliste (Katze: dreieckige Ohren, Schnurrhaare, kurze Schnauze; Hund: laengere Schnauze), damit Mistral die Tierart vor dem Festlegen gezielt prueft.
- **Geschlechts-Kalibrierung** (Prompts): Eine Frau wurde als Mann erkannt. Neuer `GENDER_ANCHOR`-Block in `describePrompt` + `describeFallback` (de + en): Geschlecht zuerst aus echten Gesichtsmerkmalen bestimmen, nicht aus Frisur/Kleidung; "nicht eindeutig erkennbar" nur als Notausgang fuer echt mehrdeutige Faelle erlaubt — nicht als Standardantwort.
- **Bild-Schaerfe** (`public/js/exif.js`): Beim Verkleinern im Browser wird jetzt `imageSmoothingQuality = "high"` gesetzt — das verkleinerte Bild bleibt schaerfer, die KI sieht mehr Details (relevant fuer die Altersschaetzung). Cache-Buster auf `?v=2026051402`.

### Hinweis

Das sind Feinschliff-Massnahmen, kein Allheilmittel — Mistrals Grundgenauigkeit bei Alter/Geschlecht/Tierart bleibt modellbedingt schwankend. Fuer die Workshop-Hauptzielgruppe (Schueler 10–17) ist Mistral laut Evaluierung weiterhin die bessere Wahl als Gemini.

### Tests

- 283 Backend-Tests + 139 Frontend-Tests gruen.

## [1.6.0] — 2026-05-14

### Architektur-Wechsel: Pure-Mistral-only (Vision + Gemini entfernt)

malziME nutzt seit v1.6.0 ausschliesslich **Mistral AI** (Paris, EU) als KI-Anbieter. Google Vertex AI (Gemini) und Google Cloud Vision API sind komplett aus der Pipeline entfernt. Google bleibt nur fuer Firebase Hosting + Cloud Functions + Firestore (alles in `europe-west1`).

**Hintergrund:** v1.5.x hatte Mistral schrittweise neben Gemini eingefuehrt. User-Entscheidung am 2026-05-13: keine weiteren Zwischenversionen — naechster Live-Deploy soll bereits die saubere Mistral-only-Architektur enthalten.

### Entfernt

- **`functions/src/gemini.js`** — komplett geloescht. Vertex AI Gemini wird nicht mehr aufgerufen.
- **`functions/src/vision.js`** — komplett geloescht. Cloud Vision API wird nicht mehr aufgerufen.
- **`functions/src/feature-flags.js`** — komplett geloescht. Provider-Auswahl entfaellt, weil es nur noch einen Provider gibt.
- **`functions/src/__tests__/gemini.test.js`, `vision.test.js`, `feature-flags.test.js`** — komplett geloescht.
- **`@google-cloud/vision`** und **`@google/genai`** aus `functions/package.json` Dependencies entfernt. `package-lock.json` regeneriert.
- **`config.js`:** `DESCRIBE_MODELS`, `PROFILE_MODELS` und weitere nicht mehr genutzte Konstanten raus.
- **`index.js`:** Vertex-AI-bezogene Initialisierung raus (war ohnehin nur noch im Kommentar). `MISTRAL_API_KEY`-Secret-Bindings bleiben.
- **Multi-Provider-Fallback-Chain** in `handle-analyze.js` entfernt — die Pipeline ruft direkt Mistral, ohne Wahllogik.

### Geaendert

- **`functions/src/handle-analyze.js`:** komplett vereinfacht.
  - Keine Vision-API-Vorabverarbeitung mehr — die Pipeline ruft direkt Mistral Large 3 fuer die Bildbeschreibung.
  - SUBJECT-Klassifikation aus der `SUBJECT:`-Kopfzeile in Mistrals Antwort (siehe Prompt-Aenderung unten) entscheidet, ob ein Tier-Easter-Egg oder ein normales Profil generiert wird.
  - Privacy-Risks werden aus dem "Sichtbarer Text:"-Marker in der Mistral-Beschreibung extrahiert.
  - Wenn Mistral fehlschlaegt, gibt es keinen Fallback-Provider — der User bekommt eine `blocked.apiError`- oder `blocked.overloaded`-Response.
- **`functions/src/animal.js`:** komplett umgebaut.
  - `classifyLabels(labels)` -> `classifyDescription(description)`. Parsing der `SUBJECT:`-Zeile (`ANIMAL_ONLY | HUMAN | MIXED | OTHER`). Bei `ANIMAL_ONLY`: zusaetzliches Keyword-Matching im Beschreibungstext, um den konkreten Tier-Typ fuer das Easter-Egg-Profil zu bestimmen.
  - `buildAnimalProfiles(rawLabelsLower, lang)` -> `buildAnimalProfiles(animalType, lang)`. Direkter Tier-Typ-Parameter statt Label-Liste.
  - `AGE_LABELS`-Export entfaellt (gab es zur Vision-API-Label-Filterung — wird nicht mehr gebraucht).
- **`functions/src/privacy.js`:** komplett umgebaut.
  - Neuer Helper `extractVisibleText(description)` parst die `"Sichtbarer Text:"`- bzw. `"Visible text:"`-Zeile aus der Mistral-Antwort.
  - `buildPrivacyRisks({ visibleText, fullDescription })` ersetzt die alte Signatur mit `{ ocrText, labels }`. Adresse + Telefon werden nur auf der "Sichtbarer Text:"-Zeile gesucht (sonst False Positives aus der Prosa), das Kfz-Kennzeichen-Muster laeuft ueber die ganze Beschreibung.
- **`functions/src/locales/{de,en}/prompts.js`:** Der `mistralDescribeAddendum` enthaelt jetzt eine vorgegebene `SUBJECT:`-Kopfzeile zusaetzlich zur bestehenden "Sichtbarer Text:"-Pflicht. Mistral muss die Kopfzeile als allererste Zeile seiner Antwort liefern.
- **`functions/src/__tests__/i18n-guardian.test.js`:** `animal.js` zur Allowlist hinzugefuegt (enthaelt deutsche Keywords als Suchpatterns — kein UI-Text).

### Frontend-Locales

- **`public/locales/de.json` + `en.json`:** `blocked.safetyFilter` und `blocked.safetyFilterFallback` neutralisiert — keine Google-Referenzen mehr (Texte sprechen jetzt von "KI-Anbieter" allgemein).

### Datenschutzerklaerung + Nutzungsbedingungen

- **`public/datenschutz.html`:**
  - Schritt 3 "Was passiert mit meinem Foto?" komplett neu: nur noch Mistral AI als KI-Verarbeiter.
  - "Wer ist beteiligt?"-Tabelle: Vertex AI Gemini-Zeile + Cloud Vision API-Zeile entfernt. Nur Mistral, Firebase Hosting/Functions, Firestore, OpenStreetMap.
  - "Das Rechtliche"-Abschnitt: Mistral AI SAS (Paris) als Auftragsverarbeiter; Google nur noch als Infrastruktur-Partner ohne KI-Zugriff. Verweis auf Mistral DPA + Trust Center.
  - Stand-Datum 13. Mai 2026. Cache-Buster `?v=2026051301`.
- **`public/nutzungsbedingungen.html`:** Abschnitt 5 + 6 (illegale Inhalte, KI-Anbieter) angepasst.

### Dokumentation

- `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `docs/SELF-HOSTING.md`, `SECURITY.md`, `CONTRIBUTING.md` — alle auf Mistral-only-Architektur umgeschrieben. Vision-API-Hinweise + Gemini-Modelle + Multi-Provider-Fallback-Chain-Beschreibungen entfernt.

### Timeouts angehoben (Mistral ist langsamer als Gemini)

Mistral Large 3 braucht laut Tests rund 3,5x so lang wie Gemini 2.5 Flash. Mit der bisherigen Timeout-Kaskade (60s Frontend / 60s Mistral-Call / 90s Backend-Budget / 120s Cloud-Function) waren Frontend-Abbrueche bei langsamen Describes praktisch garantiert. Neue Werte:

- **`MISTRAL_TIMEOUT_MS`** (`functions/src/config.js`): 60s -> **90s**
- **`REQUEST_BUDGET_MS`** (`functions/src/config.js`): 90s -> **120s**
- **`FETCH_TIMEOUT_MS`** (`public/js/api.js`): 60s -> **180s**
- **Cloud-Function `timeoutSeconds`** (`functions/src/index.js`): 120s -> **180s**

Kaskade ist jetzt: Mistral-Call (90s) < Backend-Budget (120s) < Cloud-Function-Hardlimit (180s) = Frontend-Wartezeit. Frontend bricht nicht mehr ab, bevor das Backend fertig sein kann.

### Behoben

- **Kfz-Kennzeichen-Erkennung verbreitert** (`privacy.js`): Der Kennzeichen-Regex lief nur auf der "Sichtbarer Text:"-Zeile. Erwaehnt Mistral ein Kennzeichen nur im Beschreibungs-Fliesstext, ging es verloren. Jetzt scannt das Muster die komplette Beschreibung — das Muster (`X-XX 1234`) ist spezifisch genug, dass das keine False Positives erzeugt.
- **API-Fehler korrekt gelabelt** (`mistral.js`): Ein echter Mistral-API-/Netzwerk-Fehler (HTTP 5xx) wurde stillschweigend als `null` zurueckgegeben und vom Caller faelschlich als `blocked.safetyFilter` ausgewiesen. `tryDescribeWithPrompt` wirft jetzt `code: "api_error"`, `describeImage` propagiert ihn — der User bekommt `blocked.apiError`. Echte leere Antworten bleiben `blocked.safetyFilter`.

### Dev-Tools

- **`functions/scripts/compare-models.js` + `test-prompts.js` geloescht** — waren das Gemini-vs-Mistral-Vergleichstooling, in v1.6.0 funktionslos (haengen an geloeschtem `gemini.js`/`vision.js`).
- **`functions/scripts/test-subject.js` neu** — prueft die v1.6.0-Tiererkennung gegen echte Bilder ohne Deploy: ruft `mistral.describeImage()` + `classifyDescription()` auf und zeigt pro Durchlauf die `SUBJECT:`-Kopfzeile + Einordnung. Siehe `docs/SETUP.md`.

### Tests

- 282 Backend-Tests gruen (vorher 394 in v1.5.3; rueckwirkend weniger weil ganze Test-Suiten fuer entfernte Module weggefallen sind, dann +3 fuer die Behoben-Fixes).
- 139 Frontend-Tests gruen.
- ESLint + Prettier sauber.

### Migrations-Hinweise fuer Self-Hoster

- `MISTRAL_API_KEY` Firebase Secret muss gesetzt sein — siehe `docs/SETUP.md`.
- Cloud Vision API und Vertex AI im Google Cloud Console koennen nach Deploy deaktiviert werden (sparen Kosten).
- Firestore-Doc `featureFlags/current` aus Phase 3/4 wird nicht mehr gelesen — kann manuell geloescht werden, ist aber harmlos wenn es liegen bleibt.

## [1.5.3] — 2026-05-12

### Phase 4 der Mistral-Migration — Auto-Ramp (in v1.6.0 wieder entfernt)

v1.5.3 brachte einen hartcodierten 8-Tage-Auto-Ramp, der den Mistral-Anteil
schrittweise hochfahren sollte. Die Provider-Wahl lief ueber IP-Hash-Sampling
in `feature-flags.js`, mit einer Firestore-Notbremse als Override.

**Der Ramp hat in der Praxis nicht wie gedacht funktioniert.** Das IP-basierte
Sampling ist "sticky" pro IP — bei Workshop-Gruppen hinter einer gemeinsamen
NAT-IP landet die ganze Gruppe im selben Sample-Bucket, also entweder 0 % oder
100 % Mistral, nie ein echter gradueller Ramp. In den Live-Logs kam ueber den
Tag-1-Anteil (1 %) dadurch kein einziger Mistral-Call zustande. Der gesamte
Auto-Ramp-Mechanismus (`MISTRAL_RAMP_*` in `config.js`, `calculateRampPct` +
`feature-flags.js`) wurde in v1.6.0 ersatzlos entfernt.

## [1.5.2] — 2026-05-12

### Verbesserungen (Phase 3 der Mistral-Migration — Feature-Flag + Multi-Provider-Fallback-Chain)

- **`functions/src/feature-flags.js`** neu: liest `aiProvider` aus Firestore-Doc `featureFlags/current` mit 30s Cache, fail-open auf `"gemini"` (Default). Akzeptiert nur `"gemini"` oder `"hybrid"` — ungültige Werte fallen still auf Default zurück. 13 Tests.
- **`functions/src/throttle.js`** neu: per-Instance-Semaphore mit Default-Limit 6 (matched Mistral Scale-Tier RPS). FIFO-Queue mit Timeout, idempotenter Release. Schützt vor Workshop-Bursts. 9 Tests. Noch nicht in mistral.js eingebunden — Aktivierung bei Bedarf in Phase 4.
- **`functions/src/handle-analyze.js`** refaktoriert: zwei neue Helper `runDescribeStage` und `runProfileStage` realisieren die Multi-Provider-Fallback-Chain:
  - **Stage 1 Describe:** bei `aiProvider="hybrid"` zuerst Mistral, dann Gemini als Fallback, dann Vision-Labels-Heuristik
  - **Stage 2 Profile:** analog Mistral → Gemini
  - **Default-Pfad `aiProvider="gemini"`:** verhalten unveraendert, ruft nur Gemini-Funktionen
- **`functions/src/index.js`** deklariert `MISTRAL_API_KEY` via `defineSecret` und bindet das Secret an die `analyze`-Function. Secret wird erst beim ersten Hybrid-Provider-Call gelesen — der Default-Pfad braucht den Key nicht.
- **`functions/src/__tests__/index.test.js`** um 8 Phase-3-Tests erweitert: alle Fallback-Pfade (Mistral OK, Mistral→Gemini, Mistral+Gemini→Vision-Labels, alles versagt, Default-Flag bleibt Gemini-only).
- **356 Backend-Tests** alle gruen (vorher 326, +30 neu in Phase 3: 13 feature-flags + 9 throttle + 8 fallback-chain).

### Wichtig

- **Live-Verhalten bleibt unveraendert.** Default-Flag-Wert ist `"gemini"`, Firestore-Doc `featureFlags/current` existiert nicht, Default greift. Die Live-Pipeline ruft weiterhin ausschliesslich Gemini-Funktionen wie bisher.
- **Aktivierung erst in Phase 4** durch Setzen des Firestore-Docs auf `{ aiProvider: "hybrid" }`. Rueckschalten durch `{ aiProvider: "gemini" }` — beide Pfade sind ueber denselben Code-Pfad jederzeit waehlbar.
- **`MISTRAL_API_KEY` Firebase Secret ist gesetzt** (Version 1 in Secret Manager) — wartet auf den ersten Hybrid-Call der ihn liest.

## [1.5.1] — 2026-05-12

### Verbesserungen (Phase 2 der Mistral-Migration — dormanter Schatten-Code)

- **`functions/src/json-repair.js`** neu (~310 Zeilen): provider-agnostische 4-stufige JSON-Reparatur-Schicht.
  - Stufe 1: direkter `JSON.parse`
  - Stufe 2: heuristisches Cleanup (Markdown-Fencing, Smart-Quotes, Trailing-Commas, Control-Char-Escape, Inner-Quote-Escape)
  - Stufe 3: `json5.parse` als toleranter Backup
  - Stufe 4: Truncation-Recovery via Stack-Snapshot — findet letzten sauber geschlossenen Wert, schließt offene Brackets programmatisch
  - Output-Bounds (SEC-004) integriert
- **`functions/src/mistral.js`** neu (~260 Zeilen): Mistral-Provider mit derselben Schnittstelle wie `gemini.js`. Hybrid-Architektur (Large 3 Describe → Small 4 Profile-Generation), Fallback auf Voll-Large 3 bei Small-4-Failure, JSON-Repair-Layer integriert. API-Key kommt ausschliesslich aus `process.env.MISTRAL_API_KEY`.
- **`functions/src/config.js`** um Mistral-Konstanten erweitert (Modelle, Endpoint, Pricing, Timeouts) — backward-compatible.
- **`mistralDescribeAddendum`** in `de/prompts.js` und `en/prompts.js` — der Zusatz-Prompt der Mistral anweist, Bild-Text in die Beschreibung zu integrieren (kein separater Vision-Schritt).
- **`json5` ^2.2.3** als Production-Dependency in `functions/package.json`.
- **57 neue Tests** (`json-repair.test.js` 34, `mistral.test.js` 22, `config.test.js` +1) — Backend-Test-Suite jetzt bei 326 Tests, alle gruen.
- **Test-Fixtures** aus den realen Mistral-Failures vom 12.05. (`compare-failed-mistral-large-3-*.txt`) zur Verifikation des JSON-Repair-Layers.

### Wichtig

- **Live-System unverändert**: weder `handle-analyze.js` noch `gemini.js` importieren die neuen Module. Der Code ist dormant und wird erst in Phase 3 (Feature-Flag + Multi-Provider-Fallback) aktiviert. Deploy ist daher rein additiv ohne Verhaltens-Aenderung in Produktion.

## [1.5.0] — 2026-05-12

### Verbesserungen (Phase 1 der Mistral-Migration)

- **Prompt-Haertung mit zwei neuen Bloecken** in `functions/src/locales/de/prompts.js` und `functions/src/locales/en/prompts.js`:
  - **`AGE_ANCHOR`** — kalibriert Altersschaetzung in zwei Richtungen:
    - **Primaere Achse Koerperproportionen**: Schultern-zu-Kopf-Verhaeltnis und Handgroesse entscheiden zuerst die Spanne (Kind 2-10 J / Pre-Teen-Teen 10-15 J / Teen-Jung-Erwachsen 15-22 J), Hautmerkmale verfeinern danach. Verhindert, dass Make-up, Frisur oder Kleidung die Reife jugendlicher Gesichter nach oben verzerren.
    - **Zwangs-Mapping fuer Erwachsene** mit Mindest-Alter pro sichtbarem Merkmal (Nasolabialfalten ≥38 J, Lid-Erschlaffung ≥45 J, Pigmentflecken Haende ≥45 J, etc.). Kombinations-Regel: drei oder mehr Merkmale gleichzeitig → Pflicht-Spanne 40-55 J, egal wie jung das Gesamtbild wirkt. Adressiert systematische Unterschaetzung von Erwachsenen, die im Alltag oft juenger geschaetzt werden.
    - **Begruendungspflicht**: Wenn das Modell trotz sichtbarer Merkmale juenger schaetzen will, muss es im Beschreibungstext explizit erklaeren, warum das Merkmal NICHT sichtbar ist.
  - **`SCHEMA_RULES`** — Laengen-Vorgaben und Format-Saeuberung in beiden Profil-Schemas:
    - Pro Kategorie 3-5 Saetze, ca. 50-80 Woerter (statt unbegrenzt mit Mindest-30-Woerter).
    - `ad_targeting` jetzt 6-8 Eintraege a 1-3 Woerter (statt 8-12 mit unklarem Limit).
    - `manipulation_triggers` max. 30 Woerter pro Eintrag (statt mindestens 15 ohne Obergrenze).
    - `profileText` Normal max. 100 Woerter, Boost max. 150 Woerter (statt 5-8 bzw. 10-15 Saetze ohne Hard-Cap).
    - **Keine Preisangaben** in `ad_targeting`/`werbeprofil`/`kaufkraft` — nur Marken-, Produkt- oder Modellnamen (Einkommens-Spannen bleiben bei `einkommen` erlaubt).
    - **Reines JSON** ohne Markdown-Wrapping, keine \`\`\`json-Codebloecke, keine erklaerenden Saetze drumherum.
  - Beide Bloecke werden an `describePrompt`, `describeFallback`, `jsonSchemaNormal` und `jsonSchemaBoost` angehaengt (Doppelsicherung: Modell sieht Anker sowohl in der Bildbeschreibungs-Phase als auch in der Profil-Phase).
- **Konflikt-Aufloesung im Schema**: Alte Live-Regel `ad_targeting: 8-12 Eintraege` wurde durch `6-8 Eintraege a 1-3 Woerter` ersetzt; alte `manipulation_triggers: mindestens 15 Woerter` durch `1-2 Saetze, maximal 30 Woerter`; alte `profileText Normal: 5-8 Saetze` durch `max 100 Woerter`; alte `profileText Boost: 10-15 Saetze` durch `max 150 Woerter, etwa 8-10 Saetze`. So widersprechen sich die neue Vorgabe und die alte Anweisung nicht mehr im selben Prompt.
- **`functions/scripts/test-prompts.js` als Pass-Through**: Frueher hat dieses Script die Anker zusaetzlich zu den Live-Prompts angehaengt — jetzt liegen die Anker direkt in den Live-Prompts, daher ist `test-prompts.js` nur noch ein 1:1-Re-Export der Live-Prompts. Verhindert, dass `compare-models.js` doppelte Anker anwendet.

### Beobachtete Effekte aus Spot-Test (Mädchen 14 J)

- **Kosten Gemini Live**: $0,0214 → $0,0187 (-12,6 %)
- **Kosten Hybrid (Large 3 + Small 4)**: $0,0093 → $0,0083 (-10,7 %)
- **Token-Output**: Profile sind knapper und kompakter, `ad_targeting` reduziert auf 7-8 saubere Eintraege.
- **Alters-Genauigkeit**: bei diesem konkreten Bild keine Verbesserung — die Schultern-zu-Kopf-Proportion war bereits adult-aehnlich und der Anker ordnet das korrekt in 18-22 J ein. Anker zeigt erwartbare Wirkung bei klar erwachsenen Personen, die im Alltag juenger geschaetzt werden (Zwangs-Mapping greift dort).
- **JSON-Parsefehler**: keine, beide Anbieter.
- **269 Backend-Tests** weiterhin gruen.

## [1.4.0] — 2026-05-11

### Wartung (zukunftssichernd)

- **SDK-Migration auf `@google/genai` 2.0.1**: Die alte `@google-cloud/vertexai` SDK (1.12.0) wird am 24.06.2026 von Google entfernt. Komplettes Refactor von `functions/src/gemini.js` auf die neue, einheitliche Gen-AI-SDK:
  - `new VertexAI({ project, location })` → `new GoogleGenAI({ vertexai: true, project, location })`
  - `vertexAI.getGenerativeModel({...}).generateContent({...})` → `genai.models.generateContent({ model, contents, config })`
  - Response-Struktur: Verschachteltes `response.response.candidates` wird flach zu `response.candidates`.
  - `generationConfig` + `safetySettings` jetzt zusammen unter `config`.
  - Verhalten bleibt identisch — gleicher Output-Parser, gleiche Fehler-Klassifikation, gleiche Modelle (`gemini-2.5-flash` + `gemini-2.0-flash-001` Fallback).
  - 269 Backend-Tests gruen. Tests-Mocks von alter auf neue SDK-Surface umgestellt.
  - `setGenAIForTest()` als zusaetzlicher Export fuer einfacheres Mocking.
- **gitleaks-action auf Node.js 24 vorgezogen**: ENV-Variable `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` im `secret-scan`-Job. GitHub forced ab 02.06.2026 ohnehin Node 24; mit dem Override verschwindet die Deprecation-Warnung schon jetzt aus den CI-Logs. Action-Version auf `v2.3.9` gepinnt (Latest).

## [1.3.2] — 2026-05-11

### Verbesserungen

- **Profil-Schemas geschaerft**: Vier zusaetzliche Regeln in `jsonSchemaNormal` und `jsonSchemaBoost`, damit Gemini-Modelle sich strenger an die Vorgaben halten — speziell juengere Modelle wie `gemini-3.1-flash-lite` neigten sonst zu pauschalen Stichworten und persoenlichen Spekulationen ohne Bildbezug.
  - **Belegpflicht**: Jede Aussage muss durch ein konkretes, sichtbares Element aus der Bildbeschreibung gedeckt sein. Element wird wortwoertlich zitiert. Wo das Bild keinen Beweis liefert, schreibt das Modell jetzt explizit "Hierzu sind keine sichtbaren Hinweise vorhanden" statt zu spekulieren.
  - **Mindestlaenge pro Kategorie**: Mindestens 2 vollstaendige Saetze, ~30 Woerter. Knappe Etiketten wie "Du bist mitteleuropaeisch." sind nicht mehr zulaessig.
  - **Manipulation-Trigger als Fliesstext**: Bisher generierten kleinere Modelle nur Stichworte ("Statusangst durch Vergleich"). Jetzt sind 4-6 ausformulierte Saetze mit mindestens 15 Woertern pro Eintrag und konkretem Bildbezug vorgeschrieben — inkl. Beispiel-Eintrag und Negativ-Beispiel im Prompt.
  - **Boost-Tonalitaet fokussiert**: Boost-Modus richtet die Haerte jetzt explizit gegen das System (Algorithmen, Konzerne, Marketing) statt persoenlich gegen die Person. Persoenliche Bewertungen bleiben erlaubt, aber nur mit klarem Bildbeleg — Pauschalbeleidigungen ("Mitlaeufer", "wandelndes Klischee") sind verboten.

### Tooling

- **Neues Dev-Tool `functions/scripts/compare-models.js`**: Lokales Side-by-Side-Skript zum Vergleichen verschiedener Gemini-Modelle (z.B. 2.5 Flash vs 3.1 Flash-Lite) mit dem gleichen Bild. Faehrt die komplette malzime-Pipeline (Vision API + Beschreibung + Normal-Profil + Boost-Profil) parallel mit beiden Modellen, miss Tokens und Kosten und erzeugt einen HTML-Vergleichsbericht. Schreibt nicht in Firestore, beruehrt das Live-System nicht. Anleitung in `docs/SETUP.md`.
- **Vergleichsbericht-Output ausgeschlossen**: `compare-result.html` ist in `.gitignore` aufgenommen — der Bericht enthaelt Test-Bilder und generierte Profile, die nicht ins oeffentliche Repo gehoeren.

### Wartung

- **Backend-Dependencies aktualisiert**: `@google-cloud/vision` 5.3.5 → 5.3.6, `firebase-admin` 13.8.0 → 13.9.0, `jest` 30.3.0 → 30.4.2, `eslint` 10.2.1 → 10.3.0. Alle 269 Backend-Tests bleiben gruen.
- **Frontend-Dependencies aktualisiert**: `vitest` + `@vitest/coverage-v8` 4.1.4 → 4.1.5, `jsdom` 29.0.2 → 29.1.1, `eslint` 10.2.1 → 10.3.0. Alle 139 Frontend-Tests bleiben gruen.
- **firebase-tools CLI aktualisiert**: 15.5.1 → 15.17.0 (global via `npm install -g firebase-tools@latest`).

## [1.3.1] — 2026-04-19

### Sicherheit

- **protobufjs RCE gefixt (CRITICAL)**: `protobufjs` auf 7.5.5 aktualisiert — schliesst Arbitrary-Code-Execution-Luecke (GHSA-xq3m-2v4x-88gg), die transitiv ueber `@google-cloud/firestore` + `@google-cloud/vision` + `firebase-admin` in die Cloud Functions gelangte.
- **Weitere High-Luecken gefixt**: `node-forge` 1.3.3 → 1.4.0 (Signature Forgery, DoS), `path-to-regexp` 0.1.12 → 0.1.13 (ReDoS), `fast-xml-parser` (Entity Expansion Bypass).
- **CI-Audit-Schwelle strenger**: `npm audit --audit-level` von `critical` auf `high` angehoben. Hohe Schwachstellen (z. B. ReDoS, Signature Forgery) werden jetzt in der CI sichtbar gemacht statt unbemerkt durchzurutschen.

### Wartung

- **Backend-Dependencies aktualisiert**: `@google-cloud/vertexai` 1.10.0 → 1.12.0, `@google-cloud/vision` 5.3.4 → 5.3.5, `firebase-admin` 13.7.0 → 13.8.0, `firebase-functions` 7.0.6 → 7.2.5, `jest` 30.2.0 → 30.3.0, `eslint` 10.0.2 → 10.2.1, `prettier` 3.8.1 → 3.8.3.
- **Frontend-Dependencies aktualisiert**: `vitest` + `@vitest/coverage-v8` 4.0.18 → 4.1.4, `@playwright/test` 1.58.2 → 1.59.1, `jsdom` 28.1.0 → 29.0.2 (Major-Bump, alle 139 Frontend-Tests bleiben gruen), `eslint` 10.0.0 → 10.2.1, `prettier` 3.8.1 → 3.8.3.

### Ops

- **Branch Protection fuer `main`**: Required Status Checks aktiv fuer `test-backend`, `test-frontend`, `test-e2e` und `secret-scan`. Dependabot-Auto-Merge greift jetzt nur noch bei nachweislich gruener CI. `strict=true` (Branch muss up-to-date sein), `allow_force_pushes=false`, `allow_deletions=false`.

## [1.3.0] — 2026-03-07

### Neu

- **Englische Uebersetzung**: Komplette i18n-Unterstuetzung fuer Englisch — UI-Texte, Gemini-Prompts, Tier-Profile und Schemas. Sprache wird automatisch ueber Browser-Sprache oder `?lang=en` URL-Parameter gewaehlt. Beitrag von [@MechanikGamer](https://github.com/MechanikGamer) (PR #11, Issue #4).

## [1.2.10] — 2026-02-27

### Verbesserungen

- **Modus-spezifische Profil-Schemas**: `jsonSchema` in zwei getrennte Schemas aufgeteilt (`jsonSchemaNormal` + `jsonSchemaBoost`). Beide haben identische JSON-Struktur und Keys, aber komplett unterschiedliche Feld-Anweisungen:
  - **Normal-Modus**: Sachlich-nüchtern wie ein echtes Scoring-System. Persoenlichkeit als psychometrische Einordnung (Big-Five-Stil), Verletzlichkeit als systemischer Risikobericht, Profiltext 5-8 Saetze nüchtern-analytisch.
  - **Beast Mode**: Zynisch-spöttisch und exploitativ. Persoenlichkeit als psychologische Angriffsflaeche, Verletzlichkeit als Algorithmus-Schwachstellenanalyse, Profiltext 10-15 Saetze mit scharfen Ueberzeichnungen.
  - **Widerspruch behoben**: Normal-System-Prompt sagte "5-8 Saetze sachlich", geteiltes Schema sagte "10-15 Saetze konfrontativ" — jetzt modusspezifisch korrekt.
- **buildPrompt erweitert**: Akzeptiert jetzt Schema als 7. Parameter statt es intern aus dem Prompt-Modul zu laden. `generateBothProfiles` uebergibt das jeweils passende Schema pro Modus.

### Tests

- **Testabdeckung**: 269 Backend + 139 Frontend = 408 Tests
- **Neue Tests**: Schema-Konsistenz-Pruefung (beide Schemas haben identische JSON-Keys), Schema-Differenzierung in buildPrompt

## [1.2.9] — 2026-02-27

### Bugfixes

- **Altersschaetzung bei Erwachsenen 25+ (umfassende Ueberarbeitung)**: Personen ueber 25 wurden systematisch zu jung geschaetzt — oft 10 Jahre daneben. Drei Ursachen identifiziert und behoben:
  - **Fehlende Alterungsmerkmale:** Beschreibungs-Prompts (describePrompt + describeFallback) massiv erweitert um: Jowls/Haengewangen, Marionetten-Linien, Oberlid-Erschlaffung, Lippenvolumen-Verlust, Porengröße, Handvenen-Sichtbarkeit, Hautverdünnung/-transparenz, Sehnen-Sichtbarkeit, Halsbaender, Dekollete-Textur, Ergrauungs-Prozentanteil, Augenbrauen-Ausdünnung, Haarstruktur-Veraenderungen. Haende und Hals explizit als zuverlaessigste Indikatoren hervorgehoben.
  - **Kalibrierungs-Anker:** Neue Zuordnungs-Skala in allen 4 Prompts: Glatte Haut = unter 25, erste Linien = 28-35, deutliche Falten + Volumenverlust = 35-45, Jowls + Halsfalten + Lid-Erschlaffung = 45-55, tiefe Falten + Hautverdünnung = 55+. Gibt dem Modell eine Referenz statt vage Merkmale.
  - **Anti-Hoeflichkeits-Bias:** Explizite Anweisung in Beschreibungs- und System-Prompts: "Alterungsmerkmale ehrlich beschreiben ist KEINE Beleidigung — systematisches Juenger-Schaetzen ist ein Messfehler." Gemini tendiert dazu, schmeichelhaft zu sein — das wird jetzt direkt adressiert.
  - **Differenzierte Makeup-Regel:** Bei jugendlich Wirkenden weiterhin streng getrennt (Kinderschutz). Bei eindeutig Erwachsenen sind Mode und Stil jetzt legitime Alters-Indikatoren.

## [1.2.8] — 2026-02-24

### Verbesserungen

- **Altersangepasste Sprache**: Profile passen Wortwahl und Ton automatisch an das geschaetzte Alter an. Jüngere Personen bekommen einfachere Sprache ohne Fremdwoerter, aeltere sachlich-analytische Formulierungen. Untergrenze ist das Sprachniveau fuer 10-14-Jaehrige — darunter wird nicht vereinfacht. Inhalt und Schaerfe bleiben in jeder Altersstufe gleich, nur die Verpackung aendert sich. Betrifft beide Modi (Normal + Beast Mode).
- **Beast Mode: Erweiterte Eigenschafts-Palette**: Negative Charaktereigenschaften und Schwaechen von ~30 auf ~100 Begriffe erweitert, geordnet in 8 Kategorien (Psyche, Soziales, Sucht/Laster, Gesundheit, Finanzen, Beziehung, Beruf, Weltbild). Jede Eigenschaft wird aus sichtbaren Merkmalen im Bild abgeleitet — nichts wird erzwungen. Profile sind dadurch abwechslungsreicher und schaerfer.
- **Beast Mode: Geschaerfte Profilfelder**: Gesundheit umfasst jetzt auch psychische Gesundheit, Suchtverhalten und Essmuster. Verletzlichkeiten werden konkreter statt abstrakt formuliert. Der Profiltext benennt explizit unangenehme Wahrheiten ueber Gewohnheiten — aber nur wenn das Bild Anhaltspunkte liefert.
- **Beast Mode: Ton-Schaerfung**: Texte jetzt explizit zynisch, spoettisch und unterhaltsam — scharf treffen aber auch Spass machen zu lesen.
- **Normal-Modus: Erweiterte Eigenschafts-Palette**: Charaktereigenschaften von ~25 auf ~145 Begriffe massiv erweitert, geordnet in 8 Kategorien mit jeweils Staerken UND Schwaechen. Ausgewogenes Scoring wie ein echtes Profiling-System — nicht einseitig negativ. Kategorien: Psyche, Soziale Kompetenz, Gewohnheiten/Lebensstil, Gesundheit, Finanzverhalten, Beziehung, Beruf/Leistung, Weltbild/Denkweise.

## [1.2.7] — 2026-02-24

### Features

- **Nutzungsbedingungen**: Neue Unterseite `/nutzungsbedingungen` mit 12 Abschnitten (Geltungsbereich, erlaubte/verbotene Nutzung, Zielgruppe, Workshops, Haftung, Geistiges Eigentum, Recht/Gerichtsstand, Kontakt). SEO-optimiert mit canonical URL, Open Graph Tags und Sitemap-Eintrag.

### Dokumentation

- **Footer aktualisiert**: Nutzungsbedingungen-Link auf allen 5 Seiten (Startseite, Impressum, Datenschutz, Nutzungsbedingungen, Stats) eingefuegt
- **Sitemap**: Neue URL `https://malzi.me/nutzungsbedingungen` hinzugefuegt
- **Firebase Routing**: Clean-URL Rewrite `/nutzungsbedingungen` → `/nutzungsbedingungen.html`
- **i18n**: Neuer Locale-Key `footer.nutzungsbedingungen`

## [1.2.6] — 2026-02-23

### Bugfixes

- **Stats-Zaehler setzen sich um Mitternacht zurueck**: Tages-, Wochen-, Monats- und Jahreszaehler auf der Stats-Seite zeigten nach Mitternacht weiterhin die alten Werte — bis zum naechsten Upload. `getStats()` vergleicht jetzt die gespeicherten Datums-Keys live mit dem aktuellen Wiener Datum und gibt 0 zurueck wenn sie nicht mehr passen. Kein Cron-Job noetig.
- **Zeitzone Europe/Vienna**: Alle Datums-Keys (Tag, Woche, Monat, Jahr) werden jetzt in oesterreichischer Lokalzeit berechnet — inkl. automatischer Sommer-/Winterzeit-Umstellung. Vorher wurde UTC verwendet, was dazu fuehrte dass der Tageswechsel um 01:00 (Winter) bzw. 02:00 (Sommer) statt um Mitternacht stattfand.

### Tests

- **Testabdeckung**: 266 Backend + 139 Frontend + 2 E2E = 407 Tests
- **getDateKeys**: 6 neue Tests (Format, Montag-Berechnung, Vienna-Zeitzone)
- **getStats Live-Reset**: 4 neue Tests (stale todayDate/weekStart/monthKey/yearKey → 0)

## [1.2.5] — 2026-02-22

Accessibility-Verbesserungen, Hardening und Test-Ausbau.

### Accessibility

- **Focus-Management nach Analyse**: Nach dem Schliessen des Disclaimer-Modals wird der Focus auf das Ergebnis-Panel gesetzt statt auf dem verschwundenen Button zu verbleiben
- **Fehlermeldungen als `role="alert"`**: Status-Meldungen bekommen dynamisch `role="alert"` fuer robustere Screenreader-Ankuendigung bei Fehlern
- **Screenreader-Ankuendigungen**: Analyse-Start und -Ende werden per `aria-live="assertive"` Live-Region angekuendigt ("Analyse gestartet" / "Analyse abgeschlossen"). Visuelle Zwischentexte bleiben nur visuell
- **SR-Only CSS-Klasse**: Neue `.sr-only` Utility-Klasse (opacity-basiert fuer Safari/VoiceOver-Kompatibilitaet)

### Bugfixes

- **Timeout-Cleanup gemini.js**: `clearTimeout` wird jetzt per `try/finally` um `Promise.race` in `describeImageWithModel()` immer ausgefuehrt — auch wenn die API-Promise rejectet. Behebt einen Timer-Leak bei Fehlerantworten

### Hardening

- **SITE_URL statt ALLOWED_ORIGINS[0]**: ntfy-Admin-Links verwenden jetzt eine eigene `SITE_URL`-Konstante statt der ordnungsabhaengigen ersten CORS-Origin
- **E2E-Tests in CI**: Playwright Smoke-Tests laufen jetzt im GitHub Actions Workflow (neuer `test-e2e` Job)
- **test-results/ in .gitignore**: Playwright-Artefakte verschmutzen nicht mehr den Worktree

### Tests

- **E2E Smoke-Tests (Playwright)**: 2 Smoke-Tests — Demo-Flow (Seite laden → Demo-Klick → Disclaimer → Profil gerendert) und fehlerfreies Laden. API-Calls gemockt
- **Testtiefe upload.js erweitert**: 7 neue Edge-Case-Tests (Multipart-Parsing, Charset-Varianten, Request-Abort, leere Datei)
- **Testtiefe gemini.js erweitert**: 13 neue Integration-Tests mit gemocktem Vertex AI (describeImage Fallback/Quota, generateBothProfiles Schema-Validierung/Markdown/Truncation, isQuotaError)
- **Testtiefe ui.js erweitert**: 11 neue Tests (role="alert" a11y, srAnnounce Start/Ende, Limit-Banner, Maintenance-Modal)
- **Testtiefe handle-stats.js**: 5 neue Tests (405 bei POST, 503 bei Ausfall, Maintenance-Flag)
- **Testabdeckung**: 256 Backend + 139 Frontend + 2 E2E = 397 Tests

## [1.2.4] — 2026-02-22

Wartungsmodus-Modal, Prompt-Verbesserungen und Backend-Hardening.

### Features

- **Wartungsmodus-Modal**: Neues rotes Warn-Modal mit Blur-Hintergrund blockiert die gesamte Seite im Wartungsmodus. Focus-Trap (nur Reload-Button erreichbar), `role="alertdialog"`, rote Scan-Lines und pulsierendes Warn-Icon. Aktivierung per Admin-API (`POST /api/admin/maintenance`) oder automatisch bei 503-Response
- **Maintenance-Check beim Seitenstart**: Die Hauptseite prueft beim Laden via `/api/stats` ob der Wartungsmodus aktiv ist und zeigt sofort das Modal

### Verbesserungen

- **Ethnizitaets-Erkennung verbessert**: Bildbeschreibungs-Prompt enthaelt jetzt eine explizite Hauttöne-Skala (very fair bis very dark brown), detaillierte Gesichtszug-Merkmale (Nasenform, Augenform, Kieferlinie, Jochbein) und differenzierte Haarstruktur-Begriffe (straight/wavy/curly/coiled/kinky). Verhindert fehlerhafte Zuordnungen bei suedasiatischen, nahöstlichen und anderen nicht-europaeischen Personen
- **Altersschaetzung bei gestylten Jugendlichen verbessert**: Bildbeschreibungs-Prompt trennt jetzt Makeup/Styling explizit von natuerlichen Gesichtszuegen. Zusaetzlich werden Koerperproportionen beschrieben die Schminke nicht veraendert (Handgroesse, Handgelenke, Schulterbreite, Kopf-zu-Koerper-Verhaeltnis). Profil-Prompts ignorieren kosmetische Reife bei der Altersschaetzung — Knochenstruktur und Entwicklungsstand zaehlen
- **Einkommensschaetzung kalibriert**: Alle Prompts orientieren sich jetzt am oesterreichischen Lohnniveau mit konkreten Referenzwerten (Studierende 400-1.200€, Median aller Erwerbstaetigen 2.700€ brutto, Durchschnitt 3.100€ brutto, Median Vollzeit 3.900€ brutto) statt an US-amerikanischen Gehaeltern
- **Herkunfts-Ableitung praezisiert**: Ethnische Herkunft wird ausschliesslich aus Hautton, Gesichtszuegen und Haarstruktur abgeleitet — der Hintergrund/Ort im Bild wird explizit ignoriert (Person kann im Urlaub sein)

### Bugfixes

- **Upload-Limit korrigiert**: Frontend zeigte "max 20 MB" an, Backend akzeptierte aber nur 6 MB. Upload-Hint, Fehlermeldung und JS-Check auf 6 MB angeglichen
- **ntfy-Links Self-Hosting-tauglich**: Admin-URLs in ntfy-Benachrichtigungen (Boost, Reset, Stats) kommen jetzt aus `domains.js` statt einer hardcodierten Domain. Self-Hosted-Instanzen bekommen korrekte Links

### Sicherheit

- **Accepted Risks dokumentiert**: Fail-open-Verhalten bei Firestore-Ausfaellen (Counter + Nonce) und `minimatch` ReDoS in Vision-API-Abhaengigkeitskette als akzeptierte Risiken in `SECURITY.md` dokumentiert mit Begruendung und Mitigations

### Tests

- **Testabdeckung**: 222 Backend + 128 Frontend = 350 Tests

## [1.2.3] — 2026-02-22

Demo-Bilder, UX-Verbesserungen und Code-Cleanup.

### Verbesserungen

- **Neue Demo-Fotos**: Café- und Wanderer-Demobild durch neue Stock-Fotos ersetzt (mit eingebetteten Fake-EXIF-Daten fuer Workshops)
- **Scroll nach Analyse**: Nach Klick auf den Disclaimer-Hinweis scrollt die Seite automatisch nach oben zum Ergebnis — besonders wichtig bei Demo-Bildern am Seitenende
- **Demo-Thumbnail-Zuschnitt**: Café-Thumbnail zeigt jetzt den Kopf statt der Mitte (`object-position: top`)
- **Stats-Footer bereinigt**: Ueberfluessigen „Startseite"-Link aus dem Stats-Footer entfernt

### Code-Cleanup

- **demo-data.js entfernt**: Vorgeschriebene Demo-Profile waren toter Code — das Frontend schickt Demo-Bilder durch die echte KI-Analyse, nicht durch vorgeschriebene Profile. Server-seitiger Demo-Pfad, Tests und Dokumentation bereinigt
- **Test-Coverage-Scripts**: `npm run test:coverage` (Backend) und `npm run test:frontend:coverage` (Frontend) hinzugefuegt
- **Testabdeckung**: 187 Backend + 126 Frontend = 313 Tests

### Dokumentation

- **Sitemap aktualisiert**: Stats-Seite hinzugefuegt, lastmod-Daten aktualisiert
- **README-Screenshots erneuert**: Aktuelle Startseite mit neuen Demo-Bildern
- **README + SETUP.md aktualisiert**: Fehlende Module ergaenzt (counter, auth, notify, stats), Testanzahlen korrigiert, Security-Sektion erweitert, veraltete Demo-Referenzen entfernt

## [1.2.2] — 2026-02-21

Externer Code-Review: 5 Bugfixes + 3 Hardening-Massnahmen.

### Sicherheit

- **SEC-001: Admin-Aktionen nicht mehr per GET ausfuehrbar**: ntfy-Buttons oeffnen jetzt eine Bestaetigungsseite (GET) — die eigentliche Mutation passiert erst per POST mit kurzlebiger Nonce (5 Min gueltig). Schuetzt gegen Link-Prefetcher, CSRF und versehentliche Bot-Zugriffe
- **SEC-002: HMAC-Amount kann nicht mehr manipuliert werden**: Boost ueber HMAC/Nonce immer fest 100. Benutzerdefinierte Betraege nur noch per Bearer-Auth (POST body)
- **SEC-003: Prompt-Injection via XML-Tags verhindert**: Alle dynamischen Inhalte in Gemini-Prompts werden jetzt per `escapeXml()` bereinigt — `<`, `>`, `&`, `"`, `'` werden escaped

### Bugfixes

- **BUG-001 (P0): Counter zaehlt erst nach Validierung**: `checkAndIncrement()` wurde von vor den Validierungen nach die Magic-Byte-Pruefung verschoben. Honeypot-Treffer, Demo-Requests und ungueltige Uploads verbrauchen jetzt kein Stundenlimit mehr
- **BUG-002: getStats() ist jetzt read-only**: Fire-and-forget Cleanup-Write aus dem Stats-Endpunkt entfernt. Cleanup passiert nur noch in `checkAndIncrement()` — keine Race Conditions mehr
- **BUG-003: Admin funktioniert auf leerer Datenbank**: `update()` durch `set({merge: true})` ersetzt in `boostLimit()` und `resetCounter()` — erstellt Dokument wenn noetig
- **BUG-004: Confidence 0 wird korrekt angezeigt**: `cat.confidence || 0.5` durch `typeof`-Check ersetzt — JavaScript-Falsy-0-Bug behoben

### Tests

- **24 neue Backend-Tests**: BUG-001 Counter-Validierung (6), SEC-001 Nonce-Flow (5), SEC-002 HMAC-Amount (2), Nonce-Auth (5), BUG-002 Read-only Stats (1), SEC-003 XML-Escaping (5)
- **1 neuer Frontend-Test**: BUG-004 Confidence-Zero
- **Testabdeckung**: 210 Backend + 126 Frontend = 336 Tests

## [1.2.1] — 2026-02-21

### Sicherheit

- **HMAC-basierte Admin-Tokens**: ntfy-Action-URLs enthalten keine Klartext-Secrets mehr — stattdessen kurzlebige HMAC-SHA256-signierte Tokens (30 Min gueltig, aktionsgebunden, timing-safe)
- **Admin CORS-Whitelist**: Admin-Endpunkte verwenden jetzt dieselbe Domain-Whitelist wie der Analyse-Endpunkt (statt `cors: true`)
- **Boost-Cap**: Maximaler Boost auf 500 begrenzt (statt 10.000)
- **HTML-Escaping**: Admin-Bestaetigungsseite escaped jetzt alle dynamischen Werte
- **ADMIN_SECRET rotiert**: Neues Zufalls-Secret gesetzt

### Bugfixes

- **Counter-Cleanup**: `getStats()` schreibt veraltete `recentAnalyses`-Eintraege zurueck nach Firestore (verhindert unbegrenztes Wachstum)
- **Demo-Daten Privacy**: GPS-Koordinaten und `dateTimeOriginal` aus Server-seitigen Demo-Exif-Daten entfernt — widerspricht sonst der Privacy-Architektur
- **stats.js i18n**: Alle hardcoded deutschen Strings durch `t()`-Aufrufe ersetzt, `Intl.NumberFormat` verwendet erkannte Sprache statt `"de"`

### Verbesserungen

- **i18n-Guardian erweitert**: Prueft jetzt automatisch alle HTML-Dateien auf fehlende Locale-Keys (nicht nur index.html)
- **stats.html i18n**: Alle statischen Texte mit `data-i18n`-Attributen versehen

### Tests

- **77 neue Tests**: HMAC-Auth (10), Admin-Endpunkte (14), Stats-Frontend (41), Demo-Privacy (1), Rate-Limit-Boundary (1), Notify HMAC (6), npm audit fix
- **Testabdeckung**: 186 Backend + 125 Frontend Tests

## [1.2.0] — 2026-02-21

### Features

- **Stundenlimit mit rollendem Fenster**: Echtes rollendes 60-Minuten-Fenster basierend auf einem `recentAnalyses`-Array in Firestore. Alte Eintraege fallen automatisch heraus — sobald genug Eintraege altern, ist das System sofort wieder frei (kein starrer Countdown). Konfigurierbares Limit (Standard: 500/Stunde, zentral in `config.js`). Fail-open bei Firestore-Fehlern.
- **Oeffentliche Stats-Seite**: Neue Seite unter `/stats` mit Live-Status, Gesamtzaehler, Zeitraum-Statistiken (Heute, Woche, Monat) mit Durchschnittswerten und Limit-Balken. Vollstaendig anonym — keine personenbezogenen Daten.
- **Limit-Banner auf Hauptseite**: Wenn das Stundenlimit erreicht ist, erscheint ein auffaelliger Banner mit Live-Countdown und Link zur Stats-Seite. Upload- und Demo-Bereich werden ausgegraut. Automatischer Reload nach Ablauf. Banner erscheint auch beim Neuladen der Seite (nicht erst nach Upload-Versuch).
- **Admin-Endpunkte**: `/api/admin/boost` (+100 Analysen) und `/api/admin/reset` (Zaehler zuruecksetzen) mit Token-Authentifizierung via ADMIN_SECRET (Bearer-Header oder Query-Parameter). Bestaetigungsseite im Dark-Theme mit Auto-Redirect zu Stats.
- **ntfy Push-Benachrichtigungen**: Automatischer Push auf self-hosted ntfy wenn das Limit erstmals erreicht wird. Action-Buttons in der Benachrichtigung fuer Boost, Reset und Stats — oeffnen jeweils eine Bestaetigungsseite im Browser.
- **Auto-Refresh bei Limit-Aufhebung**: Limit-Banner prueft alle 30 Sekunden ob das Limit per Boost oder Reset aufgehoben wurde und laedt die Seite automatisch neu.

### Datenschutz

- **Datenschutzseite ergaenzt**: Neuer Absatz zum Analyse-Zaehler (nur aggregierte Zahlen, keine Nutzer- oder Bilddaten) + Cloud Firestore in der Dienste-Tabelle
- **Counter speichert nur anonyme Timestamps**: Das rollende Fenster speichert Zeitpunkte der Analysen — kein Bezug zu einzelnen Nutzern, keine IP-Adressen, keine Bildinhalte

### Dokumentation

- **Stats-Link im Footer**: Alle Seiten (Hauptseite, Impressum, Datenschutz, Stats) haben jetzt einen Stats-Link und konsistente Startseite-Links im Footer
- **AGENTS.md, docs/SETUP.md, docs/SELF-HOSTING.md**: Neue Dateien und Endpunkte dokumentiert, Testanzahlen aktualisiert

## [1.1.1] — 2026-02-20

### Verbesserungen

- **Concurrency**: Cloud Function verarbeitet jetzt bis zu 20 gleichzeitige Anfragen pro Instanz (statt 1) — bessere Performance bei vielen Workshop-Teilnehmern
- **Quota-Fehlermeldung**: Wenn die Google-API ueberlastet ist, zeigt die App eine verstaendliche Meldung statt eines kryptischen Fehlers
- **Datenwert-Rechner**: Schluessel in der Gewichtungstabelle korrigiert — `politisch` wird jetzt korrekt mit 0.11 statt 0.06 gewichtet
- **Scan-Animation**: Fallback wenn i18n-Laden fehlschlaegt (zeigt Ellipsis statt leerem Text)
- **Deploy-Script**: Cache-Busting jetzt sekundengenau statt stuendlich — verhindert Cache-Probleme bei mehreren Deploys am selben Tag

### Dokumentation

- **docs/SETUP.md**: Testanzahl, RAM-Angabe und CI/CD-Abschnitt korrigiert
- **docs/SELF-HOSTING.md**: RAM-Angabe, CI/CD-Abschnitt und Nominatim-Dokumentation korrigiert
- **Datenschutzseite**: Logging-Beschreibung praezisiert (genutztes Modell, Antwortlaenge erwaehnt)

## [1.1.0] — 2026-02-19

### Features

- **Demo-Fotos fuer Workshops**: 3 anklickbare Stock-Fotos (Selfie Wien, Cafe Salzburg, Wanderung Hallstatt) mit eingebetteten Fake-EXIF-Daten (GPS, Kamera, Datum). Loesung fuer Workshops, in denen Teilnehmer kein eigenes Foto hochladen moechten. Bilder werden echt von der KI analysiert — kein vorgefertigtes Ergebnis.
- **i18n-System**: Alle UI-Texte, Gemini-Prompts und Tier-Profile in Locale-Dateien ausgelagert
  - Frontend: `public/locales/de.json` (alle UI-Strings via `data-i18n`-Attribute)
  - Backend: `functions/src/locales/de/prompts.js` (Gemini-Prompts) + `de/animals.js` (Tierprofile)
  - Sprachcode wird vom Client an den Server gesendet (`lang`-Parameter)
  - Spracherkennung: `?lang=`-URL-Parameter > Browser-Sprache > Default (de)
- **i18n-Guardian-Tests**: Automatische Pruefung dass keine hardcoded Strings in HTML, JS oder Backend stehen (Frontend + Backend)

### Barrierefreiheit

- **Safari Keyboard-Navigation**: Explizites `tabindex="0"` auf allen interaktiven Elementen (Buttons, Inputs, Links) — Safari ueberspringt ohne dieses Attribut standardmaessig alles ausser Text-Inputs
- **Subpages Safari-fix**: Datenschutz- und Impressum-Seite ebenfalls mit `tabindex="0"` auf allen Links
- **File-Input Overlay behoben**: `position: relative` auf `.file-drop` verhindert, dass der unsichtbare File-Input andere Buttons ueberlagert
- **A11y-Tests gegen echte HTML**: Tests lesen die echte `index.html` statt einer Kopie — kein Drift zwischen Test und Produktion moeglich
- **Farbkontrast verbessert**: Muted-Farbe von `#6b7280` auf `#9ca3af` angehoben — erfuellt jetzt WCAG AA (5.38:1 statt 3.84:1)
- **Skip-to-Content Link**: Unsichtbarer Link fuer Tastatur-Nutzer — erscheint beim ersten Tab-Druck, springt zum Hauptinhalt
- **Toggle-Switch per Tastatur**: Bias-Toggle ist jetzt per Tab erreichbar und mit Leertaste umschaltbar
- **Upload-Feld per Tastatur**: Datei-Upload ist per Tab erreichbar, Enter/Leertaste oeffnet den Datei-Dialog
- `aria-live="polite"` auf Status, Scan-Animation und Ergebnis-Bereich — Screenreader lesen Aenderungen vor
- **Disclaimer-Modal**: Focus-Trap, Escape zum Schliessen, Focus-Wiederherstellung, `role="dialog"` + `aria-modal`
- **Bias-Toggle**: `aria-label` fuer Screenreader
- **Info-Tooltips**: Per Tastatur (Tab + Enter/Space) erreichbar, `role="button"`
- **Dekorative SVGs**: Mit `aria-hidden="true"` vor Screenreadern versteckt
- **Reduzierte Bewegung**: `prefers-reduced-motion` deaktiviert alle Animationen fuer bewegungsempfindliche User

### Dokumentation

- **Screenshots**: Desktop- und Mobil-Screenshot in `docs/screenshots/` fuer README
- **README**: Screenshots, Lighthouse-/License-/Node.js-/Firebase-Badges, CI/CD-Abschnitt aktualisiert
- **Error-Alerting-Doku**: Anleitung fuer E-Mail-Benachrichtigungen bei Cloud-Function-Fehlern (`docs/ERROR-ALERTING.md`)
- **Good First Issues**: 2 Issues auf GitHub fuer externe Contributors (Tier-Easter-Eggs, English Translation)

### Sicherheit

- **CSP gehaertet**: `style-src 'unsafe-inline'` entfernt — alle Inline-Styles durch CSS-Klassen ersetzt
- **Dependabot**: Monatliche automatische Pruefung auf unsichere Dependencies (npm + GitHub Actions)
- **npm audit in CI**: Backend-Dependencies werden bei jedem Push auf bekannte Sicherheitsluecken geprueft
- **gitleaks in CI**: Automatischer Scan nach versehentlich committeten Secrets (API-Keys, Tokens) bei jedem Push
- **Lighthouse CI**: Automatischer Lighthouse-Audit bei jedem Push mit Budget-Pruefung (Performance >= 90, Rest = 100)

### Tooling

- **Deploy-Script**: `scripts/deploy.sh` — automatisches Cache-Busting (`?v=YYYYMMDDHH`) + Deploy in einem Schritt

### Bugfixes

- **Memory-Limit**: Cloud Function von 256 auf 512 MiB erhoeht — behebt Abstuerze bei groesseren Bildern

### Datenschutz

- **Datenschutzseite praezisiert**: Klarstellung dass anonymisierte Fehlerzusammenfassungen (ohne personenbezogene Daten) zur Fehlerbehebung bestehen bleiben

## [1.0.0] — 2026-02-16

Erster oeffentlicher Release.

### Features

- **KI-Analyse**: Foto hochladen, Gemini erstellt fiktives Persoenlichkeitsprofil
- **Zwei Modi**: Serioese Analyse (sachlich) und Beast Mode (uebertrieben-provokant)
- **Datenwert-Rechner**: Zeigt was ein Profil fuer Datenbroker wert ist
- **Privacy-Check**: Erkennt ungewollt preisgegebene Informationen (Telefonnummern, Adressen, Kennzeichen)
- **EXIF-Analyse**: Versteckte Kamera-Metadaten (client-seitig extrahiert, GPS erreicht nie unsere Server)
- **GPS-Karte**: Aufnahmeort auf Leaflet-Karte (nur lokal im Browser)
- **Tier-Easter-Egg**: Tierfotos bekommen ein lustiges Spass-Profil
- **PDF-Export**: Ergebnisse als PDF speichern
- **Demo-Modus**: Vorbereitete Profile fuer Workshops ohne echte Fotos
- **Disclaimer-Modal**: Pflicht-Hinweis vor Ergebnisanzeige

### Sicherheit

- Magic-Byte-Validierung (JPEG, PNG, WebP, GIF)
- Content Security Policy mit strikter Whitelist
- HSTS mit Preload
- Rate Limiting (200/10min pro IP)
- Honeypot-Feld + Timing-Check
- Prompt-Injection-Schutz (XML-Tag-Isolation)

### Privacy

- Keine Speicherung von Bildern oder Profilen
- Keine externen Scripts (Fonts, Leaflet, exifr self-hosted)
- Kein Tracking, keine Cookies, keine Analytics
- GPS bleibt immer im Browser
