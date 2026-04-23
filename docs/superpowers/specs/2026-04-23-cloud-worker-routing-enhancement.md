# Cloud Worker Routing Enhancement

**Date:** 2026-04-23  
**Status:** Approved  
**Type:** Enhancement

## Overview

Enhance the existing `/cloud` Cloudflare Worker to support advanced routing features: round-robin load balancing, sticky sessions, real-time usage tracking, and settings synchronization from 9Router.

## Goals

1. Enable round-robin credential rotation per provider
2. Support sticky sessions for consistent routing
3. Track usage statistics in real-time
4. Sync routing settings from 9Router to worker
5. Provide health status monitoring
6. Maintain backward compatibility with existing cloud worker

## Non-Goals

- Autonomous token refresh (9Router remains control plane)
- Historical usage analytics (memory-only tracking)
- Multi-region state synchronization
- Provider-specific routing logic

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────┐
│  9Router (localhost:20128)                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Job Scheduler (after quota check completes)     │   │
│  │ 1. Check & refresh tokens                       │   │
│  │ 2. Check quota/usage                            │   │
│  │ 3. Push config to worker (POST /sync/:machineId)│   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Usage Poller (every 1 second)                   │   │
│  │ GET /worker/usage/:machineId                    │   │
│  │ → Update dashboard with real-time stats         │   │
│  └─────────────────────────────────────────────────┘   │
└────────────┬────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker (enhanced)                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ D1 Storage (persistent)                         │   │
│  │ - Config: credentials, settings, models, combos │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Memory State (ephemeral)                        │   │
│  │ - Round-robin indexes per provider              │   │
│  │ - Sticky session map (apiKey → connectionId)    │   │
│  │ - Usage stats per connection                    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Endpoints:                                             │
│  - POST /sync/:machineId (enhanced with settings)      │
│  - GET /worker/usage/:machineId (NEW)                  │
│  - GET /worker/health/:machineId (NEW)                 │
│  - POST /v1/chat/completions (enhanced routing)        │
│  - POST /v1/messages (enhanced routing)                │
└─────────────────────────────────────────────────────────┘
```

### Components

**9Router (Control Plane):**
- Manages all credentials and token refresh
- Pushes config to worker after quota check job
- Polls usage every 1 second
- Displays health status in dashboard

**Cloudflare Worker (Execution Layer):**
- Receives config from 9Router
- Stores config in D1 (persistent)
- Maintains routing state in memory (ephemeral)
- Routes requests using round-robin/sticky logic
- Tracks usage statistics
- Reports health status

## Data Structures

### Enhanced Sync Payload

**Endpoint:** `POST /sync/:machineId`

**Request Body:**
```json
{
  "providers": [
    {
      "id": "conn_123",
      "provider": "codex",
      "accountId": "user@email.com",
      "accessToken": "eyJ...",
      "refreshToken": "rt_...",
      "expiresAt": "2026-04-23T19:00:00Z",
      "isActive": true
    }
  ],
  "modelAliases": {
    "if/kimi-k2": {
      "provider": "kimi-coding",
      "model": "kimi-k2-thinking"
    }
  },
  "combos": [
    {
      "name": "if/kimi-k2-thinking",
      "models": [
        "kimi-coding/kimi-k2-thinking",
        "codex/claude-sonnet-4.5"
      ]
    }
  ],
  "settings": {
    "roundRobin": true,
    "sticky": false,
    "stickyDuration": 300,
    "comboStrategy": "fallback",
    "comboStrategies": {
      "if/kimi-k2-thinking": {
        "fallbackStrategy": "round-robin"
      }
    },
    "providerStrategies": {}
  }
}
```

**Response:**
```json
{
  "success": true,
  "syncId": "sync_1745342400000",
  "receivedAt": "2026-04-23T18:00:01.234Z",
  "credentialsCount": 5,
  "modelsCount": 10,
  "combosCount": 3
}
```

### In-Memory State

```javascript
const workerState = {
  // Round-robin indexes per provider
  roundRobinIndexes: new Map(),  // "provider" → index
  
  // Sticky sessions
  stickyMap: new Map(),          // apiKey → {connectionId, expiresAt}
  
  // Usage tracking per connection
  usage: new Map(),              // connectionId → {requests, tokensInput, tokensOutput, errors, lastUsed}
  
  // Last sync timestamp
  lastSyncAt: null
};
```

### Usage Response

**Endpoint:** `GET /worker/usage/:machineId`

**Response:**
```json
{
  "timestamp": "2026-04-23T18:00:05Z",
  "lastSyncAt": "2026-04-23T18:00:00Z",
  "usage": {
    "conn_123": {
      "requests": 45,
      "tokensInput": 12500,
      "tokensOutput": 8300,
      "errors": 2,
      "lastUsed": "2026-04-23T18:00:03Z"
    },
    "conn_456": {
      "requests": 23,
      "tokensInput": 6700,
      "tokensOutput": 4200,
      "errors": 0,
      "lastUsed": "2026-04-23T18:00:04Z"
    }
  }
}
```

### Health Status Response

**Endpoint:** `GET /worker/health/:machineId`

**Response:**
```json
{
  "status": "healthy",
  "lastSyncAt": "2026-04-23T18:00:00Z",
  "syncAge": 45,
  "details": {
    "hasMachineData": true,
    "credentialsCount": 5,
    "lastSyncError": null,
    "uptime": 3600
  }
}
```

**Status Values:**
- `healthy`: Last sync < 60s ago
- `degraded`: Last sync 60-300s ago (sync failing but still working)
- `down`: Last sync > 300s ago OR no machine data

## Routing Logic

### Credential Selection Algorithm

```javascript
function selectCredential(machineData, provider, apiKey) {
  const settings = machineData.settings || {};
  
  // 1. Get all eligible credentials for provider
  const candidates = Object.values(machineData.providers)
    .filter(p => p.provider === provider && p.isActive);
  
  if (candidates.length === 0) {
    throw new Error(`No credentials for provider: ${provider}`);
  }
  
  if (candidates.length === 1) {
    return candidates[0]; // Only one option
  }
  
  // 2. Check sticky session
  if (settings.sticky) {
    const sticky = workerState.stickyMap.get(apiKey);
    if (sticky && sticky.expiresAt > Date.now()) {
      const found = candidates.find(c => c.id === sticky.connectionId);
      if (found) return found;
    }
  }
  
  // 3. Apply round-robin
  if (settings.roundRobin) {
    const key = provider;
    const index = workerState.roundRobinIndexes.get(key) || 0;
    const selected = candidates[index % candidates.length];
    
    // Update index for next request
    workerState.roundRobinIndexes.set(key, index + 1);
    
    // Set sticky if enabled
    if (settings.sticky) {
      workerState.stickyMap.set(apiKey, {
        connectionId: selected.id,
        expiresAt: Date.now() + (settings.stickyDuration * 1000)
      });
    }
    
    return selected;
  }
  
  // 4. Default: first available
  return candidates[0];
}
```

### Usage Tracking

```javascript
function recordUsage(connectionId, tokensInput, tokensOutput, error = null) {
  let stats = workerState.usage.get(connectionId);
  
  if (!stats) {
    stats = {
      requests: 0,
      tokensInput: 0,
      tokensOutput: 0,
      errors: 0,
      lastUsed: null
    };
    workerState.usage.set(connectionId, stats);
  }
  
  stats.requests++;
  stats.tokensInput += tokensInput || 0;
  stats.tokensOutput += tokensOutput || 0;
  if (error) stats.errors++;
  stats.lastUsed = new Date().toISOString();
}
```

### Integration Point

Modify existing `handleSingleModelChat()` in `cloud/src/handlers/chat.js`:

**Before:**
```javascript
const connection = data.providers[providerId]; // First match
```

**After:**
```javascript
const connection = selectCredential(data, provider, apiKey);
// ... call provider ...
recordUsage(connection.id, inputTokens, outputTokens, error);
```

## 9Router Integration

### Sync Trigger

**Location:** After quota check job completes

**Implementation:**
```javascript
// In quota scheduler
async function runQuotaCheckJob() {
  // ... existing quota check logic ...
  
  // After job completes, trigger cloud sync
  if (await isCloudEnabled()) {
    await syncToCloud();
  }
}

