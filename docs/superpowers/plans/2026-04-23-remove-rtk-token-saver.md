# Remove RTK Token Saver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the RTK Token Saver feature end-to-end so the dashboard, settings model, startup path, translator runtime, tests, and changelog no longer expose or depend on RTK.

**Architecture:** This is a subtraction-only cleanup. Remove `rtkEnabled` from the settings surface and delete all RTK runtime hooks so the app boots and translates requests without any RTK initialization, compression, or logging. Then delete the now-unreferenced `open-sse/rtk` implementation and its dedicated tests.

**Tech Stack:** Next.js App Router, React client components, lowdb, Open SSE translator modules, Vitest

---

## File Map

### Settings and persistence
- Modify: `src/lib/localDb.js` — remove `rtkEnabled` from `DEFAULT_SETTINGS` and merged settings shape.
- Modify: `src/app/api/settings/route.js` — stop importing RTK flag helpers and stop syncing `rtkEnabled` during PATCH.

### Dashboard UI
- Modify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` — remove RTK local state, settings load/save wiring, handler, and Token Saver card UI.

### Startup and runtime
- Modify: `src/app/layout.js` — remove RTK startup import.
- Delete: `src/lib/rtk/initRtk.js` — remove boot-time RTK initialization helper.
- Modify: `open-sse/translator/index.js` — remove RTK compression and RTK log emission from `translateRequest`.
- Delete: `open-sse/rtk/index.js`
- Delete: `open-sse/rtk/flag.js`
- Delete: `open-sse/rtk/constants.js`
- Delete: `open-sse/rtk/autodetect.js`
- Delete: `open-sse/rtk/applyFilter.js`
- Delete: `open-sse/rtk/registry.js`
- Delete: `open-sse/rtk/filters/gitDiff.js`
- Delete: `open-sse/rtk/filters/gitStatus.js`
- Delete: `open-sse/rtk/filters/grep.js`
- Delete: `open-sse/rtk/filters/find.js`
- Delete: `open-sse/rtk/filters/dedupLog.js`
- Delete: `open-sse/rtk/filters/ls.js`
- Delete: `open-sse/rtk/filters/tree.js`
- Delete: `open-sse/rtk/filters/smartTruncate.js`
- Delete: `open-sse/rtk/filters/readNumbered.js`
- Delete: `open-sse/rtk/filters/searchList.js`

### Documentation and tests
- Modify: `CHANGELOG.md` — remove RTK feature entry.
- Modify: `tests/unit/local-db-quota-scheduler-settings.test.js` — assert fresh settings no longer include `rtkEnabled`.
- Modify: `tests/unit/quota-refresh-api.test.js` — assert `/api/settings` responses and PATCH behavior no longer expose or depend on `rtkEnabled`.
- Modify: `tests/unit/translator-request-normalization.test.js` — add coverage that `translateRequest` still preserves request normalization without RTK imports.
- Delete: `tests/unit/rtk.test.js`
- Delete: `tests/unit/rtk.e2e.test.js`
- Delete: `tests/unit/rtk.multi-provider.e2e.test.js`

---

### Task 1: Remove RTK from persisted settings and settings API

**Files:**
- Modify: `src/lib/localDb.js:25-49, 89-107`
- Modify: `src/app/api/settings/route.js:1-111`
- Test: `tests/unit/local-db-quota-scheduler-settings.test.js`
- Test: `tests/unit/quota-refresh-api.test.js`

- [ ] **Step 1: Write the failing localDb test for RTK-free settings defaults**

```js
it("does not expose rtkEnabled in fresh or updated settings", async () => {
  const localDb = await loadLocalDb();

  const fresh = await localDb.getSettings();
  expect(fresh).not.toHaveProperty("rtkEnabled");

  const updated = await localDb.updateSettings({
    quotaExhaustedThresholdPercent: 15,
  });

  expect(updated).not.toHaveProperty("rtkEnabled");
  await expect(localDb.getSettings()).resolves.not.toHaveProperty("rtkEnabled");
});
```

- [ ] **Step 2: Write the failing settings route tests for RTK-free GET/PATCH behavior**

```js
it("omits rtkEnabled from settings GET responses", async () => {
  getSettings.mockResolvedValueOnce({
    quotaExhaustedThresholdPercent: 17,
    rtkEnabled: true,
    quotaScheduler: { enabled: true, cadenceMs: 900000 },
  });

  const { GET } = await import("../../src/app/api/settings/route.js");
  const response = await GET();

  expect(response.status).toBe(200);
  expect(response.body).not.toHaveProperty("rtkEnabled");
  expect(response.body).toMatchObject({
    quotaExhaustedThresholdPercent: 17,
  });
});

