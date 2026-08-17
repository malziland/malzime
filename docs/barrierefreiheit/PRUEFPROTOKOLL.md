# Prüfprotokoll Barrierefreiheit — malziME

**Prüfgegenstand:** https://malzi.me
**Angestrebte Stufe:** WCAG 2.2, Konformitätsstufe AA
**Prüfdatum:** 17. August 2026
**Prüfstand:** Commit `b3908c3`, ausgelieferte Kennung `2026081701`
**Prüfer:** Eigenprüfung (malziland - learning | training | consulting e.U.)

---

## 1 Warum dieses Protokoll die Form einer vollständigen Liste hat

Eine Barrierefreiheitserklärung ist nur so viel wert wie das, was hinter ihr steht.
„Wir haben geprüft" ist keine Aussage, solange nicht dasteht **was** geprüft wurde,
**wie** und mit **welchem Ergebnis**.

Deshalb ist unten jedes einzelne Erfolgskriterium aufgeführt, das WCAG 2.2 für die
Stufe AA verlangt — **55 Kriterien**, davon 31 auf Stufe A und 24 auf Stufe AA.
(WCAG 2.2 hat gegenüber 2.1 die Kriterien 3.2.6 und 3.3.7 auf Stufe A sowie 2.4.11,
2.5.7, 2.5.8 und 3.3.8 auf Stufe AA ergänzt und das frühere 4.1.1 „Parsen"
gestrichen.)

Keine Zeile bleibt leer. Wo etwas nicht zutrifft, steht der Grund. Wo eine
Handprüfung nötig ist, steht das als offener Punkt — nicht als Häkchen.

## 2 Prüfumfang

**Geprüfte Seiten:** Startseite (`/`), Zahlen (`/stats`), Datenschutz
(`/datenschutz`), Impressum (`/impressum`), Nutzungsbedingungen
(`/nutzungsbedingungen`).

**Geprüfte Zustände:** Startseite leer, Warteschlange mit Position und Restzeit,
Live-Text während die KI schreibt, fertiges Profil (seriöser Modus, Beast-Modus,
Umschalter im geklebten Zustand), Fehlermeldung nach fehlgeschlagener Analyse,
Sprachhinweis-Dialog geöffnet.

