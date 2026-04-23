"use client";

import { cn } from "@/shared/utils/cn";

export function Spinner({ size = "md", className }) {
  const sizes = {
    sm: "text-[16px]",
    md: "text-[20px]",
    lg: "text-[24px]",
    xl: "text-[32px]",
  };

  return (
    <span
      className={cn(
        "material-symbols-outlined animate-spin text-[var(--color-accent)]",
        sizes[size],
        className
      )}
    >
      progress_activity
    </span>
  );
}

export function PageLoading({ message = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-surface)] dark:bg-[var(--color-primary)]">
      <Spinner size="xl" />
      <p className="mt-4 text-[13px] text-[var(--color-text-muted)]">{message}</p>
    </div>
  );
}

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-[#f1eeee] dark:bg-[var(--color-bg-alt)]",
        className
      )}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="p-4 rounded border border-[var(--color-border)] dark:border-[var(--color-border)] bg-[var(--color-surface)] dark:bg-[#2a2727]">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="size-8 rounded" />
      </div>
      <Skeleton className="h-6 w-14 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}