it("returns PATCH payload without rtkEnabled and only refreshes quota scheduler for quota settings", async () => {
  updateSettings.mockResolvedValueOnce({
    quotaExhaustedThresholdPercent: 22,
    quotaScheduler: { enabled: true, cadenceMs: 900000 },
  });
  refreshSchedule.mockResolvedValueOnce({ started: true, enabled: true });

  const { PATCH } = await import("../../src/app/api/settings/route.js");
  const response = await PATCH(new Request("http://localhost/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ quotaExhaustedThresholdPercent: 22 }),
    headers: { "content-type": "application/json" },
  }));

  expect(response.status).toBe(200);
  expect(response.body).not.toHaveProperty("rtkEnabled");
  expect(refreshSchedule).toHaveBeenCalledWith("settings_update");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- local-db-quota-scheduler-settings.test.js quota-refresh-api.test.js`
Expected: FAIL because current defaults and settings route still include RTK state.

- [ ] **Step 4: Remove `rtkEnabled` from default settings and merged settings output**

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
  quotaExhaustedThresholdPercent: 10,
};

function mergeSettingsWithDefaults(settings = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {}),
  };

  merged.quotaExhaustedThresholdPercent = normalizeQuotaExhaustedThresholdPercent(
    settings?.quotaExhaustedThresholdPercent
  );

  merged.quotaScheduler = {
    ...normalizeQuotaSchedulerSettings(
      settings?.quotaScheduler && typeof settings.quotaScheduler === "object" && !Array.isArray(settings.quotaScheduler)
        ? settings.quotaScheduler
        : {}
    ),
  };

  delete merged.rtkEnabled;
  return merged;
}
```

- [ ] **Step 5: Remove RTK imports and RTK PATCH synchronization from the settings route**

```js
import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { getQuotaRefreshScheduler } from "@/lib/quotaRefreshScheduler";
import { readRuntimeConfig } from "@/lib/runtimeConfig";
import bcrypt from "bcryptjs";

export async function PATCH(request) {
  try {
    const body = await request.json();
    const settings = await updateSettings(body);

    const shouldRefreshQuotaScheduler = (
      Object.prototype.hasOwnProperty.call(body, "quotaScheduler")
      || Object.prototype.hasOwnProperty.call(body, "quotaExhaustedThresholdPercent")
    );

    if (shouldRefreshQuotaScheduler) {
      await getQuotaRefreshScheduler().refreshSchedule("settings_update");
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    const { password, ...safeSettings } = settings;
    return NextResponse.json(safeSettings);
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /workspaces/9router/tests && npm run test:all -- local-db-quota-scheduler-settings.test.js quota-refresh-api.test.js`
Expected: PASS with no `rtkEnabled` key in localDb defaults or `/api/settings` responses.

- [ ] **Step 7: Commit**

```bash
git add src/lib/localDb.js src/app/api/settings/route.js tests/unit/local-db-quota-scheduler-settings.test.js tests/unit/quota-refresh-api.test.js
git commit -m "refactor: remove RTK settings state"
```

---

### Task 2: Remove Token Saver dashboard UI and startup init hook

**Files:**
- Modify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js:24-29, 71-85, 172-183, 816-850`
- Modify: `src/app/layout.js:1-7`
- Delete: `src/lib/rtk/initRtk.js`

- [ ] **Step 1: Write the failing source-level regression tests for the endpoint page and layout**

```js
import fs from "node:fs";
import path from "node:path";

it("endpoint page source no longer contains Token Saver UI or rtkEnabled wiring", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"),
    "utf8"
  );

  expect(source).not.toMatch(/Token Saver/);
  expect(source).not.toMatch(/rtkEnabled/);
  expect(source).not.toMatch(/handleRtkEnabled/);
});

it("root layout source no longer imports RTK initialization", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../src/app/layout.js"),
    "utf8"
  );

  expect(source).not.toMatch(/@\/lib\/rtk\/initRtk/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspaces/9router/tests && npm run test:all -- quota-refresh-api.test.js`
Expected: FAIL because `EndpointPageClient.js` still contains `Token Saver`, `rtkEnabled`, and `handleRtkEnabled`, and `layout.js` still imports `@/lib/rtk/initRtk`.

- [ ] **Step 3: Remove RTK page state, load wiring, handler, and Token Saver card from the endpoint page**

```js
const [requireApiKey, setRequireApiKey] = useState(false);
const [requireLogin, setRequireLogin] = useState(true);
const [hasPassword, setHasPassword] = useState(true);
const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);

