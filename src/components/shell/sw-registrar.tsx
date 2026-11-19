"use client";

import { useEffect } from "react";
import { recoverInterruptedUploads, syncAll } from "@/lib/offline/sync";
import { requestPersistentStorage } from "@/lib/offline/db";

/**
 * Registers the offline shell service worker (production builds only) and runs sync triggers:
 * on app open and whenever the browser reports it is back online. Does not rely on the
 * Background Sync API.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
        /* offline shell unavailable; IndexedDB capture still works once loaded */
      });
    }
    void requestPersistentStorage();
    const run = () => {
      if (navigator.onLine) void syncAll();
    };
    void recoverInterruptedUploads().then(run);
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, []);
  return null;
}
