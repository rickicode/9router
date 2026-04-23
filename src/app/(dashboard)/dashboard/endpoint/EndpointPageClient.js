"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const TUNNEL_BENEFITS = [
  { icon: "public", title: "Access Anywhere", desc: "Use your API from any network" },
  { icon: "group", title: "Share Endpoint", desc: "Share URL with team members" },
  { icon: "code", title: "Use in Cursor/Cline", desc: "Connect AI tools remotely" },
  { icon: "lock", title: "Encrypted", desc: "End-to-end TLS via Cloudflare" },
];

const TUNNEL_PING_INTERVAL_MS = 2000;
const TUNNEL_PING_MAX_MS = 300000;
export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
  const [rtkEnabled, setRtkEnabledState] = useState(false);

  // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef(null);

  // API key visibility toggle state
  const [visibleKeys, setVisibleKeys] = useState(new Set());

  const { copied, copy } = useCopyToClipboard();

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status")
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRequireApiKey(data.requireApiKey || false);
        setRequireLogin(data.requireLogin !== false);
        setHasPassword(data.hasPassword || false);
        setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
        setRtkEnabledState(data.rtkEnabled || false);
      }
      if (statusRes.ok) {
        const data = await statusRes.json();
        const tEnabled = data.tunnel?.enabled || false;
        const tUrl = data.tunnel?.tunnelUrl || "";
        const tPublicUrl = data.tunnel?.publicUrl || "";
        setTunnelUrl(tUrl);
        setTunnelPublicUrl(tPublicUrl);
        const tsEn = data.tailscale?.enabled || false;
        const tsUrlVal = data.tailscale?.tunnelUrl || "";
        setTsUrl(tsUrlVal);

        if (tsEn && tsUrlVal) {
          setTsLoading(true);
          setTsProgress("Checking Tailscale...");
          const tsHealthUrl = `${tsUrlVal}/api/health`;
          try {
            const tsPing = await fetch(tsHealthUrl, { mode: "no-cors", cache: "no-store" });
            if (tsPing.ok || tsPing.type === "opaque") {
              setTsEnabled(true);
            } else {
              const ok = await pingTsHealth(tsUrlVal);
              setTsEnabled(ok);
              if (!ok) setTsStatus({ type: "warning", message: "Tailscale not reachable." });
            }
          } catch {
            const ok = await pingTsHealth(tsUrlVal);
            setTsEnabled(ok);
            if (!ok) setTsStatus({ type: "warning", message: "Tailscale not reachable." });
          } finally {
            setTsLoading(false);
            setTsProgress("");
          }
        } else {
          setTsEnabled(tsEn);
        }

        if (tEnabled && (tPublicUrl || tUrl)) {
          // Ping once to verify reachable
          const healthUrl = `${tPublicUrl || tUrl}/api/health`;
          try {
            const ping = await fetch(healthUrl, { cache: "no-store" });
            if (ping.ok) {
              setTunnelEnabled(true);
            } else {
              pingTunnelHealth(tPublicUrl || tUrl);
            }
          } catch {
            pingTunnelHealth(tPublicUrl || tUrl);
          }
        } else {
          setTunnelEnabled(tEnabled);
        }
      }
    } catch (error) {
      console.log("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) setTunnelDashboardAccess(value);
    } catch (error) {
      console.log("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const fetchData = async () => {
    try {
      const keysRes = await fetch("/api/keys");
      const keysData = await keysRes.json();
      if (keysRes.ok) {
        setKeys(keysData.keys || []);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // u2500u2500u2500 Cloudflare Tunnel handlers
  // Ping tunnel health until reachable, also check backend status to detect process die
  const pingTunnelHealth = async (url) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") {
          setTunnelEnabled(true);
          setTunnelLoading(false);
          setTunnelProgress("");
          return true;
        }
      } catch { /* not ready yet */ }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
              setTunnelLoading(false);
              setTunnelProgress("");
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: "error", message: "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              setTunnelProgress(`Downloading cloudflared... ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      const data = await res.json();
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
        return;
      }

      const url = data.publicUrl || data.tunnelUrl;
      if (!url) {
        setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
        return;
      }

      setTunnelUrl(data.tunnelUrl || "");
      setTunnelPublicUrl(data.publicUrl || "");
      await pingTunnelHealth(url);
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setTunnelPublicUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  // u2500u2500u2500 Tailscale handlers
  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: data.error || "Install failed" });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  const handleConnectTailscale = async (preOpenedTab) => {
    const tab = preOpenedTab || null;
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        if (tab) tab.close();
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        if (reachable) {
          setTsEnabled(true);
          setTsStatus(null);
        } else {
          setTsEnabled(true);
          setTsStatus({ type: "warning", message: "Connected but not reachable yet." });
        }
        return;
      }

      // Needs login: redirect pre-opened tab or open new
      if (data.needsLogin && data.authUrl) {
        if (tab) tab.location.href = data.authUrl;
        else window.open(data.authUrl, "tailscale_auth", "width=600,height=700");
        setTsProgress("Waiting for login...");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  if (tab) tab.close();
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  if (ok2) {
                    setTsEnabled(true);
                    setTsStatus(null);
                  } else {
                    setTsEnabled(true);
                    setTsStatus({ type: "warning", message: "Connected but not reachable yet." });
                  }
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl, tab);
                } else {
                  setTsStatus({ type: "error", message: data2.error || "Failed to start funnel" });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }

      // Funnel not enabled: redirect pre-opened tab
      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl, tab);
        return;
      }

      if (tab) tab.close();
      setTsStatus({ type: "error", message: data.error || "Failed to connect" });
    } catch (error) {
      if (tab) tab.close();
      setTsStatus({ type: "error", message: error.message });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
    }
  };

  const pollFunnelEnable = async (enableUrl, tab) => {
    if (tab) tab.location.href = enableUrl;
    else window.open(enableUrl, "tailscale_auth", "width=600,height=700");
    setTsProgress("Enable Funnel in browser, waiting...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          if (tab) tab.close();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          if (ok3) {
            setTsEnabled(true);
            setTsStatus(null);
          } else {
            setTsEnabled(true);
            setTsStatus({ type: "warning", message: "Connected but not reachable yet." });
          }
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch { /* retry */ }
    }
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: data.error || "Failed to disable Tailscale" });
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    setShowTsModal(true);
    await checkTailscaleInstalled();
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm("Delete this API key?")) return;

    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys(keys.filter((k) => k.id !== id));
        // Clean up visibility state
        setVisibleKeys(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch (error) {
      console.log("Error deleting key:", error);
    }
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const maskKey = (fullKey) => {
    if (!fullKey) return "";
    return fullKey.length > 8 ? fullKey.slice(0, 8) + "..." : fullKey;
  };

  const toggleKeyVisibility = (keyId) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const [baseUrl, setBaseUrl] = useState("/v1");

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  const currentEndpoint = baseUrl;

  return (
    <div className="flex flex-col gap-8">
      {/* Endpoint Card */}
      <Card>
        <h2 className="text-[16px] font-medium mb-4">API Endpoint</h2>

        {/* Endpoint rows */}
        <div className="flex flex-col gap-2">
          {/* Local */}
          <EndpointRow
            label="Local"
            url={currentEndpoint}
            copyId="local_url"
            copied={copied}
            onCopy={copy}
          />
          {/* Cloudflare Tunnel */}
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[68px] text-center ${
              tunnelEnabled ? "bg-[rgba(255,159,10,0.15)] dark:bg-[rgba(255,159,10,0.2)] text-[var(--color-warning)] dark:text-[var(--color-warning)]" : "bg-[var(--color-primary)] text-[var(--color-text-muted)]"
            }`}>Tunnel</span>
            {tunnelEnabled && !tunnelLoading ? (
              <>
                <Input value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-[13px]" />
                <button
                  onClick={() => copy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")}
                  className="p-2 hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[var(--color-surface)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "tunnel_url" ? "check" : "content_copy"}</span>
                </button>
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className="p-2 hover:bg-[var(--color-danger)]/10 rounded text-[var(--color-danger)] transition-colors shrink-0"
                  title="Disable Tunnel"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelLoading ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-input-bg)] text-[13px] text-[var(--color-text-muted)]">
                  <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                  {tunnelProgress || "Creating tunnel..."}
                </div>
                <button
                  onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                  className="p-2 hover:bg-[var(--color-danger)]/10 rounded text-[var(--color-danger)] transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelStatus?.type === "error" ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-[rgba(255,59,48,0.4)] dark:border-[rgba(200,0,0,0.6)] bg-[rgba(255,59,48,0.05)] text-[13px] text-[var(--color-danger)] dark:text-[var(--color-danger)]">
                  <span className="material-symbols-outlined text-[13px]">error</span>
                  {tunnelStatus.message}
                </div>
                <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
              </>
            ) : tunnelChecking ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-input-bg)] text-[13px] text-[var(--color-text-muted)]">
                  <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                  Checking...
                </div>
                <button
                  onClick={() => setTunnelChecking(false)}
                  className="p-2 hover:bg-[var(--color-danger)]/10 rounded text-[var(--color-danger)] transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : (
              <Button
                size="sm"
                icon="cloud_upload"
                onClick={() => {
                  if (!requireApiKey) {
                    setTunnelStatus({ type: "error", message: "Security required: Enable \"Require API key\" before activating the tunnel." });
                    return;
                  }
                  setShowEnableTunnelModal(true);
                }}
                className="   text-[var(--color-text-main)]!"
              >
                Enable
              </Button>
            )}
          </div>
          {/* Tailscale */}
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[68px] text-center ${
              tsEnabled ? "bg-[rgba(120,80,255,0.15)] dark:bg-[rgba(120,80,255,0.2)] text-[var(--color-accent)]" : "bg-[var(--color-primary)] text-[var(--color-text-muted)]"
            }`}>Tailscale</span>
            {tsEnabled && !tsLoading ? (
              <>
                <Input value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-[13px]" />
                <button
                  onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                  className="p-2 hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[var(--color-surface)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "ts_url" ? "check" : "content_copy"}</span>
                </button>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className="p-2 hover:bg-[var(--color-danger)]/10 rounded text-[var(--color-danger)] transition-colors shrink-0"
                  title="Disable Tailscale"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : (tsLoading || tsConnecting) ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-input-bg)] text-[13px] text-[var(--color-text-muted)]">
                  <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                  {tsProgress || "Connecting..."}
                </div>
                <button
                  onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(""); }}
                  className="p-2 hover:bg-[var(--color-danger)]/10 rounded text-[var(--color-danger)] transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tsStatus?.type === "error" ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-[rgba(255,59,48,0.4)] dark:border-[rgba(200,0,0,0.6)] bg-[rgba(255,59,48,0.05)] text-[13px] text-[var(--color-danger)] dark:text-[var(--color-danger)]">
                  <span className="material-symbols-outlined text-[13px]">error</span>
                  {tsStatus.message}
                </div>
                <Button size="sm" icon="vpn_lock" onClick={handleOpenTsModal}>Enable</Button>
              </>
            ) : (
              <Button
                size="sm"
                icon="vpn_lock"
                onClick={handleOpenTsModal}
                className="   text-[var(--color-text-main)]!"
              >
                Enable
              </Button>
            )}
          </div>
        </div>

        {/* Security warnings when tunnel or tailscale is active */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 flex flex-col gap-2">
            {!requireApiKey && (
              <SecurityWarning
                message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                action={{ label: "Enable", href: "#require-api-key" }}
              />
            )}
            {(!requireLogin || !hasPassword) && (
              <SecurityWarning
                message={
                  !requireLogin
                    ? "Require login is disabled — anyone can access your dashboard via tunnel."
                    : "Dashboard uses the default password — change it in Profile settings."
                }
                action={{
                  label: !requireLogin ? "Enable" : "Change password",
                  href: "/dashboard/profile",
                }}
              />
            )}
          </div>
        )}

        {/* Tunnel dashboard access option */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex items-center gap-3">
            <Toggle
              checked={tunnelDashboardAccess}
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-[13px]">Allow dashboard access via tunnel</p>
              <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
            </div>
          </div>
        )}
      </Card>

      {/* Token Saver (RTK) */}
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-medium">Token Saver</h2>
            <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-amber-500/15 text-[var(--color-warning)] dark:text-[var(--color-warning)] border border-[rgba(255,159,10,0.3)]">
              Experimental
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="pr-4">
            <p className="font-medium">Compress tool output</p>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              Auto-compress git diff / status / grep / find / ls / tree / logs in <code>tool_result</code> before sending to LLM. Check server console for <code>[RTK] saved ...</code> log.
            </p>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              Inspired by{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--color-accent)]"
              >
                RTK (Rust Token Killer)
              </a>
              {" "}— ported to JavaScript. This feature is still under testing; disable it if you notice unexpected results.
            </p>
          </div>
          <Toggle
            checked={rtkEnabled}
            onChange={() => handleRtkEnabled(!rtkEnabled)}
          />
        </div>
      </Card>

      {/* API Keys */}
      <Card id="require-api-key">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-medium">API Keys</h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[var(--color-border)]">
          <div>
            <p className="font-medium">Require API key</p>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              Requests without a valid key will be rejected
            </p>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => handleRequireApiKey(!requireApiKey)}
          />
        </div>

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded bg-[var(--color-primary)]/10 text-[var(--color-accent)] mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-[var(--color-text-main)] font-medium mb-1">No API keys yet</p>
            <p className="text-[13px] text-[var(--color-text-muted)] mb-4">Create your first API key to get started</p>
            <Button icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`group flex items-center justify-between py-3 border-b border-[var(--color-border)]  last:border-b-0 ${key.isActive === false ? "opacity-60" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium">{key.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-[11px] text-[var(--color-text-muted)] font-mono">
                      {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                    </code>
                    <button
                      onClick={() => toggleKeyVisibility(key.id)}
                      className="p-1 hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[var(--color-surface)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-all"
                      title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                    <button
                      onClick={() => copy(key.key, key.id)}
                      className="p-1 hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[var(--color-surface)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copied === key.id ? "check" : "content_copy"}
                      </span>
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                  {key.isActive === false && (
                    <p className="text-[11px] text-[var(--color-warning)] mt-1">Paused</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    size="sm"
                    checked={key.isActive ?? true}
                    onChange={(checked) => {
                      if (key.isActive && !checked) {
                        if (confirm(`Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`)) {
                          handleToggleKey(key.id, checked);
                        }
                      } else {
                        handleToggleKey(key.id, checked);
                      }
                    }}
                    title={key.isActive ? "Pause key" : "Resume key"}
                  />
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="p-2 hover:bg-[var(--color-danger)]/10 rounded text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-[var(--color-warning)]/10 border border-[rgba(255,203,0,0.3)]  rounded p-4">
            <p className="text-[13px] text-[var(--color-warning)]  mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-[13px] text-[var(--color-warning)] ">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 font-mono text-[13px]"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-[var(--color-accent)]/10 dark:bg-blue-900/20 border border-[rgba(0,122,255,0.3)] dark:border-[rgba(0,80,150,0.6)] rounded p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[var(--color-accent)] dark:text-[var(--color-accent)]">cloud_upload</span>
              <div>
                <p className="text-[13px] text-[var(--color-accent)]  font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-[13px] text-[var(--color-accent-hover)] ">
                  Expose your local 9Router to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded bg-[var(--color-primary)]/50">
                <span className="material-symbols-outlined text-[20px] text-[var(--color-accent)] mb-1">{benefit.icon}</span>
                <p className="text-[11px] font-medium">{benefit.title}</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-[var(--color-text-muted)]">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button
              onClick={handleEnableTunnel}
              fullWidth
              className="   text-[var(--color-text-main)]!"
            >
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-[var(--color-text-muted)]">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} className="bg-[var(--color-danger)]! hover:bg-[var(--color-danger-hover)]! text-[var(--color-text-main)]!">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-[var(--color-text-muted)]">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button
                  onClick={handleInstallTailscale}
                  fullWidth
                  className="   text-[var(--color-text-main)]!"
                >
                  Install Tailscale
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
                <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-[rgba(0,0,0,0.05)] dark:bg-[var(--color-surface)] rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px] text-[var(--color-text-muted)]">
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[13px] text-[var(--color-success)]">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    const tab = window.open("", "tailscale_auth", "width=600,height=700");
                    if (tab) tab.document.write("<p style='font-family:sans-serif;text-align:center;margin-top:40px'>Connecting to Tailscale...</p>");
                    handleConnectTailscale(tab);
                  }}
                  fullWidth
                  className="   text-[var(--color-text-main)]!"
                >
                  Connect
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-[var(--color-text-muted)]">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} className="bg-[var(--color-danger)]! hover:bg-[var(--color-danger-hover)]! text-[var(--color-text-main)]!">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Reusable endpoint row component */
function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[68px] text-center ${badge === "CF" ? "bg-[rgba(255,159,10,0.15)] dark:bg-[rgba(255,159,10,0.2)] text-[var(--color-warning)] dark:text-[var(--color-warning)]" :
          badge === "TS" ? "bg-[rgba(120,80,255,0.15)] dark:bg-[rgba(120,80,255,0.2)] text-[var(--color-accent)]" :
            "bg-[var(--color-primary)] text-[var(--color-text-muted)]"
        }`}>{label}</span>
      <Input value={url} readOnly className="flex-1 font-mono text-[13px]" />
      <button
        onClick={() => onCopy(url, copyId)}
        className="p-2 hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[var(--color-surface)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors shrink-0"
      >
        <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
      </button>
      {actions}
    </div>
  );
}

