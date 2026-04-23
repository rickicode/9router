"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";

export default function CopilotToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);

  // Model list management
  const [modelInput, setModelInput] = useState("");
  const [modelList, setModelList] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

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

  // Pre-fill model list from existing config
  useEffect(() => {
    if (status?.config && Array.isArray(status.config) && modelList?.length === 0) {
      const entry = status.config.find((e) => e.name === "9Router");
      if (entry?.models?.length > 0) {
        setModelList(entry.models.map((m) => m.id));
      }
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
    if (!status) return null;
    if (!status.has9Router) return "not_configured";
    const url = status.currentUrl || "";
    return url.includes("localhost") || url.includes("127.0.0.1") || url.includes(baseUrl)
      ? "configured" : "other";
  };

  const configStatus = getConfigStatus();
  const getEffectiveBaseUrl = () => baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

  const addModel = () => {
    const val = modelInput.trim();
    if (!val || modelList.includes(val)) return;
    setModelList((prev) => [...prev, val]);
    setModelInput("");
  };

  const removeModel = (id) => setModelList((prev) => prev.filter((m) => m !== id));

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/copilot-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ error: error.message });
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

      const res = await fetch("/api/cli-tools/copilot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models: modelList }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Settings applied successfully!" });
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
      const res = await fetch("/api/cli-tools/copilot-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setModelList([]);
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
    const effectiveBaseUrl = getEffectiveBaseUrl();

    return [{
      filename: "~/Library/Application Support/Code/User/chatLanguageModels.json",
      content: JSON.stringify([{
        name: "9Router",
        vendor: "azure",
        apiKey: keyToUse,
        models: modelList.map((id) => ({
          id, name: id,
          url: `${effectiveBaseUrl}/chat/completions#models.ai.azure.com`,
          toolCalling: true, vision: false,
          maxInputTokens: 128000, maxOutputTokens: 16000,
        })),
      }], null, 2),
    }];
  };

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/copilot.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
              <span>Checking Copilot config...</span>
            </div>
          )}

          {!checking && (
            <>
              {/* Info */}
              <div className="flex items-start gap-3 p-3 bg-[var(--color-accent)]/10 border border-[rgba(0,122,255,0.3)] rounded">
                <span className="material-symbols-outlined text-[var(--color-accent)] text-[16px]">info</span>
                <div className="text-[11px] text-[var(--color-accent-hover)] ">
                  <p className="font-medium">Writes to <code className="px-1 bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded">chatLanguageModels.json</code></p>
                  <p className="mt-0.5 opacity-80">Reload VS Code after applying for changes to take effect.</p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {/* API Key */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-[var(--color-text-muted)]">API Key</label>
                  {apiKeys?.length > 0 ? (
                    <select value={selectedApiKey} onChange={(e) => setSelectedApiKey(e.target.value)} className="px-3 py-2 bg-[var(--color-bg-alt)]-secondary rounded text-[13px] border border-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-primary/50">
                      {apiKeys.map((key) => <option key={key.id} value={key.key}>{key.key}</option>)}
                    </select>
                  ) : (
                    <span className="text-[13px] text-[var(--color-text-muted)]">
                      {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_9router (default)"}
                    </span>
                  )}
                </div>

                {/* Model input + Add */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-[var(--color-text-muted)]">
                    Models {modelList?.length > 0 && <span className="text-[var(--color-accent)]">({modelList?.length} added)</span>}
                  </label>

                  {/* Model list */}
                  {modelList?.length > 0 && (
                    <div className="flex flex-col gap-1 mb-1">
                      {modelList.map((id) => (
                        <div key={id} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-bg-alt)]-secondary rounded border border-[var(--color-border)]">
                          <span className="flex-1 text-[13px] font-mono truncate">{id}</span>
                          <button onClick={() => removeModel(id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors" title="Remove">
                            <span className="material-symbols-outlined text-[14px]">close</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addModel()}
                      placeholder="provider/model-id"
                      className="flex-1 px-3 py-2 bg-[var(--color-bg-alt)]-secondary rounded text-[13px] border border-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`px-3 py-2 rounded border text-[13px] transition-colors shrink-0 ${activeProviders?.length ? "bg-[var(--color-bg-alt)]-secondary border-[var(--color-border)] hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-[var(--color-border)]"}`}>Select</button>
                    <button onClick={addModel} disabled={!modelInput.trim()} className="px-3 py-2 rounded border text-[13px] bg-[var(--color-bg-alt)]-secondary border-[var(--color-border)] hover:border-primary transition-colors shrink-0 disabled:opacity-50" title="Add model">
                      <span className="material-symbols-outlined text-[16px]">add</span>
                    </button>
                  </div>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] ${message.type === "success" ? "bg-[var(--color-success)]/10 text-[var(--color-success)]" : "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={modelList?.length === 0} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!status?.has9Router} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} disabled={modelList?.length === 0}>
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
        onSelect={(model) => { setModelInput(model.value); setModalOpen(false); }}
        selectedModel={modelInput}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for GitHub Copilot"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="GitHub Copilot - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
