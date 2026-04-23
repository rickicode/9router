"use client";

import { cn } from "@/shared/utils/cn";

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className,
}) {
  const sizes = {
    sm: { track: "w-7 h-4", thumb: "size-2.5", translate: "translate-x-3.5" },
    md: { track: "w-10 h-5", thumb: "size-4", translate: "translate-x-5" },
    lg: { track: "w-12 h-6", thumb: "size-5", translate: "translate-x-6" },
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange && onChange(!checked)}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out",
          "focus:outline-none focus:ring-2 focus:ring-[#007aff] focus:ring-offset-1",
          checked ? "bg-[var(--color-primary)]" : "bg-[rgba(0,0,0,0.15)] dark:bg-[rgba(255,255,255,0.2)]",
          sizes[size].track,
          disabled && "cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block rounded-full bg-[var(--color-surface)] shadow-sm",
            "transform transition duration-200 ease-in-out",
            checked ? sizes[size].translate : "translate-x-0.5",
            sizes[size].thumb,
            "mt-0.5"
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-[13px] font-medium text-[var(--color-text-main)] dark:text-[var(--color-text-inverse)]">
              {label}
            </span>
          )}
          {description && (
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {description}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
