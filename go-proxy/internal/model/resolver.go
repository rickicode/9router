package model

import "strings"

type Resolution struct {
	Provider string
	Model    string
	IsCombo  bool
}

func ResolveModel(modelStr string, store *Store) (Resolution, error) {
	parsed := Parse(modelStr)

	if !parsed.IsAlias && parsed.ProviderAlias == parsed.Provider {
		if node, ok := store.ProviderNodeByPrefix(parsed.ProviderAlias, "openai-compatible"); ok {
			return Resolution{Provider: node.ID, Model: parsed.Model}, nil
		}
	}

	if !parsed.IsAlias {
		if node, ok := store.ProviderNodeByPrefix(parsed.ProviderAlias, "anthropic-compatible"); ok {
			return Resolution{Provider: node.ID, Model: parsed.Model}, nil
		}
	}

	if !parsed.IsAlias {
		return Resolution{Provider: parsed.Provider, Model: parsed.Model}, nil
	}

	if _, ok := store.ComboByName(parsed.Model); ok {
		return Resolution{Model: parsed.Model, IsCombo: true}, nil
	}

	if alias, ok := store.ModelAliases()[parsed.Model]; ok {
		if alias.RawString != "" {
			return ResolveModel(alias.RawString, store)
		}

		return Resolution{
			Provider: ResolveProviderAlias(alias.Provider),
			Model:    alias.Model,
		}, nil
	}

	return Resolution{Provider: InferProvider(parsed.Model), Model: parsed.Model}, nil
}

func InferProvider(model string) string {
	switch {
	case strings.HasPrefix(model, "claude"):
		return "anthropic"
	case strings.HasPrefix(model, "gemini"):
		return "gemini"
	case strings.HasPrefix(model, "gpt-"), strings.HasPrefix(model, "o1"), strings.HasPrefix(model, "o3"), strings.HasPrefix(model, "o4"):
		return "openai"
	case strings.HasPrefix(model, "deepseek"):
		return "openrouter"
	default:
		return "openai"
	}
}