// New function in cloudSyncScheduler.js
async function syncToCloud() {
  const machineId = await getConsistentMachineId();
  const cloudUrl = getCloudUrl();
  
  // Get all data
  const connections = await getAllConnections();
  const modelAliases = await getAllModelAliases();
  const combos = await getAllCombos();
  const settings = await getSettings();
  
  // Build payload
  const payload = {
    providers: connections.map(formatConnection),
    modelAliases,
    combos,
    settings: {
      roundRobin: settings.roundRobin || false,
      sticky: settings.sticky || false,
      stickyDuration: settings.stickyDuration || 300,
      comboStrategy: settings.comboStrategy || "fallback",
      comboStrategies: settings.comboStrategies || {},
      providerStrategies: settings.providerStrategies || {}
    }
  };
  
  // POST to worker
  await fetch(`${cloudUrl}/sync/${machineId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
```

### Usage Polling

**New file:** `src/shared/services/cloudUsagePoller.js`

```javascript
export class CloudUsagePoller {
  constructor(machineId, intervalMs = 1000) {
    this.machineId = machineId;
    this.intervalMs = intervalMs;
    this.intervalId = null;
  }
  
  start() {
    if (this.intervalId) return;
    
    this.intervalId = setInterval(async () => {
      try {
        await this.poll();
      } catch (err) {
        console.error('[USAGE_POLL] Error:', err);
      }
    }, this.intervalMs);
  }
  
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  async poll() {
    const cloudUrl = getCloudUrl();
    const response = await fetch(`${cloudUrl}/worker/usage/${this.machineId}`);
    
    if (!response.ok) return;
    
    const data = await response.json();
    
    // Update local usage DB
    for (const [connId, usage] of Object.entries(data.usage)) {
      await updateConnectionUsage(connId, usage);
    }
  }
}
```

### Settings UI

**Location:** Dashboard → Settings → Cloud

**New Settings:**
- Enable Round-Robin (toggle)
- Enable Sticky Sessions (toggle)
- Sticky Duration (number input, seconds)
- Default Combo Strategy (dropdown: fallback, round-robin, parallel)

**Storage:** Add to `DEFAULT_SETTINGS` in `src/lib/localDb.js`:
```javascript
{
  roundRobin: false,
  sticky: false,
  stickyDuration: 300,
  // existing settings...
}
```

### Dashboard Health Status

**Location:** Dashboard → Endpoint page

**Display:**
```
☁️ Cloud Worker: ● Healthy (synced 12s ago)
                 ⚠️ Degraded (last sync 2m ago - retrying...)
                 ● Down (no sync for 5m)
```

## Error Handling

### Cold Start Recovery

**Problem:** Worker restarts → memory state lost

**Solution:**
- Round-robin indexes: Reset to 0 (rebalances naturally)
- Sticky sessions: Expire immediately (clients get new assignment)
- Usage stats: Lost until next poll (max 1s data loss)
- Config: Load from D1 (no downtime)

### Sync Failure

**Problem:** 9Router → Worker sync fails

**Solution:**
- Worker continues using last known config from D1
- Health endpoint shows `degraded` status with `lastSyncError`
- 9Router dashboard shows warning badge
- No downtime for clients (routing with stale config)
- 9Router retries with exponential backoff

### Usage Poll Failure

**Problem:** 9Router ← Worker usage poll fails

**Solution:**
- Silent failure (log error only)
- Dashboard shows last known usage
- No impact on routing
- Continue polling

### Token Expiry During Request

**Problem:** Token expires between sync and request

**Solution:**
- Worker checks token expiry before request (existing logic)
- Refresh token if needed (existing `refreshTokenByProvider`)
- Update D1 with new token
- Continue request

### Multiple Edge Instances

**Problem:** Cloudflare deploys worker to multiple edge locations

**Solution:**
- Round-robin indexes diverge (acceptable, balanced globally)
- Sticky sessions work per-instance (client hits same edge)
- Usage stats aggregate when 9Router polls
- No synchronization needed

## Implementation Files

### Worker (Cloudflare)

**New Files:**
- `cloud/src/services/routing.js` - Credential selection logic
- `cloud/src/services/usage.js` - Usage tracking
- `cloud/src/handlers/usage.js` - GET /worker/usage handler
- `cloud/src/handlers/health.js` - GET /worker/health handler

**Modified Files:**
- `cloud/src/handlers/sync.js` - Accept settings field
- `cloud/src/handlers/chat.js` - Use routing.js for credential selection
- `cloud/src/index.js` - Add usage & health routes

### 9Router

**New Files:**
- `src/shared/services/cloudUsagePoller.js` - Usage polling service

**Modified Files:**
- `src/shared/services/cloudSyncScheduler.js` - Trigger sync after quota job
- `src/lib/localDb.js` - Add routing settings to DEFAULT_SETTINGS
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` - Show health status
- `src/app/(dashboard)/dashboard/settings/page.js` - Add routing settings UI

## Testing Strategy

### Unit Tests

- Credential selection algorithm (all scenarios)
- Usage tracking (increment, error handling)
- Health status calculation (healthy, degraded, down)

### Integration Tests

- Sync flow (9Router → Worker)
- Usage poll flow (9Router ← Worker)
- Round-robin rotation (multiple requests)
- Sticky session persistence

### Manual Tests

- Cold start recovery
- Sync failure handling
- Token refresh during request
- Multiple concurrent requests

## Rollout Plan

1. Implement worker changes (routing, usage, health)
2. Deploy worker to staging
3. Test with single machineId
4. Implement 9Router changes (sync, polling, UI)
5. Test end-to-end flow
6. Deploy to production
7. Monitor health status and usage stats

## Success Metrics

- Round-robin distributes load evenly across credentials
- Sticky sessions maintain consistency for duration
- Usage stats update within 1 second
- Health status reflects sync state accurately
- Zero downtime during sync failures
- Backward compatible with existing cloud worker users

## Future Enhancements

- Per-provider round-robin strategies
- Historical usage analytics (D1 storage)
- Multi-region state synchronization
- Advanced routing rules (quota-aware, latency-based)
- Usage-based alerting
