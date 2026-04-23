# Phase 1 Implementation Plan — Model Resolution & Provider Registry

> **Agentic worker instruction:** Execute this plan one task at a time. For each task: write the failing test first, run only the named test command until it fails for the expected reason, implement the smallest production change to make it pass, rerun the same test command, then commit immediately before moving to the next task.

## Objective

Port the Phase 1 model-resolution and provider-registry behavior from:

- `src/sse/services/model.js`
- `open-sse/services/provider.js`

into the Go proxy so routing decisions, provider URL building, and upstream header construction can move out of `internal/http/routes.go` hardcoded logic and reach parity with the JavaScript implementation.

This phase must produce production-ready Go packages for model parsing/resolution, db-backed alias/combo/provider-node lookup, provider registry/config lookup, node-aware URL building, and header construction, plus parity-focused tests that lock behavior before Phase 2 integrates them into request forwarding.

## Scope

### In scope

- `go-proxy/internal/model/parser.go`
- `go-proxy/internal/model/resolver.go`
- `go-proxy/internal/model/db.go`
- `go-proxy/internal/provider/registry.go`
- `go-proxy/internal/provider/nodes.go`
- `go-proxy/internal/provider/urls.go`
- `go-proxy/internal/provider/headers.go`
- New `_test.go` files and `internal/testdata` fixtures required for parity coverage

### Out of scope

- Wiring the new packages into `go-proxy/internal/http/routes.go`
- End-to-end forwarding changes
- Token refresh flows
- Non-Phase-1 providers whose behavior is unrelated to model resolution, provider config lookup, URL building, or header building

## Source behavior to preserve

### Model behavior from JavaScript

- `parseModel(modelStr)`
  - empty input returns null-ish fields
  - `provider/model` and `alias/model` split on first slash only
  - provider aliases resolve through the alias table
  - slashless input is treated as a model alias candidate
- `resolveModelAliasFromMap(alias, aliases)`
  - accepts string mapping (`"alias": "provider/model"`)
  - accepts object mapping (`"alias": { provider, model }`)
- `getModelInfoCore(modelStr, aliasesOrGetter)`
  - direct `provider/model` returns immediately
  - alias lookup happens before inference
  - fallback inference rules:
    - `claude-*` -> `anthropic`
    - `gemini-*` -> `gemini`
    - `gpt-*`, `o1*`, `o3*`, `o4*` -> `openai`
    - `deepseek-*` -> `openrouter`
    - default -> `openai`
- local-db-aware behavior from `src/sse/services/model.js`
  - slash form can remap custom provider-node prefixes to node IDs
  - combo names must win over alias resolution for slashless values
  - combo lookup returns `provider=nil` signal for Phase 2 callers

### Provider behavior from JavaScript

- registry lookup from `open-sse/config/providers.js`
- `openai-compatible-*` support
  - detects responses vs chat variant from provider name
  - uses custom base URL when provided by node/provider-specific data
- `anthropic-compatible-*` support
  - uses Anthropic defaults unless node overrides base URL
- URL builders for:
  - OpenAI chat/responses
  - Anthropic messages
  - Gemini streaming vs non-streaming
  - Gemini CLI
  - Antigravity fallback base URLs
  - Qwen resource URL normalization
  - Claude-compatible providers with `?beta=true`
- header builders for:
  - OpenAI-compatible Bearer auth
  - Anthropic-compatible `x-api-key` preference and default `anthropic-version`
  - Gemini `x-goog-api-key`
  - Antigravity / Gemini CLI OAuth bearer
  - Claude API key vs OAuth bearer
  - GitHub Copilot special headers including generated request ID
  - Cline passthrough helper equivalent
  - providers with no auth mutation (`vertex`, `vertex-partner`)

## File structure mapping

### New Go model package

- `go-proxy/internal/model/parser.go`
  - `ProviderAliasMap()` or package-level immutable alias map
  - `ResolveProviderAlias(aliasOrID string) string`
  - `Parse(modelStr string) ParsedModel`
