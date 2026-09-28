"use client";

import * as React from "react";

/**
 * `false` on the server and on the very first client render, `true` afterwards.
 * Used for anything that must not run during SSR (portals, localStorage, media
 * queries) without the usual `useEffect(() => setState(true))` pattern.
 */
const emptySubscribe = () => () => {};

export function useIsMounted(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

const LOCAL_EVENT = "isp-local";

/**
 * Reads a value from localStorage without a hydration mismatch: the server and
 * the first client render both return `defaultValue`, then the real stored
 * value is picked up on the next commit.
 */
export function useLocalStorage<T extends string>(
  key: string,
  defaultValue: T
): [T, (next: T) => void] {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      window.addEventListener("storage", onStoreChange);
      window.addEventListener(LOCAL_EVENT, onStoreChange);
      return () => {
        window.removeEventListener("storage", onStoreChange);
        window.removeEventListener(LOCAL_EVENT, onStoreChange);
      };
    },
    []
  );

  const value = React.useSyncExternalStore(
    subscribe,
    () => (localStorage.getItem(key) as T | null) ?? defaultValue,
    () => defaultValue
  ) as T;

  const set = React.useCallback(
    (next: T) => {
      localStorage.setItem(key, next);
      window.dispatchEvent(new Event(LOCAL_EVENT));
    },
    [key]
  );

  return [value, set];
}
