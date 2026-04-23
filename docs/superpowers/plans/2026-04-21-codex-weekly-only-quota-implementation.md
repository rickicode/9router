# Codex Weekly-Only Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex accounts with no 5h/session window use weekly quota as the exhaustion source of truth, and show only weekly quota in the UI.

**Architecture:** Treat missing `rate_limit.primary_window` as real absence, not a zeroed session quota. Keep the change localized to Codex usage parsing in `open-sse/services/usage.js`, Codex-aware status syncing in `src/app/api/usage/[connectionId]/route.js`, and the Provider Limits quota normalization/render path so the UI naturally hides the absent session bar.

**Tech Stack:** Next.js 16, React 19, Node route handlers, Vitest, open-sse service layer.

---

## File Map

- **Modify:** `open-sse/services/usage.js`
  - Responsibility: parse Codex usage payloads and return truthful `quotas` data.
- **Modify:** `src/app/api/usage/[connectionId]/route.js`
  - Responsibility: translate successful usage fetches into connection status updates.
- **Modify:** `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`
  - Responsibility: normalize quota objects for UI rendering without assuming Codex session always exists.
- **Verify / maybe modify lightly:** `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js`
  - Responsibility: render whatever quota rows are provided; likely no behavior change needed if the backend omits absent session quotas.
- **Modify:** `tests/unit/usage-status-sync.test.js`
  - Responsibility: cover Codex weekly-only status sync behavior.
- **Create:** `tests/unit/codex-usage-parsing.test.js`
  - Responsibility: cover Codex quota parsing with and without `primary_window`.

## Task 1: Codex quota parsing tells the truth

**Files:**
- Modify: `open-sse/services/usage.js:482-526`
- Create: `tests/unit/codex-usage-parsing.test.js`

- [ ] **Step 1: Write the failing parsing test for missing session window**

```js
import { describe, it, expect, vi, afterEach } from "vitest";

describe("getCodexUsage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits session quota when primary_window is absent and keeps weekly quota", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plan_type: "free",
        rate_limit: {
          secondary_window: {
            used_percent: 100,
            reset_at: 1760000000,
          },
        },
      }),
    })));

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");

    const result = await getUsageForProvider({
      provider: "codex",
      accessToken: "token",
      providerSpecificData: {},
    });

    expect(result.quotas.session).toBeUndefined();
    expect(result.quotas.weekly).toEqual(
      expect.objectContaining({
        used: 100,
        total: 100,
        remaining: 0,
      }),
    );
  });
});
```

- [ ] **Step 2: Run the parsing test to confirm current behavior fails**

Run:

```bash
cd /workspaces/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/codex-usage-parsing.test.js --config ./vitest.config.js
```

Expected: FAIL because current `getCodexUsage()` always returns `quotas.session` even when `primary_window` is missing.

- [ ] **Step 3: Implement minimal Codex parsing change**

Update the Codex parser so it only creates quota entries for windows that actually exist:

