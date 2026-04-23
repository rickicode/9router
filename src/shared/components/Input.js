"use client";

import { cn } from "@/shared/utils/cn";

export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  ...props
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-[13px] font-medium text-[var(--color-text-main)]">
          {label}
          {required && <span className="text-[var(--color-danger)] ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-[var(--color-text-muted)]">
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
          </div>
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "w-full py-2.5 px-3 text-[13px] text-[var(--color-text-main)] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg",
            "placeholder:text-[var(--color-text-subtle)]",
            "focus:ring-2 focus:ring-[var(--color-accent)]/25 focus:border-[var(--color-accent)] focus:outline-none",
            "transition-all duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "text-[14px]",
            icon && "pl-10",
            error ? "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-[var(--color-danger)]/20" : "",
            inputClassName
          )}
          {...props}
        />
      </div>
      {error && (
        <p className="text-[12px] text-[var(--color-danger)] flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && <p className="text-[12px] text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}
