"use client";

import { cn } from "@/shared/utils/cn";

export default function Avatar({
  src,
  alt = "Avatar",
  name,
  size = "md",
  className,
}) {
  const sizes = {
    xs: "size-6 text-[12px]",
    sm: "size-8 text-[14px]",
    md: "size-10 text-base",
    lg: "size-12 text-[16px]",
    xl: "size-16 text-[20px]",
  };

  // Get initials from name
  const getInitials = (name) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Generate color from name
  const getColorFromName = (name) => {
    if (!name) return "bg-[var(--color-primary)]";
    const colors = [
      "bg-[var(--color-danger)]",
      "bg-orange-500",
      "bg-amber-500",
      "bg-yellow-500",
      "bg-lime-500",
      "bg-green-500",
      "bg-emerald-500",
      "bg-teal-500",
      "bg-cyan-500",
      "bg-sky-500",
      "bg-blue-500",
      "bg-indigo-500",
      "bg-violet-500",
      "bg-purple-500",
      "bg-fuchsia-500",
      "bg-pink-500",
      "bg-rose-500",
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  if (src) {
    return (
      <div
        className={cn(
          "rounded bg-cover bg-center bg-no-repeat",
          "ring-2 ring-white dark:ring-surface-dark ",
          sizes[size],
          className
        )}
        style={{ backgroundImage: `url(${src})` }}
        role="img"
        aria-label={alt}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded flex items-center justify-center font-medium text-[var(--color-text-main)]",
        "ring-2 ring-white dark:ring-surface-dark ",
        sizes[size],
        getColorFromName(name),
        className
      )}
      role="img"
      aria-label={alt}
    >
      {getInitials(name)}
    </div>
  );
}