- `go-proxy/internal/model/resolver.go`
  - `Resolution`
  - `Resolver`
  - `ResolveAliasFromMap(alias string, aliases map[string]AliasTarget) (Resolution, bool)`
  - `InferProviderFromModelName(model string) string`
  - `ResolveModel(modelStr string, store AliasComboStore) (Resolution, error)`
- `go-proxy/internal/model/db.go`
  - db JSON loader for `modelAliases`, `combos`, `providerNodes`
  - helper methods for combo lookup and provider-node prefix lookup
- `go-proxy/internal/model/parser_test.go`
- `go-proxy/internal/model/resolver_test.go`
- `go-proxy/internal/model/db_test.go`
- `go-proxy/internal/testdata/model/db_phase1.json`

### New Go provider package

- `go-proxy/internal/provider/registry.go`
  - Go representation of required provider configs from `open-sse/config/providers.js`
  - helpers for compatible-provider detection and target format
- `go-proxy/internal/provider/nodes.go`
  - node config type shared with model/db layer
  - helpers for openai-compatible and anthropic-compatible custom nodes
- `go-proxy/internal/provider/urls.go`
  - `BuildURL(provider, model string, stream bool, options BuildURLOptions) (string, error)`
  - normalization helpers for base URLs and special providers
- `go-proxy/internal/provider/headers.go`
  - `BuildHeaders(provider string, cred CredentialLike, stream bool, opts HeaderOptions) http.Header`
  - generated GitHub request ID helper
  - Cline header helper port or local equivalent
- `go-proxy/internal/provider/registry_test.go`
- `go-proxy/internal/provider/urls_test.go`
- `go-proxy/internal/provider/headers_test.go`
- `go-proxy/internal/testdata/provider/*.json` if fixtures make table tests clearer

### Existing files referenced but not changed in Phase 1

- `go-proxy/internal/http/routes.go`
  - remains unchanged in this phase; its hardcoded `buildUpstreamURL` / `applyUpstreamAuth` become replacement targets in Phase 2
- `go-proxy/internal/credentials/reader.go`
  - remains the credential source; Phase 1 may define minimal compatible interfaces around it instead of editing it

## Data model to implement

### `internal/model`

```go
type ParsedModel struct {
	Provider      string
	Model         string
	IsAlias       bool
	ProviderAlias string
}

type AliasTarget struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

type Combo struct {
	Name   string   `json:"name"`
	Models []string `json:"models"`
}

type ProviderNode struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Prefix   string `json:"prefix"`
	BaseURL  string `json:"baseUrl"`
	APIType  string `json:"apiType"`
	Disabled bool   `json:"disabled"`
}

type Resolution struct {
	Provider string
	Model    string
	IsCombo  bool
}
```

### `internal/provider`

```go
type Config struct {
	BaseURL      string
	ResponsesURL string
	Format       string
	Headers      map[string]string
	BaseURLs     []string
	NoAuth       bool
}

type BuildURLOptions struct {
	BaseURL         string
	BaseURLIndex    int
	QwenResourceURL string
}

type Credentials struct {
	APIKey               string
	AccessToken          string
	RefreshToken         string
	CopilotToken         string
	ProviderSpecificData map[string]any
}

type HeaderOptions struct {
	RequestID string
}
```

## Implementation sequence

### Task 1 — Create model parser parity tests and parser implementation

#### Files

- add `go-proxy/internal/model/parser.go`
- add `go-proxy/internal/model/parser_test.go`

#### Test-first work

Write table-driven tests covering the exact parse outcomes below:

