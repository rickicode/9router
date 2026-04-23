"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";

export default function CodexToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus }) {
  const [codexStatus, setCodexStatus] = useState(initialStatus || null);
  const [checkingCodex, setCheckingCodex] = useState(false);
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

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setCodexStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !codexStatus) {
      checkCodexStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  // Parse model and subagent settings from config content
  useEffect(() => {
    if (codexStatus?.config) {
      const modelMatch = codexStatus.config.match(/^model\s*=\s*"([^"]+)"/m);
      if (modelMatch) setSelectedModel(modelMatch[1]);
      
      // Parse subagent settings
      const subagentModelMatch = codexStatus.config.match(/\[agents\.subagent\]\s*\n\s*model\s*=\s*"([^"]+)"/m);
      if (subagentModelMatch) setSubagentModel(subagentModelMatch[1]);
    }
  }, [codexStatus]);

  const getConfigStatus = () => {
    if (!codexStatus?.installed) return null;
    if (!codexStatus.config) return "not_configured";
    const hasBaseUrl = codexStatus.config.includes(baseUrl) || codexStatus.config.includes("localhost") || codexStatus.config.includes("127.0.0.1");
    return hasBaseUrl ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    // Ensure URL ends with /v1
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };
  
  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkCodexStatus = async () => {
    setCheckingCodex(true);
    try {
      const res = await fetch("/api/cli-tools/codex-settings");
      const data = await res.json();
      setCodexStatus(data);
    } catch (error) {
      setCodexStatus({ installed: false, error: error.message });
    } finally {
      setCheckingCodex(false);
    }
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      // Use sk_9router for localhost if no key, otherwise use selected key
      const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
        ? selectedApiKey 
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);
      
      const res = await fetch("/api/cli-tools/codex-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          baseUrl: getEffectiveBaseUrl(), 
          apiKey: keyToUse, 
          model: selectedModel,
          subagentModel: subagentModel || selectedModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkCodexStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/codex-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModel("");
        checkCodexStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleModelSelect = (model) => {
    setSelectedModel(model.value);
    // Auto-set subagent model if not set
    if (!subagentModel) {
      setSubagentModel(model.value);
    }
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
      ? selectedApiKey 
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");
    
    const effectiveSubagentModel = subagentModel || selectedModel;
    
    const configContent = `# 9Router Configuration for Codex CLI
model = "${selectedModel}"
model_provider = "9router"

[model_providers.9router]
name = "9Router"
base_url = "${getEffectiveBaseUrl()}"
wire_api = "responses"

[agents.subagent]
model = "${effectiveSubagentModel}"
`;

    const authContent = JSON.stringify({
      OPENAI_API_KEY: keyToUse
    }, null, 2);

    return [
      {
        filename: "~/.codex/config.toml",
        content: configContent,
      },
      {
        filename: "~/.codex/auth.json",
        content: authContent,
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/codex.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
          {checkingCodex && (
            <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Codex CLI...</span>
            </div>
          )}

          {!checkingCodex && codexStatus && !codexStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 rounded">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-[var(--color-warning)]">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-[var(--color-warning)] ">Codex CLI not detected locally</p>
                    <p className="text-[13px] text-[var(--color-text-muted)]">Manual configuration is still available if 9router is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-[var(--color-warning)]/20 !border-[var(--color-warning)]/40 !text-[var(--color-warning)] !text-[var(--color-warning)] hover:!bg-[var(--color-warning)]/30">
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
                      <p className="text-[var(--color-text-muted)] mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded font-mono text-[11px]">npm install -g @openai/codex</code>
                    </div>
                    <p className="text-[var(--color-text-muted)]">After installation, run <code className="px-1 bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded">codex</code> to verify.</p>
                    <div className="pt-2 border-t border-[var(--color-border)]">
                      <p className="text-[var(--color-text-muted)] text-[11px]">
                        Codex uses <code className="px-1 bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded">~/.codex/auth.json</code> with <code className="px-1 bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded">OPENAI_API_KEY</code>. 
                        Click &quot;Apply&quot; to auto-configure.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingCodex && codexStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Current Base URL */}
                {codexStatus?.config && (() => {
                  const parsed = codexStatus.config.match(/base_url\s*=\s*"([^"]+)"/);
                  const currentBaseUrl = parsed ? parsed[1] : null;
                  return currentBaseUrl ? (
                    <div className="flex items-center gap-2">
                      <span className="w-32 shrink-0 text-[13px] font-medium text-[var(--color-text-main)] text-right">Current</span>
                      <span className="material-symbols-outlined text-[var(--color-text-muted)] text-[14px]">arrow_forward</span>
                      <span className="flex-1 px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] truncate">
                        {currentBaseUrl}
                      </span>
                    </div>
                  ) : null;
                })()}

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

                {/* Model */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[13px] font-medium text-[var(--color-text-main)] text-right">Model</span>
                  <span className="material-symbols-outlined text-[var(--color-text-muted)] text-[14px]">arrow_forward</span>
                  <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="flex-1 px-2 py-1.5 bg-[var(--color-surface)] rounded border border-[var(--color-border)] text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`px-2 py-1.5 rounded border text-[11px] transition-colors shrink-0 whitespace-nowrap ${activeProviders?.length ? "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-main)] hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-[var(--color-border)]"}`}>Select Model</button>
                  {selectedModel && <button onClick={() => setSelectedModel("")} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
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
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={(!selectedApiKey && (cloudEnabled && apiKeys?.length > 0)) || !selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={restoring} loading={restoring}>
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
        onSelect={handleModelSelect}
        selectedModel={selectedModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Codex"
      />

      <ModelSelectModal
        isOpen={subagentModalOpen}
        onClose={() => setSubagentModalOpen(false)}
        onSelect={(model) => { setSubagentModel(model.value); setSubagentModalOpen(false); }}
        selectedModel={subagentModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Subagent Model for Codex"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Codex CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
