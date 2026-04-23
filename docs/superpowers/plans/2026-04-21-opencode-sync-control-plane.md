# OpenCode Sync Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class `/dashboard/opencode` control-plane experience in 9router that stores OpenCode sync preferences on the VPS, generates deterministic sync bundles, exposes plugin-facing sync APIs, and manages per-device/shared sync tokens without reusing the legacy local-file writer flow.

**Architecture:** Add a dedicated OpenCode Sync domain with its own persistence helpers, validators, bundle generator, and API routes. Keep CLI Tools as the basic/local helper path, while `/dashboard/opencode` becomes the managed sync surface that talks only to new preferences/preview/token/sync APIs. Preview and sync must share the same generator so the UI always reflects the exact bundle delivered to local plugins.

**Tech Stack:** Next.js App Router, React client components, lowdb local persistence (`src/lib/localDb.js`), Vitest unit tests, existing shared dashboard UI primitives.

---

## File Structure

### Create

- `src/lib/opencodeSync/schema.js`
  - Canonical defaults, normalizers, validators, redaction helpers, and revision helpers for OpenCode Sync preferences.
- `src/lib/opencodeSync/presets.js`
  - Variant/template preset definitions for `openagent`, `slim`, and `custom` (`minimal`, `opinionated`).
- `src/lib/opencodeSync/generator.js`
  - Deterministic bundle builder used by both preview and sync APIs.
- `src/lib/opencodeSync/tokens.js`
  - Token generation, hashing, verification, and token-to-public-record mapping.
- `src/app/api/opencode/preferences/route.js`
  - GET/PATCH current user OpenCode preferences.
- `src/app/api/opencode/bundle/preview/route.js`
  - Server-generated sanitized preview of the resolved bundle.
- `src/app/api/opencode/sync/tokens/route.js`
  - GET/POST sync tokens.
- `src/app/api/opencode/sync/tokens/[id]/route.js`
  - PATCH/DELETE a single sync token.
- `src/app/api/opencode/sync/version/route.js`
  - Lightweight plugin polling endpoint returning revision/hash/schemaVersion.
- `src/app/api/opencode/sync/bundle/route.js`
  - Full plugin-facing bundle endpoint.
- `src/app/(dashboard)/dashboard/opencode/page.js`
  - Server page entry for the new OpenCode dashboard route.
- `src/app/(dashboard)/dashboard/opencode/OpenCodePageClient.js`
  - Main interactive client component for the page.
- `src/app/(dashboard)/dashboard/opencode/components/VariantCard.js`
  - Reusable selectable card for variant/template choices.
- `src/app/(dashboard)/dashboard/opencode/components/TokenManagerCard.js`
  - Sync token/device management section.
- `src/app/(dashboard)/dashboard/opencode/components/ModelSelectionCard.js`
  - Include/exclude mode and model selection UI.
- `src/app/(dashboard)/dashboard/opencode/components/PluginsCard.js`
  - Manual plugin add/remove UI.
- `src/app/(dashboard)/dashboard/opencode/components/McpServersCard.js`
  - MCP server editor UI.
- `src/app/(dashboard)/dashboard/opencode/components/EnvVarsCard.js`
  - Environment variable editor UI with masking.
- `src/app/(dashboard)/dashboard/opencode/components/BundlePreviewCard.js`
  - Preview rendering from `/api/opencode/bundle/preview`.
- `src/app/(dashboard)/dashboard/opencode/components/AdvancedOverridesCard.js`
  - Collapsible advanced overrides UI.
- `tests/unit/opencode-schema.test.js`
  - Schema normalization and validation tests.
- `tests/unit/opencode-localdb.test.js`
  - Persistence helper and migration coverage.
- `tests/unit/opencode-bundle-generator.test.js`
  - Preset + merge precedence + deterministic revision coverage.
- `tests/unit/opencode-preferences-route.test.js`
  - Preferences route tests.
- `tests/unit/opencode-preview-route.test.js`
  - Preview route tests.
- `tests/unit/opencode-tokens.test.js`
  - Token hashing and verification tests.
- `tests/unit/opencode-sync-tokens-route.test.js`
  - Token collection route tests.
- `tests/unit/opencode-sync-token-by-id-route.test.js`
  - Single-token route tests.
- `tests/unit/opencode-sync-version-route.test.js`
  - Version endpoint tests.
- `tests/unit/opencode-sync-bundle-route.test.js`
  - Bundle endpoint tests.

### Modify

- `src/lib/localDb.js`
  - Add persisted OpenCode Sync collections/defaults and CRUD helpers.
- `src/models/index.js`
  - Re-export new lowdb helpers if route handlers follow that model.
- `src/shared/components/Sidebar.js`
  - Add `/dashboard/opencode` navigation item.
- `src/shared/components/Header.js`
  - Add title/description/icon metadata for `/dashboard/opencode`.

### Keep Unchanged By Design

- `src/app/api/cli-tools/opencode-settings/route.js`
  - The new feature must not depend on this legacy local-file writer flow.

### Test Constraints To Respect

- `tests/vitest.config.js` uses `environment: "node"`; there is no jsdom/UI test harness.
- Favor unit tests for schema, persistence, generators, and routes.
- UI tasks should rely on manual verification plus `lsp_diagnostics` until a UI test harness exists.

---

### Task 1: Add canonical OpenCode Sync schema and lowdb persistence

**Files:**
- Create: `src/lib/opencodeSync/schema.js`
- Modify: `src/lib/localDb.js`
- Modify: `src/models/index.js`
- Test: `tests/unit/opencode-schema.test.js`
- Test: `tests/unit/opencode-localdb.test.js`

- [ ] **Step 1: Write the failing schema and persistence tests**

