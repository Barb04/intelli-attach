import { useCallback, useEffect, useState } from "react";
import { openDB, type IDBPDatabase } from "idb";
import { getAccessToken } from "./useAuth.js";

const DB_NAME = "intelli-attach";
const DB_VERSION = 1;
const STORE_NAME = "pending_entries";

export interface PendingLogbookEntry {
  localId: string; // client-generated, so we can dedupe/track before a server id exists
  attachmentId: string;
  entryDate: string; // YYYY-MM-DD
  narrative: string;
  latitude: number;
  longitude: number;
  capturedAt: string; // ISO timestamp of when the entry was actually written offline
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: "localId" });
      },
    });
  }
  return dbPromise;
}

/**
 * Why queue in IndexedDB instead of just holding entries in React state and
 * retrying the fetch? Because React state dies the moment the tab closes or
 * the phone kills the browser process for memory — which is exactly the
 * scenario an offline-first field app has to survive. IndexedDB persists
 * across app restarts, so a student who logs an entry at a remote site with
 * zero signal, then closes the app, still has that entry queued when they
 * reopen it with connectivity later.
 *
 * This hook intentionally does NOT try to be clever with the Background
 * Sync API (browser support is inconsistent, especially iOS Safari, which
 * matters a lot if students are on phones). Instead it syncs opportunistically:
 * on mount, and whenever the browser fires an `online` event.
 */
export function useOfflineLogbook() {
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    const db = await getDb();
    const count = await db.count(STORE_NAME);
    setPendingCount(count);
  }, []);

  const queueEntry = useCallback(
    async (entry: Omit<PendingLogbookEntry, "localId">) => {
      const db = await getDb();
      const localId = crypto.randomUUID();
      await db.put(STORE_NAME, { ...entry, localId });
      await refreshPendingCount();
      return localId;
    },
    [refreshPendingCount]
  );

  const syncPendingEntries = useCallback(async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try {
      const db = await getDb();
      const all: PendingLogbookEntry[] = await db.getAll(STORE_NAME);

      for (const entry of all) {
        try {
          const res = await fetch("/api/logbook", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${getAccessToken() ?? ""}`,
            },
            body: JSON.stringify({
              attachmentId: entry.attachmentId,
              entryDate: entry.entryDate,
              narrative: entry.narrative,
              latitude: entry.latitude,
              longitude: entry.longitude,
              createdOffline: true,
              capturedAt: entry.capturedAt,
            }),
          });

          // Only drop the local copy once the server has confirmed receipt.
          // If the fetch throws (still offline, flaky connection) or the
          // server rejects it, the entry stays queued and we retry next time
          // — we never silently lose a student's field data.
          if (res.ok) {
            await db.delete(STORE_NAME, entry.localId);
          }
        } catch {
          // Network dropped mid-sync — stop this pass, the rest stay queued.
          break;
        }
      }

      await refreshPendingCount();
    } finally {
      setIsSyncing(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    refreshPendingCount();
    syncPendingEntries();

    window.addEventListener("online", syncPendingEntries);
    return () => window.removeEventListener("online", syncPendingEntries);
  }, [refreshPendingCount, syncPendingEntries]);

  return { pendingCount, isSyncing, queueEntry, syncPendingEntries };
}
