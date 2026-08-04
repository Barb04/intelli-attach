import { useOfflineLogbook } from "../hooks/useOfflineLogbook.js";

export function StudentDashboard() {
  const { pendingCount, isSyncing, syncPendingEntries } = useOfflineLogbook();

  return (
    <div>
      <h1>Student Dashboard</h1>
      <p>
        {pendingCount > 0
          ? `${pendingCount} entr${pendingCount === 1 ? "y" : "ies"} queued for sync`
          : "All entries synced"}
        {isSyncing && " — syncing…"}
      </p>
      <button onClick={syncPendingEntries} disabled={isSyncing}>
        Sync now
      </button>
      {/* Phase 4/5 will add: geolocation capture, the entry form itself,
          and the reviewed-status list. This stub exists to prove the
          offline queue hook wires up cleanly before we build on top of it. */}
    </div>
  );
}
