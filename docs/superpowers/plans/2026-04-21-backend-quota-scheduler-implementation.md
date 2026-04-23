# Backend Quota Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-driven quota refresh with one backend scheduler that maintains shared quota state for all quota-capable connections, while router and dashboard read that centralized state and live Codex exhaustion updates it immediately.

**Architecture:** Add one backend quota scheduler loop started from app initialization, backed by a planner that decides which connections are due and a small scheduler-state module that exposes run status and manual restart controls. Reuse the existing `/api/usage/[connectionId]` refresh path and centralized hot-state store so quota mutation logic stays single-source, while the quota tracker UI becomes a read-only observer plus manual “Refresh All” trigger.

**Tech Stack:** Next.js route handlers, local JSON DB settings (`src/lib/localDb.js`), Redis-backed hot state (`src/lib/providerHotState.js`), existing usage refresh queue (`src/lib/usageRefreshQueue.js`), Vitest, ESLint.

---

## File Structure

### New files
- `src/lib/quotaRefreshPlanner.js`
  - Pure planning helpers for quota-capable connection filtering, due/skip rules, near-window logic, and manual-refresh candidate ordering.
- `src/lib/quotaRefreshState.js`
  - In-process scheduler run state + Redis-safe-ish shared status shape for `GET /api/quota-refresh/status` and manual restart flags.
- `src/lib/quotaRefreshScheduler.js`
  - Singleton scheduler loop, startup/cancel/restart orchestration, queue submission, and integration with planner + state.
- `src/app/api/quota-refresh/run/route.js`
  - Manual backend trigger endpoint for “Refresh All”.
- `src/app/api/quota-refresh/status/route.js`
  - Status endpoint for current/last scheduler run.
- `tests/unit/quota-refresh-planner.test.js`
  - Planner rules and near-window tests.
- `tests/unit/quota-refresh-scheduler.test.js`
  - Scheduler state transitions, restart/cancel flow, and startup catch-up tests.

### Existing files to modify
- `src/lib/localDb.js`
  - Add scheduler settings to `DEFAULT_SETTINGS`; keep settings persistence contract.
- `src/app/api/settings/route.js`
  - Allow reading/writing new quota scheduler settings.
- `src/shared/services/initializeApp.js`
  - Start scheduler singleton during app init.
- `src/app/api/usage/[connectionId]/route.js`
  - Extract/reuse canonical quota refresh execution pieces if needed; strengthen immediate live quota mutation path.
- `src/lib/providerHotState.js`
  - Add scheduler-state helpers only if truly needed; keep router shared-state contract stable.
- `src/sse/services/auth.js`
  - Keep router consuming centralized state only; no direct quota probing.
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`
  - Remove browser auto-refresh loop and per-connection refresh fanout; switch Refresh All to backend trigger and read scheduler status.
- `src/app/(dashboard)/dashboard/providers/[id]/page.js`
  - Ensure provider detail stays read-only consumer of shared quota state.
- `tests/unit/usage-status-sync.test.js`
  - Cover immediate quota-state updates from live exhaustion / route sync behavior.
- `tests/unit/provider-summary-and-usage-dedupe.test.js`
  - Adjust browser/UI expectations after auto-refresh removal if needed.

### Existing tests to extend or use as anchors
- `tests/unit/provider-hot-state.test.js`
- `tests/unit/auth-account-selection.test.js`
- `tests/unit/connection-effective-status.test.js`
- `tests/unit/models-availability-route.test.js`

---

### Task 1: Add scheduler settings and planner primitives

**Files:**
- Create: `src/lib/quotaRefreshPlanner.js`
- Modify: `src/lib/localDb.js:19-41,753-763`
- Modify: `src/app/api/settings/route.js:1-40`
- Test: `tests/unit/quota-refresh-planner.test.js`

- [ ] **Step 1: Write failing planner/settings tests**

```js
import { describe, expect, it } from "vitest";

import {
  getQuotaRefreshDueDecision,
  isQuotaRefreshSupported,
  QUOTA_SUPPORTED_PROVIDER_SET,
} from "../../src/lib/quotaRefreshPlanner.js";
import localDb from "../../src/lib/localDb.js";

