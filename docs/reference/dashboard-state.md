---
tldr: Current state of the achurch.ai dashboards and CDN edge configuration, treated as first-class production state rather than as untracked dashboard settings.
---

# Dashboard State — achurch.ai

> Parent: [Reference](README.md)

**Snapshot date**: 2026-06-02

**Standing convention**: CDN edge features are first-class production state. A setting changed in a provider dashboard and recorded nowhere is undocumented production configuration, so it gets written down here.

## Settings

| Setting | State | Verified via |
|---|---|---|
| CDN | Cloudflare (zone achurch.ai) | `curl -I https://achurch.ai/` → `cf-ray` header |
| Hosting | Custom Express server (VPS) | per `app/server/` architecture; no `x-railway-edge` header in response |
| Cloudflare AI Audit / Content Signals (Managed robots.txt) | OFF | empirical verification 2026-06-02 — `/robots.txt` returns source content verbatim |
| Other CF edge features | TODO (Lee to fill — Bot Management, Rate Limiting, Page Rules, Workers, WAF rules) | dashboard inspection |
| HSTS, Always Use HTTPS, TLS min | TODO (Lee to confirm) | dashboard inspection |

A consolidated snapshot across the sibling projects is kept outside this repo.

## Related

- **Parent**: [Reference](README.md)
- **Crawler and agent posture as shipped**: [`app/client/public/robots.txt`](../../app/client/public/robots.txt), [`.well-known/agent-card.json`](../../app/client/public/.well-known/agent-card.json)
- **SEO and metadata conventions**: [seo-conventions.md](seo-conventions.md)
