"use client";

import { cn } from "@/shared/utils/cn";

export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
  ...props
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-[13px] font-medium text-[var(--color-text-main)] dark:text-[var(--color-text-inverse)]">
          {label}
          {required && <span className="text-[var(--color-danger)] ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "w-full py-2.5 px-3 pr-10 text-[14px] text-[var(--color-text-main)] dark:text-[var(--color-text-inverse)] bg-[var(--color-surface)] dark:bg-[var(--color-bg-alt)] border border-[var(--color-border)] dark:border-[var(--color-border)] rounded-[6px] appearance-none cursor-pointer",
            "focus:ring-2 focus:ring-[rgba(0,122,255,0.25)] focus:border-[var(--color-border)]007aff] focus:outline-none",
            "transition-all duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            error ? "border-[var(--color-border)]ff3b30] focus:border-[var(--color-border)]ff3b30] focus:ring-[rgba(255,59,48,0.2)]" : "",
            selectClassName
          )}
          {...props}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-[var(--color-text-muted)]">
          <span className="material-symbols-outlined text-[16px]">expand_more</span>
        </div>
      </div>
      {error && (
        <p className="text-[11px] text-[var(--color-danger)] flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && <p className="text-[11px] text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}
