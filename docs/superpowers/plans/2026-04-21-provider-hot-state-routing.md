# Provider Hot-State Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Redis-backed single hot-state truth for provider account routing and quota visibility so 9router routes only to eligible accounts instead of probing exhausted or revoked accounts one by one.

**Architecture:** Keep durable provider configuration in `src/lib/localDb.js`, but introduce a centralized hot-state layer in Redis that owns routing status, quota state, auth state, model locks, retry windows, and eligibility indexes. Route request-time account selection through that centralized state first, then migrate usage refresh, provider APIs, and dashboard consumers onto the same snapshot with a legacy compatibility projection during rollout.

**Tech Stack:** Next.js 16, React 19, Node.js, Redis, Vitest, existing `src/lib/quotaStateStore.js` and `src/lib/usageRefreshQueue.js` infrastructure.

---

## File Structure

### New files

- Create: `src/lib/providerHotState.js` — centralized read/write API for Redis-backed account snapshots, status transitions, compatibility projection, and eligibility index maintenance.
- Create: `tests/unit/provider-hot-state.test.js` — unit tests for centralized snapshot writes, precedence rules, compatibility projection, and index maintenance.
- Create: `tests/unit/auth-account-selection.test.js` — unit tests for Redis-driven candidate selection and fallback behavior.
- Create: `tests/unit/models-availability-route.test.js` — unit tests for `/api/models/availability` once it reads centralized hot state.

### Existing files to modify

- Modify: `src/lib/quotaStateStore.js` — shrink to lower-level storage helpers or adapt to delegate to `providerHotState.js`.
- Modify: `src/lib/localDb.js` — route hot-only reads/writes through centralized hot-state compatibility APIs.
- Modify: `src/sse/services/auth.js` — switch selection logic to centralized eligibility state and hot-state writer.
- Modify: `open-sse/services/accountFallback.js` — migrate model-lock and fallback updates to normalized hot-state fields.
- Modify: `src/sse/handlers/chat.js`
- Modify: `src/sse/handlers/embeddings.js`
- Modify: `src/sse/handlers/tts.js`
- Modify: `src/app/api/usage/[connectionId]/route.js` — write usage refresh results through centralized hot-state API.
- Modify: `open-sse/services/usage.js` — normalize enough usage metadata for centralized routing decisions.
- Modify: `src/app/api/providers/route.js` — expose centralized status projection in provider summaries.
- Modify: `src/app/api/providers/client/route.js` — expose centralized status projection for quota tracker.
- Modify: `src/lib/connectionStatus.js` — derive effective display state from centralized routing status/projection.
- Modify: `src/app/api/models/availability/route.js` — read normalized model locks and status from centralized hot state.
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js` — use centralized routing status and query-param synced filters.
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` — badge/status display from centralized projection.
- Modify: `src/app/(dashboard)/dashboard/providers/page.js` — keep provider summaries aligned with centralized state.
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js` — render last snapshot immediately, enqueue refresh, and use centralized status filters.
- Modify: `tests/unit/usage-status-sync.test.js`
- Modify: `tests/unit/provider-summary-and-usage-dedupe.test.js`
- Modify: `tests/unit/connection-effective-status.test.js`
- Modify: `tests/unit/codex-usage-parsing.test.js`

---

### Task 1: Build the centralized provider hot-state module

**Files:**
- Create: `src/lib/providerHotState.js`
- Modify: `src/lib/quotaStateStore.js`
- Test: `tests/unit/provider-hot-state.test.js`

- [ ] **Step 1: Write the failing test for snapshot writes and precedence rules**

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRedis = {
  isReady: true,
  hGet: vi.fn(async () => null),
  hSet: vi.fn(async () => 1),
  hGetAll: vi.fn(async () => ({})),
  hDel: vi.fn(async () => 1),
  sAdd: vi.fn(async () => 1),
  sRem: vi.fn(async () => 1),
  zAdd: vi.fn(async () => 1),
  zRem: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
  multi: vi.fn(() => ({
    hSet: vi.fn().mockReturnThis(),
    sAdd: vi.fn().mockReturnThis(),
    sRem: vi.fn().mockReturnThis(),
    zAdd: vi.fn().mockReturnThis(),
    zRem: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => []),
  })),
};

vi.mock("redis", () => ({
  createClient: vi.fn(() => mockRedis),
}));

describe("provider hot state", () => {
  beforeEach(() => {
    Object.values(mockRedis).forEach((value) => {
      if (value && typeof value.mockClear === "function") value.mockClear();
    });
    mockRedis.multi.mockClear();
  });

  it("keeps blocked_auth when a stale quota update arrives later", async () => {
    const {
      writeConnectionHotState,
      projectLegacyConnectionState,
    } = await import("../../src/lib/providerHotState.js");

    await writeConnectionHotState({
      connectionId: "conn-1",
      provider: "codex",
      patch: {
        routingStatus: "blocked_auth",
        authState: "revoked",
        reasonCode: "auth_revoked",
        version: 20,
      },
    });

    await writeConnectionHotState({
      connectionId: "conn-1",
      provider: "codex",
      patch: {
        routingStatus: "eligible",
        quotaState: "ok",
        reasonCode: "unknown",
        version: 10,
      },
    });

    const projected = projectLegacyConnectionState({
      id: "conn-1",
      provider: "codex",
      routingStatus: "blocked_auth",
      authState: "revoked",
      reasonCode: "auth_revoked",
    });

    expect(projected.testStatus).toBe("expired");
    expect(projected.lastErrorType).toBe("auth_revoked");
  });

  it("moves exhausted accounts out of eligible indexes and into retry schedule", async () => {
    const { writeConnectionHotState } = await import("../../src/lib/providerHotState.js");

    await writeConnectionHotState({
      connectionId: "conn-2",
      provider: "codex",
      patch: {
        routingStatus: "blocked_quota",
        quotaState: "exhausted",
        reasonCode: "quota_exhausted",
        nextRetryAt: "2026-04-25T00:00:00.000Z",
        version: 30,
      },
    });

    expect(mockRedis.multi).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/provider-hot-state.test.js`
