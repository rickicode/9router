package config

import (
	"os"
	"strconv"
	"strings"
)

// Config contains runtime settings for the Go proxy scaffold.
type Config struct {
	Host                     string
	Port                     int
	NineRouterBaseURL        string
	InternalResolveAuthToken string
	InternalReportAuthToken  string
	CredentialsFilePath      string
	HTTPTimeoutSeconds       int
}

// Default returns baseline config values for local development.
func Default() Config {
	host := strings.TrimSpace(os.Getenv("GO_PROXY_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}

	port := 8080
	if raw := strings.TrimSpace(os.Getenv("GO_PROXY_PORT")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			port = parsed
		}
	}

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("GO_PROXY_NINEROUTER_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:20128"
	}

	resolveToken := strings.TrimSpace(os.Getenv("INTERNAL_PROXY_RESOLVE_TOKEN"))
	reportToken := strings.TrimSpace(os.Getenv("INTERNAL_PROXY_REPORT_TOKEN"))
	if resolveToken == "" {
		resolveToken = reportToken
	}
	if reportToken == "" {
		reportToken = resolveToken
	}

	credentialsPath := strings.TrimSpace(os.Getenv("GO_PROXY_CREDENTIALS_FILE"))
	if credentialsPath == "" {
		if dataDir := strings.TrimSpace(os.Getenv("DATA_DIR")); dataDir != "" {
			credentialsPath = dataDir + "/db.json"
		}
	}
	if credentialsPath == "" {
		homeDir, err := os.UserHomeDir()
		if err == nil && strings.TrimSpace(homeDir) != "" {
			credentialsPath = homeDir + "/.9router/db.json"
		}
	}

	httpTimeoutSeconds := 30
	if raw := strings.TrimSpace(os.Getenv("GO_PROXY_HTTP_TIMEOUT_SECONDS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			httpTimeoutSeconds = parsed
		}
	}

	return Config{
		Host:                     host,
		Port:                     port,
		NineRouterBaseURL:        baseURL,
		InternalResolveAuthToken: resolveToken,
		InternalReportAuthToken:  reportToken,
		CredentialsFilePath:      credentialsPath,
		HTTPTimeoutSeconds:       httpTimeoutSeconds,
	}
}
