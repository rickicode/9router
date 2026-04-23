"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  default: "bg-[var(--color-bg-alt)] text-[var(--color-text-muted)]",
  primary: "bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
  success: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  info: "bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
};

const sizes = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-[11px]",
  lg: "px-3 py-1.5 text-[12px]",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  icon,
  className,
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded font-medium",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            variant === "success" && "bg-[var(--color-success)]",
            variant === "warning" && "bg-[var(--color-warning)]",
            variant === "danger" && "bg-[var(--color-danger)]",
            variant === "info" && "bg-[var(--color-accent)]",
            variant === "primary" && "bg-[var(--color-accent)]",
            variant === "default" && "bg-[var(--color-text-muted)]"
          )}
        />
      )}
      {icon && <span className="material-symbols-outlined text-[12px]">{icon}</span>}
      {children}
    </span>
  );
}