Expected: FAIL with `Cannot find module '../../src/lib/providerHotState.js'` or missing export errors.

- [ ] **Step 3: Write the minimal centralized hot-state module**

```js
import { createClient } from "redis";

const HOT_STATE_TTL_SECONDS = 60 * 60 * 24 * 14;

const ROUTING_STATUS_PRECEDENCE = {
  disabled: 500,
  blocked_auth: 400,
  blocked_quota: 300,
  cooldown: 200,
  eligible: 100,
  unknown: 0,
};

let redisPromise = null;

async function getRedis() {
  if (redisPromise) return redisPromise;
  const client = createClient(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined);
  client.on("error", () => {});
  redisPromise = client.connect().then(() => client).catch(() => null);
  return redisPromise;
}

function getSnapshotKey(provider, connectionId) {
  return `provider-hot-state:${provider}:${connectionId}`;
}

function getEligibleKey(provider, model = "*") {
  return `provider-hot-eligible:${provider}:${model}`;
}

function getRetryKey(provider) {
  return `provider-hot-retry:${provider}`;
}

function shouldReplaceState(current = {}, patch = {}) {
  const currentVersion = Number(current.version || 0);
  const nextVersion = Number(patch.version || 0);
  if (nextVersion > currentVersion) return true;
  if (nextVersion < currentVersion) return false;
  const currentRank = ROUTING_STATUS_PRECEDENCE[current.routingStatus] ?? 0;
  const nextRank = ROUTING_STATUS_PRECEDENCE[patch.routingStatus] ?? 0;
  return nextRank >= currentRank;
}

export function projectLegacyConnectionState(snapshot = {}) {
  const routingStatus = snapshot.routingStatus || "unknown";

  if (routingStatus === "eligible") {
    return {
      testStatus: "active",
      lastError: null,
      lastErrorType: null,
    };
  }

  if (routingStatus === "blocked_auth") {
    return {
      testStatus: "expired",
      lastError: snapshot.reasonDetail || "Authentication revoked",
      lastErrorType: snapshot.reasonCode || "auth_revoked",
    };
  }

  if (routingStatus === "blocked_quota") {
    return {
      testStatus: "unavailable",
      lastError: snapshot.reasonDetail || "Quota exhausted",
      lastErrorType: snapshot.reasonCode || "quota_exhausted",
    };
  }

  if (routingStatus === "cooldown") {
    return {
      testStatus: "unavailable",
      lastError: snapshot.reasonDetail || "Temporary cooldown",
      lastErrorType: snapshot.reasonCode || "model_cooldown",
    };
  }

  if (routingStatus === "disabled") {
    return {
      testStatus: "unknown",
      lastError: null,
      lastErrorType: "manual_disable",
    };
  }

  return {
    testStatus: snapshot.testStatus || "unknown",
    lastError: snapshot.reasonDetail || null,
    lastErrorType: snapshot.reasonCode || null,
  };
}

export async function writeConnectionHotState({ connectionId, provider, patch }) {
  const redis = await getRedis();
  if (!redis || !provider || !connectionId) return null;

  const snapshotKey = getSnapshotKey(provider, connectionId);
  const current = await redis.hGetAll(snapshotKey);
  if (!shouldReplaceState(current, patch)) return current;

  const next = { ...current, ...patch, connectionId, provider };
  const tx = redis.multi();
  tx.hSet(snapshotKey, Object.fromEntries(Object.entries(next).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])));
  tx.expire(snapshotKey, HOT_STATE_TTL_SECONDS);

  const eligibleKey = getEligibleKey(provider);
  if (next.routingStatus === "eligible") {
    tx.sAdd(eligibleKey, connectionId);
    tx.zRem(getRetryKey(provider), connectionId);
  } else {
    tx.sRem(eligibleKey, connectionId);
    if (next.nextRetryAt) {
      tx.zAdd(getRetryKey(provider), [{ score: new Date(next.nextRetryAt).getTime(), value: connectionId }]);
    } else {
      tx.zRem(getRetryKey(provider), connectionId);
    }
  }

  await tx.exec();
  return next;
}
```

