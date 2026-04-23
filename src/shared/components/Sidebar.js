"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "./Button";
import { ConfirmModal } from "./Modal";

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts"];

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota", icon: "data_usage" },
  { href: "/dashboard/mitm", label: "MITM", icon: "security" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
  { href: "/dashboard/opencode", label: "OpenCode", icon: "extension" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [showShutdownModal, setShowShutdownModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [redisInfo, setRedisInfo] = useState(null);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = "npm install -g 9router@latest";

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => {
        if (data.enableTranslator) setEnableTranslator(true);
        setRedisInfo(data.redis || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/version")
      .then(res => res.json())
      .then(data => { if (data.hasUpdate) setUpdateInfo(data); })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  const redisStatus = (() => {
    if (!redisInfo) return null;
    const serverName = redisInfo.server?.name || redisInfo.server?.url || "Redis";
    const ready = redisInfo.lastStatus?.ready === true;
    const configured = redisInfo.enabled === true || Boolean(redisInfo.server);
    if (ready) {
      return { label: "Redis Active", detail: serverName, dotClassName: "bg-[var(--color-success)]" };
    }
    if (configured) {
      return { label: "Redis Offline", detail: serverName, dotClassName: "bg-[var(--color-warning)]" };
    }
    return { label: "Local DB", detail: "Fallback", dotClassName: "bg-[var(--color-text-muted)]" };
  })();

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch (e) {}
    setIsShuttingDown(false);
    setShowShutdownModal(false);
    setIsDisconnected(true);
  };

  return (
    <>
      <aside className="flex w-56 flex-col h-full bg-[var(--color-sidebar)]">
        {/* Logo & Branding */}
        <div className="px-4 py-4 border-b border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded flex items-center justify-center bg-[var(--color-accent)]">
              <span className="material-symbols-outlined text-[18px] text-white">hub</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[14px] font-medium text-white">{APP_CONFIG.name}</span>
              <span className="text-[11px] text-white/60">v{APP_CONFIG.version}</span>
            </div>
          </Link>
          {updateInfo && (
            <button
              onClick={() => copy(INSTALL_CMD)}
              className="mt-3 w-full flex flex-col gap-0.5 text-left hover:opacity-80 transition-opacity cursor-pointer rounded p-2 bg-white/5 border border-white/10"
            >
              <span className="text-[11px] font-medium text-[var(--color-accent)]">
                Update: v{updateInfo.latestVersion}
              </span>
              <code className="text-[10px] text-white/60 font-mono truncate">
                {copied ? "✓ copied!" : INSTALL_CMD}
              </code>
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-150 no-underline",
                isActive(item.href)
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
            >
              <span className={cn("material-symbols-outlined text-[16px]", isActive(item.href) ? "fill-1" : "")}>
                {item.icon}
              </span>
              <span className="text-[13px] font-medium">{item.label}</span>
            </Link>
          ))}

          {/* System section */}
          <div className="pt-3 mt-3 border-t border-white/10">
            <p className="px-2.5 text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5">
              System
            </p>

            {/* Media Providers accordion */}
            <button
              onClick={() => setMediaOpen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-150",
                pathname.startsWith("/dashboard/media-providers")
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
            >
              <span className="material-symbols-outlined text-[16px]">perm_media</span>
              <span className="text-[13px] font-medium flex-1 text-left">Media</span>
              <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                expand_more
              </span>
            </button>
            {mediaOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150 no-underline",
                      pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                        ? "bg-white/10 text-[var(--color-accent)]"
                        : "text-white/60 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <span className="material-symbols-outlined text-[14px]">{kind.icon}</span>
                    <span className="text-[12px]">{kind.label}</span>
                  </Link>
                ))}
              </div>
            )}

            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-150 no-underline",
                  isActive(item.href)
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                )}
              >
                <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                <span className="text-[13px] font-medium">{item.label}</span>
              </Link>
            ))}

            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-150 no-underline",
                    isActive(item.href)
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              className={cn(
                "flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-150 no-underline",
                isActive("/dashboard/profile")
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
            >
              <span className="material-symbols-outlined text-[16px]">settings</span>
              <span className="text-[13px] font-medium">Settings</span>
            </Link>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-white/10 space-y-3">
          {redisStatus && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-white/5 text-[11px]">
              <span className="relative flex h-1.5 w-1.5">
                <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", redisStatus.dotClassName)} />
                <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", redisStatus.dotClassName)} />
              </span>
              <span className="text-white font-medium">{redisStatus.label}</span>
              <span className="text-white/40 ml-auto truncate max-w-[80px]">{redisStatus.detail}</span>
            </div>
          )}
          <Button
            variant="ghost"
            fullWidth
            icon="power_settings_new"
            onClick={() => setShowShutdownModal(true)}
            className="text-[var(--color-danger)] hover:bg-white/10"
          >
            <span className="text-[12px]">Shutdown</span>
          </Button>
        </div>
      </aside>

      <ConfirmModal
        isOpen={showShutdownModal}
        onClose={() => setShowShutdownModal(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />

      {isDisconnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-sidebar)]">
          <div className="text-center p-8">
            <div className="w-12 h-12 rounded-full bg-[var(--color-danger)]/20 text-[var(--color-danger)] mx-auto mb-4 flex items-center justify-center">
              <span className="material-symbols-outlined text-[24px]">power_off</span>
            </div>
            <h2 className="text-[16px] font-bold text-white mb-2">Server Disconnected</h2>
            <p className="text-[13px] text-white/60 mb-6">The proxy server has been stopped.</p>
            <Button variant="secondary" onClick={() => globalThis.location.reload()}>
              Reload Page
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = { onClose: PropTypes.func };
