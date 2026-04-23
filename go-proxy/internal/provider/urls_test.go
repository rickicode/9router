package provider

import "testing"

func TestBuildURL_OpenAICompatibleChat(t *testing.T) {
	got, err := BuildURL("openai-compatible-local", "gpt-4.1", true, BuildOptions{BaseURL: "https://example.com/v1/"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got != "https://example.com/v1/chat/completions" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_OpenAICompatibleResponses(t *testing.T) {
	got, err := BuildURL("openai-compatible-responses-local", "gpt-4.1", true, BuildOptions{BaseURL: "https://example.com/v1/"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got != "https://example.com/v1/responses" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_AnthropicCompatible(t *testing.T) {
	got, err := BuildURL("anthropic-compatible-local", "claude-sonnet-4", true, BuildOptions{BaseURL: "https://anthropic.example/v1/"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got != "https://anthropic.example/v1/messages" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_GeminiStreamAndNonStream(t *testing.T) {
	streamURL, err := BuildURL("gemini", "gemini-2.5-pro", true, BuildOptions{})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if streamURL != "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse" {
		t.Fatalf("unexpected stream URL: %q", streamURL)
	}

	nonStreamURL, err := BuildURL("gemini", "gemini-2.5-pro", false, BuildOptions{})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if nonStreamURL != "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent" {
		t.Fatalf("unexpected non-stream URL: %q", nonStreamURL)
	}
}

func TestBuildURL_AntigravityIndexedBaseURLs(t *testing.T) {
	got, err := BuildURL("antigravity", "", false, BuildOptions{BaseURLIndex: 1})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got != "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_QwenResourceURLNormalization(t *testing.T) {
	got, err := BuildURL("qwen", "", true, BuildOptions{QwenResourceURL: "https://custom.qwen.example/v1/chat/completions/"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got != "https://custom.qwen.example/v1/chat/completions" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_ClaudeCompatibleBetaQuerySuffix(t *testing.T) {
	providers := []string{"claude", "glm", "kimi", "minimax"}
	for _, provider := range providers {
		got, err := BuildURL(provider, "", true, BuildOptions{})
		if err != nil {
			t.Fatalf("provider %q: expected no error, got %v", provider, err)
		}
		if got[len(got)-10:] != "?beta=true" {
			t.Fatalf("provider %q: expected beta suffix, got %q", provider, got)
		}
	}
}

func TestBuildURL_UnknownProviderUsesExplicitBaseURL(t *testing.T) {
	got, err := BuildURL("unknown", "", true, BuildOptions{BaseURL: "https://fallback.example/path/"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got != "https://fallback.example/path" {
		t.Fatalf("unexpected URL: %q", got)
	}
}

func TestBuildURL_UnknownProviderWithoutBaseURLErrors(t *testing.T) {
	_, err := BuildURL("unknown", "", true, BuildOptions{})
	if err == nil {
		t.Fatal("expected error for unknown provider without base URL")
	}
}
