package translate

import (
	"reflect"
	"testing"
)

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

	messages := got["messages"].([]any)
	if len(messages) < 2 {
		t.Fatalf("expected system + user messages")
	}

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

	if len(content) != 1 {
		t.Fatalf("expected 1 content part after stripping, got %d", len(content))
	}
	if content[0].(map[string]any)["type"] != "text" {
		t.Fatalf("expected text part to remain")
	}
}

func TestTranslateRequest_RemovesMessagesWithOnlyStrippedContent(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,abc"}},
				},
			},
			map[string]any{"role": "user", "content": "keep me"},
		},
	}
	opts := TranslateOptions{Model: "gpt-4", Stream: true, StripList: []string{"image"}}

	got, err := TranslateRequest(FormatOpenAI, FormatOpenAI, body, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	messages := got["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("expected stripped-only message to be removed, got %d messages", len(messages))
	}
}
