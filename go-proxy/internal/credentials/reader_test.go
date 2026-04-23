package credentials

import (
	"path/filepath"
	"testing"
)

func TestReadByConnectionID_ApiKeyConnection(t *testing.T) {
	path := filepath.Join("..", "testdata", "credentials", "sample.json")

	reader := NewReader(path)
	cred, err := reader.ReadByConnectionID("conn-apikey-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if cred.ConnectionID != "conn-apikey-1" {
		t.Fatalf("expected connection id conn-apikey-1, got %q", cred.ConnectionID)
	}
	if cred.Provider != "openai" {
		t.Fatalf("expected provider openai, got %q", cred.Provider)
	}
	if cred.APIKey != "sk-test-openai" {
		t.Fatalf("expected api key sk-test-openai, got %q", cred.APIKey)
	}
}

func TestReadByConnectionID_OAuthConnection(t *testing.T) {
	path := filepath.Join("..", "testdata", "credentials", "sample.json")

	reader := NewReader(path)
	cred, err := reader.ReadByConnectionID("conn-oauth-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if cred.ConnectionID != "conn-oauth-1" {
		t.Fatalf("expected connection id conn-oauth-1, got %q", cred.ConnectionID)
	}
	if cred.Provider != "claude" {
		t.Fatalf("expected provider claude, got %q", cred.Provider)
	}
	if cred.AccessToken != "oauth-access-token" {
		t.Fatalf("expected access token oauth-access-token, got %q", cred.AccessToken)
	}
}
