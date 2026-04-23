"use client";

import { cn } from "@/shared/utils/cn";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  className,
  ...props
}) {
  const paddings = {
    none: "",
    sm: "p-3",
    md: "p-5",
    lg: "p-6",
  };

  return (
    <div
      className={cn(
        "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg",
        hover && "hover:border-[var(--color-accent)]/30 transition-all duration-200 cursor-pointer",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center text-[var(--color-accent)]">
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
              </div>
            )}
            <div>
              {title && <h3 className="text-[14px] font-semibold text-[var(--color-text-main)]">{title}</h3>}
              {subtitle && <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-4 rounded-lg bg-[var(--color-bg-alt)] border border-[var(--color-border)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-3.5 -mx-5 px-5 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-alt)] transition-colors",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({ children, actions, className, ...props }) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between p-3.5 -mx-5 px-5 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-alt)] transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
};
