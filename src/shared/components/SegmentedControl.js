"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}) {
  const sizes = {
    sm: "h-7 text-[12px]",
    md: "h-9 text-[14px]",
    lg: "h-11 text-base",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center p-1 rounded",
        "bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.05)]",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "px-4 rounded-md font-medium transition-all",
            sizes[size],
            value === option.value
              ? "bg-[var(--color-surface)] dark:bg-[rgba(255,255,255,0.1)] text-[var(--color-text-main)] "
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]"
          )}
        >
          {option.icon && (
            <span className="material-symbols-outlined text-[16px] mr-1.5">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
