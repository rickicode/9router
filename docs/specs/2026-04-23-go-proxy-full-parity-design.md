# Go Proxy Full Parity Design

**Date:** 2026-04-23  
**Status:** Draft  
**Goal:** Transform Go proxy from thin forwarder to full-featured runtime replica with 100% behavioral parity to JS 9router for OpenAI-compatible and Anthropic-compatible traffic, excluding RTK.

---

## Executive Summary

Current Go proxy is a thin pass-through proxy with basic resolve/report integration. Target state is a self-contained runtime that replicates all JS 9router behavior for supported protocol families, with Go-specific optimizations for performance while maintaining strict OpenAI/Anthropic compatibility.

**Key changes:**
- Port model resolution, translation layer, provider registry, token refresh, account state machine from JS to Go
- Maintain config compatibility (same db.json structure)
- Add Go-specific optimizations (connection pooling, zero-copy streaming, concurrent request handling)
- Expand endpoint coverage to match JS runtime

---

## Architecture Overview

### Current State
```
Client → Go proxy → validate → resolve (9router API) → read creds → forward → report
```

### Target State
```
Client → Go proxy → validate → resolve model locally → select account → refresh token → translate request → forward → translate response → update state → report
```

**Core principle:** Port JS runtime logic to Go incrementally, test parity per component, optimize for Go idioms without breaking compatibility.

---

## Component Design

### 1. Model Resolution Engine

**Package:** `go-proxy/internal/model`

**Responsibilities:**
- Parse model strings (provider/model, alias, prefix)
- Resolve aliases from db.json
- Detect provider-node prefixes (openai-compatible-*, anthropic-compatible-*)
- Handle combo models
- Return resolved provider/model/combo info

**Key types:**
```go
type ModelInfo struct {
    Provider     string
    Model        string
    IsCombo      bool
    ComboModels  []string
    IsCustomNode bool
    NodeConfig   *ProviderNode
}

type Resolver struct {
    aliases      map[string]string
    combos       map[string][]string
    providerNodes map[string]*ProviderNode
    mu           sync.RWMutex
}
```

**Port from:**
- `src/sse/services/model.js`
- `open-sse/services/model.js`

**Go optimizations:**
- Concurrent-safe alias/combo cache with RWMutex
- Pre-compiled regex for model parsing
- Zero-allocation string parsing where possible

**Behavior parity:**
- Same parsing rules
- Same alias resolution order
- Same combo expansion
- Same fallback for unrecognized models

---

### 2. Translation Layer

**Package:** `go-proxy/internal/translator`

**Responsibilities:**
- Detect source format (openai, openai-responses, claude, gemini)
- Translate requests between formats
- Translate responses between formats
- Handle tool calls, thinking blocks, content normalization

**Key types:**
```go
type Format int

const (
    FormatOpenAI Format = iota
    FormatOpenAIResponses
    FormatClaude
    FormatGemini
)

type RequestTranslator interface {
    Translate(ctx context.Context, body []byte, target Format) ([]byte, error)
}

type ResponseTranslator interface {
    Translate(ctx context.Context, body []byte, source Format, target Format) ([]byte, error)
}
```

**Port from:**
- `open-sse/translator/*`

**Go optimizations:**
- Use `encoding/json` with custom UnmarshalJSON for performance
- Reuse byte buffers with sync.Pool
- Stream-based translation for large payloads
- Parallel translation for batch requests

**Behavior parity:**
- Same format detection logic (endpoint + body structure)
- Same transformation rules per format pair
- Same tool call normalization
- Same thinking block handling
- Same cache_control handling

**Special cases:**
- `/v1/responses` conversion to chat-style internally
- Stream-to-JSON conversion when provider forces streaming
- SSE format transformation

---

### 3. Provider Registry

**Package:** `go-proxy/internal/provider`

**Responsibilities:**
- Load provider configs from db.json
- Support custom openai-compatible and anthropic-compatible nodes
- Build provider URLs and headers
- Handle provider-specific auth

**Key types:**
```go
type ProviderNode struct {
    ID       string
    Prefix   string
    APIType  string // "chat" or "responses"
    BaseURL  string
    Provider string
}

type Registry struct {
    nodes    map[string]*ProviderNode
    official map[string]*OfficialProvider
    mu       sync.RWMutex
}

type OfficialProvider struct {
    Name    string
    BaseURL string
    AuthType string
}
```

