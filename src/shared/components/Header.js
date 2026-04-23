"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import Link from "next/link";
import PropTypes from "prop-types";
import HeaderMenu from "./HeaderMenu";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";

const getPageInfo = (pathname) => {
  if (!pathname) return { title: "", description: "", breadcrumbs: [] };
  
  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = AI_PROVIDERS[providerId];
    return {
      title: provider?.name || providerId,
      breadcrumbs: [
        { label: "Media Providers", href: `/dashboard/media-providers/${kindId}` },
        { label: provider?.name || providerId },
      ],
    };
  }

  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    return { title: kindConfig?.label || kindId, icon: kindConfig?.icon || "perm_media", breadcrumbs: [] };
  }

  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const info = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", cursor: "Cursor" }[providerMatch[1]];
    if (info) return { title: info, breadcrumbs: [{ label: "Providers", href: "/dashboard/providers" }, { label: info }] };
  }

  if (pathname.includes("/providers") && !pathname.includes("/media-providers")) return { title: "Providers", icon: "dns" };
  if (pathname.includes("/combos")) return { title: "Combos", icon: "layers" };
  if (pathname.includes("/usage")) return { title: "Usage", icon: "bar_chart" };
  if (pathname.includes("/quota")) return { title: "Quota", icon: "data_usage" };
  if (pathname.includes("/mitm")) return { title: "MITM Proxy", icon: "security" };
  if (pathname.includes("/cli-tools")) return { title: "CLI Tools", icon: "terminal" };
  if (pathname.includes("/opencode")) return { title: "OpenCode", icon: "extension" };
  if (pathname.includes("/proxy-pools")) return { title: "Proxy Pools", icon: "lan" };
  if (pathname.includes("/endpoint")) return { title: "Endpoint", icon: "api" };
  if (pathname.includes("/profile")) return { title: "Settings", icon: "settings" };
  if (pathname.includes("/translator")) return { title: "Translator", icon: "translate" };
  if (pathname.includes("/console-log")) return { title: "Console Log", icon: "monitor" };
  if (pathname === "/dashboard") return { title: "Endpoint", icon: "api" };
  return { title: "", description: "", breadcrumbs: [] };
};

export default function Header({ onMenuClick }) {
  const pathname = usePathname();
  const router = useRouter();

  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { title, icon, breadcrumbs } = pageInfo;

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) { router.push("/login"); router.refresh(); }
    } catch (err) { console.error("Failed to logout:", err); }
  };

  return (
    <header className="h-12 px-4 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Mobile menu */}
      <div className="flex items-center gap-2 lg:hidden">
        <button onClick={onMenuClick} className="p-1.5 rounded hover:bg-[var(--color-bg-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>
      </div>

      {/* Desktop title */}
      <div className="hidden lg:flex items-center gap-3">
        {breadcrumbs?.length > 0 ? (
          <div className="flex items-center gap-2 text-[13px]">
            {breadcrumbs.map((crumb, index) => (
              <div key={index} className="flex items-center gap-2">
                {index > 0 && <span className="material-symbols-outlined text-[14px] text-[var(--color-text-subtle)]">chevron_right</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors">{crumb.label}</Link>
                ) : (
                  <span className="font-medium text-[var(--color-text-main)]">{crumb.label}</span>
                )}
              </div>
            ))}
          </div>
        ) : title ? (
          <div className="flex items-center gap-2.5">
            {icon && (
              <div className="w-8 h-8 rounded flex items-center justify-center bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                <span className="material-symbols-outlined text-[16px]">{icon}</span>
              </div>
            )}
            <h1 className="text-[14px] font-semibold text-[var(--color-text-main)]">{translate(title)}</h1>
          </div>
        ) : null}
      </div>

      {/* Mobile title */}
      <div className="lg:hidden flex-1">
        {title && !breadcrumbs?.length && <h1 className="text-[14px] font-semibold text-[var(--color-text-main)]">{title}</h1>}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <HeaderMenu onLogout={handleLogout} />
      </div>
    </header>
  );
}

Header.propTypes = { onMenuClick: PropTypes.func };
