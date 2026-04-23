package credentials

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

var ErrConnectionNotFound = errors.New("connection not found")

// Credential is the minimal credential payload read from 9router's shared db.json shape.
type Credential struct {
	ConnectionID string
	Provider     string
	AuthType     string
	APIKey       string
	AccessToken  string
	RefreshToken string
}

// Reader loads credentials from the existing 9router local DB JSON file.
type Reader struct {
	filePath string
}

func NewReader(filePath string) *Reader {
	return &Reader{filePath: filePath}
}

type dbShape struct {
	ProviderConnections []providerConnection `json:"providerConnections"`
}

type providerConnection struct {
	ID           string `json:"id"`
	Provider     string `json:"provider"`
	AuthType     string `json:"authType"`
	APIKey       string `json:"apiKey"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

func (r *Reader) ReadByConnectionID(connectionID string) (Credential, error) {
	content, err := os.ReadFile(r.filePath)
	if err != nil {
		return Credential{}, fmt.Errorf("read credentials file: %w", err)
	}

	var db dbShape
	if err := json.Unmarshal(content, &db); err != nil {
		return Credential{}, fmt.Errorf("decode credentials file: %w", err)
	}

	for _, c := range db.ProviderConnections {
		if c.ID != connectionID {
			continue
		}
		return Credential{
			ConnectionID: c.ID,
			Provider:     c.Provider,
			AuthType:     c.AuthType,
			APIKey:       c.APIKey,
			AccessToken:  c.AccessToken,
			RefreshToken: c.RefreshToken,
		}, nil
	}

	return Credential{}, fmt.Errorf("%w: %s", ErrConnectionNotFound, connectionID)
}