**Zum dunklen Erscheinungsbild, damit hier nichts Falsches steht:** malziME richtet
sich NICHT nach der Systemeinstellung „dunkel" — `prefers-color-scheme` kommt im
Stilblatt nicht vor. Das dunkle Erscheinungsbild entsteht ausschließlich über den
Beast-Schalter und damit nur auf der Startseite mit vorliegendem Ergebnis. Genau dort
ist es gemessen (Zustand „Profil, Beast, dunkel"). Auf den Rechtsseiten und der
Zahlen-Seite gibt es kein dunkles Erscheinungsbild, das man prüfen könnte.

**Geprüfte Browser:** Chromium und WebKit. WebKit ist die Maschine hinter Safari auf
iPhone und iPad — dort finden die Workshops statt. Beide Läufe liefern dasselbe
Ergebnis; die Trennung ist Absicht, weil WebKit am Prüftag einen Fehler zeigte, den
Chromium nicht zeigte.

**Geprüfte Fenstermaße:** 1280 × 900 (Rechner) und 320 × 800 (kleines Handy).

**Werkzeuge:** axe-core über Playwright, gefiltert auf die Marken `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa` — also ausschließlich
normative Regeln, keine „best practice"-Empfehlungen. Dazu eigene Messungen für
Zielgrößen, Reflow, Textvergrößerung, Textabstände und Fokus-Erscheinung.

**Reproduzierbar:** `npx playwright test e2e/barrierefreiheit-protokoll.test.js`
Rohdaten: `e2e/.protokoll/befunde-chromium.json`,
`e2e/.protokoll/befunde-webkit-sprachumschalter.json`

## 3 Zwei Vorsichtsmaßnahmen, die das Ergebnis erst belastbar machen

**Jede Messung läuft doppelt.** Übernommen wird nur, was beide Male auftritt. Grund:
Ein erster Aufbau meldete 17 Kontrastverstöße, die in einem sauberen Einzellauf nicht
reproduzierbar waren — axe hatte Elemente in einem Übergangszustand erwischt. Ein
Protokoll mit Scheinbefunden ist schlechter als keines.

**Jede Messung hat eine Positivkontrolle.** Liefert axe null geprüfte Regeln oder
findet die Zielgrößen-Messung kein einziges Bedienelement, bricht der Lauf ab. Ohne
das sähe ein kaputter Lauf aus wie ein perfektes Ergebnis.

---

## 4 Ergebnis in einem Satz

Von 55 Kriterien der Stufe AA sind **40 als erfüllt nachgewiesen** und **11 nicht
anwendbar** (keine Video- oder Tonbeiträge, keine Anmeldung, keine Zeitbegrenzung,
kein Formular mit personenbezogenen Daten). **4 weitere sind maschinell erfüllt, ihre
Handprüfung steht noch offen** (Abschnitt 7). **Kein Kriterium ist als verletzt
festgestellt.**

Die Zahlen sind die Auszählung der Tabellen in Abschnitt 5, nicht eine Schätzung:
40 + 11 + 4 = 55.

Bis die vier Handprüfungen abgeschlossen sind, lautet die zulässige Aussage
**„weitgehend konform"**. Danach kann sie „konform" lauten.

---

## 5 Die Kriterien im Einzelnen

Legende: **erfüllt** = nachgewiesen · **n. a.** = nicht anwendbar, mit Grund ·
**Handprüfung** = maschinell nicht entscheidbar, siehe Abschnitt 7

### Stufe A

| Kriterium | Prüfweg | Ergebnis |
|---|---|---|
| 1.1.1 Nicht-Text-Inhalt | axe (`image-alt`, `input-image-alt`, `role-img-alt`, `object-alt`); Unit-Test prüft `data-i18n-alt` für alle Bilder | **maschinell erfüllt**, Handprüfung offen |
| 1.2.1 Nur-Audio, Nur-Video (aufgezeichnet) | Bestandsprüfung: keine Audio- oder Videobeiträge | **n. a.** |
| 1.2.2 Untertitel (aufgezeichnet) | dito | **n. a.** |
| 1.2.3 Audiodeskription / Medienalternative | dito | **n. a.** |
| 1.3.1 Infos und Beziehungen | axe (`list`, `listitem`, `definition-list`, `th-has-data-cells`, `aria-required-parent`, `heading-order`) | **maschinell erfüllt**, Handprüfung offen |
| 1.3.2 Bedeutungstragende Reihenfolge | Tab-Reihenfolge im Unit-Test festgeschrieben (Sprungmarke → Datei → Info → Umschalter → Demos → Links) | **erfüllt** |
| 1.3.3 Sensorische Eigenschaften | Sichtprüfung: keine Anweisung verweist allein auf Form, Größe oder Position | **erfüllt** |
| 1.4.1 Benutzung von Farbe | Sichtprüfung: Konfidenz-Punkte tragen zusätzlich Zahlwerte, Fehlermeldungen zusätzlich Text | **erfüllt** |
| 1.4.2 Audio-Steuerelement | Die Tipp-Geräusche sind kürzer als 3 s, spielen nur auf Nutzeraktion und lassen sich abschalten | **n. a.** |
| 2.1.1 Tastatur | E2E-Durchgang: jedes Bedienelement per Tabulator erreichbar und auslösbar | **maschinell erfüllt**, Handprüfung offen |
| 2.1.2 Keine Tastaturfalle | E2E: 10 Tabulatorschritte im Dialog, Fokus verlässt ihn nie und kehrt bei Escape zurück | **erfüllt** |
| 2.1.4 Zeichentasten-Kurzbefehle | Bestandsprüfung: keine Einzelzeichen-Kurzbefehle vorhanden | **n. a.** |
| 2.2.1 Zeiteinteilung anpassbar | Die Analyse hat keine Frist für den Nutzer; das Abholfenster von 15 Minuten betrifft nur die Wiederholung eines fertigen Ergebnisses und verliert keine Eingabe | **erfüllt** |
| 2.2.2 Pausieren, beenden, ausblenden | Alle Bewegungen (Scan-Auge, Live-Tippen, Karten-Einblendung) folgen `prefers-reduced-motion`; im E2E an den berechneten Animationswerten nachgewiesen | **erfüllt** |
| 2.3.1 Dreimaliges Blitzen oder weniger | Bestandsprüfung: keine blitzenden Inhalte | **erfüllt** |
| 2.4.1 Blöcke umgehen | Sprungmarke „Zum Inhalt springen" auf jeder Seite, Unit-Test prüft Ziel `#main` | **erfüllt** |
| 2.4.2 Seite mit Titel | axe (`document-title`); jede der fünf Seiten hat einen eigenen, beschreibenden Titel | **erfüllt** |
| 2.4.3 Fokus-Reihenfolge | Unit-Test schreibt die Reihenfolge fest; E2E prüft die Rückgabe des Fokus nach Dialogen | **erfüllt** |
| 2.4.4 Linkzweck (im Kontext) | Eigene Messung: 0 Leerformeln („hier", „mehr", „klicken") auf allen fünf Seiten | **erfüllt** |
| 2.5.1 Zeigergesten | Bestandsprüfung: keine Mehrfinger- oder Pfadgesten; die Karte ist zusätzlich über Knöpfe bedienbar | **erfüllt** |
| 2.5.2 Zeiger-Abbruch | Alle Aktionen lösen beim Loslassen aus, nicht beim Drücken | **erfüllt** |
| 2.5.3 Beschriftung im Namen | axe (`label-content-name-mismatch`); sichtbarer Text und `aria-label` stimmen überein | **erfüllt** |
| 2.5.4 Betätigung durch Bewegung | Bestandsprüfung: keine Bewegungs- oder Neigungssteuerung | **n. a.** |
| 3.1.1 Sprache der Seite | axe (`html-has-lang`, `html-lang-valid`); `lang` wird beim Sprachwechsel mitgesetzt | **erfüllt** |
| 3.2.1 Bei Fokus | Bestandsprüfung: kein Fokus löst einen Kontextwechsel aus | **erfüllt** |
| 3.2.2 Bei Eingabe | Der Sprachwechsel fragt vor dem Verwerfen eines Ergebnisses zurück | **erfüllt** |
| 3.2.6 Konsistente Hilfe | Impressum und Kontakt stehen auf jeder Seite an derselben Stelle der Fußzeile | **erfüllt** |
| 3.3.1 Fehlererkennung | Fehlermeldungen erscheinen als Text in einem `aria-live`-Bereich; im Protokoll als eigener Zustand gemessen | **erfüllt** |
| 3.3.2 Beschriftungen oder Anweisungen | axe (`label`, `form-field-multiple-labels`); die Dateiauswahl trägt eine sichtbare Anweisung | **erfüllt** |
| 3.3.7 Redundante Eingabe | Es gibt nur einen Eingabeschritt (Foto wählen); nichts wird zweimal verlangt | **n. a.** |
| 4.1.2 Name, Rolle, Wert | axe (`button-name`, `link-name`, `aria-valid-attr-value`, `aria-required-attr`, `select-name`) | **erfüllt** |

### Stufe AA

| Kriterium | Prüfweg | Ergebnis |
|---|---|---|
| 1.2.4 Untertitel (live) | keine Live-Inhalte | **n. a.** |
| 1.2.5 Audiodeskription (aufgezeichnet) | keine Videobeiträge | **n. a.** |
| 1.3.4 Ausrichtung | Sichtprüfung: keine Einschränkung auf Hoch- oder Querformat | **erfüllt** |
| 1.3.5 Eingabezweck bestimmen | Es gibt kein Formularfeld, das personenbezogene Daten erhebt | **n. a.** |
| 1.4.3 Kontrast (Minimum) | axe (`color-contrast`), 15 Zustände, doppelt gemessen, beide Browser: **0 Verstöße**. Nachgerechnet: 4,73 : 1 bis 15 : 1 | **erfüllt** |
| 1.4.4 Textgröße ändern | Eigene Messung: Wurzelschrift auf 200 % (16 → 32 px), alle fünf Seiten ohne waagrechtes Scrollen und ohne abgeschnittenen Inhalt | **erfüllt** |
| 1.4.5 Bilder von Text | Kein Text als Bild, mit einer benannten Ausnahme: die KI-Kennzeichnung in den Demo-Fotos (siehe Abschnitt 6) | **erfüllt** |
| 1.4.10 Reflow | Eigene Messung bei 320 px: alle fünf Seiten genau 320 px, kein waagrechtes Scrollen. Zwei Mängel am Prüftag gefunden und behoben (siehe Abschnitt 6) | **erfüllt** |
| 1.4.11 Nicht-Text-Kontrast | axe; zusätzlich eigene Messung der Umschalter-Flächen in hellem und dunklem Thema | **erfüllt** |
| 1.4.12 Textabstände | Eigene Messung mit Zeilenhöhe 1,5, Absatzabstand 2 em, Buchstabenabstand 0,12 em, Wortabstand 0,16 em: nichts überlappt, nichts verschwindet | **erfüllt** |
| 1.4.13 Inhalt bei Hover oder Fokus | Die Info-Einblendungen sind schließbar (Escape), bleiben bei Zeigerwechsel stehen und verdecken den Auslöser nicht | **erfüllt** |
| 2.4.5 Verschiedene Wege | Fußzeile auf jeder Seite plus Rubrik-Verweis zurück zur Startseite | **erfüllt** |
| 2.4.6 Überschriften und Beschriftungen | Eigene Messung: 1 bis 16 Überschriften je Seite, **0 übersprungene Ebenen** | **erfüllt** |
| 2.4.7 Fokus sichtbar | Eigene Messung nach echtem Fokussieren: jedes Element trägt einen Ring von mindestens 2 px. Am Prüftag verbessert (siehe Abschnitt 6) | **erfüllt** |
| 2.4.11 Fokus nicht verdeckt (Minimum) | Eigene Messung: kein fokussiertes Element liegt hinter der geklebten Umschalt-Leiste | **erfüllt** |
| 2.5.7 Ziehbewegungen | Die Karte ist zusätzlich über Knöpfe bedienbar; sonst gibt es keine Ziehbewegung | **erfüllt** |
| 2.5.8 Zielgröße (Minimum) | Eigene Messung der **tastbaren Fläche** (nicht der gemalten Box) über 12 bis 45 Bedienelemente je Seite: **0 Mängel**. Die Ausnahmen „inline im Fließtext" und „Abstand mindestens 24 px" sind umgesetzt | **erfüllt** |
| 3.1.2 Sprache von Teilen | Der Sprachumschalter setzt `lang` je Knopf; der zweisprachige Hinweis trägt `lang="de"` und `lang="en"` je Zeile | **erfüllt** |
| 3.2.3 Konsistente Navigation | Fußzeile und Kopfzeile in gleicher Reihenfolge auf allen Seiten | **erfüllt** |
| 3.2.4 Konsistente Erkennung | Gleiche Funktionen tragen durchgehend gleiche Beschriftung | **erfüllt** |
| 3.3.3 Fehlerempfehlung | Jede Fehlermeldung nennt den nächsten Schritt („Versuch es nochmal", „nimm ein anderes Foto") | **erfüllt** |
| 3.3.4 Fehlervermeidung (rechtlich, finanziell, Daten) | Keine Rechtsgeschäfte, keine Zahlungen, keine löschbaren Nutzerdaten. Der einzige verlustbehaftete Schritt — Sprachwechsel bei vorliegendem Ergebnis — fragt zurück | **erfüllt** |
| 3.3.8 Barrierefreie Authentifizierung | Keine Anmeldung, kein Konto, kein Passwort | **n. a.** |
| 4.1.3 Statusmeldungen | Warteschlangen-Status, Fehlermeldungen und Ergebnis-Ansage laufen über `aria-live`-Bereiche (`#status`, `#srAnnounce`) | **maschinell erfüllt**, Handprüfung offen |

---

## 6 Am Prüftag gefundene und behobene Mängel

Diese vier Punkte waren am 17. August verletzt und sind noch am selben Tag behoben.
Sie stehen hier, weil ein Protokoll, das nur Erfolge nennt, unglaubwürdig ist.

| Kriterium | Befund | Behebung | Dauerprüfung |
|---|---|---|---|
| 1.4.10 Reflow | Nutzungsbedingungen 333 statt 320 px — die ODR-Adresse der EU ist 34 Zeichen ohne Leerstelle und konnte nicht umbrechen | Umbruch für Links in Rechtstexten | ja |
| 1.4.10 Reflow | Profil-Seite 324 statt 320 px — die Wert-Plakette der Datenwert-Skala schob die Zeile auf | Zeile bricht um statt die Seite zu verbreitern | ja |
| 1.4.10 Reflow (Ursache) | Die geklebte Umschalt-Leiste zog mit fest verdrahteten 20 px über den Rand, während die Seitenpolsterung bei schmalen Bildschirmen auf 16 px zurückgeht | Beide Werte kommen jetzt aus einer Quelle und können nicht auseinanderdriften | ja |
| 2.4.7 Fokus sichtbar | 7 von 12 bis 20 Elementen je Rechtsseite trugen nur den Browser-Standardring. Sichtbar war er, aber sein Aussehen entscheidet jeder Browser selbst | Eigener Ring, 2 px, 5,9 : 1 gegen Papier und 11 : 1 im dunklen Thema | ja |

**Bewusste, benannte Abweichung zu 1.4.5 (Bilder von Text):** Die drei Demo-Fotos
tragen die KI-Kennzeichnung in die Pixel gebrannt. Das ist seit August 2026 Pflicht
und mit Absicht so gebaut — ein Etikett aus Text verschwindet, sobald jemand das
Bild speichert. Die Kennzeichnung ist zusätzlich im Alternativtext und in den
strukturierten Daten hinterlegt, ist also für Screenreader erreichbar. Die Ausnahme
„wesentlich" des Kriteriums greift hier.

## 7 Offene Handprüfungen

Vier Kriterien lassen sich maschinell nicht entscheiden. Sie sind der Grund, warum
die Erklärung bis zu ihrem Abschluss „weitgehend konform" sagt.

| Kriterium | Was zu prüfen ist | Wie |
|---|---|---|
| 1.1.1 Nicht-Text-Inhalt | Sind die Alternativtexte inhaltlich brauchbar — nicht nur vorhanden? | VoiceOver-Durchgang, Schritt 2 und 6 |
| 1.3.1 Infos und Beziehungen | Erschließt sich der Aufbau auch beim Vorlesen? | VoiceOver-Durchgang, Schritt 3 |
| 4.1.3 Statusmeldungen | Werden Wartezustand, Fehler und Ergebnis wirklich angesagt? | VoiceOver-Durchgang, Schritt 4 und 5 |
| 2.1.1 Tastatur | Ist die Bedienung mit der Tastatur nicht nur möglich, sondern auch verständlich? | Tastatur-Durchgang, Schritt 7 |

Anleitung: [`VOICEOVER-CHECKLISTE.md`](VOICEOVER-CHECKLISTE.md)

## 8 Nicht angestrebt: Stufe AAA

AAA ist ausdrücklich nicht das Ziel — das W3C empfiehlt es nicht als Anforderung für
ganze Websites, weil es sich für manche Inhalte grundsätzlich nicht erfüllen lässt.
Gemessen wurde es dennoch, damit die Erklärung sagen kann, was nebenbei erreicht ist.

Von 22 anwendbaren AAA-Kriterien sind **10 nachgewiesen erfüllt**: Linkzweck ohne
Leerformeln, Überschriftenstruktur ohne Sprünge, Fokus nie verdeckt,
Fokus-Erscheinung mit mindestens 2 px, kein Blocksatz, Zeilenabstand mindestens 1,5,
Animationen abschaltbar, kein Blitzen, keine Unterbrechungen, alle Eingabearten
gleichwertig.

**Sechs sind nachweislich nicht erfüllt, mit Grund:**

| Kriterium | Befund | Warum es so bleibt |
|---|---|---|
| 1.4.6 Kontrast 7 : 1 | 17 bis 37 Elemente je Seite (die Profil-Ansicht erfüllt es) | Die Markenpalette ist auf 4,5 : 1 ausgelegt; 7 : 1 wäre ein Umbau der Marke |
| 1.4.8 Visuelle Präsentation | Zeilenlänge bis 103 statt 80 Zeichen | Verhältnismäßigkeit |
| 1.4.9 Bilder von Text (ohne Ausnahme) | die KI-Kennzeichnung | **unerfüllbar** — die Kennzeichnung ist Pflicht |
| 2.5.5 Zielgröße 44 × 44 | 6 bis 30 Bedienelemente je Seite | AAA kennt die Abstands-Ausnahme nicht; ein Umbau der Bedienflächen |
| 3.1.4 Abkürzungen | auf den Rechtsseiten behoben, auf der Startseite offen | Der Text kommt dort aus den Sprachdateien; 17 Fundstellen für ein AAA-Kriterium |
| 3.1.5 Lesbarkeit | Rechtstexte über Sekundarstufe I | Erforderte eine zweite, vereinfachte Fassung jedes Rechtstexts |

Sechs weitere AAA-Kriterien sind nur von Hand entscheidbar und hier nicht bewertet.

## 9 Was ausdrücklich nicht eingesetzt wird

**Kein Barrierefreiheits-Overlay.** Anbieter wie accessiBe oder UserWay liefern ein
„zertifiziert barrierefrei"-Abzeichen mit. Die Fachwelt lehnt sie geschlossen ab:
Sie verschlechtern die Bedienung für Screenreader-Nutzer messbar und haben Klagen
ausgelöst. Für genau die Fachleute, die malziME erreichen soll, wäre so ein Abzeichen
ein Warnsignal.

**Kein erkauftes Siegel.** Ein externes Zertifikat wurde geprüft und verworfen. Ein
Protokoll mit nachvollziehbaren Messungen und offen benannten Lücken belegt mehr als
eine Urkunde ohne Prüfweg.

## 10 Nächste Prüfung

Fällig bei jeder Änderung an Aussehen, Bedienung oder Seitenstruktur, spätestens
halbjährlich. Die Messungen laufen bei jedem Auslieferungslauf automatisch mit; die
vier Handprüfungen aus Abschnitt 7 sind bei jeder Prüfung zu wiederholen.