describe("quota refresh planner", () => {
  it("treats supported quota providers as scheduler candidates", () => {
    expect(QUOTA_SUPPORTED_PROVIDER_SET.has("codex")).toBe(true);
    expect(isQuotaRefreshSupported({ provider: "codex", authType: "oauth" })).toBe(true);
    expect(isQuotaRefreshSupported({ provider: "openai", authType: "apikey" })).toBe(false);
  });

  it("marks blocked quota connections due only near reset window", () => {
    const farReset = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const nearReset = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    expect(getQuotaRefreshDueDecision({
      routingStatus: "blocked_quota",
      resetAt: farReset,
    }, { now: Date.now(), nearWindowMinutes: 10 }).due).toBe(false);

    expect(getQuotaRefreshDueDecision({
      routingStatus: "blocked_quota",
      resetAt: nearReset,
    }, { now: Date.now(), nearWindowMinutes: 10 }).due).toBe(true);
  });
});

describe("quota scheduler settings", () => {
  it("persists new quota scheduler defaults", async () => {
    const settings = await localDb.getSettings();

    expect(settings.quotaSchedulerEnabled).toBe(true);
    expect(settings.quotaRefreshIntervalMinutes).toBe(15);
    expect(settings.quotaNearWindowMinutes).toBe(10);
    expect(settings.quotaManualRefreshDebounceSeconds).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-refresh-planner.test.js
```

Expected: FAIL because planner module/settings fields do not exist yet.

- [ ] **Step 3: Add minimal planner + settings implementation**

```js
// src/lib/quotaRefreshPlanner.js
export const QUOTA_SUPPORTED_PROVIDER_SET = new Set([
  "codex",
  "claude",
  "gemini",
  "github",
]);

export function isQuotaRefreshSupported(connection = {}) {
  return QUOTA_SUPPORTED_PROVIDER_SET.has(connection.provider) && connection.authType === "oauth";
}

export function getQuotaRefreshDueDecision(connection = {}, {
  now = Date.now(),
  nearWindowMinutes = 10,
  force = false,
} = {}) {
  if (force) return { due: true, reason: "manual" };

  const nearWindowMs = nearWindowMinutes * 60 * 1000;
  const resetAtMs = connection?.resetAt ? new Date(connection.resetAt).getTime() : null;
  const nextRetryAtMs = connection?.nextRetryAt ? new Date(connection.nextRetryAt).getTime() : null;
  const lastCheckedAtMs = connection?.lastCheckedAt ? new Date(connection.lastCheckedAt).getTime() : null;

  if (connection?.routingStatus === "blocked_quota") {
    const targetMs = Number.isFinite(resetAtMs) ? resetAtMs : nextRetryAtMs;
    if (!Number.isFinite(targetMs)) return { due: true, reason: "blocked-quota-no-reset" };
    return { due: targetMs - now <= nearWindowMs, reason: "blocked-quota-window" };
  }

  if (!Number.isFinite(lastCheckedAtMs)) return { due: true, reason: "never-checked" };

  return { due: false, reason: "fresh" };
}
```

```js
// src/lib/localDb.js DEFAULT_SETTINGS additions
quotaSchedulerEnabled: true,
quotaRefreshIntervalMinutes: 15,
quotaNearWindowMinutes: 10,
quotaManualRefreshDebounceSeconds: 10,
quotaSchedulerStartupCatchup: true,
```

- [ ] **Step 4: Run tests to verify pass**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-refresh-planner.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotaRefreshPlanner.js src/lib/localDb.js src/app/api/settings/route.js tests/unit/quota-refresh-planner.test.js
git commit -m "feat(quota): add scheduler planner settings"
```

---

### Task 2: Add scheduler state + backend scheduler loop

**Files:**
- Create: `src/lib/quotaRefreshState.js`
- Create: `src/lib/quotaRefreshScheduler.js`
- Modify: `src/shared/services/initializeApp.js`
- Test: `tests/unit/quota-refresh-scheduler.test.js`

- [ ] **Step 1: Write failing scheduler-state tests**

```js
import { describe, expect, it } from "vitest";

import {
  createQuotaRefreshRunState,
  requestQuotaRefreshRestart,
  markQuotaRefreshRunStarted,
} from "../../src/lib/quotaRefreshState.js";

describe("quota refresh scheduler state", () => {
  it("tracks manual restart requests", () => {
    const state = createQuotaRefreshRunState();
    requestQuotaRefreshRestart(state, { trigger: "manual" });

    expect(state.restartRequested).toBe(true);
    expect(state.requestedTrigger).toBe("manual");
  });

  it("marks a run as started with counters reset", () => {
    const state = createQuotaRefreshRunState();
    markQuotaRefreshRunStarted(state, { trigger: "scheduled", totalCandidates: 7 });

    expect(state.status).toBe("running");
    expect(state.totalCandidates).toBe(7);
    expect(state.completedCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-refresh-scheduler.test.js
```

Expected: FAIL because modules do not exist yet.

- [ ] **Step 3: Add minimal scheduler state + startup wiring**

```js
// src/lib/quotaRefreshState.js
export function createQuotaRefreshRunState() {
  return {
    status: "idle",
    currentRunId: null,
    requestedTrigger: null,
    restartRequested: false,
    cancelRequested: false,
    startedAt: null,
    lastCompletedAt: null,
    nextScheduledAt: null,
    totalCandidates: 0,
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  };
}

export function requestQuotaRefreshRestart(state, { trigger }) {
  state.cancelRequested = true;
  state.restartRequested = true;
  state.requestedTrigger = trigger;
}

export function markQuotaRefreshRunStarted(state, { trigger, totalCandidates }) {
  Object.assign(state, {
    status: "running",
    currentRunId: `quota-${Date.now()}`,
    startedAt: new Date().toISOString(),
    totalCandidates,
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    cancelRequested: false,
    restartRequested: false,
    requestedTrigger: trigger,
  });
}
```

```js
// src/lib/quotaRefreshScheduler.js
let schedulerSingleton = null;

export function getQuotaRefreshScheduler() {
  if (!schedulerSingleton) {
    schedulerSingleton = {
      state: createQuotaRefreshRunState(),
      timer: null,
      started: false,
    };
  }
  return schedulerSingleton;
}

export async function startQuotaRefreshScheduler() {
  const scheduler = getQuotaRefreshScheduler();
  if (scheduler.started) return scheduler;
  scheduler.started = true;
  return scheduler;
}
```

```js
// src/shared/services/initializeApp.js
import { startQuotaRefreshScheduler } from "@/lib/quotaRefreshScheduler";

// inside initializeApp()
await startQuotaRefreshScheduler();
```

- [ ] **Step 4: Run tests to verify pass**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-refresh-scheduler.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotaRefreshState.js src/lib/quotaRefreshScheduler.js src/shared/services/initializeApp.js tests/unit/quota-refresh-scheduler.test.js
git commit -m "feat(quota): add scheduler loop state"
```

---

### Task 3: Reuse canonical usage refresh path for scheduler runs and live quota updates

**Files:**
- Modify: `src/app/api/usage/[connectionId]/route.js`
- Modify: `src/lib/quotaRefreshScheduler.js`
- Modify: `tests/unit/usage-status-sync.test.js`
- Test: `tests/unit/quota-refresh-scheduler.test.js`

- [ ] **Step 1: Write failing tests for immediate live quota mutation + scheduler reuse**

```js
it("marks codex account blocked_quota immediately when usage says weekly exhausted", async () => {
  const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
    params: Promise.resolve({ connectionId: "conn-1" }),
  });

  expect(response.status).toBe(200);
  expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
    connectionId: "conn-1",
    provider: "codex",
    patch: expect.objectContaining({
      routingStatus: "blocked_quota",
      quotaState: "exhausted",
    }),
  }));
});