```javascript
import { describe, expect, it } from "vitest";
import {
  createDefaultOpenCodePreferences,
  normalizeOpenCodePreferences,
  validateOpenCodePreferences,
} from "../../src/lib/opencodeSync/schema.js";

describe("normalizeOpenCodePreferences", () => {
  it("fills defaults for a new user", () => {
    const prefs = normalizeOpenCodePreferences(undefined);

    expect(prefs.variant).toBe("openagent");
    expect(prefs.customTemplate).toBeNull();
    expect(prefs.modelSelectionMode).toBe("exclude");
    expect(prefs.includedModels).toEqual([]);
    expect(prefs.excludedModels).toEqual([]);
    expect(prefs.customPlugins).toEqual([]);
    expect(prefs.mcpServers).toEqual([]);
    expect(prefs.envVars).toEqual([]);
  });

  it("drops duplicate plugin and env-var keys deterministically", () => {
    const prefs = normalizeOpenCodePreferences({
      customPlugins: ["foo@latest", "foo@latest", "bar@latest"],
      envVars: [
        { key: "OPENAI_API_KEY", value: "a", secret: true },
        { key: "OPENAI_API_KEY", value: "b", secret: true },
      ],
    });

    expect(prefs.customPlugins).toEqual(["foo@latest", "bar@latest"]);
    expect(prefs.envVars).toEqual([
      { key: "OPENAI_API_KEY", value: "b", secret: true },
    ]);
  });
});

describe("validateOpenCodePreferences", () => {
  it("rejects invalid variant/template combinations", () => {
    expect(() =>
      validateOpenCodePreferences({ variant: "slim", customTemplate: "minimal" })
    ).toThrow(/custom template/i);
  });
});
```

```javascript
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("localDb opencode sync helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates default opencodeSync domain when db shape is empty", async () => {
    const { getDb, getOpenCodePreferences } = await import("../../src/lib/localDb.js");
    const db = await getDb();

    expect(db.data.opencodeSync).toBeDefined();
    expect(await getOpenCodePreferences()).toMatchObject({ variant: "openagent" });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run tests/unit/opencode-schema.test.js tests/unit/opencode-localdb.test.js`

Expected: FAIL with missing module exports such as `Cannot find module '../../src/lib/opencodeSync/schema.js'` and missing `getOpenCodePreferences` helper.

- [ ] **Step 3: Implement the canonical schema module**

```javascript
// src/lib/opencodeSync/schema.js
const DEFAULT_VARIANT = "openagent";
const DEFAULT_MODE = "exclude";

export function createDefaultOpenCodePreferences() {
  return {
    variant: DEFAULT_VARIANT,
    customTemplate: null,
    defaultModel: null,
    modelSelectionMode: DEFAULT_MODE,
    includedModels: [],
    excludedModels: [],
    customPlugins: [],
    mcpServers: [],
    envVars: [],
    advancedOverrides: {
      openAgent: {},
      slim: {},
      custom: {},
    },
    updatedAt: null,
  };
}

export function normalizeOpenCodePreferences(input) {
  const base = createDefaultOpenCodePreferences();
  const next = { ...base, ...(input || {}) };
  next.customPlugins = [...new Set((next.customPlugins || []).filter(Boolean))].sort();
  next.includedModels = [...new Set((next.includedModels || []).filter(Boolean))].sort();
  next.excludedModels = [...new Set((next.excludedModels || []).filter(Boolean))].sort();
  next.envVars = Object.values(
    (next.envVars || []).reduce((acc, item) => {
      if (!item?.key) return acc;
      acc[item.key] = { key: item.key, value: item.value || "", secret: item.secret === true };
      return acc;
    }, {})
  ).sort((a, b) => a.key.localeCompare(b.key));
  return next;
}

export function validateOpenCodePreferences(input) {
  const next = normalizeOpenCodePreferences(input);
  const validVariants = new Set(["openagent", "slim", "custom"]);
  const validTemplates = new Set([null, "minimal", "opinionated"]);
  if (!validVariants.has(next.variant)) throw new Error("Invalid variant");
  if (!validTemplates.has(next.customTemplate)) throw new Error("Invalid custom template");
  if (next.variant !== "custom" && next.customTemplate !== null) {
    throw new Error("Custom template is only valid for custom variant");
  }
  if (!["include", "exclude"].includes(next.modelSelectionMode)) {
    throw new Error("Invalid model selection mode");
  }
  return next;
}

export function sanitizeOpenCodePreferencesForResponse(input) {
  const next = normalizeOpenCodePreferences(input);
  next.envVars = next.envVars.map((item) =>
    item.secret ? { ...item, value: "********" } : item
  );
  return next;
}
```

- [ ] **Step 4: Add lowdb defaults and CRUD helpers**

```javascript
// inside cloneDefaultData() in src/lib/localDb.js
return {
  providerConnections: [],
  providerNodes: [],
  proxyPools: [],
  modelAliases: {},
  mitmAlias: {},
  combos: [],
  apiKeys: [],
  settings: { ...DEFAULT_SETTINGS },
  pricing: {},
  opencodeSync: {
    preferences: createDefaultOpenCodePreferences(),
    tokens: [],
  },
};
```

```javascript
// add to src/lib/localDb.js
export async function getOpenCodePreferences() {
  const db = await getDb();
  db.data.opencodeSync.preferences = normalizeOpenCodePreferences(
    db.data.opencodeSync?.preferences
  );
  return db.data.opencodeSync.preferences;
}

export async function updateOpenCodePreferences(patch) {
  const db = await getDb();
  const current = normalizeOpenCodePreferences(db.data.opencodeSync?.preferences);
  db.data.opencodeSync.preferences = validateOpenCodePreferences({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  await safeWrite(db);
  return db.data.opencodeSync.preferences;
}

export async function listOpenCodeTokens() {
  const db = await getDb();
  return db.data.opencodeSync?.tokens || [];
}

export async function replaceOpenCodeTokens(tokens) {
  const db = await getDb();
  db.data.opencodeSync.tokens = tokens;
  await safeWrite(db);
  return db.data.opencodeSync.tokens;
}
```

