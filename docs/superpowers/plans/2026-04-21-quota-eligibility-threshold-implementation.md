# Quota Eligibility Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a configurable global minimum remaining-quota percentage so only accounts above that threshold remain router-eligible and visible under the `Eligible` quota filter.

**Architecture:** Persist one global `quotaEligibilityThresholdPercent` setting, derive `remainingQuotaPercent` plus threshold-based blocked reasons from canonical usage state, and enforce that result in the centralized eligibility/router layer. UI surfaces the setting on the profile/settings page and treats below-threshold accounts as quota-blocked/read-only shared-state results rather than inventing page-local logic.

**Tech Stack:** Next.js App Router, local JSON DB settings (`src/lib/localDb.js`), centralized provider hot state (`src/lib/providerHotState.js`), shared usage-status helpers (`src/lib/usageStatus.js`), React dashboard UI, Vitest.

---

## File Structure

- Modify: `src/lib/localDb.js`
  - Persist the new global setting in defaults and nested settings merge logic.
- Modify: `src/app/(dashboard)/dashboard/profile/page.js`
  - Add editable UI control for `quotaEligibilityThresholdPercent` alongside scheduler settings.
- Modify: `src/lib/usageStatus.js`
  - Derive `remainingQuotaPercent` and threshold-based blocked reason/canonical state from `usageSnapshot`.
- Modify: `src/lib/providerHotState.js`
  - Enforce threshold in centralized eligibility decisions and fallback eligibility checks.
- Modify: `src/lib/connectionStatus.js`
  - Ensure threshold-blocked accounts map to quota-blocked/filter-safe semantics, not `eligible`.
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`
  - Ensure quota page copy/filter presentation reflects threshold-blocked state without browser-side custom logic.
- Test: `tests/unit/local-db-quota-scheduler-settings.test.js`
  - Settings persistence/default/merge tests for `quotaEligibilityThresholdPercent`.
- Test: `tests/unit/usage-status-sync.test.js`
  - Canonical threshold-state derivation tests from usage snapshots.
- Test: `tests/unit/provider-hot-state.test.js`
  - Centralized eligibility enforcement tests for threshold-blocked accounts.
- Test: `tests/unit/connection-effective-status.test.js`
  - Status/filter semantics for below-threshold accounts.
- Test: `tests/unit/auth-account-selection.test.js`
  - Router/auth selection skips below-threshold accounts when choosing credentials.

### Task 1: Persist the global threshold setting

**Files:**
- Modify: `src/lib/localDb.js`
- Test: `tests/unit/local-db-quota-scheduler-settings.test.js`

- [ ] **Step 1: Write the failing settings tests**

```js
it("returns quota eligibility threshold default from fresh settings", async () => {
  const settings = await getSettings();

  expect(settings.quotaEligibilityThresholdPercent).toBe(10);
});

it("preserves explicit quota eligibility threshold updates", async () => {
  await updateSettings({ quotaEligibilityThresholdPercent: 25 });

  const settings = await getSettings();
  expect(settings.quotaEligibilityThresholdPercent).toBe(25);
});

