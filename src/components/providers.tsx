"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ToastViewport, type ToastItem, type ToastInput } from "@/components/ui/toast";
import { useLocalStorage } from "@/lib/client-state";

type ToastContextValue = {
  toast: (input: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const STORAGE_KEY = "isp-theme";

type Theme = "light" | "dark";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // The inline script in the document head already applied the class before
  // paint, so reading it back from the store causes no flash and needs no
  // setState-in-effect round trip.
  const [theme, setTheme] = useLocalStorage<Theme>(STORAGE_KEY, "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev.slice(-4), { ...input, id }]);
      window.setTimeout(() => dismiss(id), input.duration ?? 4500);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ variant: "success", title, description }),
      error: (title, description) => toast({ variant: "error", title, description }),
      info: (title, description) => toast({ variant: "info", title, description }),
      warning: (title, description) => toast({ variant: "warning", title, description }),
    }),
    [toast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside AppProviders");
  return ctx;
}

export function useTheme() {
  const [theme, setTheme] = useLocalStorage<Theme>(STORAGE_KEY, "light");
  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);
  return { theme, toggle };
}
