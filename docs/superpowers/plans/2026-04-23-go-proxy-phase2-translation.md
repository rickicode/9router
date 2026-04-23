# Phase 2 Implementation Plan — Translation Layer

> **Agentic worker instruction:** Execute this plan one task at a time. For each task: write the failing test first, run only the named test command until it fails for the expected reason, implement the smallest production change to make it pass, rerun the same test command, then commit immediately before moving to the next task.

## Objective

Port the Phase 2 translation layer behavior from:

- `open-sse/translator/index.js`
- `open-sse/translator/request/openai-to-claude.js`
- `open-sse/translator/request/openai-to-gemini.js`
- `open-sse/translator/response/claude-to-openai.js`
- `open-sse/translator/response/gemini-to-openai.js`

into the Go proxy so request/response transformation logic can convert between OpenAI, Anthropic, and Gemini formats, enabling the Go proxy to support multiple provider protocols with OpenAI-compatible client interfaces.

This phase must produce production-ready Go packages for request translation (OpenAI → provider format), response translation (provider format → OpenAI), streaming chunk transformation, and format detection, plus parity-focused tests that lock behavior before Phase 3 integrates them into the forwarding pipeline.

## Scope

### In scope

- `go-proxy/internal/translate/formats.go`
- `go-proxy/internal/translate/detect.go`
- `go-proxy/internal/translate/request.go`
- `go-proxy/internal/translate/response.go`
- `go-proxy/internal/translate/stream.go`
- `go-proxy/internal/translate/openai_claude.go`
- `go-proxy/internal/translate/openai_gemini.go`
- `go-proxy/internal/translate/claude_openai.go`
- `go-proxy/internal/translate/gemini_openai.go`
- New `_test.go` files and `internal/testdata/translate` fixtures required for parity coverage

### Out of scope

- Wiring translation into `go-proxy/internal/http/routes.go`
- End-to-end forwarding integration
- Antigravity/Gemini CLI envelope wrapping (deferred to Phase 3)
- Tool cloaking and anti-ban logic (deferred to Phase 3)
- Vertex, Ollama, Cursor, Kiro formats (deferred to Phase 4+)

## Source behavior to preserve

### Translation behavior from JavaScript

- **Format detection** (`detectFormat` in `provider.js`):
  - OpenAI Responses API: has `input` field (array or string) instead of `messages`
  - Antigravity: has `request.contents` with `userAgent: "antigravity"`
  - Gemini: has `contents` array
  - OpenAI-specific fields: `stream_options`, `response_format`, `logprobs`, `n`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `user`
  - Claude: `messages` with array content containing `type` fields, or `system`/`anthropic_version` fields
  - Default: OpenAI

- **Request translation pipeline** (`translateRequest` in `translator/index.js`):
  1. Strip content types (opt-in via `stripList`)
  2. Normalize thinking config
  3. Ensure tool_call IDs
  4. Fix missing tool responses
  5. Source → OpenAI (if source ≠ OpenAI)
  6. OpenAI → Target (if target ≠ OpenAI)
  7. Filter to clean OpenAI format (if target = OpenAI)
  8. Prepare Claude request (if target = Claude)

- **OpenAI → Claude** (`openai-to-claude.js`):
  - Convert `messages` array to Claude format
  - Extract `system` messages into separate `system` field
  - Merge consecutive same-role messages
  - Separate `tool_result` into dedicated user messages
  - Convert `tool_calls` to `tool_use` blocks
  - Convert `tool` role messages to `tool_result` blocks
  - Add `cache_control` to last assistant message
  - Convert `response_format` to system prompt instructions
  - Add Claude Code system prompt
  - Convert tools from OpenAI `function` format to Claude `input_schema` format
  - Apply tool name prefix for OAuth (currently empty string)
  - Convert `tool_choice`

- **OpenAI → Gemini** (`openai-to-gemini.js`):
  - Convert `messages` to `contents` array
  - Extract `system` message into `systemInstruction`
  - Map roles: `user`/`system` → `user`, `assistant` → `model`
  - Convert message content to `parts` array
  - Handle `reasoning_content` as `thought` parts
  - Convert `tool_calls` to `functionCall` parts
  - Convert `tool` messages to `functionResponse` parts
  - Build tool_call_id → name mapping
  - Convert tools to `functionDeclarations`
  - Sanitize function names (Gemini requirements)
  - Map generation config: `temperature`, `top_p` → `topP`, `top_k` → `topK`, `max_tokens` → `maxOutputTokens`
  - Add default `safetySettings`