```go
func TestParse_EmptyString(t *testing.T) {
	got := Parse("")
	if got != (ParsedModel{Provider: "", Model: "", IsAlias: false, ProviderAlias: ""}) {
		t.Fatalf("unexpected parsed model: %#v", got)
	}
}

func TestParse_ProviderSlashModel(t *testing.T) {
	got := Parse("openai/gpt-4.1")
	if got.Provider != "openai" || got.Model != "gpt-4.1" || got.IsAlias {
		t.Fatalf("unexpected parsed model: %#v", got)
	}
}

func TestParse_AliasSlashModel_ResolvesProviderAlias(t *testing.T) {
	got := Parse("cc/claude-sonnet-4")
	if got.Provider != "claude" || got.Model != "claude-sonnet-4" || got.ProviderAlias != "cc" {
		t.Fatalf("unexpected parsed model: %#v", got)
	}
}

func TestParse_SplitsOnFirstSlashOnly(t *testing.T) {
	got := Parse("openai/gpt/custom")
	if got.Provider != "openai" || got.Model != "gpt/custom" {
		t.Fatalf("unexpected parsed model: %#v", got)
	}
}

func TestParse_SlashlessValueBecomesAliasCandidate(t *testing.T) {
	got := Parse("fast")
	if !got.IsAlias || got.Model != "fast" || got.Provider != "" {
		t.Fatalf("unexpected parsed model: %#v", got)
	}
}

func TestResolveProviderAlias_KnownAndUnknown(t *testing.T) {
	if got := ResolveProviderAlias("cc"); got != "claude" {
		t.Fatalf("expected claude, got %q", got)
	}
	if got := ResolveProviderAlias("openai"); got != "openai" {
		t.Fatalf("expected openai passthrough, got %q", got)
	}
}
```

Include all aliases currently needed from `open-sse/services/model.js`, including at least:

```go
var providerAliases = map[string]string{
	"cc": "claude",
	"cx": "codex",
	"gc": "gemini-cli",
	"qw": "qwen",
	"ag": "antigravity",
	"gh": "github",
	"cl": "cline",
	"openai": "openai",
	"anthropic": "anthropic",
	"gemini": "gemini",
	"openrouter": "openrouter",
	"glm": "glm",
	"kimi": "kimi",
	"minimax": "minimax",
	"deepseek": "deepseek",
	"groq": "groq",
	"mistral": "mistral",
	"perplexity": "perplexity",
	"together": "together",
	"fireworks": "fireworks",
	"cohere": "cohere",
	"nvidia": "nvidia",
	"nebius": "nebius",
	"siliconflow": "siliconflow",
	"vertex": "vertex",
	"vertex-partner": "vertex-partner",
	"grok-web": "grok-web",
	"perplexity-web": "perplexity-web",
}
```

#### Commands

Run from `/workspaces/9router/.claude/worktrees/worktree-go-proxy-wrapper/go-proxy`.

```bash
go test ./internal/model -run 'TestParse|TestResolveProviderAlias' -count=1
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/model [setup failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/model	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/model/parser.go go-proxy/internal/model/parser_test.go && git commit -m "add go proxy model parser parity"
```

---

### Task 2 — Add db-backed alias/combo/provider-node fixture loader

#### Files

- add `go-proxy/internal/model/db.go`
- add `go-proxy/internal/model/db_test.go`
- add `go-proxy/internal/testdata/model/db_phase1.json`

#### Fixture content

Create a real fixture with no placeholders:

```json
{
  "providerConnections": [],
  "providerNodes": [
    {
      "id": "openai-compatible-local",
      "type": "openai-compatible",
      "prefix": "oaic",
      "baseUrl": "https://oaic.example.com/v1",
      "apiType": "chat"
    },
    {
      "id": "openai-compatible-responses",
      "type": "openai-compatible",
      "prefix": "oair",
      "baseUrl": "https://responses.example.com/v1",
      "apiType": "responses"
    },
    {
      "id": "anthropic-compatible-local",
      "type": "anthropic-compatible",
      "prefix": "acmp",
      "baseUrl": "https://anthropic-proxy.example.com/v1"
    }
  ],
  "proxyPools": [],
  "modelAliases": {
    "fast": "openai/gpt-4.1-mini",
    "smart": {
      "provider": "cc",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "customModels": [],
  "mitmAlias": {},
  "combos": [
    {
      "name": "writer-pack",
      "models": [
        "openai/gpt-4.1",
        "claude/claude-sonnet-4-20250514"
      ]
    }
  ],
  "apiKeys": [],
  "settings": {},
  "pricing": {}
}
```