- [ ] **Step 5: Re-export model helpers for route handlers**

```javascript
// src/models/index.js
export {
  getOpenCodePreferences,
  updateOpenCodePreferences,
  listOpenCodeTokens,
  replaceOpenCodeTokens,
} from "@/lib/localDb.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/opencode-schema.test.js tests/unit/opencode-localdb.test.js`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/opencodeSync/schema.js src/lib/localDb.js src/models/index.js tests/unit/opencode-schema.test.js tests/unit/opencode-localdb.test.js
git commit -m "feat: add opencode sync persistence schema"
```

### Task 2: Build presets and deterministic bundle generator

**Files:**
- Create: `src/lib/opencodeSync/presets.js`
- Create: `src/lib/opencodeSync/generator.js`
- Test: `tests/unit/opencode-bundle-generator.test.js`

- [ ] **Step 1: Write the failing bundle-generator tests**

```javascript
import { describe, expect, it } from "vitest";
import { buildOpenCodeSyncBundle } from "../../src/lib/opencodeSync/generator.js";

const catalog = [
  { id: "gpt-5.4", provider: "cliproxyapi", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", provider: "cliproxyapi", label: "GPT-5.4 Mini" },
];

describe("buildOpenCodeSyncBundle", () => {
  it("always injects sync plugin and openagent preset plugin", () => {
    const bundle = buildOpenCodeSyncBundle({
      preferences: { variant: "openagent", modelSelectionMode: "exclude", excludedModels: [] },
      modelCatalog: catalog,
    });

    expect(bundle.opencode.plugin).toContain("opencode-cliproxyapi-sync@latest");
    expect(bundle.opencode.plugin).toContain("oh-my-openagent@latest");
    expect(bundle.ohMyOpenAgent).toBeTruthy();
    expect(bundle.ohMyOpenCodeSlim).toBeNull();
  });

  it("supports custom include mode without preset plugins", () => {
    const bundle = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "minimal",
        modelSelectionMode: "include",
        includedModels: ["gpt-5.4-mini"],
        customPlugins: ["my-extra-plugin@latest"],
      },
      modelCatalog: catalog,
    });

    expect(bundle.opencode.plugin).toEqual([
      "my-extra-plugin@latest",
      "opencode-cliproxyapi-sync@latest",
    ]);
    expect(Object.keys(bundle.opencode.provider.cliproxyapi.models)).toEqual(["gpt-5.4-mini"]);
  });

  it("produces a stable revision for the same effective input", () => {
    const first = buildOpenCodeSyncBundle({ preferences: { variant: "slim" }, modelCatalog: catalog });
    const second = buildOpenCodeSyncBundle({ preferences: { variant: "slim" }, modelCatalog: catalog });

    expect(first.revision).toBe(second.revision);
    expect(first.hash).toBe(second.hash);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/opencode-bundle-generator.test.js`

Expected: FAIL with missing `buildOpenCodeSyncBundle` export.

- [ ] **Step 3: Add presets for variants and custom templates**

```javascript
// src/lib/opencodeSync/presets.js
export const OPENCODE_SYNC_PLUGIN = "opencode-cliproxyapi-sync@latest";
export const OPENAGENT_PLUGIN = "oh-my-openagent@latest";
export const SLIM_PLUGIN = "oh-my-opencode-slim@latest";

export function getVariantPreset(variant) {
  if (variant === "openagent") {
    return {
      plugins: [OPENCODE_SYNC_PLUGIN, OPENAGENT_PLUGIN],
      openAgentConfig: { preset: "default" },
      slimConfig: null,
    };
  }
  if (variant === "slim") {
    return {
      plugins: [OPENCODE_SYNC_PLUGIN, SLIM_PLUGIN],
      openAgentConfig: null,
      slimConfig: { preset: "default" },
    };
  }
  return {
    plugins: [OPENCODE_SYNC_PLUGIN],
    openAgentConfig: null,
    slimConfig: null,
  };
}

export function getCustomTemplatePreset(template) {
  if (template === "opinionated") {
    return { plugins: [OPENCODE_SYNC_PLUGIN], mcp: [], envVars: [] };
  }
  return { plugins: [OPENCODE_SYNC_PLUGIN], mcp: [], envVars: [] };
}
```

- [ ] **Step 4: Implement deterministic bundle generation**

```javascript
// src/lib/opencodeSync/generator.js
import crypto from "node:crypto";
import {
  normalizeOpenCodePreferences,
  sanitizeOpenCodePreferencesForResponse,
} from "./schema.js";
import { getVariantPreset, getCustomTemplatePreset } from "./presets.js";

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value).sort(), 2);
}

function selectModels(preferences, modelCatalog) {
  const allowed = modelCatalog.filter((item) => item.provider === "cliproxyapi");
  if (preferences.modelSelectionMode === "include") {
    return allowed.filter((item) => preferences.includedModels.includes(item.id));
  }
  return allowed.filter((item) => !preferences.excludedModels.includes(item.id));
}

