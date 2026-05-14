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
| `minimatch` ReDoS in `@google-cloud/vision` transitive dependency (`vision → google-gax → rimraf → glob → minimatch <10.2.1`) | Not exploitable in this context (no user-controlled glob patterns reach minimatch). Vision API 5.3.4 is latest; fix requires upstream update by Google | Accepted — monitored via Dependabot |

## Security Measures

- **No data storage**: Images and profiles exist only in RAM during processing
- **No tracking**: No cookies, no analytics, no advertising
- **GPS stays in browser**: GPS coordinates are never sent to the server
- **Content Security Policy**: Strict whitelist (self + OpenStreetMap + Cloud Functions)
- **HSTS with preload**
- **Rate limiting**: Per-IP request limits
- **Prompt injection protection**: User data isolated in XML tags
- **Input validation**: File type, size, and format checks
- **LLM output bounds**: Response size limits enforced server-side (categories, ad_targeting, manipulation_triggers, profileText)
- **Defensive JSON parser**: 4-stage repair layer for LLM responses (`json-repair.js`) — direct parse → heuristic cleanup → json5 → truncation recovery
- **Multi-provider fallback**: Mistral AI (primary) → Gemini (fallback) → Vision-Labels heuristic — single provider failure does not break the service
- **Per-instance throttle**: Semaphore module built but not yet activated — available if Workshop bursts exceed Mistral Scale-Tier limits

## AI Vendors

malziME relies on external AI providers as data processors (Art. 28 GDPR). See [datenschutz.html](public/datenschutz.html) for the full data processing terms.

| Vendor | Role | Data Region |
|--------|------|-------------|
| Mistral AI SAS (Paris, FR) | Primary AI (Large 3 + Small 4) | EU by default |
| Google Vertex AI / Cloud Vision | Fallback AI | europe-west1, Belgium |

Both vendors are contractually bound to not use uploaded images for training on the paid tiers we use. See provider DPAs:
- [Mistral DPA](https://legal.mistral.ai/terms/data-processing-addendum)
- [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum)

## Secrets management

All production secrets are stored in Google Cloud Secret Manager and bound to Cloud Functions via Firebase's `defineSecret`. Secrets are never committed to git. Gitleaks runs on every push as a backstop.

Required secrets:
- `ADMIN_SECRET` — Bearer token for admin endpoints (Boost, Reset, Maintenance)
- `MISTRAL_API_KEY` — Mistral AI API key (Scale tier)
- `NTFY_URL`, `NTFY_TOPIC` — optional, for limit-reached push notifications