#### Test-first work

Add tests that prove the loader can:

- read aliases from string and object forms
- find combo by exact name
- return combo models
- return provider nodes by type
- resolve provider node by prefix

Use concrete assertions like:

```go
func TestStore_LoadFileAndExposeLookups(t *testing.T) {
	store, err := LoadStore("../testdata/model/db_phase1.json")
	if err != nil {
		t.Fatalf("expected store to load: %v", err)
	}

	if got := store.ModelAliases()["fast"]; got.RawString != "openai/gpt-4.1-mini" {
		t.Fatalf("unexpected fast alias: %#v", got)
	}

	combo, ok := store.ComboByName("writer-pack")
	if !ok || len(combo.Models) != 2 {
		t.Fatalf("unexpected combo: %#v", combo)
	}

	openaiNodes := store.ProviderNodesByType("openai-compatible")
	if len(openaiNodes) != 2 {
		t.Fatalf("expected 2 openai-compatible nodes, got %d", len(openaiNodes))
	}

	node, ok := store.ProviderNodeByPrefix("acmp", "anthropic-compatible")
	if !ok || node.ID != "anthropic-compatible-local" {
		t.Fatalf("unexpected anthropic-compatible node: %#v", node)
	}
}
```

#### Commands

```bash
go test ./internal/model -run 'TestStore_' -count=1
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/model [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/model	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/model/db.go go-proxy/internal/model/db_test.go go-proxy/internal/testdata/model/db_phase1.json && git commit -m "add go proxy model db store lookups"
```

---

### Task 3 — Implement model resolver parity with alias, combo, inference, and custom-node prefix handling

#### Files

- add `go-proxy/internal/model/resolver.go`
- add or extend `go-proxy/internal/model/resolver_test.go`

#### Test-first work

Add tests for these exact behaviors:

```go
func TestResolveModel_DirectProviderModelPassesThrough(t *testing.T) {
	store := mustLoadStore(t)
	got, err := ResolveModel("openai/gpt-4.1", store)
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != (Resolution{Provider: "openai", Model: "gpt-4.1"}) {
		t.Fatalf("unexpected resolution: %#v", got)
	}
}

func TestResolveModel_ComboNameWinsBeforeAliasFallback(t *testing.T) {
	store := mustLoadStore(t)
	got, err := ResolveModel("writer-pack", store)
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if !got.IsCombo || got.Provider != "" || got.Model != "writer-pack" {
		t.Fatalf("unexpected combo resolution: %#v", got)
	}
}

func TestResolveModel_AliasStringTarget(t *testing.T) {
	store := mustLoadStore(t)
	got, err := ResolveModel("fast", store)
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != (Resolution{Provider: "openai", Model: "gpt-4.1-mini"}) {
		t.Fatalf("unexpected resolution: %#v", got)
	}
}

func TestResolveModel_AliasObjectTarget_ResolvesProviderAlias(t *testing.T) {
	store := mustLoadStore(t)
	got, err := ResolveModel("smart", store)
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != (Resolution{Provider: "claude", Model: "claude-sonnet-4-20250514"}) {
		t.Fatalf("unexpected resolution: %#v", got)
	}
}

func TestResolveModel_InferProviderWhenAliasMissing(t *testing.T) {
	store := mustLoadStore(t)
	cases := map[string]string{
		"claude-3-7-sonnet": "anthropic",
		"gemini-2.5-pro": "gemini",
		"gpt-4.1": "openai",
		"o3-mini": "openai",
		"deepseek-r1": "openrouter",
		"unknown-model": "openai",
	}
	for input, wantProvider := range cases {
		got, err := ResolveModel(input, store)
		if err != nil {
			t.Fatalf("input %s: unexpected error: %v", input, err)
		}
		if got.Provider != wantProvider || got.Model != input {
			t.Fatalf("input %s: unexpected resolution: %#v", input, got)
		}
	}
}

func TestResolveModel_CustomProviderPrefixMapsToNodeID(t *testing.T) {
	store := mustLoadStore(t)
	got, err := ResolveModel("oaic/gpt-4.1", store)
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != (Resolution{Provider: "openai-compatible-local", Model: "gpt-4.1"}) {
		t.Fatalf("unexpected resolution: %#v", got)
	}
}

func TestResolveModel_CustomAnthropicPrefixMapsToNodeID(t *testing.T) {
	store := mustLoadStore(t)
	got, err := ResolveModel("acmp/claude-sonnet-4", store)
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != (Resolution{Provider: "anthropic-compatible-local", Model: "claude-sonnet-4"}) {
		t.Fatalf("unexpected resolution: %#v", got)
	}
}
```

