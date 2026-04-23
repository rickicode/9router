"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";

export default function OpenCodeToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [subagentModel, setSubagentModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [activeModel, setActiveModel] = useState("");

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
      checkStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  // Sync models from existing config
  useEffect(() => {
    if (status?.opencode?.models) {
      setSelectedModels(status.opencode.models);
    }
    if (status?.opencode?.activeModel) {
      setActiveModel(status.opencode.activeModel);
    }
    
    // Parse subagent settings from agent.explorer if exists
    if (status?.config?.agent?.explorer?.model?.startsWith("9router/")) {
      setSubagentModel(status.config.agent.explorer.model.replace("9router/", ""));
    }
  }, [status]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.config) return "not_configured";
    const url = status.config?.provider?.["9router"]?.options?.baseURL || "";
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    return status.has9Router && (isLocal || url.includes(baseUrl)) ? "configured" : status.has9Router ? "other" : "not_configured";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/opencode-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);

      const res = await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          baseUrl: getEffectiveBaseUrl(), 
          apiKey: keyToUse, 
          models: selectedModels,
          activeModel: activeModel === "" ? "" : (activeModel || selectedModels[0]),
          subagentModel: subagentModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/opencode-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModel("");
        setSelectedModels([]);
        setActiveModel("");
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = selectedModels?.length > 0 ? selectedModels : ["provider/model-id"];
    const activeModelToShow = activeModel || selectedModels[0] || modelsToShow[0];
    const effectiveSubagentModel = subagentModel || activeModelToShow;

    const modelsObj = {};
    modelsToShow.forEach(m => {
      modelsObj[m] = { name: m };
    });

    return [{
      filename: "~/.config/opencode/opencode.json",
      content: JSON.stringify({
        provider: {
          "9router": {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: getEffectiveBaseUrl(), apiKey: keyToUse },
            models: modelsObj,
          },
        },
        model: `9router/${activeModelToShow}`,
        agent: {
          explorer: {
            description: "Fast explorer subagent for codebase exploration",
            mode: "subagent",
            model: `9router/${effectiveSubagentModel}`
          }
        }
      }, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/opencode.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-[13px]">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-success)]/10 text-[var(--color-success)] dark:text-green-400 rounded">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-warning)]/10 text-[var(--color-warning)]  rounded">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-accent)]/10 text-[var(--color-accent)] dark:text-[var(--color-accent)] rounded">Other</span>}
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-[var(--color-text-muted)] text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking OpenCode CLI...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 rounded">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-[var(--color-warning)]">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-[var(--color-warning)] ">OpenCode CLI not detected locally</p>
                    <p className="text-[13px] text-[var(--color-text-muted)]">Manual configuration is still available if 9router is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-[var(--color-warning)]/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    <span className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-[13px]">
                    <div>
                      <p className="text-[var(--color-text-muted)] mb-1">macOS / Linux:</p>
                      <code className="block px-3 py-2 bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded font-mono text-[11px]">npm install -g opencode-ai</code>
                    </div>
                    <p className="text-[var(--color-text-muted)]">After installation, run <code className="px-1 bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded">opencode</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Current base URL */}
                {status?.config?.provider?.["9router"]?.options?.baseURL && (
                  <div className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-[13px] font-medium text-[var(--color-text-main)] text-right">Current</span>
                    <span className="material-symbols-outlined text-[var(--color-text-muted)] text-[14px]">arrow_forward</span>
                    <span className="flex-1 px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] truncate">
                      {status.config.provider["9router"].options.baseURL}
                    </span>
                  </div>
                )}

                {/* Base URL */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[13px] font-medium text-[var(--color-text-main)] text-right">Base URL</span>
                  <span className="material-symbols-outlined text-[var(--color-text-muted)] text-[14px]">arrow_forward</span>
                  <input
                    type="text"
                    value={getDisplayUrl()}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="https://.../v1"
                    className="flex-1 px-2 py-1.5 bg-[var(--color-surface)] rounded border border-[var(--color-border)] text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {customBaseUrl && customBaseUrl !== `${baseUrl}/v1` && (
                    <button onClick={() => setCustomBaseUrl("")} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] rounded transition-colors" title="Reset to default">
                      <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                    </button>
                  )}
                </div>

                {/* API Key */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[13px] font-medium text-[var(--color-text-main)] text-right">API Key</span>
                  <span className="material-symbols-outlined text-[var(--color-text-muted)] text-[14px]">arrow_forward</span>
                  {apiKeys?.length > 0 ? (
                    <select value={selectedApiKey} onChange={(e) => setSelectedApiKey(e.target.value)} className="flex-1 px-2 py-1.5 bg-[var(--color-surface)] rounded text-[11px] border border-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-primary/50">
                      {apiKeys.map((key) => <option key={key.id} value={key.key}>{key.key}</option>)}
                    </select>
                  ) : (
                    <span className="flex-1 text-[11px] text-[var(--color-text-muted)] px-2 py-1.5">
                      {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_9router (default)"}
                    </span>
                  )}
                </div>

                {/* Models */}
                <div className="flex items-start gap-2">
                  <span className="w-32 shrink-0 text-[13px] font-medium text-[var(--color-text-main)] text-right pt-1">Models</span>
                  <span className="material-symbols-outlined text-[var(--color-text-muted)] text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-[var(--color-surface)] rounded border border-[var(--color-border)]">
                      {selectedModels?.length === 0 ? (
                        <span className="text-[11px] text-[var(--color-text-muted)]">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span
                            key={model}
                            onClick={async () => {
                              if (model === activeModel) {
                                try {
                                  const res = await fetch("/api/cli-tools/opencode-settings", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ clearActiveModel: true }),
                                  });
                                  if (res.ok) {
                                    setActiveModel("");
                                    checkStatus();
                                  }
                                } catch (error) {
                                  console.log("Error clearing active model:", error);
                                }
                              } else {
                                setActiveModel(model);
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                              model === activeModel
                                ? "bg-[var(--color-primary)]/10 text-[var(--color-accent)] border border-primary"
                                : "bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-transparent hover:border-[var(--color-border)]"
                            }`}
                            title={model === activeModel ? "Click to clear active model" : "Click to set as active"}
                          >
                            {model === activeModel && <span className="material-symbols-outlined text-[10px]">star</span>}
                            {model}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await fetch(`/api/cli-tools/opencode-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
                                  if (res.ok) {
                                    const newModels = selectedModels.filter((m) => m !== model);
                                    setSelectedModels(newModels);
                                    if (activeModel === model) {
                                      setActiveModel("");
                                    }
                                    checkStatus();
                                  }
                                } catch (error) {
                                  console.log("Error removing model:", error);
                                }
                              }}
                              className="ml-0.5 hover:text-[var(--color-danger)]"
                            >
                              <span className="material-symbols-outlined text-[12px]">close</span>
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`px-2 py-1 rounded border text-[11px] transition-colors ${activeProviders?.length ? "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-main)] hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-[var(--color-border)]"}`}>Add Model</button>
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {selectedModels?.length > 0 && activeModel ? (
                          <>Active: <span className="text-[var(--color-accent)]">{activeModel}</span></>
                        ) : selectedModels?.length > 0 ? (
                          <span className="text-[var(--color-warning)]">Click a model to set/clear active</span>
                        ) : (
                          "Select models to add"
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subagent Model */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[13px] font-medium text-[var(--color-text-main)] text-right">Subagent Model</span>
                  <span className="material-symbols-outlined text-[var(--color-text-muted)] text-[14px]">arrow_forward</span>
                  <input 
                    type="text" 
                    value={subagentModel} 
                    onChange={(e) => setSubagentModel(e.target.value)} 
                    placeholder={selectedModel || "provider/model-id (defaults to main model)"} 
                    className="flex-1 px-2 py-1.5 bg-[var(--color-surface)] rounded border border-[var(--color-border)] text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50" 
                  />
                  <button 
                    onClick={() => setSubagentModalOpen(true)} 
                    disabled={!activeProviders?.length} 
                    className={`px-2 py-1.5 rounded border text-[11px] transition-colors shrink-0 whitespace-nowrap ${activeProviders?.length ? "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-main)] hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-[var(--color-border)]"}`}
                  >
                    Select Model
                  </button>
                  {subagentModel && (
                    <button 
                      onClick={() => setSubagentModel("")} 
                      className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] rounded transition-colors" 
                      title="Clear (will use main model)"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] ${message.type === "success" ? "bg-[var(--color-success)]/10 text-[var(--color-success)]" : "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels?.length === 0} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!status.has9Router} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(model) => { 
          if (!selectedModels.includes(model.value)) {
            setSelectedModels([...selectedModels, model.value]);
            if (!activeModel) setActiveModel(model.value);
          }
          setModalOpen(false);
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Model for OpenCode"
      />

      <ModelSelectModal
        isOpen={subagentModalOpen}
        onClose={() => setSubagentModalOpen(false)}
        onSelect={(model) => { setSubagentModel(model.value); setSubagentModalOpen(false); }}
        selectedModel={subagentModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Subagent Model for OpenCode"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="OpenCode - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
