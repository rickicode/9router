# Dashboard Authorization Security Fix - Design Document

**Issue:** #742 - Authorization Logic Flaw in Web Dashboard  
**Date:** 2026-04-24  
**Status:** Design Phase  
**Scope:** Dashboard routes and admin API endpoints only (excludes `/v1/*` endpoints)

---

## Problem Statement

The current dashboard authorization logic in `src/dashboardGuard.js` has a critical vulnerability: it validates localhost access using the `Host` HTTP header, which can be spoofed by attackers. This allows unauthorized access to protected dashboard routes and admin API endpoints by manipulating the Host header to appear as localhost.

**Vulnerable code (lines 24-28, 59-64):**
```javascript
function isLocalRequest(request) {
  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
```

**Attack vector:** An attacker can send requests with `Host: localhost` header from a remote IP and bypass authentication.

---

## Solution Approach

**Defense-in-Depth Strategy:** Multi-layer security with socket-level IP verification, IP whitelist support, audit logging, and rate limiting.

### Key Principles

1. **Socket-level validation** - Verify actual client IP from network socket, not HTTP headers
2. **Configurable whitelist** - Support Docker, container, and custom network deployments
3. **Audit trail** - Log all security-relevant events for monitoring and forensics
4. **Rate limiting** - Prevent brute force attacks on login endpoint
5. **Backwards compatible** - No breaking changes for existing deployments

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Incoming Request                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              dashboardGuard Middleware                      │
│  • Extract real client IP (socket/headers)                  │
│  • Check IP whitelist                                       │
│  • Validate JWT token                                       │
│  • Check tunnel/tailscale permissions                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ├──────────────────┐
                         ▼                  ▼
              ┌──────────────────┐  ┌──────────────────┐
              │  IP Validator    │  │  Audit Logger    │
              │  • Socket IP     │  │  • Log events    │
              │  • Whitelist     │  │  • Rotate logs   │
              │  • CIDR match    │  │  • Format JSON   │
              └──────────────────┘  └──────────────────┘
                         │
                         ▼
              ┌──────────────────────────────┐
              │  Allow/Deny Decision         │
              │  • Log to audit trail        │
              │  • Return 401 or NextResponse│
              └──────────────────────────────┘