it("scheduler reuses queued usage refresh path instead of duplicating provider mutation logic", async () => {
  await runQuotaRefreshSweep({ trigger: "scheduled", forceFullSweep: false });
  expect(runUsageRefreshJob).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/usage-status-sync.test.js tests/unit/quota-refresh-scheduler.test.js
```

Expected: FAIL for missing scheduler sweep behavior or missing direct call shape.

- [ ] **Step 3: Add minimal reusable refresh execution path**

```js
// src/app/api/usage/[connectionId]/route.js
export async function runUsageRefreshForConnection(connectionId, { force = false } = {}) {
  return getQueuedUsageResult(connectionId, async () => {
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) throw Object.assign(new Error("Connection not found"), { status: 404 });

    const refreshedConnection = await refreshAndUpdateCredentials(connection, force);
    const usage = await getUsageForProvider(refreshedConnection);
    const updates = getUsageStatusUpdates(refreshedConnection, usage);
    await syncUsageStatus(refreshedConnection, updates);
    return { connection: refreshedConnection, usage, updates };
  });
}
```

```js
// src/lib/quotaRefreshScheduler.js
import { runUsageRefreshForConnection } from "@/app/api/usage/[connectionId]/route";

export async function runQuotaRefreshSweep({ trigger, forceFullSweep }) {
  const scheduler = getQuotaRefreshScheduler();
  const candidates = await getDueQuotaRefreshConnections({ forceFullSweep });
  markQuotaRefreshRunStarted(scheduler.state, { trigger, totalCandidates: candidates.length });

  for (const connection of candidates) {
    await runUsageRefreshForConnection(connection.id, { force: forceFullSweep });
    scheduler.state.completedCount += 1;
  }

  scheduler.state.status = "idle";
  scheduler.state.lastCompletedAt = new Date().toISOString();
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/usage-status-sync.test.js tests/unit/quota-refresh-scheduler.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/usage/[connectionId]/route.js src/lib/quotaRefreshScheduler.js tests/unit/usage-status-sync.test.js tests/unit/quota-refresh-scheduler.test.js
git commit -m "feat(quota): reuse canonical refresh path"
```

---

### Task 4: Add scheduler planner rules, status endpoint, and manual restart endpoint

**Files:**
- Modify: `src/lib/quotaRefreshPlanner.js`
- Modify: `src/lib/quotaRefreshState.js`
- Modify: `src/lib/quotaRefreshScheduler.js`
- Create: `src/app/api/quota-refresh/run/route.js`
- Create: `src/app/api/quota-refresh/status/route.js`
- Test: `tests/unit/quota-refresh-scheduler.test.js`

- [ ] **Step 1: Write failing API/state tests**

```js
it("returns scheduler status through GET /api/quota-refresh/status", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBeDefined();
});

it("manual run endpoint requests cancel and restart of current sweep", async () => {
  const response = await POST(new Request("http://localhost/api/quota-refresh/run", {
    method: "POST",
    body: JSON.stringify({ action: "restart" }),
    headers: { "content-type": "application/json" },
  }));

  expect(response.status).toBe(200);
  expect(requestQuotaRefreshRestart).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-refresh-scheduler.test.js
```

Expected: FAIL because endpoints/state contract missing.

- [ ] **Step 3: Implement endpoints and planner rules**

```js
// src/app/api/quota-refresh/status/route.js
import { NextResponse } from "next/server";
import { getQuotaRefreshSchedulerStatus } from "@/lib/quotaRefreshScheduler";

export async function GET() {
  return NextResponse.json(await getQuotaRefreshSchedulerStatus());
}
```

```js
// src/app/api/quota-refresh/run/route.js
import { NextResponse } from "next/server";
import { requestManualQuotaRefreshRestart } from "@/lib/quotaRefreshScheduler";

export async function POST() {
  const status = await requestManualQuotaRefreshRestart();
  return NextResponse.json(status);
}
```

```js
// src/lib/quotaRefreshPlanner.js
export function getDueQuotaRefreshConnections(connections = [], options = {}) {
  return connections
    .filter(isQuotaRefreshSupported)
    .filter((connection) => getQuotaRefreshDueDecision(connection, options).due);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-refresh-scheduler.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotaRefreshPlanner.js src/lib/quotaRefreshState.js src/lib/quotaRefreshScheduler.js src/app/api/quota-refresh/run/route.js src/app/api/quota-refresh/status/route.js tests/unit/quota-refresh-scheduler.test.js
git commit -m "feat(quota): add scheduler control APIs"
```

---

### Task 5: Convert quota tracker UI into read-only observer + backend trigger

**Files:**
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js`
- Modify: `tests/unit/provider-summary-and-usage-dedupe.test.js`
- Modify: `tests/unit/connection-effective-status.test.js`

- [ ] **Step 1: Write failing UI behavior tests**

```js
it("does not start browser auto-refresh interval on quota page", async () => {
  render(<ProviderLimits />);
  expect(setInterval).not.toHaveBeenCalledWith(expect.any(Function), 60000);
});

it("calls backend quota-refresh run endpoint when Refresh All clicked", async () => {
  render(<ProviderLimits />);
  await userEvent.click(screen.getByRole("button", { name: /refresh all/i }));
  expect(global.fetch).toHaveBeenCalledWith("/api/quota-refresh/run", expect.objectContaining({ method: "POST" }));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js
```

Expected: FAIL or missing coverage requiring new test scaffolding.

- [ ] **Step 3: Implement read-only UI + manual restart trigger**

```js
// ProviderLimits/index.js high-level shape
const REFRESH_INTERVAL_MS = null;

async function triggerRefreshAll() {
  const response = await fetch("/api/quota-refresh/run", { method: "POST" });
  if (!response.ok) throw new Error("Failed to restart quota refresh");
  await fetchConnections();
}

// remove:
// - autoRefresh state
// - countdown state
// - browser interval effect
// - direct fetchQuota mass fanout on load

// keep:
// - fetchConnections() reading merged shared state from /api/providers/client
// - current filter/search/pathname behavior
```

```js
// providers/[id]/page.js
// keep routing summary card read-only; no direct quota polling trigger added here
```

- [ ] **Step 4: Run tests to verify pass**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js
npx eslint "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js" "src/app/(dashboard)/dashboard/providers/[id]/page.js"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js src/app/(dashboard)/dashboard/providers/[id]/page.js tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js
git commit -m "feat(quota): make tracker scheduler-driven"
```

---

### Task 6: Full integration verification and regression lock-in

**Files:**
- Modify: `tests/unit/provider-hot-state.test.js`
- Modify: `tests/unit/auth-account-selection.test.js`
- Modify: `tests/unit/models-availability-route.test.js`
- Test: full regression suite

- [ ] **Step 1: Add critical integration regression test**

```js
it("immediately blocks a codex account after live quota exhaustion and skips it on next selection", async () => {
  await writeConnectionHotState({
    connectionId: "conn-exhausted",
    provider: "codex",
    patch: {
      routingStatus: "blocked_quota",
      quotaState: "exhausted",
      reasonCode: "quota_exhausted",
      nextRetryAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    },
  });

  const eligible = await getEligibleConnections("codex", [
    { id: "conn-exhausted", testStatus: "active" },
    { id: "conn-healthy", testStatus: "unknown" },
  ]);

  expect(eligible).toEqual([
    expect.objectContaining({ id: "conn-healthy" }),
  ]);
});
```

- [ ] **Step 2: Run full regression to verify failure/pass cycle**

Run:
```bash
npx vitest run --config tests/vitest.config.js tests/unit/provider-hot-state.test.js tests/unit/auth-account-selection.test.js tests/unit/usage-status-sync.test.js tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/connection-effective-status.test.js tests/unit/models-availability-route.test.js tests/unit/quota-refresh-planner.test.js tests/unit/quota-refresh-scheduler.test.js
```

Expected: FAIL before final test wiring, PASS after completion.

- [ ] **Step 3: Run lint and final focused verification**

Run:
```bash
npx eslint "src/lib/quotaRefreshPlanner.js" "src/lib/quotaRefreshState.js" "src/lib/quotaRefreshScheduler.js" "src/app/api/quota-refresh/run/route.js" "src/app/api/quota-refresh/status/route.js" "src/app/api/usage/[connectionId]/route.js" "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js" "src/shared/services/initializeApp.js" "tests/unit/quota-refresh-planner.test.js" "tests/unit/quota-refresh-scheduler.test.js"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/provider-hot-state.test.js tests/unit/auth-account-selection.test.js tests/unit/models-availability-route.test.js tests/unit/quota-refresh-planner.test.js tests/unit/quota-refresh-scheduler.test.js
git commit -m "test(quota): lock scheduler routing regressions"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - backend scheduler loop: Tasks 2, 4
  - configurable settings: Task 1
  - one backend-driven quota state path: Task 3
  - manual Refresh All cancel/restart: Task 4 + Task 5
  - remove quota page auto-refresh: Task 5
  - router consumes shared state only: Tasks 3, 6
  - live Codex exhaustion immediate update: Tasks 3, 6
  - near-window rechecks only: Tasks 1, 4
- **Placeholder scan:** no TBD/TODO/fill-later markers intentionally left.
- **Type consistency:** scheduler naming kept consistent across tasks:
  - `quotaSchedulerEnabled`
  - `quotaRefreshIntervalMinutes`
  - `quotaNearWindowMinutes`
  - `quotaManualRefreshDebounceSeconds`
  - `quotaSchedulerStartupCatchup`
  - `runQuotaRefreshSweep`
  - `requestManualQuotaRefreshRestart`
