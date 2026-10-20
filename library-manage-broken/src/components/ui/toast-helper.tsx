"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "destructive";
type ToastInput = {
  title?: string;
  description?: string;
  variant?: ToastVariant;
};
type Toast = ToastInput & { id: string };

type ToastApi = {
  toast: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: (input: ToastInput) => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("__toast__", { detail: input }));
        }
      },
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, ...input }]);
      setTimeout(() => remove(id), 3500);
    },
    [remove]
  );

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastInput>).detail;
      toast(detail);
    }
    window.addEventListener("__toast__", onToast as EventListener);
    return () => window.removeEventListener("__toast__", onToast as EventListener);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-lg border bg-card p-4 shadow-md animate-fade-in",
              t.variant === "destructive"
                ? "border-destructive/40 bg-destructive/5"
                : "border-border"
            )}
          >
            {t.title && <div className="text-sm font-semibold">{t.title}</div>}
            {t.description && (
              <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}