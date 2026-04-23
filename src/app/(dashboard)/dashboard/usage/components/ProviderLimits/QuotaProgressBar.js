"use client";

import { cn } from "@/shared/utils/cn";
import { formatResetTime } from "./utils";

// Calculate color based on remaining percentage
const getColorClasses = (remainingPercentage) => {
  if (remainingPercentage > 70) {
    return {
      text: "text-[var(--color-success)]",
      bg: "bg-[var(--color-success)]",
      bgLight: "bg-[var(--color-success)]/10",
      emoji: "🟢"
    };
  }
  
  if (remainingPercentage >= 30) {
    return {
      text: "text-[var(--color-warning)]",
      bg: "bg-[var(--color-warning)]",
      bgLight: "bg-[var(--color-warning)]/10",
      emoji: "🟡"
    };
  }
  
  // 0-29% including 0% (out of quota) - show red
  return {
    text: "text-[var(--color-danger)]",
    bg: "bg-[var(--color-danger)]",
    bgLight: "bg-[var(--color-danger)]/10",
    emoji: "🔴"
  };
};

// Format reset time display
const formatResetTimeDisplay = (resetTime) => {
  if (!resetTime) return null;
  
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();
    const isTomorrow = resetDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    
    const timeStr = resetDate.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;
    
    return resetDate.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
};

export default function QuotaProgressBar({
  percentage = 0,
  label = "",
  used = 0,
  total = 0,
  unlimited = false,
  resetTime = null
}) {
  const colors = getColorClasses(percentage);
  const countdown = formatResetTime(resetTime);
  const resetDisplay = formatResetTimeDisplay(resetTime);
  
  // percentage is already remaining percentage (from ProviderLimitCard)
  const remaining = percentage;
  
  return (
    <div className="space-y-2">
      {/* Label and percentage */}
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-[var(--color-accent)]">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px]">{colors.emoji}</span>
          <span className={cn("font-medium", colors.text)}>
            {remaining}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {!unlimited && (
        <div className={cn("h-2 rounded overflow-hidden", colors.bgLight)}>
          <div
            className={cn("h-full transition-all duration-300", colors.bg)}
            style={{ width: `${Math.min(remaining, 100)}%` }}
          />
        </div>
      )}

      {/* Usage details and countdown */}
      <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
        <span>
          {used.toLocaleString()} / {total.toLocaleString()} requests
        </span>
        {countdown !== "-" && (
          <div className="flex items-center gap-1">
            <span>•</span>
            <span className="font-medium">Reset in {countdown}</span>
          </div>
        )}
      </div>

      {/* Reset time display */}
      {resetDisplay && (
        <div className="text-[11px] text-[var(--color-text-muted)]/70">
          Reset at {resetDisplay}
        </div>
      )}
    </div>
  );
}