export function buildOpenCodeSyncBundle({ preferences, modelCatalog }) {
  const normalized = normalizeOpenCodePreferences(preferences);
  const variantPreset = getVariantPreset(normalized.variant);
  const templatePreset =
    normalized.variant === "custom"
      ? getCustomTemplatePreset(normalized.customTemplate)
      : { plugins: [], mcp: [], envVars: [] };

  const models = selectModels(normalized, modelCatalog).sort((a, b) => a.id.localeCompare(b.id));
  const plugins = [...new Set([
    ...templatePreset.plugins,
    ...variantPreset.plugins,
    ...(normalized.customPlugins || []),
  ])].sort();

  const providerModels = Object.fromEntries(
    models.map((model) => [model.id, { name: model.label || model.id }])
  );

  const payload = {
    selectedVariant: normalized.variant,
    selectedTemplate: normalized.customTemplate,
    opencode: {
      plugin: plugins,
      provider: {
        cliproxyapi: {
          npm: "@ai-sdk/openai-compatible",
          name: "CLIProxyAPI",
          models: providerModels,
        },
      },
      model: normalized.defaultModel || (models[0] ? `cliproxyapi/${models[0].id}` : null),
      mcp: normalized.mcpServers,
      env: normalized.envVars,
    },
    ohMyOpenAgent: variantPreset.openAgentConfig,
    ohMyOpenCodeSlim: variantPreset.slimConfig,
  };

  const serialized = stableJson(payload);
  const hash = crypto.createHash("sha256").update(serialized).digest("hex");

  return {
    ...payload,
    revision: hash.slice(0, 12),
    hash,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

export function buildOpenCodeSyncPreview(args) {
  const bundle = buildOpenCodeSyncBundle(args);
  return {
    ...bundle,
    preferences: sanitizeOpenCodePreferencesForResponse(args.preferences),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/opencode-bundle-generator.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/opencodeSync/presets.js src/lib/opencodeSync/generator.js tests/unit/opencode-bundle-generator.test.js
git commit -m "feat: add opencode sync bundle generator"
```

### Task 3: Add preferences and preview APIs

**Files:**
- Create: `src/app/api/opencode/preferences/route.js`
- Create: `src/app/api/opencode/bundle/preview/route.js`
- Test: `tests/unit/opencode-preferences-route.test.js`
- Test: `tests/unit/opencode-preview-route.test.js`

- [ ] **Step 1: Write the failing route tests**

```javascript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  },
}));

vi.mock("../../src/models/index.js", () => ({
  getOpenCodePreferences: vi.fn(),
  updateOpenCodePreferences: vi.fn(),
}));

describe("/api/opencode/preferences", () => {
  beforeEach(() => vi.resetModules());

  it("returns sanitized preferences on GET", async () => {
    const { getOpenCodePreferences } = await import("../../src/models/index.js");
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      envVars: [{ key: "OPENAI_API_KEY", value: "secret", secret: true }],
    });

    const { GET } = await import("../../src/app/api/opencode/preferences/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.envVars[0].value).toBe("********");
  });
});
```

```javascript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn((body, init) => ({ status: init?.status || 200, body })) },
}));

vi.mock("../../src/models/index.js", () => ({
  getOpenCodePreferences: vi.fn(async () => ({ variant: "slim", modelSelectionMode: "exclude", excludedModels: [] })),
}));

vi.mock("../../src/shared/constants/models.js", () => ({
  getModelsByProviderId: vi.fn(() => [
    { id: "gpt-5.4", provider: "cliproxyapi", label: "GPT-5.4" },
  ]),
}));

