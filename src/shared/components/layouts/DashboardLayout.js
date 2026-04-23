"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/shared/utils/cn";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") return { wrapper: "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]", icon: "check_circle" };
  if (type === "error") return { wrapper: "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]", icon: "error" };
  if (type === "warning") return { wrapper: "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]", icon: "warning" };
  return { wrapper: "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]", icon: "info" };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-bg)]">
      {/* Toast notifications */}
      <div className="fixed top-3 right-3 z-[80] flex w-[min(92vw,360px)] flex-col gap-2">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div key={n.id} className={cn("rounded-lg border px-3 py-2.5 animate-slide-up", style.wrapper)}>
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[16px]">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title && <p className="text-[13px] font-medium mb-0.5 text-[var(--color-text-main)]">{n.title}</p>}
                  <p className="text-[13px] whitespace-pre-wrap break-words text-[var(--color-text-main)]">{n.message}</p>
                </div>
                {n.dismissible && (
                  <button onClick={() => removeNotification(n.id)} className="text-current/60 hover:text-current transition-colors" aria-label="Dismiss">
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      <div className={cn("fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-200", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content area */}
      <main className="flex flex-col flex-1 h-full min-w-0 relative bg-[var(--color-bg)]">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        
        {/* Page content with proper padding */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