```

---

## Component Details

### 1. IP Validator Module

**File:** `src/lib/security/ipValidator.js` (new)

**Purpose:** Replace Host header validation with socket-level IP verification

**Key Functions:**

#### `getClientIP(request)`
Extracts real client IP from request with priority order:
1. Socket connection IP (Node.js `request.socket.remoteAddress`)
2. `X-Forwarded-For` header (only if `trustedProxyEnabled` setting is true)
3. `X-Real-IP` header (fallback)

Returns normalized IP string (IPv4 or IPv6).

#### `isLocalRequest(request, settings)`
Validates if request originates from localhost or whitelisted IP.

**Logic:**
```javascript
const clientIP = getClientIP(request);
const whitelist = settings.ipWhitelist || DEFAULT_WHITELIST;
return isWhitelistedIP(clientIP, whitelist);
```

#### `isWhitelistedIP(ip, whitelist)`
Checks if IP matches any entry in whitelist. Supports:
- Exact IP match: `127.0.0.1`, `::1`
- CIDR ranges: `172.17.0.0/16`, `10.0.0.0/8`

**Default Whitelist:**
```javascript
[
  "127.0.0.1",      // IPv4 localhost
  "::1",            // IPv6 localhost
  "172.17.0.0/16",  // Docker bridge network
]
```

**Edge Cases:**
- Invalid IP format → Deny access
- IPv4-mapped IPv6 (`::ffff:127.0.0.1`) → Normalize to IPv4
- Missing socket info → Fall back to header-based extraction with warning log

---

### 2. Audit Logger

**File:** `src/lib/security/auditLog.js` (new)

**Purpose:** Track all security-relevant events for monitoring and forensics

**Events Logged:**

| Event Type | Trigger | Fields |
|------------|---------|--------|
| `auth_bypass_attempt` | Localhost/whitelist check | `ip`, `path`, `allowed`, `reason` |
| `jwt_validation_failed` | Invalid/expired JWT | `ip`, `path`, `error` |
| `tunnel_access_attempt` | Tunnel/tailscale request | `ip`, `host`, `allowed`, `tunnelUrl` |
| `login_attempt` | Login endpoint hit | `ip`, `success`, `reason` |
| `rate_limit_exceeded` | Too many login attempts | `ip`, `attempts`, `resetAt` |
| `settings_changed` | Security settings modified | `ip`, `field`, `oldValue`, `newValue` |

**Log Format:**
```json
{
  "timestamp": "2026-04-24T10:30:00.000Z",
  "event": "auth_bypass_attempt",
  "ip": "192.168.1.100",
  "path": "/api/settings",
  "allowed": false,
  "reason": "ip_not_whitelisted"
}
```

**Storage:**
- File: `data/audit.log`
- Format: Newline-delimited JSON (NDJSON)
- Rotation: When file exceeds `auditLogMaxSize` (default 10MB)
- Retention: Keep last 3 rotated files (`audit.log.1`, `audit.log.2`, `audit.log.3`)

**API:**
```javascript
auditLog.log(event, data);
auditLog.query({ startDate, endDate, eventType, ip }); // Future: query logs
```

**Error Handling:**
- If log write fails → Log to console, continue operation (don't block requests)
- If disk full → Disable audit logging, emit warning

---

### 3. Updated Dashboard Guard

**File:** `src/dashboardGuard.js` (modified)

**Changes:**

#### Replace `isLocalRequest()` function
```javascript
// OLD (vulnerable):
function isLocalRequest(request) {
  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

// NEW (secure):
import { isLocalRequest } from "@/lib/security/ipValidator";
// Use imported function with settings parameter
```

#### Add audit logging
```javascript
import { auditLog } from "@/lib/security/auditLog";

// Log all auth decisions
if (!allowed) {
  auditLog.log("auth_bypass_attempt", {
    ip: getClientIP(request),
    path: pathname,
    allowed: false,
    reason: "ip_not_whitelisted"
  });
}
```

#### Strengthen tunnel/tailscale validation
```javascript
// OLD (vulnerable to URL manipulation):
const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";

// NEW (safe):
function getTunnelHostname(tunnelUrl) {
  if (!tunnelUrl || typeof tunnelUrl !== "string") return "";
  try {
    const url = new URL(tunnelUrl);
    // Only allow http/https protocols
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.hostname.toLowerCase();
  } catch {
    return ""; // Invalid URL format
  }
}
```

**Updated Flow:**
```
1. Extract pathname from request
2. Load settings from DB
3. Get client IP via ipValidator.getClientIP()
4. Check if path requires protection
5. If ALWAYS_PROTECTED:
   - Check if IP is whitelisted OR has valid JWT
   - Log decision
   - Allow/Deny
6. If PROTECTED_API_PATHS:
   - Check if IP is whitelisted OR authenticated (JWT or requireLogin=false)
   - Log decision
   - Allow/Deny
7. If /dashboard route:
   - Check tunnel/tailscale access permissions
   - Verify JWT if requireLogin=true
   - Log decision
   - Allow/Deny
8. Return NextResponse
```

---

### 4. Settings Schema Update

**File:** `src/lib/localDb.js` (modified)

**Add to `DEFAULT_SETTINGS`:**
```javascript
const DEFAULT_SETTINGS = {
  // ... existing settings ...
  
  // IP Whitelist Configuration
  ipWhitelist: ["127.0.0.1", "::1", "172.17.0.0/16"],
  trustedProxyEnabled: false, // Enable X-Forwarded-For trust
  
  // Audit Logging
  auditLogEnabled: true,
  auditLogMaxSize: 10485760, // 10MB
};
```

**Settings API:**
- `GET /api/settings` - Returns all settings including new security fields
- `POST /api/settings` - Updates settings, logs changes to audit trail

**Validation:**
- `ipWhitelist` must be array of valid IP/CIDR strings
- `auditLogMaxSize` must be positive integer (min 1MB, max 100MB)

---

### 5. Rate Limiting

**File:** `src/app/api/auth/login/route.js` (modified)

**Implementation:**

```javascript
// In-memory rate limit store
const loginAttempts = new Map(); // { ip: { count, resetAt } }

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts.entries()) {
    if (data.resetAt < now) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  
  if (!record || record.resetAt < now) {
    // First attempt or expired window
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return { allowed: true };
  }
  
  if (record.count >= 5) {
    // Rate limit exceeded
    return { 
      allowed: false, 
      resetAt: record.resetAt,
      remainingMs: record.resetAt - now 
    };
  }
  
  // Increment counter
  record.count++;
  return { allowed: true };
}
```

**Behavior:**
- Max 5 login attempts per IP per 15 minutes
- Returns 429 with `Retry-After` header when exceeded
- Counter resets after 15 minutes
- Cleanup runs every 5 minutes to prevent memory leak

**Response on rate limit:**
```json
{
  "error": "Too many login attempts. Try again in 14 minutes.",
  "retryAfter": 840
}
```

---

## Error Handling

### Failure Scenarios

| Scenario | Behavior | Fallback |
|----------|----------|----------|
| IP extraction fails | Deny access | Log error, return 401 |
| Whitelist config invalid | Use default whitelist | Log warning |
| Audit log write fails | Continue operation | Log to console |
| Rate limit store full | Clear expired entries | Continue operation |
| Settings DB unavailable | Use cached settings | Log error, use defaults |
| Tunnel URL invalid | Treat as no tunnel | Log warning |

### Logging Strategy

**Console logs (development):**
- All security events
- IP validation results
- Rate limit hits

**Audit logs (production):**
- Auth bypass attempts
- Failed JWT validations
- Rate limit exceeded
- Settings changes

**Error logs:**
- IP extraction failures
- Audit log write failures
- Settings DB errors

---

## Testing Strategy

### Unit Tests

**IP Validator (`ipValidator.test.js`):**
- IPv4 exact match
- IPv6 exact match
- CIDR range matching (IPv4 and IPv6)
- IPv4-mapped IPv6 normalization
- Invalid IP format handling
- X-Forwarded-For parsing (with/without trusted proxy)

**Audit Logger (`auditLog.test.js`):**
- Log formatting
- File rotation
- Query functionality
- Error handling (disk full, permission denied)

**Rate Limiter (`rateLimit.test.js`):**
- Counter increment
- Window expiration
- Cleanup logic
- Memory leak prevention

### Integration Tests

**Dashboard Access (`dashboardGuard.test.js`):**
- Localhost access (IPv4, IPv6)
- Docker container access (172.17.x.x)
- Remote access (should deny)
- Valid JWT from remote IP (should allow)
- Tunnel access with/without permission
- Tailscale access with/without permission

**Login Endpoint (`login.test.js`):**
- Successful login
- Failed login (wrong password)
- Rate limiting (6th attempt blocked)
- Rate limit reset after 15 minutes
- Tunnel login blocked when disabled

### Security Tests

**Penetration Testing:**
- Host header spoofing (`Host: localhost`)
- X-Forwarded-For manipulation (`X-Forwarded-For: 127.0.0.1`)
- Tunnel URL manipulation (protocol injection, path traversal)
- JWT token tampering
- Brute force login attempts

**Expected Results:**
- All spoofing attempts denied
- Audit log captures all attempts
- Rate limiting blocks brute force
- No bypass via header manipulation

---

## Migration & Backwards Compatibility

### No Breaking Changes

**Existing deployments work without config changes:**
- Default whitelist includes localhost and Docker networks
- Existing `requireLogin` and `tunnelDashboardAccess` settings preserved
- Audit logging optional (can be disabled via `auditLogEnabled: false`)

### Upgrade Path

1. **Deploy new code** - No config changes required
2. **Automatic migration:**
   - New settings added to DB with defaults
   - Existing settings preserved
   - Audit log starts recording immediately
3. **Optional configuration:**
   - Add custom IPs to `ipWhitelist` if needed
   - Enable `trustedProxyEnabled` if behind reverse proxy
   - Adjust `auditLogMaxSize` if needed

### Rollback Plan

If issues arise:
1. Revert code to previous version
2. Old settings still work (new fields ignored)
3. Audit logs preserved for investigation

---

## Performance Impact

### Memory Usage

- **IP Validator:** Negligible (~1KB for whitelist)
- **Audit Logger:** ~10MB max (rotated)
- **Rate Limiter:** ~100 bytes per IP (max ~10KB for 100 IPs)

**Total:** ~10MB additional memory

### CPU Impact

- **IP validation:** ~0.1ms per request (CIDR matching)
- **Audit logging:** ~0.5ms per event (async write)
- **Rate limiting:** ~0.05ms per login attempt (Map lookup)

**Total:** Negligible impact (<1ms per request)

### Disk I/O

- **Audit logs:** ~1KB per event, batched writes every 1 second
- **Settings DB:** No additional writes (only on config change)

**Total:** ~1MB/day for typical usage (1000 events/day)

---

## Security Considerations

### Threat Model

**Threats Mitigated:**
- ✅ Host header spoofing
- ✅ X-Forwarded-For manipulation (when `trustedProxyEnabled=false`)
- ✅ Brute force login attacks
- ✅ Tunnel URL manipulation
- ✅ Unauthorized dashboard access

**Threats NOT Mitigated (out of scope):**
- ❌ DDoS attacks (needs infrastructure-level protection)
- ❌ SQL injection (no SQL database used)
- ❌ XSS attacks (needs CSP headers, separate issue)
- ❌ CSRF attacks (needs CSRF tokens, separate issue)

### Defense in Depth

**Layer 1:** IP whitelist (network-level)  
**Layer 2:** JWT authentication (application-level)  
**Layer 3:** Rate limiting (abuse prevention)  
**Layer 4:** Audit logging (detection & forensics)

---

## Future Enhancements

**Not in scope for this fix, but recommended:**

1. **CSRF Protection** - Add CSRF tokens to forms
2. **CSP Headers** - Prevent XSS attacks
3. **2FA Support** - Multi-factor authentication
4. **Session Management** - Track active sessions, force logout
5. **Audit Log UI** - Dashboard page to view security events
6. **IP Geolocation** - Log country/city for suspicious IPs
7. **Webhook Alerts** - Notify on suspicious activity

---

## Implementation Checklist

- [ ] Create `src/lib/security/ipValidator.js`
- [ ] Create `src/lib/security/auditLog.js`
- [ ] Update `src/dashboardGuard.js`
- [ ] Update `src/lib/localDb.js` (add settings)
- [ ] Update `src/app/api/auth/login/route.js` (add rate limiting)
- [ ] Write unit tests for IP validator
- [ ] Write unit tests for audit logger
- [ ] Write unit tests for rate limiter
- [ ] Write integration tests for dashboard guard
- [ ] Write security tests (penetration testing)
- [ ] Update documentation (README, security guide)
- [ ] Test Docker deployment
- [ ] Test tunnel/tailscale scenarios
- [ ] Verify backwards compatibility
- [ ] Performance testing (load test)

---

## Approval

**Design Status:** Pending Review

**Reviewer:** User  
**Date:** 2026-04-24

**Sign-off:**
- [ ] Architecture approved
- [ ] Security approach validated
- [ ] Performance impact acceptable
- [ ] Testing strategy sufficient
- [ ] Ready for implementation

---

## References

- Issue #742: https://github.com/decolua/9router/issues/742
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/
