"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

export default function ThemeToggle({ className, variant = "default" }) {
  const { theme, toggleTheme, isDark } = useTheme();

  const variants = {
    default: cn(
      "flex items-center justify-center size-10 rounded",
      "text-[var(--color-text-muted)]",
      "hover:bg-[rgba(0,0,0,0.05)]",
      "hover:text-[var(--color-text-main)]",
      "transition-colors"
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded",
      "bg-[var(--color-surface)]/60",
      "hover:bg-[var(--color-surface)]",
      "border border-[var(--color-border)]",
      "  hover:",
      "text-[var(--color-text-muted)]-light hover:text-[var(--color-accent)]",
      "hover:text-[var(--color-accent)]",
      "transition-all group"
    ),
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[22px]",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12"
        )}
      >
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}

