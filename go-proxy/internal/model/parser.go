package model

import "strings"

type ParsedModel struct {
	Provider      string
	Model         string
	IsAlias       bool
	ProviderAlias string
}

var providerAliases = map[string]string{
	"cc":             "claude",
	"cx":             "codex",
	"gc":             "gemini-cli",
	"qw":             "qwen",
	"ag":             "antigravity",
	"gh":             "github",
	"cl":             "cline",
	"openai":         "openai",
	"anthropic":      "anthropic",
	"gemini":         "gemini",
	"openrouter":     "openrouter",
	"glm":            "glm",
	"kimi":           "kimi",
	"minimax":        "minimax",
	"deepseek":       "deepseek",
	"groq":           "groq",
	"mistral":        "mistral",
	"perplexity":     "perplexity",
	"together":       "together",
	"fireworks":      "fireworks",
	"cohere":         "cohere",
	"nvidia":         "nvidia",
	"nebius":         "nebius",
	"siliconflow":    "siliconflow",
	"vertex":         "vertex",
	"vertex-partner": "vertex-partner",
	"grok-web":       "grok-web",
	"perplexity-web": "perplexity-web",
}

func ResolveProviderAlias(aliasOrID string) string {
	if provider, ok := providerAliases[aliasOrID]; ok {
		return provider
	}

	return aliasOrID
}

func Parse(modelStr string) ParsedModel {
	if modelStr == "" {
		return ParsedModel{}
	}

	firstSlash := strings.Index(modelStr, "/")
	if firstSlash >= 0 {
		providerOrAlias := modelStr[:firstSlash]
		return ParsedModel{
			Provider:      ResolveProviderAlias(providerOrAlias),
			Model:         modelStr[firstSlash+1:],
			IsAlias:       false,
			ProviderAlias: providerOrAlias,
		}
	}

	return ParsedModel{
		Model:   modelStr,
		IsAlias: true,
	}
}
