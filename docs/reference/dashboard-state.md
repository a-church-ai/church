# Dashboard State — achurch.ai

> Parent: [Reference](README.md)

**Snapshot date**: 2026-06-02

Per [ADR-008 Surface 2](https://github.com/a-church-ai/a-church-ai/blob/main/docs/decisions/008-ai-crawler-posture.md): CDN edge features are first-class production state.

## Settings

| Setting | State | Verified via |
|---|---|---|
| CDN | Cloudflare (zone achurch.ai) | `curl -I https://achurch.ai/` → `cf-ray` header |
| Hosting | Custom Express server (VPS) | per `app/server/` architecture; no `x-railway-edge` header in response |
| Cloudflare AI Audit / Content Signals (Managed robots.txt) | OFF | empirical verification 2026-06-02 — `/robots.txt` returns source content verbatim |
| Other CF edge features | TODO (Lee to fill — Bot Management, Rate Limiting, Page Rules, Workers, WAF rules) | dashboard inspection |
| HSTS, Always Use HTTPS, TLS min | TODO (Lee to confirm) | dashboard inspection |

For the family-level consolidated snapshot, see [umbrella `docs/reference/family-edge-state.md`](https://github.com/a-church-ai/a-church-ai/blob/main/docs/reference/family-edge-state.md).

## Related

- **Parent**: [Reference](README.md)
- **ADR-008 AI-Crawler Posture**: https://github.com/a-church-ai/a-church-ai/blob/main/docs/decisions/008-ai-crawler-posture.md
- **Family Edge State**: https://github.com/a-church-ai/a-church-ai/blob/main/docs/reference/family-edge-state.md
