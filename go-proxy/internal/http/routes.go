package http

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"os"
	"strings"
	"time"

	"go-proxy/internal/config"
	"go-proxy/internal/credentials"
	"go-proxy/internal/model"
	"go-proxy/internal/provider"
	"go-proxy/internal/proxy"
	"go-proxy/internal/report"
	"go-proxy/internal/resolve"
)

const (
	routeChatCompletions = "/v1/chat/completions"
	routeResponses       = "/v1/responses"
	routeMessages        = "/v1/messages"
	reportTimeout        = 3 * time.Second
)

var (
	clientErrorURLPattern    = regexp.MustCompile(`https?://[^\s"']+`)
	clientErrorIPPattern     = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	clientErrorBearerPattern = regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9._~+\-/=]+`)
	clientErrorSKPattern     = regexp.MustCompile(`\bsk-[A-Za-z0-9._\-]+\b`)
	allowedForwardHeaders    = map[string]struct{}{
		"accept":          {},
		"accept-encoding": {},
		"content-type":    {},
		"user-agent":      {},
	}
)

// NewRoutes returns the HTTP routes for the Go data-plane proxy.
func NewRoutes(cfg config.Config) http.Handler {
	mux := http.NewServeMux()

	resolverClient := resolve.HTTPClient{
		BaseURL:      cfg.NineRouterBaseURL,
		InternalAuth: cfg.InternalResolveAuthToken,
		HTTPClient: &http.Client{
			Timeout: time.Duration(cfg.HTTPTimeoutSeconds) * time.Second,
		},
	}

	reportClient := report.HTTPClient{
		BaseURL:      cfg.NineRouterBaseURL,
		InternalAuth: cfg.InternalReportAuthToken,
		HTTPClient: &http.Client{
			Timeout: time.Duration(cfg.HTTPTimeoutSeconds) * time.Second,
		},
	}

	credReader := credentials.NewReader(cfg.CredentialsFilePath)
	modelStore, _ := model.LoadStore(cfg.CredentialsFilePath)

	h := requestHandler{
		resolver:            resolverClient,
		reporter:            reportClient,
		credReader:          credReader,
		credentialsFilePath: cfg.CredentialsFilePath,
		modelStore:          modelStore,
		httpClient:          &http.Client{Timeout: time.Duration(cfg.HTTPTimeoutSeconds) * time.Second},
	}

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	mux.HandleFunc(routeChatCompletions, h.handleOpenAI)
	mux.HandleFunc(routeResponses, h.handleOpenAI)
	mux.HandleFunc(routeMessages, h.handleAnthropic)

	return mux
}

type requestHandler struct {
	resolver            resolve.Client
	reporter            report.Client
	credReader          *credentials.Reader
	credentialsFilePath string
	modelStore          *model.Store
	httpClient          *http.Client
}

func (h requestHandler) handleOpenAI(w http.ResponseWriter, r *http.Request) {
	h.handleProxy(w, r, "openai")
}

func (h requestHandler) handleAnthropic(w http.ResponseWriter, r *http.Request) {
	h.handleProxy(w, r, "anthropic")
}

func (h requestHandler) reportOutcome(payload report.OutcomePayload) {
	ctx, cancel := context.WithTimeout(context.Background(), reportTimeout)
	defer cancel()
	_ = h.reporter.ReportOutcome(ctx, payload)
}

func (h requestHandler) handleProxy(w http.ResponseWriter, r *http.Request, protocolFamily string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	requestID := generateRequestID()

	apiKey := readPublicAPIKey(r)
	if apiKey == "" {
		http.Error(w, "missing api key", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	model, stream := extractModelAndStream(body)
	if model == "" {
		http.Error(w, "missing model", http.StatusBadRequest)
		return
	}

	resolved, statusCode, err := h.resolveRequest(r.Context(), model, protocolFamily, r.URL.Path)
	if err != nil {
		http.Error(w, err.Error(), statusCode)
		return
	}

	result, usedConnectionID, err := h.forwardResolved(r, body, stream, apiKey, resolved, protocolFamily)
	if err != nil {
		normalized := proxy.NormalizeOutcome(result, err)
		usageEvidence, quotasEvidence := extractResponseEvidence(result)
		h.reportOutcome(report.OutcomePayload{
			RequestID:         requestID,
			Provider:          resolved.Provider,
			ConnectionID:      usedConnectionID,
			Model:             resolved.Model,
			ProtocolFamily:    protocolFamily,
			PublicPath:        r.URL.Path,
			Method:            r.Method,
			UpstreamStatus:    normalized.UpstreamStatus,
			LatencyMs:         0,
			Outcome:           string(normalized.Outcome),
			StreamInterrupted: normalized.StreamInterrupted,
			Usage:             usageEvidence,
			Quotas:            quotasEvidence,
			Error:             mapForwardError(normalized.Error),
		})
		http.Error(w, sanitizeClientErrorMessage(err.Error()), http.StatusBadGateway)
		return
	}

	for key, values := range result.Header {
		if isHopByHopHeader(key) {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(result.StatusCode)

	var transportErr error
	if result.BodyStream != nil {
		usageCapture := newStreamEvidenceCapture(result.Header)
		streamReader := io.TeeReader(result.BodyStream, usageCapture)
		_, transportErr = io.Copy(w, streamReader)
		_ = result.BodyStream.Close()
		result.UsageEvidence, result.QuotasEvidence = usageCapture.Evidence()
		if transportErr != nil {
			result.StreamInterrupted = true
			if result.Error == nil {
				result.Error = &proxy.ForwardError{Message: transportErr.Error(), Phase: "stream"}
			}
		}
	} else {
		_, transportErr = w.Write(result.Body)
	}

	normalized := proxy.NormalizeOutcome(result, transportErr)
	usageEvidence, quotasEvidence := extractResponseEvidence(result)
	h.reportOutcome(report.OutcomePayload{
		RequestID:         requestID,
		Provider:          resolved.Provider,
		ConnectionID:      usedConnectionID,
		Model:             resolved.Model,
		ProtocolFamily:    protocolFamily,
		PublicPath:        r.URL.Path,
		Method:            r.Method,
		UpstreamStatus:    normalized.UpstreamStatus,
		LatencyMs:         0,
		Outcome:           string(normalized.Outcome),
		StreamInterrupted: normalized.StreamInterrupted,
		Usage:             usageEvidence,
		Quotas:            quotasEvidence,
		Error:             mapForwardError(normalized.Error),
	})
}

func (h requestHandler) resolveRequest(ctx context.Context, modelStr, protocolFamily, publicPath string) (resolve.Response, int, error) {
	if h.resolver != nil {
		resolved, err := h.resolver.Resolve(ctx, resolve.ResolveRequest{
			Provider:       protocolFamily,
			Model:          modelStr,
			ProtocolFamily: protocolFamily,
			PublicPath:     publicPath,
		})
		if err != nil {
			return resolve.Response{}, http.StatusBadGateway, errors.New("resolve failed")
		}
		return resolved, 0, nil
	}

	if h.modelStore == nil {
		return resolve.Response{}, http.StatusBadGateway, errors.New("model store unavailable")
	}

	resolvedModel, err := model.ResolveModel(modelStr, h.modelStore)
	if err != nil {
		return resolve.Response{}, http.StatusBadRequest, fmt.Errorf("invalid model: %w", err)
	}
	if resolvedModel.IsCombo {
		return resolve.Response{}, http.StatusBadRequest, errors.New("combo models are not supported")
	}

	cred, err := readCredentialByProvider(h.credentialsFilePath, resolvedModel.Provider)
	if err != nil {
		return resolve.Response{}, http.StatusBadGateway, errors.New("provider credentials not found")
	}

	return resolve.Response{
		Provider:           resolvedModel.Provider,
		Model:              resolvedModel.Model,
		ChosenConnectionID: cred.ConnectionID,
	}, 0, nil
}

func (h requestHandler) forwardResolved(r *http.Request, body []byte, stream bool, _ string, resolved resolve.Response, protocolFamily string) (proxy.ForwardResponse, string, error) {
	if resolved.ChosenConnectionID == "" {
		return proxy.ForwardResponse{}, "", fmt.Errorf("missing resolved primary connection")
	}

	targetIDs := append([]string{resolved.ChosenConnectionID}, resolved.FallbackConnectionIDs...)
	targets := make([]resolvedTarget, 0, len(targetIDs))
	for _, connectionID := range targetIDs {
		if strings.TrimSpace(connectionID) == "" {
			continue
		}
		cred, err := h.credReader.ReadByConnectionID(connectionID)
		if err != nil {
			continue
		}
		upstreamURL, forwardHeaders, err := h.buildProviderRequest(r, resolved, cred, stream)
		if err != nil {
			continue
		}
		targets = append(targets, resolvedTarget{connectionID: connectionID, upstreamURL: upstreamURL, credential: cred, headers: forwardHeaders})
	}
	if len(targets) == 0 {
		return proxy.ForwardResponse{}, "", fmt.Errorf("no routable upstream targets")
	}

	var lastResp proxy.ForwardResponse
	var lastErr error
	var lastConnectionID string
	for i, target := range targets {
		forwarder := proxy.HTTPForwarder{
			Resolver: staticResolver{result: proxy.ResolveResult{UpstreamURL: target.upstreamURL}},
			Client:   h.httpClient,
		}

		resp, err := forwarder.Forward(r.Context(), proxy.ForwardRequest{
			Method: r.Method,
			Path:   "",
			Query:  r.URL.RawQuery,
			Header: target.headers,
			Body:   body,
			APIKey: target.connectionID,
			Stream: stream,
		})
		lastResp, lastErr = resp, err
		lastConnectionID = target.connectionID
		if err == nil && resp.Outcome == proxy.OutcomeOK {
			return resp, target.connectionID, nil
		}
		if i == len(targets)-1 {
			return resp, target.connectionID, err
		}
	}

	if lastErr != nil {
		return lastResp, lastConnectionID, lastErr
	}
	return lastResp, lastConnectionID, nil
}

type resolvedTarget struct {
	connectionID string
	upstreamURL  string
	credential   credentials.Credential
	headers      http.Header
}

func (h requestHandler) buildProviderRequest(r *http.Request, resolved resolve.Response, credential credentials.Credential, stream bool) (string, http.Header, error) {
	options := provider.BuildOptions{Credential: credential, RegistryHeaders: cloneForwardHeaders(r.Header)}
	if node, ok := lookupProviderNode(h.modelStore, resolved.Provider); ok {
		options.BaseURL = node.BaseURL
	}

	if _, ok := provider.GetConfig(resolved.Provider); !ok && strings.TrimSpace(options.BaseURL) == "" {
		return "", nil, fmt.Errorf("unknown provider: %s", resolved.Provider)
	}

	upstreamURL, err := provider.BuildURL(resolved.Provider, resolved.Model, stream, options)
	if err != nil {
		return "", nil, err
	}

	return upstreamURL, provider.BuildHeaders(resolved.Provider, stream, options), nil
}

func cloneForwardHeaders(header http.Header) http.Header {
	cloned := make(http.Header)
	for key, values := range header {
		if _, ok := allowedForwardHeaders[strings.ToLower(strings.TrimSpace(key))]; !ok {
			continue
		}
		cloned[key] = append([]string(nil), values...)
	}
	return cloned
}

func sanitizeClientErrorMessage(message string) string {
	sanitized := strings.TrimSpace(message)
	if sanitized == "" {
		return "upstream forwarding failed"
	}
	sanitized = clientErrorURLPattern.ReplaceAllString(sanitized, "[redacted-url]")
	sanitized = clientErrorIPPattern.ReplaceAllString(sanitized, "[redacted-ip]")
	sanitized = clientErrorBearerPattern.ReplaceAllString(sanitized, "Bearer [redacted-token]")
	sanitized = clientErrorSKPattern.ReplaceAllString(sanitized, "[redacted-token]")
	fields := strings.Fields(sanitized)
	if len(fields) == 0 {
		return "upstream forwarding failed"
	}
	if len(fields) > 12 {
		fields = fields[:12]
	}
	sanitized = strings.Join(fields, " ")
	if sanitized == "" || sanitized == "[redacted-url]" || sanitized == "[redacted-ip]" {
		return "upstream forwarding failed"
	}
	return sanitized
}


func lookupProviderNode(store *model.Store, providerID string) (model.ProviderNode, bool) {
	if store == nil {
		return model.ProviderNode{}, false
	}
	for _, nodeType := range []string{"openai-compatible", "anthropic-compatible"} {
		for _, node := range store.ProviderNodesByType(nodeType) {
			if node.ID == providerID {
				return node, true
			}
		}
	}
	return model.ProviderNode{}, false
}

func readCredentialByProvider(path, providerID string) (credentials.Credential, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return credentials.Credential{}, err
	}

	var decoded struct {
		ProviderConnections []struct {
			ID           string `json:"id"`
			Provider     string `json:"provider"`
			AuthType     string `json:"authType"`
			APIKey       string `json:"apiKey"`
			AccessToken  string `json:"accessToken"`
			RefreshToken string `json:"refreshToken"`
		} `json:"providerConnections"`
	}
	if err := json.Unmarshal(content, &decoded); err != nil {
		return credentials.Credential{}, err
	}

	for _, connection := range decoded.ProviderConnections {
		if strings.TrimSpace(connection.Provider) != providerID {
			continue
		}
		return credentials.Credential{
			ConnectionID: connection.ID,
			Provider:     connection.Provider,
			AuthType:     connection.AuthType,
			APIKey:       connection.APIKey,
			AccessToken:  connection.AccessToken,
			RefreshToken: connection.RefreshToken,
		}, nil
	}

	return credentials.Credential{}, credentials.ErrConnectionNotFound
}

func extractResponseEvidence(resp proxy.ForwardResponse) (map[string]any, map[string]any) {
	if resp.UsageEvidence != nil {
		return resp.UsageEvidence, resp.QuotasEvidence
	}
	return extractUsageAndQuotasFromPayload(resp.Body)
}

func extractUsageAndQuotasFromPayload(body []byte) (map[string]any, map[string]any) {
	if len(body) == 0 {
		return nil, nil
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, nil
	}

	usage, usageOK := payload["usage"].(map[string]any)
	if !usageOK {
		return nil, nil
	}

	quotas, quotasOK := payload["quotas"].(map[string]any)
	if !quotasOK {
		if nestedQuotas, nestedOK := usage["quotas"].(map[string]any); nestedOK {
			quotas = nestedQuotas
		}
	}

	return usage, quotas
}

func newStreamEvidenceCapture(header http.Header) *streamEvidenceCapture {
	contentType := strings.ToLower(strings.TrimSpace(header.Get("Content-Type")))
	return &streamEvidenceCapture{
		sseLike: strings.Contains(contentType, "text/event-stream"),
	}
}

type streamEvidenceCapture struct {
	buf     bytes.Buffer
	sseLike bool
	usage   map[string]any
	quotas  map[string]any
}

func (c *streamEvidenceCapture) Write(p []byte) (int, error) {
	if c.usage != nil {
		return len(p), nil
	}
	if c.buf.Len()+len(p) > 512*1024 {
		return len(p), nil
	}
	_, _ = c.buf.Write(p)
	c.scan()
	return len(p), nil
}

func (c *streamEvidenceCapture) Evidence() (map[string]any, map[string]any) {
	if c.usage != nil {
		return c.usage, c.quotas
	}
	c.scan()
	return c.usage, c.quotas
}

func (c *streamEvidenceCapture) scan() {
	if c.usage != nil {
		return
	}
	data := c.buf.Bytes()
	if len(data) == 0 {
		return
	}
	if c.sseLike {
		usage, quotas := extractUsageAndQuotasFromSSE(data)
		if usage != nil {
			c.usage, c.quotas = usage, quotas
			return
		}
	}
	usage, quotas := extractUsageAndQuotasFromPayload(data)
	if usage != nil {
		c.usage, c.quotas = usage, quotas
	}
}

func extractUsageAndQuotasFromSSE(data []byte) (map[string]any, map[string]any) {
	lines := strings.Split(string(data), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		chunk := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if chunk == "" || chunk == "[DONE]" {
			continue
		}
		usage, quotas := extractUsageAndQuotasFromPayload([]byte(chunk))
		if usage != nil {
			return usage, quotas
		}
	}
	return nil, nil
}

func readPublicAPIKey(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[len("Bearer "):])
	}
	if key := strings.TrimSpace(r.Header.Get("x-api-key")); key != "" {
		return key
	}
	if key := strings.TrimSpace(r.Header.Get("X-Api-Key")); key != "" {
		return key
	}
	return ""
}

func extractModelAndStream(body []byte) (string, bool) {
	if len(body) == 0 {
		return "", false
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", false
	}
	model, _ := payload["model"].(string)
	stream, _ := payload["stream"].(bool)
	return strings.TrimSpace(model), stream
}

func buildUpstreamURL(provider, publicPath string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "openai":
		return "https://api.openai.com" + publicPath
	case "anthropic", "claude":
		return "https://api.anthropic.com" + publicPath
	default:
		return ""
	}
}

func applyUpstreamAuth(header *http.Header, protocolFamily string, credential credentials.Credential) {
	if strings.ToLower(protocolFamily) == "anthropic" {
		if strings.TrimSpace(credential.APIKey) != "" {
			header.Set("x-api-key", credential.APIKey)
		}
		if strings.TrimSpace(credential.AccessToken) != "" {
			header.Set("Authorization", "Bearer "+credential.AccessToken)
		}
		header.Set("anthropic-version", "2023-06-01")
		return
	}
	if strings.TrimSpace(credential.APIKey) != "" {
		header.Set("Authorization", "Bearer "+credential.APIKey)
		return
	}
	if strings.TrimSpace(credential.AccessToken) != "" {
		header.Set("Authorization", "Bearer "+credential.AccessToken)
	}
}

func isHopByHopHeader(k string) bool {
	switch strings.ToLower(k) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}

func generateRequestID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("req_%d", time.Now().UnixNano())
	}
	return "req_" + hex.EncodeToString(buf)
}

func mapForwardError(err *proxy.ForwardError) *report.ErrorPayload {
	if err == nil {
		return nil
	}
	return &report.ErrorPayload{Message: err.Message, Phase: err.Phase}
}

type staticResolver struct {
	result proxy.ResolveResult
}

func (s staticResolver) Resolve(_ context.Context, _ string) (proxy.ResolveResult, error) {
	return s.result, nil
}
