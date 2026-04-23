package translate

import "strings"

var defaultGeminiSafetySettings = []any{
	map[string]any{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "OFF"},
	map[string]any{"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "OFF"},
	map[string]any{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "OFF"},
	map[string]any{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "OFF"},
}

// OpenAIToGeminiRequest converts an OpenAI chat completion request body into Gemini generateContent format.
func OpenAIToGeminiRequest(model string, body map[string]any, stream bool) (map[string]any, error) {
	_ = stream

	result := map[string]any{
		"model":            model,
		"contents":         []any{},
		"generationConfig": map[string]any{},
		"safetySettings":   defaultGeminiSafetySettings,
	}

	generationConfig := result["generationConfig"].(map[string]any)
	if temperature, ok := body["temperature"]; ok {
		generationConfig["temperature"] = temperature
	}
	if topP, ok := body["top_p"]; ok {
		generationConfig["topP"] = topP
	}
	if topK, ok := body["top_k"]; ok {
		generationConfig["topK"] = topK
	}
	if maxTokens, ok := body["max_tokens"]; ok {
		generationConfig["maxOutputTokens"] = maxTokens
	}

	toolCallIDToName := map[string]string{}
	toolResponses := map[string]any{}
	if rawMessages, ok := body["messages"].([]any); ok {
		for _, raw := range rawMessages {
			msg, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if stringValue(msg["role"]) == "assistant" {
				if toolCalls, ok := msg["tool_calls"].([]any); ok {
					for _, rawToolCall := range toolCalls {
						toolCall, ok := rawToolCall.(map[string]any)
						if !ok || stringValue(toolCall["type"]) != "function" {
							continue
						}
						fn, _ := toolCall["function"].(map[string]any)
						id := stringValue(toolCall["id"])
						name := stringValue(fn["name"])
						if id != "" && name != "" {
							toolCallIDToName[id] = name
						}
					}
				}
			}
			if stringValue(msg["role"]) == "tool" {
				if id := stringValue(msg["tool_call_id"]); id != "" {
					toolResponses[id] = msg["content"]
				}
			}
		}

		contents := []any{}
		for _, raw := range rawMessages {
			msg, ok := raw.(map[string]any)
			if !ok {
				continue
			}

			role := stringValue(msg["role"])
			content := msg["content"]

			switch {
			case role == "system" && len(rawMessages) > 1:
				result["systemInstruction"] = map[string]any{
					"role": "user",
					"parts": []any{map[string]any{"text": extractTextContent(content)}},
				}
			case role == "user" || (role == "system" && len(rawMessages) == 1):
				parts := convertOpenAIContentToGeminiParts(content)
				if len(parts) > 0 {
					contents = append(contents, map[string]any{"role": "user", "parts": parts})
				}
			case role == "assistant":
				parts := []any{}
				if reasoning := stringValue(msg["reasoning_content"]); reasoning != "" {
					parts = append(parts, map[string]any{"thought": true, "text": reasoning})
				}
				if text := extractTextContent(content); text != "" {
					parts = append(parts, map[string]any{"text": text})
				}

				toolCallIDs := []string{}
				if toolCalls, ok := msg["tool_calls"].([]any); ok {
					for _, rawToolCall := range toolCalls {
						toolCall, ok := rawToolCall.(map[string]any)
						if !ok || stringValue(toolCall["type"]) != "function" {
							continue
						}
						fn, _ := toolCall["function"].(map[string]any)
						id := stringValue(toolCall["id"])
						parts = append(parts, map[string]any{
							"functionCall": map[string]any{
								"id":   id,
								"name": sanitizeGeminiFunctionName(stringValue(fn["name"])),
								"args": tryParseJSON(fn["arguments"]),
							},
						})
						toolCallIDs = append(toolCallIDs, id)
					}
				}

				if len(parts) > 0 {
					contents = append(contents, map[string]any{"role": "model", "parts": parts})
				}

				toolParts := []any{}
				for _, id := range toolCallIDs {
					resp, ok := toolResponses[id]
					if !ok {
						continue
					}
					parsed := tryParseJSON(resp)
					if parsed == nil {
						parsed = map[string]any{"result": resp}
					} else {
						switch parsed.(type) {
						case map[string]any, []any:
							parsed = map[string]any{"result": parsed}
						default:
							parsed = map[string]any{"result": parsed}
						}
					}
					name := toolCallIDToName[id]
					if name == "" {
						name = id
					}
					toolParts = append(toolParts, map[string]any{
						"functionResponse": map[string]any{
							"id":   id,
							"name": sanitizeGeminiFunctionName(name),
							"response": map[string]any{
								"result": parsed,
							},
						},
					})
				}
				if len(toolParts) > 0 {
					contents = append(contents, map[string]any{"role": "user", "parts": toolParts})
				}
			}
		}
		result["contents"] = contents
	}

	if rawTools, ok := body["tools"].([]any); ok && len(rawTools) > 0 {
		functionDeclarations := []any{}
		for _, rawTool := range rawTools {
			tool, ok := rawTool.(map[string]any)
			if !ok {
				continue
			}

			if name := stringValue(tool["name"]); name != "" {
				functionDeclarations = append(functionDeclarations, map[string]any{
					"name":        sanitizeGeminiFunctionName(name),
					"description": stringValue(tool["description"]),
					"parameters":  valueOrDefaultMap(tool["input_schema"]),
				})
				continue
			}

			if stringValue(tool["type"]) != "function" {
				continue
			}
			fn, _ := tool["function"].(map[string]any)
			functionDeclarations = append(functionDeclarations, map[string]any{
				"name":        sanitizeGeminiFunctionName(stringValue(fn["name"])),
				"description": stringValue(fn["description"]),
				"parameters":  valueOrDefaultMap(fn["parameters"]),
			})
		}
		if len(functionDeclarations) > 0 {
			result["tools"] = []any{map[string]any{"functionDeclarations": functionDeclarations}}
		}
	}

	return result, nil
}

func convertOpenAIContentToGeminiParts(content any) []any {
	parts := []any{}
	switch value := content.(type) {
	case string:
		if value != "" {
			parts = append(parts, map[string]any{"text": value})
		}
	case []any:
		for _, rawPart := range value {
			part, ok := rawPart.(map[string]any)
			if !ok {
				continue
			}
			if stringValue(part["type"]) == "text" {
				if text := stringValue(part["text"]); text != "" {
					parts = append(parts, map[string]any{"text": text})
				}
			}
		}
	}
	return parts
}

func sanitizeGeminiFunctionName(name string) string {
	if name == "" {
		return "_unknown"
	}
	var builder strings.Builder
	for i, r := range name {
		allowed := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '.' || r == ':' || r == '-'
		if !allowed {
			r = '_'
		}
		if i == 0 && !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_') {
			builder.WriteByte('_')
		}
		if r == '-' {
			r = '_'
		}
		builder.WriteRune(r)
		if builder.Len() >= 64 {
			break
		}
	}
	sanitized := builder.String()
	if len(sanitized) > 64 {
		return sanitized[:64]
	}
	return sanitized
}

func valueOrDefaultMap(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{"type": "object", "properties": map[string]any{}}
}