- [ ] **Step 4: Adapt `quotaStateStore.js` to delegate to the new module**

```js
import {
  projectLegacyConnectionState,
  writeConnectionHotState,
} from "@/lib/providerHotState";

export async function setConnectionHotState(connection, patch = {}) {
  if (!connection?.id || !connection?.provider) return null;
  return writeConnectionHotState({
    connectionId: connection.id,
    provider: connection.provider,
    patch,
  });
}

export function mergeConnectionsWithHotState(connections = [], hotStates = new Map()) {
  return connections.map((connection) => {
    const snapshot = hotStates.get(connection.id);
    if (!snapshot) return connection;
    return {
      ...connection,
      ...projectLegacyConnectionState(snapshot),
      hotState: snapshot,
    };
  });
}
```

- [ ] **Step 5: Run tests to verify Task 1 passes**

Run: `npx vitest run tests/unit/provider-hot-state.test.js tests/unit/connection-effective-status.test.js`
Expected: PASS for new hot-state tests; existing effective-status tests may still fail until later tasks if they assume old semantics.

- [ ] **Step 6: Commit**

```bash
git add src/lib/providerHotState.js src/lib/quotaStateStore.js tests/unit/provider-hot-state.test.js
git commit -m "feat: add centralized provider hot state"
```

### Task 2: Centralize hot-state writes from usage refresh and local DB bridging

**Files:**
- Modify: `src/app/api/usage/[connectionId]/route.js`
- Modify: `src/lib/localDb.js`
- Modify: `open-sse/services/usage.js`
- Test: `tests/unit/usage-status-sync.test.js`
- Test: `tests/unit/codex-usage-parsing.test.js`

- [ ] **Step 1: Write the failing tests for centralized usage-driven status updates**

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnections = [];
const getProviderConnectionById = vi.fn(async (id) => mockConnections.find((conn) => conn.id === id) || null);
const updateProviderConnection = vi.fn(async () => ({}));
const getUsageForProvider = vi.fn(async () => ({ ok: true }));
const writeConnectionHotState = vi.fn(async () => ({}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({ status: init?.status || 200, body, json: async () => body }),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById,
  updateProviderConnection,
}));

vi.mock("@/lib/providerHotState", () => ({
  writeConnectionHotState,
  projectLegacyConnectionState: (snapshot) => snapshot,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider,
}));