**Port from:**
- `open-sse/services/provider.js`
- `src/app/api/provider-nodes/*`

**Go optimizations:**
- Concurrent-safe registry with RWMutex
- Pre-built URL templates
- Header pooling for common cases

**Behavior parity:**
- Support all official providers (openai, anthropic, claude, etc.)
- Support openai-compatible-* custom nodes
- Support anthropic-compatible-* custom nodes
- Same base URL construction
- Same header injection logic
- Same auth scheme selection

---

### 4. Token Refresh Lifecycle

**Package:** `go-proxy/internal/refresh`

**Responsibilities:**
- Check token expiry before requests
- Refresh access tokens proactively
- Handle provider-specific refresh flows
- Persist refreshed tokens to db.json
- Retry requests after refresh

**Key types:**
```go
type Refresher struct {
    providers map[string]ProviderRefresher
    db        *credentials.DB
    mu        sync.Mutex
}

type ProviderRefresher interface {
    NeedsRefresh(cred *credentials.Credential) bool
    Refresh(ctx context.Context, cred *credentials.Credential) (*credentials.Credential, error)
}
```

**Port from:**
- `src/sse/services/tokenRefresh.js`

**Go optimizations:**
- Concurrent refresh with mutex per connection
- Background refresh goroutine for proactive refresh
- Exponential backoff for failed refreshes

**Behavior parity:**
- Same expiry lead window (5 minutes default)
- Same refresh flow per provider
- Same token persistence
- Same retry-after-refresh logic

**Supported flows:**
- OAuth refresh_token flow
- GitHub Copilot token refresh
- Provider-specific project ID refresh

---

### 5. Account Eligibility & State Machine

**Package:** `go-proxy/internal/accounts`

**Responsibilities:**
- Filter eligible connections
- Apply model-specific locks
- Handle cooldowns
- Detect auth blocks / quota exhaustion
- Select accounts with strategy (fill-first, round-robin)
- Mark accounts unavailable on failure
- Clear account errors on success

**Key types:**
```go
type State struct {
    locks     map[string]*ModelLock // connectionID -> lock
    cooldowns map[string]time.Time  // connectionID -> until
    counters  map[string]int        // for round-robin
    mu        sync.RWMutex
}

type ModelLock struct {
    Model      string
    Reason     string
    Until      time.Time
}

type Selector struct {
    state    *State
    strategy SelectionStrategy
}

type SelectionStrategy int

const (
    StrategyFillFirst SelectionStrategy = iota
    StrategyRoundRobin
)
```

**Port from:**
- `src/sse/services/auth.js`
- `open-sse/services/accountFallback.js`

**Go optimizations:**
- Concurrent-safe state with RWMutex
- Lock-free counters with atomic operations where possible
- Efficient cooldown checking with time.Timer

**Behavior parity:**
- Same eligibility rules
- Same model-lock semantics
- Same cooldown durations
- Same auth-block detection
- Same quota-exhaustion detection
- Same selection strategy behavior

**State persistence:**
- In-memory state for runtime
- Periodic sync to db.json (configurable interval)
- Report state changes to 9router internal API

---

### 6. Error Normalization Layer

**Package:** `go-proxy/internal/errors`

**Responsibilities:**
- Map upstream errors to OpenAI-style error bodies
- Preserve provider status codes
- Build error responses
- Handle unavailable/auth-blocked responses

**Key types:**
```go
type ErrorBody struct {
    Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
    Message string `json:"message"`
    Type    string `json:"type"`
    Code    string `json:"code,omitempty"`
}

type Mapper struct {
    rules map[int]ErrorDetail
}
```

**Port from:**
- `open-sse/utils/error.js`

**Go optimizations:**
- Pre-built error templates
- Zero-allocation error building for common cases

**Behavior parity:**
- Same error body structure
- Same status code mapping
- Same error type/code assignment
- Same unavailable response format

---

### 7. Endpoint Expansion

**Current:**
- `/v1/chat/completions`
- `/v1/responses`
- `/v1/messages`

**Add:**
- `/v1/embeddings`
- `/v1/audio/speech`
- `/v1/images/generations`
- `/v1/messages/count_tokens`

**Implementation:**
- Each endpoint gets dedicated handler
- Reuse shared components (model resolution, account selection, etc.)
- Port endpoint-specific logic from JS handlers

