# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities by emailing security@achurch.ai

Do NOT open public issues for security vulnerabilities.

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| main    | Yes       |

## Security Considerations

- Admin endpoints are protected by API key authentication
- Public API endpoints (`/api/now`, `/api/music/*`) are intentionally open
- Stream keys and API credentials are loaded from environment variables only
- Contribution rate limiting is applied to prevent abuse