```js
async function getCodexUsage(accessToken) {
  try {
    const response = await fetch(CODEX_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return { message: `Codex connected. Usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();
    const rateLimit = data.rate_limit || {};
    const primaryWindow = rateLimit.primary_window;
    const secondaryWindow = rateLimit.secondary_window;
    const quotas = {};

    if (primaryWindow) {
      quotas.session = {
        used: primaryWindow.used_percent || 0,
        total: 100,
        remaining: 100 - (primaryWindow.used_percent || 0),
        resetAt: parseResetTime(primaryWindow.reset_at ? primaryWindow.reset_at * 1000 : null),
        unlimited: false,
      };
    }

    if (secondaryWindow) {
      quotas.weekly = {
        used: secondaryWindow.used_percent || 0,
        total: 100,
        remaining: 100 - (secondaryWindow.used_percent || 0),
        resetAt: parseResetTime(secondaryWindow.reset_at ? secondaryWindow.reset_at * 1000 : null),
        unlimited: false,
      };
    }

    return {
      plan: data.plan_type || "unknown",
      limitReached: rateLimit.limit_reached || false,
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}
```

- [ ] **Step 4: Add the companion parsing test for normal dual-window accounts**

Extend `tests/unit/codex-usage-parsing.test.js` with:

```js
it("keeps both session and weekly quotas when both windows exist", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 40, reset_at: 1760000000 },
        secondary_window: { used_percent: 65, reset_at: 1761000000 },
      },
    }),
  })));

  const { getUsageForProvider } = await import("../../open-sse/services/usage.js");

  const result = await getUsageForProvider({
    provider: "codex",
    accessToken: "token",
    providerSpecificData: {},
  });

  expect(result.quotas.session).toEqual(expect.objectContaining({ used: 40, remaining: 60 }));
  expect(result.quotas.weekly).toEqual(expect.objectContaining({ used: 65, remaining: 35 }));
});
```

- [ ] **Step 5: Re-run the parsing tests**

Run:

```bash
cd /workspaces/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/codex-usage-parsing.test.js --config ./vitest.config.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add open-sse/services/usage.js tests/unit/codex-usage-parsing.test.js
git commit -m "test: cover codex weekly-only quota parsing"
```

## Task 2: Weekly-only Codex accounts sync the correct status

**Files:**
- Modify: `src/app/api/usage/[connectionId]/route.js:19-31,175-206`
- Modify: `tests/unit/usage-status-sync.test.js`

- [ ] **Step 1: Add failing tests for weekly-only status sync**

Append these tests to `tests/unit/usage-status-sync.test.js`:

```js
it("marks weekly-only Codex connections unavailable when weekly quota is exhausted", async () => {
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
  expect(updateProviderConnection).toHaveBeenCalledWith(
    "conn-weekly-exhausted",
    expect.objectContaining({ testStatus: "unavailable" }),
  );
});

it("keeps weekly-only Codex connections active when weekly quota remains", async () => {
  mockConnections.push({
    id: "conn-weekly-active",
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
        used: 55,
        total: 100,
        remaining: 45,
        resetAt: "2026-04-25T00:00:00.000Z",
      },
    },
  });

  const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
  const response = await GET(new Request("http://localhost/api/usage/conn-weekly-active"), {
    params: Promise.resolve({ connectionId: "conn-weekly-active" }),
  });

  expect(response.status).toBe(200);
  expect(updateProviderConnection).toHaveBeenCalledWith(
    "conn-weekly-active",
    expect.objectContaining({ testStatus: "active" }),
  );
});
```

- [ ] **Step 2: Run the usage status sync test file to confirm the new case fails first**

Run:

```bash
cd /workspaces/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/usage-status-sync.test.js --config ./vitest.config.js
```

Expected: FAIL because the route currently marks every successful usage fetch as `active`.

- [ ] **Step 3: Add a small Codex-aware status decision helper**

In `src/app/api/usage/[connectionId]/route.js`, add:

```js
function getUsageStatusUpdates(connection, usage) {
  const base = {
    testStatus: "active",
    lastError: null,
    lastErrorType: null,
    lastErrorAt: null,
    rateLimitedUntil: null,
    errorCode: null,
  };

  if (connection?.provider !== "codex") {
    return base;
  }

  const sessionQuota = usage?.quotas?.session;
  const weeklyQuota = usage?.quotas?.weekly;
  const isWeeklyOnly = !sessionQuota && weeklyQuota;

  if (!isWeeklyOnly) {
    return base;
  }

  if ((weeklyQuota.remaining ?? 0) <= 0) {
    return {
      ...base,
      testStatus: "unavailable",
      lastError: "Codex weekly quota exhausted",
      lastErrorType: "quota_exhausted",
      lastErrorAt: new Date().toISOString(),
      rateLimitedUntil: weeklyQuota.resetAt || null,
      errorCode: "weekly_quota_exhausted",
    };
  }

  return base;
}
```

- [ ] **Step 4: Use the helper in the success path**

Replace the unconditional success sync block with:

```js
if (shouldMarkActive) {
  await syncUsageStatus(connection, getUsageStatusUpdates(connection, usage));
}
```

This keeps all non-Codex providers on the old path and makes weekly-only Codex exhaustion explicit.

- [ ] **Step 5: Re-run the status sync tests**

Run:

```bash
cd /workspaces/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/usage-status-sync.test.js --config ./vitest.config.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/app/api/usage/[connectionId]/route.js tests/unit/usage-status-sync.test.js
git commit -m "fix: sync codex weekly-only quota exhaustion"
```

## Task 3: Weekly-only accounts show weekly-only in the UI

**Files:**
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js:119-130`
- Verify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js:111-122,658-664`
- Verify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js:73-162`

