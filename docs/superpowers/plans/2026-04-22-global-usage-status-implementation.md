# Global Usage Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mixed legacy account usage states with one canonical global status model so routing only selects `eligible` accounts and all dashboard/provider surfaces show the same status.

**Architecture:** Centralize status derivation in shared status helpers and usage refresh helpers, then make scheduler, runtime routing, provider hot state, and UI consumers read/write those same canonical values. Keep persisted field reuse small by canonizing existing `routingStatus` values to `eligible|exhausted|blocked|unknown|disabled`, while preserving detail in `reasonCode`, `reasonDetail`, `resetAt`, `rateLimitedUntil`, and `usageSnapshot`.

**Tech Stack:** Next.js App Router, lowdb, Redis-backed hot state, Vitest

---

## File Map

### Core status and persistence
- Modify: `src/lib/usageStatus.js` — canonical quota/auth/health status derivation, threshold-aware exhaustion logic, runtime write-through patches.
- Modify: `src/lib/connectionStatus.js` — canonical status reads, filter buckets, badge labels, provider cooldown helpers, legacy normalization removal.
- Modify: `src/lib/localDb.js` — resolved settings defaults, summary logic, persisted settings merge for global threshold.
- Modify: `src/lib/quotaRefreshPlanner.js` — scheduler defaults and retry logic based on canonical `routingStatus` instead of old `quotaState/testStatus` semantics.
- Modify: `src/lib/quotaRefreshScheduler.js` — ensure fresh-server startup behaves enabled and status snapshots expose resolved config.
- Modify: `src/lib/providerHotState.js` — eligible pool computation and hot-state projection using canonical statuses.

### Routing and live signal handling
- Modify: `src/sse/services/auth.js` — remove legacy fallback gating from `testStatus`, write canonical `exhausted`/`blocked` immediately, only route eligible accounts.
- Modify: `src/app/api/usage/[connectionId]/route.js` — use shared canonical refresh logic and preserve `unknown`/`blocked`/`exhausted` semantics consistently.
- Modify: `src/app/api/models/availability/route.js` — model availability entries and cooldown clearing based on canonical statuses.

### Dashboard and provider details
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js` — filter options, low-quota summary, status display, waiting/unknown semantics.
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js` — provider details summary cards, filters, and labels aligned to canonical statuses.
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` — badge text and error hints from canonical state.

### Settings and quota scheduler APIs/UI
- Modify: `src/app/api/settings/route.js` — GET/PATCH resolved threshold setting and scheduler refresh behavior.
- Modify: `src/app/api/quota-refresh/status/route.js` — expose resolved scheduler config snapshot.
- Modify: `src/app/api/quota-refresh/run/route.js` — preserve manual run behavior against resolved enabled state.
- Modify: `src/app/(dashboard)/dashboard/profile/page.js` — add global quota threshold control next to scheduler settings.

### Tests
- Modify: `tests/unit/usage-status-sync.test.js`
- Modify: `tests/unit/connection-effective-status.test.js`
- Modify: `tests/unit/local-db-quota-scheduler-settings.test.js`
- Modify: `tests/unit/quota-refresh-planner.test.js`
- Modify: `tests/unit/quota-refresh-scheduler.test.js`
- Modify: `tests/unit/quota-refresh-api.test.js`
- Modify: `tests/unit/auth-account-selection.test.js`
- Modify: `tests/unit/provider-hot-state.test.js`

---

### Task 1: Add canonical global status + configurable threshold defaults

**Files:**
- Modify: `src/lib/localDb.js:25-66, 822-881`
- Modify: `src/lib/quotaRefreshPlanner.js:1-99, 120-237`
- Test: `tests/unit/local-db-quota-scheduler-settings.test.js`
- Test: `tests/unit/quota-refresh-planner.test.js`

- [ ] **Step 1: Write failing settings default tests**

```js
it("returns global quota threshold and enabled scheduler defaults for a fresh database", async () => {
  const localDb = await loadLocalDb();

  await expect(localDb.getSettings()).resolves.toMatchObject({
    quotaScheduler: {
      enabled: true,
      cadenceMs: 900000,
    },
    quotaExhaustedThresholdPercent: 10,
  });
});

