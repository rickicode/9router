package translate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func GeminiToOpenAIChunk(chunk []byte, state *StreamState) ([]byte, error) {
	if len(bytes.TrimSpace(chunk)) == 0 {
		return nil, nil
	}
	if state == nil {
		return nil, fmt.Errorf("stream state is required")
	}
	if state.ToolCalls == nil {
		state.ToolCalls = make(map[int]*ToolCall)
	}

	payload, ok := extractSSEData(chunk)
	if !ok {
		return nil, nil
	}

	var response map[string]any
	if err := json.Unmarshal(payload, &response); err != nil {
		return nil, fmt.Errorf("unmarshal gemini chunk: %w", err)
	}

	if wrapped, ok := response["response"].(map[string]any); ok {
		response = wrapped
	}

	if !initializeGeminiState(response, state) {
		return nil, nil
	}

	if usageMeta, ok := response["usageMetadata"].(map[string]any); ok {
		updateGeminiUsage(usageMeta, state)
	}

	candidate := firstCandidate(response)
	if candidate == nil {
		return nil, nil
	}

	if content, ok := candidate["content"].(map[string]any); ok {
		if result, ok := translateGeminiParts(content["parts"], state); ok {
			return json.Marshal(result)
		}
	}

	if finishReason := stringValue(candidate["finishReason"]); finishReason != "" {
		result := createOpenAIChunk(state, map[string]any{}, convertGeminiFinishReason(finishReason, state))
		if state.Usage != nil {
			result["usage"] = state.Usage
		}
		return json.Marshal(result)
	}

	return nil, nil

}

func extractSSEData(chunk []byte) ([]byte, bool) {
	trimmed := bytes.TrimSpace(chunk)
	if bytes.Equal(trimmed, []byte("data: [DONE]")) || bytes.Equal(trimmed, []byte("[DONE]")) {
		return nil, false
	}
	if bytes.HasPrefix(trimmed, []byte("data:")) {
		trimmed = bytes.TrimSpace(trimmed[len("data:"):])
	}
	if len(trimmed) == 0 {
		return nil, false
	}
	return trimmed, true
}

func initializeGeminiState(response map[string]any, state *StreamState) bool {
	if state.MessageID != "" {
		return true
	}
	if firstCandidate(response) == nil {
		return false
	}
	state.MessageID = valueOrDefault(stringValue(response["responseId"]), fmt.Sprintf("msg_%d", time.Now().UnixMilli()))
	state.Model = valueOrDefault(stringValue(response["modelVersion"]), valueOrDefault(state.Model, "gemini"))
	state.ToolCallIndex = 0
	return true
}

func firstCandidate(response map[string]any) map[string]any {
	candidates, ok := response["candidates"].([]any)
	if !ok || len(candidates) == 0 {
		return nil
	}
	candidate, _ := candidates[0].(map[string]any)
	return candidate
}

func translateGeminiParts(rawParts any, state *StreamState) (map[string]any, bool) {
	parts, ok := rawParts.([]any)
	if !ok {
		return nil, false
	}
	for _, rawPart := range parts {
		part, ok := rawPart.(map[string]any)
		if !ok {
			continue
		}

		if functionCall, ok := part["functionCall"].(map[string]any); ok {
			return createGeminiToolCallChunk(functionCall, state), true
		}

		text := stringValue(part["text"])
		if text == "" {
			continue
		}
		if part["thought"] == true {
			return createOpenAIChunk(state, map[string]any{"content": "<think>" + text + "</think>"}, nil), true
		}
		return createOpenAIChunk(state, map[string]any{"content": text}, nil), true
	}
	return nil, false
}

func createGeminiToolCallChunk(functionCall map[string]any, state *StreamState) map[string]any {
	name := stringValue(functionCall["name"])
	if state.ToolNameMap != nil {
		if original, ok := state.ToolNameMap[name]; ok && original != "" {
			name = original
		}
	}
	arguments, _ := json.Marshal(functionCall["args"])
	id := valueOrDefault(stringValue(functionCall["id"]), fmt.Sprintf("%s-%d-%d", name, time.Now().UnixMilli(), state.ToolCallIndex))
	toolCall := &ToolCall{
		Index: state.ToolCallIndex,
		ID:    id,
		Type:  "function",
		Function: map[string]any{
			"name":      name,
			"arguments": string(arguments),
		},
	}
	state.ToolCalls[state.ToolCallIndex] = toolCall
	state.ToolCallIndex++
	return createOpenAIChunk(state, map[string]any{
		"tool_calls": []any{map[string]any{
			"index": toolCall.Index,
			"id":    toolCall.ID,
			"type":  toolCall.Type,
			"function": map[string]any{
				"name":      name,
				"arguments": string(arguments),
			},
		}},
	}, nil)
}

func updateGeminiUsage(usageMeta map[string]any, state *StreamState) {
	promptTokens := intValue(usageMeta["promptTokenCount"], 0)
	thoughtsTokens := intValue(usageMeta["thoughtsTokenCount"], 0)
	completionTokens := intValue(usageMeta["candidatesTokenCount"], 0) + thoughtsTokens
	totalTokens := intValue(usageMeta["totalTokenCount"], 0)
	if completionTokens == thoughtsTokens && totalTokens > 0 {
		completionTokens = totalTokens - promptTokens
		if completionTokens < 0 {
			completionTokens = 0
		}
	}
	state.UsageData = &UsageData{
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
	}
	state.Usage = map[string]any{
		"prompt_tokens":     promptTokens,
		"completion_tokens": completionTokens,
		"total_tokens":      totalTokens,
	}
	if cachedTokens := intValue(usageMeta["cachedContentTokenCount"], 0); cachedTokens > 0 {
		state.Usage["prompt_tokens_details"] = map[string]any{"cached_tokens": cachedTokens}
	}
	if thoughtsTokens > 0 {
		state.Usage["completion_tokens_details"] = map[string]any{"reasoning_tokens": thoughtsTokens}
	}
}

func convertGeminiFinishReason(reason string, state *StreamState) string {
	switch strings.ToUpper(reason) {
	case "STOP":
		if len(state.ToolCalls) > 0 {
			return "tool_calls"
		}
		return "stop"
	case "MAX_TOKENS":
		return "length"
	case "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII":
		return "content_filter"
	case "MALFORMED_FUNCTION_CALL":
		return "tool_calls"
	default:
		return strings.ToLower(reason)
	}
}