- [ ] **Step 1: Add a defensive normalization rule for Codex quotas**

Update the Codex branch in `parseQuotaData()` to skip empty quota entries rather than blindly rendering everything in `data.quotas`:

```js
case "codex":
  if (data.quotas) {
    Object.entries(data.quotas).forEach(([quotaType, quota]) => {
      if (!quota || typeof quota !== "object") return;

      normalizedQuotas.push({
        name: quotaType,
        used: quota.used || 0,
        total: quota.total || 0,
        resetAt: quota.resetAt || null,
        remaining: quota.remaining,
      });
    });
  }
  break;
```

The critical behavior here is that absent `session` is not synthesized by the UI layer.

- [ ] **Step 2: Add a tiny parser test or assertion for weekly-only Codex rendering input**

If you keep tests colocated in the existing unit suite, add a small test file such as `tests/unit/codex-provider-limits-utils.test.js` with:

```js
import { describe, it, expect } from "vitest";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("parseQuotaData for codex", () => {
  it("returns only weekly quota when session is absent", () => {
    const result = parseQuotaData("codex", {
      quotas: {
        weekly: {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    expect(result).toEqual([
      expect.objectContaining({ name: "weekly", used: 100, total: 100 }),
    ]);
  });
});
```

- [ ] **Step 3: Run the parser/UI normalization tests**

Run:

```bash
cd /workspaces/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/codex-provider-limits-utils.test.js unit/codex-usage-parsing.test.js unit/usage-status-sync.test.js --config ./vitest.config.js
```

Expected: PASS.

- [ ] **Step 4: Run the production build**

Run:

```bash
cd /workspaces/9router && npm run build
```

Expected: successful Next.js production build. Pre-existing unrelated warnings are acceptable if they were already present before this work.

- [ ] **Step 5: Manually verify the weekly-only UI behavior**

Use the existing app flow and confirm the following:

```text
1. Open /dashboard/usage.
2. Refresh a Codex account that has only weekly quota data.
3. Confirm the card/table shows only one row: weekly.
4. Confirm no 5h/session row is shown.
5. Confirm a weekly-exhausted account lands in the existing exhausted/unavailable filter bucket.
```

- [ ] **Step 6: Commit Task 3**

```bash
git add src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js \
        tests/unit/codex-provider-limits-utils.test.js \
        docs/superpowers/specs/2026-04-21-codex-weekly-only-quota-design.md
git commit -m "feat: support codex weekly-only quota display"
```

## Final Verification Checklist

- [ ] `tests/unit/codex-usage-parsing.test.js` passes.
- [ ] `tests/unit/usage-status-sync.test.js` passes.
- [ ] `tests/unit/codex-provider-limits-utils.test.js` passes.
- [ ] `npm run build` passes.
- [ ] Weekly-only Codex accounts show only weekly quota in the UI.
- [ ] Weekly-only exhausted Codex accounts sync to the existing unavailable/exhausted path.
- [ ] Dual-window Codex accounts still show both session and weekly quotas.

## Spec Coverage Map

- **Weekly-only parsing** → Task 1
- **Weekly as exhaustion source of truth** → Task 2
- **Weekly-only UI rendering** → Task 3
- **Preserve dual-window behavior** → Task 1 + Task 2 + final verification
