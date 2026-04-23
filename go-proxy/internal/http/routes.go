package http

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go-proxy/internal/config"
	"go-proxy/internal/credentials"
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

	h := requestHandler{
		resolver:   resolverClient,
		reporter:   reportClient,
		credReader: credReader,
		httpClient: &http.Client{Timeout: time.Duration(cfg.HTTPTimeoutSeconds) * time.Second},
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
	resolver   resolve.Client
	reporter   report.Client
	credReader *credentials.Reader
	httpClient *http.Client
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

	resolved, err := h.resolver.Resolve(r.Context(), resolve.ResolveRequest{
		Provider:       protocolFamily,
		Model:          model,
		ProtocolFamily: protocolFamily,
		PublicPath:     r.URL.Path,
	})
	if err != nil {
		http.Error(w, "resolve failed", http.StatusBadGateway)
		return
	}

	result, usedConnectionID, err := h.forwardResolved(r, body, stream, apiKey, resolved, protocolFamily)
	if err != nil {
		normalized := proxy.NormalizeOutcome(result, err)
		usageEvidence, quotasEvidence := extractResponseEvidence(result)
		h.reportOutcome(report.OutcomePayload{
			RequestID:         generateRequestID(),
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
		http.Error(w, "upstream forwarding failed", http.StatusBadGateway)
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
		RequestID:         generateRequestID(),
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
		upstreamURL := buildUpstreamURL(cred.Provider, r.URL.Path)
		if upstreamURL == "" {
			continue
		}
		targets = append(targets, resolvedTarget{connectionID: connectionID, upstreamURL: upstreamURL, credential: cred})
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

		forwardHeaders := r.Header.Clone()
		forwardHeaders.Del("Authorization")
		forwardHeaders.Del("X-Api-Key")
		forwardHeaders.Del("x-api-key")
		applyUpstreamAuth(&forwardHeaders, protocolFamily, target.credential)

		resp, err := forwarder.Forward(r.Context(), proxy.ForwardRequest{
			Method: r.Method,
			Path:   r.URL.Path,
			Query:  r.URL.RawQuery,
			Header: forwardHeaders,
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
