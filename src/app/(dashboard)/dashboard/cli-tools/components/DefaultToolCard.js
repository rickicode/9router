"use client";

import { useState } from "react";
import { Card, ModelSelectModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Image from "next/image";

export default function DefaultToolCard({ toolId, tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders = [], cloudEnabled = false, tunnelEnabled = false }) {
  const [copiedField, setCopiedField] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelValue, setModelValue] = useState("");
  
  // Initialize state directly with computed value - no need for useEffect
  const [selectedApiKey, setSelectedApiKey] = useState(() => 
    apiKeys?.length > 0 ? apiKeys[0].key : ""
  );

  const replaceVars = (text) => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
      ? selectedApiKey 
      : (!cloudEnabled ? "sk_9router" : "your-api-key");
    
    // Add /v1 suffix only if not already present (DRY - avoid duplicate)
    const normalizedBaseUrl = baseUrl || "http://localhost:20128";
    const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1") 
      ? normalizedBaseUrl 
      : `${normalizedBaseUrl}/v1`;
    
    return text
      .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
      .replace(/\{\{apiKey\}\}/g, keyToUse)
      .replace(/\{\{model\}\}/g, modelValue || "provider/model-id");
  };

  const { copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = async (text, field) => {
    await copyToClipboard(replaceVars(text), `toolcard-${field}`);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSelectModel = (model) => {
    setModelValue(model.value);
  };

  const hasActiveProviders = activeProviders?.length > 0;

  const renderApiKeySelector = () => {
    return (
      <div className="mt-2 flex items-center gap-2">
        {apiKeys && apiKeys?.length > 0 ? (
          <>
            <select
              value={selectedApiKey}
              onChange={(e) => setSelectedApiKey(e.target.value)}
              className="flex-1 px-3 py-2 bg-[var(--color-bg-alt)]-secondary rounded text-[13px] border border-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {apiKeys.map((key) => (
                <option key={key.id} value={key.key}>{key.key}</option>
              ))}
            </select>
            <button
              onClick={() => handleCopy(selectedApiKey, "apiKey")}
              className="shrink-0 px-3 py-2 bg-[var(--color-bg-alt)]-secondary hover:bg-[var(--color-bg-alt)]-tertiary rounded border border-[var(--color-border)] transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">
                {copiedField === "apiKey" ? "check" : "content_copy"}
              </span>
            </button>
          </>
        ) : (
          <span className="text-[13px] text-[var(--color-text-muted)]">
            {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_9router"}
          </span>
        )}
      </div>
    );
  };

  const renderModelSelector = () => {
    return (
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={modelValue}
          onChange={(e) => setModelValue(e.target.value)}
          placeholder="provider/model-id"
          className="flex-1 px-3 py-2 bg-[var(--color-bg-alt)]-secondary rounded text-[13px] border border-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={() => setShowModelModal(true)}
          disabled={!hasActiveProviders}
          className={`shrink-0 px-3 py-2 rounded border text-[13px] transition-colors ${
            hasActiveProviders
              ? "bg-[var(--color-bg-alt)]-secondary border-[var(--color-border)] text-[var(--color-text-main)] hover:border-primary cursor-pointer"
              : "opacity-50 cursor-not-allowed border-[var(--color-border)]"
          }`}
        >
          Select Model
        </button>
        {modelValue && (
          <>
            <button
              onClick={() => handleCopy(modelValue, "model")}
              className="shrink-0 px-3 py-2 bg-[var(--color-bg-alt)]-secondary hover:bg-[var(--color-bg-alt)]-tertiary rounded border border-[var(--color-border)] transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">
                {copiedField === "model" ? "check" : "content_copy"}
              </span>
            </button>
            <button
              onClick={() => setModelValue("")}
              className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] rounded transition-colors"
              title="Clear"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </>
        )}
      </div>
    );
  };

  const renderNotes = () => {
    const notes = tool?.notes;
    if (!notes || notes.length === 0) return null;
    
    return (
      <div className="flex flex-col gap-2 mb-4">
        {notes.map((note, index) => {
          // Skip cloudCheck note if tunnel or cloud is enabled
          if (note.type === "cloudCheck" && (cloudEnabled || tunnelEnabled)) return null;
          
          const isWarning = note.type === "warning";
          const isError = note.type === "cloudCheck" && !cloudEnabled && !tunnelEnabled;
          
          let bgClass = "bg-[var(--color-accent)]/10 border-[rgba(0,122,255,0.3)]";
          let textClass = "text-[var(--color-accent)] dark:text-[var(--color-accent)]";
          let iconClass = "text-[var(--color-accent)]";
          let icon = "info";
          
          if (isWarning) {
            bgClass = "bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30";
            textClass = "text-[var(--color-warning)] ";
            iconClass = "text-[var(--color-warning)]";
            icon = "warning";
          } else if (isError) {
            bgClass = "bg-[var(--color-danger)]/10 border-[rgba(255,59,48,0.3)]";
            textClass = "text-[var(--color-danger)] dark:text-[var(--color-danger)]";
            iconClass = "text-[var(--color-danger)]";
            icon = "error";
          }
          
          return (
            <div key={index} className={`flex items-start gap-3 p-3 rounded border ${bgClass}`}>
              <span className={`material-symbols-outlined text-[16px] ${iconClass}`}>{icon}</span>
              <p className={`text-[13px] ${textClass}`}>{note.text}</p>
            </div>
          );
        })}
      </div>
    );
  };

  const canShowGuide = () => {
    if (tool.requiresExternalUrl && !cloudEnabled && !tunnelEnabled) return false;
    if (tool.requiresCloud && !cloudEnabled) return false;
    return true;
  };

  const renderGuideSteps = () => {
    const guideSteps = tool?.guideSteps;
    if (!guideSteps || guideSteps.length === 0) return <p className="text-[var(--color-text-muted)] text-[13px]">Coming soon...</p>;

    return (
      <div className="flex flex-col gap-4">
        {renderNotes()}
        {canShowGuide() && guideSteps.map((item) => (
          <div key={item.step} className="flex items-start gap-4">
            <div 
              className="size-8 rounded flex items-center justify-center shrink-0 text-[13px] font-medium text-[var(--color-text-main)]"
              style={{ backgroundColor: tool.color }}
            >
              {item.step}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--color-text-main)]">{item.title}</p>
              {item.desc && <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{item.desc}</p>}
              {item.type === "apiKeySelector" && renderApiKeySelector()}
              {item.type === "modelSelector" && renderModelSelector()}
              {item.value && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-[var(--color-bg-alt)]-secondary rounded text-[13px] font-mono border border-[var(--color-border)] truncate">
                    {replaceVars(item.value)}
                  </code>
                  {item.copyable && (
                    <button
                      onClick={() => handleCopy(item.value, `${item.step}-${item.title}`)}
                      className="shrink-0 px-3 py-2 bg-[var(--color-bg-alt)]-secondary hover:bg-[var(--color-bg-alt)]-tertiary rounded border border-[var(--color-border)] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {copiedField === `${item.step}-${item.title}` ? "check" : "content_copy"}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {canShowGuide() && tool?.codeBlock && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">{tool.codeBlock.language}</span>
              <button
                onClick={() => handleCopy(tool.codeBlock.code, "codeblock")}
                className="flex items-center gap-1 px-2 py-1 text-[11px] bg-[var(--color-bg-alt)]-secondary hover:bg-[var(--color-bg-alt)]-tertiary rounded border border-[var(--color-border)] transition-colors"
              >
                <span className="material-symbols-outlined text-[13px]">
                  {copiedField === "codeblock" ? "check" : "content_copy"}
                </span>
                {copiedField === "codeblock" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="p-4 bg-[var(--color-bg-alt)]-secondary rounded border border-[var(--color-border)] overflow-x-auto">
              <code className="text-[13px] font-mono whitespace-pre">{replaceVars(tool.codeBlock.code)}</code>
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderIcon = () => {
    if (tool.image) {
      return (
        <Image
          src={tool.image}
          alt={tool.name}
          width={32}
          height={32}
          className="size-8 object-contain rounded"
          sizes="32px"
          onError={(e) => { e.target.style.display = "none"; }}
        />
      );
    }
    if (tool.icon) {
      return <span className="material-symbols-outlined text-[20px]" style={{ color: tool.color }}>{tool.icon}</span>;
    }
    return (
      <Image
        src={`/providers/${toolId}.png`}
        alt={tool.name}
        width={32}
        height={32}
        className="size-8 object-contain rounded"
        sizes="32px"
        onError={(e) => { e.target.style.display = "none"; }}
      />
    );
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 rounded flex items-center justify-center shrink-0">
            {renderIcon()}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-[13px]">{tool.name}</h3>
            <p className="text-[11px] text-[var(--color-text-muted)] truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-[var(--color-text-muted)] text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
          {renderGuideSteps()}
        </div>
      )}

      <ModelSelectModal
        isOpen={showModelModal}
        onClose={() => setShowModelModal(false)}
        onSelect={handleSelectModel}
        selectedModel={modelValue}
        activeProviders={activeProviders}
        title="Select Model"
      />
    </Card>
  );
}