Resolver flow must be:

1. `Parse(modelStr)`
2. if slash form and provider alias equals resolved provider, check openai-compatible node prefixes
3. if still unresolved, check anthropic-compatible node prefixes
4. if direct slash form and no node override, return parsed provider/model
5. if slashless, combo lookup before alias lookup
6. alias lookup
7. provider inference fallback

#### Commands

```bash
go test ./internal/model -run 'TestResolveModel_|TestInferProvider' -count=1
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/model [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/model	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/model/resolver.go go-proxy/internal/model/resolver_test.go && git commit -m "add go proxy model resolver parity"
```

---

### Task 4 — Add provider registry with compatible-provider detection and minimal config parity

#### Files

- add `go-proxy/internal/provider/registry.go`
- add `go-proxy/internal/provider/registry_test.go`

#### Test-first work

Write tests for the specific provider config behavior needed by URL/header builders:

```go
func TestGetConfig_OpenAICompatibleUsesOpenAIDefaults(t *testing.T) {
	got := GetConfig("openai-compatible-local")
	if got.Format != "openai" {
		t.Fatalf("expected openai format, got %#v", got)
	}
	if got.BaseURL != "https://api.openai.com/v1" {
		t.Fatalf("unexpected base URL: %#v", got)
	}
}

func TestGetConfig_OpenAICompatibleResponsesUsesResponsesFormat(t *testing.T) {
	got := GetConfig("openai-compatible-responses")
	if got.Format != "openai-responses" {
		t.Fatalf("unexpected config: %#v", got)
	}
}

func TestGetConfig_AnthropicCompatibleUsesClaudeDefaults(t *testing.T) {
	got := GetConfig("anthropic-compatible-local")
	if got.Format != "claude" {
		t.Fatalf("unexpected config: %#v", got)
	}
	if got.BaseURL != "https://api.anthropic.com/v1" {
		t.Fatalf("unexpected base URL: %#v", got)
	}
}

func TestGetConfig_KnownProviderReturnsRegistryEntry(t *testing.T) {
	got := GetConfig("github")
	if got.BaseURL != "https://api.githubcopilot.com/chat/completions" {
		t.Fatalf("unexpected github config: %#v", got)
	}
}

func TestGetTargetFormat_CompatibleProvidersMatchJavaScript(t *testing.T) {
	if got := GetTargetFormat("openai-compatible-responses"); got != "openai-responses" {
		t.Fatalf("expected openai-responses, got %q", got)
	}
	if got := GetTargetFormat("anthropic-compatible-local"); got != "claude" {
		t.Fatalf("expected claude, got %q", got)
	}
}
```

Implement only the provider entries used by Phase 1 tests and near-term forwarding integration, but include actual concrete values from `open-sse/config/providers.js` for at least:

- `claude`
- `anthropic`
- `openai`
- `openrouter`
- `gemini`
- `gemini-cli`
- `antigravity`
- `codex`
- `qwen`
- `github`
- `glm`
- `kimi`
- `minimax`
- `cline`
- `vertex`
- `vertex-partner`
- `opencode`
- `opencode-go`

