"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";

export default function Drawer({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  width = "md",
  className 
}) {
  const widths = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div 
        className="absolute inset-0 bg-black/50  transition-opacity cursor-pointer" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer panel */}
      <div className={cn(
        "absolute right-0 top-0 h-full bg-[var(--color-surface)]  flex flex-col",
        "animate-in slide-in-from-right duration-200",
        "border-l border-black/10 dark:border-white/10",
        widths[width] || widths.md,
        className
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/5 dark:border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            {title && (
              <h2 className="text-[16px] font-medium text-[var(--color-text-main)]">
                {title}
              </h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-[var(--color-text-muted)] hover:bg-[rgba(0,0,0,0.05)] dark:hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
