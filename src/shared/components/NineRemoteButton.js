"use client";

import { useState } from "react";
import NineRemotePromoModal from "./NineRemotePromoModal";

export default function NineRemoteButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-all text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[rgba(255,255,255,0.05)]"
        title="9Remote"
      >
        <span className="material-symbols-outlined text-[18px]">computer</span>
        <span className="text-[12px] font-medium">Remote</span>
      </button>

      <NineRemotePromoModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
