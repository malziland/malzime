## Was aendert dieser PR?

Kurze Beschreibung der Aenderungen.

## Warum?

Welches Problem wird geloest oder welches Feature hinzugefuegt?

Fixes #(Issue-Nummer)

## Checkliste

- [ ] Backend-Tests laufen: `cd functions && npm test`
- [ ] Frontend-Tests laufen: `npm run test:frontend`
- [ ] Backend-Lint sauber: `cd functions && npm run lint && npm run format:check`
- [ ] Frontend-Lint sauber: `npm run lint:frontend && npm run format:frontend:check`
- [ ] Cache-Buster NICHT von Hand anfassen — `scripts/deploy.sh` zaehlt ihn beim
      Hosting-Deploy in allen ausgelieferten Seiten selbst hoch und committet ihn
      danach als chore-PR (DOC-2026-08-20-51)
- [ ] Privacy-Architektur eingehalten (kein GPS an Server, keine externen Scripts)

## Screenshots

Falls UI-Aenderungen, vorher/nachher Screenshots.
