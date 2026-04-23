"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

const FEATURES = [
  { icon: "terminal", label: "Terminal", desc: "Full shell access" },
  { icon: "cast", label: "Desktop", desc: "Screen sharing" },
  { icon: "folder_open", label: "Files", desc: "Browse & edit files" },
];

const BULLETS = [
  { icon: "qr_code_scanner", text: "Scan QR to connect instantly" },
  { icon: "wifi_off", text: "No port forwarding needed" },
  { icon: "devices", text: "Works on any device" },
];

const NINE_REMOTE_URL = "https://9remote.cc";

export default function NineRemotePromoModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onEsc); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(0,0,0,0.6)] " onClick={onClose} />

      <div className="relative w-full max-w-sm rounded overflow-hidden  animate-in fade-in zoom-in-95 duration-200 flex flex-col bg-[var(--color-surface)] border border-black/10 dark:border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: "#FF570A" }}>
              <span className="material-symbols-outlined text-[var(--color-text-main)] text-base">terminal</span>
            </div>
            <span className="text-[12px] font-bold uppercase tracking-wider" style={{ fontFamily: "monospace", color: "#FF570A" }}>9Remote</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.05)] border border-black/5 dark:border-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition-colors"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-7 pb-9 flex flex-col gap-6">
          {/* Hero */}
          <div className="flex flex-col items-center gap-2 text-center mt-2">
            <div
              className="w-14 h-14 rounded flex items-center justify-center mb-1"
              style={{ background: "#FF570A", boxShadow: "rgba(255,87,10,0.35) 0px 8px 32px" }}
            >
              <span className="material-symbols-outlined text-[var(--color-text-main)]" style={{ fontSize: 30 }}>terminal</span>
            </div>
            <h1 className="text-[16px] font-bold text-[var(--color-text-main)] tracking-tight">9Remote</h1>
            <p className="text-[12px] text-[var(--color-text-muted)] leading-5 max-w-[220px]">
              Access your terminal, desktop &amp; files from anywhere
            </p>
          </div>

          {/* Feature cards */}
          <div className="flex gap-2 w-full">
            {FEATURES.map(({ icon, label, desc }) => (
              <div key={label} className="flex-1 flex flex-col items-center gap-1.5 py-4 px-1 rounded border border-black/10 dark:border-white/10 bg-[var(--color-bg-alt)]-alt">
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: "#ff6e33" }}>{icon}</span>
                <p className="text-[12px] font-medium text-[var(--color-text-main)]">{label}</p>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center leading-4">{desc}</p>
              </div>
            ))}
          </div>

          {/* Bullets */}
          <div className="flex flex-col gap-3 w-full">
            {BULLETS.map(({ icon, text }) => (
              <div key={icon} className="flex items-center gap-2.5">
                <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16, color: "#ff6e33" }}>{icon}</span>
                <span className="text-[12px] text-[var(--color-text-muted)]">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={() => window.open(NINE_REMOTE_URL, "_blank")}
            className="w-full py-3.5 flex items-center justify-center gap-2 text-[14px] font-medium text-[var(--color-text-main)] rounded hover:opacity-90 active:scale-[0.98] transition-all"
            style={{ background: "#FF570A", boxShadow: "0 4px 16px rgba(255,87,10,0.35)" }}
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            Get 9Remote
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