// inside loadSettings()
if (settingsRes.ok) {
  const data = await settingsRes.json();
  setRequireApiKey(data.requireApiKey || false);
  setRequireLogin(data.requireLogin !== false);
  setHasPassword(data.hasPassword || false);
  setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
}

// delete handleRtkEnabled entirely

// delete this whole card block
{/* Token Saver (RTK) */}
```

- [ ] **Step 4: Remove the RTK startup import from the app layout**

```js
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/initCloudSync";
import "@/lib/network/initOutboundProxy";
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
```

- [ ] **Step 5: Delete the RTK initializer file**

```bash
rm /workspaces/9router/src/lib/rtk/initRtk.js
```

- [ ] **Step 6: Run the focused tests again**

Run: `cd /workspaces/9router/tests && npm run test:all -- quota-refresh-api.test.js`
Expected: PASS with no Token Saver UI strings or RTK init import remaining in the source files.

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js src/app/layout.js src/lib/rtk/initRtk.js tests/unit/quota-refresh-api.test.js
git commit -m "refactor: remove Token Saver UI and boot init"
```

---

### Task 3: Remove RTK from the translator request pipeline

**Files:**
- Modify: `open-sse/translator/index.js:1-153`
- Test: `tests/unit/translator-request-normalization.test.js`

- [ ] **Step 1: Write the failing translator regression tests**

```js
import fs from "node:fs";
import path from "node:path";

it("translateRequest preserves Claude->OpenAI normalization without RTK hooks", () => {
  const body = {
    model: "ollama/gpt-oss:120b",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
    ],
    stream: true,
  };

  const result = translateRequest(
    FORMATS.CLAUDE,
    FORMATS.OPENAI,
    "gpt-oss:120b",
    JSON.parse(JSON.stringify(body)),
    true,
    null,
    "ollama",
  );

  expect(result.messages[0].content).toBe("hello\nworld");
});

it("translator source no longer imports RTK helpers", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../open-sse/translator/index.js"),
    "utf8"
  );

  expect(source).not.toMatch(/compressMessages/);
  expect(source).not.toMatch(/formatRtkLog/);
  expect(source).not.toMatch(/\.\.\/rtk\/index\.js/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspaces/9router/tests && npm run test:all -- translator-request-normalization.test.js`
Expected: FAIL because `open-sse/translator/index.js` still imports RTK helpers.

- [ ] **Step 3: Remove RTK imports and compression/logging from `translateRequest`**

```js
import { FORMATS } from "./formats.js";
import { ensureToolCallIds, fixMissingToolResponses } from "./helpers/toolCallHelper.js";
import { prepareClaudeRequest } from "./helpers/claudeHelper.js";
import { cloakClaudeTools } from "../utils/claudeCloaking.js";
import { filterToOpenAIFormat } from "./helpers/openaiHelper.js";
import { normalizeThinkingConfig } from "../services/provider.js";
import { AntigravityExecutor } from "../executors/antigravity.js";

export function translateRequest(sourceFormat, targetFormat, model, body, stream = true, credentials = null, provider = null, reqLogger = null, stripList = [], connectionId = null) {
  ensureInitialized();
  let result = body;

  stripContentTypes(result, stripList);
  normalizeThinkingConfig(result);
  ensureToolCallIds(result);
  fixMissingToolResponses(result);

  if (sourceFormat !== targetFormat) {
    if (sourceFormat !== FORMATS.OPENAI) {
      const toOpenAI = requestRegistry.get(`${sourceFormat}:${FORMATS.OPENAI}`);
      if (toOpenAI) {
        result = toOpenAI(model, result, stream, credentials);
        reqLogger?.logOpenAIRequest?.(result);
      }
    }

    if (targetFormat !== FORMATS.OPENAI) {
      const fromOpenAI = requestRegistry.get(`${FORMATS.OPENAI}:${targetFormat}`);
      if (fromOpenAI) {
        result = fromOpenAI(model, result, stream, credentials);
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspaces/9router/tests && npm run test:all -- translator-request-normalization.test.js`
Expected: PASS with request normalization still working and no RTK dependency in translator imports.

