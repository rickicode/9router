"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-[var(--color-primary)] text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]",
  secondary: "bg-transparent text-[var(--color-text-main)] border border-[var(--color-border-strong)] hover:bg-[var(--color-bg-alt)]",
  ghost: "bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-alt)] hover:text-[var(--color-text-main)]",
  danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
};

const sizes = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-9 px-4 text-[13px]",
  lg: "h-11 px-5 text-[14px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 cursor-pointer rounded",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[16px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className="material-symbols-outlined text-[16px]">{iconRight}</span>
      )}
    </button>
  );
}