#### Commands

```bash
go test ./internal/provider -run 'TestGetConfig|TestGetTargetFormat' -count=1
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/provider [setup failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/provider	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/provider/registry.go go-proxy/internal/provider/registry_test.go && git commit -m "add go proxy provider registry parity"
```

---

### Task 5 — Implement provider node helpers and URL builders

#### Files

- add `go-proxy/internal/provider/nodes.go`
- add `go-proxy/internal/provider/urls.go`
- add `go-proxy/internal/provider/urls_test.go`

#### Test-first work

Add tests with concrete URL expectations:

```go
func TestBuildURL_OpenAICompatibleChat(t *testing.T) {
	got, err := BuildURL("openai-compatible-local", "gpt-4.1", true, BuildURLOptions{BaseURL: "https://custom.example.com/v1/"})
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != "https://custom.example.com/v1/chat/completions" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_OpenAICompatibleResponses(t *testing.T) {
	got, err := BuildURL("openai-compatible-responses", "gpt-4.1", true, BuildURLOptions{BaseURL: "https://custom.example.com/v1"})
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != "https://custom.example.com/v1/responses" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_AnthropicCompatible(t *testing.T) {
	got, err := BuildURL("anthropic-compatible-local", "claude-sonnet-4", true, BuildURLOptions{BaseURL: "https://anthropic-proxy.example.com/v1/"})
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != "https://anthropic-proxy.example.com/v1/messages" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_Gemini_StreamAndNonStream(t *testing.T) {
	streamURL, _ := BuildURL("gemini", "gemini-2.5-pro", true, BuildURLOptions{})
	if streamURL != "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse" {
		t.Fatalf("unexpected stream URL: %q", streamURL)
	}
	nonStreamURL, _ := BuildURL("gemini", "gemini-2.5-pro", false, BuildURLOptions{})
	if nonStreamURL != "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent" {
		t.Fatalf("unexpected non-stream URL: %q", nonStreamURL)
	}
}

func TestBuildURL_AntigravityUsesIndexedBaseURL(t *testing.T) {
	got, err := BuildURL("antigravity", "gemini-2.5-pro", true, BuildURLOptions{BaseURLIndex: 1})
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_QwenNormalizesResourceURL(t *testing.T) {
	got, err := BuildURL("qwen", "qwen-max", true, BuildURLOptions{QwenResourceURL: "my-qwen-host.example.com/"})
	if err != nil {
		t.Fatalf("expected no error: %v", err)
	}
	if got != "https://my-qwen-host.example.com/v1/chat/completions" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_ClaudeCompatibleAddsBetaQuery(t *testing.T) {
	for _, providerID := range []string{"claude", "glm", "kimi", "minimax"} {
		got, err := BuildURL(providerID, "ignored", true, BuildURLOptions{})
		if err != nil {
			t.Fatalf("provider %s: unexpected error: %v", providerID, err)
		}
		if got[len(got)-10:] != "?beta=true" {
			t.Fatalf("provider %s: expected beta suffix, got %q", providerID, got)
		}
	}
}
```

Implementation notes:

- `BuildURL` must trim one trailing slash from supplied base URLs before appending endpoint paths.
- For `qwen`, strip trailing `/chat/completions` from fallback base URL before rebuilding.
- For unknown providers, return the registry `BaseURL` unchanged if present; otherwise return an error.

#### Commands

```bash
go test ./internal/provider -run 'TestBuildURL_' -count=1
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/provider [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/provider	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/provider/nodes.go go-proxy/internal/provider/urls.go go-proxy/internal/provider/urls_test.go && git commit -m "add go proxy provider url builders"
```

---

### Task 6 — Implement provider header builders with parity tests

#### Files

- add `go-proxy/internal/provider/headers.go`
- add `go-proxy/internal/provider/headers_test.go`

#### Test-first work

Add tests for concrete header expectations:

