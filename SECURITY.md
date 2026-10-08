# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

**Email:** [datenschutz@malzi.me](mailto:datenschutz@malzi.me)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days.

**Please do not open a public GitHub issue for security vulnerabilities.**

## Scope

malziME is a **workshop tool for media literacy education**. It is designed for supervised classroom use, not as a high-security production system.

## Known Accepted Risks

The deliberate trade-offs — each with its reasoning and the condition for re-evaluating it — are documented in one place: [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) (German), section "Bewusste Restrisiken". The table below only names them and points there; it does not describe the behaviour a second time.

| Risk | Mitigation | Status |
|------|-----------|--------|
| Per-IP rate limit lives in memory, per instance, not globally | It is a noise filter, not the cost brake; the global brakes are the hourly limit and the queue-depth cap (Restrisiko 2) | Accepted for workshop scale |
| Public endpoints (`invoker: "public"`) | Rate limiting + body-size cap + queue-depth cap + hourly limit (honeypot and timing check are browser-side heuristics and do not stop a direct call) (Restrisiko 5) | Accepted for workshop scale |
| No authentication required | By design — workshop participants should not need accounts | Accepted |
| The hourly limit (cost brake) depends on the database | See Restrisiko 1 and the section "Die Kostenbremse und ihr Netz" | Accepted |

## Security Measures

- **No permanent data storage**: In queue mode the image is briefly held in a dedicated EU storage bucket and deleted immediately after processing; job documents (including the result) are removed within ~2 hours. No profiles are stored permanently
- **Queue worker not publicly reachable**: `processJob` runs with `invoker: private` — only Google Cloud Tasks can invoke it, authenticated via an OIDC service-account token
- **No tracking**: No cookies, no analytics, no advertising
- **GPS never reaches our servers**: Coordinates are read in the browser and used there for the map. Reverse geocoding goes directly from the browser to OpenStreetMap Nominatim — the coordinates leave the browser, but never touch malziME infrastructure
- **Content Security Policy**: Strict whitelist (self + OpenStreetMap tiles + Nominatim + the project's own Cloud Run endpoints); forms may only submit to the site itself (`form-action 'self'`)
- **HSTS** — enforced for two years including subdomains; the `preload` directive is sent,
  but the site is deliberately **not** on the browser preload list (see `docs/SECURITY-MODEL.md`)
- **Rate limiting**: Per-IP request limits
- **Admin actions**: HMAC-signed token plus a one-time nonce; if the nonce cannot be checked, the action is refused
- **Prompt injection protection**: the analysis prompt states explicitly that text visible in the image is content, never an instruction; in the second call (ad categories, no image) the profile data is escaped, wrapped in data blocks and preceded by a warning to ignore instructions inside them
- **Input validation**: File type, size, and format checks
- **LLM output bounds**: Response size limits enforced server-side (categories, ad_targeting, manipulation_triggers, profileText, and the two `hard_facts` anchors) — for every shape the model may return
- **Defensive JSON parser**: 4-stage repair layer for LLM responses (`json-repair.js`) — direct parse → heuristic cleanup → json5 → truncation recovery
- **Per-instance throttle**: Semaphore (`throttle.js`) caps concurrent Mistral API calls per Cloud Function instance — smooths workshop-burst load against provider rate limits

## AI Vendors

malziME relies on external AI providers as data processors (Art. 28 GDPR). See [datenschutz.html](public/datenschutz.html) for the full data processing terms.

| Vendor | Role | Data Region |
|--------|------|-------------|
| Mistral AI SAS (Paris, FR) | Sole AI provider — `mistral-large-2512` handles every live analysis | EU by default |

Mistral is the only AI provider since v1.6.0 — no Google AI in the pipeline. Since v2.2 a single call to `mistral-large-2512` produces both profiles. The older fallback pipeline with `mistral-small-2603` was removed on 2026-09-10; no other model processes images. Mistral is contractually bound to not use uploaded images for training on the paid tier we use. See [Mistral DPA](https://legal.mistral.ai/terms/data-processing-addendum). (Google remains an infrastructure processor for Firebase Hosting / Cloud Functions / Firestore — see [datenschutz.html](public/datenschutz.html).)

## Secrets management

All production secrets are stored in Google Cloud Secret Manager and bound to Cloud Functions via Firebase's `defineSecret`. Secrets are never committed to git. Gitleaks runs on every push as a backstop.

Required secrets:
- `ADMIN_SECRET_EU` — Bearer token for admin endpoints (Boost, Reset, Maintenance)
- `MISTRAL_API_KEY_EU` — Mistral AI API key (paid tier)
- `NTFY_URL_EU`, `NTFY_TOPIC_EU` — optional, for limit-reached push notifications

All four are bound to `europe-west1` (user-managed replication) since 2026-09-09; the `_EU` suffix marks that.
