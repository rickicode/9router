# Dashboard Authorization Security

## Overview

The 9Router dashboard uses multi-layer security to prevent unauthorized access:

1. **IP Whitelist** - Socket-level IP validation (not spoofable via headers)
2. **JWT Authentication** - Secure token-based auth with 24h expiration
3. **Rate Limiting** - Max 5 login attempts per IP per 15 minutes
4. **Audit Logging** - All security events logged to `data/audit.log`

## Configuration

### IP Whitelist

Default whitelist (in `data/db.json` settings):
```json
{
  "ipWhitelist": ["127.0.0.1", "::1", "172.17.0.0/16"]
}
```

Add custom IPs via dashboard Settings page or directly in `db.json`.

### Trusted Proxy

If behind a reverse proxy (nginx, Cloudflare), enable trusted proxy mode:
```json
{
  "trustedProxyEnabled": true
}
```

This allows reading `X-Forwarded-For` header for real client IP.

### Audit Logging

Disable audit logging (not recommended):
```json
{
  "auditLogEnabled": false
}
```

Adjust max log size (default 10MB):
```json
{
  "auditLogMaxSize": 20971520
}
```

## Security Events

Logged events:
- `auth_bypass_attempt` - Localhost/whitelist access attempts
- `jwt_validation_failed` - Invalid/expired JWT tokens
- `tunnel_access_attempt` - Tunnel/tailscale access attempts
- `login_attempt` - Login successes/failures
- `rate_limit_exceeded` - Too many login attempts

## Threat Model

**Mitigated:**
- Host header spoofing
- X-Forwarded-For manipulation (when trustedProxyEnabled=false)
- Brute force login attacks
- Tunnel URL manipulation

**Not Mitigated (out of scope):**
- DDoS attacks (needs infrastructure-level protection)
- XSS attacks (needs CSP headers)
- CSRF attacks (needs CSRF tokens)

## Testing

Run security tests:
```bash
npm --prefix tests test unit/ipValidator.test.js unit/auditLog.test.js unit/dashboardGuard.test.js unit/rateLimit.test.js
```

## Troubleshooting

**Can't access dashboard from Docker container:**
- Add container network to `ipWhitelist`: `["172.17.0.0/16"]`

**Rate limited after failed logins:**
- Wait 15 minutes or restart server to clear rate limit cache

**Audit log not writing:**
- Check `data/` directory permissions
- Check `auditLogEnabled` setting
