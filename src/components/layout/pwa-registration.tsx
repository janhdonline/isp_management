"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Whether this build can register a worker at all. */
const CAN_REGISTER =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  process.env.NODE_ENV === "production";

/**
 * Registers the service worker and says what it is doing.
 *
 * Two things worth being explicit about rather than leaving to chance:
 *
 *  - the app tells the user when it has cached for offline use, because a
 *    phone that silently stops asking the server is confusing;
 *  - it never claims to be offline when it is not, and it never caches a
 *    balance. A wrong number on a billing screen is worse than an error.
 */
export function PwaRegistration() {
  // `online` is read during the first client render rather than set from an
  // effect, so the server and client agree and there is no second render.
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);

    if (CAN_REGISTER) {
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
    }

    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // Nothing to say before registration is settled, or in a build that cannot
  // register one.
  if (!CAN_REGISTER && online) return null;

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