```go
func TestBuildHeaders_OpenAICompatibleUsesBearer(t *testing.T) {
	headers := BuildHeaders("openai-compatible-local", Credentials{APIKey: "sk-openai"}, true, HeaderOptions{})
	if got := headers.Get("Authorization"); got != "Bearer sk-openai" {
		t.Fatalf("unexpected auth header: %q", got)
	}
	if got := headers.Get("Accept"); got != "text/event-stream" {
		t.Fatalf("unexpected accept header: %q", got)
	}
}

func TestBuildHeaders_AnthropicCompatiblePrefersXAPIKeyAndDefaultVersion(t *testing.T) {
	headers := BuildHeaders("anthropic-compatible-local", Credentials{APIKey: "sk-anth"}, true, HeaderOptions{})
	if got := headers.Get("x-api-key"); got != "sk-anth" {
		t.Fatalf("unexpected x-api-key: %q", got)
	}
	if got := headers.Get("Authorization"); got != "" {
		t.Fatalf("expected Authorization to be omitted, got %q", got)
	}
	if got := headers.Get("anthropic-version"); got != "2023-06-01" {
		t.Fatalf("unexpected anthropic-version: %q", got)
	}
}

func TestBuildHeaders_GeminiUsesXGoogAPIKey(t *testing.T) {
	headers := BuildHeaders("gemini", Credentials{APIKey: "gem-key"}, false, HeaderOptions{})
	if got := headers.Get("x-goog-api-key"); got != "gem-key" {
		t.Fatalf("unexpected x-goog-api-key: %q", got)
	}
}

func TestBuildHeaders_GitHubAddsCopilotHeadersAndRequestID(t *testing.T) {
	headers := BuildHeaders("github", Credentials{CopilotToken: "ghu_test"}, false, HeaderOptions{RequestID: "req-fixed-1"})
	if got := headers.Get("Authorization"); got != "Bearer ghu_test" {
		t.Fatalf("unexpected auth header: %q", got)
	}
	if got := headers.Get("copilot-integration-id"); got != "vscode-chat" {
		t.Fatalf("unexpected integration header: %q", got)
	}
	if got := headers.Get("x-request-id"); got != "req-fixed-1" {
		t.Fatalf("unexpected request id: %q", got)
	}
}

func TestBuildHeaders_VertexSkipsAuthorizationMutation(t *testing.T) {
	headers := BuildHeaders("vertex", Credentials{APIKey: "raw-json-should-not-leak"}, false, HeaderOptions{})
	if got := headers.Get("Authorization"); got != "" {
		t.Fatalf("expected no Authorization header, got %q", got)
	}
}

func TestBuildHeaders_ClineAddsCustomHeaders(t *testing.T) {
	headers := BuildHeaders("cline", Credentials{APIKey: "cline-token"}, false, HeaderOptions{})
	if got := headers.Get("Authorization"); got == "" {
		t.Fatalf("expected cline auth headers to be populated")
	}
}
```

Implementation details to preserve:

- always seed `Content-Type: application/json`
- merge registry headers before auth mutation
- `stream == true` adds `Accept: text/event-stream`
- anthropic-compatible adds default version when absent
- GitHub uses `CopilotToken` first, then `AccessToken`
- deterministic request ID in tests via `HeaderOptions.RequestID`; generate a random UUID-like fallback only when empty

For the Cline helper, port the smallest equivalent needed for parity in Go rather than skipping the provider.

#### Commands

```bash
go test ./internal/provider -run 'TestBuildHeaders_' -count=1
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/provider [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/provider	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/provider/headers.go go-proxy/internal/provider/headers_test.go && git commit -m "add go proxy provider header builders"
```

---

### Task 7 — Add cross-package parity tests that lock Phase 1 behavior

#### Files

- add `go-proxy/internal/model/parity_test.go`
- add `go-proxy/internal/provider/parity_test.go`

#### Test-first work

Create package-level parity tests that assert the new Go implementation matches the JS source behavior for representative cases that combine multiple helpers.