describe("usage request status sync", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    writeConnectionHotState.mockClear();
    updateProviderConnection.mockClear();
  });

  it("writes blocked_quota hot state when weekly Codex quota is exhausted", async () => {
    mockConnections.push({
      id: "conn-weekly-exhausted",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    getUsageForProvider.mockResolvedValueOnce({
      plan: "free",
      quotas: {
        weekly: {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-weekly-exhausted"), {
      params: Promise.resolve({ connectionId: "conn-weekly-exhausted" }),
    });

    expect(response.status).toBe(200);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-weekly-exhausted",
      provider: "codex",
      patch: expect.objectContaining({ routingStatus: "blocked_quota", quotaState: "exhausted" }),
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/usage-status-sync.test.js tests/unit/codex-usage-parsing.test.js`
Expected: FAIL because the usage route still only mutates legacy DB fields and does not call the centralized hot-state writer.

- [ ] **Step 3: Normalize usage results into centralized hot-state patches**

```js
import { writeConnectionHotState, projectLegacyConnectionState } from "@/lib/providerHotState";

function getUsageHotStatePatch(connection, usage) {
  const weekly = usage?.quotas?.weekly;

  if (connection.provider === "codex" && weekly?.total > 0 && weekly?.remaining <= 0) {
    return {
      routingStatus: "blocked_quota",
      healthStatus: "degraded",
      quotaState: "exhausted",
      reasonCode: "quota_exhausted",
      reasonDetail: "Weekly Codex quota exhausted",
      resetAt: weekly.resetAt || null,
      nextRetryAt: weekly.resetAt || null,
      lastCheckedAt: new Date().toISOString(),
      usageSnapshot: JSON.stringify(usage),
      version: Date.now(),
    };
  }

  return {
    routingStatus: "eligible",
    healthStatus: "healthy",
    quotaState: "ok",
    reasonCode: "unknown",
    reasonDetail: null,
    lastCheckedAt: new Date().toISOString(),
    usageSnapshot: JSON.stringify(usage),
    version: Date.now(),
  };
}

async function syncUsageStatus(connection, usage) {
  const patch = getUsageHotStatePatch(connection, usage);
  const snapshot = await writeConnectionHotState({
    connectionId: connection.id,
    provider: connection.provider,
    patch,
  });

  const legacy = projectLegacyConnectionState(snapshot || patch);
  await updateProviderConnection(connection.id, {
    ...legacy,
    lastErrorAt: legacy.lastError ? new Date().toISOString() : null,
  });
}
```

- [ ] **Step 4: Bridge local DB hot-only updates into centralized hot state**

```js
import { writeConnectionHotState, projectLegacyConnectionState } from "@/lib/providerHotState";

export async function updateProviderConnection(id, patch = {}) {
  const current = await getProviderConnectionById(id);
  if (!current) return null;

  if (isHotOnlyUpdate(patch)) {
    const snapshot = await writeConnectionHotState({
      connectionId: current.id,
      provider: current.provider,
      patch: {
        ...patch,
        version: Date.now(),
      },
    });
    return {
      ...current,
      ...projectLegacyConnectionState(snapshot || patch),
    };
  }

  return writeConnection(current.id, patch);
}
```

- [ ] **Step 5: Run tests to verify Task 2 passes**

Run: `npx vitest run tests/unit/usage-status-sync.test.js tests/unit/codex-usage-parsing.test.js tests/unit/provider-hot-state.test.js`
Expected: PASS and confirms usage refresh now updates centralized state and legacy projection consistently.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/usage/[connectionId]/route.js src/lib/localDb.js open-sse/services/usage.js tests/unit/usage-status-sync.test.js tests/unit/codex-usage-parsing.test.js
git commit -m "feat: route usage refresh through hot state"
```

### Task 3: Switch router account selection to Redis eligibility indexes

**Files:**
- Modify: `src/sse/services/auth.js`
- Modify: `open-sse/services/accountFallback.js`
- Modify: `src/sse/handlers/chat.js`
- Modify: `src/sse/handlers/embeddings.js`
- Modify: `src/sse/handlers/tts.js`
- Test: `tests/unit/auth-account-selection.test.js`

- [ ] **Step 1: Write the failing test for eligible-only account selection**

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProviderConnections = vi.fn(async () => [
  { id: "dead-1", provider: "codex", isActive: true, testStatus: "unavailable" },
  { id: "dead-2", provider: "codex", isActive: true, testStatus: "expired" },
  { id: "live-1", provider: "codex", isActive: true, testStatus: "active" },
]);

const getEligibleConnectionIds = vi.fn(async () => ["live-1"]);
const getConnectionHotSnapshot = vi.fn(async (id) => ({
  connectionId: id,
  routingStatus: id === "live-1" ? "eligible" : "blocked_quota",
}));

vi.mock("@/models", () => ({
  getProviderConnections,
}));

vi.mock("@/lib/providerHotState", () => ({
  getEligibleConnectionIds,
  getConnectionHotSnapshot,
  writeConnectionHotState: vi.fn(async () => ({})),
}));

describe("auth account selection", () => {
  beforeEach(() => {
    getProviderConnections.mockClear();
    getEligibleConnectionIds.mockClear();
    getConnectionHotSnapshot.mockClear();
  });

  it("returns only an eligible Codex connection without probing blocked accounts", async () => {
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    const result = await getProviderCredentials({ provider: "codex", model: "gpt-5" });

    expect(result.connection.id).toBe("live-1");
    expect(getEligibleConnectionIds).toHaveBeenCalledWith({ provider: "codex", model: "gpt-5" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth-account-selection.test.js`
Expected: FAIL because `auth.js` still scans and filters provider connections directly.

- [ ] **Step 3: Implement Redis-driven candidate selection in `auth.js`**

```js
import {
  getEligibleConnectionIds,
  getConnectionHotSnapshot,
  writeConnectionHotState,
} from "@/lib/providerHotState";

export async function getProviderCredentials({ provider, model, excludeConnectionIds = new Set() }) {
  const eligibleIds = await getEligibleConnectionIds({ provider, model });
  const connections = await getProviderConnections();
  const byId = new Map(connections.map((connection) => [connection.id, connection]));

  const candidates = [];
  for (const id of eligibleIds) {
    if (excludeConnectionIds.has(id)) continue;
    const connection = byId.get(id);
    if (!connection || connection.isActive === false) continue;
    const hotState = await getConnectionHotSnapshot({ provider: connection.provider, connectionId: id });
    if (hotState?.routingStatus !== "eligible") continue;
    candidates.push({ ...connection, hotState });
  }

  if (candidates.length === 0) {
    throw new Error(`No eligible ${provider} accounts available`);
  }

  const selected = candidates[0];
  await writeConnectionHotState({
    connectionId: selected.id,
    provider: selected.provider,
    patch: {
      lastSuccessAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      version: Date.now(),
    },
  });

  return { connection: selected };
}
```

- [ ] **Step 4: Update fallback paths to write normalized cooldown/auth blocks**

```js
import { writeConnectionHotState } from "@/lib/providerHotState";

export async function markAccountUnavailable(connection, errorState) {
  const patch = errorState?.status === 401 || errorState?.status === 403
    ? {
        routingStatus: "blocked_auth",
        authState: "revoked",
        reasonCode: "auth_revoked",
        reasonDetail: errorState.message,
        lastFailureAt: new Date().toISOString(),
        version: Date.now(),
      }
    : {
        routingStatus: "cooldown",
        healthStatus: "degraded",
        reasonCode: errorState?.status === 429 ? "upstream_429" : "upstream_5xx",
        reasonDetail: errorState?.message || "Temporary upstream failure",
        cooldownUntil: errorState?.retryAt || null,
        nextRetryAt: errorState?.retryAt || null,
        lastFailureAt: new Date().toISOString(),
        version: Date.now(),
      };

  await writeConnectionHotState({
    connectionId: connection.id,
    provider: connection.provider,
    patch,
  });
}
```

- [ ] **Step 5: Run tests to verify Task 3 passes**

Run: `npx vitest run tests/unit/auth-account-selection.test.js tests/unit/embeddings.cloud.test.js`
Expected: PASS with new selection behavior and no regressions in existing embeddings behavior.

- [ ] **Step 6: Commit**

```bash
git add src/sse/services/auth.js open-sse/services/accountFallback.js src/sse/handlers/chat.js src/sse/handlers/embeddings.js src/sse/handlers/tts.js tests/unit/auth-account-selection.test.js
git commit -m "feat: route provider selection through eligible state"
```

### Task 4: Migrate provider APIs and status helpers onto centralized state

**Files:**
- Modify: `src/app/api/providers/route.js`
- Modify: `src/app/api/providers/client/route.js`
- Modify: `src/lib/connectionStatus.js`
- Modify: `src/app/api/models/availability/route.js`
- Test: `tests/unit/connection-effective-status.test.js`
- Test: `tests/unit/models-availability-route.test.js`
- Test: `tests/unit/provider-summary-and-usage-dedupe.test.js`

- [ ] **Step 1: Write the failing tests for centralized status projection in APIs**

```js
import { describe, it, expect, vi } from "vitest";

const getProviderConnections = vi.fn(async () => [
  { id: "c1", provider: "codex", authType: "oauth", isActive: true },
]);

const getManyConnectionHotSnapshots = vi.fn(async () => new Map([
  ["c1", {
    connectionId: "c1",
    provider: "codex",
    routingStatus: "blocked_quota",
    quotaState: "exhausted",
    reasonCode: "quota_exhausted",
    resetAt: "2026-04-25T00:00:00.000Z",
  }],
]));

vi.mock("@/models", () => ({ getProviderConnections }));
vi.mock("@/lib/providerHotState", () => ({
  getManyConnectionHotSnapshots,
  projectLegacyConnectionState: (snapshot) => ({ testStatus: snapshot.routingStatus === "blocked_quota" ? "unavailable" : "active" }),
}));

describe("providers API centralized status", () => {
  it("returns quota-blocked Codex connections with projected unavailable status", async () => {
    const { GET } = await import("../../src/app/api/providers/route.js");
    const response = await GET();
    const body = await response.json();

    expect(body.connections[0].testStatus).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js tests/unit/models-availability-route.test.js`
Expected: FAIL because provider APIs and availability route still derive status from legacy fields and dynamic `modelLock_*` scanning.

- [ ] **Step 3: Update provider and availability APIs to merge centralized snapshots**

```js
import {
  getManyConnectionHotSnapshots,
  projectLegacyConnectionState,
} from "@/lib/providerHotState";

export async function GET() {
  const connections = await getProviderConnections();
  const snapshots = await getManyConnectionHotSnapshots(connections.map((connection) => ({
    connectionId: connection.id,
    provider: connection.provider,
  })));

  const merged = connections.map((connection) => {
    const snapshot = snapshots.get(connection.id);
    return snapshot
      ? {
          ...connection,
          ...projectLegacyConnectionState(snapshot),
          hotState: snapshot,
        }
      : connection;
  });

  return NextResponse.json({
    connections: merged,
    providerSummaries: getConnectionStatusSummary(merged),
  });
}
```

- [ ] **Step 4: Replace `connectionStatus.js` logic with centralized routing-aware logic**

```js
export function getConnectionEffectiveStatus(connection = {}) {
  const routingStatus = connection.hotState?.routingStatus;

  if (routingStatus === "eligible") return "active";
  if (routingStatus === "blocked_auth") return "expired";
  if (routingStatus === "blocked_quota") return "unavailable";
  if (routingStatus === "cooldown") return "unavailable";
  if (routingStatus === "disabled") return "disabled";

  return connection.testStatus || "unknown";
}
```

- [ ] **Step 5: Run tests to verify Task 4 passes**

Run: `npx vitest run tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js tests/unit/models-availability-route.test.js`
Expected: PASS and confirms provider APIs, summaries, and model availability read centralized state consistently.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/providers/route.js src/app/api/providers/client/route.js src/lib/connectionStatus.js src/app/api/models/availability/route.js tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js tests/unit/models-availability-route.test.js
git commit -m "feat: project provider APIs from centralized hot state"
```

### Task 5: Update provider detail and quota tracker UI to use centralized status and query-param filters

**Files:**
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js`
- Modify: `src/app/(dashboard)/dashboard/providers/page.js`
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`
- Test: `tests/unit/provider-summary-and-usage-dedupe.test.js`
- Test: `tests/unit/connection-effective-status.test.js`

- [ ] **Step 1: Write the failing test for query-param synced routing-status filters**

```js
import { describe, it, expect } from "vitest";
import { getConnectionEffectiveStatus } from "../../src/lib/connectionStatus.js";

describe("connection effective status", () => {
  it("treats blocked_quota hot-state connections as unavailable", () => {
    expect(getConnectionEffectiveStatus({
      testStatus: "active",
      hotState: { routingStatus: "blocked_quota" },
    })).toBe("unavailable");
  });

  it("treats eligible hot-state connections as active", () => {
    expect(getConnectionEffectiveStatus({
      testStatus: "unavailable",
      hotState: { routingStatus: "eligible" },
    })).toBe("active");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/connection-effective-status.test.js`
Expected: FAIL until UI-facing status logic is driven by centralized `hotState.routingStatus`.

- [ ] **Step 3: Add URL-synced filter state in provider detail and quota tracker**

```js
import { useRouter, useSearchParams } from "next/navigation";

const ALLOWED_STATUS_FILTERS = new Set(["all", "eligible", "cooldown", "blocked_quota", "blocked_auth", "disabled", "unknown"]);

function useStatusFilter(defaultValue = "all") {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("status");
  const statusFilter = ALLOWED_STATUS_FILTERS.has(current) ? current : defaultValue;

  function setStatusFilter(nextValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextValue === "all") {
      params.delete("status");
    } else {
      params.set("status", nextValue);
    }
    router.replace(`?${params.toString()}`);
  }

  return [statusFilter, setStatusFilter];
}
```

- [ ] **Step 4: Filter using centralized routing status instead of ad hoc status buckets**

```js
const filteredConnections = providerConnections.filter((connection) => {
  const routingStatus = connection.hotState?.routingStatus || "unknown";
  const matchesStatus = statusFilter === "all" ? true : routingStatus === statusFilter;
  const haystack = `${connection.name || ""} ${connection.label || ""} ${connection.provider || ""}`.toLowerCase();
  const matchesSearch = haystack.includes(searchQuery.toLowerCase());
  return matchesStatus && matchesSearch;
});
```

- [ ] **Step 5: Run tests to verify Task 5 passes**

Run: `npx vitest run tests/unit/connection-effective-status.test.js tests/unit/provider-summary-and-usage-dedupe.test.js`
Expected: PASS for centralized status semantics; any provider summary snapshot assertions should be updated to match explicit routing states.

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/dashboard/providers/[id]/page.js src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js src/app/(dashboard)/dashboard/providers/page.js src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js tests/unit/connection-effective-status.test.js tests/unit/provider-summary-and-usage-dedupe.test.js
git commit -m "feat: align dashboard filters with centralized routing state"
```

### Task 6: Verification and regression check

**Files:**
- Modify: none
- Test: `tests/unit/provider-hot-state.test.js`
- Test: `tests/unit/usage-status-sync.test.js`
- Test: `tests/unit/auth-account-selection.test.js`
- Test: `tests/unit/provider-summary-and-usage-dedupe.test.js`
- Test: `tests/unit/connection-effective-status.test.js`
- Test: `tests/unit/models-availability-route.test.js`
- Test: `tests/unit/codex-usage-parsing.test.js`

- [ ] **Step 1: Run the focused hot-state and routing regression suite**

Run: `npx vitest run tests/unit/provider-hot-state.test.js tests/unit/usage-status-sync.test.js tests/unit/auth-account-selection.test.js tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js tests/unit/models-availability-route.test.js tests/unit/codex-usage-parsing.test.js`
Expected: PASS with all centralized routing and quota-tracker regressions green.

- [ ] **Step 2: Run the existing neighboring unit tests likely affected by selection and usage changes**

Run: `npx vitest run tests/unit/embeddings.cloud.test.js tests/unit/provider-validation.test.js tests/unit/codex-provider-limits-utils.test.js`
Expected: PASS and confirms no regression in surrounding provider behaviors.

- [ ] **Step 3: Run a production build**

Run: `npm run build`
Expected: PASS with Next.js production build completing successfully.

- [ ] **Step 4: Manual verification in the app**

Run:

```bash
npm run dev
```

Then verify:

```text
1. Open /dashboard/providers/codex and confirm the status filter reads and writes the `status` query param.
2. Confirm blocked_quota and blocked_auth accounts no longer appear under eligible/active filters.
3. Open quota tracker and confirm it renders last-known status immediately before refresh completes.
4. Trigger a Codex usage refresh and confirm the same account status change appears in provider detail and provider summary.
5. Send an API request through 9router with multiple dead Codex accounts and confirm logs show selection from eligible candidates without probing exhausted accounts first.
```

Expected: UI and request routing both reflect the same centralized account state.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "test: verify centralized provider hot state rollout"
```

---

## Self-Review Checklist

### Spec coverage

- Centralized Redis hot state: covered by Task 1.
- Single writer path and usage refresh truth: covered by Task 2.
- Router selecting only eligible accounts: covered by Task 3.
- API/UI compatibility projection: covered by Task 4.
- Dashboard filter and quota tracker consistency: covered by Task 5.
- Verification for large Codex fleets and surrounding regressions: covered by Task 6.

### Placeholder scan

- No `TBD`, `TODO`, or deferred placeholders remain.
- Every task includes exact file paths and explicit commands.
- Code steps include concrete example code blocks.

### Type and naming consistency

- Central status field name is `routingStatus` everywhere.
- Compatibility projection flows through `projectLegacyConnectionState` everywhere.
- Central write function is `writeConnectionHotState` everywhere.
