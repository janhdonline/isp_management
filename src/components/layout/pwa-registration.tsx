"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Subscribes to the browser's online/offline events. */
function subscribeOnlineStatus(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether this browser can register the service worker at all. Inherently
 * client-only, so the server snapshot is `false` — hydration must compare
 * against what the server rendered.
 */
function getCanRegister() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    process.env.NODE_ENV === "production"
  );
}

function subscribeCanRegister() {
  return () => {};
}

/**
 * Registers the service worker and says what it is doing.
 *
 * Two things worth being explicit about rather than leaving to chance:
 *  - the app tells the user when it has cached for offline use, because a
 *    phone that silently stops asking the server is confusing;
 *  - it never claims to be offline when it is not, and it never caches a
 *    balance. A wrong number on a billing screen is worse than an error.
 *
 * Both values this renders from are client-only (`navigator.onLine` and the
 * service-worker check). They are read through `useSyncExternalStore` with
 * server snapshots, so the server render and the first client render always
 * agree — reading `navigator.onLine` directly during the first client render
 * used to hydrate-mismatch whenever the browser reported offline.
 */
export function PwaRegistration() {
  const online = useSyncExternalStore(
    subscribeOnlineStatus,
    () => navigator.onLine,
    () => true
  );
  const canRegister = useSyncExternalStore(
    subscribeCanRegister,
    getCanRegister,
    () => false
  );
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    if (!canRegister) return;
    // Registered after load so this never competes with the first render.
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        setRegistered(true);
      } catch {
        // A failed registration is not worth an error on screen; the app
        // simply works without offline support.
      }
    };
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
  }, [canRegister]);

  // Nothing to say while online in a build that cannot register a worker.
  if (!canRegister && online) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t px-3 py-2 text-[11px]",
        online
          ? "border-[var(--border)] text-fg-subtle"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      )}
      role="status"
      aria-live="polite"
    >
      {online ? <Wifi className="size-3.5 shrink-0" /> : <WifiOff className="size-3.5 shrink-0" />}
      <span className="truncate">
        {online
          ? registered
            ? "Installed for offline use"
            : "Available offline once the app is reloaded"
          : "Offline — figures shown may be out of date"}
      </span>
    </div>
  );
}