**Port from:**
- `src/sse/handlers/embeddings.js`
- `src/sse/handlers/tts.js`
- `src/sse/handlers/imageGeneration.js`
- `src/app/api/v1/messages/count_tokens/route.js`

---

## Data Flow

### OpenAI-Compatible Request Flow

```
POST /v1/chat/completions
  ↓
readPublicAPIKey (optional enforcement from settings)
  ↓
parseRequestBody
  ↓
detectSourceFormat (openai vs openai-responses)
  ↓
resolveModel (alias → provider/model)
  ↓
loadProviderConfig
  ↓
selectEligibleAccount (with strategy)
  ↓
checkTokenExpiry → refreshIfNeeded
  ↓
translateRequest (if format mismatch)
  ↓
buildUpstreamURL
  ↓
buildUpstreamHeaders
  ↓
forwardRequest
  ↓
on 401/403: refreshToken → retry
on other error: markAccountUnavailable → fallback
  ↓
translateResponse (if format mismatch)
  ↓
extractUsage
  ↓
updateAccountState
  ↓
reportOutcome
  ↓
return to client
```

### Anthropic-Compatible Request Flow

```
POST /v1/messages
  ↓
readPublicAPIKey (optional enforcement)
  ↓
parseRequestBody
  ↓
detectSourceFormat (claude)
  ↓
resolveModel
  ↓
loadProviderConfig
  ↓
selectEligibleAccount
  ↓
checkTokenExpiry → refreshIfNeeded
  ↓
translateRequest (claude → provider format if needed)
  ↓
buildUpstreamURL
  ↓
buildUpstreamHeaders (with anthropic-version, x-api-key)
  ↓
forwardRequest
  ↓
on error: fallback logic
  ↓
translateResponse (provider → claude if needed)
  ↓
extractUsage
  ↓
updateAccountState
  ↓
reportOutcome
  ↓
return to client
```

### Fallback Flow

```
Primary account fails
  ↓
classifyError (auth-blocked? quota-exhausted? rate-limit?)
  ↓
markAccountUnavailable (with model-lock if needed)
  ↓
selectNextEligibleAccount (exclude failed)
  ↓
if available: retry with next account
if none: return error
  ↓
on success: clearAccountError for successful account
```

---

## Go-Specific Optimizations

### 1. Connection Pooling

**Implementation:**
- Use `http.Transport` with custom `MaxIdleConnsPerHost`
- Separate connection pools per provider
- Configurable pool sizes

**Benefits:**
- Reduce connection overhead
- Better throughput for high-traffic scenarios

### 2. Zero-Copy Streaming

**Implementation:**
- Use `io.Copy` for stream passthrough
- Avoid buffering entire response bodies
- Use `io.TeeReader` for usage extraction without double-buffering

**Benefits:**
- Lower memory usage
- Lower latency for streaming responses

### 3. Concurrent Request Handling

**Implementation:**
- Goroutine per request (default Go HTTP server behavior)
- Concurrent-safe shared state with RWMutex
- Lock-free operations where possible (atomic counters)

**Benefits:**
- Higher throughput
- Better CPU utilization

### 4. Memory Efficiency

**Implementation:**
- Reuse byte buffers with `sync.Pool`
- Pre-allocate slices for known sizes
- Avoid unnecessary allocations in hot paths

**Benefits:**
- Lower GC pressure
- More predictable latency

### 5. Structured Logging

**Implementation:**
- Use structured logging library (e.g., `slog`)
- Log levels: debug, info, warn, error
- Contextual logging with request IDs

**Benefits:**
- Better observability
- Easier debugging

---

## Configuration & Persistence

### Config Sources

**No change to existing config:**
- Same `db.json` structure
- Same env vars
- Same CLI flags

**New config sections used from db.json:**
- `modelAliases` - now read by Go
- `combos` - now read by Go
- `providerNodes` - now read by Go
- `settings.requireApiKey` - now respected by Go

### State Persistence

**In-memory state:**
- Account locks (per model)
- Cooldown timers
- Round-robin counters

**Periodic sync to db.json:**
- Account health status
- Last used timestamps
- Quota signals
- Configurable sync interval (default: 30s)

**Report to 9router:**
- All state changes reported via `/api/internal/proxy/report`
- 9router remains source of truth

---

## Testing Strategy

### Parity Testing

**For each ported component:**
- Unit tests comparing Go output vs JS output
- Integration tests with same inputs
- Behavior verification tests