- **Claude → OpenAI** (`claude-to-openai.js`):
  - Stream chunk transformation
  - Handle events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`
  - Convert `text` blocks to OpenAI `content` deltas
  - Convert `thinking` blocks to `<think>...</think>` wrapped content
  - Convert `tool_use` blocks to OpenAI `tool_calls`
  - Restore original tool names from mapping
  - Track tool call indices
  - Handle `input_json_delta` for streaming tool arguments
  - Skip `server_tool_use` blocks (built-in tools)
  - Accumulate usage data

- **Gemini → OpenAI** (`gemini-to-openai.js`):
  - Stream chunk transformation
  - Parse SSE format with `data:` prefix
  - Handle `candidates[0].content.parts` array
  - Convert `text` parts to OpenAI content deltas
  - Convert `thought` parts to `<think>` wrapped reasoning
  - Convert `functionCall` parts to OpenAI tool_calls
  - Handle `finishReason` mapping
  - Accumulate usage from `usageMetadata`

## File structure mapping

### New Go translate package

- `go-proxy/internal/translate/formats.go`
  - Format constants (OpenAI, Claude, Gemini, etc.)
- `go-proxy/internal/translate/detect.go`
  - `DetectFormat(body map[string]any) string`
- `go-proxy/internal/translate/request.go`
  - `TranslateRequest(sourceFormat, targetFormat string, body map[string]any, opts TranslateOptions) (map[string]any, error)`
  - `TranslateOptions` struct
- `go-proxy/internal/translate/response.go`
  - `TranslateResponse(targetFormat, sourceFormat string, body map[string]any) (map[string]any, error)`
- `go-proxy/internal/translate/stream.go`
  - `TranslateStreamChunk(targetFormat, sourceFormat string, chunk []byte, state *StreamState) ([]byte, error)`
  - `StreamState` struct for tracking stream context
- `go-proxy/internal/translate/openai_claude.go`
  - `OpenAIToClaudeRequest(model string, body map[string]any, stream bool) (map[string]any, error)`
- `go-proxy/internal/translate/openai_gemini.go`
  - `OpenAIToGeminiRequest(model string, body map[string]any, stream bool) (map[string]any, error)`
- `go-proxy/internal/translate/claude_openai.go`
  - `ClaudeToOpenAIChunk(chunk []byte, state *StreamState) ([]byte, error)`
- `go-proxy/internal/translate/gemini_openai.go`
  - `GeminiToOpenAIChunk(chunk []byte, state *StreamState) ([]byte, error)`
- Test files: `*_test.go` for each package file
- `go-proxy/internal/testdata/translate/*.json` for fixtures

## Data model to implement

### `internal/translate`

```go
// Format constants
const (
	FormatOpenAI    = "openai"
	FormatClaude    = "claude"
	FormatGemini    = "gemini"
	FormatAntigravity = "antigravity"
	FormatGeminiCLI = "gemini-cli"
)

// TranslateOptions holds translation configuration
type TranslateOptions struct {
	Model       string
	Stream      bool
	StripList   []string // Content types to strip: "image", "audio"
	Provider    string
	Credentials map[string]any
}

// StreamState tracks streaming translation context
type StreamState struct {
	MessageID         string
	Model             string
	ToolCallIndex     int
	ToolCalls         map[int]*ToolCall
	ToolNameMap       map[string]string // Prefixed → original
	InThinkingBlock   bool
	CurrentBlockIndex int
	ServerToolBlockIndex int
	TextBlockStarted  bool
	UsageData         *UsageData
}

// ToolCall represents an OpenAI tool call
type ToolCall struct {
	Index    int
	ID       string
	Type     string
	Function *FunctionCall
}

// FunctionCall represents a function call
type FunctionCall struct {
	Name      string
	Arguments string
}

// UsageData tracks token usage
type UsageData struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}
```

## Implementation sequence


### Task 1 — Create format constants and detection logic

#### Goal
Implement format detection that matches JS `detectFormat` behavior exactly, enabling the translation layer to identify incoming request formats.

#### Files

- add `go-proxy/internal/translate/formats.go`
- add `go-proxy/internal/translate/detect.go`
- add `go-proxy/internal/translate/detect_test.go`

#### Implementation steps

1. Define format constants in `formats.go`
2. Implement `DetectFormat(body map[string]any) string` in `detect.go`
3. Write table-driven tests covering all detection cases

#### Test requirements

```go
func TestDetectFormat_OpenAIResponses(t *testing.T) {
	body := map[string]any{
		"input": []any{"Hello"},
	}
	got := DetectFormat(body)
	if got != FormatOpenAIResponses {
		t.Fatalf("expected openai-responses, got %q", got)
	}
}

func TestDetectFormat_Antigravity(t *testing.T) {
	body := map[string]any{
		"request": map[string]any{
			"contents": []any{},
		},
		"userAgent": "antigravity",
	}
	got := DetectFormat(body)
	if got != FormatAntigravity {
		t.Fatalf("expected antigravity, got %q", got)
	}
}

func TestDetectFormat_Gemini(t *testing.any{
	body := map[string]any{
		"contents": []any{
			map[string]any{"role": "user", "parts": []any{}},
		},
	}
	got := DetectFormat(body)
	if got != FormatGemini {
		t.Fatalf("expected gemini, got %q", got)
	}
}

func TestDetectFormat_OpenAISpecificFields(t *testing.T) {
	cases := []string{"stream_options", "response_format", "logprobs", "n", "presence_penalty", "frequency_penalty", "logit_bias", "user"}
	for _, field := range cases {
		body := map[string]any{
			"messages": []any{},
			field:      "value",
		}
		got := DetectFormat(body)
		if got != FormatOpenAI {
			t.Fatalf("field %s: expected openai, got %q", field, got)
		}
	}
}

func TestDetectFormat_ClaudeArrayContent(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": "hello"},
				},
			},
		},
	}
	got := DetectFormat(body)
	if got != FormatClaude {
		t.Fatalf("expected claude, got %q", got)
	}
}

func TestDetectFormat_ClaudeSystemField(t *testing.T) {
	body := map[string]any{
		"messages": []any{},
		"system":   "You are helpful",
	}
	got := DetectFormat(body)
	if got != FormatClaude {
		t.Fatalf("expected claude, got %q", got)
	}
}

func TestDetectFormat_DefaultOpenAI(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "hello"},
		},
	}
	got := DetectFormat(body)
	if got != FormatOpenAI {
		t.Fatalf("expected openai, got %q", got)
	}
}
```

#### Commands

Run from `/workspaces/9router/go-proxy`.

```bash
go test ./internal/translate -run 'TestDetectFormat' -count=1 -v
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/translate [setup failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/translate/formats.go go-proxy/internal/translate/detect.go go-proxy/internal/translate/detect_test.go && git commit -m "add go proxy format detection parity"
```

---

### Task 2 — Implement OpenAI → Claude request translator

#### Goal
Convert OpenAI chat completion requests to Anthropic Claude messages format, preserving all message content, tools, and configuration.

#### Files

- add `go-proxy/internal/translate/openai_claude.go`
- add `go-proxy/internal/translate/openai_claude_test.go`
- add `go-proxy/internal/testdata/translate/openai_claude_basic.json`

#### Implementation steps

1. Implement `OpenAIToClaudeRequest(model string, body map[string]any, stream bool) (map[string]any, error)`
2. Extract system messages into `system` field
3. Convert messages array with role mapping and content block transformation
4. Merge consecutive same-role messages
5. Separate tool_result messages
6. Convert tools from OpenAI to Claude format
7. Add cache_control markers
8. Handle response_format → system prompt conversion

#### Test requirements

```go
func TestOpenAIToClaude_BasicMessage(t *testing.T) {
	body := map[string]any{
		"model": "claude-sonnet-4",
		"messages": []any{
			map[string]any{"role": "system", "content": "You are helpful"},
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	got, err := OpenAIToClaudeRequest("claude-sonnet-4", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Check system field
	system, ok := got["system"].([]any)
	if !ok || len(system) == 0 {
		t.Fatalf("expected system array, got %#v", got["system"])
	}
	
	// Check messages
	messages, ok := got["messages"].([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("expected 1 message, got %#v", got["messages"])
	}
	
	msg := messages[0].(map[string]any)
	if msg["role"] != "user" {
		t.Fatalf("expected user role, got %#v", msg["role"])
	}
}

func TestOpenAIToClaude_ToolCalls(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{
				"role": "assistant",
				"tool_calls": []any{
					map[string]any{
						"id":   "call_123",
						"type": "function",
						"function": map[string]any{
							"name":      "get_weather",
							"arguments": `{"city":"SF"}`,
						},
					},
				},
			},
			map[string]any{
				"role":         "tool",
				"tool_call_id": "call_123",
				"content":      "Sunny, 72F",
			},
		},
	}
	got, err := OpenAIToClaudeRequest("claude-sonnet-4", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	messages := got["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages (assistant + tool_result), got %d", len(messages))
	}
	
	// Check assistant message has tool_use
	assistantMsg := messages[0].(map[string]any)
	content := assistantMsg["content"].([]any)
	toolUse := content[0].(map[string]any)
	if toolUse["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %#v", toolUse)
	}
	
	// Check tool_result message
	toolMsg := messages[1].(map[string]any)
	if toolMsg["role"] != "user" {
		t.Fatalf("expected user role for tool_result, got %#v", toolMsg["role"])
	}
}

func TestOpenAIToClaude_Tools(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "What's the weather?"},
		},
		"tools": []any{
			map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        "get_weather",
					"description": "Get weather for a city",
					"parameters": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"city": map[string]any{"type": "string"},
						},
						"required": []any{"city"},
					},
				},
			},
		},
	}
	got, err := OpenAIToClaudeRequest("claude-sonnet-4", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	tools := got["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
	
	tool := tools[0].(map[string]any)
	if tool["name"] != "get_weather" {
		t.Fatalf("expected get_weather, got %#v", tool["name"])
	}
	if _, ok := tool["input_schema"]; !ok {
		t.Fatalf("expected input_schema field")
	}
}

func TestOpenAIToClaude_ResponseFormat(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Give me JSON"},
		},
		"response_format": map[string]any{
			"type": "json_object",
		},
	}
	got, err := OpenAIToClaudeRequest("claude-sonnet-4", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	system := got["system"].([]any)
	// Should have Claude Code prompt + JSON instruction
	if len(system) < 2 {
		t.Fatalf("expected system prompts for JSON mode, got %d", len(system))
	}
	
	// Check last system block contains JSON instruction
	lastBlock := system[len(system)-1].(map[string]any)
	text := lastBlock["text"].(string)
	if !strings.Contains(text, "JSON") {
		t.Fatalf("expected JSON instruction in system, got %q", text)
	}
}
```

#### Commands

```bash
go test ./internal/translate -run 'TestOpenAIToClaude' -count=1 -v
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/translate [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/translate/openai_claude.go go-proxy/internal/translate/openai_claude_test.go go-proxy/internal/testdata/translate/*.json && git commit -m "add go proxy openai to claude request translator"
```

---

### Task 3 — Implement OpenAI → Gemini request translator

#### Goal
Convert OpenAI chat completion requests to Google Gemini format, handling content parts, tools, and generation config.

#### Files

- add `go-proxy/internal/translate/openai_gemini.go`
- add `go-proxy/internal/translate/openai_gemini_test.go`
- add `go-proxy/internal/testdata/translate/openai_gemini_basic.json`

#### Implementation steps

1. Implement `OpenAIToGeminiRequest(model string, body map[string]any, stream bool) (map[string]any, error)`
2. Convert messages to contents array with role mapping (user/system → user, assistant → model)
3. Extract system message into systemInstruction
4. Convert message content to parts array
5. Handle tool_calls → functionCall conversion
6. Handle tool messages → functionResponse conversion
7. Build tool_call_id → name mapping
8. Convert tools to functionDeclarations
9. Sanitize function names per Gemini requirements
10. Map generation config fields
11. Add default safety settings

#### Test requirements

```go
func TestOpenAIToGemini_BasicMessage(t *testing.T) {
	body := map[string]any{
		"model": "gemini-2.5-pro",
		"messages": []any{
			map[string]any{"role": "system", "content": "You are helpful"},
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	got, err := OpenAIToGeminiRequest("gemini-2.5-pro", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Check systemInstruction
	if _, ok := got["systemInstruction"]; !ok {
		t.Fatalf("expected systemInstruction field")
	}
	
	// Check contents
	contents, ok := got["contents"].([]any)
	if !ok || len(contents) != 1 {
		t.Fatalf("expected 1 content, got %#v", got["contents"])
	}
	
	content := contents[0].(map[string]any)
	if content["role"] != "user" {
		t.Fatalf("expected user role, got %#v", content["role"])
	}
}

func TestOpenAIToGemini_GenerationConfig(t *testing.T) {
	body := map[string]any{
		"messages":    []any{map[string]any{"role": "user", "content": "Hi"}},
		"temperature": 0.7,
		"top_p":       0.9,
		"top_k":       40,
		"max_tokens":  1024,
	}
	got, err := OpenAIToGeminiRequest("gemini-2.5-pro", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	config := got["generationConfig"].(map[string]any)
	if config["temperature"] != 0.7 {
		t.Fatalf("expected temperature 0.7, got %#v", config["temperature"])
	}
	if config["topP"] != 0.9 {
		t.Fatalf("expected topP 0.9, got %#v", config["topP"])
	}
	if config["topK"] != 40 {
		t.Fatalf("expected topK 40, got %#v", config["topK"])
	}
	if config["maxOutputTokens"] != 1024 {
		t.Fatalf("expected maxOutputTokens 1024, got %#v", config["maxOutputTokens"])
	}
}

func TestOpenAIToGemini_ToolCalls(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{
				"role": "assistant",
				"tool_calls": []any{
					map[string]any{
						"id":   "call_123",
						"type": "function",
						"function": map[string]any{
							"name":      "get_weather",
							"arguments": `{"city":"SF"}`,
						},
					},
				},
			},
			map[string]any{
				"role":         "tool",
				"tool_call_id": "call_123",
				"content":      `{"temp":72}`,
			},
		},
	}
	got, err := OpenAIToGeminiRequest("gemini-2.5-pro", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	contents := got["contents"].([]any)
	if len(contents) != 2 {
		t.Fatalf("expected 2 contents (model + user), got %d", len(contents))
	}
	
	// Check model message has functionCall
	modelContent := contents[0].(map[string]any)
	if modelContent["role"] != "model" {
		t.Fatalf("expected model role, got %#v", modelContent["role"])
	}
	parts := modelContent["parts"].([]any)
	part := parts[0].(map[string]any)
	if _, ok := part["functionCall"]; !ok {
		t.Fatalf("expected functionCall in parts")
	}
	
	// Check user message has functionResponse
	userContent := contents[1].(map[string]any)
	if userContent["role"] != "user" {
		t.Fatalf("expected user role, got %#v", userContent["role"])
	}
}

func TestOpenAIToGemini_Tools(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Weather?"},
		},
		"tools": []any{
			map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        "get-weather",
					"description": "Get weather",
					"parameters": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"city": map[string]any{"type": "string"},
						},
					},
				},
			},
		},
	}
	got, err := OpenAIToGeminiRequest("gemini-2.5-pro", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	tools := got["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
	
	tool := tools[0].(map[string]any)
	declarations := tool["functionDeclarations"].([]any)
	if len(declarations) != 1 {
		t.Fatalf("expected 1 declaration, got %d", len(declarations))
	}
	
	decl := declarations[0].(map[string]any)
	// Check name is sanitized (- replaced with _)
	if decl["name"] != "get_weather" {
		t.Fatalf("expected sanitized name get_weather, got %#v", decl["name"])
	}
}

func TestOpenAIToGemini_SafetySettings(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hi"},
		},
	}
	got, err := OpenAIToGeminiRequest("gemini-2.5-pro", body, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	if _, ok := got["safetySettings"]; !ok {
		t.Fatalf("expected safetySettings field")
	}
}
```

#### Commands

```bash
go test ./internal/translate -run 'TestOpenAIToGemini' -count=1 -v
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/translate [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/translate/openai_gemini.go go-proxy/internal/translate/openai_gemini_test.go go-proxy/internal/testdata/translate/*.json && git commit -m "add go proxy openai to gemini request translator"
```

---

### Task 4 — Implement Claude → OpenAI streaming response translator

#### Goal
Convert Claude SSE streaming chunks to OpenAI chat completion chunk format, handling text deltas, thinking blocks, and tool calls.

#### Files

- add `go-proxy/internal/translate/stream.go`
- add `go-proxy/internal/translate/claude_openai.go`
- add `go-proxy/internal/translate/claude_openai_test.go`

#### Implementation steps

1. Define `StreamState` struct in `stream.go`
2. Implement `ClaudeToOpenAIChunk(chunk []byte, state *StreamState) ([]byte, error)` in `claude_openai.go`
3. Handle Claude event types: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`
4. Convert text deltas to OpenAI content format
5. Convert thinking blocks to `<think>...</think>` wrapped content
6. Convert tool_use blocks to OpenAI tool_calls format
7. Track tool call indices and accumulate arguments
8. Skip server_tool_use blocks
9. Accumulate usage data

#### Test requirements

```go
func TestClaudeToOpenAI_MessageStart(t *testing.T) {
	chunk := []byte(`{"type":"message_start","message":{"id":"msg_123","model":"claude-sonnet-4"}}`)
	state := &StreamState{}
	
	got, err := ClaudeToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	if state.MessageID != "msg_123" {
		t.Fatalf("expected message ID msg_123, got %q", state.MessageID)
	}
	
	// Should output role delta
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	if delta["role"] != "assistant" {
		t.Fatalf("expected assistant role, got %#v", delta["role"])
	}
}

func TestClaudeToOpenAI_TextDelta(t *testing.T) {
	state := &StreamState{MessageID: "msg_123", Model: "claude-sonnet-4"}
	chunk := []byte(`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`)
	
	got, err := ClaudeToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	if delta["content"] != "Hello" {
		t.Fatalf("expected content Hello, got %#v", delta["content"])
	}
}

func TestClaudeToOpenAI_ThinkingBlock(t *testing.T) {
	state := &StreamState{MessageID: "msg_123", Model: "claude-sonnet-4"}
	
	// Start thinking block
	startChunk := []byte(`{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}`)
	got, err := ClaudeToOpenAIChunk(startChunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Should output <think>
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	if delta["content"] != "<think>" {
		t.Fatalf("expected <think>, got %#v", delta["content"])
	}
	
	// Thinking delta
	deltaChunk := []byte(`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"reasoning..."}}`)
	got, err = ClaudeToOpenAIChunk(deltaChunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	json.Unmarshal(got, &result)
	choices = result["choices"].([]any)
	delta = choices[0].(map[string]any)["delta"].(map[string]any)
	if delta["reasoning_content"] != "reasoning..." {
		t.Fatalf("expected reasoning_content, got %#v", delta)
	}
	
	// Stop thinking block
	stopChunk := []byte(`{"type":"content_block_stop","index":0}`)
	got, err = ClaudeToOpenAIChunk(stopChunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	json.Unmarshal(got, &result)
	choices = result["choices"].([]any)
	delta = choices[0].(map[string]any)["delta"].(map[string]any)
	if delta["content"] != "</think>" {
		t.Fatalf("expected </think>, got %#v", delta["content"])
	}
}

func TestClaudeToOpenAI_ToolCall(t *testing.T) {
	state := &StreamState{
		MessageID: "msg_123",
		Model:     "claude-sonnet-4",
		ToolCalls: make(map[int]*ToolCall),
	}
	
	// Start tool_use block
	startChunk := []byte(`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_123","name":"get_weather"}}`)
	got, err := ClaudeToOpenAIChunk(startChunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	toolCalls := delta["tool_calls"].([]any)
	toolCall := toolCalls[0].(map[string]any)
	if toolCall["id"] != "call_123" {
		t.Fatalf("expected call_123, got %#v", toolCall["id"])
	}
	if toolCall["function"].(map[string]any)["name"] != "get_weather" {
		t.Fatalf("expected get_weather, got %#v", toolCall["function"])
	}
	
	// Tool arguments delta
	deltaChunk := []byte(`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"city\":"}}`)
	got, err = ClaudeToOpenAIChunk(deltaChunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	json.Unmarshal(got, &result)
	choices = result["choices"].([]any)
	delta = choices[0].(map[string]any)["delta"].(map[string]any)
	toolCalls = delta["tool_calls"].([]any)
	toolCall = toolCalls[0].(map[string]any)
	fn := toolCall["function"].(map[string]any)
	if fn["arguments"] != "{\"city\":" {
		t.Fatalf("expected partial args, got %#v", fn["arguments"])
	}
}

func TestClaudeToOpenAI_MessageStop(t *testing.T) {
	state := &StreamState{MessageID: "msg_123", Model: "claude-sonnet-4"}
	chunk := []byte(`{"type":"message_stop"}`)
	
	got, err := ClaudeToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	finishReason := choices[0].(map[string]any)["finish_reason"]
	if finishReason != "stop" {
		t.Fatalf("expected stop finish_reason, got %#v", finishReason)
	}
}
```

#### Commands

```bash
go test ./internal/translate -run 'TestClaudeToOpenAI' -count=1 -v
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/translate [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/translate/stream.go go-proxy/internal/translate/claude_openai.go go-proxy/internal/translate/claude_openai_test.go && git commit -m "add go proxy claude to openai streaming translator"
```

---

### Task 5 — Implement Gemini → OpenAI streaming response translator

#### Goal
Convert Gemini SSE streaming chunks to OpenAI chat completion chunk format, handling text parts, thought parts, and function calls.

#### Files

- add `go-proxy/internal/translate/gemini_openai.go`
- add `go-proxy/internal/translate/gemini_openai_test.go`

#### Implementation steps

1. Implement `GeminiToOpenAIChunk(chunk []byte, state *StreamState) ([]byte, error)` in `gemini_openai.go`
2. Parse SSE format with `data:` prefix
3. Handle `candidates[0].content.parts` array
4. Convert text parts to OpenAI content deltas
5. Convert thought parts to `<think>` wrapped reasoning
6. Convert functionCall parts to OpenAI tool_calls
7. Map finishReason values
8. Accumulate usage from usageMetadata

#### Test requirements

```go
func TestGeminiToOpenAI_TextPart(t *testing.T) {
	state := &StreamState{MessageID: "msg_123", Model: "gemini-2.5-pro"}
	chunk := []byte(`data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}`)
	
	got, err := GeminiToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	if delta["content"] != "Hello" {
		t.Fatalf("expected content Hello, got %#v", delta["content"])
	}
}

func TestGeminiToOpenAI_ThoughtPart(t *testing.T) {
	state := &StreamState{MessageID: "msg_123", Model: "gemini-2.5-pro"}
	chunk := []byte(`data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking..."}]}}]}`)
	
	got, err := GeminiToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	
	// Should wrap in <think> tags
	content := delta["content"].(string)
	if !strings.Contains(content, "<think>") || !strings.Contains(content, "thinking...") {
		t.Fatalf("expected wrapped thinking, got %q", content)
	}
}

func TestGeminiToOpenAI_FunctionCall(t *testing.T) {
	state := &StreamState{
		MessageID: "msg_123",
		Model:     "gemini-2.5-pro",
		ToolCalls: make(map[int]*ToolCall),
	}
	chunk := []byte(`data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"call_123","name":"get_weather","args":{"city":"SF"}}}]}}]}`)
	
	got, err := GeminiToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	toolCalls := delta["tool_calls"].([]any)
	toolCall := toolCalls[0].(map[string]any)
	
	if toolCall["id"] != "call_123" {
		t.Fatalf("expected call_123, got %#v", toolCall["id"])
	}
	fn := toolCall["function"].(map[string]any)
	if fn["name"] != "get_weather" {
		t.Fatalf("expected get_weather, got %#v", fn["name"])
	}
	// Args should be JSON string
	args := fn["arguments"].(string)
	if !strings.Contains(args, "SF") {
		t.Fatalf("expected SF in args, got %q", args)
	}
}

func TestGeminiToOpenAI_FinishReason(t *testing.T) {
	state := &StreamState{MessageID: "msg_123", Model: "gemini-2.5-pro"}
	chunk := []byte(`data: {"candidates":[{"finishReason":"STOP"}]}`)
	
	got, err := GeminiToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	var result map[string]any
	json.Unmarshal(got, &result)
	choices := result["choices"].([]any)
	finishReason := choices[0].(map[string]any)["finish_reason"]
	if finishReason != "stop" {
		t.Fatalf("expected stop, got %#v", finishReason)
	}
}

func TestGeminiToOpenAI_UsageMetadata(t *testing.T) {
	state := &StreamState{MessageID: "msg_123", Model: "gemini-2.5-pro"}
	chunk := []byte(`data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":20,"totalTokenCount":30}}`)
	
	got, err := GeminiToOpenAIChunk(chunk, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	if state.UsageData == nil {
		t.Fatalf("expected usage data to be set")
	}
	if state.UsageData.PromptTokens != 10 {
		t.Fatalf("expected 10 prompt tokens, got %d", state.UsageData.PromptTokens)
	}
	if state.UsageData.CompletionTokens != 20 {
		t.Fatalf("expected 20 completion tokens, got %d", state.UsageData.CompletionTokens)
	}
}
```

#### Commands

```bash
go test ./internal/translate -run 'TestGeminiToOpenAI' -count=1 -v
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/translate [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/translate/gemini_openai.go go-proxy/internal/translate/gemini_openai_test.go && git commit -m "add go proxy gemini to openai streaming translator"
```

---

### Task 6 — Implement high-level translation orchestration

#### Goal
Create the main translation entry points that orchestrate format detection and translator selection, matching the JS `translateRequest` pipeline.

#### Files

- add `go-proxy/internal/translate/request.go`
- add `go-proxy/internal/translate/request_test.go`

#### Implementation steps

1. Implement `TranslateRequest(sourceFormat, targetFormat string, body map[string]any, opts TranslateOptions) (map[string]any, error)`
2. Handle same-format passthrough
3. Implement source → OpenAI → target pipeline
4. Add content stripping logic (opt-in via StripList)
5. Add tool call ID normalization
6. Add missing tool response insertion

#### Test requirements

```go
func TestTranslateRequest_SameFormat(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	opts := TranslateOptions{Model: "gpt-4", Stream: true}
	
	got, err := TranslateRequest(FormatOpenAI, FormatOpenAI, body, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Should be unchanged
	if !reflect.DeepEqual(got, body) {
		t.Fatalf("expected unchanged body for same format")
	}
}

func TestTranslateRequest_OpenAIToClaude(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	opts := TranslateOptions{Model: "claude-sonnet-4", Stream: true}
	
	got, err := TranslateRequest(FormatOpenAI, FormatClaude, body, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Should have Claude format
	if _, ok := got["system"]; !ok {
		t.Fatalf("expected system field in Claude format")
	}
	if got["model"] != "claude-sonnet-4" {
		t.Fatalf("expected model to be set")
	}
}

func TestTranslateRequest_ClaudeToOpenAI(t *testing.T) {
	body := map[string]any{
		"model": "claude-sonnet-4",
		"messages": []any{
			map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": "Hello"},
				},
			},
		},
		"system": "You are helpful",
	}
	opts := TranslateOptions{Model: "gpt-4", Stream: true}
	
	got, err := TranslateRequest(FormatClaude, FormatOpenAI, body, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Should have OpenAI format
	messages := got["messages"].([]any)
	if len(messages) < 2 {
		t.Fatalf("expected system + user messages")
	}
	
	// First message should be system
	firstMsg := messages[0].(map[string]any)
	if firstMsg["role"] != "system" {
		t.Fatalf("expected system message first")
	}
}

func TestTranslateRequest_OpenAIToGemini(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	opts := TranslateOptions{Model: "gemini-2.5-pro", Stream: true}
	
	got, err := TranslateRequest(FormatOpenAI, FormatGemini, body, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Should have Gemini format
	if _, ok := got["contents"]; !ok {
		t.Fatalf("expected contents field in Gemini format")
	}
	if _, ok := got["safetySettings"]; !ok {
		t.Fatalf("expected safetySettings in Gemini format")
	}
}

func TestTranslateRequest_StripImages(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": "Hello"},
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,abc"}},
				},
			},
		},
	}
	opts := TranslateOptions{
		Model:     "gpt-4",
		Stream:    true,
		StripList: []string{"image"},
	}
	
	got, err := TranslateRequest(FormatOpenAI, FormatOpenAI, body, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	messages := got["messages"].([]any)
	msg := messages[0].(map[string]any)
	content := msg["content"].([]any)
	
	// Should only have text part
	if len(content) != 1 {
		t.Fatalf("expected 1 content part after stripping, got %d", len(content))
	}
	if content[0].(map[string]any)["type"] != "text" {
		t.Fatalf("expected text part to remain")
	}
}
```

#### Commands

```bash
go test ./internal/translate -run 'TestTranslateRequest' -count=1 -v
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/translate [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/translate/request.go go-proxy/internal/translate/request_test.go && git commit -m "add go proxy translation orchestration"
```

---

### Task 7 — Add cross-package parity tests

#### Goal
Create package-level parity tests that assert the Go implementation matches JS behavior for representative end-to-end translation scenarios.

#### Files

- add `go-proxy/internal/translate/parity_test.go`
- add `go-proxy/internal/testdata/translate/parity_*.json`

#### Implementation steps

1. Create fixtures with real-world request/response examples
2. Write tests that compare Go output to expected JS output
3. Cover all major translation paths
4. Include edge cases (empty messages, complex tools, multimodal content)

#### Test requirements

```go
func TestParity_OpenAIToClaudeBasic(t *testing.T) {
	// Load fixture
	fixture := loadFixture(t, "parity_openai_claude_basic.json")
	input := fixture["input"].(map[string]any)
	expected := fixture["expected"].(map[string]any)
	
	got, err := TranslateRequest(FormatOpenAI, FormatClaude, input, TranslateOptions{
		Model:  "claude-sonnet-4",
		Stream: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	// Compare key fields
	assertEqualJSON(t, expected["system"], got["system"])
	assertEqualJSON(t, expected["messages"], got["messages"])
	assertEqualJSON(t, expected["tools"], got["tools"])
}

func TestParity_OpenAIToGeminiWithTools(t *testing.T) {
	fixture := loadFixture(t, "parity_openai_gemini_tools.json")
	input := fixture["input"].(map[string]any)
	expected := fixture["expected"].(map[string]any)
	
	got, err := TranslateRequest(FormatOpenAI, FormatGemini, input, TranslateOptions{
		Model:  "gemini-2.5-pro",
		Stream: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	assertEqualJSON(t, expected["contents"], got["contents"])
	assertEqualJSON(t, expected["tools"], got["tools"])
}

func TestParity_ClaudeStreamingToOpenAI(t *testing.T) {
	fixture := loadFixture(t, "parity_claude_stream.json")
	chunks := fixture["chunks"].([]any)
	expectedOutputs := fixture["expected"].([]any)
	
	state := &StreamState{
		ToolCalls: make(map[int]*ToolCall),
	}
	
	for i, chunkData := range chunks {
		chunkBytes, _ := json.Marshal(chunkData)
		got, err := ClaudeToOpenAIChunk(chunkBytes, state)
		if err != nil {
			t.Fatalf("chunk %d: unexpected error: %v", i, err)
		}
		
		var gotParsed map[string]any
		json.Unmarshal(got, &gotParsed)
		
		expected := expectedOutputs[i].(map[string]any)
		assertEqualJSON(t, expected, gotParsed)
	}
}

func TestParity_GeminiStreamingToOpenAI(t *testing.T) {
	fixture := loadFixture(t, "parity_gemini_stream.json")
	chunks := fixture["chunks"].([]any)
	expectedOutputs := fixture["expected"].([]any)
	
	state := &StreamState{
		MessageID: "msg_test",
		Model:     "gemini-2.5-pro",
		ToolCalls: make(map[int]*ToolCall),
	}
	
	for i, chunkData := range chunks {
		chunkStr := fmt.Sprintf("data: %s", chunkData)
		got, err := GeminiToOpenAIChunk([]byte(chunkStr), state)
		if err != nil {
			t.Fatalf("chunk %d: unexpected error: %v", i, err)
		}
		
		var gotParsed map[string]any
		json.Unmarshal(got, &gotParsed)
		
		expected := expectedOutputs[i].(map[string]any)
		assertEqualJSON(t, expected, gotParsed)
	}
}
```

#### Commands

```bash
go test ./internal/translate -run 'TestParity' -count=1 -v
```

Expected output before implementation:

```text
FAIL	go-proxy/internal/translate [build failed]
```

Expected output after implementation:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

#### Commit

```bash
git add go-proxy/internal/translate/parity_test.go go-proxy/internal/testdata/translate/parity_*.json && git commit -m "add go proxy phase2 translation parity tests"
```

---

### Task 8 — Final Phase 2 verification

#### Goal
Run full test suite and verify all translation behavior is working correctly.

#### Commands

Run the full package test set for the new scope:

```bash
go test ./internal/translate -count=1 -v
```

Expected output:

```text
ok  	go-proxy/internal/translate	0.xxxs
```

Optional broader confidence check:

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
ok  	go-proxy/internal/translate	0.xxxs
```

#### Final commit

```bash
git add docs/superpowers/plans/2026-04-23-go-proxy-phase2-translation.md && git commit -m "add phase2 go proxy translation layer plan"
```

## Notes for the implementing agent

- Keep `internal/http/routes.go` untouched in this phase; the goal is to land isolated, well-tested translation primitives.
- Use `map[string]any` for JSON-like structures to match dynamic JS behavior.
- Preserve exact JS transformation logic even if it seems awkward; parity first, optimization later.
- Handle JSON parsing/marshaling errors gracefully with clear error messages.
- Use table-driven tests wherever multiple providers share similar behavior.
- Do not add placeholders such as `TODO`, `TBD`, or empty implementations.
- Every task above ends in a commit on purpose; do not batch multiple tasks into one commit.
- For streaming, maintain state across chunks carefully - tool calls accumulate, thinking blocks track indices.
- Test with real-world fixtures copied from JS test cases where possible.
- SSE parsing must handle `data:` prefix and empty lines correctly.
- Tool name sanitization for Gemini must follow exact regex rules from JS.
- Cache control markers in Claude format must be placed correctly (last assistant message, last tool).

## Success criteria

- All format detection cases pass
- OpenAI ↔ Claude translation preserves message structure, tools, and system prompts
- OpenAI ↔ Gemini translation preserves content parts, tools, and generation config
- Streaming translation handles all event types correctly
- Tool calls stream with proper index tracking
- Thinking blocks wrap correctly with `<think>` tags
- Usage data accumulates properly
- Parity tests confirm JS behavior match
- No hardcoded test data - all fixtures are realistic examples
- Zero test failures across the package