Use explicit examples:

```go
func TestModelParity_JSExamples(t *testing.T) {
	store := mustLoadStore(t)
	cases := []struct {
		input string
		want  Resolution
	}{
		{input: "cc/claude-sonnet-4", want: Resolution{Provider: "claude", Model: "claude-sonnet-4"}},
		{input: "fast", want: Resolution{Provider: "openai", Model: "gpt-4.1-mini"}},
		{input: "smart", want: Resolution{Provider: "claude", Model: "claude-sonnet-4-20250514"}},
		{input: "oaic/gpt-4.1", want: Resolution{Provider: "openai-compatible-local", Model: "gpt-4.1"}},
	}
	for _, tc := range cases {
		got, err := ResolveModel(tc.input, store)
		if err != nil {
			t.Fatalf("input %s: unexpected error: %v", tc.input, err)
		}
		if got != tc.want {
			t.Fatalf("input %s: got %#v want %#v", tc.input, got, tc.want)
		}
	}
}

func TestProviderParity_JSExamples(t *testing.T) {
	url, err := BuildURL("openai-compatible-responses", "gpt-4.1", true, BuildURLOptions{BaseURL: "https://proxy.example.com/v1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if url != "https://proxy.example.com/v1/responses" {
		t.Fatalf("unexpected URL: %q", url)
	}

	headers := BuildHeaders("anthropic-compatible-local", Credentials{APIKey: "sk-test"}, true, HeaderOptions{RequestID: "req-parity-1"})
	if headers.Get("x-api-key") != "sk-test" || headers.Get("anthropic-version") != "2023-06-01" {
		t.Fatalf("unexpected anthropic-compatible headers: %#v", headers)
	}
}
```

These tests must not shell out to Node. They should encode source-of-truth examples copied from the JavaScript behavior, so Go parity stays stable even if JS moves later.

#### Commands

```bash
go test ./internal/model ./internal/provider -run 'Test.*Parity' -count=1
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/model [build failed]
FAIL	go-proxy/internal/provider [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/model	0.xxxs
ok  	go-proxy/internal/provider	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/model/parity_test.go go-proxy/internal/provider/parity_test.go && git commit -m "add go proxy phase1 parity tests"
```

---

### Task 8 — Final Phase 1 verification

#### Commands

Run the full package test set for the new scope:

```bash
go test ./internal/model ./internal/provider -count=1
```

Expected output:

```text
ok  	go-proxy/internal/model	0.xxxs
ok  	go-proxy/internal/provider	0.xxxs
```

Optional broader confidence check before handing off to Phase 2:

```bash
go test ./... -count=1
```

Expected output:

```text
ok  	go-proxy/internal/cache	0.xxxs
ok  	go-proxy/internal/config	0.xxxs
ok  	go-proxy/internal/credentials	0.xxxs
ok  	go-proxy/internal/http	0.xxxs
ok  	go-proxy/internal/model	0.xxxs
ok  	go-proxy/internal/provider	0.xxxs
ok  	go-proxy/internal/proxy	0.xxxs
ok  	go-proxy/internal/report	0.xxxs
ok  	go-proxy/internal/resolve	0.xxxs
```

#### Final commit

```bash
git add docs/superpowers/plans/2026-04-23-go-proxy-phase1-model-provider.md && git commit -m "add phase1 go proxy model provider plan"
```

## Notes for the implementing agent

- Keep `internal/http/routes.go` untouched in this phase; the goal is to land isolated, well-tested primitives.
- Prefer immutable package-level maps for provider aliases and provider registry data.
- Keep exported APIs narrow; Phase 2 can compose them.
- Use table-driven tests wherever multiple provider variants share the same behavior.
- Do not add placeholders such as `TODO`, `TBD`, `mock later`, or empty fixtures.
- If a JS behavior seems awkward, preserve parity first and document the mismatch in the commit message rather than silently “improving” it.
- Every task above ends in a commit on purpose; do not batch multiple tasks into one commit.
