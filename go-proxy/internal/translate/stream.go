package translate

type ToolCall struct {
	Index     int                    `json:"index,omitempty"`
	ID        string                 `json:"id,omitempty"`
	Type      string                 `json:"type,omitempty"`
	Function  map[string]any         `json:"function,omitempty"`
	Arguments string                 `json:"-"`
}

type StreamState struct {
	MessageID            string
	Model                string
	ToolCallIndex        int
	ToolCalls            map[int]*ToolCall
	ToolNameMap          map[string]string
	ServerToolBlockIndex int
	ServerToolBlockActive bool
	TextBlockStarted     bool
	ThinkingBlockStarted bool
	InThinkingBlock      bool
	CurrentBlockIndex    int
	Usage                map[string]any
	FinishReason         string
	FinishReasonSent     bool
}