**Test fixtures:**
- Shared test cases between JS and Go
- Same request/response samples
- Same error scenarios

### Test Coverage

**Unit tests:**
- Model resolution (all parsing cases)
- Translation layer (each format pair)
- Provider registry (official + custom nodes)
- Token refresh (all provider flows)
- Account selection (all strategies)
- Error mapping (all status codes)

**Integration tests:**
- End-to-end request flow
- Fallback scenarios
- Stream handling
- Error handling
- Concurrent requests

**Parity tests:**
- Compare Go vs JS for same inputs
- Verify identical behavior
- Automated parity test suite

**Performance tests:**
- Latency benchmarks
- Throughput benchmarks
- Memory usage profiling
- Concurrent load testing

---

## Implementation Phases

### Phase 1: Model Resolution & Provider Registry (Week 1)
**Goal:** Port model parsing and provider config loading

**Tasks:**
- Implement model parser
- Implement alias resolver
- Implement combo handler
- Implement provider registry
- Implement custom node support
- Write unit tests
- Write parity tests

**Success criteria:**
- All model parsing cases pass
- Alias resolution matches JS
- Custom nodes work correctly
- Parity tests pass

---

### Phase 2: Translation Layer (Week 2-3)
**Goal:** Port request/response translation

**Tasks:**
- Implement format detection
- Implement OpenAI ↔ Claude translation
- Implement OpenAI ↔ Gemini translation
- Implement Responses API translation
- Implement tool call normalization
- Implement thinking block handling
- Write unit tests
- Write parity tests

**Success criteria:**
- All format pairs translate correctly
- Tool calls normalized correctly
- Thinking blocks handled correctly
- Parity tests pass

---

### Phase 3: Token Refresh (Week 4)
**Goal:** Port token refresh lifecycle

**Tasks:**
- Implement expiry checker
- Implement OAuth refresh flow
- Implement GitHub Copilot refresh
- Implement provider-specific refreshes
- Implement persistence
- Write unit tests
- Write parity tests

**Success criteria:**
- Token expiry detected correctly
- Refresh flows work for all providers
- Tokens persisted correctly
- Parity tests pass

---

### Phase 4: Account State Machine (Week 5-6)
**Goal:** Port account eligibility and state management

**Tasks:**
- Implement eligibility filtering
- Implement account selection strategies
- Implement model locks
- Implement cooldowns
- Implement state mutations
- Implement state persistence
- Write unit tests
- Write parity tests

**Success criteria:**
- Eligibility rules match JS
- Selection strategies work correctly
- Locks and cooldowns work correctly
- State persists correctly
- Parity tests pass

---

### Phase 5: Error Normalization (Week 7)
**Goal:** Port error mapping and response building

**Tasks:**
- Implement error mapper
- Implement error body builder
- Implement upstream error parser
- Write unit tests
- Write parity tests

**Success criteria:**
- Error bodies match JS format
- Status codes mapped correctly
- Parity tests pass

---

### Phase 6: Endpoint Expansion (Week 8)
**Goal:** Add missing endpoints

**Tasks:**
- Implement `/v1/embeddings` handler
- Implement `/v1/audio/speech` handler
- Implement `/v1/images/generations` handler
- Implement `/v1/messages/count_tokens` handler
- Write unit tests
- Write integration tests

**Success criteria:**
- All endpoints work correctly
- Behavior matches JS handlers
- Integration tests pass

---

### Phase 7: Integration & Optimization (Week 9-10)
**Goal:** End-to-end testing and Go-specific optimizations

**Tasks:**
- End-to-end integration tests
- Performance benchmarking
- Memory profiling
- Connection pooling optimization
- Buffer pooling optimization
- Concurrent load testing
- Documentation

**Success criteria:**
- All integration tests pass
- Performance meets targets (lower latency, higher throughput than JS)
- Memory usage acceptable
- Documentation complete

---

## Migration Strategy

### Gradual Rollout

**Phase 1: Parallel deployment**
- Deploy Go proxy alongside JS runtime
- Route 1% of traffic to Go
- Monitor parity metrics
- Monitor error rates

**Phase 2: Gradual increase**
- Increase Go traffic to 10%
- Monitor for 1 week
- Increase to 50%
- Monitor for 1 week
- Increase to 100%