/** Reusable status alert */
function StatusAlert({ status, className = "" }) {
  // Render URLs in message as clickable links
  const renderMessage = (msg) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline font-medium">{part}</a>
        : part
    );
  };

  return (
    <div className={`p-2 rounded text-[13px] ${className} ${status.type === "success" ? "bg-[var(--color-success)]/10 text-[var(--color-success)]" :
        status.type === "warning" ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)]" :
        status.type === "info" ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] dark:text-[var(--color-accent)]" :
          "bg-[var(--color-danger)]/10 text-[var(--color-danger)] dark:text-[var(--color-danger)]"
      }`}>
      {renderMessage(status.message)}
    </div>
  );
}

/** Inline tooltip, Claude Code CLI style */
function Tooltip({ text }) {
  return (
    <span className="relative group inline-flex items-center">
      <span className="material-symbols-outlined text-[14px] text-[var(--color-text-muted)] cursor-help">help</span>
      <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 z-50 w-64 rounded bg-[var(--color-primary)] dark:bg-[var(--color-surface)] text-[var(--color-text-main)] text-[11px] px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity ">
        {text}
      </span>
    </span>
  );
}

/** Security warning banner with optional action link */
function SecurityWarning({ message, action }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--color-warning)]/10 border border-[rgba(255,159,10,0.2)] text-[var(--color-warning)] dark:text-[var(--color-warning)]">
      <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">warning</span>
      <p className="text-[11px] flex-1">{message}</p>
      {action && (
        <a
          href={action.href}
          className="text-[11px] font-medium underline shrink-0 hover:opacity-80"
          onClick={action.href.startsWith("#") ? (e) => {
            e.preventDefault();
            document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
          } : undefined}
        >
          {action.label}
        </a>
      )}
    </div>
  );
}

APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};

