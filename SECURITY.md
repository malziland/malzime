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

| Risk | Mitigation | Status |
|------|-----------|--------|
| In-memory rate limit (per instance, not global) | `maxInstances` cap + per-IP rate limit | Accepted for workshop scale |
| Public endpoint (`invoker: "public"`) | Rate limiting + CORS + honeypot + timing check | Accepted for workshop scale |
| No authentication required | By design — workshop participants should not need accounts | Accepted |
| Counter fail-open on Firestore errors (`counter.js`) | App stays available during DB outages; worst case: a few extra analyses beyond hourly limit | Accepted — availability over strict cost control |
| Nonce replay protection fail-open on Firestore errors (`auth.js`) | Admin actions remain functional during DB outages; nonces are short-lived (5 min TTL) and require valid HMAC | Accepted — admin availability over strict replay prevention |

## Security Measures

- **No permanent data storage**: In queue mode the image is briefly held in a dedicated EU storage bucket and deleted immediately after processing; job documents (including the result) are removed within ~2 hours. No profiles are stored permanently
- **Queue worker not publicly reachable**: `processJob` runs with `invoker: private` — only Google Cloud Tasks can invoke it, authenticated via an OIDC service-account token
- **No tracking**: No cookies, no analytics, no advertising
- **GPS stays in browser**: GPS coordinates are never sent to the server
- **Content Security Policy**: Strict whitelist (self + OpenStreetMap + Cloud Functions)
- **HSTS with preload**
- **Rate limiting**: Per-IP request limits
- **Prompt injection protection**: User data isolated in XML tags
- **Input validation**: File type, size, and format checks
- **LLM output bounds**: Response size limits enforced server-side (categories, ad_targeting, manipulation_triggers, profileText)
- **Defensive JSON parser**: 4-stage repair layer for LLM responses (`json-repair.js`) — direct parse → heuristic cleanup → json5 → truncation recovery
- **Per-instance throttle**: Semaphore (`throttle.js`) caps concurrent Mistral API calls per Cloud Function instance — smooths workshop-burst load against provider rate limits

## AI Vendors

malziME relies on external AI providers as data processors (Art. 28 GDPR). See [datenschutz.html](public/datenschutz.html) for the full data processing terms.

| Vendor | Role | Data Region |
|--------|------|-------------|
| Mistral AI SAS (Paris, FR) | Sole AI provider (Large 3 + Small 4) | EU by default |

Mistral is the only AI provider since v1.6.0 — no Google AI in the pipeline. Mistral is contractually bound to not use uploaded images for training on the paid tier we use. See [Mistral DPA](https://legal.mistral.ai/terms/data-processing-addendum). (Google remains an infrastructure processor for Firebase Hosting / Cloud Functions / Firestore — see [datenschutz.html](public/datenschutz.html).)

## Secrets management

All production secrets are stored in Google Cloud Secret Manager and bound to Cloud Functions via Firebase's `defineSecret`. Secrets are never committed to git. Gitleaks runs on every push as a backstop.

Required secrets:
- `ADMIN_SECRET` — Bearer token for admin endpoints (Boost, Reset, Maintenance)
- `MISTRAL_API_KEY` — Mistral AI API key (Scale tier)
- `NTFY_URL`, `NTFY_TOPIC` — optional, for limit-reached push notifications