**Phase 3: Deprecation (optional)**
- Keep JS runtime available for rollback
- Eventually deprecate JS runtime if Go proves stable

### Rollback Plan

**Immediate rollback:**
- Feature flag to switch between Go/JS
- Monitor error rates
- Automatic rollback if error rate exceeds threshold

**Monitoring:**
- Error rate comparison (Go vs JS)
- Latency comparison
- Throughput comparison
- Memory usage comparison

---

## Success Criteria

### Functional Parity
- ✅ All 10 identified gaps closed
- ✅ Same request/response behavior
- ✅ Same error handling
- ✅ Same fallback logic
- ✅ Same account state management
- ✅ Same translation behavior
- ✅ Same token refresh behavior

### Performance
- ✅ Latency: p50 < JS runtime, p99 < JS runtime
- ✅ Throughput: > 2x JS runtime
- ✅ Memory: < 50% of JS runtime
- ✅ CPU: efficient utilization under load

### Reliability
- ✅ Error rate: ≤ JS runtime
- ✅ Availability: ≥ JS runtime
- ✅ Fallback success rate: ≥ JS runtime

### Maintainability
- ✅ Clear component boundaries
- ✅ Comprehensive test coverage (>80%)
- ✅ Documentation complete
- ✅ Parity test suite automated

---

## Risks & Mitigations

### Risk 1: Translation behavior divergence
**Mitigation:** Comprehensive parity test suite, shared test fixtures

### Risk 2: State machine edge cases
**Mitigation:** Extensive unit tests, integration tests, gradual rollout

### Risk 3: Performance regression
**Mitigation:** Continuous benchmarking, profiling, optimization

### Risk 4: Config incompatibility
**Mitigation:** Strict adherence to existing db.json schema, validation tests

### Risk 5: Token refresh failures
**Mitigation:** Robust error handling, fallback to JS runtime if needed

---

## Open Questions

1. Should we maintain internal resolve API or deprecate it in favor of local resolution?
   - **Decision:** Keep internal resolve API for now, use local resolution as primary path
   
2. Should we sync state to db.json or keep it in-memory only?
   - **Decision:** Periodic sync to db.json for durability, configurable interval

3. Should we support all providers or focus on OpenAI/Anthropic first?
   - **Decision:** Support all providers from the start, use provider registry

4. Should we implement RTK support in Go?
   - **Decision:** No, RTK is explicitly out of scope

---

## Appendix: File Structure

```
go-proxy/
├── main.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── model/
│   │   ├── parser.go
│   │   ├── resolver.go
│   │   ├── combo.go
│   │   └── db.go
│   ├── translator/
│   │   ├── formats.go
│   │   ├── request/
│   │   │   ├── openai_to_claude.go
│   │   │   ├── claude_to_openai.go
│   │   │   ├── openai_responses.go
│   │   │   └── gemini.go
│   │   ├── response/
│   │   │   ├── claude_to_openai.go
│   │   │   ├── openai_to_claude.go
│   │   │   └── gemini_to_openai.go
│   │   └── helpers/
│   │       ├── claude.go
│   │       └── responses.go
│   ├── provider/
│   │   ├── registry.go
│   │   ├── nodes.go
│   │   ├── urls.go
│   │   ├── headers.go
│   │   └── auth.go
│   ├── refresh/
│   │   ├── checker.go
│   │   ├── refresher.go
│   │   ├── providers.go
│   │   └── persistence.go
│   ├── accounts/
│   │   ├── eligibility.go
│   │   ├── selector.go
│   │   ├── state.go
│   │   ├── locks.go
│   │   └── cooldown.go
│   ├── errors/
│   │   ├── mapper.go
│   │   ├── builder.go
│   │   └── upstream.go
│   ├── http/
│   │   └── routes.go
│   ├── credentials/
│   │   └── reader.go
│   ├── proxy/
│   │   ├── forwarder.go
│   │   ├── types.go
│   │   └── usage.go
│   ├── report/
│   │   └── client.go
│   └── resolve/
│       └── client.go
└── go.mod
```

---

## Conclusion

This design transforms Go proxy from a thin forwarder to a full-featured runtime replica with 100% behavioral parity to JS 9router for OpenAI-compatible and Anthropic-compatible traffic. The incremental porting approach with comprehensive parity testing ensures correctness, while Go-specific optimizations deliver superior performance. The gradual rollout strategy minimizes risk and allows for easy rollback if needed.