- [ ] **Step 5: Commit**

```bash
git add open-sse/translator/index.js tests/unit/translator-request-normalization.test.js
git commit -m "refactor: remove RTK from translator path"
```

---

### Task 4: Delete RTK implementation, tests, and changelog reference

**Files:**
- Delete: `open-sse/rtk/index.js`
- Delete: `open-sse/rtk/flag.js`
- Delete: `open-sse/rtk/constants.js`
- Delete: `open-sse/rtk/autodetect.js`
- Delete: `open-sse/rtk/applyFilter.js`
- Delete: `open-sse/rtk/registry.js`
- Delete: `open-sse/rtk/filters/gitDiff.js`
- Delete: `open-sse/rtk/filters/gitStatus.js`
- Delete: `open-sse/rtk/filters/grep.js`
- Delete: `open-sse/rtk/filters/find.js`
- Delete: `open-sse/rtk/filters/dedupLog.js`
- Delete: `open-sse/rtk/filters/ls.js`
- Delete: `open-sse/rtk/filters/tree.js`
- Delete: `open-sse/rtk/filters/smartTruncate.js`
- Delete: `open-sse/rtk/filters/readNumbered.js`
- Delete: `open-sse/rtk/filters/searchList.js`
- Delete: `tests/unit/rtk.test.js`
- Delete: `tests/unit/rtk.e2e.test.js`
- Delete: `tests/unit/rtk.multi-provider.e2e.test.js`
- Modify: `CHANGELOG.md:4`

- [ ] **Step 1: Write the failing changelog cleanup assertion by adding a small repository smoke test to the translator test file**

```js
import fs from "node:fs";
import path from "node:path";

it("repository changelog no longer advertises RTK", () => {
  const changelog = fs.readFileSync(path.resolve(process.cwd(), "../CHANGELOG.md"), "utf8");
  expect(changelog).not.toMatch(/Add RTK/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspaces/9router/tests && npm run test:all -- translator-request-normalization.test.js`
Expected: FAIL because `CHANGELOG.md` still contains the RTK feature entry.

- [ ] **Step 3: Delete the RTK module tree and RTK-specific test files**

```bash
rm -r /workspaces/9router/open-sse/rtk
rm /workspaces/9router/tests/unit/rtk.test.js
rm /workspaces/9router/tests/unit/rtk.e2e.test.js
rm /workspaces/9router/tests/unit/rtk.multi-provider.e2e.test.js
```

- [ ] **Step 4: Remove the RTK changelog line**

```md
- Add cloud sync support for opencode providers and preferences
- Add scheduler-backed global quota status consistency across routing and dashboard surfaces
```

- [ ] **Step 5: Run focused verification after deletion**

Run: `cd /workspaces/9router/tests && npm run test:all -- translator-request-normalization.test.js quota-refresh-api.test.js local-db-quota-scheduler-settings.test.js`
Expected: PASS with no missing-module imports and no RTK changelog reference.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md open-sse/rtk tests/unit/rtk.test.js tests/unit/rtk.e2e.test.js tests/unit/rtk.multi-provider.e2e.test.js tests/unit/translator-request-normalization.test.js
git commit -m "refactor: remove RTK implementation"
```

---

### Task 5: Final verification pass

**Files:**
- Verify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`
- Verify: `src/app/api/settings/route.js`
- Verify: `src/lib/localDb.js`
- Verify: `src/app/layout.js`
- Verify: `open-sse/translator/index.js`
- Verify: `CHANGELOG.md`

- [ ] **Step 1: Run the full targeted unit suite**

Run: `cd /workspaces/9router/tests && npm run test:all -- local-db-quota-scheduler-settings.test.js quota-refresh-api.test.js translator-request-normalization.test.js`
Expected: PASS with RTK-free settings, route, and translator coverage.

- [ ] **Step 2: Run a repository search for leftover RTK references**

Run: `cd /workspaces/9router && rg "rtkEnabled|Token Saver|Rust Token Killer|\[RTK\]|open-sse/rtk" src open-sse tests CHANGELOG.md`
Expected: no matches.

- [ ] **Step 3: Run production build verification**

Run: `cd /workspaces/9router && npm run build`
Expected: PASS with no missing import errors from removed RTK modules.

- [ ] **Step 4: Commit final verification-only adjustments if any were needed**

```bash
git add src app open-sse tests CHANGELOG.md
git commit -m "chore: verify RTK removal"
```