describe("/api/opencode/bundle/preview", () => {
  beforeEach(() => vi.resetModules());

  it("returns a generated server-side preview", async () => {
    const { GET } = await import("../../src/app/api/opencode/bundle/preview/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.opencode.plugin).toContain("opencode-cliproxyapi-sync@latest");
    expect(response.body.selectedVariant).toBe("slim");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run tests/unit/opencode-preferences-route.test.js tests/unit/opencode-preview-route.test.js`

Expected: FAIL with missing route modules.

- [ ] **Step 3: Implement preferences route**

```javascript
// src/app/api/opencode/preferences/route.js
import { NextResponse } from "next/server";
import { getOpenCodePreferences, updateOpenCodePreferences } from "@/models/index.js";
import {
  sanitizeOpenCodePreferencesForResponse,
  validateOpenCodePreferences,
} from "@/lib/opencodeSync/schema.js";

export async function GET() {
  const preferences = await getOpenCodePreferences();
  return NextResponse.json(sanitizeOpenCodePreferencesForResponse(preferences));
}

export async function PATCH(request) {
  try {
    const patch = await request.json();
    validateOpenCodePreferences(patch);
    const saved = await updateOpenCodePreferences(patch);
    return NextResponse.json(sanitizeOpenCodePreferencesForResponse(saved));
  } catch (error) {
    return NextResponse.json({ error: error.message || "Invalid OpenCode preferences" }, { status: 400 });
  }
}
```

- [ ] **Step 4: Implement preview route using the shared generator**

```javascript
// src/app/api/opencode/bundle/preview/route.js
import { NextResponse } from "next/server";
import { getOpenCodePreferences } from "@/models/index.js";
import { getModelsByProviderId } from "@/shared/constants/models.js";
import { buildOpenCodeSyncPreview } from "@/lib/opencodeSync/generator.js";

export async function GET() {
  const preferences = await getOpenCodePreferences();
  const modelCatalog = getModelsByProviderId("cliproxyapi") || [];
  const preview = buildOpenCodeSyncPreview({ preferences, modelCatalog });
  return NextResponse.json(preview);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/opencode-preferences-route.test.js tests/unit/opencode-preview-route.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/opencode/preferences/route.js src/app/api/opencode/bundle/preview/route.js tests/unit/opencode-preferences-route.test.js tests/unit/opencode-preview-route.test.js
git commit -m "feat: add opencode preferences and preview APIs"
```

### Task 4: Add sync token generation, hashing, and CRUD APIs

**Files:**
- Create: `src/lib/opencodeSync/tokens.js`
- Create: `src/app/api/opencode/sync/tokens/route.js`
- Create: `src/app/api/opencode/sync/tokens/[id]/route.js`
- Test: `tests/unit/opencode-tokens.test.js`
- Test: `tests/unit/opencode-sync-tokens-route.test.js`
- Test: `tests/unit/opencode-sync-token-by-id-route.test.js`

- [ ] **Step 1: Write the failing token tests**

```javascript
import { describe, expect, it } from "vitest";
import { createSyncToken, verifySyncToken } from "../../src/lib/opencodeSync/tokens.js";

describe("opencode sync tokens", () => {
  it("returns a raw token once and stores only a hash", () => {
    const created = createSyncToken({ name: "Laptop", mode: "device" });

    expect(created.token).toMatch(/^ocsync_/);
    expect(created.record.tokenHash).not.toBe(created.token);
    expect(created.record.mode).toBe("device");
  });

  it("verifies the bearer token against the stored hash", () => {
    const created = createSyncToken({ name: "Laptop", mode: "device" });
    expect(verifySyncToken(created.token, created.record)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run tests/unit/opencode-tokens.test.js tests/unit/opencode-sync-tokens-route.test.js tests/unit/opencode-sync-token-by-id-route.test.js`

Expected: FAIL with missing token helpers and route modules.

- [ ] **Step 3: Implement token helper module**

```javascript
// src/lib/opencodeSync/tokens.js
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createSyncToken({ name, mode }) {
  const token = `ocsync_${crypto.randomBytes(24).toString("hex")}`;
  const now = new Date().toISOString();
  return {
    token,
    record: {
      id: uuidv4(),
      name,
      mode,
      tokenHash: sha256(token),
      createdAt: now,
      lastUsedAt: null,
      deviceMetadata: null,
    },
  };
}

export function verifySyncToken(token, record) {
  if (!token || !record?.tokenHash) return false;
  return sha256(token) === record.tokenHash;
}

export function toPublicTokenRecord(record) {
  return {
    id: record.id,
    name: record.name,
    mode: record.mode,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    deviceMetadata: record.deviceMetadata || null,
  };
}
```

- [ ] **Step 4: Implement token CRUD routes**

```javascript
// src/app/api/opencode/sync/tokens/route.js
import { NextResponse } from "next/server";
import { listOpenCodeTokens, replaceOpenCodeTokens } from "@/models/index.js";
import { createSyncToken, toPublicTokenRecord } from "@/lib/opencodeSync/tokens.js";

export async function GET() {
  const tokens = await listOpenCodeTokens();
  return NextResponse.json({ tokens: tokens.map(toPublicTokenRecord) });
}

export async function POST(request) {
  const body = await request.json();
  const { token, record } = createSyncToken({
    name: body.name || "Default",
    mode: body.mode === "shared" ? "shared" : "device",
  });
  const tokens = await listOpenCodeTokens();
  await replaceOpenCodeTokens([...tokens, record]);
  return NextResponse.json({ token, ...toPublicTokenRecord(record) }, { status: 201 });
}
```

```javascript
// src/app/api/opencode/sync/tokens/[id]/route.js
import { NextResponse } from "next/server";
import { listOpenCodeTokens, replaceOpenCodeTokens } from "@/models/index.js";
import { toPublicTokenRecord } from "@/lib/opencodeSync/tokens.js";

export async function PATCH(request, { params }) {
  const body = await request.json();
  const tokens = await listOpenCodeTokens();
  const next = tokens.map((item) =>
    item.id === params.id
      ? { ...item, name: body.name || item.name, deviceMetadata: body.deviceMetadata || item.deviceMetadata }
      : item
  );
  await replaceOpenCodeTokens(next);
  return NextResponse.json({ token: toPublicTokenRecord(next.find((item) => item.id === params.id)) });
}

export async function DELETE(_request, { params }) {
  const tokens = await listOpenCodeTokens();
  const next = tokens.filter((item) => item.id !== params.id);
  await replaceOpenCodeTokens(next);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/opencode-tokens.test.js tests/unit/opencode-sync-tokens-route.test.js tests/unit/opencode-sync-token-by-id-route.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/opencodeSync/tokens.js src/app/api/opencode/sync/tokens/route.js src/app/api/opencode/sync/tokens/[id]/route.js tests/unit/opencode-tokens.test.js tests/unit/opencode-sync-tokens-route.test.js tests/unit/opencode-sync-token-by-id-route.test.js
git commit -m "feat: add opencode sync token management"
```

### Task 5: Add authenticated sync version and bundle endpoints

**Files:**
- Create: `src/app/api/opencode/sync/version/route.js`
- Create: `src/app/api/opencode/sync/bundle/route.js`
- Modify: `src/lib/opencodeSync/tokens.js`
- Test: `tests/unit/opencode-sync-version-route.test.js`
- Test: `tests/unit/opencode-sync-bundle-route.test.js`

- [ ] **Step 1: Write the failing sync-endpoint tests**

```javascript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn((body, init) => ({ status: init?.status || 200, body })) },
}));

vi.mock("../../src/models/index.js", () => ({
  listOpenCodeTokens: vi.fn(async () => [{ id: "1", tokenHash: "abc", mode: "device" }]),
  getOpenCodePreferences: vi.fn(async () => ({ variant: "openagent", modelSelectionMode: "exclude", excludedModels: [] })),
}));

describe("/api/opencode/sync/version", () => {
  beforeEach(() => vi.resetModules());

  it("rejects missing bearer token", async () => {
    const { GET } = await import("../../src/app/api/opencode/sync/version/route.js");
    const response = await GET(new Request("http://localhost/api/opencode/sync/version"));
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run tests/unit/opencode-sync-version-route.test.js tests/unit/opencode-sync-bundle-route.test.js`

Expected: FAIL with missing route modules.

- [ ] **Step 3: Add bearer-token lookup helpers**

```javascript
// extend src/lib/opencodeSync/tokens.js
export function readBearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  const [, token] = auth.match(/^Bearer\s+(.+)$/i) || [];
  return token || null;
}

export function findMatchingTokenRecord(rawToken, records) {
  return (records || []).find((record) => verifySyncToken(rawToken, record)) || null;
}
```

- [ ] **Step 4: Implement sync version and bundle routes**

```javascript
// src/app/api/opencode/sync/version/route.js
import { NextResponse } from "next/server";
import { listOpenCodeTokens, getOpenCodePreferences } from "@/models/index.js";
import { getModelsByProviderId } from "@/shared/constants/models.js";
import { buildOpenCodeSyncBundle } from "@/lib/opencodeSync/generator.js";
import { findMatchingTokenRecord, readBearerToken } from "@/lib/opencodeSync/tokens.js";

export async function GET(request) {
  const rawToken = readBearerToken(request);
  if (!rawToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tokenRecord = findMatchingTokenRecord(rawToken, await listOpenCodeTokens());
  if (!tokenRecord) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bundle = buildOpenCodeSyncBundle({
    preferences: await getOpenCodePreferences(),
    modelCatalog: getModelsByProviderId("cliproxyapi") || [],
  });

  return NextResponse.json({
    revision: bundle.revision,
    hash: bundle.hash,
    generatedAt: bundle.generatedAt,
    schemaVersion: bundle.schemaVersion,
  });
}
```

```javascript
// src/app/api/opencode/sync/bundle/route.js
import { NextResponse } from "next/server";
import { listOpenCodeTokens, getOpenCodePreferences } from "@/models/index.js";
import { getModelsByProviderId } from "@/shared/constants/models.js";
import { buildOpenCodeSyncBundle } from "@/lib/opencodeSync/generator.js";
import { findMatchingTokenRecord, readBearerToken } from "@/lib/opencodeSync/tokens.js";

export async function GET(request) {
  const rawToken = readBearerToken(request);
  if (!rawToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tokenRecord = findMatchingTokenRecord(rawToken, await listOpenCodeTokens());
  if (!tokenRecord) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bundle = buildOpenCodeSyncBundle({
    preferences: await getOpenCodePreferences(),
    modelCatalog: getModelsByProviderId("cliproxyapi") || [],
  });

  return NextResponse.json(bundle);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/opencode-sync-version-route.test.js tests/unit/opencode-sync-bundle-route.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/opencodeSync/tokens.js src/app/api/opencode/sync/version/route.js src/app/api/opencode/sync/bundle/route.js tests/unit/opencode-sync-version-route.test.js tests/unit/opencode-sync-bundle-route.test.js
git commit -m "feat: add opencode sync delivery APIs"
```

### Task 6: Add the first-class dashboard route and shared page shell

**Files:**
- Modify: `src/shared/components/Sidebar.js`
- Modify: `src/shared/components/Header.js`
- Create: `src/app/(dashboard)/dashboard/opencode/page.js`
- Create: `src/app/(dashboard)/dashboard/opencode/OpenCodePageClient.js`

- [ ] **Step 1: Add the OpenCode route to dashboard navigation**

```javascript
// in src/shared/components/Sidebar.js
const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/mitm", label: "MITM", icon: "security" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
  { href: "/dashboard/opencode", label: "OpenCode", icon: "auto_awesome" },
];
```

- [ ] **Step 2: Add header metadata for the new page**

```javascript
// in src/shared/components/Header.js
if (pathname.includes("/opencode"))
  return {
    title: "OpenCode",
    description: "Control plane for OpenCode sync, presets, tokens, and bundle preview",
    icon: "auto_awesome",
    breadcrumbs: [],
  };
```

- [ ] **Step 3: Create the server page entry and initial client shell**

```javascript
// src/app/(dashboard)/dashboard/opencode/page.js
import OpenCodePageClient from "./OpenCodePageClient";

export default function OpenCodePage() {
  return <OpenCodePageClient />;
}
```

```javascript
// src/app/(dashboard)/dashboard/opencode/OpenCodePageClient.js
"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";

export default function OpenCodePageClient() {
  const [preferences, setPreferences] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/opencode/preferences").then((res) => res.json()),
      fetch("/api/opencode/bundle/preview").then((res) => res.json()),
    ]).then(([prefs, nextPreview]) => {
      setPreferences(prefs);
      setPreview(nextPreview);
    });
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Card title="OpenCode Dashboard" subtitle="9router runs on your VPS as the control plane while the local sync plugin applies generated config.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-black/5 p-4">Server ready</div>
          <div className="rounded-xl border border-black/5 p-4">Device linked</div>
          <div className="rounded-xl border border-black/5 p-4">Config synced</div>
        </div>
      </Card>

      <Card title="OpenCode sync foundation">
        <pre className="text-xs overflow-x-auto">{JSON.stringify({ preferences, preview }, null, 2)}</pre>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run diagnostics and a focused test pass**

Run: `pnpm vitest run tests/unit/opencode-schema.test.js tests/unit/opencode-bundle-generator.test.js tests/unit/opencode-preferences-route.test.js`

Expected: PASS

- [ ] **Step 5: Manually verify the route in the browser**

Run: `pnpm dev`

Expected:
- `/dashboard/opencode` loads inside the dashboard shell
- the sidebar shows `OpenCode`
- the header shows the new title and description
- the page fetches preferences and preview without console errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/components/Sidebar.js src/shared/components/Header.js src/app/(dashboard)/dashboard/opencode/page.js src/app/(dashboard)/dashboard/opencode/OpenCodePageClient.js
git commit -m "feat: add opencode dashboard route"
```

### Task 7: Build the guided builder sections and connect them to the new APIs

**Files:**
- Create: `src/app/(dashboard)/dashboard/opencode/components/VariantCard.js`
- Create: `src/app/(dashboard)/dashboard/opencode/components/TokenManagerCard.js`
- Create: `src/app/(dashboard)/dashboard/opencode/components/ModelSelectionCard.js`
- Create: `src/app/(dashboard)/dashboard/opencode/components/PluginsCard.js`
- Create: `src/app/(dashboard)/dashboard/opencode/components/McpServersCard.js`
- Create: `src/app/(dashboard)/dashboard/opencode/components/EnvVarsCard.js`
- Create: `src/app/(dashboard)/dashboard/opencode/components/BundlePreviewCard.js`
- Create: `src/app/(dashboard)/dashboard/opencode/components/AdvancedOverridesCard.js`
- Modify: `src/app/(dashboard)/dashboard/opencode/OpenCodePageClient.js`

- [ ] **Step 1: Add reusable variant/template card component**

```javascript
// src/app/(dashboard)/dashboard/opencode/components/VariantCard.js
"use client";

import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

export default function VariantCard({ title, description, selected, onClick, badges = [] }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-4 text-left transition-all",
        selected ? "border-primary bg-primary/5" : "border-black/5 hover:border-primary/40"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-text-main">{title}</div>
          <div className="text-sm text-text-muted mt-1">{description}</div>
        </div>
        {badges.length > 0 ? <div className="text-xs text-text-muted">{badges.join(" • ")}</div> : null}
      </div>
    </button>
  );
}

VariantCard.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  selected: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  badges: PropTypes.arrayOf(PropTypes.string),
};
```

- [ ] **Step 2: Add token manager and bundle preview sections**

```javascript
// src/app/(dashboard)/dashboard/opencode/components/TokenManagerCard.js
"use client";

import { useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

export default function TokenManagerCard({ tokens, onCreate }) {
  const [creating, setCreating] = useState(false);
  return (
    <Card title="Connection & Sync Identity" subtitle="Manage per-device and shared sync tokens.">
      <div className="space-y-3">
        {(tokens || []).map((token) => (
          <div key={token.id} className="rounded-xl border border-black/5 p-3 text-sm">
            <div className="font-medium">{token.name}</div>
            <div className="text-text-muted">{token.mode} token</div>
          </div>
        ))}
        <Button
          onClick={async () => {
            setCreating(true);
            await onCreate();
            setCreating(false);
          }}
          disabled={creating}
        >
          {creating ? "Generating..." : "Generate Token"}
        </Button>
      </div>
    </Card>
  );
}
```

```javascript
// src/app/(dashboard)/dashboard/opencode/components/BundlePreviewCard.js
"use client";

import Card from "@/shared/components/Card";

export default function BundlePreviewCard({ preview }) {
  return (
    <Card title="Generated Server Bundle" subtitle="Preview exactly what the sync plugin will receive.">
      <pre className="text-xs overflow-x-auto max-h-[32rem] whitespace-pre-wrap">
        {JSON.stringify(preview, null, 2)}
      </pre>
    </Card>
  );
}
```

- [ ] **Step 3: Expand the page client to save preferences and refresh preview**

```javascript
// inside OpenCodePageClient.js
const savePreferences = async (patch) => {
  const response = await fetch("/api/opencode/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const next = await response.json();
  setPreferences(next);
  const nextPreview = await fetch("/api/opencode/bundle/preview").then((res) => res.json());
  setPreview(nextPreview);
};

const loadTokens = async () => {
  const data = await fetch("/api/opencode/sync/tokens").then((res) => res.json());
  setTokens(data.tokens || []);
};
```

```javascript
// inside OpenCodePageClient.js render
<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
  <div className="space-y-6">
    <Card title="Choose a variant" subtitle="Select a sync preset for OpenCode.">
      <div className="grid gap-3 md:grid-cols-3">
        <VariantCard
          title="Oh My Open Agent"
          description="Full preset with batteries included."
          selected={preferences?.variant === "openagent"}
          onClick={() => savePreferences({ variant: "openagent", customTemplate: null })}
          badges={["Recommended"]}
        />
        <VariantCard
          title="Oh My OpenCode Slim"
          description="Smaller orchestration surface with fewer defaults."
          selected={preferences?.variant === "slim"}
          onClick={() => savePreferences({ variant: "slim", customTemplate: null })}
        />
        <VariantCard
          title="Custom / No preset"
          description="Use minimal or opinionated template and customize manually."
          selected={preferences?.variant === "custom"}
          onClick={() => savePreferences({ variant: "custom", customTemplate: "minimal" })}
        />
      </div>
    </Card>

    <TokenManagerCard tokens={tokens} onCreate={async () => {
      await fetch("/api/opencode/sync/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "My Device", mode: "device" }),
      });
      await loadTokens();
    }} />
  </div>

  <div className="space-y-6">
    <BundlePreviewCard preview={preview} />
  </div>
</div>
```

- [ ] **Step 4: Add the remaining builder cards incrementally**

```javascript
// Each component should follow the same pattern:
// - receive current values and onChange handler from OpenCodePageClient
// - render one focused card section only
// - save through PATCH /api/opencode/preferences
// Example for model mode:

export default function ModelSelectionCard({ preferences, onChange }) {
  return (
    <Card title="Model selection" subtitle="Choose whether to include only selected models or exclude specific models from the catalog.">
      <div className="grid gap-3 md:grid-cols-2">
        <button type="button" onClick={() => onChange({ modelSelectionMode: "include" })}>Include only</button>
        <button type="button" onClick={() => onChange({ modelSelectionMode: "exclude" })}>Exclude from all</button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 5: Run diagnostics and manual UI verification**

Run: `pnpm dev`

Expected:
- variant changes save and refresh preview
- token list loads and creation works
- preview updates from server, not local-only derived state
- page remains responsive and readable on mobile widths

- [ ] **Step 6: Run language-server diagnostics for the page files**

Run: `lsp_diagnostics` for:
- `src/app/(dashboard)/dashboard/opencode/OpenCodePageClient.js`
- `src/app/(dashboard)/dashboard/opencode/components/VariantCard.js`
- `src/app/(dashboard)/dashboard/opencode/components/TokenManagerCard.js`
- `src/app/(dashboard)/dashboard/opencode/components/BundlePreviewCard.js`

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/dashboard/opencode
git commit -m "feat: add opencode sync dashboard builder"
```

### Task 8: Harden validation, preview redaction, and sync-route bookkeeping

**Files:**
- Modify: `src/lib/opencodeSync/schema.js`
- Modify: `src/lib/opencodeSync/generator.js`
- Modify: `src/lib/opencodeSync/tokens.js`
- Modify: `src/app/api/opencode/preferences/route.js`
- Modify: `src/app/api/opencode/bundle/preview/route.js`
- Modify: `src/app/api/opencode/sync/version/route.js`
- Modify: `src/app/api/opencode/sync/bundle/route.js`
- Test: `tests/unit/opencode-schema.test.js`
- Test: `tests/unit/opencode-preview-route.test.js`
- Test: `tests/unit/opencode-sync-version-route.test.js`
- Test: `tests/unit/opencode-sync-bundle-route.test.js`

- [ ] **Step 1: Extend tests for redaction, duplicate validation, and last-used bookkeeping**

```javascript
it("redacts secret env vars in preview responses", async () => {
  const response = await GET();
  expect(response.body.preferences.envVars.every((item) => item.secret ? item.value === "********" : true)).toBe(true);
});

it("updates lastUsedAt when a valid sync token fetches a bundle", async () => {
  const response = await GET(new Request("http://localhost/api/opencode/sync/bundle", {
    headers: { authorization: `Bearer ${rawToken}` },
  }));
  expect(response.status).toBe(200);
  expect(replaceOpenCodeTokens).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run tests/unit/opencode-schema.test.js tests/unit/opencode-preview-route.test.js tests/unit/opencode-sync-version-route.test.js tests/unit/opencode-sync-bundle-route.test.js`

Expected: FAIL because preview and sync routes do not yet update/validate all expected behavior.

- [ ] **Step 3: Add stricter validation and preview redaction**

```javascript
// inside validateOpenCodePreferences in schema.js
const pluginSet = new Set();
for (const plugin of next.customPlugins) {
  if (pluginSet.has(plugin)) throw new Error(`Duplicate plugin: ${plugin}`);
  pluginSet.add(plugin);
}

for (const server of next.mcpServers) {
  if (!server?.name) throw new Error("MCP server name is required");
  if (server.type === "local" && (!Array.isArray(server.command) || server.command.length === 0)) {
    throw new Error(`MCP server ${server.name} requires a command array`);
  }
  if (server.type === "remote" && !server.url) {
    throw new Error(`MCP server ${server.name} requires a url`);
  }
}
```

- [ ] **Step 4: Update token bookkeeping on successful sync requests**

```javascript
// helper inside sync routes
async function markTokenUsed(record, records) {
  const next = records.map((item) =>
    item.id === record.id ? { ...item, lastUsedAt: new Date().toISOString() } : item
  );
  await replaceOpenCodeTokens(next);
  return next.find((item) => item.id === record.id);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/opencode-schema.test.js tests/unit/opencode-preview-route.test.js tests/unit/opencode-sync-version-route.test.js tests/unit/opencode-sync-bundle-route.test.js`

Expected: PASS

- [ ] **Step 6: Run the full focused suite**

Run: `pnpm vitest run tests/unit/opencode-*.test.js`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/opencodeSync/schema.js src/lib/opencodeSync/generator.js src/lib/opencodeSync/tokens.js src/app/api/opencode/preferences/route.js src/app/api/opencode/bundle/preview/route.js src/app/api/opencode/sync/version/route.js src/app/api/opencode/sync/bundle/route.js tests/unit/opencode-*.test.js
git commit -m "fix: harden opencode sync validation and preview"
```

## Final Verification Checklist

- [ ] Run all OpenCode-focused unit tests:

```bash
pnpm vitest run tests/unit/opencode-*.test.js
```

- [ ] Run a broader regression spot check for existing OpenCode helper tests:

```bash
pnpm vitest run tests/unit/opencode-settings-route.test.js tests/unit/provider-validation.test.js
```

- [ ] Run language-server diagnostics for the new page/API/lib files.

- [ ] Start the app and manually verify:
  - `/dashboard/opencode` appears in sidebar and header metadata works
  - changing variant/template updates preview
  - creating a device/shared token returns the raw token once
  - preview shows sanitized values
  - sync version/bundle endpoints reject missing auth and accept valid bearer auth

## Notes for the Implementer

- Do not route new `/dashboard/opencode` behavior through `src/app/api/cli-tools/opencode-settings/route.js`.
- Keep preview and bundle sync on the same generator path at all times.
- Treat the sync plugin as the owner of local file-apply behavior; 9router only generates desired state and serves it securely.
- Preserve the CLI Tools OpenCode helper as a separate basic/local setup path.