it("keeps the explicit threshold when nested quotaScheduler updates are merged", async () => {
  await updateSettings({ quotaEligibilityThresholdPercent: 15 });
  await updateSettings({ quotaScheduler: { cadenceMs: 900000 } });

  const settings = await getSettings();
  expect(settings.quotaEligibilityThresholdPercent).toBe(15);
  expect(settings.quotaScheduler.cadenceMs).toBe(900000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/local-db-quota-scheduler-settings.test.js`
Expected: FAIL with missing `quotaEligibilityThresholdPercent` default/merge expectations.

- [ ] **Step 3: Implement the minimal persistence change**

```js
export const DEFAULT_SETTINGS = {
  // existing settings...
  quotaEligibilityThresholdPercent: 10,
  quotaScheduler: normalizeQuotaSchedulerSettings(),
};

function mergeSettingsWithDefaults(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    quotaEligibilityThresholdPercent:
      Number.isFinite(Number(settings?.quotaEligibilityThresholdPercent))
        ? Math.min(100, Math.max(0, Number(settings.quotaEligibilityThresholdPercent)))
        : DEFAULT_SETTINGS.quotaEligibilityThresholdPercent,
    quotaScheduler: {
      ...normalizeQuotaSchedulerSettings(),
      ...(settings?.quotaScheduler || {}),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/local-db-quota-scheduler-settings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/localDb.js tests/unit/local-db-quota-scheduler-settings.test.js
git commit -m "feat(settings): add quota threshold"
```

### Task 2: Derive threshold-blocked canonical quota state

**Files:**
- Modify: `src/lib/usageStatus.js`
- Test: `tests/unit/usage-status-sync.test.js`

- [ ] **Step 1: Write the failing threshold derivation tests**

```js
it("marks codex accounts below the threshold as blocked quota even when not exhausted", async () => {
  const updates = getUsageStatusUpdates(
    { provider: "codex", authType: "oauth" },
    {
      quota: {
        session: { percentRemaining: 7, remaining: 7, limit: 100, exhausted: false },
      },
    },
    { quotaEligibilityThresholdPercent: 10 },
  );

  expect(updates).toMatchObject({
    routingStatus: "blocked_quota",
    quotaState: "ok",
    reasonCode: "quota_below_threshold",
    remainingQuotaPercent: 7,
  });
});

it("keeps accounts above the threshold eligible", async () => {
  const updates = getUsageStatusUpdates(
    { provider: "codex", authType: "oauth" },
    {
      quota: {
        session: { percentRemaining: 11, remaining: 11, limit: 100, exhausted: false },
      },
    },
    { quotaEligibilityThresholdPercent: 10 },
  );

  expect(updates).toMatchObject({
    routingStatus: "eligible",
    quotaState: "ok",
    remainingQuotaPercent: 11,
  });
});

it("does not block providers without usable percentage data by threshold alone", async () => {
  const updates = getUsageStatusUpdates(
    { provider: "codex", authType: "oauth" },
    { quota: { session: { remaining: 7, limit: 100, exhausted: false } } },
    { quotaEligibilityThresholdPercent: 10 },
  );

  expect(updates.reasonCode).not.toBe("quota_below_threshold");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/usage-status-sync.test.js`
Expected: FAIL with missing threshold-based canonical derivation.

- [ ] **Step 3: Implement the minimal canonical derivation changes**

```js
function getRemainingQuotaPercent(usage) {
  const quotaBuckets = Object.values(usage?.quota || {});
  const candidate = quotaBuckets.find((bucket) => Number.isFinite(bucket?.percentRemaining));
  return candidate ? Number(candidate.percentRemaining) : null;
}

function getQuotaThresholdPatch(usage, thresholdPercent) {
  const remainingQuotaPercent = getRemainingQuotaPercent(usage);
  if (!Number.isFinite(remainingQuotaPercent)) {
    return { remainingQuotaPercent: null };
  }

  if (remainingQuotaPercent <= thresholdPercent) {
    return {
      remainingQuotaPercent,
      routingStatus: "blocked_quota",
      quotaState: "ok",
      reasonCode: "quota_below_threshold",
      reasonDetail: `Remaining quota ${remainingQuotaPercent}% is below minimum eligible threshold ${thresholdPercent}%`,
    };
  }

  return {
    remainingQuotaPercent,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/usage-status-sync.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/usageStatus.js tests/unit/usage-status-sync.test.js
git commit -m "feat(quota): derive threshold blocks"
```

### Task 3: Enforce the threshold in centralized eligibility and auth routing

**Files:**
- Modify: `src/lib/providerHotState.js`
- Test: `tests/unit/provider-hot-state.test.js`
- Test: `tests/unit/auth-account-selection.test.js`

- [ ] **Step 1: Write the failing eligibility/routing tests**

```js
it("excludes below-threshold accounts from centralized eligibility", async () => {
  await setConnectionHotState("conn-low", "provider-threshold", {
    routingStatus: "blocked_quota",
    quotaState: "ok",
    reasonCode: "quota_below_threshold",
    remainingQuotaPercent: 7,
  });

  expect(await getEligibleConnections("provider-threshold", [
    { id: "conn-low", testStatus: "active" },
    { id: "conn-ok", testStatus: "active" },
  ])).toEqual([
    { id: "conn-ok", testStatus: "active" },
  ]);
});

it("skips below-threshold accounts in auth selection", async () => {
  getEligibleConnections.mockResolvedValueOnce([
    { id: "conn-ok", provider: "codex", isActive: true, priority: 2, accessToken: "ok", testStatus: "active" },
  ]);

  const credentials = await getProviderCredentials("codex", null, "gpt-4.1");
  expect(credentials.connectionId).toBe("conn-ok");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/provider-hot-state.test.js tests/unit/auth-account-selection.test.js`
Expected: FAIL with below-threshold accounts still appearing eligible.

- [ ] **Step 3: Implement the centralized eligibility enforcement**

```js
function isConnectionEligible(state = {}) {
  if (state?.reasonCode === "quota_below_threshold") {
    return false;
  }

  // existing auth/health/quota/cooldown checks...
}

function isFallbackEligibleConnection(state = {}) {
  if (state?.reasonCode === "quota_below_threshold") {
    return false;
  }

  return isConnectionEligible(state)
    && ["active", "success", "unknown"].includes(state?.testStatus || "unknown");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/provider-hot-state.test.js tests/unit/auth-account-selection.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providerHotState.js tests/unit/provider-hot-state.test.js tests/unit/auth-account-selection.test.js
git commit -m "feat(routing): enforce quota threshold"
```

### Task 4: Surface the threshold in settings UI

**Files:**
- Modify: `src/app/(dashboard)/dashboard/profile/page.js`
- Test: `tests/unit/local-db-quota-scheduler-settings.test.js`

- [ ] **Step 1: Write the failing UI/settings test notes**

```js
it("persists quota eligibility threshold updates from settings payloads", async () => {
  await updateSettings({ quotaEligibilityThresholdPercent: 5 });

  const settings = await getSettings();
  expect(settings.quotaEligibilityThresholdPercent).toBe(5);
});
```

- [ ] **Step 2: Run test to verify it fails or is incomplete**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/local-db-quota-scheduler-settings.test.js`
Expected: FAIL until the new field is surfaced end-to-end.

- [ ] **Step 3: Add the settings page control**

```jsx
<label className="space-y-2">
  <span className="text-sm font-medium text-slate-200">Minimum eligible quota (%)</span>
  <input
    type="number"
    min="0"
    max="100"
    step="1"
    value={quotaForm.quotaEligibilityThresholdPercent}
    onChange={(event) =>
      setQuotaForm((current) => ({
        ...current,
        quotaEligibilityThresholdPercent: event.target.value,
      }))
    }
    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
  />
</label>
```

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/local-db-quota-scheduler-settings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/dashboard/profile/page.js tests/unit/local-db-quota-scheduler-settings.test.js
git commit -m "feat(settings): expose quota threshold"
```

### Task 5: Align status/filter semantics and quota page behavior

**Files:**
- Modify: `src/lib/connectionStatus.js`
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`
- Test: `tests/unit/connection-effective-status.test.js`

- [ ] **Step 1: Write the failing status/filter tests**

```js
it("treats quota-below-threshold accounts as blocked_quota for filters", () => {
  expect(getConnectionFilterStatus({
    routingStatus: "blocked_quota",
    quotaState: "ok",
    reasonCode: "quota_below_threshold",
    remainingQuotaPercent: 7,
  })).toBe("blocked_quota");
});

it("does not keep below-threshold accounts under eligible badge/filter semantics", () => {
  expect(getConnectionCentralizedStatus({
    routingStatus: "blocked_quota",
    quotaState: "ok",
    reasonCode: "quota_below_threshold",
  })).toBe("blocked_quota");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/connection-effective-status.test.js`
Expected: FAIL with threshold-blocked rows still treated as eligible/unknown.

- [ ] **Step 3: Implement the minimal status/filter semantics and copy updates**

```js
if (connection?.reasonCode === "quota_below_threshold") {
  return "blocked_quota";
}
```

```jsx
const thresholdSummary = connection.reasonCode === "quota_below_threshold"
  ? `Below threshold (${connection.remainingQuotaPercent}% < ${settings.quotaEligibilityThresholdPercent}%)`
  : null;
```

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/connection-effective-status.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connectionStatus.js src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js tests/unit/connection-effective-status.test.js
git commit -m "fix(quota): classify threshold blocks"
```

### Task 6: Full threshold regression sweep

**Files:**
- Verify: `tests/unit/local-db-quota-scheduler-settings.test.js`
- Verify: `tests/unit/usage-status-sync.test.js`
- Verify: `tests/unit/provider-hot-state.test.js`
- Verify: `tests/unit/connection-effective-status.test.js`
- Verify: `tests/unit/auth-account-selection.test.js`

- [ ] **Step 1: Run the focused threshold suite**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/local-db-quota-scheduler-settings.test.js tests/unit/usage-status-sync.test.js tests/unit/provider-hot-state.test.js tests/unit/connection-effective-status.test.js tests/unit/auth-account-selection.test.js`
Expected: PASS with all threshold-related regressions green.

- [ ] **Step 2: Run the broader regression guardrail**

Run: `npx vitest run --config tests/vitest.config.js tests/unit/provider-summary-and-usage-dedupe.test.js tests/unit/quota-refresh-api.test.js tests/unit/codex-provider-limits-utils.test.js`
Expected: PASS with no threshold regressions leaking into scheduler/quota UI support code.

- [ ] **Step 3: Run lint on touched files**

Run: `npx eslint "src/lib/localDb.js" "src/lib/usageStatus.js" "src/lib/providerHotState.js" "src/lib/connectionStatus.js" "src/app/(dashboard)/dashboard/profile/page.js" "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js" "tests/unit/local-db-quota-scheduler-settings.test.js" "tests/unit/usage-status-sync.test.js" "tests/unit/provider-hot-state.test.js" "tests/unit/connection-effective-status.test.js" "tests/unit/auth-account-selection.test.js"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/localDb.js src/lib/usageStatus.js src/lib/providerHotState.js src/lib/connectionStatus.js src/app/(dashboard)/dashboard/profile/page.js src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js tests/unit/local-db-quota-scheduler-settings.test.js tests/unit/usage-status-sync.test.js tests/unit/provider-hot-state.test.js tests/unit/connection-effective-status.test.js tests/unit/auth-account-selection.test.js
git commit -m "feat(quota): add eligibility threshold"
```
