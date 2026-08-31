# Offene Aufgaben — Stand 31.08.2026, nach dem zweiten Review

**Diese Datei ist die verbindliche Liste. Sie wird abgearbeitet, bevor
ausgeliefert wird.**

---

## Reihenfolge (nicht verhandelbar)

```
1. Pruefer B abwarten                        laeuft
2. Dritter Pruefer: A gegen B halten         danach
3. Die geprueften Befunde beheben            danach
4. Die drei strukturellen Punkte einbauen    danach
5. Deploy — nach ausdruecklicher Freigabe    zuletzt
```

**Warum diese Reihenfolge:** Als Prüfer A lieferte, wurde sofort mit dem
Beheben begonnen. Damit verlor Prüfer B seine Grundlage — seine Befunde
beziehen sich teils auf Code, den es nicht mehr gibt. Der Vergleich zwischen
beiden ist genau deshalb wertvoll, und genau das wurde beschädigt.

Regel: **Läuft ein Prüfverfahren, wird der geprüfte Stand nicht angefasst** —
auch nicht für „dringende" Funde. Der Stand ist ohnehin nicht ausgeliefert.

---

## Die drei strukturellen Punkte (Auftrag Christoph, 31.08.2026)

Anlass: Fünf eigene Prüfrunden fanden **einen** Befund, zwei fremde Prüfer
**zweiundvierzig**. 16 von 19 hatte ich in derselben Nacht selbst erzeugt.

### 1. Der fremde Prüfer wird Pflichtschritt

Nicht Zusatz, nicht optional. Vor der Freigabe jedes größeren Umbaus.

- **Kein Vorwissen.** Alles, was ich ihm über meine Absicht erzähle, führt ihn
  in dieselbe Blindheit.
- **Auftrag ausdrücklich:** Probleme finden, nicht die Arbeit bestätigen.
  Begründungen in Kommentaren prüfen, nicht glauben.
- **Bei zwei Prüfern:** identischer Auftrag. Dann sagt die Übereinstimmung
  etwas — was beide finden, ist sicher; was nur einer findet, prüft ein
  dritter nach.

Umzusetzen in `docs/RUNBOOK.md` (Auslieferungskette) und als Eintrag in
`~/.claude/skills/audit-familie/LEHREN.md` — **dort bereits eingetragen.**

### 2. Ein Prüfwerkzeug ohne Selbstprüfung darf nicht eingehängt werden

Der Kern des Problems: Für Produktcode existieren 1170 Tests, für die Wächter
existierte nichts. Also wurden sie mit weniger Sorgfalt gebaut — nicht
absichtlich, sondern weil nichts widersprach.

**Umzusetzen:** Ein Wächter, der prüft, ob jedes Skript aus `scripts/pruefe-*`
in `scripts/selbstpruefung-waechter.sh` vorkommt. Fehlt es, geht der Push
nicht raus.

### 3. „Ausführen statt lesen" als sechstes Abnahmekriterium

Jede Behauptung über **Verhalten** braucht einen Lauf, der sie belegt — keine
Lektüre, die sie plausibel macht.

- Bei einer Shell-Zeile: einmal aufrufen.
- Bei einer Falle: abbrechen lassen und zusehen.
- Bei einem Wächter: das Material kaputtmachen.

Belege: `grep -E '=(pending|null|)$'` wirkte beim Lesen richtig und ist auf
BSD-grep tot. Die Aufräumfalle wirkte beim Lesen richtig und brach still ab.
Beide Prüfer haben ausgeführt und es sofort gesehen.

**Umzusetzen** in `plan-nachtlauf-entkopplung.md` (Abnahmekriterien) und in
der Übergabe-Vorlage.

---

## Befunde aus Prüfer A — Stand

**Bereits behoben** (vorschnell, siehe Reihenfolge oben — gehen trotzdem an
den dritten Prüfer, mit der Frage, ob die Reparaturen tragen):

- P1: Aufräumfalle brach still ab (`set -e` im EXIT-Trap)
- P1: `HOCHGELADEN=1` stand vor dem ersten Upload
- P1: Selbstprüfung konnte das Repository beschädigen

**Offen** (warten auf die Gegenprüfung):

- P1: Reihenfolge-Regel des Trockenlaufs ist tot (Anker nur im Kommentar)
- P1: `pruefe-mitzieher.py` kann grün melden, ohne committete Änderungen
  gesehen zu haben
- 11 × P2, mehrere P3 — vollständige Liste im Bericht von Prüfer A