it("preserves explicit threshold updates while keeping scheduler defaults merged", async () => {
  const localDb = await loadLocalDb();

  const updated = await localDb.updateSettings({
    quotaExhaustedThresholdPercent: 7,
    quotaScheduler: { enabled: false },
  });

  expect(updated).toMatchObject({
    quotaExhaustedThresholdPercent: 7,
    quotaScheduler: { enabled: false, cadenceMs: 900000 },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- local-db-quota-scheduler-settings.test.js quota-refresh-planner.test.js`
Expected: FAIL with missing `quotaExhaustedThresholdPercent` default and outdated planner expectations.

- [ ] **Step 3: Add global threshold default to settings merge path**

```js
const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  observabilityEnabled: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 1024,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  quotaScheduler: normalizeQuotaSchedulerSettings(),
  quotaExhaustedThresholdPercent: 10,
  rtkEnabled: false,
};

function mergeSettingsWithDefaults(settings = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {}),
  };

  const rawThreshold = Number(settings?.quotaExhaustedThresholdPercent);
  merged.quotaExhaustedThresholdPercent = Number.isFinite(rawThreshold)
    ? Math.max(0, Math.min(100, rawThreshold))
    : DEFAULT_SETTINGS.quotaExhaustedThresholdPercent;

  merged.quotaScheduler = {
    ...normalizeQuotaSchedulerSettings(
      settings?.quotaScheduler && typeof settings.quotaScheduler === "object" && !Array.isArray(settings.quotaScheduler)
        ? settings.quotaScheduler
        : {}
    ),
  };

  return merged;
}
```

- [ ] **Step 4: Update planner helpers to reason from canonical routing status names**

```js
function isExhaustedState(hotState = {}) {
  return hotState?.routingStatus === "exhausted";
}

function isBlockedState(hotState = {}) {
  return hotState?.routingStatus === "blocked";
}

function isEligibleState(hotState = {}) {
  return hotState?.routingStatus === "eligible";
}

function getDecisionTtlMs(hotState = {}, schedulerSettings) {
  if (isExhaustedState(hotState)) {
    return schedulerSettings.exhaustedTtlMs;
  }

  if (isBlockedState(hotState)) {
    return Math.max(schedulerSettings.errorTtlMs, schedulerSettings.cadenceMs);
  }

  if (isEligibleState(hotState)) {
    return Math.max(schedulerSettings.successTtlMs, schedulerSettings.cadenceMs);
  }

  return schedulerSettings.cadenceMs;
}
```

- [ ] **Step 5: Update planner tests to assert canonical status usage**

```js
expect(getQuotaRefreshDecision({
  connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
  schedulerSettings: enabledSettings,
  hotState: {
    routingStatus: "exhausted",
    resetAt: "2026-04-21T12:10:00.000Z",
    lastCheckedAt: "2026-04-21T11:00:00.000Z",
  },
  now,
})).toMatchObject({
  due: false,
  reason: "waiting_for_retry",
  nextEligibleAt: "2026-04-21T12:10:00.000Z",
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /workspaces/9router/tests && npm run test:all -- local-db-quota-scheduler-settings.test.js quota-refresh-planner.test.js`
Expected: PASS with fresh-db defaults showing enabled scheduler and threshold `10`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/localDb.js src/lib/quotaRefreshPlanner.js tests/unit/local-db-quota-scheduler-settings.test.js tests/unit/quota-refresh-planner.test.js
git commit -m "feat: add canonical quota settings defaults"
```

---

### Task 2: Replace legacy status derivation with canonical resolver

**Files:**
- Modify: `src/lib/usageStatus.js:67-393`
- Modify: `src/lib/connectionStatus.js:1-264`
- Test: `tests/unit/usage-status-sync.test.js`
- Test: `tests/unit/connection-effective-status.test.js`

- [ ] **Step 1: Write failing canonical status tests**

```js
it("marks Codex connections exhausted when quota remaining falls below global threshold", async () => {
  const { getUsageStatusUpdates } = await import("../../src/lib/usageStatus.js");

  const updates = getUsageStatusUpdates(
    {
      id: "conn-low",
      provider: "codex",
      providerSpecificData: {},
    },
    {
      quotas: {
        weekly: {
          used: 91,
          total: 100,
          remaining: 9,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    },
    { exhaustedThresholdPercent: 10 }
  );

  expect(updates).toMatchObject({
    routingStatus: "exhausted",
    reasonCode: "quota_low",
    quotaState: "exhausted",
  });
});

it("maps canonical routing statuses into filter and badge buckets", () => {
  expect(getConnectionCentralizedStatus({ routingStatus: "eligible" })).toBe("eligible");
  expect(getConnectionCentralizedStatus({ routingStatus: "exhausted" })).toBe("exhausted");
  expect(getConnectionCentralizedStatus({ routingStatus: "blocked" })).toBe("blocked");
  expect(getConnectionFilterStatus({ routingStatus: "exhausted" })).toBe("exhausted");
  expect(getConnectionStatusBadgeMeta({ routingStatus: "blocked" })).toEqual({
    status: "blocked",
    label: "Blocked",
    variant: "error",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- usage-status-sync.test.js connection-effective-status.test.js`
Expected: FAIL because current code still emits `blocked_quota`, `blocked_auth`, `cooldown`, and collapsed filter buckets.

- [ ] **Step 3: Add shared threshold-aware canonical exhaustion logic in `usageStatus.js`**

```js
function getExhaustedThresholdPercent(options = {}, connection = {}) {
  const explicit = Number(options.exhaustedThresholdPercent);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));

  const globalThreshold = Number(connection?.quotaExhaustedThresholdPercent);
  if (Number.isFinite(globalThreshold)) return Math.max(0, Math.min(100, globalThreshold));

  return 10;
}

function getCodexExhaustionSignal(connection, usage = {}, options = {}) {
  const quotas = usage?.quotas;
  if (!quotas || typeof quotas !== "object") return usage?.limitReached === true
    ? { kind: "exhausted", reasonCode: "quota_exhausted", resetAt: null }
    : null;

  const threshold = getExhaustedThresholdPercent(options, connection);

  for (const [quotaName, quota] of Object.entries(quotas)) {
    const remainingPercent = getSafeRemainingPercent(quota);
    if (remainingPercent !== null && remainingPercent < threshold) {
      return {
        kind: "exhausted",
        reasonCode: remainingPercent <= 0 ? "quota_exhausted" : "quota_low",
        reasonDetail: remainingPercent <= 0
          ? `Codex ${quotaName} quota exhausted`
          : `Codex ${quotaName} quota below ${threshold}%`,
        resetAt: quota.resetAt || null,
      };
    }
  }

  return null;
}
```

- [ ] **Step 4: Make canonical resolver emit only `eligible|exhausted|blocked|unknown|disabled`**

```js
export function getUsageStatusUpdates(connection, usage, options = {}) {
  const base = getHealthyUsageStatusUpdates(usage);
  const observedAt = options.observedAt || new Date().toISOString();

  if (options.liveSignal?.kind === "quota_exhausted") {
    return {
      ...base,
      routingStatus: "exhausted",
      quotaState: "exhausted",
      reasonCode: options.liveSignal.reasonCode || "quota_exhausted",
      reasonDetail: options.liveSignal.reasonDetail || "Quota exhausted",
      lastError: options.liveSignal.reasonDetail || "Quota exhausted",
      lastErrorType: options.liveSignal.reasonCode || "quota_exhausted",
      lastErrorAt: observedAt,
      rateLimitedUntil: options.liveSignal.resetAt || null,
      resetAt: options.liveSignal.resetAt || null,
      nextRetryAt: options.liveSignal.resetAt || null,
    };
  }

  if (connection?.authState === "invalid" || connection?.authState === "expired" || connection?.authState === "revoked") {
    return {
      ...base,
      routingStatus: "blocked",
      authState: connection.authState,
      reasonCode: "auth_invalid",
      reasonDetail: connection.lastError || "Authentication invalid",
    };
  }

  const codexSignal = connection?.provider === "codex"
    ? getCodexExhaustionSignal(connection, usage, options)
    : null;

  if (codexSignal) {
    return {
      ...base,
      routingStatus: "exhausted",
      quotaState: "exhausted",
      reasonCode: codexSignal.reasonCode,
      reasonDetail: codexSignal.reasonDetail,
      lastError: codexSignal.reasonDetail,
      lastErrorType: codexSignal.reasonCode,
      lastErrorAt: observedAt,
      rateLimitedUntil: codexSignal.resetAt,
      resetAt: codexSignal.resetAt,
      nextRetryAt: codexSignal.resetAt,
    };
  }

  return base;
}
```

- [ ] **Step 5: Rewrite `connectionStatus.js` around canonical labels and legacy normalization only at edges**

```js
const CONNECTION_FILTER_STATUSES = new Set([
  "all",
  "eligible",
  "exhausted",
  "blocked",
  "disabled",
  "unknown",
]);

const LEGACY_CONNECTION_FILTER_STATUS_MAP = {
  active: "eligible",
  success: "eligible",
  cooldown: "exhausted",
  "quota-exhausted": "exhausted",
  blocked_quota: "exhausted",
  blocked_auth: "blocked",
  blocked_health: "blocked",
  revoked_invalid: "blocked",
};

export function getConnectionCentralizedStatus(connection = {}) {
  if (!connection || typeof connection !== "object") return "unknown";
  if (connection.isActive === false) return "disabled";

  if (connection.routingStatus === "eligible" || connection.routingStatus === "exhausted" || connection.routingStatus === "blocked" || connection.routingStatus === "unknown") {
    return connection.routingStatus;
  }

  if (["invalid", "expired", "revoked"].includes(connection.authState)) return "blocked";
  if (["error", "failed", "unhealthy", "down"].includes(connection.healthStatus)) return "blocked";
  if (["exhausted", "cooldown", "blocked"].includes(connection.quotaState)) return "exhausted";
  if (connection.testStatus === "active" || connection.testStatus === "success") return "eligible";
  return "unknown";
}

export function getConnectionFilterStatus(connection = {}) {
  const status = getConnectionCentralizedStatus(connection);
  return status === "disabled" ? "disabled" : status;
}

export function getConnectionStatusBadgeMeta(connection = {}) {
  const status = getConnectionCentralizedStatus(connection);
  switch (status) {
    case "eligible":
      return { status, label: "Eligible", variant: "success" };
    case "exhausted":
      return { status, label: "Exhausted", variant: "warning" };
    case "blocked":
      return { status, label: "Blocked", variant: "error" };
    case "disabled":
      return { status, label: "Disabled", variant: "default" };
    default:
      return { status: "unknown", label: "Unknown", variant: "default" };
  }
}
```

- [ ] **Step 6: Update tests to assert canonical labels and threshold behavior**

```js
expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
  patch: expect.objectContaining({
    routingStatus: "exhausted",
    reasonCode: "quota_exhausted",
  }),
}));

expect(getConnectionFilterStatus({ routingStatus: "exhausted" })).toBe("exhausted");
expect(getConnectionFilterStatus({ authState: "invalid" })).toBe("blocked");
expect(normalizeConnectionFilterStatus("blocked_quota")).toBe("exhausted");
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /workspaces/9router/tests && npm run test:all -- usage-status-sync.test.js connection-effective-status.test.js`
Expected: PASS with canonical `exhausted` and `blocked` replacing legacy status names.

- [ ] **Step 8: Commit**

```bash
git add src/lib/usageStatus.js src/lib/connectionStatus.js tests/unit/usage-status-sync.test.js tests/unit/connection-effective-status.test.js
git commit -m "refactor: canonize usage routing statuses"
```

---

### Task 3: Make routing and hot-state selection honor canonical eligible-only pool

**Files:**
- Modify: `src/lib/providerHotState.js:598-642`
- Modify: `src/sse/services/auth.js:1-319`
- Test: `tests/unit/auth-account-selection.test.js`
- Test: `tests/unit/provider-hot-state.test.js`

- [ ] **Step 1: Write failing eligible-pool tests**

```js
it("does not treat unknown or exhausted connections as routable fallback candidates", async () => {
  mockConnections.push(
    {
      id: "conn-exhausted",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Exhausted",
      accessToken: "exhausted-token",
      routingStatus: "exhausted",
    },
    {
      id: "conn-unknown",
      provider: "codex",
      isActive: true,
      priority: 2,
      displayName: "Unknown",
      accessToken: "unknown-token",
      routingStatus: "unknown",
    },
  );
  getEligibleConnections.mockResolvedValueOnce([]);

  const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
  const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

  expect(credentials).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- auth-account-selection.test.js provider-hot-state.test.js`
Expected: FAIL because fallback path still lets legacy `testStatus` and untouched state appear available.

- [ ] **Step 3: Remove `testStatus`-based fallback eligibility in provider hot state**

```js
function isCanonicalEligibleConnection(connection = {}) {
  return connection?.isActive !== false && connection?.routingStatus === "eligible";
}

export async function getEligibleConnections(providerId, connections = []) {
  if (!providerId || !Array.isArray(connections) || connections.length === 0) return [];

  const providerState = await getProviderHotState(providerId);
  if (!providerState) {
    return connections.filter(isCanonicalEligibleConnection);
  }

  const eligibleConnectionIds = providerState.eligibleConnectionIds;
  if (!(eligibleConnectionIds instanceof Set)) {
    return connections.filter(isCanonicalEligibleConnection);
  }

  return connections.filter((connection) => connection?.id && eligibleConnectionIds.has(connection.id));
}
```

- [ ] **Step 4: Gate routing selection on canonical status and immediate live status writes**

```js
function isFallbackConnectionBlocked(connection) {
  if (!connection || typeof connection !== "object") return true;
  if (connection.routingStatus && connection.routingStatus !== "eligible") return true;
  if (isFutureTimestamp(connection.rateLimitedUntil)) return true;
  if (isFutureTimestamp(connection.modelLock___all)) return true;
  return false;
}

const centralizedEligibleConnections = await getEligibleConnections(providerId, availableConnections);
const eligibleConnections = Array.isArray(centralizedEligibleConnections)
  ? sortByPriority(centralizedEligibleConnections.filter((connection) => connection.routingStatus === "eligible"))
  : [];
const selectionPool = eligibleConnections;
```

- [ ] **Step 5: Update live quota/auth write-through patching in `markAccountUnavailable`**

```js
const authBlockedPatch = !liveQuotaSignal && (status === 401 || status === 403)
  ? {
      ...getConnectionAuthBlockedPatch(reason, { lastCheckedAt, statusCode: status }),
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
    }
  : null;

const connectionPatch = {
  ...(authBlockedPatch || {}),
  ...lockUpdate,
  lastErrorAt: authBlockedPatch?.lastErrorAt || lastCheckedAt,
  backoffLevel: newBackoffLevel ?? backoffLevel,
};
```

- [ ] **Step 6: Update tests to require only eligible routing candidates**

```js
expect(getEligibleConnections).toHaveBeenCalledWith("codex", expect.arrayContaining([
  expect.objectContaining({ id: "conn-exhausted", routingStatus: "exhausted" }),
]));
expect(credentials).toBeNull();
expect(await getEligibleConnectionIds("provider-redis")).toEqual([]);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /workspaces/9router/tests && npm run test:all -- auth-account-selection.test.js provider-hot-state.test.js`
Expected: PASS with eligible-only routing selection and no fallback to unknown/exhausted accounts.

- [ ] **Step 8: Commit**

```bash
git add src/lib/providerHotState.js src/sse/services/auth.js tests/unit/auth-account-selection.test.js tests/unit/provider-hot-state.test.js
git commit -m "fix: route only canonical eligible accounts"
```

---

### Task 4: Align scheduler APIs and profile settings with resolved canonical config

**Files:**
- Modify: `src/lib/quotaRefreshScheduler.js:27-209`
- Modify: `src/app/api/settings/route.js:9-99`
- Modify: `src/app/api/quota-refresh/status/route.js:1-14`
- Modify: `src/app/api/quota-refresh/run/route.js:1-25`
- Modify: `src/app/(dashboard)/dashboard/profile/page.js:9-104, 720-770`
- Test: `tests/unit/quota-refresh-scheduler.test.js`
- Test: `tests/unit/quota-refresh-api.test.js`

- [ ] **Step 1: Write failing settings/API tests for threshold exposure and enabled-by-default scheduler**

```js
it("returns resolved scheduler settings and quota threshold from settings api", async () => {
  getSettings.mockResolvedValueOnce({
    quotaScheduler: { enabled: true, cadenceMs: 900000 },
    quotaExhaustedThresholdPercent: 10,
  });

  const { GET } = await import("../../src/app/api/settings/route.js");
  const response = await GET();

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    quotaScheduler: { enabled: true, cadenceMs: 900000 },
    quotaExhaustedThresholdPercent: 10,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- quota-refresh-scheduler.test.js quota-refresh-api.test.js`
Expected: FAIL once assertions expect threshold exposure and resolved scheduler snapshots not yet surfaced.

- [ ] **Step 3: Make scheduler status snapshots expose resolved settings and startup-enabled behavior**

```js
async loadSettings() {
  const settings = await this.getSettingsFn();
  this.settings = normalizeQuotaSchedulerSettings(settings?.quotaScheduler || {});
  this.thresholdPercent = Number.isFinite(Number(settings?.quotaExhaustedThresholdPercent))
    ? Number(settings.quotaExhaustedThresholdPercent)
    : 10;
  return {
    quotaScheduler: this.settings,
    quotaExhaustedThresholdPercent: this.thresholdPercent,
  };
}

buildStatusSnapshot() {
  return {
    started: this.started,
    enabled: this.settings.enabled,
    settings: { ...this.settings },
    quotaExhaustedThresholdPercent: this.thresholdPercent,
    hasScheduledTimer: this.timerId !== null,
    ...this.getStateSnapshot(),
  };
}
```

- [ ] **Step 4: Expose threshold control in settings API and save path**

```js
const settings = await updateSettings({
  ...body,
  quotaExhaustedThresholdPercent: body.quotaExhaustedThresholdPercent,
});

if (
  Object.prototype.hasOwnProperty.call(body, "quotaScheduler")
  || Object.prototype.hasOwnProperty.call(body, "quotaExhaustedThresholdPercent")
) {
  await getQuotaRefreshScheduler().refreshSchedule("settings_update");
}
```

- [ ] **Step 5: Add threshold form control to profile settings page**

```jsx
const [quotaForm, setQuotaForm] = useState({
  enabled: true,
  cadenceMinutes: "15",
  thresholdPercent: "10",
});

<Input
  type="number"
  min="0"
  max="100"
  step="1"
  label="Exhausted threshold (%)"
  value={quotaForm.thresholdPercent}
  onChange={(e) => setQuotaForm((prev) => ({ ...prev, thresholdPercent: e.target.value }))}
  hint="Accounts below this remaining quota are marked exhausted globally."
/>
```

- [ ] **Step 6: Update quota settings submit handler to persist both cadence and threshold**

```js
const thresholdPercent = Number.parseInt(quotaForm.thresholdPercent, 10);
if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
  setQuotaStatus({ type: "error", message: "Threshold must be between 0 and 100" });
  return;
}

const res = await fetch("/api/settings", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quotaScheduler: { cadenceMs: minutes * 60 * 1000 },
    quotaExhaustedThresholdPercent: thresholdPercent,
  }),
});
```

- [ ] **Step 7: Update tests to assert resolved threshold and scheduler refresh path**

```js
expect(response.body).toMatchObject({
  quotaScheduler: { enabled: true },
  quotaExhaustedThresholdPercent: 10,
});
expect(refreshSchedule).toHaveBeenCalledWith("settings_update");
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /workspaces/9router/tests && npm run test:all -- quota-refresh-scheduler.test.js quota-refresh-api.test.js`
Expected: PASS with resolved settings snapshots and threshold persisted through `/api/settings`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/quotaRefreshScheduler.js src/app/api/settings/route.js src/app/api/quota-refresh/status/route.js src/app/api/quota-refresh/run/route.js src/app/(dashboard)/dashboard/profile/page.js tests/unit/quota-refresh-scheduler.test.js tests/unit/quota-refresh-api.test.js
git commit -m "feat: expose global quota status settings"
```

---

### Task 5: Make dashboard and provider details display canonical statuses consistently

**Files:**
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js:27-39, 404-452, 557-572, 603-725`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js:114-234`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js:95-141`
- Test: `tests/unit/connection-effective-status.test.js`

- [ ] **Step 1: Write failing UI-status mapping assertions**

```js
it("preserves canonical filter buckets for eligible, exhausted, blocked, disabled, and unknown", () => {
  expect(getConnectionFilterStatus({ routingStatus: "eligible" })).toBe("eligible");
  expect(getConnectionFilterStatus({ routingStatus: "exhausted" })).toBe("exhausted");
  expect(getConnectionFilterStatus({ routingStatus: "blocked" })).toBe("blocked");
  expect(getConnectionFilterStatus({ isActive: false, routingStatus: "eligible" })).toBe("disabled");
  expect(getConnectionFilterStatus({})).toBe("unknown");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- connection-effective-status.test.js`
Expected: FAIL because filters still collapse quota/auth/health into old buckets and UI labels still say cooldown/quota blocked/health blocked.

- [ ] **Step 3: Update quota dashboard filter options and summaries**

```jsx
options={[
  { value: "all", label: "All" },
  { value: "eligible", label: "Eligible" },
  { value: "exhausted", label: "Exhausted" },
  { value: "blocked", label: "Blocked" },
  { value: "disabled", label: "Disabled" },
  { value: "unknown", label: "Unknown" },
]}
```

```js
const lowQuotasCount = visibleQuotaCards.reduce((count, { connection }) => (
  count + (connection.routingStatus === "exhausted" && connection.reasonCode === "quota_low" ? 1 : 0)
), 0);
```

- [ ] **Step 4: Rewrite provider details summary buckets to canonical counts**

```js
const summary = {
  eligible: 0,
  exhausted: 0,
  blocked: 0,
  disabled: 0,
  unknown: 0,
  nextResetAt: null,
};

for (const connection of connections) {
  const status = getConnectionCentralizedStatus(connection);
  if (status === "eligible") summary.eligible += 1;
  else if (status === "exhausted") summary.exhausted += 1;
  else if (status === "blocked") summary.blocked += 1;
  else if (status === "disabled") summary.disabled += 1;
  else summary.unknown += 1;
}
```

- [ ] **Step 5: Show canonical badge labels and reason details in provider rows**

```jsx
<Badge variant={statusBadge.variant} size="sm" dot>
  {statusBadge.label}
</Badge>
{connection.reasonDetail && connection.isActive !== false && (
  <span className="text-xs text-text-muted truncate max-w-[300px]" title={connection.reasonDetail}>
    {connection.reasonDetail}
  </span>
)}
```

- [ ] **Step 6: Update tests to assert canonical labels**

```js
expect(getConnectionStatusBadgeMeta({ routingStatus: "exhausted" })).toEqual({
  status: "exhausted",
  label: "Exhausted",
  variant: "warning",
});
expect(getConnectionStatusBadgeMeta({ routingStatus: "blocked" })).toEqual({
  status: "blocked",
  label: "Blocked",
  variant: "error",
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /workspaces/9router/tests && npm run test:all -- connection-effective-status.test.js`
Expected: PASS with canonical filter buckets and badge labels.

- [ ] **Step 8: Commit**

```bash
git add src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js src/app/(dashboard)/dashboard/providers/[id]/page.js src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js tests/unit/connection-effective-status.test.js
git commit -m "refactor: align dashboard status surfaces"
```

---

### Task 6: Normalize usage refresh API and model availability around canonical status

**Files:**
- Modify: `src/app/api/usage/[connectionId]/route.js:130-220`
- Modify: `src/app/api/models/availability/route.js:23-156`
- Test: `tests/unit/usage-status-sync.test.js`
- Test: `tests/unit/connection-effective-status.test.js`

- [ ] **Step 1: Write failing API behavior tests**

```js
it("marks auth failures as blocked instead of legacy expired/error routing states", async () => {
  const { getConnectionAuthBlockedPatch } = await import("../../src/lib/usageStatus.js");

  expect(getConnectionAuthBlockedPatch("401 unauthorized", {
    lastCheckedAt: "2026-04-22T00:00:00.000Z",
    statusCode: 401,
  })).toMatchObject({
    routingStatus: "blocked",
    reasonCode: "auth_invalid",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- usage-status-sync.test.js connection-effective-status.test.js`
Expected: FAIL because auth patches and availability route still emit legacy unavailable/cooldown semantics.

- [ ] **Step 3: Update auth-block patch and usage route to emit canonical blocked status**

```js
export function getConnectionAuthBlockedPatch(error, { lastCheckedAt = new Date().toISOString(), statusCode = null } = {}) {
  const message = typeof error === "string"
    ? error
    : error?.message || error?.error || error?.cause?.message || "";

  if (!isConfirmedAuthBlockedError(message, { statusCode })) {
    return null;
  }

  return {
    routingStatus: "blocked",
    healthStatus: "healthy",
    quotaState: "ok",
    authState: "invalid",
    reasonCode: "auth_invalid",
    reasonDetail: message || "Provider error",
    nextRetryAt: null,
    resetAt: null,
    lastError: message || "Provider error",
    lastErrorType: "auth_invalid",
    lastErrorAt: lastCheckedAt,
    errorCode: "auth_invalid",
    lastCheckedAt,
    lastTested: lastCheckedAt,
  };
}
```

- [ ] **Step 4: Make model availability route expose canonical blocked/exhausted entries**

```js
if (statusDetails.status === "exhausted") {
  entries.unshift({
    provider: connection.provider,
    model: "__all",
    status: "exhausted",
    until: providerCooldownUntil || undefined,
    connectionId: connection.id,
    connectionName: getConnectionName(connection),
    lastError: connection.lastError || connection.reasonDetail || null,
  });
}

if (statusDetails.status === "blocked") {
  entries.unshift({
    provider: connection.provider,
    model: "__all",
    status: "blocked",
    connectionId: connection.id,
    connectionName: getConnectionName(connection),
    lastError: connection.lastError || connection.reasonDetail || null,
  });
}
```

- [ ] **Step 5: Update clear patch logic to reactivate only canonical eligible state**

```js
if (model === "__all") {
  patch.rateLimitedUntil = null;
  patch.nextRetryAt = null;
  patch.resetAt = null;

  if (["exhausted", "blocked"].includes(connection?.routingStatus)) {
    patch.routingStatus = "unknown";
  }

  if (["exhausted", "cooldown", "blocked"].includes(connection?.quotaState)) {
    patch.quotaState = null;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /workspaces/9router/tests && npm run test:all -- usage-status-sync.test.js connection-effective-status.test.js`
Expected: PASS with auth failures mapped to canonical `blocked` and quota failures mapped to canonical `exhausted`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/usage/[connectionId]/route.js src/app/api/models/availability/route.js src/lib/usageStatus.js tests/unit/usage-status-sync.test.js tests/unit/connection-effective-status.test.js
git commit -m "fix: normalize usage api status writes"
```

---

### Task 7: Full verification and cleanup of stale legacy references

**Files:**
- Modify: `src/lib/localDb.js:85-102`
- Modify: any remaining canonical cleanup spots found by grep in `src/`
- Test: `tests/unit/usage-status-sync.test.js`
- Test: `tests/unit/connection-effective-status.test.js`
- Test: `tests/unit/local-db-quota-scheduler-settings.test.js`
- Test: `tests/unit/quota-refresh-planner.test.js`
- Test: `tests/unit/quota-refresh-scheduler.test.js`
- Test: `tests/unit/quota-refresh-api.test.js`
- Test: `tests/unit/auth-account-selection.test.js`
- Test: `tests/unit/provider-hot-state.test.js`

- [ ] **Step 1: Search for stale legacy routing labels**

Run: `rg -n "blocked_auth|blocked_health|blocked_quota|cooldown|testStatus === \"unavailable\"|status: \"unavailable\"" /workspaces/9router/src /workspaces/9router/tests --glob '!node_modules'`
Expected: remaining hits should be limited to explicit normalization shims or updated test fixtures.

- [ ] **Step 2: Remove or rewrite remaining legacy-only branches**

```js
export function getConnectionStatusSummary(connections = []) {
  const summary = {
    connected: 0,
    error: 0,
    unknown: 0,
    total: connections.length,
    allDisabled: connections.length > 0 && connections.every((c) => c?.isActive === false),
  };

  for (const connection of connections || []) {
    const status = getConnectionCentralizedStatus(connection);
    if (status === "eligible") summary.connected += 1;
    else if (status === "exhausted" || status === "blocked") summary.error += 1;
    else summary.unknown += 1;
  }

  return summary;
}
```

- [ ] **Step 3: Run targeted status suite**

Run: `cd /workspaces/9router/tests && npm run test:all -- usage-status-sync.test.js connection-effective-status.test.js local-db-quota-scheduler-settings.test.js quota-refresh-planner.test.js quota-refresh-scheduler.test.js quota-refresh-api.test.js auth-account-selection.test.js provider-hot-state.test.js`
Expected: PASS across canonical resolver, settings defaults, scheduler, routing, and hot-state tests.

- [ ] **Step 4: Run full test suite**

Run: `cd /workspaces/9router/tests && npm run test:all`
Expected: PASS with no regressions outside status/routing changes.

- [ ] **Step 5: Manual UI verification**

Run: `npm run dev`
Expected: Next.js dev server starts for `/dashboard/usage`, `/dashboard/providers/[id]`, and `/dashboard/profile` verification.

- [ ] **Step 6: Verify quota dashboard canonical status behavior in browser**

Check:
- `/dashboard/quota?statusFilter=eligible` shows only `routingStatus=eligible`
- low-quota Codex accounts no longer appear in eligible list
- accounts with missing snapshot show as `unknown`
- exhausted accounts show exhausted label/reason consistently

Expected: eligible filter excludes unknown/exhausted/blocked/disabled accounts completely.

- [ ] **Step 7: Verify provider details and settings UI consistency**

Check:
- `/dashboard/providers/codex` summary counts use `eligible`, `exhausted`, `blocked`, `unknown`, `disabled`
- connection row badges match quota dashboard badges
- `/dashboard/profile` shows scheduler enabled toggle and threshold input defaulting to `10`
- fresh settings load shows scheduler enabled when no explicit setting exists

Expected: no mixed labels like cooldown/quota blocked/health blocked remain visible as top-level account statuses.

- [ ] **Step 8: Commit**

```bash
git add src/lib/localDb.js src/lib/connectionStatus.js src/lib/usageStatus.js src/lib/providerHotState.js src/lib/quotaRefreshPlanner.js src/lib/quotaRefreshScheduler.js src/sse/services/auth.js src/app/api/usage/[connectionId]/route.js src/app/api/models/availability/route.js src/app/api/settings/route.js src/app/api/quota-refresh/status/route.js src/app/api/quota-refresh/run/route.js src/app/(dashboard)/dashboard/profile/page.js src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js src/app/(dashboard)/dashboard/providers/[id]/page.js src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js tests/unit/usage-status-sync.test.js tests/unit/connection-effective-status.test.js tests/unit/local-db-quota-scheduler-settings.test.js tests/unit/quota-refresh-planner.test.js tests/unit/quota-refresh-scheduler.test.js tests/unit/quota-refresh-api.test.js tests/unit/auth-account-selection.test.js tests/unit/provider-hot-state.test.js
git commit -m "feat: unify global usage routing status"
```

---

## Spec Coverage Check

- Canonical status model covered by Tasks 2, 3, 5, and 6.
- Runtime immediate write-through for quota/auth failures covered by Tasks 3 and 6.
- Global threshold setting with default `10` covered by Tasks 1 and 4.
- Scheduler enabled by default on fresh setup covered by Tasks 1 and 4.
- Dashboard/provider details consistency covered by Task 5.
- Legacy cleanup covered by Tasks 2, 3, and 7.
- Eligible-only routing covered by Task 3.

## Placeholder Scan

- No `TODO`, `TBD`, or deferred implementation placeholders remain.
- Every code-modifying task includes concrete code snippets.
- Every validation step names exact commands and expected outcomes.

## Type Consistency Check

- Canonical persisted `routingStatus` values remain `eligible|exhausted|blocked|unknown|disabled` throughout all tasks.
- Global setting name remains `quotaExhaustedThresholdPercent` throughout all tasks.
- Scheduler setting container remains `quotaScheduler` throughout all tasks.

Plan complete and saved to `docs/superpowers/plans/2026-04-22-global-usage-status-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
